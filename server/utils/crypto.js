import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";

let fallbackTestKey = null;

function getEncryptionKey(keyHex) {
  if (keyHex) return keyHex;
  if (process.env.TOKEN_ENCRYPTION_KEY) return process.env.TOKEN_ENCRYPTION_KEY;
  // If running in isolated test or script without env.js loaded, use an in-memory key
  if (!fallbackTestKey) {
    fallbackTestKey = crypto.randomBytes(32).toString("hex");
  }
  return fallbackTestKey;
}

/**
 * Encrypt a plaintext token using AES-256-GCM.
 * Stored as: enc:v1:<iv>:<tag>:<ciphertext> (all base64url encoded).
 */
export function encryptToken(plaintext, keyHex) {
  if (!plaintext || typeof plaintext !== "string") {
    return plaintext;
  }

  // Already encrypted
  if (plaintext.startsWith(PREFIX)) {
    return plaintext;
  }

  const effectiveKey = getEncryptionKey(keyHex);
  if (!effectiveKey) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required to encrypt tokens");
  }

  const key = Buffer.from(effectiveKey, "hex");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a 32-byte hex string (64 characters)");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

/**
 * Decrypt an AES-256-GCM encrypted token.
 * Throws if the data is tampered or key is wrong.
 */
export function decryptToken(encryptedString, keyHex) {
  if (!encryptedString || typeof encryptedString !== "string") {
    return encryptedString;
  }

  // If not encrypted with v1 prefix, return as-is (legacy unencrypted)
  if (!encryptedString.startsWith(PREFIX)) {
    return encryptedString;
  }

  const effectiveKey = getEncryptionKey(keyHex);
  if (!effectiveKey) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required to decrypt tokens");
  }

  const key = Buffer.from(effectiveKey, "hex");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a 32-byte hex string (64 characters)");
  }

  const parts = encryptedString.split(":");
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}:` !== PREFIX) {
    throw new Error("Invalid encrypted token format");
  }

  const [, , ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ciphertext = Buffer.from(ctB64, "base64url");

  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("Invalid IV or authentication tag length");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return plaintext.toString("utf8");
}

/**
 * Safely decrypt a user's refresh token.
 * If tampered data or wrong key: does NOT crash the app, logs one line,
 * sets user.needsRelogin = true, and returns null.
 */
export function decryptUserRefreshToken(user) {
  if (!user || !user.refreshToken) {
    return null;
  }

  try {
    return decryptToken(user.refreshToken);
  } catch (err) {
    const userIdentifier = user._id || user.email || "unknown";
    console.error(
      `[auth] Refresh token decryption failed for user ${userIdentifier}. The encryption key may have changed or stored token is corrupted. Please sign in again.`
    );
    user.needsRelogin = true;
    user.syncStatus = "error";
    user.syncError = "Authentication expired: could not decrypt stored credentials. Please sign in again.";
    if (typeof user.save === "function") {
      user.save().catch(() => {});
    }
    return null;
  }
}

/**
 * Safely encrypt and store a user's refresh token.
 */
export function setUserRefreshToken(user, rawRefreshToken) {
  if (!user) return;
  if (!rawRefreshToken) {
    user.refreshToken = null;
    return;
  }
  user.refreshToken = encryptToken(rawRefreshToken);
}
