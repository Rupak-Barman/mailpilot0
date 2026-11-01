// services/reconcile.service.js
import EmailAction from "../models/EmailAction.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import { getGmail, withGmail } from "./gmail.service.js";
import { publishUserEvent } from "./events.service.js";
import {
  getHeader,
  textFromPayload,
  stripQuotedAndHtml,
  parseRecipientList,
  formatRecipientList
} from "../utils/helpers.js";

export const RECONCILE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
export const MAX_RECONCILE_PER_RUN = 30;

/**
 * Reconciles a single turn within an EmailAction against Gmail.
 *
 * Scenarios:
 * 1. Draft turn (outgoing.status === "draft"):
 *    - drafts.get(gmailDraftId):
 *      - Exists: compare subject, to, cc, bcc, body; if changed, update stored copy,
 *        set outgoing.editedInGmail = true, editedAt = now, update outgoing.gmailMessageId.
 *      - 404: threads.get(gmailThreadId) looking for a message with label 'SENT'
 *        and internalDate > draft creation time.
 *        - Found -> status "sent", sentAt, gmailMessageId, sentFrom "gmail", ProcessedEmail ai_draft_sent.
 *        - Not found -> status "deleted", ProcessedEmail resolution "none".
 * 2. Manual / Failed / No outgoing yet:
 *    - threads.get(gmailThreadId) looking for a SENT message after receivedAt.
 *    - Found -> outcome "sent", status "sent", composedManually true, sentFrom "gmail",
 *      ProcessedEmail resolution "manual", outcome "sent".
 */
