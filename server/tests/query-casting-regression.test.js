import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import EmailAction from "../models/EmailAction.js";
import {
  sanitizeObject,
  sanitizeRequestMiddleware
} from "../config/security.js";
import { encryptToken, decryptToken, decryptUserRefreshToken } from "../utils/crypto.js";
import { migrateTokens } from "../services/migration.service.js";

describe("REGRESSION: Internal Mongoose Queries Cast Real Operators (sanitizeFilter Removed)", () => {
  it("User poll selection query casts without throwing and retains $exists and $ne operators", () => {
    const filter = {
      refreshToken: { $exists: true, $ne: null },
      needsRelogin: { $ne: true }
    };

    const query = User.find(filter);
    // Real Mongoose Query.cast() directly against model schema
    assert.doesNotThrow(() => query.cast(), "Query.cast() must not throw on $exists/$ne operators");

    const castFilter = query.getFilter();
    assert.equal(castFilter.refreshToken.$exists, true, "$exists operator must be preserved");
    assert.equal(castFilter.refreshToken.$ne, null, "$ne operator must be preserved");
    assert.equal(castFilter.needsRelogin.$ne, true, "$ne operator must be preserved");
    assert.equal(castFilter.refreshToken.$eq, undefined, "Must NOT wrap $exists in $eq");
    assert.equal(castFilter.needsRelogin.$eq, undefined, "Must NOT wrap $ne in $eq");
  });

  it("ProcessedEmail stale processing and retry queries cast date operators properly", () => {
    const staleDate = new Date();
    const staleQuery = ProcessedEmail.find({
      status: "processing",
      updatedAt: { $lt: staleDate }
    });
    assert.doesNotThrow(() => staleQuery.cast());
    const staleFilter = staleQuery.getFilter();
    assert.equal(staleFilter.status, "processing");
    assert.ok(staleFilter.updatedAt.$lt instanceof Date);

    const retryDate = new Date();
    const retryQuery = ProcessedEmail.find({
      status: "failed",
      nextRetryAt: { $lte: retryDate }
    });
    assert.doesNotThrow(() => retryQuery.cast());
    const retryFilter = retryQuery.getFilter();
    assert.equal(retryFilter.status, "failed");
    assert.ok(retryFilter.nextRetryAt.$lte instanceof Date);
  });

  it("ProcessedEmail candidate dedup query casts $in operators without wrapping", () => {
    const candidateIds = ["msg_abc123", "msg_def456"];
    const query = ProcessedEmail.find({
      userId: new mongoose.Types.ObjectId(),
      messageId: { $in: candidateIds },
      status: { $in: ["done", "failed", "skipped"] }
    });
    assert.doesNotThrow(() => query.cast());
    const filter = query.getFilter();
    assert.deepEqual(filter.messageId.$in, candidateIds);
    assert.deepEqual(filter.status.$in, ["done", "failed", "skipped"]);
  });

  it("EmailAction reconcile query casts complex $or, $in, and $exists operators", () => {
    const query = EmailAction.find({
      userId: new mongoose.Types.ObjectId(),
      $or: [
        { "turns.outgoing.status": "draft" },
        { "turns.outcome": { $in: ["needs_manual", "failed"] } },
        { "turns.outgoing": { $exists: false } },
        { status: { $in: ["draft", "failed", "needs_reply"] } }
      ]
    });
    assert.doesNotThrow(() => query.cast());
    const filter = query.getFilter();
    assert.ok(Array.isArray(filter.$or));
    assert.equal(filter.$or.length, 4);
    assert.deepEqual(filter.$or[1]["turns.outcome"].$in, ["needs_manual", "failed"]);
    assert.equal(filter.$or[2]["turns.outgoing"].$exists, false);
  });

  it("Token migration select query casts without turning $exists into a string", () => {
    const query = User.find({
      refreshToken: { $exists: true, $ne: null }
    });
    assert.doesNotThrow(() => query.cast());
    const filter = query.getFilter();
    assert.equal(filter.refreshToken.$exists, true);
    assert.equal(filter.refreshToken.$ne, null);
    assert.equal(typeof filter.refreshToken, "object");
  });
});

