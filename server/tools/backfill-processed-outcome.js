// server/tools/backfill-processed-outcome.js
import url from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import ProcessedEmail from "../models/ProcessedEmail.js";

dotenv.config();

/**
 * Determine outcome and resolution from legacy action and status fields.
 */
export function determineOutcome(doc) {
  if (doc.status === "failed") {
    return { outcome: "failed" };
  }

  switch (doc.action) {
    case "draft":
      return {
        outcome: "drafted",
        ...(doc.resolution ? {} : { resolution: "none" })
      };
    case "reply":
      return {
        outcome: "sent",
        ...(doc.resolution ? {} : { resolution: "ai_reply_sent" })
      };
    case "none":
      return {
        outcome: "labeled",
        ...(doc.resolution ? {} : { resolution: "none" })
      };
    default:
      return {
        outcome: "labeled",
        ...(doc.resolution ? {} : { resolution: "none" })
      };
  }
}

/**
 * Backfill missing or unmigrated outcomes on ProcessedEmail documents.
 */
export async function backfillProcessedOutcomes({ dryRun = false } = {}) {
  const query = {
    $or: [
      { outcome: { $exists: false } },
      { outcome: null },
      { outcome: "none", action: { $in: ["draft", "reply"] } }
    ]
  };

  const total = await ProcessedEmail.countDocuments(query);
  console.log(`Found ${total} ProcessedEmail records requiring outcome backfill.`);

  if (total === 0) {
    console.log("No records need backfilling.");
    return { total: 0, updated: 0 };
  }

  if (dryRun) {
    console.log(`[DRY RUN] Would update ${total} records. No changes written.`);
    return { total, updated: 0, dryRun: true };
  }

  const cursor = ProcessedEmail.find(query).cursor();
  let updated = 0;

  for await (const doc of cursor) {
    const patch = determineOutcome(doc);
    await ProcessedEmail.updateOne({ _id: doc._id }, { $set: patch });
    updated++;
    if (updated % 100 === 0) {
      console.log(`Updated ${updated}/${total} records...`);
    }
  }

  console.log(`Successfully backfilled ${updated} ProcessedEmail records.`);
  return { total, updated, dryRun: false };
}

async function runCli() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: node server/tools/backfill-processed-outcome.js [--dry-run]");
    console.log("Backfills outcome and resolution fields on legacy ProcessedEmail records.");
    process.exit(0);
  }

  const isDryRun = process.argv.includes("--dry-run");

  if (!process.env.MONGO_URI) {
    console.error("Error: MONGO_URI environment variable is required to run backfill.");
    process.exit(1);
  }

  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB.");

    await backfillProcessedOutcomes({ dryRun: isDryRun });

    await mongoose.disconnect();
    console.log("Disconnected from MongoDB. Done.");
    process.exit(0);
  } catch (err) {
    console.error("Backfill failed:", err.message);
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
    process.argv[1].endsWith("backfill-processed-outcome.js"));

if (isMain) {
  runCli();
}