export const reconcileTurn = async (user, action, turn, options = {}) => {
  const gmail = options.gmailClient || options.gmail || (await getGmail(user));
  const isLatest =
    Array.isArray(action.turns) &&
    action.turns.length > 0 &&
    action.turns[action.turns.length - 1] === turn;

  const now = new Date();

  // Scenario 1: Outgoing draft turn
  if (turn.outgoing && ["draft", "sending"].includes(turn.outgoing.status) && turn.outgoing.gmailDraftId) {
    try {
      const draftRes = await withGmail(
        gmail,
        async (g) => {
          return await g.users.drafts.get({
            userId: "me",
            id: turn.outgoing.gmailDraftId,
            format: "full"
          });
        },
        user
      );

      const draftMsg = draftRes.data?.message || {};
      const newSubject = getHeader(draftMsg, "Subject");
      const newTo = getHeader(draftMsg, "To");
      const newCc = getHeader(draftMsg, "Cc");
      const newBcc = getHeader(draftMsg, "Bcc");
      const rawBody = textFromPayload(draftMsg.payload);
      const newBody = rawBody ? stripQuotedAndHtml(rawBody) : "";
      const newMsgId = draftMsg.id;

      const parsedNewTo = parseRecipientList(newTo);
      const parsedNewCc = parseRecipientList(newCc);
      const parsedNewBcc = parseRecipientList(newBcc);

      const storedSubject = turn.outgoing.subject ?? (isLatest ? action.subject : "") ?? "";
      const storedToFormatted = formatRecipientList(turn.outgoing.to) || (isLatest ? action.to : "") || "";
      const storedCcFormatted = formatRecipientList(turn.outgoing.cc) || "";
      const storedBccFormatted = formatRecipientList(turn.outgoing.bcc) || "";
      const storedBody = (turn.outgoing.body ?? (isLatest ? action.body : "") ?? "")
        .replace(/\r\n/g, "\n")
        .trim();
      const normalizedNewBody = (newBody || "").replace(/\r\n/g, "\n").trim();

      const newToFormatted = formatRecipientList(parsedNewTo);
      const newCcFormatted = formatRecipientList(parsedNewCc);
      const newBccFormatted = formatRecipientList(parsedNewBcc);

      const subjectChanged = Boolean(newSubject && newSubject !== storedSubject);
      const toChanged = Boolean(newTo && newToFormatted !== storedToFormatted);
      const ccChanged = Boolean(newCcFormatted !== storedCcFormatted);
      const bccChanged = Boolean(newBccFormatted !== storedBccFormatted);
      const bodyChanged = Boolean(normalizedNewBody && normalizedNewBody !== storedBody);

      let changed = false;
      if (subjectChanged || toChanged || ccChanged || bccChanged || bodyChanged) {
        if (newSubject) turn.outgoing.subject = newSubject;
        if (newTo) turn.outgoing.to = parsedNewTo;
        turn.outgoing.cc = parsedNewCc;
        turn.outgoing.bcc = parsedNewBcc;
        if (normalizedNewBody) turn.outgoing.body = normalizedNewBody;
        turn.outgoing.editedInGmail = true;
        turn.outgoing.editedAt = now;
        if (newMsgId) {
          turn.outgoing.gmailMessageId = newMsgId;
        }

        if (isLatest) {
          if (newSubject) action.subject = newSubject;
          if (newTo) action.to = newToFormatted;
          action.cc = newCcFormatted;
          action.bcc = newBccFormatted;
          if (normalizedNewBody) action.body = normalizedNewBody;
          if (newMsgId) action.gmailMessageId = newMsgId;
        }
        changed = true;
      } else if (newMsgId && turn.outgoing.gmailMessageId && newMsgId !== turn.outgoing.gmailMessageId) {
        turn.outgoing.gmailMessageId = newMsgId;
        if (isLatest) action.gmailMessageId = newMsgId;
        turn.outgoing.editedInGmail = true;
        turn.outgoing.editedAt = now;
        changed = true;
      }

      turn.outgoing.lastReconciledAt = now;
      await action.save();

      if (changed) {
        publishUserEvent(user._id, {
          type: "emailAction.changed",
          threadId: String(action.threadId || action._id),
          at: Date.now()
        });
      }

      return { status: "draft", edited: changed };
    } catch (draftErr) {
      const status = draftErr?.status || draftErr?.response?.status;
      const isNotFound =
        status === 404 ||
        draftErr?.message?.includes("404") ||
        draftErr?.message?.includes("Not Found");

      if (!isNotFound) {
        throw draftErr;
      }

      // 404: Draft not found in Gmail. Look for a sent message in the thread.
      const threadId = turn.gmailThreadId || action.threadId;
      const threadRes = await withGmail(
        gmail,
        async (g) => {
          return await g.users.threads.get({
            userId: "me",
            id: threadId,
            format: "metadata",
            metadataHeaders: ["Date", "From", "Subject", "Message-ID"]
          });
        },
        user
      );

      const draftCreationTime = turn.outgoing.createdAt
        ? new Date(turn.outgoing.createdAt).getTime()
        : (turn.receivedAt ? new Date(turn.receivedAt).getTime() : new Date(action.createdAt).getTime());

      const sentMsg = (threadRes.data?.messages || []).find((m) => {
        const labels = m.labelIds || [];
        const msgDate = Number(m.internalDate || 0);
        return labels.includes("SENT") && msgDate > draftCreationTime;
      });

      if (sentMsg) {
        const sentAtDate = new Date(Number(sentMsg.internalDate));
        turn.outgoing.status = "sent";
        turn.outgoing.sentAt = sentAtDate;
        turn.outgoing.gmailMessageId = sentMsg.id;
        turn.outgoing.sentFrom = "gmail";
        turn.outgoing.lastReconciledAt = now;
        turn.outcome = "sent";

        if (isLatest) {
          action.status = "sent";
          action.sentAt = sentAtDate;
          action.gmailMessageId = sentMsg.id;
        }

        const targetMsgId = turn.incomingMessageId || action.sourceMessageId;
        if (targetMsgId) {
          await ProcessedEmail.findOneAndUpdate(
            { userId: String(user._id), messageId: targetMsgId },
            {
              $set: {
                sentAt: sentAtDate,
                resolvedAt: sentAtDate,
                resolution: "ai_draft_sent"
              }
            }
          ).catch((e) => console.warn("[reconcile] ProcessedEmail update error:", e.message));
        }

        await action.save();
        publishUserEvent(user._id, {
          type: "emailAction.changed",
          threadId: String(action.threadId || action._id),
          at: Date.now()
        });
        publishUserEvent(user._id, {
          type: "analytics.changed",
          at: Date.now()
        });

        return { status: "sent", sentAt: sentAtDate, sentFrom: "gmail" };
      } else {
        // Not found: mark turn outgoing.status "deleted" and ProcessedEmail resolution "none".
        // Never mark sent on a guess.
        turn.outgoing.status = "deleted";
        turn.outgoing.lastReconciledAt = now;

        if (isLatest) {
          action.status = "reviewed";
          action.type = "reply"; // Leaves Drafts tab counts but stays in All
        }

        const targetMsgId = turn.incomingMessageId || action.sourceMessageId;
        if (targetMsgId) {
          await ProcessedEmail.findOneAndUpdate(
            { userId: String(user._id), messageId: targetMsgId },
            {
              $set: {
                resolvedAt: now,
                resolution: "none"
              }
            }
          ).catch((e) => console.warn("[reconcile] ProcessedEmail update error:", e.message));
        }

        await action.save();
        publishUserEvent(user._id, {
          type: "emailAction.changed",
          threadId: String(action.threadId || action._id),
          at: Date.now()
        });
        publishUserEvent(user._id, {
          type: "analytics.changed",
          at: Date.now()
        });

        return { status: "deleted" };
      }
    }
  }

  // Scenario 2: turns with outcome needs_manual, failed, or no outgoing yet
  const isNeedsManualOrFailed =
    turn.outcome === "needs_manual" ||
    turn.outcome === "failed" ||
    !turn.outgoing ||
    turn.outgoing?.status === "failed";

  if (isNeedsManualOrFailed && turn.outgoing?.status !== "sent" && turn.outgoing?.sentFrom !== "gmail") {
    const threadId = turn.gmailThreadId || action.threadId;
    const threadRes = await withGmail(
      gmail,
      async (g) => {
        return await g.users.threads.get({
          userId: "me",
          id: threadId,
          format: "metadata",
          metadataHeaders: ["Date", "From", "Subject", "Message-ID"]
        });
      },
      user
    );

    const receivedTime = turn.receivedAt
      ? new Date(turn.receivedAt).getTime()
      : new Date(action.createdAt).getTime();

    const sentMsg = (threadRes.data?.messages || []).find((m) => {
      const labels = m.labelIds || [];
      const msgDate = Number(m.internalDate || 0);
      return labels.includes("SENT") && msgDate > receivedTime;
    });

    if (sentMsg) {
      const sentAtDate = new Date(Number(sentMsg.internalDate));
      turn.outgoing = turn.outgoing || { kind: "reply" };
      turn.outgoing.kind = "reply";
      turn.outgoing.status = "sent";
      turn.outgoing.sentAt = sentAtDate;
      turn.outgoing.gmailMessageId = sentMsg.id;
      turn.outgoing.composedManually = true;
      turn.outgoing.sentFrom = "gmail";
      turn.outgoing.lastReconciledAt = now;
      turn.outcome = "sent";

      if (isLatest) {
        action.status = "sent";
        action.type = "reply";
        action.sentAt = sentAtDate;
        action.gmailMessageId = sentMsg.id;
      }

      const targetMsgId = turn.incomingMessageId || action.sourceMessageId;
      if (targetMsgId) {
        await ProcessedEmail.findOneAndUpdate(
          { userId: String(user._id), messageId: targetMsgId },
          {
            $set: {
              outcome: "sent",
              sentAt: sentAtDate,
              resolvedAt: sentAtDate,
              resolution: "manual"
            }
          }
        ).catch((e) => console.warn("[reconcile] ProcessedEmail update error:", e.message));
      }

      await action.save();
      publishUserEvent(user._id, {
        type: "emailAction.changed",
        threadId: String(action.threadId || action._id),
        at: Date.now()
      });
      publishUserEvent(user._id, {
        type: "analytics.changed",
        at: Date.now()
      });

      return { status: "sent", sentAt: sentAtDate, resolution: "manual", sentFrom: "gmail" };
    } else {
      if (turn.outgoing) {
        turn.outgoing.lastReconciledAt = now;
      } else {
        turn.lastReconciledAt = now;
      }
      await action.save();
      return { status: "unresolved" };
    }
  }

  return { status: "noop" };
};

