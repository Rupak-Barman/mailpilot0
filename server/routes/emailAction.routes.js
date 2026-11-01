import express from "express";
import mongoose from "mongoose";
import auth from "../middleware/auth.js";
import EmailAction from "../models/EmailAction.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import User from "../models/User.js";
import {
  getGmail,
  withGmail,
  updateGmailDraft,
  deleteGmailDraft,
  isInvalidGrantError,
  isTransientError
} from "../services/gmail.service.js";
import {
  getHeader,
  buildMimeMessage,
  parseRecipient,
  parseRecipientList,
  formatRecipientList,
  isValidEmail,
} from "../utils/helpers.js";
import { generateEmailAnalysis, LLM_MODEL } from "../services/aiEngine.js";
import { generateAiAssist } from "../services/aiAssist.service.js";
import { publishUserEvent } from "../services/events.service.js";
import { reconcileTurn } from "../services/reconcile.service.js";

const router = express.Router();

const asPositiveInt = (value, fallback, max = 100) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const getOrCreateGmailLabel = async (gmail, labelName) => {
  const { data } = await gmail.users.labels.list({
    userId: "me",
  });

  const labels = data.labels || [];

  const existingLabel = labels.find(
    (item) =>
      item.name.toLowerCase() === labelName.toLowerCase()
  );

  if (existingLabel) {
    if (existingLabel.type !== "user") {
      throw new Error(
        `"${labelName}" is a reserved Gmail system label. Use a custom label name.`
      );
    }

    return existingLabel.id;
  }

  const { data: createdLabel } = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });

  return createdLabel.id;
};



export const buildFailedFilter = (userId) => ({
  userId,
  $or: [
    {
      turns: { $exists: true, $not: { $size: 0 } },
      $expr: {
        $in: [
          { $arrayElemAt: ["$turns.outcome", -1] },
          ["failed", "needs_manual"]
        ]
      }
    },
    {
      $and: [
        {
          $or: [
            { turns: { $exists: false } },
            { turns: { $size: 0 } }
          ]
        },
        {
          $or: [
            { status: "failed" },
            { status: "send_failed" },
            { type: "failed" }
          ]
        }
      ]
    }
  ]
});

export const buildDraftFilter = (userId) => ({
  userId,
  $or: [
    {
      turns: { $exists: true, $not: { $size: 0 } },
      $expr: {
        $eq: [
          { $arrayElemAt: ["$turns.outgoing.kind", -1] },
          "draft"
        ]
      }
    },
    {
      $and: [
        {
          $or: [
            { turns: { $exists: false } },
            { turns: { $size: 0 } }
          ]
        },
        { type: "draft" }
      ]
    }
  ]
});

export const buildReplyFilter = (userId) => ({
  userId,
  $or: [
    {
      turns: { $exists: true, $not: { $size: 0 } },
      $expr: {
        $eq: [
          { $arrayElemAt: ["$turns.outgoing.kind", -1] },
          "reply"
        ]
      }
    },
    {
      $and: [
        {
          $or: [
            { turns: { $exists: false } },
            { turns: { $size: 0 } }
          ]
        },
        { type: "reply" }
      ]
    }
  ]
});

export const buildEmailActionsFilter = ({ userId, checked, type, label, q, status, tab }) => {
  const filter = { userId };

  if (checked === "true") filter.checked = true;
  if (checked === "false") filter.checked = false;

  if (tab === "failed" || type === "failed") {
    filter.$and = filter.$and || [];
    filter.$and.push({ $or: buildFailedFilter(userId).$or });
  } else if (tab === "draft" || type === "draft") {
    filter.type = "draft";
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        {
          turns: { $exists: true, $not: { $size: 0 } },
          $expr: {
            $ne: [{ $arrayElemAt: ["$turns.outgoing.status", -1] }, "deleted"]
          }
        },
        { turns: { $size: 0 } },
        { turns: { $exists: false } }
      ]
    });
  } else if (tab === "reply" || type === "reply") {
    filter.type = "reply";
  }

  if (status) {
    if (status === "failed") {
      filter.$and = filter.$and || [];
      filter.$and.push({ $or: buildFailedFilter(userId).$or });
    } else if (status === "draft") {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          {
            turns: { $exists: true, $not: { $size: 0 } },
            $expr: {
              $eq: [{ $arrayElemAt: ["$turns.outgoing.status", -1] }, "draft"]
            }
          },
          {
            $and: [
              {
                $or: [
                  { turns: { $exists: false } },
                  { turns: { $size: 0 } }
                ]
              },
              { status: "draft" }
            ]
          }
        ]
      });
    } else if (status === "sent") {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          {
            turns: { $exists: true, $not: { $size: 0 } },
            $expr: {
              $eq: [{ $arrayElemAt: ["$turns.outgoing.status", -1] }, "sent"]
            }
          },
          {
            $and: [
              {
                $or: [
                  { turns: { $exists: false } },
                  { turns: { $size: 0 } }
                ]
              },
              { status: "sent" }
            ]
          }
        ]
      });
    } else if (status === "needs_reply") {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { status: "needs_reply" },
          {
            turns: { $exists: true, $not: { $size: 0 } },
            $expr: {
              $and: [
                {
                  $not: {
                    $in: [
                      { $arrayElemAt: ["$turns.outcome", -1] },
                      ["failed", "needs_manual"]
                    ]
                  }
                },
                {
                  $eq: [
                    { $ifNull: [{ $arrayElemAt: ["$turns.outgoing", -1] }, null] },
                    null
                  ]
                }
              ]
            }
          }
        ]
      });
    } else if (status === "reviewed") {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { checked: true },
          { status: "reviewed" }
        ]
      });
    } else if (status === "unchecked") {
      filter.checked = false;
    } else if (status === "checked") {
      filter.checked = true;
    } else {
      filter.status = status;
    }
  }

  if (label) {
    filter.label = label;
  }

  if (q && q.trim()) {
    const escapedQ = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = { $regex: escapedQ, $options: "i" };
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { subject: regex },
        { to: regex },
        { body: regex },
        { summary: regex },
        { "turns.incomingSubject": regex },
        { "turns.incomingSummary": regex },
        { "turns.outgoing.body": regex },
        { "turns.from": regex }
      ]
    });
  }

  return filter;
};

export const handleGetSummary = async (req, res) => {
  const userId = req.user.id;

  const [unchecked, drafts, replies, failed, total] = await Promise.all([
    EmailAction.countDocuments({ userId, checked: false }),
    EmailAction.countDocuments({
      userId,
      type: "draft",
      $or: [
        { "turns.outgoing.status": { $ne: "deleted" } },
        { turns: { $size: 0 } },
        { turns: { $exists: false } }
      ]
    }),
    EmailAction.countDocuments({ userId, type: "reply" }),
    EmailAction.countDocuments(buildFailedFilter(userId)),
    EmailAction.countDocuments({ userId }),
  ]);

  res.json({ unchecked, drafts, replies, failed, total });
};

