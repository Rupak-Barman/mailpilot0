// jobs/poll.job.js
import "dotenv/config";
import cron from "node-cron";
import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import EmailAction from "../models/EmailAction.js";
import { getGmail } from "../services/gmail.service.js";
import { analyzeEmailAI } from "../services/aiEngine.js";
import { updateAnalytics } from "../services/analytics.service.js";
import { getHeader, buildMimeMessage } from "../utils/helpers.js";

const inFlight = new Set();

const decodeBase64Url = (value = "") =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

const textFromPayload = (payload) => {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts?.length) {
    const plain = payload.parts
      .map(part => textFromPayload(part))
      .filter(Boolean)
      .join("\n")
      .trim();

    if (plain) return plain;
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return "";
};

const processMessage = async ({ user, gmail, messageId }) => {
  const lockKey = `${user._id}:${messageId}`;
  if (inFlight.has(lockKey)) return false;

  inFlight.add(lockKey);

  try {
    const alreadyProcessed = await ProcessedEmail.findOne({
      userId: String(user._id),
      messageId
    });

    if (alreadyProcessed) {
      const shouldMarkRead = typeof alreadyProcessed.markAsRead === "boolean"
        ? alreadyProcessed.markAsRead
        : alreadyProcessed.action !== "draft";

      if (shouldMarkRead) {
        await gmail.users.messages.modify({
          userId: "me",
          id: messageId,
          requestBody: {
            removeLabelIds: ["UNREAD"]
          }
        });
      }
      return false;
    }

    const email = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full"
    });

    const subject = getHeader(email.data, "Subject");
    const from = getHeader(email.data, "From");
    const messageHeaderId = getHeader(email.data, "Message-ID");
    const references = getHeader(email.data, "References") || messageHeaderId;
    const snippet = email.data.snippet || "";
    const bodyText = textFromPayload(email.data.payload) || snippet;

    const enabledLabels = user.labels.filter(l => l.enabled !== false);

    if (enabledLabels.length === 0) {
      return false;
    }

    const { label, action: aiAction, body, summary } = await analyzeEmailAI({
      userId: user._id,
      subject,
      from,
      snippet,
      bodyText,
      userProfileDescription: user.profileDescription,
      labels: enabledLabels,
      personas: user.personas || []
    });

    const labelObj = enabledLabels.find(l => l.name === label);
    if (!labelObj) return;

    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        addLabelIds: [labelObj.id]
      }
    });

    const userAction = labelObj.action?.type || "none";
    const finalAction = aiAction === "none" ? "none" : userAction;
    const shouldMarkRead = typeof labelObj.markAsRead === "boolean"
      ? labelObj.markAsRead
      : finalAction !== "draft";

    if (["reply", "draft"].includes(finalAction)) {
      const threadId = email.data.threadId;
      const existingThreadAction = threadId
        ? await EmailAction.findOne({
            userId: String(user._id),
            threadId
          })
        : null;

      const raw = buildMimeMessage({
        to: from,
        subject,
        body,
        inReplyTo: messageHeaderId,
        references,
        isReply: true
      });
      let gmailMessageId = "";
      let gmailDraftId = "";

      if (finalAction === "reply") {
        const sent = await gmail.users.messages.send({
          userId: "me",
          requestBody: {
            raw,
            threadId
          }
        });
        gmailMessageId = sent.data.id;
      }

      if (finalAction === "draft") {
        const draft = await gmail.users.drafts.create({
          userId: "me",
          requestBody: {
            message: {
              raw,
              threadId
            }
          }
        });
        gmailDraftId = draft.data.id;
        gmailMessageId = draft.data.message?.id || "";
      }

      const cleanSummary = summary || snippet || "Incoming email message.";

      if (existingThreadAction) {
        // Build or migrate previous conversation history if it was empty
        const history = [...(existingThreadAction.conversationHistory || [])];
        if (history.length === 0 && existingThreadAction.body) {
          history.push({
            role: "incoming",
            type: "summary",
            content: existingThreadAction.summary || existingThreadAction.subject || "Original email",
            messageId: existingThreadAction.sourceMessageId,
            timestamp: existingThreadAction.createdAt || new Date()
          });
          history.push({
            role: "outgoing",
            type: existingThreadAction.type || "draft",
            content: existingThreadAction.body,
            timestamp: existingThreadAction.sentAt || existingThreadAction.updatedAt || new Date()
          });
        }

        // Append the new turn
        history.push({
          role: "incoming",
          type: "summary",
          content: cleanSummary,
          messageId,
          timestamp: new Date()
        });
        history.push({
          role: "outgoing",
          type: finalAction,
          content: body,
          timestamp: new Date()
        });

        existingThreadAction.conversationHistory = history;
        existingThreadAction.summary = cleanSummary;
        existingThreadAction.body = body;
        existingThreadAction.sourceMessageId = messageId;
        existingThreadAction.gmailMessageId = gmailMessageId;
        existingThreadAction.gmailDraftId = gmailDraftId;
        existingThreadAction.type = finalAction;
        existingThreadAction.label = label;
        existingThreadAction.status = finalAction === "reply" ? "sent" : "draft";
        existingThreadAction.checked = false;
        existingThreadAction.checkedAt = null;
        existingThreadAction.sentAt = finalAction === "reply" ? new Date() : null;

        await existingThreadAction.save();
      } else {
        await EmailAction.create({
          userId: String(user._id),
          sourceMessageId: messageId,
          gmailMessageId,
          gmailDraftId,
          threadId,
          type: finalAction,
          label,
          to: from,
          subject,
          summary: cleanSummary,
          body,
          checked: false,
          status: finalAction === "reply" ? "sent" : "draft",
          sentAt: finalAction === "reply" ? new Date() : null,
          conversationHistory: [
            {
              role: "incoming",
              type: "summary",
              content: cleanSummary,
              messageId,
              timestamp: new Date()
            },
            {
              role: "outgoing",
              type: finalAction,
              content: body,
              timestamp: new Date()
            }
          ]
        });
      }
    }

    await ProcessedEmail.create({
      userId: String(user._id),
      messageId,
      label,
      action: finalAction,
      markAsRead: shouldMarkRead
    });

    await updateAnalytics({
      userId: user._id,
      label,
      action: finalAction
    });

    if (shouldMarkRead) {
      await gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: {
          removeLabelIds: ["UNREAD"]
        }
      });
    }

    return true;
  } catch (err) {
    if (err?.code === 11000) {
      const existing = await ProcessedEmail.findOne({
        userId: String(user._id),
        messageId
      });
      const shouldMarkRead = typeof existing?.markAsRead === "boolean"
        ? existing.markAsRead
        : existing?.action !== "draft";

      if (shouldMarkRead) {
        await gmail.users.messages.modify({
          userId: "me",
          id: messageId,
          requestBody: {
            removeLabelIds: ["UNREAD"]
          }
        });
      }
      return false;
    }

    console.log("Email processing error:", err.message);
    return false;
  } finally {
    inFlight.delete(lockKey);
  }
};

export const startPolling = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const users = await User.find();

      for (const user of users) {
        if (!user.refreshToken || !user.labels?.some(l => l.enabled !== false)) continue;

        const gmail = await getGmail(user);

        const res = await gmail.users.messages.list({
          userId: "me",
          maxResults: 10,
          q: "is:unread category:primary -from:noreply newer_than:1h"
        });

        for (const m of res.data.messages || []) {
          const processed = await processMessage({ user, gmail, messageId: m.id });
          if (processed) break;
        }
      }
    } catch (e) {
      console.log("Polling error:", e.message);
    }
  });
};
