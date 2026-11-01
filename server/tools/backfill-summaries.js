// server/tools/backfill-summaries.js
import url from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import EmailAction from "../models/EmailAction.js";
import User from "../models/User.js";
import { withGmail } from "../services/gmail.service.js";
import { textFromPayload } from "../jobs/poll.job.js";
import { getHeader, stripQuotedAndHtml } from "../utils/helpers.js";

dotenv.config();

const OLLAMA_BASE_URL = (
  process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
).replace(/\/+$/, "");

const LLM_MODEL = process.env.OLLAMA_LLM_MODEL || "qwen2.5-coder:7b";

export const SUMMARY_UNAVAILABLE_MESSAGE =
  "Summary unavailable (original email no longer in Gmail)";

/**
 * Check if a turn needs a summary backfilled.
 */
export function isSummaryMissing(summary) {
  if (!summary || typeof summary !== "string") return true;
  const trimmed = summary.trim();
  if (trimmed === "") return true;
  if (trimmed === "No summary available") return true;
  if (trimmed === "Incoming email message.") return true;
  return false;
}

/**
 * Generate a concise 1-2 sentence email summary using Ollama chat API.
 */
export async function summarizeWithOllama({ from, subject, bodyText }, customFetch = fetch) {
  const prompt = [
    "Please provide a concise 1-2 sentence summary of this incoming email message for an inbox overview.",
    "",
    `From: ${from || "Unknown"}`,
    `Subject: ${subject || "No subject"}`,
    "",
    "Body:",
    bodyText ? bodyText.slice(0, 4000) : "No body provided",
  ].join("\n");

  const response = await customFetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      stream: false,
      options: {
        num_ctx: Number(process.env.OLLAMA_NUM_CTX) || 4096,
        temperature: 0.2,
      },
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  let content = data.message?.content?.trim() || "";

  // Strip wrapping quotes if returned
  if (
    (content.startsWith('"') && content.endsWith('"')) ||
    (content.startsWith("'") && content.endsWith("'"))
  ) {
    content = content.slice(1, -1).trim();
  }

  return content;
}

/**
 * Backfill summaries for EmailAction turns that lack summaries.
 * Idempotent, resumable, and rate-limited.
 *
 * @param {object} options
 * @param {boolean} [options.dryRun=false] - Dry run without writing to DB
 * @param {number} [options.limit] - Max documents to inspect
 * @param {number} [options.delayMs=500] - Rate limiting delay between Ollama calls
 * @param {Function} [options.ollamaSummarizer] - Custom summarizer for testing
 * @param {Function} [options.messageFetcher] - Custom message fetcher for testing
 * @param {object} [options.actionModel] - EmailAction model override
 * @param {object} [options.userModel] - User model override
 * @returns {Promise<object>} Summary of the run
 */