router.get("/summary", auth, handleGetSummary);

export const handleGetEmailActions = async (req, res) => {
  const { checked, type, label, q, status, tab } = req.query;
  const page = asPositiveInt(req.query.page, 1, 10000);
  const limit = asPositiveInt(req.query.limit, 20, 100);
  const skip = (page - 1) * limit;

  const filter = buildEmailActionsFilter({
    userId: req.user.id,
    checked,
    type,
    label,
    q,
    status,
    tab
  });

  const [rawItems, total] = await Promise.all([
    EmailAction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    EmailAction.countDocuments(filter),
  ]);

  // Ensure response objects include both thread/turn structure and top-level fields
  const items = rawItems.map((doc) => {
    const obj = doc.toObject ? doc.toObject() : { ...doc };
    if (Array.isArray(obj.turns) && obj.turns.length > 0) {
      const latestTurn = obj.turns[obj.turns.length - 1];
      if (latestTurn.outgoing) {
        if (!obj.body) obj.body = latestTurn.outgoing.body || "";
        if (!obj.gmailDraftId && latestTurn.outgoing.gmailDraftId) {
          obj.gmailDraftId = latestTurn.outgoing.gmailDraftId;
        }
        if (!obj.gmailMessageId && latestTurn.outgoing.gmailMessageId) {
          obj.gmailMessageId = latestTurn.outgoing.gmailMessageId;
        }
      }
      if (!obj.summary && latestTurn.incomingSummary) {
        obj.summary = latestTurn.incomingSummary;
      }
    }
    return obj;
  });

  res.json({
    items,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
};

router.get("/", auth, handleGetEmailActions);

router.patch("/:id/label", auth, async (req, res) => {
  try {
    if (typeof req.body.label !== "string") {
      return res.status(400).json({
        message: "A valid label is required",
      });
    }

    const label = req.body.label.trim();

    if (label.length > 80) {
      return res.status(400).json({
        message: "Label cannot exceed 80 characters",
      });
    }

    const action = await EmailAction.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!action) {
      return res.status(404).json({
        message: "Draft not found",
      });
    }

    if (
      action.type !== "draft" ||
      (action.status && action.status !== "draft")
    ) {
      return res.status(409).json({
        message: "Only editable drafts can have their labels changed",
      });
    }

    if (!action.sourceMessageId) {
      return res.status(400).json({
        message: "Original Gmail message ID is missing",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user || !user.refreshToken) {
      return res.status(401).json({
        message: "Gmail connection is unavailable",
      });
    }

    const gmail = await getGmail(user);

    // Get existing Gmail labels
    const { data } = await gmail.users.labels.list({
      userId: "me",
    });

    const gmailLabels = data.labels || [];

    const previousLabel = (action.label || "").trim();

    // Find the previous custom Gmail label
    const oldGmailLabel = previousLabel
      ? gmailLabels.find(
        (item) =>
          item.name.toLowerCase() ===
          previousLabel.toLowerCase() &&
          item.type === "user"
      )
      : null;

    let newGmailLabelId = null;

    // Find or create the new Gmail label
    if (label) {
      newGmailLabelId = await getOrCreateGmailLabel(
        gmail,
        label
      );
    }

    const addLabelIds = [];
    const removeLabelIds = [];

    // Add new label
    if (newGmailLabelId) {
      addLabelIds.push(newGmailLabelId);
    }

    // Remove previous label if different
    if (
      oldGmailLabel &&
      oldGmailLabel.id !== newGmailLabelId
    ) {
      removeLabelIds.push(oldGmailLabel.id);
    }

    // Apply labels to the original Gmail message.
    // Gmail does not allow custom labels directly on drafts.
    if (addLabelIds.length || removeLabelIds.length) {
      await gmail.users.messages.modify({
        userId: "me",
        id: action.sourceMessageId,
        requestBody: {
          addLabelIds,
          removeLabelIds,
        },
      });
    }

    // Update MongoDB only after Gmail succeeds
    action.label = label;
    await action.save();

    publishUserEvent(req.user.id, {
      type: "emailAction.changed",
      threadId: action.threadId || action._id,
      at: Date.now(),
    });
    publishUserEvent(req.user.id, {
      type: "analytics.changed",
      at: Date.now(),
    });

    return res.json({
      message: "Gmail and Mailpilot labels updated successfully",
      action,
    });

  } catch (error) {
    console.error("Update Gmail label error:", error);

    return res.status(500).json({
      message: error.message || "Could not update Gmail label",
    });
  }
});

export const handleSendDraft = async (req, res) => {
  try {
    const action = await EmailAction.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!action) {
      return res.status(404).json({
        message: "Draft not found",
      });
    }

    // Determine the latest turn containing a draft
    let draftTurn = null;
    if (Array.isArray(action.turns) && action.turns.length > 0) {
      const lastTurn = action.turns[action.turns.length - 1];
      if (lastTurn && lastTurn.outgoing && lastTurn.outgoing.kind === "draft") {
        draftTurn = lastTurn;
      }
    }

    const isDraft = action.type === "draft" || (draftTurn && draftTurn.outgoing?.kind === "draft");
    if (!isDraft) {
      return res.status(400).json({
        message: "Only saved drafts can be sent here",
      });
    }

    const currentStatus = draftTurn ? draftTurn.outgoing.status : action.status;
    if (currentStatus === "sent") {
      return res.status(409).json({
        message: "This draft has already been sent",
      });
    }

    if (currentStatus === "sending" || currentStatus === "send_failed" || currentStatus === "failed") {
      return res.status(409).json({
        message: "Previous send attempt needs verification",
      });
    }

    const draftId = draftTurn?.outgoing?.gmailDraftId || action.gmailDraftId;
    if (!draftId) {
      return res.status(400).json({
        message: "Gmail draft ID is missing",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user || !user.refreshToken) {
      return res.status(401).json({
        message: "Gmail connection is unavailable",
      });
    }

    const gmail = await getGmail(user);

    // If request contains draft overrides, apply them to Gmail before sending
    const { to, cc, bcc, subject, body } = req.body || {};
    if (
      to !== undefined ||
      cc !== undefined ||
      bcc !== undefined ||
      subject !== undefined ||
      body !== undefined
    ) {
      const draftTo = to !== undefined ? parseRecipientList(to) : (draftTurn?.outgoing?.to || action.to);
      const draftCc = cc !== undefined ? parseRecipientList(cc) : (draftTurn?.outgoing?.cc || action.cc);
      const draftBcc = bcc !== undefined ? parseRecipientList(bcc) : (draftTurn?.outgoing?.bcc || action.bcc);
      const draftSubject = subject !== undefined ? String(subject).trim() : (draftTurn?.outgoing?.subject || action.subject || "");
      const draftBody = body !== undefined ? body : (draftTurn?.outgoing?.body || action.body || "");

      const updatedDraft = await updateGmailDraft(gmail, {
        gmailDraftId: draftId,
        to: draftTo,
        cc: draftCc,
        bcc: draftBcc,
        subject: draftSubject,
        body: draftBody,
        threadId: action.threadId,
        userEmail: user.email,
      });

      if (draftTurn) {
        if (draftTo) draftTurn.outgoing.to = parseRecipientList(draftTo);
        if (draftCc !== undefined) draftTurn.outgoing.cc = parseRecipientList(draftCc);
        if (draftBcc !== undefined) draftTurn.outgoing.bcc = parseRecipientList(draftBcc);
        draftTurn.outgoing.subject = draftSubject;
        draftTurn.outgoing.body = draftBody;
        if (updatedDraft.message?.id) {
          draftTurn.outgoing.gmailMessageId = updatedDraft.message.id;
        }
      }
      if (draftTo) action.to = formatRecipientList(draftTo);
      if (draftCc !== undefined) action.cc = formatRecipientList(draftCc);
      if (draftBcc !== undefined) action.bcc = formatRecipientList(draftBcc);
      action.subject = draftSubject;
      action.body = draftBody;
    }

    // Atomically prevent double-clicks and duplicate sending.
    if (draftTurn) {
      draftTurn.outgoing.status = "sending";
    }
    action.status = "sending";
    await action.save();

    let sent;

    try {
      // Send the existing Gmail draft, not a newly constructed email.
      sent = await gmail.users.drafts.send({
        userId: "me",
        requestBody: {
          id: draftId,
        },
      });
    } catch (error) {
      console.error("Gmail draft sending failed:", error.message);

      const status = error.status || error.response?.status;
      if (status === 404 || error.message?.includes("404") || error.message?.includes("Not Found")) {
        const recResult = await reconcileTurn(user, action, draftTurn, { gmail }).catch(() => null);
        if (recResult?.status === "sent") {
          return res.status(409).json({
            message: "Draft was already sent directly in Gmail",
            action
          });
        }
        if (recResult?.status === "deleted") {
          return res.status(409).json({
            message: "Draft was deleted directly in Gmail",
            action
          });
        }
        return res.status(404).json({
          message: "Draft no longer exists in Gmail",
          action
        });
      }

      // A Google API response confirms rejection.
      // A network failure can have an uncertain send outcome.
      const rollbackStatus = error.response ? "draft" : "failed";
      if (draftTurn) {
        draftTurn.outgoing.status = rollbackStatus;
      }
      action.status = error.response ? "draft" : "send_failed";
      await action.save().catch(() => {});

      return res.status(502).json({
        message: error.response
          ? "Gmail rejected the send request. The draft is still available."
          : "Send outcome is uncertain. Check Gmail Sent before retrying.",
      });
    }

    const sentMessageId = sent.data?.id || "";
    const now = new Date();

    let sentRfcMessageId = null;
    if (sentMessageId) {
      try {
        const meta = await gmail.users.messages.get({
          userId: "me",
          id: sentMessageId,
          format: "metadata",
          metadataHeaders: ["Message-ID", "Message-Id"]
        });
        sentRfcMessageId =
          getHeader(meta?.data, "Message-ID") ||
          getHeader(meta?.data, "Message-Id") ||
          null;
      } catch (metaErr) {
        console.warn(
          "[emailAction.routes] Could not fetch sent RFC Message-ID:",
          metaErr.message
        );
      }
    }

    if (draftTurn) {
      draftTurn.outgoing.status = "sent";
      draftTurn.outgoing.sentAt = now;
      draftTurn.outgoing.gmailMessageId = sentMessageId;
      draftTurn.outgoing.rfcMessageId = sentRfcMessageId;
      draftTurn.outcome = "sent";
    }

    // Keep draft kind so sent draft stays in Drafts tab with "Sent" badge
    action.type = draftTurn?.outgoing?.kind || action.type || "draft";
    action.status = "sent";
    action.sentAt = now;
    action.gmailMessageId = sentMessageId;
    action.checked = true;
    action.checkedAt = now;

    await action.save();

    // Update ProcessedEmail whenever a draft is sent
    const targetMessageId = draftTurn?.incomingMessageId || action.sourceMessageId;
    if (targetMessageId) {
      const isAiAssisted = draftTurn?.outgoing?.generation?.mode === "user_assisted";
      const existingProc = await ProcessedEmail.findOne({
        userId: String(req.user.id),
        messageId: targetMessageId
      });
      const wasFailed = existingProc && (existingProc.outcome === "failed" || existingProc.outcome === "needs_manual");
      const resolution = (isAiAssisted || wasFailed) ? "ai_assisted" : "ai_draft_sent";

      await ProcessedEmail.findOneAndUpdate(
        { userId: String(req.user.id), messageId: targetMessageId },
        {
          $set: {
            sentAt: now,
            resolution,
            resolvedAt: now,
          },
        },
      ).catch((err) => console.warn("[emailAction] Failed to update ProcessedEmail:", err.message));
    }

    publishUserEvent(req.user.id, {
      type: "emailAction.changed",
      threadId: action.threadId || action._id,
      at: Date.now(),
    });
    publishUserEvent(req.user.id, {
      type: "analytics.changed",
      at: Date.now(),
    });

    return res.json({
      message: "Email sent successfully",
      action,
    });
  } catch (error) {
    console.error("Send draft error:", error.message);

    return res.status(500).json({
      message: "Could not send the draft",
    });
  }
};

router.post("/:id/send", auth, handleSendDraft);

export const handleManualSend = async (req, res) => {
  try {
    const { body, to, cc, bcc, subject } = req.body;
    if (!body || !String(body).trim()) {
      return res.status(400).json({ message: "Reply body is required" });
    }

    const action = await EmailAction.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!action) {
      return res.status(404).json({ message: "Record not found" });
    }

    const user = await User.findById(req.user.id);
    if (!user || !user.refreshToken) {
      return res.status(401).json({ message: "Gmail connection is unavailable" });
    }

    const turns = action.turns || [];
    const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;

    const turnGmailThreadId =
      latestTurn?.gmailThreadId || action.threadId || action.sourceMessageId;
    const inReplyTo =
      latestTurn?.rfcMessageId || latestTurn?.inReplyToHeader || "";
    const references =
      latestTurn?.referencesHeader || inReplyTo || "";

    const rawTo = to || latestTurn?.from || action.to;
    const recipientTo = parseRecipientList(rawTo);
    if (recipientTo.length === 0) {
      return res.status(400).json({ message: "Recipient email is required" });
    }
    for (const r of recipientTo) {
      if (!isValidEmail(r.email)) {
        return res.status(400).json({ message: `Invalid recipient address: ${r.email}` });
      }
    }

    const recipientCc = cc !== undefined ? parseRecipientList(cc) : [];
    for (const r of recipientCc) {
      if (!isValidEmail(r.email)) {
        return res.status(400).json({ message: `Invalid CC address: ${r.email}` });
      }
    }

    const recipientBcc = bcc !== undefined ? parseRecipientList(bcc) : [];
    for (const r of recipientBcc) {
      if (!isValidEmail(r.email)) {
        return res.status(400).json({ message: `Invalid BCC address: ${r.email}` });
      }
    }

    let replySubject =
      subject || latestTurn?.incomingSubject || action.subject || "";

    if (!replySubject.toLowerCase().startsWith("re:")) {
      replySubject = `Re: ${replySubject.replace(/^re:\s*/i, "")}`.trim();
    }

    const raw = buildMimeMessage({
      to: recipientTo,
      cc: recipientCc,
      bcc: recipientBcc,
      subject: replySubject,
      body: String(body).trim(),
      inReplyTo,
      references,
      isReply: true,
      userEmail: user.email
    });

    const sent = await withGmail(
      user,
      async (gmail) => {
        return await gmail.users.messages.send({
          userId: "me",
          requestBody: {
            raw,
            threadId: turnGmailThreadId
          }
        });
      },
      user
    );

    const sentMessageId = sent.data?.id || "";
    const now = new Date();

    let sentRfcMessageId = null;
    if (sentMessageId) {
      try {
        const meta = await withGmail(
          user,
          async (gmail) => {
            return await gmail.users.messages.get({
              userId: "me",
              id: sentMessageId,
              format: "metadata",
              metadataHeaders: ["Message-ID", "Message-Id"]
            });
          },
          user
        );
        sentRfcMessageId =
          getHeader(meta?.data, "Message-ID") ||
          getHeader(meta?.data, "Message-Id") ||
          null;
      } catch (metaErr) {
        console.warn("[manual-send] Could not fetch sent RFC Message-ID:", metaErr.message);
      }
    }

    if (latestTurn) {
      latestTurn.outcome = "sent";
      latestTurn.failureReason = null;
      latestTurn.outgoing = {
        kind: "reply",
        to: recipientTo,
        cc: recipientCc,
        bcc: recipientBcc,
        subject: replySubject,
        body: String(body).trim(),
        bodyHtml: "",
        status: "sent",
        gmailDraftId: null,
        gmailMessageId: sentMessageId,
        rfcMessageId: sentRfcMessageId,
        sentAt: now,
        composedManually: true,
        inReplyTo,
        references
      };
    }

    action.type = "reply";
    action.status = "sent";
    action.sentAt = now;
    action.gmailMessageId = sentMessageId;
    action.checked = true;
    action.checkedAt = now;
    await action.save();

    const targetMessageId = latestTurn?.incomingMessageId || action.sourceMessageId;
    if (targetMessageId) {
      const isAiAssisted = req.body?.isAiAssisted || latestTurn?.outgoing?.generation?.mode === "user_assisted";
      await ProcessedEmail.findOneAndUpdate(
        { userId: String(req.user.id), messageId: targetMessageId },
        {
          $set: {
            status: "done",
            outcome: "sent",
            sentAt: now,
            resolvedAt: now,
            resolution: isAiAssisted ? "ai_assisted" : "manual"
          }
        }
      ).catch((err) => console.warn("[manual-send] Failed to update ProcessedEmail:", err.message));
    }

    publishUserEvent(req.user.id, {
      type: "emailAction.changed",
      threadId: action.threadId || action._id,
      at: Date.now()
    });
    publishUserEvent(req.user.id, {
      type: "analytics.changed",
      at: Date.now()
    });

    return res.json({
      message: "Reply sent successfully",
      action
    });
  } catch (error) {
    console.error("Manual send error:", error.message);
    return res.status(500).json({
      message: error.message || "Could not send manual reply"
    });
  }
};

router.post("/:id/manual-send", auth, handleManualSend);

export const handleTryAiDraft = async (req, res) => {
  try {
    const action = await EmailAction.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!action) {
      return res.status(404).json({ message: "Record not found" });
    }

    const user = await User.findById(req.user.id);
    if (!user || !user.refreshToken) {
      return res.status(401).json({ message: "Gmail connection is unavailable" });
    }

    const turns = action.turns || [];
    const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;

    const from = latestTurn?.from || action.to || "";
    const subject = latestTurn?.incomingSubject || action.subject || "";
    const bodyText =
      latestTurn?.incomingSummary ||
      latestTurn?.incomingSnippet ||
      action.summary ||
      action.subject ||
      "";
    const turnGmailThreadId =
      latestTurn?.gmailThreadId || action.threadId || action.sourceMessageId;
    const inReplyTo =
      latestTurn?.rfcMessageId || latestTurn?.inReplyToHeader || "";
    const references =
      latestTurn?.referencesHeader || inReplyTo || "";

    const aiResult = await generateEmailAnalysis({
      userId: req.user.id,
      labels: user.labels?.filter((l) => l.enabled !== false) || [],
      from,
      subject,
      bodyText,
      snippet: latestTurn?.incomingSnippet || "",
      userProfileDescription: user.description || "",
      userProfileName: user.name || "",
      personas: user.personas || [],
      previousTurns: turns.slice(0, -1),
      bypassRetrievalGate: true
    });

    let draftSubject = subject || "";
    if (!draftSubject.toLowerCase().startsWith("re:")) {
      draftSubject = `Re: ${draftSubject.replace(/^re:\s*/i, "")}`.trim();
    }

    const raw = buildMimeMessage({
      to: from,
      subject: draftSubject,
      body: aiResult.body || "Thank you for reaching out. We have received your message and will follow up shortly.",
      inReplyTo,
      references,
      isReply: true
    });

    const draft = await withGmail(
      user,
      async (gmail) => {
        return await gmail.users.drafts.create({
          userId: "me",
          requestBody: {
            message: {
              raw,
              threadId: turnGmailThreadId
            }
          }
        });
      },
      user
    );

    const draftId = draft.data?.id || "";
    const messageId = draft.data?.message?.id || "";

    if (latestTurn) {
      latestTurn.outcome = "drafted";
      latestTurn.failureReason = null;
      latestTurn.outgoing = {
        kind: "draft",
        body: aiResult.body,
        bodyHtml: "",
        status: "draft",
        gmailDraftId: draftId,
        gmailMessageId: messageId,
        sentAt: null,
        composedManually: false,
        ungrounded: true,
        inReplyTo,
        references
      };
    }

    action.type = "draft";
    action.status = "draft";
    action.body = aiResult.body;
    action.gmailDraftId = draftId;
    await action.save();

    const targetMessageId = latestTurn?.incomingMessageId || action.sourceMessageId;
    if (targetMessageId) {
      await ProcessedEmail.findOneAndUpdate(
        { userId: String(req.user.id), messageId: targetMessageId },
        {
          $set: {
            status: "done",
            outcome: "drafted"
          }
        }
      ).catch((err) => console.warn("[try-ai-draft] Failed to update ProcessedEmail:", err.message));
    }

    publishUserEvent(req.user.id, {
      type: "emailAction.changed",
      threadId: action.threadId || action._id,
      at: Date.now()
    });
    publishUserEvent(req.user.id, {
      type: "analytics.changed",
      at: Date.now()
    });

    return res.json({
      message: "Draft generated with retrieval gate bypassed",
      action,
      ungrounded: true,
      warning: "Draft created without document grounding. Review carefully before sending."
    });
  } catch (error) {
    console.error("Try AI draft error:", error.message);
    return res.status(500).json({
      message: error.message || "Could not generate AI draft"
    });
  }
};

router.post("/:id/try-ai-draft", auth, handleTryAiDraft);

export const activeAssistRequests = new Set();

export const handleAiAssist = async (req, res) => {
  const { id } = req.params;
  const {
    turnId,
    mode,
    instruction = "",
    useKnowledge = true,
    currentBody = "",
    versionId
  } = req.body || {};

  // Validate mode
  if (!mode || (mode !== "compose" && mode !== "revise")) {
    return res.status(400).json({ message: "Mode must be 'compose' or 'revise'" });
  }

  // Validate instruction
  if (typeof instruction !== "string" || instruction.length > 1000) {
    return res.status(400).json({ message: "Instruction must be a string of at most 1000 characters" });
  }
  if (mode === "revise" && !instruction.trim()) {
    return res.status(400).json({ message: "Instruction is required for revise mode" });
  }

  // Validate currentBody
  if (typeof currentBody !== "string" || currentBody.length > 20000) {
    return res.status(400).json({ message: "Current body must be a string of at most 20000 characters" });
  }
  if (mode === "revise" && !currentBody.trim()) {
    return res.status(400).json({ message: "Current body is required for revise mode" });
  }

  const action = await EmailAction.findOne({ _id: id, userId: req.user.id });
  if (!action) {
    return res.status(404).json({ message: "Record not found" });
  }

  const turns = action.turns || [];
  if (turns.length === 0) {
    return res.status(409).json({ code: "stale_turn", message: "Turn is stale or no turns exist in this thread" });
  }

  const latestTurn = turns[turns.length - 1];
  const latestTurnId = String(latestTurn.turnId || latestTurn._id || latestTurn.incomingMessageId || turns.length - 1);

  if (turnId && String(turnId) !== latestTurnId && String(turnId) !== String(latestTurn.incomingMessageId)) {
    return res.status(409).json({
      code: "stale_turn",
      message: "The turn is stale. A follow-up email has arrived or this turn was superseded."
    });
  }

  // Check if turn was already sent or superseded
  if (
    latestTurn.outgoing?.status === "sent" ||
    latestTurn.outgoing?.status === "sending" ||
    latestTurn.outgoing?.status === "superseded"
  ) {
    return res.status(409).json({
      code: "stale_turn",
      message: "This turn has already been sent or superseded."
    });
  }

  // Check versionId if provided
  if (versionId && latestTurn.outgoing?.versions?.length > 0) {
    const latestVersion = latestTurn.outgoing.versions[latestTurn.outgoing.versions.length - 1];
    if (latestVersion && latestVersion.versionId && latestVersion.versionId !== versionId) {
      return res.status(409).json({
        code: "stale_turn",
        message: "Draft version changed. Please refresh before revising."
      });
    }
  }

  // Validate mode matching turn
  const isDraftTurn = latestTurn.outgoing?.kind === "draft" || latestTurn.outcome === "drafted";
  if (mode === "compose" && isDraftTurn) {
    return res.status(400).json({ message: "Turn is an existing draft. Use revise mode to edit." });
  }
  if (mode === "revise" && !isDraftTurn) {
    return res.status(400).json({ message: "Turn is not an existing draft. Use compose mode to draft." });
  }

  // Concurrency guard: only one assist request per turn at a time
  const requestKey = `${action._id}:${latestTurnId}`;
  if (activeAssistRequests.has(requestKey)) {
    return res.status(429).json({
      message: "An AI assist request is already in progress for this turn. Please wait or cancel it."
    });
  }

  activeAssistRequests.add(requestKey);

  const abortController = new AbortController();
  const handleClientClose = () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  };
  req.on?.("close", handleClientClose);

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const result = await generateAiAssist({
      user,
      action,
      turn: latestTurn,
      mode,
      instruction: instruction.trim(),
      useKnowledge: Boolean(useKnowledge),
      currentBody,
      signal: abortController.signal
    });

    if (result.status === "no_knowledge") {
      return res.json({
        status: "no_knowledge",
        notices: result.notices || [],
        bestDistance: result.bestDistance ?? null,
        chunkCount: 0,
        usedKnowledge: true,
        message: "No matching knowledge found in attached documents under distance threshold."
      });
    }

    return res.json({
      body: result.body,
      usedKnowledge: result.usedKnowledge,
      sources: result.sources || [],
      chunkCount: result.chunkCount || 0,
      bestDistance: result.bestDistance ?? null,
      ungrounded: Boolean(result.ungrounded),
      notices: result.notices || [],
      versionId: result.versionId,
      framing: result.framing
    });
  } catch (error) {
    if (abortController.signal.aborted || error.name === "AbortError") {
      if (!res.writableEnded) {
        return res.status(499).json({ message: "Request was cancelled by client" });
      }
      return;
    }
    if (error.code === "invalid_output" || error.status === 422) {
      return res.status(422).json({
        code: "invalid_output",
        message: error.message || "Generated text failed output validation",
        currentDraftUnchanged: true
      });
    }
    if (error.code === "ai_unavailable" || error.status === 503) {
      return res.status(503).json({
        code: "ai_unavailable",
        message: "Local AI engine (Ollama) is unavailable or timed out. Please check that Ollama is running and retry.",
        retryHint: "Ensure `ollama serve` is running with the required model."
      });
    }
    console.error("AI Assist error:", error);
    return res.status(500).json({
      message: error.message || "Failed to generate AI assist result"
    });
  } finally {
    req.off?.("close", handleClientClose);
    activeAssistRequests.delete(requestKey);
  }
};

