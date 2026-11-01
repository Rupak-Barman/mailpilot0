import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, "..");
export const DEFAULT_ENV_FILE = path.join(SERVER_DIR, ".env");

/**
 * Load environment variables from .env file using an absolute path.
 */
export function loadDotenv(customPath) {
  const targetPath = customPath || process.env.DOTENV_CONFIG_PATH || DEFAULT_ENV_FILE;
  if (fs.existsSync(targetPath)) {
    dotenv.config({ path: targetPath, override: false });
  } else {
    // If no target file exists, still configure dotenv
    dotenv.config({ path: targetPath, override: false });
  }
  return targetPath;
}

/**
 * Append or save key-value pairs to .env file safely.
 */
function appendEnvVar(envFilePath, key, value) {
  let content = "";
  if (fs.existsSync(envFilePath)) {
    content = fs.readFileSync(envFilePath, "utf8");
  }

  const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  const entry = `${prefix}${key}=${value}\n`;

  fs.appendFileSync(envFilePath, entry, {
    encoding: "utf8",
    mode: 0o600
  });

  try {
    if (process.platform !== "win32") {
      fs.chmodSync(envFilePath, 0o600);
    }
  } catch {}
}

/**
 * Ensure JWT_SECRET and TOKEN_ENCRYPTION_KEY are set.
 * Auto-generates them and persists to .env if missing.
 */
export function ensureSecrets(envFilePath = DEFAULT_ENV_FILE) {
  // 1. JWT_SECRET
  if (!process.env.JWT_SECRET) {
    const generatedJwt = crypto.randomBytes(32).toString("hex");
    try {
      appendEnvVar(envFilePath, "JWT_SECRET", generatedJwt);
      process.env.JWT_SECRET = generatedJwt;
      console.log("Generated JWT_SECRET and saved it to .env");
    } catch (err) {
      process.env.JWT_SECRET = generatedJwt;
      console.warn(
        "[SECURITY WARNING] Failed to persist JWT_SECRET to .env. Using ephemeral in-memory secret; active user sessions will end upon server restart."
      );
    }
  }

  // 2. TOKEN_ENCRYPTION_KEY
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    const generatedKey = crypto.randomBytes(32).toString("hex");
    try {
      appendEnvVar(envFilePath, "TOKEN_ENCRYPTION_KEY", generatedKey);
      process.env.TOKEN_ENCRYPTION_KEY = generatedKey;
      console.log("Generated TOKEN_ENCRYPTION_KEY and saved it to .env");
    } catch (err) {
      console.error(
        "[FATAL ERROR] Failed to persist TOKEN_ENCRYPTION_KEY to .env.\n" +
        "An ephemeral encryption key cannot be used because stored OAuth tokens would become permanently unreadable after server restart.\n" +
        "Ensure the server folder is writable and retry."
      );
      process.exit(1);
    }
  }
}

/**
 * Validate truly mandatory external credentials:
 * ONLY GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and MONGO_URI.
 * Does NOT require JWT_SECRET, TOKEN_ENCRYPTION_KEY, or REFRESH_TOKEN_SECRET.
 */
export function validateRequiredEnv(options = {}) {
  const missing = [];

  if (!process.env.GOOGLE_CLIENT_ID) {
    missing.push({
      name: "GOOGLE_CLIENT_ID",
      source: "Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client IDs"
    });
  }

  if (!process.env.GOOGLE_CLIENT_SECRET) {
    missing.push({
      name: "GOOGLE_CLIENT_SECRET",
      source: "Google Cloud Console -> APIs & Services -> Credentials -> Client Secret"
    });
  }

  if (!process.env.MONGO_URI) {
    missing.push({
      name: "MONGO_URI",
      source: "MongoDB connection string (e.g. mongodb://127.0.0.1:27017/mailpilot)"
    });
  }

  if (missing.length > 0) {
    const lines = [
      "",
      "================================================================================",
      " Mailpilot Startup Error: Missing required environment variable(s)",
      "================================================================================",
      ...missing.map(
        (m) => `  * ${m.name.padEnd(22)}: ${m.source}`
      ),
      "",
      " Please create or update server/.env with these values.",
      " See server/.env.example for template and instructions.",
      "================================================================================",
      ""
    ];
    console.error(lines.join("\n"));
    if (!options.noExit) {
      process.exit(1);
    }
    return false;
  }

  return true;
}

// 1. Always load .env first using absolute path
const envFileUsed = loadDotenv();

// 2. Ensure secrets (auto-generate and persist if missing)
ensureSecrets(envFileUsed);

// 3. Defaults
export const HOST = process.env.HOST || "127.0.0.1";
export const PORT = parseInt(process.env.PORT, 10) || 3000;
export const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
export const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
export const OAUTH_CALLBACK_URL = `${BASE_URL}/auth/google/callback`;

// 4. Fail fast for missing required credentials in non-test runtime
if (process.env.NODE_ENV !== "test" && process.env.SKIP_ENV_VALIDATION !== "true") {
  validateRequiredEnv();
  // Print exact Google redirect URI to register at startup
  console.log(`[config] Google OAuth Redirect URI: ${OAUTH_CALLBACK_URL}`);
}

export default {
  HOST,
  PORT,
  CLIENT_URL,
  BASE_URL,
  OAUTH_CALLBACK_URL,
  loadDotenv,
  ensureSecrets,
  validateRequiredEnv
};
