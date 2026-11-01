// server/tools/migrate-email-actions.js
import url from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import EmailAction from "../models/EmailAction.js";

dotenv.config();

/**
 * Builds turns from a group of old EmailAction documents belonging to the same (userId, threadId).
 * @param {Array<object>} groupDocs - Old EmailAction documents sorted by createdAt ascending
 * @returns {Array<object>} - Array of turns
 */
export function buildTurnsFromGroup(groupDocs) {
  const turns = [];
  const seenIncomingMessageIds = new Set();

  for (const doc of groupDocs) {
    // 1. Map any previous incoming turns preserved only in conversationHistory
    if (Array.isArray(doc.conversationHistory) && doc.conversationHistory.length > 0) {
      for (const item of doc.conversationHistory) {
        if (
          item.role === "incoming" &&
          item.messageId &&
          item.messageId !== doc.sourceMessageId &&
          !seenIncomingMessageIds.has(item.messageId)
        ) {
          seenIncomingMessageIds.add(item.messageId);
          turns.push({
            incomingMessageId: item.messageId,
            from: doc.to || "",
            receivedAt: item.timestamp ? new Date(item.timestamp) : (doc.createdAt ? new Date(doc.createdAt) : new Date()),
            incomingSubject: doc.subject || "",
            incomingSnippet: "",
            incomingSummary: item.content || "",
            label: doc.label || "",
            outcome: "labeled",
            failureReason: null
          });
        }
      }
    }

    // 2. Map this old doc itself to a turn
    const incomingMessageId = doc.sourceMessageId || null;
    if (incomingMessageId) {
      seenIncomingMessageIds.add(incomingMessageId);
    }

    // Outgoing side mapping
    let outgoing = null;
    const hasOutgoing =
      Boolean(doc.body) ||
      doc.type === "draft" ||
      doc.type === "reply" ||
      Boolean(doc.gmailDraftId) ||
      Boolean(doc.gmailMessageId);

    if (hasOutgoing) {
      const kind = doc.type === "reply" ? "reply" : "draft";
      let outgoingStatus = "draft";

      if (doc.status === "sent") outgoingStatus = "sent";
      else if (doc.status === "sending") outgoingStatus = "sending";
      else if (doc.status === "send_failed") outgoingStatus = "failed";
      else if (doc.status === "superseded") outgoingStatus = "superseded";
      else if (doc.status === "deleted") outgoingStatus = "deleted";
      else if (doc.status === "draft") outgoingStatus = "draft";
      else if (kind === "reply") outgoingStatus = "sent";

      // Best effort fallback to conversationHistory content if body is empty
      let outgoingBody = doc.body || "";
      if (!outgoingBody && Array.isArray(doc.conversationHistory)) {
        const histOutgoing = doc.conversationHistory.find((h) => h.role === "outgoing");
        if (histOutgoing && histOutgoing.content) {
          outgoingBody = histOutgoing.content;
        }
      }

      outgoing = {
        kind,
        body: outgoingBody,
        bodyHtml: "",
        status: outgoingStatus,
        gmailDraftId: doc.gmailDraftId || null,
        gmailMessageId: doc.gmailMessageId || null,
        sentAt: doc.sentAt
          ? new Date(doc.sentAt)
          : outgoingStatus === "sent"
          ? (doc.updatedAt ? new Date(doc.updatedAt) : new Date(doc.createdAt || Date.now()))
          : null,
        composedManually: false,
        inReplyTo: doc.sourceMessageId || null,
        references: ""
      };
    }

    // Outcome mapping
    let outcome = "labeled";
    if (outgoing) {
      if (outgoing.status === "sent") outcome = "sent";
      else if (outgoing.status === "draft" || outgoing.status === "sending") outcome = "drafted";
      else if (outgoing.status === "failed") outcome = "failed";
      else if (outgoing.status === "superseded") outcome = "drafted";
    }
    if (doc.type === "none") outcome = "none";
    if (doc.type === "failed" || doc.status === "send_failed") outcome = "failed";

    // Summary fallback to conversationHistory if empty
    let summary = doc.summary || "";
    if (!summary && Array.isArray(doc.conversationHistory)) {
      const histIncoming = doc.conversationHistory.find(
        (h) => h.role === "incoming" && (!h.messageId || h.messageId === doc.sourceMessageId)
      );
      if (histIncoming && histIncoming.content) {
        summary = histIncoming.content;
      }
    }

    turns.push({
      incomingMessageId,
      from: doc.to || "",
      receivedAt: doc.createdAt ? new Date(doc.createdAt) : new Date(),
      incomingSubject: doc.subject || "",
      incomingSnippet: "",
      incomingSummary: summary,
      label: doc.label || "",
      outcome,
      failureReason: doc.failureReason || null,
      ...(outgoing ? { outgoing } : {})
    });
  }

  return turns;
}

