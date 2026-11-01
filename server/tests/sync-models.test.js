import { describe, it } from "node:test";
import assert from "node:assert/strict";
import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import {
  isInvalidGrantError,
  handleInvalidGrant,
  getOAuth2Client,
  getGmail,
  withGmail,
  InvalidGrantError,
  getProfile,
  listHistory
} from "../services/gmail.service.js";
import {
  isOllamaReachable,
  checkOllamaHealth
} from "../services/ollama.service.js";
import { handleGetSyncStatus } from "../routes/sync.routes.js";

describe("Data Models - User and ProcessedEmail additions", () => {
  it("User schema contains sync and history fields", () => {
    const paths = User.schema.paths;
    assert.ok(paths.gmailHistoryId, "User should have gmailHistoryId");
    assert.ok(paths.syncStatus, "User should have syncStatus");
    assert.ok(paths.syncError, "User should have syncError");
    assert.ok(paths.needsRelogin, "User should have needsRelogin");
    assert.ok(paths.dailyReplySentCount, "User should have dailyReplySentCount");
    assert.ok(paths.dailyReplySentDate, "User should have dailyReplySentDate");
    assert.ok(paths.lastSync, "User should have lastSync");

    assert.deepEqual(paths.syncStatus.enumValues, ["idle", "running", "error"]);
    assert.equal(paths.needsRelogin.defaultValue, false);
    assert.equal(paths.syncStatus.defaultValue, "idle");
  });

  it("ProcessedEmail schema contains explicit retry status and required fields", () => {
    const paths = ProcessedEmail.schema.paths;
    assert.ok(paths.status, "ProcessedEmail should have status");
    assert.ok(paths.outcome, "ProcessedEmail should have outcome");
    assert.ok(paths.failureReason, "ProcessedEmail should have failureReason");
    assert.ok(paths.attempts, "ProcessedEmail should have attempts");
    assert.ok(paths.nextRetryAt, "ProcessedEmail should have nextRetryAt");
    assert.ok(paths.sentAt, "ProcessedEmail should have sentAt");
    assert.ok(paths.resolvedAt, "ProcessedEmail should have resolvedAt");
    assert.ok(paths.resolution, "ProcessedEmail should have resolution");

    // Explicit "retry" status for stale-row recovery (not null)
    assert.deepEqual(paths.status.enumValues, [
      "processing",
      "done",
      "failed",
      "retry"
    ]);

    assert.deepEqual(paths.outcome.enumValues, [
      "labeled",
      "drafted",
      "sent",
      "none",
      "failed",
      "needs_manual",
      "skipped"
    ]);

    assert.deepEqual(paths.resolution.enumValues, [
      "ai_draft_sent",
      "ai_reply_sent",
      "manual",
      "none"
    ]);
  });
});

