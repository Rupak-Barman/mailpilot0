// server/tools/remove-always-cc.js
import url from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";

dotenv.config();

/**
 * Idempotently unsets settings.defaultCc and labels.$[elem].alwaysCc across all users.
 * Supports --dry-run to only inspect and report counts.
 */
export async function removeAlwaysCc({ dryRun = false, logger = console } = {}) {
  const usersWithDefaultCc = await User.countDocuments({
    "settings.defaultCc": { $exists: true }
  });

  const usersWithLabelAlwaysCc = await User.countDocuments({
    "labels.alwaysCc": { $exists: true }
  });

  logger.log(`Found ${usersWithDefaultCc} user(s) with settings.defaultCc.`);
  logger.log(`Found ${usersWithLabelAlwaysCc} user(s) with labels.alwaysCc.`);

  if (dryRun) {
    logger.log("Dry-run mode: no changes applied.");
    return {
      dryRun: true,
      usersWithDefaultCc,
      usersWithLabelAlwaysCc,
      modifiedCount: 0
    };
  }

  let defaultCcModified = 0;
  let labelCcModified = 0;

  if (usersWithDefaultCc > 0) {
    const defaultCcResult = await User.collection.updateMany(
      { "settings.defaultCc": { $exists: true } },
      { $unset: { "settings.defaultCc": "" } }
    );
    defaultCcModified = defaultCcResult.modifiedCount || 0;
  }
  logger.log(`Unset settings.defaultCc on ${defaultCcModified} user document(s).`);

  if (usersWithLabelAlwaysCc > 0) {
    const labelCcResult = await User.collection.updateMany(
      { "labels.alwaysCc": { $exists: true } },
      { $unset: { "labels.$[elem].alwaysCc": "" } },
      {
        arrayFilters: [{ "elem.alwaysCc": { $exists: true } }]
      }
    );
    labelCcModified = labelCcResult.modifiedCount || 0;
  }
  logger.log(`Unset labels.$[].alwaysCc on ${labelCcModified} user document(s).`);

  const totalModified = defaultCcModified + labelCcModified;
  logger.log(`Cleanup complete. Total updates performed: ${totalModified}.`);

  return {
    dryRun: false,
    usersWithDefaultCc,
    usersWithLabelAlwaysCc,
    modifiedCount: totalModified
  };
}

async function runCli() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: node server/tools/remove-always-cc.js [--dry-run]");
    console.log("Idempotently unsets deprecated settings.defaultCc and labels.alwaysCc across all users.");
    process.exit(0);
  }

  const isDryRun = process.argv.includes("--dry-run");

  if (!process.env.MONGO_URI) {
    console.error("Error: MONGO_URI environment variable is required.");
    process.exit(1);
  }

  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB.");

    await removeAlwaysCc({ dryRun: isDryRun });

    await mongoose.disconnect();
    console.log("Disconnected from MongoDB. Done.");
    process.exit(0);
  } catch (err) {
    console.error("Cleanup tool failed:", err.message);
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
    process.argv[1].endsWith("remove-always-cc.js"));

if (isMain) {
  runCli();
}