export async function backfillSummaries(options = {}) {
  const {
    dryRun = false,
    limit = null,
    delayMs = 500,
    ollamaSummarizer = summarizeWithOllama,
    messageFetcher = null,
    actionModel = EmailAction,
    userModel = User,
  } = options;

  const stats = {
    totalDocsScanned: 0,
    totalTurnsScanned: 0,
    summariesGenerated: 0,
    summariesUnavailable: 0,
    turnsSkipped: 0,
    docsUpdated: 0,
    errors: [],
  };

  console.log(`[backfill-summaries] Starting backfill (dryRun: ${dryRun})...`);

  // Query docs
  let query = actionModel.find({});
  if (limit && Number.isInteger(limit) && limit > 0) {
    query = query.limit(limit);
  }

  const docs = await query;
  stats.totalDocsScanned = docs.length;

  // Cache users to avoid repeated queries
  const userCache = new Map();

  for (const doc of docs) {
    let docModified = false;

    // Ensure turns exist; if legacy doc has no turns array, synthesize one turn
    if (!Array.isArray(doc.turns) || doc.turns.length === 0) {
      doc.turns = [
        {
          incomingMessageId: doc.sourceMessageId || null,
          from: doc.to || "",
          receivedAt: doc.createdAt ? new Date(doc.createdAt) : new Date(),
          incomingSubject: doc.subject || "",
          incomingSnippet: doc.summary || "",
          incomingSummary: isSummaryMissing(doc.summary) ? "" : doc.summary,
          label: doc.label || "",
          outcome:
            doc.type === "draft"
              ? "drafted"
              : doc.type === "reply"
              ? "sent"
              : doc.type === "none"
              ? "none"
              : "failed",
          outgoing: doc.body
            ? {
                kind: doc.type === "reply" ? "reply" : "draft",
                body: doc.body,
                status: doc.status || "draft",
                gmailDraftId: doc.gmailDraftId || null,
                gmailMessageId: doc.gmailMessageId || null,
              }
            : null,
        },
      ];
      docModified = true;
    }

    for (let tIndex = 0; tIndex < doc.turns.length; tIndex++) {
      const turn = doc.turns[tIndex];
      stats.totalTurnsScanned++;

      if (!isSummaryMissing(turn.incomingSummary)) {
        stats.turnsSkipped++;
        continue;
      }

      const messageId = turn.incomingMessageId || doc.sourceMessageId;

      if (!messageId) {
        turn.incomingSummary = SUMMARY_UNAVAILABLE_MESSAGE;
        stats.summariesUnavailable++;
        docModified = true;
        continue;
      }

      // Fetch user
      const userIdStr = String(doc.userId);
      let user = userCache.get(userIdStr);
      if (!user) {
        user = await userModel.findById(doc.userId);
        if (user) userCache.set(userIdStr, user);
      }

      if (!user) {
        console.warn(`[backfill-summaries] User not found for doc ${doc._id}`);
        stats.errors.push(`User not found for doc ${doc._id}`);
        continue;
      }

      // Fetch message from Gmail
      let emailMessage = null;
      let messageGone = false;

      try {
        if (typeof messageFetcher === "function") {
          emailMessage = await messageFetcher(user, messageId);
        } else {
          const res = await withGmail(user, async (gmail) => {
            return await gmail.users.messages.get({
              userId: "me",
              id: messageId,
              format: "full",
            });
          });
          emailMessage = res?.data;
        }
      } catch (fetchErr) {
        const is404 =
          fetchErr.code === 404 ||
          fetchErr.status === 404 ||
          fetchErr.response?.status === 404 ||
          /not found/i.test(fetchErr.message || "");

        if (is404) {
          messageGone = true;
        } else {
          console.warn(
            `[backfill-summaries] Failed to fetch message ${messageId}:`,
            fetchErr.message
          );
          stats.errors.push(
            `Failed to fetch message ${messageId}: ${fetchErr.message}`
          );
          continue;
        }
      }

      if (messageGone || !emailMessage) {
        turn.incomingSummary = SUMMARY_UNAVAILABLE_MESSAGE;
        stats.summariesUnavailable++;
        docModified = true;
        continue;
      }

      // Extract details
      const subject =
        getHeader(emailMessage, "Subject") ||
        turn.incomingSubject ||
        doc.subject ||
        "";
      const from =
        getHeader(emailMessage, "From") ||
        turn.from ||
        doc.to ||
        "";
      const snippet = emailMessage.snippet || turn.incomingSnippet || "";
      const rawBody = textFromPayload(emailMessage.payload) || snippet;
      const bodyText = stripQuotedAndHtml(rawBody || snippet);

      // Summarise with Ollama (rate-limited)
      try {
        const summary = await ollamaSummarizer({ from, subject, bodyText });
        turn.incomingSummary = summary || snippet || "Incoming email message.";
        stats.summariesGenerated++;
        docModified = true;

        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (aiErr) {
        console.warn(
          `[backfill-summaries] Ollama summarization failed for turn in doc ${doc._id}:`,
          aiErr.message
        );
        stats.errors.push(
          `Ollama summarization error for doc ${doc._id}: ${aiErr.message}`
        );
      }
    }

    if (docModified) {
      // Keep top-level summary updated with latest turn's summary
      const latestTurn = doc.turns[doc.turns.length - 1];
      if (latestTurn?.incomingSummary) {
        doc.summary = latestTurn.incomingSummary;
      }

      if (!dryRun) {
        await doc.save();
      }
      stats.docsUpdated++;
    }
  }

  console.log("[backfill-summaries] Backfill complete. Summary report:");
  console.log(`- Documents scanned:     ${stats.totalDocsScanned}`);
  console.log(`- Turns scanned:         ${stats.totalTurnsScanned}`);
  console.log(`- Summaries generated:   ${stats.summariesGenerated}`);
  console.log(`- Summaries unavailable: ${stats.summariesUnavailable}`);
  console.log(`- Turns skipped:         ${stats.turnsSkipped}`);
  console.log(`- Documents updated:     ${stats.docsUpdated} (dryRun: ${dryRun})`);
  console.log(`- Errors encountered:    ${stats.errors.length}`);

  return stats;
}

/**
 * CLI entrypoint.
 */
async function runCli() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : null;

  const delayIdx = args.indexOf("--delay");
  const delayMs = delayIdx !== -1 && args[delayIdx + 1] ? parseInt(args[delayIdx + 1], 10) : 500;

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("ERROR: MONGO_URI environment variable is not set.");
    process.exit(1);
  }

  console.log("[backfill-summaries] Connecting to database...");
  await mongoose.connect(mongoUri);

  try {
    const stats = await backfillSummaries({ dryRun, limit, delayMs });
    if (stats.errors.length > 0 && stats.summariesGenerated === 0 && stats.summariesUnavailable === 0) {
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule =
  process.argv[1] &&
  url.fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  runCli().catch((err) => {
    console.error("[backfill-summaries] Fatal error:", err);
    process.exit(1);
  });
}
