// jobs/poll.job.js
import "dotenv/config";
import cron from "node-cron";
import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import EmailAction from "../models/EmailAction.js";
import { getGmail, withGmail } from "../services/gmail.service.js";
import {
  analyzeEmailAI,
  isTransientAIError
} from "../services/aiEngine.js";
import { updateAnalytics } from "../services/analytics.service.js";
import { getHeader, buildMimeMessage } from "../utils/helpers.js";

// Configuration defaults
const CATCHUP_HOURS = Number(process.env.CATCHUP_HOURS) || 48;
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN) || 25;
const DAILY_REPLY_CAP = Number(process.env.DAILY_REPLY_CAP) || 50;

// In-memory per-user lock and cron overlap guard
export const activeUserLocks = new Set();
export let cronInProgress = false;

export const decodeBase64Url = (value = "") =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

export const textFromPayload = (payload) => {
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

/**
 * Auto-reply loop protection rules:
 * 1. Sender address === authenticated user's Gmail address
 * 2. Auto-Submitted header present and not "no"
 * 3. Precedence: bulk | list | junk
 * 4. List-Unsubscribe header present
 * 5. X-Autoreply header present
 * 6. Sender local-part matches noreply|no-reply|mailer-daemon|postmaster|bounce
 */
export const shouldSkipLoopProtection = (email, userEmail) => {
  const from = (getHeader(email, "From") || "").toLowerCase();
  const user = (userEmail || "").toLowerCase();

  // 1. Sender address === user's email
  if (user && from.includes(user)) {
    return { skip: true, reason: "loop_protection:own_address" };
  }

  // 2. Auto-Submitted header present and not "no"
  const autoSubmitted = (getHeader(email, "Auto-Submitted") || "").toLowerCase().trim();
  if (autoSubmitted && autoSubmitted !== "no") {
    return { skip: true, reason: `loop_protection:auto_submitted_${autoSubmitted}` };
  }

  // 3. Precedence: bulk | list | junk
  const precedence = (getHeader(email, "Precedence") || "").toLowerCase().trim();
  if (["bulk", "list", "junk"].includes(precedence)) {
    return { skip: true, reason: `loop_protection:precedence_${precedence}` };
  }

  // 4. List-Unsubscribe header present
  const listUnsubscribe = getHeader(email, "List-Unsubscribe");
  if (listUnsubscribe) {
    return { skip: true, reason: "loop_protection:list_unsubscribe" };
  }

  // 5. X-Autoreply header present
  const xAutoreply = getHeader(email, "X-Autoreply");
  if (xAutoreply) {
    return { skip: true, reason: "loop_protection:x_autoreply" };
  }

  // 6. Sender local-part matches noreply|no-reply|mailer-daemon|postmaster|bounce
  const emailMatch = from.match(/<([^>]+)>/) || [null, from];
  const emailAddr = (emailMatch[1] || from).trim();
  const localPart = emailAddr.split("@")[0] || "";
  if (
    /^(noreply|no-reply|mailer-daemon|postmaster|bounce)$/i.test(localPart) ||
    from.includes("no-reply") ||
    from.includes("noreply") ||
    from.includes("mailer-daemon")
  ) {
    return { skip: true, reason: "loop_protection:bot_or_bounce_sender" };
  }

  return { skip: false };
};

/**
 * Stale-processing recovery (B8):
 * Rows with status:'processing' older than 5 minutes.
 * Checks Gmail threads to see if draft or sent reply already exists.
 */
export const recoverStaleProcessing = async (user, gmailClient = null) => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const staleRows = await ProcessedEmail.find({
    userId: String(user._id),
    status: "processing",
    updatedAt: { $lt: fiveMinutesAgo }
  });

  for (const row of staleRows) {
    try {
      const msgRes = await withGmail(
        gmailClient || user,
        async (gmail) => {
          return await gmail.users.messages.get({
            userId: "me",
            id: row.messageId,
            format: "metadata"
          });
        },
        user
      );

      const threadId = msgRes?.data?.threadId;
      if (threadId) {
        const threadRes = await withGmail(
          gmailClient || user,
          async (gmail) => {
            return await gmail.users.threads.get({
              userId: "me",
              id: threadId
            });
          },
          user
        );

        const threadMessages = threadRes?.data?.messages || [];
        const hasSent = threadMessages.some(m => (m.labelIds || []).includes("SENT"));
        const hasDraft = threadMessages.some(m => (m.labelIds || []).includes("DRAFT"));

        if (hasSent) {
          row.status = "done";
          row.outcome = "sent";
          row.sentAt = row.sentAt || new Date();
          await row.save();
          continue;
        }

        if (hasDraft) {
          row.status = "done";
          row.outcome = "drafted";
          await row.save();
          continue;
        }
      }

      if ((row.attempts || 1) >= 3) {
        row.status = "failed";
        row.outcome = "failed";
        row.failureReason = "stale_recovery_exhausted";
        await row.save();
      } else {
        row.status = "retry";
        row.attempts = (row.attempts || 1) + 1;
        row.nextRetryAt = new Date();
        await row.save();
      }
    } catch (err) {
      console.warn(`[poll] Stale recovery error for message ${row.messageId}:`, err.message);
    }
  }
};