describe("Gmail service - OAuth2 client & error handling", () => {
  it("isInvalidGrantError accurately identifies invalid_grant error formats", () => {
    assert.equal(isInvalidGrantError(new Error("invalid_grant")), true);
    assert.equal(
      isInvalidGrantError({
        response: { data: { error: "invalid_grant" } }
      }),
      true
    );
    assert.equal(
      isInvalidGrantError({
        response: { data: { error_description: "Token expired: invalid_grant" } }
      }),
      true
    );
    assert.equal(isInvalidGrantError(new Error("Rate limit exceeded")), false);
    assert.equal(isInvalidGrantError(null), false);
  });

  it("handleInvalidGrant marks needsRelogin on user and sets syncStatus to error", async () => {
    let saved = false;
    const fakeUser = {
      needsRelogin: false,
      syncStatus: "idle",
      syncError: null,
      save: async () => {
        saved = true;
      }
    };

    await handleInvalidGrant(fakeUser, new Error("invalid_grant"));
    assert.equal(fakeUser.needsRelogin, true);
    assert.equal(fakeUser.syncStatus, "error");
    assert.match(fakeUser.syncError, /re-login/i);
    assert.equal(saved, true);
  });

  it("getOAuth2Client persists tokens only when changed", async () => {
    let savedCount = 0;
    const fakeUser = {
      accessToken: "old_access",
      refreshToken: "old_refresh",
      save: async () => {
        savedCount++;
      }
    };

    const auth = getOAuth2Client(fakeUser);
    assert.ok(auth, "Should return an OAuth2 client");

    // Emit tokens with same values -> save should NOT be called
    auth.emit("tokens", { access_token: "old_access" });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(savedCount, 0, "Should not save if token did not change");

    // Emit tokens with new access token -> save should be called
    auth.emit("tokens", { access_token: "new_access" });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(savedCount, 1, "Should save when access token changes");
    assert.equal(fakeUser.accessToken, "new_access");
  });

  it("getGmail returns real googleapis client where gmail.users.messages.list and gmail.users.history.list are accessible functions", async () => {
    const fakeUser = {
      accessToken: "fake_token",
      refreshToken: "fake_refresh",
      save: async () => {}
    };

    const gmail = await getGmail(fakeUser);
    assert.ok(gmail, "getGmail should return a client");
    assert.ok(gmail.users, "gmail.users should be accessible without proxy error");
    assert.equal(typeof gmail.users.messages.list, "function");
    assert.equal(typeof gmail.users.history.list, "function");
    assert.equal(typeof gmail.users.drafts.create, "function");
    assert.equal(typeof gmail.users.drafts.update, "function");
  });

  it("withGmail catches invalid_grant, marks needsRelogin=true, sets syncStatus='error', and rethrows InvalidGrantError", async () => {
    let saved = false;
    const fakeUser = {
      accessToken: "fake_token",
      refreshToken: "fake_refresh",
      needsRelogin: false,
      syncStatus: "idle",
      syncError: null,
      save: async () => {
        saved = true;
      }
    };

    await assert.rejects(
      async () => {
        await withGmail(fakeUser, async (_gmail) => {
          const err = new Error("invalid_grant");
          throw err;
        });
      },
      (err) => {
        assert.ok(err instanceof InvalidGrantError);
        assert.equal(err.code, "INVALID_GRANT");
        return true;
      }
    );

    assert.equal(fakeUser.needsRelogin, true);
    assert.equal(fakeUser.syncStatus, "error");
    assert.match(fakeUser.syncError, /re-login/i);
    assert.equal(saved, true);
  });

  it("getProfile and listHistory helpers call Gmail API correctly", async () => {
    const mockGmail = {
      users: {
        getProfile: async () => ({
          data: { emailAddress: "test@example.com", historyId: "12345" }
        }),
        history: {
          list: async ({ startHistoryId }) => ({
            data: { history: [], historyId: startHistoryId }
          })
        }
      }
    };

    const profile = await getProfile(mockGmail);
    assert.equal(profile.emailAddress, "test@example.com");
    assert.equal(profile.historyId, "12345");

    const history = await listHistory(mockGmail, { startHistoryId: "12345" });
    assert.equal(history.historyId, "12345");
  });
});

describe("Ollama health and reachability checks", () => {
  it("isOllamaReachable returns a boolean", async () => {
    const reachable = await isOllamaReachable(200);
    assert.equal(typeof reachable, "boolean");
  });

  it("checkOllamaHealth executes without crashing", async () => {
    const result = await checkOllamaHealth();
    assert.ok(result, "Result object should be returned");
    assert.equal(typeof result.reachable, "boolean");
    assert.ok(Array.isArray(result.missingModels));
  });
});

describe("Sync status route handler", () => {
  it("handleGetSyncStatus returns 404 when user is not found", async () => {
    const origFindById = User.findById;
    User.findById = () => ({
      select: async () => null
    });

    let statusCode = 200;
    let jsonBody = null;
    const req = { user: { id: "nonexistent_id" } };
    const res = {
      status: (code) => {
        statusCode = code;
        return res;
      },
      json: (body) => {
        jsonBody = body;
        return res;
      }
    };

    try {
      await handleGetSyncStatus(req, res);
      assert.equal(statusCode, 404);
      assert.deepEqual(jsonBody, { message: "User not found." });
    } finally {
      User.findById = origFindById;
    }
  });

  it("handleGetSyncStatus returns status, lastSync, error, needsRelogin, queueSize, ollamaReachable", async () => {
    const origFindById = User.findById;
    const origCountDocs = ProcessedEmail.countDocuments;

    const fakeLastSync = new Date("2026-11-01T12:00:00Z");
    User.findById = () => ({
      select: async () => ({
        syncStatus: "running",
        syncError: null,
        lastSync: fakeLastSync,
        needsRelogin: false
      })
    });

    ProcessedEmail.countDocuments = async () => 3;

    let jsonBody = null;
    const req = { user: { id: "user_123" } };
    const res = {
      status: () => res,
      json: (body) => {
        jsonBody = body;
        return res;
      }
    };

    try {
      await handleGetSyncStatus(req, res);
      assert.ok(jsonBody, "Response JSON body should be present");
      assert.equal(jsonBody.status, "running");
      assert.equal(jsonBody.lastSync, fakeLastSync);
      assert.equal(jsonBody.error, null);
      assert.equal(jsonBody.needsRelogin, false);
      assert.equal(jsonBody.queueSize, 3);
      assert.equal(typeof jsonBody.ollamaReachable, "boolean");
    } finally {
      User.findById = origFindById;
      ProcessedEmail.countDocuments = origCountDocs;
    }
  });
});