describe("REGRESSION: Boundary Sanitizer Middleware", () => {
  it("strips keys starting with $ or containing . from body, query, and params", () => {
    const untrustedBody = {
      username: "alice",
      password: { $ne: null },
      "nested.field": "bad",
      normalNested: {
        $where: "dangerous code",
        safe: "valid"
      },
      list: [
        { safeItem: 1 },
        { $forbidden: 2 }
      ]
    };

    const clean = sanitizeObject(untrustedBody);

    assert.equal(clean.username, "alice");
    assert.deepEqual(clean.password, {}, "$ne key must be stripped");
    assert.equal(clean["nested.field"], undefined, "Keys with dots must be stripped");
    assert.equal(clean.normalNested.$where, undefined, "$where key must be stripped");
    assert.equal(clean.normalNested.safe, "valid");
    assert.equal(clean.list[0].safeItem, 1);
    assert.equal(clean.list[1].$forbidden, undefined, "Array nested operator keys must be stripped");
  });

  it("handles deep recursion without exceeding depth limit", () => {
    let deep = { val: "bottom" };
    for (let i = 0; i < 20; i++) {
      deep = { child: deep };
    }

    const result = sanitizeObject(deep, 5);
    // At depth 5, returns undefined for deeper children, preventing call stack overflow
    let current = result;
    let depth = 0;
    while (current && current.child) {
      current = current.child;
      depth++;
    }
    assert.ok(depth <= 5, "Recursion depth must not exceed limit");
  });

  it("sanitizeRequestMiddleware executes on req.body, req.query, and req.params", () => {
    const req = {
      body: { query: { $gt: 10 }, label: "inbox" },
      query: { filter: { $ne: "none" }, q: "urgent" },
      params: { id: "123", $bad: "drop" }
    };
    let nextCalled = false;

    sanitizeRequestMiddleware(req, {}, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.body.label, "inbox");
    assert.deepEqual(req.body.query, {}, "$gt must be stripped from body");
    assert.equal(req.query.q, "urgent");
    assert.deepEqual(req.query.filter, {}, "$ne must be stripped from query");
    assert.equal(req.params.id, "123");
    assert.equal(req.params.$bad, undefined, "$bad must be stripped from params");
  });
});

describe("REGRESSION: Token Migration Idempotency & Re-Login Isolation", () => {
  it("encrypts plaintext tokens exactly once and preserves enc:v1: prefix on second boot", async () => {
    const testKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.TOKEN_ENCRYPTION_KEY = testKey;

    const mockDocs = [
      {
        _id: "user_plain",
        refreshToken: "1//plaintext_google_refresh_token",
        accessToken: "legacy_access_token_1",
        save: async function () {}
      },
      {
        _id: "user_already_encrypted",
        refreshToken: encryptToken("1//already_encrypted_google_refresh_token", testKey),
        accessToken: "legacy_access_token_2",
        save: async function () {}
      }
    ];

    let unsetInvoked = false;
    const MockUser = {
      find: async () => mockDocs,
      updateMany: async (filter, update) => {
        if (update.$unset?.accessToken !== undefined) {
          unsetInvoked = true;
        }
        return { modifiedCount: 2 };
      }
    };

    // First migration run
    const result1 = await migrateTokens(MockUser);
    assert.equal(result1.encryptedCount, 1, "Only the plaintext token should be encrypted");
    assert.ok(mockDocs[0].refreshToken.startsWith("enc:v1:"));
    assert.ok(mockDocs[1].refreshToken.startsWith("enc:v1:"));
    assert.equal(unsetInvoked, true);

    const firstEncryptedValue = mockDocs[0].refreshToken;

    // Second migration run (idempotent: zero re-encryptions)
    const result2 = await migrateTokens(MockUser);
    assert.equal(result2.encryptedCount, 0, "Second run must not re-encrypt already-encrypted tokens");
    assert.equal(mockDocs[0].refreshToken, firstEncryptedValue, "Encrypted token value must remain identical");
  });

  it("decryption failure provides clear sign-in guidance and does not crash", () => {
    const corruptedUser = {
      _id: "user_corrupted_123",
      refreshToken: "enc:v1:badiv:badtag:badciphertext",
      needsRelogin: false,
      syncStatus: "idle",
      syncError: null,
      save: async () => {}
    };

    const token = decryptUserRefreshToken(corruptedUser);
    assert.equal(token, null);
    assert.equal(corruptedUser.needsRelogin, true, "Must flag needsRelogin on decryption failure");
    assert.equal(corruptedUser.syncStatus, "error");
    assert.match(corruptedUser.syncError, /Please sign in again/i);
  });
});