router.post("/:id/ai-assist", auth, handleAiAssist);

router.patch("/:id/check", auth, async (req, res) => {
  const checked = req.body.checked !== false;

  const action = await EmailAction.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    {
      checked,
      checkedAt: checked ? new Date() : null,
    },
    { returnDocument: "after" },
  );

  if (!action) {
    return res.status(404).json({ message: "Email action not found" });
  }

  publishUserEvent(req.user.id, {
    type: "emailAction.changed",
    threadId: action.threadId || action._id,
    at: Date.now(),
  });
  publishUserEvent(req.user.id, {
    type: "analytics.changed",
    at: Date.now(),
  });

  res.json(action);
});

// Update a draft in Gmail and synchronize its MongoDB record.
/**
 * Helper to synchronize a draft turn to Gmail.
 * Handles update, 404 sent check, missing recreation, and precise error reasons.
 */
export const syncDraftToGmail = async ({
  user,
  action,
  turn,
  parsedTo,
  targetCc,
  targetBcc,
  subject,
  body,
}) => {
  const turnGmailThreadId = turn?.gmailThreadId || action.threadId;
  let draftId = turn?.outgoing?.gmailDraftId || action.gmailDraftId;
  const isFailedOrNeedsManual =
    turn &&
    (turn.outcome === "failed" ||
      turn.outcome === "needs_manual" ||
      !turn.outgoing?.gmailDraftId);

  try {
    const syncRes = await withGmail(
      user,
      async (gmail) => {
        const inReplyTo = turn?.rfcMessageId || turn?.inReplyToHeader;
        const references =
          [turn?.referencesHeader, turn?.rfcMessageId].filter(Boolean).join(" ") || undefined;
        const raw = buildMimeMessage({
          to: parsedTo,
          cc: targetCc,
          bcc: targetBcc,
          subject: subject.trim(),
          body,
          inReplyTo,
          references,
          isReply: true,
          userEmail: user.email,
        });

        if (isFailedOrNeedsManual && !draftId) {
          const createRes = await gmail.users.drafts.create({
            userId: "me",
            requestBody: {
              message: {
                raw,
                threadId: turnGmailThreadId,
              },
            },
          });
          return { draft: createRes.data, created: true };
        } else {
          const updateRes = await gmail.users.drafts.update({
            userId: "me",
            id: draftId,
            requestBody: {
              message: {
                raw,
                ...(turnGmailThreadId ? { threadId: turnGmailThreadId } : {}),
              },
            },
          });
          return { draft: updateRes.data, updated: true };
        }
      },
      user
    );

    const updatedData = syncRes.draft || {};
    const newDraftId = updatedData.id || draftId;
    if (turn.outgoing) {
      turn.outgoing.gmailDraftId = newDraftId;
      if (updatedData.message?.id) {
        turn.outgoing.gmailMessageId = updatedData.message.id;
      }
      turn.outgoing.gmailSync = { state: "synced", reason: null, at: new Date() };
    }
    action.gmailDraftId = newDraftId;
    if (updatedData.message?.id) {
      action.gmailMessageId = updatedData.message.id;
    }
    await action.save();

    return {
      success: true,
      message: syncRes.created
        ? "Gmail draft created successfully"
        : "Draft updated and synced with Gmail",
      draftId: newDraftId,
      recreated: Boolean(syncRes.created),
    };
  } catch (error) {
    const status = error.status || error.response?.status;
    const isNotFound =
      status === 404 ||
      error.message?.includes("404") ||
      error.message?.includes("Not Found");

    if (isNotFound) {
      // 404: Draft not found in Gmail. Check thread for a SENT message after draft creation
      try {
        const threadCheck = await withGmail(
          user,
          async (gmail) => {
            return await gmail.users.threads.get({
              userId: "me",
              id: turnGmailThreadId,
              format: "metadata",
              metadataHeaders: ["Date", "From", "Subject", "Message-ID"],
            });
          },
          user
        );

        const draftCreationTime = turn?.outgoing?.createdAt
          ? new Date(turn.outgoing.createdAt).getTime()
          : (turn?.receivedAt ? new Date(turn.receivedAt).getTime() : new Date(action.createdAt).getTime());

        const sentMsg = (threadCheck.data?.messages || []).find((m) => {
          const labels = m.labelIds || [];
          const msgDate = Number(m.internalDate || 0);
          return labels.includes("SENT") && msgDate > draftCreationTime;
        });

        if (sentMsg) {
          const sentDate = new Date(Number(sentMsg.internalDate));
          if (turn.outgoing) {
            turn.outgoing.status = "sent";
            turn.outgoing.sentAt = sentDate;
            turn.outgoing.sentFrom = "gmail";
            turn.outgoing.gmailMessageId = sentMsg.id;
            turn.outgoing.gmailSync = { state: "synced", reason: null, at: new Date() };
          }
          turn.outcome = "sent";
          action.status = "sent";
          action.sentAt = sentDate;
          action.gmailMessageId = sentMsg.id;
          await action.save();

          const targetMsgId = turn.incomingMessageId || action.sourceMessageId;
          if (targetMsgId) {
            await ProcessedEmail.findOneAndUpdate(
              { userId: String(user._id || user.id), messageId: targetMsgId },
              { $set: { sentAt: sentDate, resolvedAt: sentDate, resolution: "ai_draft_sent" } }
            ).catch(() => null);
          }

          return {
            success: true,
            alreadySent: true,
            message: "This draft was already sent from Gmail",
          };
        } else {
          // Recreate the missing draft in turn's thread
          const recreateRes = await withGmail(
            user,
            async (gmail) => {
              const inReplyTo = turn?.rfcMessageId || turn?.inReplyToHeader;
              const references =
                [turn?.referencesHeader, turn?.rfcMessageId].filter(Boolean).join(" ") || undefined;
              const raw = buildMimeMessage({
                to: parsedTo,
                cc: targetCc,
                bcc: targetBcc,
                subject: subject.trim(),
                body,
                inReplyTo,
                references,
                isReply: true,
                userEmail: user.email,
              });

              return await gmail.users.drafts.create({
                userId: "me",
                requestBody: {
                  message: {
                    raw,
                    threadId: turnGmailThreadId,
                  },
                },
              });
            },
            user
          );

          const recreatedDraft = recreateRes.data || {};
          const recreatedDraftId = recreatedDraft.id;
          if (turn.outgoing) {
            turn.outgoing.gmailDraftId = recreatedDraftId;
            if (recreatedDraft.message?.id) {
              turn.outgoing.gmailMessageId = recreatedDraft.message.id;
            }
            turn.outgoing.gmailSync = { state: "synced", reason: null, at: new Date() };
          }
          action.gmailDraftId = recreatedDraftId;
          if (recreatedDraft.message?.id) {
            action.gmailMessageId = recreatedDraft.message.id;
          }
          await action.save();

          return {
            success: true,
            recreated: true,
            message: "The Gmail draft was missing and has been recreated",
            draftId: recreatedDraftId,
          };
        }
      } catch (recreateErr) {
        console.error("[syncDraftToGmail] Recreate draft error on 404:", recreateErr.message);
      }
    }

    // Precise reason mapping
    let reason = "";
    if (isInvalidGrantError(error) || status === 401) {
      reason = "Gmail authentication expired. Please reconnect your account.";
    } else if (isTransientError(error)) {
      reason = "Network connection error. Gmail could not be reached.";
    } else if (status === 400) {
      reason = error.message || "Invalid draft content or headers.";
    } else {
      reason = error.message || "Could not update Gmail draft.";
    }

    if (turn.outgoing) {
      turn.outgoing.gmailSync = { state: "failed", reason, at: new Date() };
    }
    await action.save();

    return {
      success: false,
      reason,
      message: "Draft saved in app. Gmail not updated: " + reason,
    };
  }
};