/**
 * Derives top-level fields for the unified EmailAction document from its turns array.
 * @param {Array<object>} turns
 * @param {Array<object>} sortedDocs
 * @returns {object} - { status, type, label, checked }
 */
export function deriveTopLevelFields(turns, sortedDocs) {
  const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  let topStatus = "unread";
  let topType = "none";

  if (latestTurn) {
    if (latestTurn.outcome === "failed" || latestTurn.outcome === "needs_manual") {
      topStatus = "failed";
      topType = "failed";
    } else if (latestTurn.outgoing) {
      topType = latestTurn.outgoing.kind;
      if (latestTurn.outgoing.status === "sent") {
        topStatus = "sent";
      } else if (latestTurn.outgoing.status === "draft" || latestTurn.outgoing.status === "sending") {
        topStatus = "draft";
      } else if (latestTurn.outgoing.status === "failed") {
        topStatus = "failed";
      } else {
        topStatus = "draft";
      }
    } else if (latestTurn.outcome === "none") {
      topType = "none";
      topStatus = "reviewed";
    }
  }

  const isChecked = sortedDocs.some((d) => d.checked === true);
  const latestLabel =
    (latestTurn && latestTurn.label) || sortedDocs[sortedDocs.length - 1].label || "";

  return {
    status: topStatus,
    type: topType,
    label: latestLabel,
    checked: isChecked
  };
}

/**
 * Executes or simulates EmailAction migration.
 * @param {object} options
 * @param {boolean} options.dryRun
 * @param {object} options.model - Mongoose EmailAction model
 * @param {object} options.connection - Mongoose connection or collection
 * @param {object} options.logger - Logging facility
 */
