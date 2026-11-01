// jobs/poll.job.js
import "dotenv/config";
import cron from "node-cron";
import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import EmailAction from "../models/EmailAction.js";
import { getGmail, withGmail, deleteGmailDraft } from "../services/gmail.service.js";
import {
  analyzeEmailAI,
  isTransientAIError
} from "../services/aiEngine.js";
import { updateAnalytics } from "../services/analytics.service.js";
import { getHeader, buildMimeMessage, stripQuotedAndHtml } from "../utils/helpers.js";

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
 * 7. Daily reply cap reached (DAILY_REPLY_CAP, default 50, reset by date in dailyReplySentDate)
 */
export const shouldSkipLoopProtection = (email, userOrEmail, options = {}) => {
  const userObj = typeof userOrEmail === "object" && userOrEmail !== null ? userOrEmail : null;
  const userEmail = (userObj ? userObj.email : userOrEmail) || "";

  const from = (getHeader(email, "From") || "").trim();
  const fromLower = from.toLowerCase();
  const userLower = (userEmail || "").trim().toLowerCase();

  // 1. Sender address === user's own email address
  if (userLower) {
    const fromAddrMatch = from.match(/<([^>]+)>/);
    const fromAddr = (fromAddrMatch ? fromAddrMatch[1] : from).trim().toLowerCase();
    if (fromAddr === userLower || fromLower.includes(userLower)) {
      return { skip: true, reason: "loop_protection:own_address" };
    }
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
  const localPart = (emailAddr.split("@")[0] || "").toLowerCase().trim();
  if (
    /^(noreply|no-reply|mailer-daemon|postmaster|bounce)/i.test(localPart) ||
    /^(noreply|no-reply|mailer-daemon|postmaster|bounce)$/i.test(localPart) ||
    fromLower.includes("no-reply") ||
    fromLower.includes("noreply") ||
    fromLower.includes("mailer-daemon")
  ) {
    return { skip: true, reason: "loop_protection:bot_or_bounce_sender" };
  }

  // 7. Daily cap (DAILY_REPLY_CAP, default 50, reset by date in dailyReplySentDate)
  if (userObj) {
    const today = new Date().toDateString();
    const lastReplyDate = userObj.dailyReplySentDate ? new Date(userObj.dailyReplySentDate).toDateString() : null;
    const dailyCount = (lastReplyDate === today) ? (userObj.dailyReplySentCount || 0) : 0;
    const cap = options.dailyReplyCap ?? DAILY_REPLY_CAP;
    if (dailyCount >= cap) {
      return { skip: true, reason: "loop_protection:daily_reply_cap_exceeded" };
    }
  }

  return { skip: false };
};

export const normalizeEmailAddress = (str) => {
  if (!str) return "";
  const match = String(str).match(/<([^>]+)>/);
  return (match ? match[1] : str).trim().toLowerCase();
};

export const extractHeaderMessageIds = (headerValue) => {
  if (!headerValue) return [];
  const matches = String(headerValue).match(/<[^>]+>/g);
  if (matches && matches.length > 0) {
    return matches.map((m) => m.trim());
  }
  const trimmed = String(headerValue).trim();
  return trimmed ? [trimmed] : [];
};

/**
 * Batch 2.5: Lookup order for grouping follow-ups for each incoming message:
 * (a) a record whose threadId or any turn.gmailThreadId equals the message's threadId;
 * (b) a record where any id in the message's In-Reply-To/References equals a stored turn rfcMessageId or one of our sent Message-IDs;
 * (c) only if the user setting groupBySender is true: a record with the same normalized sender email,
 *     whose last activity is within GROUP_WINDOW_DAYS (default 14), and whose latest turn is not skipped.
 */
export const findMatchingEmailAction = async (user, email, options = {}) => {
  const actionModel = options.actionModel || EmailAction;
  const userIdStr = String(user._id || user.id);
  const msgThreadId = email.threadId;

  // (a) a record whose threadId or any turn.gmailThreadId equals the message's threadId
  if (msgThreadId) {
    const byThread = await actionModel.findOne({
      userId: userIdStr,
      $or: [
        { threadId: msgThreadId },
        { "turns.gmailThreadId": msgThreadId }
      ]
    });
    if (byThread) {
      return { record: byThread, linkedBy: "thread" };
    }
  }

  // (b) a record where any id in the message's In-Reply-To/References equals a stored turn rfcMessageId or one of our sent Message-IDs
  const inReplyTo = getHeader(email, "In-Reply-To");
  const references = getHeader(email, "References");
  const headerIds = [
    ...extractHeaderMessageIds(inReplyTo),
    ...extractHeaderMessageIds(references)
  ];

  if (headerIds.length > 0) {
    const byHeaders = await actionModel.findOne({
      userId: userIdStr,
      $or: [
        { "turns.rfcMessageId": { $in: headerIds } },
        { "turns.outgoing.rfcMessageId": { $in: headerIds } }
      ]
    });
    if (byHeaders) {
      return { record: byHeaders, linkedBy: "headers" };
    }
  }

  // (c) only if the user setting groupBySender is true: a record with the same normalized sender email,
  // whose last activity is within GROUP_WINDOW_DAYS (default 14), and whose latest turn is not skipped.
  if (user?.settings?.groupBySender) {
    const groupWindowDays = Number(process.env.GROUP_WINDOW_DAYS) || 14;
    const windowStart = new Date(Date.now() - groupWindowDays * 24 * 60 * 60 * 1000);
    const normalizedSender = normalizeEmailAddress(getHeader(email, "From"));

    if (normalizedSender) {
      const candidates = await actionModel.find({
        userId: userIdStr,
        updatedAt: { $gte: windowStart }
      }).sort({ updatedAt: -1 });

      for (const candidate of candidates) {
        const turns = candidate.turns || [];
        const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;

        // Skip if latest turn is marked skipped
        if (latestTurn && (latestTurn.outcome === "skipped" || latestTurn.outgoing?.status === "skipped")) {
          continue;
        }

        const candidateSender = normalizeEmailAddress(
          latestTurn?.from || candidate.to || (turns[0]?.from) || ""
        );

        if (candidateSender && candidateSender === normalizedSender) {
          return { record: candidate, linkedBy: "sender" };
        }
      }
    }
  }

  return { record: null, linkedBy: "thread" };
};

/**
 * Stale-processing recovery (B8):
 * Rows with status:'processing' older than 5 minutes.
 * Checks Gmail threads (threads.get) to see if draft or sent reply already exists.
 * If one exists, marks row done with the right outcome and does NOT send again.
 * Otherwise sets status "retry" (not null), increments attempts, and after 3 attempts
 * marks "failed" with failureReason "stale_recovery_exhausted".
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

        // Also check if an EmailAction already sent or drafted for this thread
        const existingAction = await EmailAction.findOne({
          userId: String(user._id),
          threadId
        });

        if (hasSent || existingAction?.status === "sent" || existingAction?.sentAt) {
          row.status = "done";
          row.outcome = "sent";
          row.sentAt = row.sentAt || new Date();
          await row.save();
          continue;
        }

        if (hasDraft || existingAction?.status === "draft" || existingAction?.gmailDraftId) {
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
        row.status = "retry"; // Explicitly 'retry' (not null)
        row.attempts = (row.attempts || 1) + 1;
        row.nextRetryAt = new Date();
        await row.save();
      }
    } catch (err) {
      console.warn(`[poll] Stale recovery error for message ${row.messageId}:`, err.message);
      if (err?.status === 404 || err?.response?.status === 404) {
        row.status = "failed";
        row.outcome = "failed";
        row.failureReason = "gmail_message_not_found";
        await row.save().catch(() => {});
      }
    }
  }
};

/**
 * Process a group of messages belonging to the same thread.
 * When several unprocessed messages from one thread are found in the same run:
 * - Summarises all of them
 * - Writes ONE reply or draft to the newest message
 * - Marks all messages done in ProcessedEmail
 */
export const processThreadGroup = async ({ user, gmail = null, threadId = null, items = [] }) => {
  const userIdStr = String(user._id);
  if (!items || items.length === 0) {
    return { processed: false, reason: "no_items" };
  }

  // 1. Claim-first idempotency check for every message in the group
  const activeEntries = [];
  for (const item of items) {
    const messageId = typeof item === "string" ? item : item.id;
    let claimDoc;
    const existing = await ProcessedEmail.findOne({
      userId: userIdStr,
      messageId
    });

    if (existing) {
      if (existing.status === "retry") {
        const now = new Date();
        if (existing.nextRetryAt && existing.nextRetryAt > now) {
          continue;
        }
        existing.status = "processing";
        existing.attempts = (existing.attempts || 1) + 1;
        await existing.save();
        claimDoc = existing;
      } else {
        // already done, processing, or failed
        continue;
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
          continue;
        }
        throw err;
      }
    }

    activeEntries.push({
      item: typeof item === "string" ? { id: item } : item,
      claimDoc
    });
  }

  if (activeEntries.length === 0) {
    return { processed: false, reason: "already_claimed_or_completed" };
  }

  try {
    // 2. Fetch full email content for each active message
    const emailDataList = [];
    for (const entry of activeEntries) {
      let email = entry.item.emailData;
      if (!email || !email.payload) {
        const res = await withGmail(
          gmail || user,
          async (g) => {
            return await g.users.messages.get({
              userId: "me",
              id: entry.item.id,
              format: "full"
            });
          },
          user
        );
        email = res.data;
      }
      emailDataList.push({
        item: entry.item,
        claimDoc: entry.claimDoc,
        email
      });
    }

    // 3. Auto-reply loop protection on each message
    const validEmailEntries = [];
    for (const entry of emailDataList) {
      const { claimDoc, email } = entry;
      const loopCheck = shouldSkipLoopProtection(email, user);
      if (loopCheck.skip) {
        claimDoc.status = "done";
        claimDoc.outcome = "skipped";
        claimDoc.failureReason = loopCheck.reason;
        await claimDoc.save();
      } else {
        validEmailEntries.push(entry);
      }
    }

    if (validEmailEntries.length === 0) {
      const skipReason = emailDataList[0]?.claimDoc?.failureReason || "loop_protection";
      return { processed: false, outcome: "skipped", reason: skipReason };
    }

    // 4. Enabled labels check
    const enabledLabels = (user.labels || []).filter(l => l.enabled !== false);
    if (enabledLabels.length === 0) {
      for (const { claimDoc } of validEmailEntries) {
        claimDoc.status = "done";
        claimDoc.outcome = "none";
        claimDoc.failureReason = "no_enabled_labels";
        await claimDoc.save();
      }
      return { processed: false, outcome: "none", reason: "no_enabled_labels" };
    }

    // 5. Summarise all messages in the thread and classify
    // Sort chronologically oldest to newest
    validEmailEntries.sort((a, b) => {
      const dateA = Number(a.email.internalDate || 0);
      const dateB = Number(b.email.internalDate || 0);
      return dateA - dateB;
    });

    const newestEntry = validEmailEntries[validEmailEntries.length - 1];
    const olderEntries = validEmailEntries.slice(0, validEmailEntries.length - 1);
    const effectiveThreadId = newestEntry.email.threadId || threadId;

    // Batch 2.5: Lookup order for grouping follow-ups:
    // (a) threadId or turn.gmailThreadId equals message threadId
    // (b) In-Reply-To/References equals turn rfcMessageId or outgoing.rfcMessageId
    // (c) if groupBySender: same normalized sender within GROUP_WINDOW_DAYS (default 14) and latest turn not skipped
    const matchResult = await findMatchingEmailAction(user, newestEntry.email);
    const existingThreadAction = matchResult.record;
    const matchLinkedBy = matchResult.linkedBy || "thread";
    const previousTurns = existingThreadAction?.turns || [];

    // Summarise each message using AI
    for (const entry of validEmailEntries) {
      const email = entry.email;
      const subject = getHeader(email, "Subject");
      const from = getHeader(email, "From");
      const snippet = email.snippet || "";
      const rawBody = textFromPayload(email.payload) || snippet;
      const bodyText = stripQuotedAndHtml(rawBody || snippet);

      try {
        const aiRes = await analyzeEmailAI({
          userId: user._id,
          subject,
          from,
          snippet,
          bodyText,
          userProfileDescription: user.profileDescription,
          labels: enabledLabels,
          personas: user.personas || [],
          previousTurns
        });
        entry.aiResult = aiRes;
        entry.summary = aiRes.summary || snippet || "Incoming email message.";
      } catch (aiErr) {
        const isTransient = aiErr?.isTransient || isTransientAIError(aiErr);
        for (const e of validEmailEntries) {
          const doc = e.claimDoc;
          const attempts = doc.attempts || 1;
          if (isTransient && attempts < 3) {
            const backoffMs = Math.pow(2, attempts) * 60 * 1000;
            doc.status = "retry";
            doc.failureReason = aiErr.message || "transient_ai_error";
            doc.nextRetryAt = new Date(Date.now() + backoffMs);
            await doc.save();
          } else {
            doc.status = "failed";
            doc.outcome = "failed";
            doc.failureReason = isTransient ? "ai_unavailable" : (aiErr.message || "ai_permanent_error");
            await doc.save();
          }
        }

        // Actions "failed" still create a turn if permanent failure
        if (!isTransient || (newestEntry.claimDoc.attempts || 1) >= 3) {
          try {
            const failedTurn = {
              incomingMessageId: newestEntry.item.id,
              gmailThreadId: newestEntry.email.threadId || effectiveThreadId,
              rfcMessageId: getHeader(newestEntry.email, "Message-ID") || getHeader(newestEntry.email, "Message-Id") || null,
              inReplyToHeader: getHeader(newestEntry.email, "In-Reply-To") || null,
              referencesHeader: getHeader(newestEntry.email, "References") || null,
              linkedBy: matchLinkedBy,
              from: getHeader(newestEntry.email, "From"),
              receivedAt: new Date(Number(newestEntry.email.internalDate || Date.now())),
              incomingSubject: getHeader(newestEntry.email, "Subject"),
              incomingSnippet: (newestEntry.email.snippet || "").slice(0, 500),
              incomingSummary: newestEntry.email.snippet || "Incoming email message.",
              label: "failed",
              outcome: "failed",
              failureReason: isTransient ? "ai_unavailable" : (aiErr.message || "ai_permanent_error")
            };
            if (existingThreadAction) {
              existingThreadAction.turns.push(failedTurn);
              existingThreadAction.status = "failed";
              existingThreadAction.type = "failed";
              existingThreadAction.checked = false;
              await existingThreadAction.save();
            } else {
              await EmailAction.create({
                userId: userIdStr,
                threadId: effectiveThreadId,
                turns: [failedTurn],
                status: "failed",
                type: "failed",
                checked: false,
                to: getHeader(newestEntry.email, "From"),
                subject: getHeader(newestEntry.email, "Subject"),
                summary: failedTurn.incomingSummary,
                sourceMessageId: newestEntry.item.id
              });
            }
          } catch (recErr) {
            console.warn("[poll] Could not record failed EmailAction turn:", recErr.message);
          }
        }

        return {
          processed: false,
          outcome: isTransient && (newestEntry.claimDoc.attempts || 1) < 3 ? "retry" : "failed",
          reason: aiErr.message
        };
      }
    }

    // Newest message determines the overall label and reply/draft action
    const newestAi = newestEntry.aiResult;
    const selectedLabelName = newestAi.label;
    const labelObj = enabledLabels.find(l => l.name === selectedLabelName);

    if (!labelObj) {
      for (const entry of validEmailEntries) {
        entry.claimDoc.status = "done";
        entry.claimDoc.outcome = "none";
        entry.claimDoc.label = selectedLabelName || "unknown";
        entry.claimDoc.failureReason = `Label '${selectedLabelName}' not found or disabled`;
        await entry.claimDoc.save();
      }
      return { processed: false, outcome: "none", reason: "label_not_found" };
    }

    // 6. Apply Gmail labels to all messages in the thread
    if (labelObj.id) {
      for (const entry of validEmailEntries) {
        try {
          await withGmail(
            gmail || user,
            async (g) => {
              await g.users.messages.modify({
                userId: "me",
                id: entry.item.id,
                requestBody: {
                  addLabelIds: [labelObj.id]
                }
              });
            },
            user
          );
        } catch (labelErr) {
          console.warn(`[poll] Failed to apply label ${labelObj.id} to msg ${entry.item.id}:`, labelErr.message);
        }
      }
    }

    // 7. Determine action
    const userAction = labelObj.action?.type || "none";
    let finalAction = newestAi.action === "none" ? "none" : userAction;

    // Check daily reply cap if finalAction is reply
    if (finalAction === "reply") {
      const today = new Date().toDateString();
      const lastReplyDate = user.dailyReplySentDate ? new Date(user.dailyReplySentDate).toDateString() : null;
      const count = (lastReplyDate === today) ? (user.dailyReplySentCount || 0) : 0;
      if (count >= DAILY_REPLY_CAP) {
        console.warn(`[poll] Daily reply cap (${DAILY_REPLY_CAP}) reached for user ${user._id}`);
        // Record newest as skipped with daily cap exceeded
        newestEntry.claimDoc.status = "done";
        newestEntry.claimDoc.outcome = "skipped";
        newestEntry.claimDoc.failureReason = "loop_protection:daily_reply_cap_exceeded";
        await newestEntry.claimDoc.save();

        for (const entry of olderEntries) {
          entry.claimDoc.status = "done";
          entry.claimDoc.outcome = labelObj ? "labeled" : "none";
          await entry.claimDoc.save();
        }

        return {
          processed: false,
          outcome: "skipped",
          reason: "loop_protection:daily_reply_cap_exceeded"
        };
      }
    }

    const shouldMarkRead = typeof labelObj.markAsRead === "boolean"
      ? labelObj.markAsRead
      : finalAction !== "draft";

    let gmailMessageId = "";
    let gmailDraftId = "";

    const newestEmail = newestEntry.email;
    const turnGmailThreadId = newestEmail.threadId || effectiveThreadId;
    const newestSubject = getHeader(newestEmail, "Subject");
    const newestFrom = getHeader(newestEmail, "From");
    const newestMessageHeaderId = getHeader(newestEmail, "Message-ID");
    const newestReferences = getHeader(newestEmail, "References") || newestMessageHeaderId;

    // 8. Reply or Draft to the newest message
    // Check if previous outgoing in this thread is an unsent draft
    let previousDraftTurn = null;
    if (existingThreadAction && Array.isArray(existingThreadAction.turns) && existingThreadAction.turns.length > 0) {
      const lastTurn = existingThreadAction.turns[existingThreadAction.turns.length - 1];
      if (lastTurn && lastTurn.outgoing && lastTurn.outgoing.status === "draft") {
        previousDraftTurn = lastTurn;
      }
    }

    if (previousDraftTurn && previousDraftTurn.outgoing?.gmailDraftId) {
      // If the previous outgoing is an UNSENT draft: delete that Gmail draft through withGmail,
      // mark its turn outgoing.status "superseded", then create the new draft.
      try {
        await deleteGmailDraft(gmail || user, previousDraftTurn.outgoing.gmailDraftId, user);
        console.log(`[poll] Deleted superseded Gmail draft ${previousDraftTurn.outgoing.gmailDraftId}`);
      } catch (draftDelErr) {
        console.warn(`[poll] Could not delete superseded Gmail draft:`, draftDelErr.message);
      }
      previousDraftTurn.outgoing.status = "superseded";
    }

    let outgoing = null;

    if (["reply", "draft"].includes(finalAction)) {
      const raw = buildMimeMessage({
        to: newestFrom,
        subject: newestSubject,
        body: newestAi.body,
        inReplyTo: newestMessageHeaderId,
        references: newestReferences,
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
                threadId: turnGmailThreadId
              }
            });
          },
          user
        );
        gmailMessageId = sent.data.id;

        // Fetch sent message metadata to extract its RFC Message-ID
        let sentRfcMessageId = null;
        if (gmailMessageId) {
          try {
            const meta = await withGmail(
              gmail || user,
              async (g) => {
                return await g.users.messages.get({
                  userId: "me",
                  id: gmailMessageId,
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
            console.warn(
              "[poll] Could not fetch sent message RFC Message-ID:",
              metaErr.message
            );
          }
        }

        // Persist sent state immediately so later failures never cause a duplicate send
        newestEntry.claimDoc.outcome = "sent";
        newestEntry.claimDoc.sentAt = new Date();
        await newestEntry.claimDoc.save().catch(() => {});

        // Update daily reply count on user
        const today = new Date().toDateString();
        const lastReplyDate = user.dailyReplySentDate ? new Date(user.dailyReplySentDate).toDateString() : null;
        if (lastReplyDate === today) {
          user.dailyReplySentCount = (user.dailyReplySentCount || 0) + 1;
        } else {
          user.dailyReplySentDate = new Date();
          user.dailyReplySentCount = 1;
        }
        if (typeof user.save === "function") {
          await user.save().catch(() => {});
        }

        outgoing = {
          kind: "reply",
          body: newestAi.body,
          bodyHtml: "",
          status: "sent",
          gmailDraftId: null,
          gmailMessageId,
          rfcMessageId: sentRfcMessageId,
          sentAt: new Date(),
          composedManually: false,
          inReplyTo: newestMessageHeaderId,
          references: newestReferences
        };
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
                  threadId: turnGmailThreadId
                }
              }
            });
          },
          user
        );
        gmailDraftId = draft.data.id;
        gmailMessageId = draft.data.message?.id || "";

        outgoing = {
          kind: "draft",
          body: newestAi.body,
          bodyHtml: "",
          status: "draft",
          gmailDraftId,
          gmailMessageId,
          sentAt: null,
          composedManually: false,
          inReplyTo: newestMessageHeaderId,
          references: newestReferences
        };
      }
    }

    // Build turns for older messages in this tick
    const olderTurns = olderEntries.map((entry) => ({
      incomingMessageId: entry.item.id,
      gmailThreadId: entry.email.threadId || effectiveThreadId,
      rfcMessageId:
        getHeader(entry.email, "Message-ID") ||
        getHeader(entry.email, "Message-Id") ||
        null,
      inReplyToHeader: getHeader(entry.email, "In-Reply-To") || null,
      referencesHeader: getHeader(entry.email, "References") || null,
      linkedBy: matchLinkedBy,
      from: getHeader(entry.email, "From"),
      receivedAt: new Date(Number(entry.email.internalDate || Date.now())),
      incomingSubject: getHeader(entry.email, "Subject"),
      incomingSnippet: (entry.email.snippet || "").slice(0, 500),
      incomingSummary: entry.summary,
      label: selectedLabelName,
      outcome: "labeled",
      failureReason: null
    }));

    // Build turn for newest message
    const newestOutcome = finalAction === "reply" ? "sent" : (finalAction === "draft" ? "drafted" : "none");
    const newestTurn = {
      incomingMessageId: newestEntry.item.id,
      gmailThreadId: turnGmailThreadId,
      rfcMessageId: newestMessageHeaderId || null,
      inReplyToHeader: getHeader(newestEmail, "In-Reply-To") || null,
      referencesHeader: newestReferences || null,
      linkedBy: matchLinkedBy,
      from: newestFrom,
      receivedAt: new Date(Number(newestEmail.internalDate || Date.now())),
      incomingSubject: newestSubject,
      incomingSnippet: (newestEmail.snippet || "").slice(0, 500),
      incomingSummary: newestEntry.summary,
      label: selectedLabelName,
      outcome: newestOutcome,
      failureReason: null,
      ...(outgoing ? { outgoing } : {})
    };

    const newTurns = [...olderTurns, newestTurn];

    // Maintain conversationHistory for backward compatibility
    const historyItems = [];
    for (const entry of validEmailEntries) {
      historyItems.push({
        role: "incoming",
        type: "summary",
        content: entry.summary,
        messageId: entry.item.id,
        timestamp: new Date()
      });
    }
    if (["reply", "draft"].includes(finalAction)) {
      historyItems.push({
        role: "outgoing",
        type: finalAction,
        content: newestAi.body,
        timestamp: new Date()
      });
    }

    if (existingThreadAction) {
      // Append new turn(s); previous turns stay untouched
      existingThreadAction.turns.push(...newTurns);
      existingThreadAction.checked = false;
      existingThreadAction.checkedAt = null;

      const history = [...(existingThreadAction.conversationHistory || [])];
      history.push(...historyItems);
      existingThreadAction.conversationHistory = history;

      existingThreadAction.summary = newestEntry.summary;
      existingThreadAction.body = newestAi.body || "";
      existingThreadAction.sourceMessageId = newestEntry.item.id;
      existingThreadAction.gmailMessageId = gmailMessageId;
      existingThreadAction.gmailDraftId = gmailDraftId;
      existingThreadAction.type = finalAction;
      existingThreadAction.label = selectedLabelName;
      existingThreadAction.status = finalAction === "reply" ? "sent" : (finalAction === "draft" ? "draft" : "reviewed");
      existingThreadAction.sentAt = finalAction === "reply" ? new Date() : null;

      await existingThreadAction.save();
    } else {
      await EmailAction.create({
        userId: userIdStr,
        sourceMessageId: newestEntry.item.id,
        gmailMessageId,
        gmailDraftId,
        threadId: effectiveThreadId,
        turns: newTurns,
        type: finalAction,
        label: selectedLabelName,
        to: newestFrom,
        subject: newestSubject,
        summary: newestEntry.summary,
        body: newestAi.body || "",
        checked: false,
        status: finalAction === "reply" ? "sent" : (finalAction === "draft" ? "draft" : "reviewed"),
        sentAt: finalAction === "reply" ? new Date() : null,
        conversationHistory: historyItems
      });
    }

    // 9. Finalize claim documents for all messages
    for (const entry of olderEntries) {
      entry.claimDoc.status = "done";
      entry.claimDoc.label = selectedLabelName;
      entry.claimDoc.action = finalAction;
      entry.claimDoc.markAsRead = shouldMarkRead;
      entry.claimDoc.outcome = labelObj ? "labeled" : "none";
      await entry.claimDoc.save();
    }

    newestEntry.claimDoc.status = "done";
    newestEntry.claimDoc.label = selectedLabelName;
    newestEntry.claimDoc.action = finalAction;
    newestEntry.claimDoc.markAsRead = shouldMarkRead;
    if (finalAction === "reply") {
      newestEntry.claimDoc.outcome = "sent";
      newestEntry.claimDoc.sentAt = newestEntry.claimDoc.sentAt || new Date();
    } else if (finalAction === "draft") {
      newestEntry.claimDoc.outcome = "drafted";
    } else {
      newestEntry.claimDoc.outcome = labelObj ? "labeled" : "none";
    }
    await newestEntry.claimDoc.save();

    await updateAnalytics({
      userId: user._id,
      label: selectedLabelName,
      action: finalAction
    }).catch(err => console.warn("[poll] Analytics update error:", err.message));

    // 10. Mark as read in Gmail if required
    if (shouldMarkRead) {
      for (const entry of validEmailEntries) {
        await withGmail(
          gmail || user,
          async (g) => {
            await g.users.messages.modify({
              userId: "me",
              id: entry.item.id,
              requestBody: {
                removeLabelIds: ["UNREAD"]
              }
            });
          },
          user
        ).catch(err => console.warn(`[poll] Mark read error for ${entry.item.id}:`, err.message));
      }
    }

    return { processed: true, outcome: newestEntry.claimDoc.outcome, messageCount: validEmailEntries.length };
  } catch (err) {
    console.error(`[poll] Unexpected error processing thread group ${threadId}:`, err.message);
    for (const entry of activeEntries) {
      if (entry.claimDoc && entry.claimDoc.status === "processing") {
        entry.claimDoc.status = "failed";
        entry.claimDoc.outcome = "failed";
        entry.claimDoc.failureReason = err.message || "processing_error";
        await entry.claimDoc.save().catch(() => {});
      }
    }
    return { processed: false, reason: err.message };
  }
};

