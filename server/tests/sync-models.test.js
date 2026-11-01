import { describe, it } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns";
import "../config/network.js";
import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import {
  isInvalidGrantError,
  isTransientError,
  handleInvalidGrant,
  getOAuth2Client,
  getGmail,
  withGmail,
  modifyMessageLabels,
  InvalidGrantError,
  getProfile,
  listHistory,
  createGmailDraft,
  sendGmailDraft,
  sendGmailMessage,
  deleteGmailDraft,
  getMessage,
  listMessages,
  getThread,
  setupDefaultLabels,
  listGmailLabels,
  createGmailLabel,
  deleteGmailLabel
} from "../services/gmail.service.js";
import {
  isOllamaReachable,
  checkOllamaHealth
} from "../services/ollama.service.js";
import { handleGetSyncStatus } from "../routes/sync.routes.js";

describe("Network config - DNS result order", () => {
  it("sets dns.getDefaultResultOrder() to ipv4first", () => {
    assert.equal(dns.getDefaultResultOrder(), "ipv4first");
  });
});

describe("Data Models - User and ProcessedEmail additions", () => {
  it("User schema contains sync and history fields", () => {
    const paths = User.schema.paths;
    assert.ok(paths.gmailHistoryId, "User should have gmailHistoryId");
    assert.ok(paths.syncStatus, "User should have syncStatus");
    assert.ok(paths.syncError, "User should have syncError");
    assert.ok(paths.needsRelogin, "User should have needsRelogin");
    assert.ok(paths.dailyReplySentCount, "User should have dailyReplySentCount");
    assert.ok(paths.dailyReplySentDate, "User should have dailyReplySentDate");
    assert.ok(paths.lastSyncAt, "User should have lastSyncAt");

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
      "ai_assisted",
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

  it("getOAuth2Client persists tokens only when changed (persists refresh_token only)", async () => {
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

    // Emit tokens with new access token -> sets in-memory accessToken, does NOT persist to MongoDB
    auth.emit("tokens", { access_token: "new_access" });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(savedCount, 0, "Should NOT save to DB when only access token changes");
    assert.equal(fakeUser.accessToken, "new_access");

    // Emit tokens with new refresh token -> save SHOULD be called
    auth.emit("tokens", { refresh_token: "new_refresh_token" });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(savedCount, 1, "Should save when new refresh token is issued");
    assert.ok(fakeUser.refreshToken, "User refreshToken should be updated");
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

  it("withGmail retries transient failures (e.g. ECONNRESET) with exponential backoff and succeeds after 2 failures", async () => {
    let attempts = 0;
    const retryDelays = [];
    const mockGmail = { users: {} };

    const result = await withGmail(
      mockGmail,
      async () => {
        attempts++;
        if (attempts <= 2) {
          const err = new Error("read ECONNRESET");
          err.code = "ECONNRESET";
          throw err;
        }
        return "success";
      },
      {
        retryDelayFn: (idx) => {
          retryDelays.push(idx);
          return 5;
        }
      }
    );

    assert.equal(result, "success");
    assert.equal(attempts, 3);
    assert.deepEqual(retryDelays, [0, 1]);
  });

  it("withGmail retries up to maxRetries (3) and throws when all attempts fail", async () => {
    let attempts = 0;
    const mockGmail = { users: {} };

    await assert.rejects(
      async () => {
        await withGmail(
          mockGmail,
          async () => {
            attempts++;
            const err = new Error("connect ETIMEDOUT");
            err.code = "ETIMEDOUT";
            throw err;
          },
          {
            retryDelayFn: () => 5
          }
        );
      },
      (err) => {
        assert.equal(err.code, "ETIMEDOUT");
        return true;
      }
    );

    assert.equal(attempts, 4); // 1 initial + 3 retries
  });

  it("withGmail does not retry non-transient errors (401, 403, 404, invalid_grant)", async () => {
    let attempts = 0;
    const mockGmail = { users: {} };

    const notFoundErr = new Error("Not Found");
    notFoundErr.status = 404;

    await assert.rejects(
      async () => {
        await withGmail(
          mockGmail,
          async () => {
            attempts++;
            throw notFoundErr;
          },
          { retryDelayFn: () => 5 }
        );
      },
      /Not Found/
    );

    assert.equal(attempts, 1);
  });

  it("modifyMessageLabels carries labels in requestBody, never in top-level query parameters", async () => {
    let capturedArgs = null;
    const mockGmail = {
      users: {
        messages: {
          modify: async (args) => {
            capturedArgs = args;
            return {
              data: {
                id: args.id,
                labels: args.requestBody?.addLabelIds
              }
            };
          }
        }
      }
    };

    await modifyMessageLabels(mockGmail, {
      messageId: "msg_123",
      addLabelIds: ["Label_work"],
      removeLabelIds: ["UNREAD"]
    });

    assert.ok(capturedArgs, "modify should have been called");
    assert.equal(capturedArgs.userId, "me");
    assert.equal(capturedArgs.id, "msg_123");
    // Assert labels are placed inside requestBody
    assert.deepEqual(capturedArgs.requestBody, {
      addLabelIds: ["Label_work"],
      removeLabelIds: ["UNREAD"]
    });
    // Assert labels are NOT in top-level parameters
    assert.equal(capturedArgs.addLabelIds, undefined);
    assert.equal(capturedArgs.removeLabelIds, undefined);
  });

  it("createGmailDraft, sendGmailDraft, sendGmailMessage, and deleteGmailDraft invoke Gmail API via withGmail", async () => {
    let createArgs = null;
    let sendDraftArgs = null;
    let sendMessageArgs = null;
    let deleteDraftArgs = null;

    const mockGmail = {
      users: {
        drafts: {
          create: async (args) => {
            createArgs = args;
            return { data: { id: "draft_new" } };
          },
          send: async (args) => {
            sendDraftArgs = args;
            return { data: { id: "msg_sent" } };
          },
          delete: async (args) => {
            deleteDraftArgs = args;
            return { data: {} };
          }
        },
        messages: {
          send: async (args) => {
            sendMessageArgs = args;
            return { data: { id: "msg_direct" } };
          }
        }
      }
    };

    const draftRes = await createGmailDraft(mockGmail, {
      to: "client@example.com",
      subject: "Test Draft",
      body: "Draft body",
      threadId: "thread_123"
    });
    assert.equal(draftRes.id, "draft_new");
    assert.ok(createArgs.requestBody.message.raw);
    assert.equal(createArgs.requestBody.message.threadId, "thread_123");

    const sendDraftRes = await sendGmailDraft(mockGmail, "draft_new");
    assert.equal(sendDraftRes.id, "msg_sent");
    assert.equal(sendDraftArgs.requestBody.id, "draft_new");

    const sendMsgRes = await sendGmailMessage(mockGmail, {
      to: "client@example.com",
      subject: "Direct Message",
      body: "Direct message body"
    });
    assert.equal(sendMsgRes.id, "msg_direct");
    assert.ok(sendMessageArgs.requestBody.raw);

    await deleteGmailDraft(mockGmail, "draft_new");
    assert.equal(deleteDraftArgs.id, "draft_new");
  });

  it("getMessage, listMessages, and getThread invoke Gmail API via withGmail", async () => {
    let getMsgArgs = null;
    let listMsgArgs = null;
    let getThreadArgs = null;

    const mockGmail = {
      users: {
        messages: {
          get: async (args) => {
            getMsgArgs = args;
            return { data: { id: args.id, snippet: "Hello world" } };
          },
          list: async (args) => {
            listMsgArgs = args;
            return { data: { messages: [{ id: "m1" }, { id: "m2" }] } };
          }
        },
        threads: {
          get: async (args) => {
            getThreadArgs = args;
            return { data: { id: args.id, messages: [{ id: "m1" }] } };
          }
        }
      }
    };

    const msg = await getMessage(mockGmail, "msg_abc");
    assert.equal(msg.id, "msg_abc");
    assert.equal(getMsgArgs.id, "msg_abc");
    assert.equal(getMsgArgs.format, "full");

    const list = await listMessages(mockGmail, { q: "is:unread" });
    assert.equal(list.messages.length, 2);
    assert.equal(listMsgArgs.q, "is:unread");

    const thread = await getThread(mockGmail, "thread_xyz");
    assert.equal(thread.id, "thread_xyz");
    assert.equal(getThreadArgs.id, "thread_xyz");
  });

  it("listGmailLabels, createGmailLabel, deleteGmailLabel, and setupDefaultLabels invoke Gmail API via withGmail", async () => {
    let listLabelsCalled = false;
    let createLabelArgs = null;
    let deleteLabelArgs = null;

    const mockGmail = {
      users: {
        labels: {
          list: async () => {
            listLabelsCalled = true;
            return { data: { labels: [{ id: "Label_1", name: "Work" }] } };
          },
          create: async (args) => {
            createLabelArgs = args;
            return { data: { id: "Label_new", name: args.requestBody.name } };
          },
          delete: async (args) => {
            deleteLabelArgs = args;
            return { data: {} };
          }
        }
      }
    };

    const labels = await listGmailLabels(mockGmail);
    assert.equal(listLabelsCalled, true);
    assert.equal(labels.labels[0].name, "Work");

    const created = await createGmailLabel(mockGmail, { name: "Receipts" });
    assert.equal(created.id, "Label_new");
    assert.equal(createLabelArgs.requestBody.name, "Receipts");

    await deleteGmailLabel(mockGmail, "Label_old");
    assert.equal(deleteLabelArgs.id, "Label_old");

    // Test setupDefaultLabels
    let userSaved = false;
    const fakeUser = {
      labels: [],
      save: async () => {
        userSaved = true;
      }
    };

    const initializedLabels = await setupDefaultLabels(mockGmail, fakeUser);
    assert.ok(initializedLabels.length > 0);
    assert.equal(userSaved, true);
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
        lastSyncAt: fakeLastSync,
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