// Update a draft in MongoDB first, then synchronize with Gmail.
export const handleUpdateDraft = async (req, res) => {
  try {
    const { to, cc, bcc, subject, body, baseVersionId, forceOverwrite, generation, version } = req.body;

    if (
      to === undefined ||
      subject === undefined ||
      body === undefined ||
      typeof subject !== "string" ||
      typeof body !== "string"
    ) {
      return res.status(400).json({
        message: "Recipient, subject, and body are required",
      });
    }

    const parsedTo = parseRecipientList(to);
    if (parsedTo.length === 0) {
      return res.status(400).json({
        message: "Recipient email is required",
      });
    }
    for (const r of parsedTo) {
      if (!isValidEmail(r.email)) {
        return res.status(400).json({
          message: `Invalid recipient email address: ${r.email}`,
        });
      }
    }

    const parsedCc = cc !== undefined ? parseRecipientList(cc) : undefined;
    if (parsedCc) {
      for (const r of parsedCc) {
        if (!isValidEmail(r.email)) {
          return res.status(400).json({
            message: `Invalid CC email address: ${r.email}`,
          });
        }
      }
    }

    const parsedBcc = bcc !== undefined ? parseRecipientList(bcc) : undefined;
    if (parsedBcc) {
      for (const r of parsedBcc) {
        if (!isValidEmail(r.email)) {
          return res.status(400).json({
            message: `Invalid BCC email address: ${r.email}`,
          });
        }
      }
    }

    const formattedTo = formatRecipientList(parsedTo);
    if (
      formattedTo.length > 2000 ||
      subject.length > 998 ||
      body.length > 100000
    ) {
      return res.status(400).json({
        message: "Draft content exceeds the allowed size",
      });
    }

    const action = await EmailAction.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!action) {
      return res.status(404).json({
        message: "Draft not found",
      });
    }

    // Determine the latest turn containing a draft or failed/needs_manual turn
    const turns = action.turns || [];
    const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;
    let draftTurn = null;
    if (latestTurn && latestTurn.outgoing && latestTurn.outgoing.kind === "draft") {
      draftTurn = latestTurn;
    }

    const isFailedOrNeedsManual =
      latestTurn &&
      (latestTurn.outcome === "failed" ||
        latestTurn.outcome === "needs_manual" ||
        !latestTurn.outgoing?.gmailDraftId);

    const isDraft = action.type === "draft" || Boolean(draftTurn);
    if (!isDraft && !isFailedOrNeedsManual) {
      return res.status(400).json({
        message: "Only drafts or items needing manual reply can be edited",
      });
    }

    const currentStatus = draftTurn ? draftTurn.outgoing.status : action.status;
    if (draftTurn && currentStatus !== "draft") {
      return res.status(409).json({
        message: "Only unsent drafts can be edited",
      });
    }

    // Optimistic Concurrency Check:
    const currentVersionId =
      latestTurn?.versionId ||
      latestTurn?.outgoing?.versions?.slice(-1)[0]?.versionId;
    if (
      baseVersionId &&
      !forceOverwrite &&
      currentVersionId &&
      baseVersionId !== currentVersionId
    ) {
      return res.status(409).json({
        conflict: true,
        code: "conflict",
        message: "This draft changed elsewhere (Gmail or another tab)",
        currentBody: latestTurn?.outgoing?.body || action.body || "",
        currentVersionId,
      });
    }

    const user = await User.findById(req.user.id);
    if (!user || !user.refreshToken) {
      return res.status(401).json({
        message: "Gmail connection is unavailable",
      });
    }

    const targetCc = parsedCc !== undefined ? parsedCc : (draftTurn?.outgoing?.cc || latestTurn?.outgoing?.cc || []);
    const targetBcc = parsedBcc !== undefined ? parsedBcc : (draftTurn?.outgoing?.bcc || latestTurn?.outgoing?.bcc || []);
    const prevBody = latestTurn?.outgoing?.body;

    // 1. SAVE FIRST (MongoDB writes immediately so user text is never lost)
    const newVersionId = new mongoose.Types.ObjectId().toString();

    if (latestTurn) {
      latestTurn.versionId = newVersionId;
      latestTurn.outcome = "drafted";
      latestTurn.failureReason = null;
      if (!latestTurn.outgoing) {
        latestTurn.outgoing = {
          kind: "draft",
          status: "draft",
        };
      }
      latestTurn.outgoing.kind = "draft";
      latestTurn.outgoing.status = "draft";
      latestTurn.outgoing.to = parsedTo;
      if (targetCc !== undefined) latestTurn.outgoing.cc = targetCc;
      if (targetBcc !== undefined) latestTurn.outgoing.bcc = targetBcc;
      latestTurn.outgoing.subject = subject.trim();
      latestTurn.outgoing.body = body;
      latestTurn.from = formattedTo;
      latestTurn.incomingSubject = subject.trim();
      latestTurn.outgoing.gmailSync = { state: "pending", reason: null, at: new Date() };

      // Store generation metadata if provided
      if (generation) {
        latestTurn.outgoing.generation = {
          mode: generation.mode || "user_assisted",
          model: generation.model || LLM_MODEL,
          instruction: generation.instruction || "",
          useKnowledge: Boolean(generation.useKnowledge),
          ungrounded: Boolean(generation.ungrounded),
          sources: generation.sources || [],
          framing: generation.framing || null,
          at: new Date(),
        };
      }

      // Manage versions[] (max 10) - deduplicate if body equals latest version
      if (!Array.isArray(latestTurn.outgoing.versions)) {
        latestTurn.outgoing.versions = [];
      }
      const latestVer = latestTurn.outgoing.versions.slice(-1)[0];
      if (!latestVer || latestVer.body !== body) {
        const verSource =
          version?.source ||
          (version?.versionId ? "ai_revision" : (prevBody ? "manual_edit" : "ai_initial"));
        latestTurn.outgoing.versions.push({
          versionId: version?.versionId || newVersionId,
          body,
          at: new Date(),
          source: verSource,
          instruction: version?.instruction || generation?.instruction || "",
          useKnowledge: Boolean(version?.useKnowledge ?? generation?.useKnowledge),
        });
        if (latestTurn.outgoing.versions.length > 10) {
          latestTurn.outgoing.versions = latestTurn.outgoing.versions.slice(-10);
        }
      }
    }

    action.type = "draft";
    action.status = "draft";
    action.to = formattedTo;
    if (targetCc !== undefined) action.cc = formatRecipientList(targetCc);
    if (targetBcc !== undefined) action.bcc = formatRecipientList(targetBcc);
    action.subject = subject.trim();
    action.body = body;

    await action.save();

    // 2. SYNC SECOND (update or recreate in Gmail)
    const syncResult = await syncDraftToGmail({
      user,
      action,
      turn: latestTurn,
      parsedTo,
      targetCc,
      targetBcc,
      subject,
      body,
    });

    if (syncResult.recreated) {
      const targetMessageId = latestTurn?.incomingMessageId || action.sourceMessageId;
      if (targetMessageId) {
        await ProcessedEmail.findOneAndUpdate(
          { userId: String(req.user.id), messageId: targetMessageId },
          { $set: { status: "done", outcome: "drafted" } }
        ).catch(() => null);
      }
    }

    publishUserEvent(req.user.id, {
      type: "emailAction.changed",
      threadId: action.threadId || action._id,
      at: Date.now(),
    });
    publishUserEvent(req.user.id, {
      type: "analytics.changed",
      at: Date.now(),
    });

    return res.json({
      message: syncResult.message || "Draft updated successfully",
      action,
      gmailSync: latestTurn?.outgoing?.gmailSync,
      syncWarning: !syncResult.success,
      recreated: Boolean(syncResult.recreated),
      alreadySent: Boolean(syncResult.alreadySent),
    });
  } catch (error) {
    console.error("Update draft error:", error.message);
    return res.status(500).json({
      message: error.message || "Failed to save draft",
    });
  }
};

