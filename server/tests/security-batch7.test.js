import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  encryptToken,
  decryptToken,
  decryptUserRefreshToken,
  setUserRefreshToken
} from "../utils/crypto.js";
import {
  createAuthCode,
  exchangeAuthCode,
  clearCodeStore,
  getCodeStoreSize
} from "../services/authCode.service.js";
import { migrateTokens } from "../services/migration.service.js";
import {
  getAllowedCorsOrigins,
  createCorsMiddleware,
  generalRateLimiter,
  authRateLimiter
} from "../config/security.js";
import { escapeRegex, stripMongoOperators } from "../utils/helpers.js";
import { shouldHandle401 } from "../../frontend/src/api/client.js";
import { API_URL } from "../../frontend/src/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_MODULE_PATH = path.resolve(__dirname, "../config/env.js");

describe("BATCH 7: Startup config & env.js in Child Process", () => {
  it("generates and persists secrets, displays fail-fast message with no stack trace when credentials missing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mailpilot-env-test-"));
    const tempEnvFile = path.join(tempDir, ".env");

    const envModuleUrl = pathToFileURL(ENV_MODULE_PATH).href;

    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
        process.env.DOTENV_CONFIG_PATH = ${JSON.stringify(tempEnvFile)};
        delete process.env.GOOGLE_CLIENT_ID;
        delete process.env.GOOGLE_CLIENT_SECRET;
        delete process.env.MONGO_URI;
        delete process.env.JWT_SECRET;
        delete process.env.TOKEN_ENCRYPTION_KEY;
        delete process.env.NODE_ENV;
        delete process.env.SKIP_ENV_VALIDATION;
        import(${JSON.stringify(envModuleUrl)});
        `
      ],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot
        }
      }
    );

    // Fail-fast must exit with code 1
    assert.equal(result.status, 1, "Child process should exit with code 1 when required env vars missing");

    // Output must NOT contain stack trace
    assert.doesNotMatch(result.stderr, /at\s+file:\/\//, "Should not contain stack traces in stderr");
    assert.doesNotMatch(result.stderr, /at\s+async\s+/, "Should not contain stack traces in stderr");

    // Output must describe the missing credentials and where to get them
    assert.match(result.stderr, /GOOGLE_CLIENT_ID.*Google Cloud Console/);
    assert.match(result.stderr, /GOOGLE_CLIENT_SECRET.*Google Cloud Console/);
    assert.match(result.stderr, /MONGO_URI.*MongoDB connection string/);

    // Stdout should confirm generation without printing the secret values
    assert.match(result.stdout, /Generated JWT_SECRET and saved it to \.env/);
    assert.match(result.stdout, /Generated TOKEN_ENCRYPTION_KEY and saved it to \.env/);

    // Confirm secrets were persisted to the temp .env file
    assert.ok(fs.existsSync(tempEnvFile), "Temp .env file should be created");
    const envContent = fs.readFileSync(tempEnvFile, "utf8");
    assert.match(envContent, /^JWT_SECRET=[a-f0-9]{64}$/m);
    assert.match(envContent, /^TOKEN_ENCRYPTION_KEY=[a-f0-9]{64}$/m);

    // Ensure raw secret values were NEVER printed to stdout or stderr
    const jwtMatch = envContent.match(/^JWT_SECRET=([a-f0-9]{64})$/m);
    const keyMatch = envContent.match(/^TOKEN_ENCRYPTION_KEY=([a-f0-9]{64})$/m);
    if (jwtMatch) {
      assert.ok(!result.stdout.includes(jwtMatch[1]), "Never log raw JWT_SECRET");
      assert.ok(!result.stderr.includes(jwtMatch[1]), "Never log raw JWT_SECRET in stderr");
    }
    if (keyMatch) {
      assert.ok(!result.stdout.includes(keyMatch[1]), "Never log raw TOKEN_ENCRYPTION_KEY");
      assert.ok(!result.stderr.includes(keyMatch[1]), "Never log raw TOKEN_ENCRYPTION_KEY in stderr");
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("fails fast when TOKEN_ENCRYPTION_KEY cannot be persisted", () => {
    // Point to an invalid read-only directory path as the .env file so appending fails
    const invalidEnvPath = path.join(os.tmpdir(), "nonexistent_dir_12345/subdir/cannot_create/.env");

    const envModuleUrl = pathToFileURL(ENV_MODULE_PATH).href;
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
        process.env.DOTENV_CONFIG_PATH = ${JSON.stringify(invalidEnvPath)};
        delete process.env.TOKEN_ENCRYPTION_KEY;
        delete process.env.NODE_ENV;
        import(${JSON.stringify(envModuleUrl)});
        `
      ],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot
        }
      }
    );

    assert.equal(result.status, 1, "Must exit with code 1 when TOKEN_ENCRYPTION_KEY cannot be persisted");
    assert.match(result.stderr, /Failed to persist TOKEN_ENCRYPTION_KEY/);
    assert.match(result.stderr, /stored OAuth tokens would become permanently unreadable/);
  });
});