/**
 * Reconciles pending turns for a user.
 * - Rate limit: each turn checked at most once every 2 minutes.
 * - Max 30 turns per run.
 */
export const reconcileUser = async (user, options = {}) => {
  const gmail = options.gmailClient || options.gmail || (await getGmail(user));
  const rateLimitMs = options.reconcileIntervalMs ?? RECONCILE_INTERVAL_MS;
  const maxTurns = options.maxTurnsPerRun ?? MAX_RECONCILE_PER_RUN;
  const cutoff = new Date(Date.now() - rateLimitMs);

  const actions = await EmailAction.find({
    userId: user._id,
    $or: [
      { "turns.outgoing.status": "draft" },
      { "turns.outcome": { $in: ["needs_manual", "failed"] } },
      { "turns.outgoing": { $exists: false } },
      { status: { $in: ["draft", "failed", "needs_reply"] } }
    ]
  }).sort({ updatedAt: -1 });

  let checkedCount = 0;

  for (const action of actions) {
    if (checkedCount >= maxTurns) break;
    if (!Array.isArray(action.turns) || action.turns.length === 0) continue;

    for (const turn of action.turns) {
      if (checkedCount >= maxTurns) break;

      const isDraftPending =
        turn.outgoing?.status === "draft" && Boolean(turn.outgoing?.gmailDraftId);

      const isManualPending =
        (turn.outcome === "needs_manual" || turn.outcome === "failed" || !turn.outgoing) &&
        turn.outgoing?.status !== "sent" &&
        turn.outgoing?.sentFrom !== "gmail";

      if (!isDraftPending && !isManualPending) {
        continue;
      }

      // Check rate limit: at most once every 2 minutes
      const lastCheck = turn.outgoing?.lastReconciledAt || turn.lastReconciledAt;
      if (lastCheck && new Date(lastCheck) > cutoff) {
        continue;
      }

      checkedCount++;
      try {
        await reconcileTurn(user, action, turn, { gmail, ...options });
      } catch (err) {
        console.warn(`[reconcile] Error checking turn in thread ${action.threadId}:`, err.message);
      }
    }
  }

  return { checkedCount };
};