// Retry Gmail synchronization for a draft turn
export const handleRetryGmailSync = async (req, res) => {
  try {
    const action = await EmailAction.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!action) {
      return res.status(404).json({ message: "Draft not found" });
    }

    const turns = action.turns || [];
    const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;
    if (!latestTurn || !latestTurn.outgoing || latestTurn.outgoing.kind !== "draft") {
      return res.status(400).json({ message: "No active draft found on this item" });
    }

    const user = await User.findById(req.user.id);
    if (!user || !user.refreshToken) {
      return res.status(401).json({ message: "Gmail connection is unavailable" });
    }

    const syncResult = await syncDraftToGmail({
      user,
      action,
      turn: latestTurn,
      parsedTo: latestTurn.outgoing.to,
      targetCc: latestTurn.outgoing.cc || [],
      targetBcc: latestTurn.outgoing.bcc || [],
      subject: latestTurn.outgoing.subject || action.subject || "",
      body: latestTurn.outgoing.body || action.body || "",
    });

    publishUserEvent(req.user.id, {
      type: "emailAction.changed",
      threadId: action.threadId || action._id,
      at: Date.now(),
    });

    return res.json({
      message: syncResult.message,
      action,
      gmailSync: latestTurn.outgoing.gmailSync,
      success: syncResult.success,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to retry Gmail sync" });
  }
};

router.patch("/:id", auth, handleUpdateDraft);
router.post("/:id/retry-gmail-sync", auth, handleRetryGmailSync);

// Delete the Gmail draft and its MongoDB record.
export const handleDeleteDraft = async (req, res) => {
  try {
    const action = await EmailAction.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!action) {
      return res.status(404).json({
        message: "Draft not found",
      });
    }

    // Determine the latest turn containing a draft
    let draftTurn = null;
    if (Array.isArray(action.turns) && action.turns.length > 0) {
      const lastTurn = action.turns[action.turns.length - 1];
      if (lastTurn && lastTurn.outgoing && lastTurn.outgoing.kind === "draft") {
        draftTurn = lastTurn;
      }
    }

    const isDraft = action.type === "draft" || (draftTurn && draftTurn.outgoing?.kind === "draft");
    if (!isDraft) {
      return res.status(400).json({
        message: "Only drafts can be deleted here",
      });
    }

    const currentStatus = draftTurn ? draftTurn.outgoing.status : action.status;
    if (currentStatus !== "draft") {
      return res.status(409).json({
        message: "Only unsent drafts can be deleted",
      });
    }

    const draftId = draftTurn?.outgoing?.gmailDraftId || action.gmailDraftId;
    if (!draftId) {
      return res.status(400).json({
        message: "Gmail draft ID is missing",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user || !user.refreshToken) {
      return res.status(401).json({
        message: "Gmail connection is unavailable",
      });
    }

    const gmail = await getGmail(user);

    // Delete from Gmail before updating the database record.
    try {
      await deleteGmailDraft(gmail, draftId);
    } catch (error) {
      const status = error.status || error.response?.status;
      if (status === 404 || error.message?.includes("404") || error.message?.includes("Not Found")) {
        const recResult = await reconcileTurn(user, action, draftTurn, { gmail }).catch(() => null);
        if (recResult?.status === "sent") {
          return res.status(409).json({
            message: "Draft was already sent in Gmail and cannot be deleted",
            id: action._id,
          });
        }
        return res.json({
          message: "Draft was already deleted in Gmail",
          id: action._id,
        });
      }
      throw error;
    }

    // Mark draft as deleted so it leaves Drafts tab counts but stays visible under All
    if (draftTurn) {
      draftTurn.outgoing.status = "deleted";
    }
    action.status = "reviewed";
    action.type = "reply";
    action.gmailDraftId = null;
    await action.save();

    publishUserEvent(req.user.id, {
      type: "emailAction.changed",
      threadId: action.threadId || action._id,
      at: Date.now(),
    });
    publishUserEvent(req.user.id, {
      type: "analytics.changed",
      at: Date.now(),
    });

    return res.json({
      message: "Draft deleted successfully",
      id: action._id,
    });
  } catch (error) {
    console.error("Delete draft error:", error.message);

    return res.status(502).json({
      message: "Could not delete the Gmail draft",
    });
  }
};

router.delete("/:id", auth, handleDeleteDraft);


export default router;