export async function migrateEmailActions({
  dryRun = false,
  model = EmailAction,
  connection = mongoose.connection,
  logger = console
} = {}) {
  logger.log(`\n=== EmailAction Migration (${dryRun ? "DRY RUN" : "LIVE"}) ===`);

  // 1. Fetch all documents
  const allDocs = await model.find({}).lean();
  const totalDocs = allDocs.length;
  logger.log(`Found ${totalDocs} total EmailAction documents.`);

  // 2. Group by (userId, threadId)
  const groups = new Map();
  for (const doc of allDocs) {
    const uId = doc.userId ? doc.userId.toString() : "unknown";
    const tId = doc.threadId || doc.sourceMessageId || (doc._id ? doc._id.toString() : "unknown");
    const key = `${uId}:::${tId}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(doc);
  }

  const threadCount = groups.size;
  let groupsNeedingMerges = 0;
  let alreadyMigratedGroups = 0;
  let groupsToMigrate = 0;

  for (const [, docsInGroup] of groups) {
    if (docsInGroup.length > 1) {
      groupsNeedingMerges++;
    }
    // Check if target is already migrated
    const targetDoc = docsInGroup[0];
    if (targetDoc.turns && targetDoc.turns.length > 0) {
      alreadyMigratedGroups++;
    } else {
      groupsToMigrate++;
    }
  }

  logger.log(`Total threads (groups): ${threadCount}`);
  logger.log(`Groups needing merges (>1 doc): ${groupsNeedingMerges}`);
  logger.log(`Groups already migrated: ${alreadyMigratedGroups}`);
  logger.log(`Groups to migrate: ${groupsToMigrate}`);

  // 3. Process each group
  let mergedGroupsCount = 0;
  let skippedDocsCount = 0;
  let deletedDocsCount = 0;
  let failedCount = 0;

  for (const [groupKey, groupDocs] of groups) {
    try {
      // Sort docs by createdAt ascending
      const sortedDocs = [...groupDocs].sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tA - tB;
      });

      const targetDoc = sortedDocs[0];

      // Idempotency check: if target already has turns > 0, skip
      if (targetDoc.turns && targetDoc.turns.length > 0) {
        skippedDocsCount += groupDocs.length;
        continue;
      }

      // Build turns and top-level fields
      const turns = buildTurnsFromGroup(sortedDocs);
      const topFields = deriveTopLevelFields(turns, sortedDocs);

      const [uId, tId] = groupKey.split(":::");
      const duplicateDocIds = sortedDocs.slice(1).map((d) => d._id);

      if (!dryRun) {
        // Update target document
        await model.updateOne(
          { _id: targetDoc._id },
          {
            $set: {
              threadId: targetDoc.threadId || tId,
              turns,
              status: topFields.status,
              type: topFields.type,
              label: topFields.label,
              checked: topFields.checked
            }
          }
        );

        // Delete duplicates if there were multiple docs
        if (duplicateDocIds.length > 0) {
          await model.deleteMany({ _id: { $in: duplicateDocIds } });
          deletedDocsCount += duplicateDocIds.length;
        }
      } else {
        if (duplicateDocIds.length > 0) {
          deletedDocsCount += duplicateDocIds.length;
        }
      }

      mergedGroupsCount++;
    } catch (err) {
      logger.error(`Failed migrating group ${groupKey}:`, err);
      failedCount++;
    }
  }

  // 4. Index changes
  const oldIndexSpec = "{ userId: 1, sourceMessageId: 1, type: 1 }";
  const newIndexSpec = "{ userId: 1, threadId: 1 } (unique)";

  if (dryRun) {
    logger.log("\nPlanned index changes (dry-run, not executed):");
    logger.log(`  - Drop old unique index: ${oldIndexSpec}`);
    logger.log(`  - Create new unique index: ${newIndexSpec}`);
  } else {
    logger.log("\nExecuting index changes...");
    try {
      const collection = model.collection || (connection.db && connection.db.collection("emailactions"));
      if (collection && typeof collection.indexes === "function") {
        const existingIndexes = await collection.indexes();
        const oldIndex = existingIndexes.find((idx) => {
          const keys = idx.key || {};
          return keys.userId === 1 && keys.sourceMessageId === 1 && keys.type === 1;
        });

        if (oldIndex) {
          logger.log(`Dropping old index: ${oldIndex.name}...`);
          await collection.dropIndex(oldIndex.name);
          logger.log("Old index dropped successfully.");
        } else {
          logger.log("Old index { userId, sourceMessageId, type } not found; skipping drop.");
        }

        logger.log("Creating new unique index { userId: 1, threadId: 1 }...");
        await collection.createIndex({ userId: 1, threadId: 1 }, { unique: true });
        logger.log("New unique index created successfully.");
      } else {
        logger.log("Note: Collection index methods not available in this environment.");
      }
    } catch (indexErr) {
      logger.error("Error modifying indexes:", indexErr);
      failedCount++;
    }
  }

  // 5. Summary
  logger.log("\n=== Migration Summary ===");
  logger.log(`Mode: ${dryRun ? "DRY RUN (no writes performed)" : "LIVE MIGRATION"}`);
  logger.log(`Total documents inspected: ${totalDocs}`);
  logger.log(`Total threads: ${threadCount}`);
  logger.log(`Groups merged/migrated: ${mergedGroupsCount}`);
  logger.log(`Groups skipped (already migrated): ${alreadyMigratedGroups}`);
  logger.log(`Duplicate documents deleted: ${deletedDocsCount}`);
  logger.log(`Failures: ${failedCount}`);

  if (failedCount > 0) {
    const errorMsg = `Migration completed with ${failedCount} failure(s).`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  return {
    totalDocs,
    threadCount,
    groupsNeedingMerges,
    mergedGroupsCount,
    alreadyMigratedGroups,
    deletedDocsCount,
    failedCount
  };
}

/**
 * CLI Entry point
 */
async function runCli() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: node server/tools/migrate-email-actions.js [--dry-run]");
    console.log("Migrates legacy flat EmailAction documents to conversation turns schema.");
    process.exit(0);
  }

  const isDryRun = process.argv.includes("--dry-run");

  if (!process.env.MONGO_URI) {
    console.error("Error: MONGO_URI environment variable is required to run migration.");
    process.exit(1);
  }

  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB.");

    await migrateEmailActions({ dryRun: isDryRun });

    await mongoose.disconnect();
    console.log("Disconnected from MongoDB. Done.");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err.message);
    if (mongoose.connection.readyState !== 0) {
      try {
        await mongoose.disconnect();
      } catch {}
    }
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  (process.argv[1] === url.fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith("migrate-email-actions.js"));

if (isMain) {
  runCli();
}

