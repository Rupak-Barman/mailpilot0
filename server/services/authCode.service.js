import crypto from "node:crypto";

const MAX_CODES = 1000;
const CODE_TTL_MS = 60 * 1000; // 60 seconds

// In-memory code store: code -> { userId, expiresAt }
const codeStore = new Map();

/**
 * Periodically purge expired codes to prevent memory leaks.
 */
function cleanupExpiredCodes() {
  const now = Date.now();
  for (const [code, entry] of codeStore.entries()) {
    if (entry.expiresAt <= now) {
      codeStore.delete(code);
    }
  }
}

// Background cleanup timer every 30 seconds (unref so it doesn't hold open Node process)
const cleanupTimer = setInterval(cleanupExpiredCodes, 30 * 1000);
if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

/**
 * Create a one-time authorization code for a user.
 */
export function createAuthCode(userId) {
  if (!userId) {
    throw new Error("userId is required to generate auth code");
  }

  // Cap size guard: if full, purge expired first
  if (codeStore.size >= MAX_CODES) {
    cleanupExpiredCodes();
    // If still at or over limit, evict oldest entries
    if (codeStore.size >= MAX_CODES) {
      const keysToEvict = Array.from(codeStore.keys()).slice(0, 100);
      for (const k of keysToEvict) {
        codeStore.delete(k);
      }
    }
  }

  const code = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + CODE_TTL_MS;

  codeStore.set(code, {
    userId: String(userId),
    expiresAt
  });

  return code;
}

/**
 * Exchange and immediately consume a one-time code.
 * Single use: deleted on retrieval.
 * Returns userId or null if invalid/expired/used.
 */
export function exchangeAuthCode(code) {
  if (!code || typeof code !== "string") {
    return null;
  }

  const entry = codeStore.get(code);
  if (!entry) {
    return null;
  }

  // Single use: delete immediately
  codeStore.delete(code);

  if (entry.expiresAt <= Date.now()) {
    return null;
  }

  return entry.userId;
}

/**
 * Helper for testing: get codeStore size.
 */
export function getCodeStoreSize() {
  return codeStore.size;
}

/**
 * Helper for testing: clear all codes.
 */
export function clearCodeStore() {
  codeStore.clear();
}

