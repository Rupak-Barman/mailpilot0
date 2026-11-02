#!/usr/bin/env node
// scripts/setup.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const serverDir = path.join(rootDir, "server");
const frontendDir = path.join(rootDir, "frontend");

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function ensureEnvFile(targetPath, examplePath, label) {
  if (fs.existsSync(targetPath)) {
    console.log(`[setup] ${label} already exists (preserved, not overwritten).`);
    return false;
  }
  if (!fs.existsSync(examplePath)) {
    console.warn(`[setup] Warning: Example template not found at ${examplePath}`);
    return false;
  }
  fs.copyFileSync(examplePath, targetPath);
  console.log(`[setup] Created ${label} from template.`);
  return true;
}

function installDependencies(dir, label) {
  const hasLock = fs.existsSync(path.join(dir, "package-lock.json"));
  const hasModules = fs.existsSync(path.join(dir, "node_modules"));

  const useCi = hasLock && !hasModules;
  const commandArgs = useCi ? ["ci"] : ["install"];

  console.log(`\n[setup] Installing dependencies in ${label} using 'npm ${commandArgs.join(" ")}'...`);

  const result = spawnSync(npmCmd, commandArgs, {
    cwd: dir,
    stdio: "inherit",
    shell: true
  });

  if (result.status !== 0) {
    console.error(`[setup] Failed to install dependencies in ${label} (exit code ${result.status}).`);
    process.exit(result.status || 1);
  }
  console.log(`[setup] Dependencies in ${label} installed successfully.`);
}

function parseEnvValue(content, key, defaultValue) {
  const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m"));
  if (match && match[1]) {
    const val = match[1].trim();
    if (val) return val;
  }
  return defaultValue;
}

function main() {
  console.log("================================================================================");
  console.log("                       Mailpilot Local Setup Initializer                        ");
  console.log("================================================================================\n");

  // 1. Ensure server/.env and frontend/.env exist (idempotent, never overwrite)
  const serverEnv = path.join(serverDir, ".env");
  const serverEnvExample = path.join(serverDir, ".env.example");
  ensureEnvFile(serverEnv, serverEnvExample, "server/.env");

  const frontendEnv = path.join(frontendDir, ".env");
  const frontendEnvExample = path.join(frontendDir, ".env.example");
  ensureEnvFile(frontendEnv, frontendEnvExample, "frontend/.env");

  // 2. Install dependencies (server, frontend, and root if package.json exists)
  installDependencies(serverDir, "server");
  installDependencies(frontendDir, "frontend");

  if (fs.existsSync(path.join(rootDir, "package.json"))) {
    const rootHasModules = fs.existsSync(path.join(rootDir, "node_modules"));
    if (!rootHasModules) {
      installDependencies(rootDir, "root");
    }
  }

  // 3. Read configuration for guidance summary
  let serverEnvContent = "";
  if (fs.existsSync(serverEnv)) {
    serverEnvContent = fs.readFileSync(serverEnv, "utf8");
  } else if (fs.existsSync(serverEnvExample)) {
    serverEnvContent = fs.readFileSync(serverEnvExample, "utf8");
  }

  const llmModel = parseEnvValue(serverEnvContent, "OLLAMA_LLM_MODEL", "qwen2.5:7b");
  const embeddingModel = parseEnvValue(serverEnvContent, "OLLAMA_EMBEDDING_MODEL", "embeddinggemma-2:270m");
  const port = parseEnvValue(serverEnvContent, "PORT", "3000");
  const baseUrl = parseEnvValue(serverEnvContent, "BASE_URL", `http://localhost:${port}`);
  const redirectUri = `${baseUrl.replace(/\/+$/, "")}/auth/google/callback`;

  // 4. Print checklist
  console.log("\n================================================================================");
  console.log("                           Setup Complete: Next Steps                           ");
  console.log("================================================================================");
  console.log("Please complete the following checklist before launching Mailpilot:\n");

  console.log("1. Google Cloud OAuth Credentials (server/.env):");
  console.log("   - Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  console.log(`   - Register Authorized Redirect URI in Google Cloud Console:`);
  console.log(`       ${redirectUri}\n`);

  console.log("2. MongoDB Database:");
  console.log("   - Start MongoDB locally or run via Docker Compose:");
  console.log("       npm run db:up\n");

  console.log("3. Local AI Models (Ollama):");
  console.log("   - Start Ollama service (ollama serve), then pull configured models:");
  console.log(`       ollama pull ${llmModel}`);
  console.log(`       ollama pull ${embeddingModel}\n`);

  console.log("4. Verify Environment & Diagnostics:");
  console.log("   - Run the health check doctor:");
  console.log("       npm run doctor\n");

  console.log("5. Start Mailpilot:");
  console.log("   - Development mode (backend + frontend with live reload):");
  console.log("       npm run dev");
  console.log("   - Production mode (builds frontend and runs together):");
  console.log("       npm start");
  console.log("================================================================================\n");
}

main();