/**
 * Process a single email message with claim-first idempotency.
 * Delegates to processThreadGroup.
 */
export const processMessage = async ({ user, gmail = null, messageId, emailData = null }) => {
  const existing = await ProcessedEmail.findOne({
    userId: String(user._id),
    messageId
  });

  if (existing && existing.status !== "retry") {
    return { processed: false, reason: `already_${existing.status}` };
  }

  const res = await processThreadGroup({
    user,
    gmail,
    threadId: emailData?.threadId || null,
    items: [{ id: messageId, emailData }]
  });

  return res;
};

/**
 * Synchronize email messages for a single user.
 */
export const syncUser = async (user, options = {}) => {
  if (user.needsRelogin) {
    console.log(`[poll] User ${user._id} flagged needsRelogin, skipping sync.`);
    return { skipped: true, reason: "needs_relogin" };
  }

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
              threadId: meta.data.threadId || id,
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
            threadId: meta.data.threadId || m.threadId || m.id,
            internalDate: Number(meta.data.internalDate || 0),
            labelIds: meta.data.labelIds || []
          });
        } catch (mErr) {
          messageItems.push({ id: m.id, threadId: m.threadId || m.id, internalDate: 0, labelIds: [] });
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
        messageItems.push({ id: r.messageId, threadId: r.messageId, internalDate: 0, labelIds: [] });
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

    // Group batch by threadId
    const threadGroups = new Map();
    for (const item of batch) {
      const tId = item.threadId || item.id;
      if (!threadGroups.has(tId)) {
        threadGroups.set(tId, []);
      }
      threadGroups.get(tId).push(item);
    }

    // Process all thread groups
    let processedCount = 0;
    for (const [tId, groupItems] of threadGroups.entries()) {
      const res = await processThreadGroup({
        user,
        gmail,
        threadId: tId,
        items: groupItems
      });
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
