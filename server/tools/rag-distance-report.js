import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import "dotenv/config";

import User from "../models/User.js";
import { generateQueryEmbedding } from "../services/embedding.service.js";
import { searchKnowledge } from "../services/vectorStore.service.js";

/**
 * Generate a calibration report of RAG distances for a labeled evaluation set.
 * Reads [{subject, body, expected: "match" | "no_match"}], runs vector search
 * against the knowledge documents attached to the target label, prints per-email
 * best chunk distance, and summarizes min/max/suggested threshold.
 *
 * Strictly read-only: does NOT send or create anything.
 */
export async function generateRagDistanceReport({
  dataset,
  labelIdOrName,
  userId = null,
  logFn = console.log
}) {
  let user = null;
  let targetLabel = null;

  if (userId) {
    user = await User.findById(userId).lean();
    if (!user) {
      user = await User.findOne({ email: userId }).lean();
    }
  }

  if (user) {
    targetLabel = user.labels?.find(
      (l) =>
        String(l._id) === String(labelIdOrName) ||
        l.id === String(labelIdOrName) ||
        l.name?.trim().toLowerCase() === String(labelIdOrName).trim().toLowerCase()
    );
  } else {
    // Search across all users
    const users = await User.find({ "labels.0": { $exists: true } }).lean();
    for (const u of users) {
      const match = u.labels?.find(
        (l) =>
          String(l._id) === String(labelIdOrName) ||
          l.id === String(labelIdOrName) ||
          l.name?.trim().toLowerCase() === String(labelIdOrName).trim().toLowerCase()
      );
      if (match) {
        user = u;
        targetLabel = match;
        break;
      }
    }
  }

  if (!targetLabel) {
    throw new Error(`Label '${labelIdOrName}' not found`);
  }

  const effectiveUserId = String(user._id);
  const docIds = Array.isArray(targetLabel.knowledgeDocumentIds)
    ? targetLabel.knowledgeDocumentIds.map(String).filter(Boolean)
    : [];

  logFn("========================================================");
  logFn(`RAG DISTANCE CALIBRATION REPORT`);
  logFn(`Label: "${targetLabel.name}" (ID: ${targetLabel.id || targetLabel._id})`);
  logFn(`User: ${user.email} (${effectiveUserId})`);
  logFn(`Attached Knowledge Document IDs: [${docIds.join(", ")}]`);
  logFn(`Total Dataset Items: ${dataset.length}`);
  logFn("========================================================\n");

  if (docIds.length === 0) {
    logFn("⚠️ Warning: Label has no knowledge documents attached. All distances will be undefined.\n");
  }

  const results = [];
  const matchDistances = [];
  const noMatchDistances = [];

  for (let i = 0; i < dataset.length; i++) {
    const item = dataset[i];
    const emailIndex = i + 1;
    const expected = item.expected === "match" ? "match" : "no_match";
    const subject = item.subject || "";
    const body = item.body || "";
    const emailText = [subject, body].filter(Boolean).join("\n\n");

    let bestDistance = null;
    let bestChunk = null;

    if (docIds.length > 0 && emailText.trim()) {
      try {
        const queryVector = await generateQueryEmbedding(emailText);
        const chunks = await searchKnowledge({
          userId: effectiveUserId,
          documentIds: docIds,
          queryVector,
          limit: 10
        });

        if (chunks && chunks.length > 0) {
          for (const c of chunks) {
            const dist = typeof c._distance === "number" ? c._distance : null;
            if (dist !== null) {
              if (bestDistance === null || dist < bestDistance) {
                bestDistance = dist;
                bestChunk = c;
              }
            }
          }
        }
      } catch (err) {
        logFn(`  [Email #${emailIndex}] Error running searchKnowledge: ${err.message}`);
      }
    }

    results.push({
      index: emailIndex,
      subject,
      expected,
      bestDistance,
      bestChunkFile: bestChunk?.fileName || null,
      bestChunkIndex: bestChunk?.chunkIndex ?? null
    });

    if (bestDistance !== null) {
      if (expected === "match") {
        matchDistances.push(bestDistance);
      } else {
        noMatchDistances.push(bestDistance);
      }
    }

    const distDisplay = bestDistance !== null ? bestDistance.toFixed(4) : "N/A";
    const chunkInfo = bestChunk ? ` (${bestChunk.fileName || "doc"} #${bestChunk.chunkIndex})` : "";
    logFn(
      `Email #${emailIndex} | Expected: ${expected.padEnd(8)} | Best Chunk Dist: ${distDisplay}${chunkInfo} | Subject: "${subject.slice(0, 40)}"`
    );
  }

  // Summary analysis
  const calcStats = (arr) => {
    if (arr.length === 0) return { count: 0, min: null, max: null, avg: null };
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const sum = arr.reduce((acc, v) => acc + v, 0);
    const avg = sum / arr.length;
    return { count: arr.length, min, max, avg };
  };

  const matchStats = calcStats(matchDistances);
  const noMatchStats = calcStats(noMatchDistances);

  logFn("\n--------------------------------------------------------");
  logFn("SUMMARY STATISTICS");
  logFn("--------------------------------------------------------");
  logFn(
    `MATCH group    (n=${matchStats.count}): min=${matchStats.min !== null ? matchStats.min.toFixed(4) : "N/A"}, max=${matchStats.max !== null ? matchStats.max.toFixed(4) : "N/A"}, avg=${matchStats.avg !== null ? matchStats.avg.toFixed(4) : "N/A"}`
  );
  logFn(
    `NO_MATCH group (n=${noMatchStats.count}): min=${noMatchStats.min !== null ? noMatchStats.min.toFixed(4) : "N/A"}, max=${noMatchStats.max !== null ? noMatchStats.max.toFixed(4) : "N/A"}, avg=${noMatchStats.avg !== null ? noMatchStats.avg.toFixed(4) : "N/A"}`
  );

  let suggestedThreshold = null;
  if (matchStats.count > 0 && noMatchStats.count > 0) {
    if (matchStats.max < noMatchStats.min) {
      // Clear separation between match and no_match
      suggestedThreshold = (matchStats.max + noMatchStats.min) / 2;
      logFn(`\nSuggested Threshold: ${suggestedThreshold.toFixed(4)} (Clean separation between max match and min no_match)`);
    } else {
      // Overlap present - suggest midpoint between averages
      suggestedThreshold = (matchStats.avg + noMatchStats.avg) / 2;
      logFn(`\nSuggested Threshold: ${suggestedThreshold.toFixed(4)} (Midpoint between average match and no_match; note overlap: match max=${matchStats.max.toFixed(4)} >= no_match min=${noMatchStats.min.toFixed(4)})`);
    }
  } else if (matchStats.count > 0) {
    suggestedThreshold = matchStats.max + 0.05;
    logFn(`\nSuggested Threshold: ${suggestedThreshold.toFixed(4)} (Based on match max + 0.05 margin)`);
  } else if (noMatchStats.count > 0) {
    suggestedThreshold = Math.max(0, noMatchStats.min - 0.05);
    logFn(`\nSuggested Threshold: ${suggestedThreshold.toFixed(4)} (Based on no_match min - 0.05 margin)`);
  } else {
    suggestedThreshold = 0.5;
    logFn(`\nSuggested Threshold: 0.5000 (Default; insufficient distance data)`);
  }
  logFn("========================================================\n");

  return {
    label: targetLabel.name,
    matchStats,
    noMatchStats,
    suggestedThreshold: suggestedThreshold !== null ? Number(suggestedThreshold.toFixed(4)) : 0.5,
    results
  };
}