/**
 * Process a single email message with claim-first idempotency.
 */
export const processMessage = async ({ user, gmail = null, messageId, emailData = null }) => {
  const userIdStr = String(user._id);

  // 1. Claim-first idempotency check
  let claimDoc;
  const existing = await ProcessedEmail.findOne({
    userId: userIdStr,
    messageId
  });

  if (existing) {
    if (existing.status === "retry") {
      const now = new Date();
      if (existing.nextRetryAt && existing.nextRetryAt > now) {
        return { processed: false, reason: "retry_not_due" };
      }
      existing.status = "processing";
      existing.attempts = (existing.attempts || 1) + 1;
      await existing.save();
      claimDoc = existing;
    } else {
      return { processed: false, reason: `already_${existing.status}` };
    }
  } else {
    try {
      claimDoc = await ProcessedEmail.create({
        userId: userIdStr,
        messageId,
        status: "processing",
        attempts: 1
      });
    } catch (err) {
      if (err?.code === 11000) {
        return { processed: false, reason: "already_claimed" };
      }
      throw err;
    }
  }

  try {
    // 2. Fetch full email content if not provided
    let email = emailData;
    if (!email || !email.payload) {
      const res = await withGmail(
        gmail || user,
        async (g) => {
          return await g.users.messages.get({
            userId: "me",
            id: messageId,
            format: "full"
          });
        },
        user
      );
      email = res.data;
    }

    const subject = getHeader(email, "Subject");
    const from = getHeader(email, "From");
    const messageHeaderId = getHeader(email, "Message-ID");
    const references = getHeader(email, "References") || messageHeaderId;
    const snippet = email.snippet || "";
    const bodyText = textFromPayload(email.payload) || snippet;
    const threadId = email.threadId;

    // 3. Auto-reply loop protection
    const loopCheck = shouldSkipLoopProtection(email, user.email);
    if (loopCheck.skip) {
      claimDoc.status = "done";
      claimDoc.outcome = "skipped";
      claimDoc.failureReason = loopCheck.reason;
      await claimDoc.save();
      return { processed: false, outcome: "skipped", reason: loopCheck.reason };
    }

    // 4. Enabled labels check
    const enabledLabels = (user.labels || []).filter(l => l.enabled !== false);
    if (enabledLabels.length === 0) {
      claimDoc.status = "done";
      claimDoc.outcome = "none";
      claimDoc.failureReason = "no_enabled_labels";
      await claimDoc.save();
      return { processed: false, outcome: "none", reason: "no_enabled_labels" };
    }

    // 5. Analyze email with local AI
    let aiResult;
    try {
      aiResult = await analyzeEmailAI({
        userId: user._id,
        subject,
        from,
        snippet,
        bodyText,
        userProfileDescription: user.profileDescription,
        labels: enabledLabels,
        personas: user.personas || []
      });
    } catch (aiErr) {
      const isTransient = aiErr?.isTransient || isTransientAIError(aiErr);
      const attempts = claimDoc.attempts || 1;
      if (isTransient && attempts < 3) {
        const backoffMs = Math.pow(2, attempts) * 60 * 1000;
        claimDoc.status = "retry";
        claimDoc.failureReason = aiErr.message || "transient_ai_error";
        claimDoc.nextRetryAt = new Date(Date.now() + backoffMs);
        await claimDoc.save();
        return { processed: false, outcome: "retry", reason: aiErr.message };
      } else {
        claimDoc.status = "failed";
        claimDoc.outcome = "failed";
        claimDoc.failureReason = isTransient ? "ai_unavailable" : (aiErr.message || "ai_permanent_error");
        await claimDoc.save();
        return { processed: false, outcome: "failed", reason: claimDoc.failureReason };
      }
    }

    const { label, action: aiAction, body, summary } = aiResult;

    // 6. Label lookup - must always record a ProcessedEmail
    const labelObj = enabledLabels.find(l => l.name === label);
    if (!labelObj) {
      claimDoc.status = "done";
      claimDoc.outcome = "none";
      claimDoc.label = label || "unknown";
      claimDoc.failureReason = `Label '${label}' not found or disabled`;
      await claimDoc.save();
      return { processed: false, outcome: "none", reason: "label_not_found" };
    }

    // 7. Apply Gmail label
    if (labelObj.id) {
      try {
        await withGmail(
          gmail || user,
          async (g) => {
            await g.users.messages.modify({
              userId: "me",
              id: messageId,
              requestBody: {
                addLabelIds: [labelObj.id]
              }
            });
          },
          user
        );
      } catch (labelErr) {
        console.warn(`[poll] Failed to apply label ${labelObj.id}:`, labelErr.message);
      }
    }

    // 8. Determine action
    const userAction = labelObj.action?.type || "none";
    let finalAction = aiAction === "none" ? "none" : userAction;

    // Check daily reply cap if finalAction is reply
    if (finalAction === "reply") {
      const today = new Date().toDateString();
      const lastReplyDate = user.dailyReplySentDate ? new Date(user.dailyReplySentDate).toDateString() : null;
      const count = (lastReplyDate === today) ? (user.dailyReplySentCount || 0) : 0;
      if (count >= DAILY_REPLY_CAP) {
        console.warn(`[poll] Daily reply cap (${DAILY_REPLY_CAP}) reached for user ${user._id}`);
        finalAction = "none";
      }
    }

    const shouldMarkRead = typeof labelObj.markAsRead === "boolean"
      ? labelObj.markAsRead
      : finalAction !== "draft";

    let gmailMessageId = "";
    let gmailDraftId = "";

    // 9. Reply or Draft
    if (["reply", "draft"].includes(finalAction)) {
      const existingThreadAction = threadId
        ? await EmailAction.findOne({
            userId: userIdStr,
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

      if (finalAction === "reply") {
        const sent = await withGmail(
          gmail || user,
          async (g) => {
            return await g.users.messages.send({
              userId: "me",
              requestBody: {
                raw,
                threadId
              }
            });
          },
          user
        );
        gmailMessageId = sent.data.id;

        // Persist sent state immediately so later DB failures never cause a duplicate send
        claimDoc.outcome = "sent";
        claimDoc.sentAt = new Date();
        await claimDoc.save().catch(() => {});

        // Update daily reply count on user
        const today = new Date().toDateString();
        const lastReplyDate = user.dailyReplySentDate ? new Date(user.dailyReplySentDate).toDateString() : null;
        if (lastReplyDate === today) {
          user.dailyReplySentCount = (user.dailyReplySentCount || 0) + 1;
        } else {
          user.dailyReplySentDate = new Date();
          user.dailyReplySentCount = 1;
        }
        await user.save().catch(() => {});
      }

      if (finalAction === "draft") {
        const draft = await withGmail(
          gmail || user,
          async (g) => {
            return await g.users.drafts.create({
              userId: "me",
              requestBody: {
                message: {
                  raw,
                  threadId
                }
              }
            });
          },
          user
        );
        gmailDraftId = draft.data.id;
        gmailMessageId = draft.data.message?.id || "";
      }

      const cleanSummary = summary || snippet || "Incoming email message.";

      if (existingThreadAction) {
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
          userId: userIdStr,
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

    // 10. Finalize claim document
    claimDoc.status = "done";
    claimDoc.label = label;
    claimDoc.action = finalAction;
    claimDoc.markAsRead = shouldMarkRead;
    if (finalAction === "reply") {
      claimDoc.outcome = "sent";
      claimDoc.sentAt = claimDoc.sentAt || new Date();
    } else if (finalAction === "draft") {
      claimDoc.outcome = "drafted";
    } else {
      claimDoc.outcome = labelObj ? "labeled" : "none";
    }
    await claimDoc.save();

    await updateAnalytics({
      userId: user._id,
      label,
      action: finalAction
    }).catch(err => console.warn("[poll] Analytics update error:", err.message));

    // 11. Mark as read in Gmail if required
    if (shouldMarkRead) {
      await withGmail(
        gmail || user,
        async (g) => {
          await g.users.messages.modify({
            userId: "me",
            id: messageId,
            requestBody: {
              removeLabelIds: ["UNREAD"]
            }
          });
        },
        user
      ).catch(err => console.warn(`[poll] Mark read error for ${messageId}:`, err.message));
    }

    return { processed: true, outcome: claimDoc.outcome };
  } catch (err) {
    console.error(`[poll] Unexpected error processing message ${messageId}:`, err.message);
    if (claimDoc && claimDoc.status === "processing") {
      claimDoc.status = "failed";
      claimDoc.outcome = "failed";
      claimDoc.failureReason = err.message || "processing_error";
      await claimDoc.save().catch(() => {});
    }
    return { processed: false, reason: err.message };
  }
};

/**
 * Synchronize email messages for a single user.
 */
export const syncUser = async (user, options = {}) => {
  const userIdStr = String(user._id);
  if (activeUserLocks.has(userIdStr)) {
    console.log(`[poll] User ${userIdStr} is already syncing, skipping lock.`);
    return { skipped: true, reason: "lock_active" };
  }

  activeUserLocks.add(userIdStr);

  try {
    user.syncStatus = "running";
    user.syncError = null;
    await user.save();

    const gmail = options.gmailClient || (await getGmail(user));

    // Recover any stale processing rows older than 5 minutes
    await recoverStaleProcessing(user, gmail);

    let targetHistoryId = null;
    let messageItems = [];
    let isBootstrap = !user.gmailHistoryId;

    if (!isBootstrap) {
      try {
        let pageToken;
        let histId = user.gmailHistoryId;
        const seenMsgIds = new Set();

        do {
          const historyRes = await withGmail(
            gmail,
            async (g) => {
              return await g.users.history.list({
                userId: "me",
                startHistoryId: user.gmailHistoryId,
                historyTypes: ["messageAdded"],
                pageToken
              });
            },
            user
          );

          if (historyRes.data.historyId) {
            histId = historyRes.data.historyId;
          }

          for (const record of historyRes.data.history || []) {
            for (const item of record.messagesAdded || []) {
              if (item.message?.id) {
                seenMsgIds.add(item.message.id);
              }
            }
          }
          pageToken = historyRes.data.nextPageToken;
        } while (pageToken);

        targetHistoryId = histId;

        for (const id of seenMsgIds) {
          try {
            const meta = await withGmail(
              gmail,
              async (g) => {
                return await g.users.messages.get({
                  userId: "me",
                  id,
                  format: "metadata",
                  metadataHeaders: ["Date", "From", "Subject"]
                });
              },
              user
            );
            messageItems.push({
              id,
              internalDate: Number(meta.data.internalDate || 0),
              labelIds: meta.data.labelIds || []
            });
          } catch (mErr) {
            console.warn(`[poll] Failed to get metadata for msg ${id}:`, mErr.message);
          }
        }
      } catch (err) {
        const status = err?.status || err?.response?.status;
        if (
          status === 404 ||
          err?.message?.includes("historyId") ||
          err?.message?.includes("404")
        ) {
          console.log(`[poll] HistoryId ${user.gmailHistoryId} expired (404), falling back to bootstrap.`);
          isBootstrap = true;
          messageItems = [];
        } else {
          throw err;
        }
      }
    }

    if (isBootstrap) {
      // Bootstrap: 1. Read users.getProfile historyId FIRST
      const profile = await withGmail(
        gmail,
        async (g) => {
          return await g.users.getProfile({ userId: "me" });
        },
        user
      );
      targetHistoryId = profile.data.historyId;

      // Bootstrap: 2. Query messages.list: in:inbox category:primary after:<epochSeconds>
      const catchupHours = options.catchupHours || CATCHUP_HOURS;
      const epochSeconds = Math.floor(Date.now() / 1000) - catchupHours * 3600;
      const q = `in:inbox category:primary after:${epochSeconds}`;

      let pageToken;
      const msgList = [];
      do {
        const listRes = await withGmail(
          gmail,
          async (g) => {
            return await g.users.messages.list({
              userId: "me",
              q,
              pageToken,
              maxResults: 100
            });
          },
          user
        );

        if (listRes.data.messages?.length) {
          msgList.push(...listRes.data.messages);
        }
        pageToken = listRes.data.nextPageToken;
      } while (pageToken);

      for (const m of msgList) {
        try {
          const meta = await withGmail(
            gmail,
            async (g) => {
              return await g.users.messages.get({
                userId: "me",
                id: m.id,
                format: "metadata",
                metadataHeaders: ["Date", "From", "Subject"]
              });
            },
            user
          );
          messageItems.push({
            id: m.id,
            internalDate: Number(meta.data.internalDate || 0),
            labelIds: meta.data.labelIds || []
          });
        } catch (mErr) {
          messageItems.push({ id: m.id, internalDate: 0, labelIds: [] });
        }
      }
    }

    // Include any pending retries
    const pendingRetries = await ProcessedEmail.find({
      userId: userIdStr,
      status: "retry",
      nextRetryAt: { $lte: new Date() }
    });
    for (const r of pendingRetries) {
      if (!messageItems.some(item => item.id === r.messageId)) {
        messageItems.push({ id: r.messageId, internalDate: 0, labelIds: [] });
      }
    }

    // Filter out messages with SENT or DRAFT labels
    messageItems = messageItems.filter(item => {
      const labels = item.labelIds || [];
      return !labels.includes("SENT") && !labels.includes("DRAFT");
    });

    // Filter out already finished messages from ProcessedEmail
    const candidateIds = messageItems.map(m => m.id);
    if (candidateIds.length > 0) {
      const finishedDocs = await ProcessedEmail.find({
        userId: userIdStr,
        messageId: { $in: candidateIds },
        status: { $in: ["done", "failed", "skipped"] }
      }).select("messageId");
      const finishedSet = new Set(finishedDocs.map(d => d.messageId));
      messageItems = messageItems.filter(m => !finishedSet.has(m.id));
    }

    // Sort oldest first (internalDate ASCENDING)
    messageItems.sort((a, b) => a.internalDate - b.internalDate);

    // Limit to MAX_PER_RUN (default 25)
    const maxPerRun = options.maxPerRun || MAX_PER_RUN;
    const batch = messageItems.slice(0, maxPerRun);

    // Process all messages in the batch (no break after first)
    let processedCount = 0;
    for (const item of batch) {
      const res = await processMessage({ user, gmail, messageId: item.id });
      if (res?.processed) processedCount++;
    }

    // Advance gmailHistoryId ONLY after the batch finishes
    if (targetHistoryId) {
      user.gmailHistoryId = String(targetHistoryId);
    }
    user.lastSyncAt = new Date();
    user.syncStatus = "idle";
    user.syncError = null;
    await user.save();

    return { success: true, processedCount, totalFound: messageItems.length };
  } catch (err) {
    user.syncStatus = "error";
    user.syncError = err.message;
    await user.save().catch(() => {});
    throw err;
  } finally {
    activeUserLocks.delete(userIdStr);
  }
};

/**
 * Poll all active users. Wraps each user in try/catch so one user's failure
 * never blocks others.
 */
export const pollAllUsers = async (options = {}) => {
  if (cronInProgress) {
    console.log("[poll] Cron tick skipped: previous poll run still in progress.");
    return;
  }

  cronInProgress = true;
  try {
    const users = await User.find({
      refreshToken: { $exists: true, $ne: null },
      needsRelogin: { $ne: true }
    });

    for (const user of users) {
      if (!user.labels?.some(l => l.enabled !== false)) continue;
      try {
        await syncUser(user, options);
      } catch (err) {
        console.error(`[poll] User ${user._id} sync failed:`, err.message);
      }
    }
  } catch (err) {
    console.error("[poll] Global polling error:", err.message);
  } finally {
    cronInProgress = false;
  }
};

export const startPolling = () => {
  cron.schedule("* * * * *", async () => {
    await pollAllUsers();
  });
};