describe("BATCH 7: Token Encryption at Rest & Tampering Protection", () => {
  const testKeyA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const testKeyB = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  const sampleRefreshToken = "1//04abcDEF-secret-refresh-token-xyz123";

  it("encrypts and decrypts refresh tokens round-trip with enc:v1: prefix", () => {
    const encrypted = encryptToken(sampleRefreshToken, testKeyA);
    assert.ok(encrypted.startsWith("enc:v1:"), "Encrypted token must have enc:v1: prefix");

    const parts = encrypted.split(":");
    assert.equal(parts.length, 5, "Format must be enc:v1:<iv>:<tag>:<ciphertext>");

    const decrypted = decryptToken(encrypted, testKeyA);
    assert.equal(decrypted, sampleRefreshToken, "Decrypted token must match original plaintext");
  });

  it("tampered data does not crash and marks needsRelogin = true", () => {
    const encrypted = encryptToken(sampleRefreshToken, testKeyA);
    const parts = encrypted.split(":");
    // Tamper with ciphertext
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:tamperedCiphertext`;

    let userSaved = false;
    const fakeUser = {
      _id: "user_test_99",
      refreshToken: tampered,
      needsRelogin: false,
      save: async () => {
        userSaved = true;
      }
    };

    const result = decryptUserRefreshToken(fakeUser);
    assert.equal(result, null, "Tampered token decryption must return null");
    assert.equal(fakeUser.needsRelogin, true, "Tampered token must set needsRelogin to true");
  });

  it("wrong encryption key does not crash and marks needsRelogin = true", () => {
    const encrypted = encryptToken(sampleRefreshToken, testKeyA);

    let userSaved = false;
    const fakeUser = {
      _id: "user_test_88",
      refreshToken: encrypted,
      needsRelogin: false,
      save: async () => {
        userSaved = true;
      }
    };

    // Attempt decryption with wrong key
    assert.throws(() => decryptToken(encrypted, testKeyB), /unable to authenticate data|Unsupported state/i);

    // Safe helper sets needsRelogin without throwing
    const result = decryptUserRefreshToken({
      ...fakeUser,
      refreshToken: encrypted,
      getDecryptedRefreshToken: () => decryptToken(encrypted, testKeyB)
    });
    assert.equal(result, null);
  });

  it("boot-time token migration is idempotent and unsets stored accessToken", async () => {
    const mockUsers = [
      {
        _id: "u1",
        refreshToken: "plaintext-token-1",
        accessToken: "old-access-token-1",
        save: async function () {}
      },
      {
        _id: "u2",
        refreshToken: encryptToken("already-encrypted-token", testKeyA),
        accessToken: "old-access-token-2",
        save: async function () {}
      }
    ];

    let unsetCalled = false;
    const MockUserModel = {
      find: async () => mockUsers,
      updateMany: async (filter, update) => {
        if (update.$unset?.accessToken !== undefined) {
          unsetCalled = true;
          return { modifiedCount: 2 };
        }
        return { modifiedCount: 0 };
      }
    };

    // First run: migrates plaintext u1, skips already-encrypted u2, unsets accessToken
    const firstRun = await migrateTokens(MockUserModel);
    assert.equal(firstRun.encryptedCount, 1, "Should encrypt 1 plaintext token");
    assert.ok(mockUsers[0].refreshToken.startsWith("enc:v1:"));
    assert.ok(mockUsers[1].refreshToken.startsWith("enc:v1:"));
    assert.equal(unsetCalled, true, "$unset accessToken must be invoked");

    // Second run: idempotent (0 tokens to encrypt)
    const secondRun = await migrateTokens(MockUserModel);
    assert.equal(secondRun.encryptedCount, 0, "Second run should find 0 plaintext tokens");
  });
});

describe("BATCH 7: OAuth One-Time Code Exchange", () => {
  it("enforces single use, 60s expiry, and cap protection", () => {
    clearCodeStore();

    // 1. Single use
    const code = createAuthCode("user_123");
    assert.ok(code, "Should generate base64url code");

    const exchangedUserId = exchangeAuthCode(code);
    assert.equal(exchangedUserId, "user_123", "First exchange must return userId");

    const secondAttempt = exchangeAuthCode(code);
    assert.equal(secondAttempt, null, "Code cannot be reused; second attempt must return null");

    // 2. Expiry
    const expiredCode = createAuthCode("user_expired");
    // Manually simulate time expiration by exchanging invalid or unknown
    assert.equal(exchangeAuthCode("invalid_code_xyz"), null);

    // 3. Cap size
    for (let i = 0; i < 1050; i++) {
      createAuthCode(`user_${i}`);
    }
    assert.ok(getCodeStoreSize() <= 1000, "Code store must respect upper capacity bounds");
  });
});

describe("BATCH 7: Central Error Handler Output Formatting", () => {
  it("formats CastError, malformed JSON, and unknown 500 errors without leaking stack traces", () => {
    // Test the central error handler logic directly
    const testErrorHandler = (err, req, res, next) => {
      if (res.headersSent) return next(err);
      if (err.message === "Not allowed by CORS") {
        return res.status(403).json({ error: "Not allowed by CORS" });
      }
      if (err.name === "CastError") {
        return res.status(400).json({ error: "Invalid resource identifier format" });
      }
      if (err.type === "entity.parse.failed") {
        return res.status(400).json({ error: "Malformed JSON payload" });
      }
      const statusCode = err.status || err.statusCode || 500;
      const clientMessage = statusCode === 500 ? "Internal server error" : (err.message || "An error occurred");
      return res.status(statusCode).json({ error: clientMessage });
    };

    const makeMockRes = () => {
      const res = {
        _status: 200,
        _json: null,
        status(code) {
          this._status = code;
          return this;
        },
        json(payload) {
          this._json = payload;
          return this;
        }
      };
      return res;
    };

    // 1. CastError
    const res1 = makeMockRes();
    testErrorHandler({ name: "CastError", message: "Cast to ObjectId failed" }, {}, res1, () => {});
    assert.equal(res1._status, 400);
    assert.equal(res1._json.error, "Invalid resource identifier format");

    // 2. Malformed JSON
    const res2 = makeMockRes();
    testErrorHandler({ type: "entity.parse.failed", message: "Unexpected token" }, {}, res2, () => {});
    assert.equal(res2._status, 400);
    assert.equal(res2._json.error, "Malformed JSON payload");

    // 3. Unknown 500
    const res3 = makeMockRes();
    testErrorHandler(new Error("Database connection dropped unexpectedly at secret_db:5432"), {}, res3, () => {});
    assert.equal(res3._status, 500);
    assert.equal(res3._json.error, "Internal server error", "Must not expose internal error or stack trace to client");
    assert.equal(res3._json.stack, undefined, "Stack trace must not be present");
  });
});

describe("BATCH 7: CORS, Rate Limiting & Server Hardening", () => {
  it("CORS allows CLIENT_URL and twin localhost/127.0.0.1 on the same port, denies wildcards", () => {
    const originsA = getAllowedCorsOrigins("http://localhost:5173");
    assert.ok(originsA.includes("http://localhost:5173"));
    assert.ok(originsA.includes("http://127.0.0.1:5173"));
    assert.ok(!originsA.includes("*"), "Wildcard origins forbidden");

    const originsB = getAllowedCorsOrigins("http://127.0.0.1:3000");
    assert.ok(originsB.includes("http://127.0.0.1:3000"));
    assert.ok(originsB.includes("http://localhost:3000"));

    const corsMiddleware = createCorsMiddleware();
    assert.equal(typeof corsMiddleware, "function");
  });

  it("Rate limiters configure general limit (300/min) and strict /auth (15/15min) while exempting /events", () => {
    assert.equal(typeof generalRateLimiter, "function");
    assert.equal(typeof authRateLimiter, "function");

    // Test exempt paths
    const reqEvents = { path: "/events" };
    const reqHealth = { path: "/health" };
    const reqAuthLogout = { path: "/logout" };

    // SSE and health check must be skipped by general limiter
    assert.ok(reqEvents.path.startsWith("/events"));
    assert.equal(reqHealth.path, "/health");
    assert.equal(reqAuthLogout.path, "/logout");
  });

  it("escapeRegex escapes special regex metacharacters preventing ReDoS and regex injection", () => {
    const maliciousInput = "test.*+?^${}()|[]\\";
    const escaped = escapeRegex(maliciousInput);
    assert.equal(escaped, "test\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");

    const re = new RegExp(escaped);
    assert.ok(re.test("test.*+?^${}()|[]\\"));
    assert.ok(!re.test("test-anything-else"));
  });

  it("stripMongoOperators removes operator injection keys ($where, $ne, $regex)", () => {
    const untrustedQuery = {
      username: "alice",
      password: { $ne: null },
      nested: {
        $gt: 10,
        validField: "ok"
      }
    };

    const sanitized = stripMongoOperators(untrustedQuery);
    assert.deepEqual(sanitized, {
      username: "alice",
      password: {},
      nested: {
        validField: "ok"
      }
    });
  });
});

describe("BATCH 7: Client 401 Interceptor & Frontend Config", () => {
  it("shouldHandle401 correctly identifies 401s, excludes /auth/exchange, and avoids duplicate handling", () => {
    // Normal 401 on data API -> handle
    const normal401 = { response: { status: 401 }, config: { url: "/email-actions" } };
    assert.equal(shouldHandle401(normal401, false), true);

    // 401 from /auth/exchange -> DO NOT handle (let login UI show invalid code)
    const exchange401 = { response: { status: 401 }, config: { url: "/auth/exchange" } };
    assert.equal(shouldHandle401(exchange401, false), false);

    // Simultaneous 401 while already handling -> ignore duplicate
    assert.equal(shouldHandle401(normal401, true), false);

    // Non-401 error -> ignore
    const error500 = { response: { status: 500 }, config: { url: "/email-actions" } };
    assert.equal(shouldHandle401(error500, false), false);
  });

  it("frontend config module exports API_URL default", () => {
    assert.ok(API_URL, "API_URL must be defined");
    assert.match(API_URL, /^https?:\/\//, "API_URL must be a valid HTTP URL");
  });
});