async function cli() {
  const args = process.argv.slice(2);
  let filePath = null;
  let labelArg = null;
  let userArg = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) {
      filePath = args[++i];
    } else if (args[i] === "--label" && args[i + 1]) {
      labelArg = args[++i];
    } else if (args[i] === "--user" && args[i + 1]) {
      userArg = args[++i];
    } else if (!filePath) {
      filePath = args[i];
    } else if (!labelArg) {
      labelArg = args[i];
    }
  }

  if (!filePath || !labelArg) {
    console.error("Usage: node server/tools/rag-distance-report.js <dataset.json> <labelIdOrName> [--user <userIdOrEmail>]");
    console.error("Example: node server/tools/rag-distance-report.js eval-emails.json Support");
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: Dataset file not found at ${resolvedPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const dataset = JSON.parse(raw);
  if (!Array.isArray(dataset)) {
    console.error("Error: Dataset JSON must be an array of [{subject, body, expected}]");
    process.exit(1);
  }

  if (mongoose.connection.readyState === 0) {
    const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/mailpilot";
    await mongoose.connect(mongoUri);
  }

  try {
    await generateRagDistanceReport({
      dataset,
      labelIdOrName: labelArg,
      userId: userArg
    });
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain || process.argv[1]?.endsWith("rag-distance-report.js")) {
  cli().catch((err) => {
    console.error("Calibration report failed:", err.message);
    process.exit(1);
  });
}

