#!/usr/bin/env node
// scripts/start.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const frontendDir = path.join(rootDir, "frontend");
const frontendDistIndex = path.join(frontendDir, "dist", "index.html");

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

// 1. Build frontend if frontend/dist is missing
if (!fs.existsSync(frontendDistIndex)) {
  console.log("[start] frontend/dist not found. Building frontend production bundle...");
  const buildResult = spawnSync(npmCmd, ["run", "build", "--prefix", "frontend"], {
    cwd: rootDir,
    stdio: "inherit",
    shell: true
  });

  if (buildResult.status !== 0) {
    console.error(`[start] Frontend build failed with exit code ${buildResult.status}.`);
    process.exit(buildResult.status || 1);
  }
  console.log("[start] Frontend build completed successfully.\n");
}

console.log("[start] Starting Mailpilot server and frontend preview concurrently...");

// 2. Run backend server and vite preview together (do NOT serve SPA from Express)
const result = spawnSync(
  npxCmd,
  [
    "concurrently",
    "--kill-others-on-fail",
    "-n", "server,frontend",
    "-c", "blue,magenta",
    "\"npm start --prefix server\"",
    "\"npm run preview --prefix frontend -- --host 127.0.0.1 --port 5173 --strictPort\""
  ],
  {
    cwd: rootDir,
    stdio: "inherit",
    shell: true
  }
);

process.exit(result.status || 0);

