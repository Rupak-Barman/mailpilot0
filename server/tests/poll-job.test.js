// tests/poll-job.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import EmailAction from "../models/EmailAction.js";
import Analytics from "../models/Analytics.js";
import {
  processMessage,
  syncUser,
  pollAllUsers,
  shouldSkipLoopProtection,
  activeUserLocks
} from "../jobs/poll.job.js";
import {
  AITransientError,
  AIPermanentError,
  isTransientAIError
} from "../services/aiEngine.js";

describe("Poll job & sync engine - BATCH 1 part 2A", () => {
  const originalFetch = global.fetch;
  const originalProcessedEmailFindOne = ProcessedEmail.findOne;
  const originalProcessedEmailCreate = ProcessedEmail.create;
  const originalProcessedEmailFind = ProcessedEmail.find;
  const originalEmailActionFindOne = EmailAction.findOne;
  const originalEmailActionCreate = EmailAction.create;
  const originalAnalyticsFindOne = Analytics.findOne;
  const originalAnalyticsCreate = Analytics.create;
  const originalUserFind = User.find;

  const mockQuery = (data = []) => {
    const p = Promise.resolve(data);
    p.select = () => Promise.resolve(data);
    return p;
  };

  beforeEach(() => {
    // Default mock for Ollama: successful JSON response
    global.fetch = async (url, options) => {
      if (typeof url === "string" && url.includes("/api/chat")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              content: JSON.stringify({
                label: "Work",
                summary: "Important client inquiry regarding review.",
                body: "Thank you for reaching out. We will review your document promptly."
              })
            }
          }),
          text: async () => ""
        };
      }
      return originalFetch(url, options);
    };

    // Default mock for ProcessedEmail & EmailAction
    ProcessedEmail.find = () => mockQuery([]);
    ProcessedEmail.findOne = async () => null;
    ProcessedEmail.create = async (doc) => ({
      ...doc,
      save: async function () {
        return this;
      }
    });

    EmailAction.findOne = async () => null;
    EmailAction.create = async () => ({});

    // Default mock for Analytics to prevent Mongoose buffering timeouts
    Analytics.findOne = async () => null;
    Analytics.create = async () => ({
      labels: new Map(),
      actions: {},
      totalEmails: 0,
      save: async () => {}
    });

    User.find = async () => [];
  });

  afterEach(() => {
    global.fetch = originalFetch;
    ProcessedEmail.findOne = originalProcessedEmailFindOne;
    ProcessedEmail.create = originalProcessedEmailCreate;
    ProcessedEmail.find = originalProcessedEmailFind;
    EmailAction.findOne = originalEmailActionFindOne;
    EmailAction.create = originalEmailActionCreate;
    Analytics.findOne = originalAnalyticsFindOne;
    Analytics.create = originalAnalyticsCreate;
    User.find = originalUserFind;
    activeUserLocks.clear();
  });

  it("1. The same message processed twice does not re-process or cause duplicate actions", async () => {
    let createCalled = 0;
    let gmailDraftCalls = 0;
    let savedClaim = null;

    ProcessedEmail.findOne = async () => null;
    ProcessedEmail.create = async (doc) => {
      createCalled++;
      savedClaim = {
        ...doc,
        save: async function () {
          return this;
        }
      };
      return savedClaim;
    };

    const fakeUser = {
      _id: "user_test_1",
      email: "owner@example.com",
      labels: [
        {
          id: "label_work",
          name: "Work",
          enabled: true,
          action: { type: "draft" },
          markAsRead: true
        }
      ],
      personas: [],
      dailyReplySentCount: 0,
      dailyReplySentDate: null,
      save: async () => {}
    };

    const fakeGmail = {
      users: {
        messages: {
          get: async () => ({
            data: {
              id: "msg_duplicate_test",
              threadId: "thread_1",
              snippet: "Please review the doc",
              payload: {
                headers: [
                  { name: "From", value: "client@example.com" },
                  { name: "Subject", value: "Urgent Review" },
                  { name: "Message-ID", value: "<m1@test.com>" }
                ],
                body: { data: Buffer.from("Hello please review").toString("base64") }
              }
            }
          }),
          modify: async () => ({})
        },
        drafts: {
          create: async () => {
            gmailDraftCalls++;
            return { data: { id: "draft_123", message: { id: "gm_123" } } };
          }
        }
      }
    };

    // First processing run
    const firstResult = await processMessage({
      user: fakeUser,
      gmail: fakeGmail,
      messageId: "msg_duplicate_test"
    });

    assert.equal(firstResult.processed, true, "First processing should succeed");
    assert.equal(createCalled, 1, "ProcessedEmail.create should be called once on initial claim");
    assert.equal(gmailDraftCalls, 1, "Gmail draft should be created exactly once");
    assert.equal(savedClaim.status, "done");
    assert.equal(savedClaim.outcome, "drafted");

    // Second processing run: findOne now returns the saved 'done' document
    ProcessedEmail.findOne = async () => savedClaim;

    const secondResult = await processMessage({
      user: fakeUser,
      gmail: fakeGmail,
      messageId: "msg_duplicate_test"
    });

    assert.equal(secondResult.processed, false, "Second processing must be skipped");
    assert.equal(secondResult.reason, "already_done", "Reason should indicate already done");
    assert.equal(createCalled, 1, "ProcessedEmail.create must NOT be called again");
    assert.equal(gmailDraftCalls, 1, "Gmail draft must NOT be created again");
  });

  it("2a. Checkpoint advancing only after success", async () => {
    let userSaved = false;
    const fakeUser = {
      _id: "user_chk_1",
      email: "owner@example.com",
      gmailHistoryId: "1000",
      syncStatus: "idle",
      syncError: null,
      labels: [{ id: "l1", name: "Work", enabled: true }],
      save: async function () {
        userSaved = true;
      }
    };

    const fakeGmail = {
      users: {
        history: {
          list: async () => ({
            data: {
              historyId: "2000",
              history: [
                {
                  messagesAdded: [{ message: { id: "msg_h1" } }]
                }
              ]
            }
          })
        },
        messages: {
          get: async ({ format }) => {
            if (format === "metadata") {
              return {
                data: {
                  id: "msg_h1",
                  internalDate: "1670000000000",
                  labelIds: ["INBOX"]
                }
              };
            }
            return {
              data: {
                id: "msg_h1",
                threadId: "t1",
                payload: {
                  headers: [
                    { name: "From", value: "sender@example.com" },
                    { name: "Subject", value: "Test Checkpoint" }
                  ]
                }
              }
            };
          },
          modify: async () => ({})
        },
        drafts: {
          create: async () => ({ data: { id: "d1" } })
        }
      }
    };

    const result = await syncUser(fakeUser, { gmailClient: fakeGmail });
    assert.equal(result.success, true);
    assert.equal(fakeUser.gmailHistoryId, "2000", "Checkpoint historyId must advance to 2000");
    assert.equal(fakeUser.syncStatus, "idle");
    assert.equal(fakeUser.syncError, null);
    assert.ok(fakeUser.lastSyncAt instanceof Date);
    assert.equal(userSaved, true);
  });

  it("2b. Checkpoint does NOT advance if error occurs during batch processing", async () => {
    const fakeUser = {
      _id: "user_chk_fail",
      email: "owner@example.com",
      gmailHistoryId: "1000",
      syncStatus: "idle",
      syncError: null,
      labels: [{ id: "l1", name: "Work", enabled: true }],
      save: async function () {}
    };

    // Non-transient 403 error to fail immediately without backoff delay
    const fakeGmail = {
      users: {
        history: {
          list: async () => {
            const err = new Error("Backend server error: Forbidden");
            err.status = 403;
            throw err;
          }
        }
      }
    };

    await assert.rejects(
      async () => {
        await syncUser(fakeUser, { gmailClient: fakeGmail });
      },
      (err) => {
        assert.match(err.message, /Backend server error/);
        return true;
      }
    );

    assert.equal(
      fakeUser.gmailHistoryId,
      "1000",
      "gmailHistoryId must NOT advance on failure"
    );
    assert.equal(fakeUser.syncStatus, "error");
    assert.match(fakeUser.syncError, /Backend server error/);
  });

  it("3. Bootstrap order: reads users.getProfile historyId FIRST before messages.list", async () => {
    const callLog = [];
    const fakeUser = {
      _id: "user_bootstrap",
      email: "owner@example.com",
      gmailHistoryId: null, // Triggers first-run bootstrap
      syncStatus: "idle",
      syncError: null,
      labels: [{ id: "l1", name: "Work", enabled: true }],
      save: async function () {}
    };

    const fakeGmail = {
      users: {
        getProfile: async () => {
          callLog.push({ method: "getProfile" });
          return { data: { emailAddress: "owner@example.com", historyId: "bootstrap_hist_999" } };
        },
        messages: {
          list: async ({ q }) => {
            callLog.push({ method: "messages.list", q });
            return {
              data: {
                messages: [{ id: "boot_msg_1" }]
              }
            };
          },
          get: async ({ format }) => {
            if (format === "metadata") {
              return {
                data: {
                  id: "boot_msg_1",
                  internalDate: "1670000000000",
                  labelIds: ["INBOX"]
                }
              };
            }
            return {
              data: {
                id: "boot_msg_1",
                threadId: "t_boot",
                payload: {
                  headers: [
                    { name: "From", value: "sender@example.com" },
                    { name: "Subject", value: "Hello Bootstrap" }
                  ]
                }
              }
            };
          },
          modify: async () => ({})
        },
        drafts: {
          create: async () => ({ data: { id: "d_boot" } })
        }
      }
    };

    await syncUser(fakeUser, { gmailClient: fakeGmail, catchupHours: 48 });

    assert.ok(callLog.length >= 2, "Should have made getProfile and messages.list calls");
    assert.equal(
      callLog[0].method,
      "getProfile",
      "getProfile MUST be called FIRST to capture historyId without gap"
    );
    assert.equal(
      callLog[1].method,
      "messages.list",
      "messages.list MUST be called SECOND"
    );
    assert.match(
      callLog[1].q,
      /in:inbox category:primary after:\d+/,
      "Query must bootstrap in:inbox category:primary after:<epochSeconds>"
    );
    assert.equal(
      fakeUser.gmailHistoryId,
      "bootstrap_hist_999",
      "User gmailHistoryId must advance to the profile's historyId after batch completes"
    );
  });

  it("4. Retry then fail: transient error sets status 'retry' with backoff, fails after 3 attempts", async () => {
    // Mock Ollama to simulate transient failure (e.g. connection refused / down)
    global.fetch = async () => {
      const err = new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:11434");
      err.code = "ECONNREFUSED";
      throw err;
    };

    const fakeUser = {
      _id: "user_retry_test",
      email: "owner@example.com",
      labels: [{ id: "l1", name: "Work", enabled: true }],
      save: async () => {}
    };

    const fakeGmail = {
      users: {
        messages: {
          get: async () => ({
            data: {
              id: "msg_retry_1",
              threadId: "t_retry",
              payload: {
                headers: [
                  { name: "From", value: "client@example.com" },
                  { name: "Subject", value: "Need help" }
                ],
                body: { data: Buffer.from("Need help with account").toString("base64") }
              }
            }
          }),
          modify: async () => ({})
        }
      }
    };

    let docState = null;

    // --- ATTEMPT 1 ---
    ProcessedEmail.findOne = async () => null;
    ProcessedEmail.create = async (d) => {
      docState = {
        ...d,
        save: async function () {
          return this;
        }
      };
      return docState;
    };

    const res1 = await processMessage({
      user: fakeUser,
      gmail: fakeGmail,
      messageId: "msg_retry_1"
    });

    assert.equal(res1.processed, false);
    assert.equal(res1.outcome, "retry");
    assert.equal(docState.status, "retry");
    assert.equal(docState.attempts, 1);
    assert.ok(docState.nextRetryAt instanceof Date);
    assert.ok(docState.nextRetryAt > new Date(), "nextRetryAt must be in the future");

    // --- ATTEMPT 2 ---
    // Simulate retry time arrived
    docState.nextRetryAt = new Date(Date.now() - 1000);
    ProcessedEmail.findOne = async () => docState;

    const res2 = await processMessage({
      user: fakeUser,
      gmail: fakeGmail,
      messageId: "msg_retry_1"
    });

    assert.equal(res2.processed, false);
    assert.equal(res2.outcome, "retry");
    assert.equal(docState.status, "retry");
    assert.equal(docState.attempts, 2);
    assert.ok(docState.nextRetryAt > new Date());

    // --- ATTEMPT 3 (Final attempt -> fails) ---
    docState.nextRetryAt = new Date(Date.now() - 1000);
    ProcessedEmail.findOne = async () => docState;

    const res3 = await processMessage({
      user: fakeUser,
      gmail: fakeGmail,
      messageId: "msg_retry_1"
    });

    assert.equal(res3.processed, false);
    assert.equal(res3.outcome, "failed");
    assert.equal(docState.status, "failed");
    assert.equal(docState.outcome, "failed");
    assert.equal(docState.failureReason, "ai_unavailable");
  });

  it("5. One user's error does not block another user in pollAllUsers", async () => {
    let userBSynced = false;

    const userA = {
      _id: "user_A_fail",
      email: "user_a@example.com",
      refreshToken: "token_a",
      needsRelogin: false,
      syncStatus: "idle",
      syncError: null,
      labels: [{ id: "lA", name: "Work", enabled: true }],
      save: async function () {
        if (this.syncStatus === "running") {
          throw new Error("Simulated network outage for user A");
        }
      }
    };

    const userB = {
      _id: "user_B_success",
      email: "user_b@example.com",
      refreshToken: "token_b",
      needsRelogin: false,
      syncStatus: "idle",
      syncError: null,
      labels: [{ id: "lB", name: "Work", enabled: true }],
      save: async function () {
        if (this.syncStatus === "idle" && this.lastSyncAt) {
          userBSynced = true;
        }
      }
    };

    User.find = async () => [userA, userB];

    const mockGmailB = {
      users: {
        getProfile: async () => ({ data: { historyId: "hist_b_1" } }),
        messages: {
          list: async () => ({ data: { messages: [] } })
        }
      }
    };

    await pollAllUsers({ gmailClient: mockGmailB });

    // User A should have caught error and updated syncStatus
    assert.equal(userA.syncStatus, "error");
    assert.match(userA.syncError, /Simulated network outage for user A/);

    // User B should have continued and succeeded
    assert.equal(userBSynced, true, "User B must complete sync despite User A failure");
    assert.equal(userB.syncStatus, "idle");
    assert.equal(userB.syncError, null);
  });

  it("6. Auto-reply loop protection detects own address, auto-submitted, precedence, and bot senders", () => {
    // 1. Own address
    const emailOwn = {
      payload: {
        headers: [{ name: "From", value: "owner@example.com" }]
      }
    };
    const check1 = shouldSkipLoopProtection(emailOwn, "owner@example.com");
    assert.equal(check1.skip, true);
    assert.match(check1.reason, /own_address/);

    // 2. Auto-Submitted: auto-replied
    const emailAuto = {
      payload: {
        headers: [
          { name: "From", value: "other@example.com" },
          { name: "Auto-Submitted", value: "auto-replied" }
        ]
      }
    };
    const check2 = shouldSkipLoopProtection(emailAuto, "owner@example.com");
    assert.equal(check2.skip, true);
    assert.match(check2.reason, /auto_submitted/);

    // 3. Precedence: bulk
    const emailBulk = {
      payload: {
        headers: [
          { name: "From", value: "other@example.com" },
          { name: "Precedence", value: "bulk" }
        ]
      }
    };
    const check3 = shouldSkipLoopProtection(emailBulk, "owner@example.com");
    assert.equal(check3.skip, true);
    assert.match(check3.reason, /precedence_bulk/);

    // 4. List-Unsubscribe
    const emailList = {
      payload: {
        headers: [
          { name: "From", value: "newsletter@example.com" },
          { name: "List-Unsubscribe", value: "<https://unsub.com>" }
        ]
      }
    };
    const check4 = shouldSkipLoopProtection(emailList, "owner@example.com");
    assert.equal(check4.skip, true);
    assert.match(check4.reason, /list_unsubscribe/);

    // 5. No-reply sender
    const emailNoReply = {
      payload: {
        headers: [{ name: "From", value: "noreply@service.com" }]
      }
    };
    const check5 = shouldSkipLoopProtection(emailNoReply, "owner@example.com");
    assert.equal(check5.skip, true);
    assert.match(check5.reason, /bot_or_bounce_sender/);

    // 6. Legitimate sender
    const emailLegit = {
      payload: {
        headers: [
          { name: "From", value: "Alice Cooper <alice@partner.com>" },
          { name: "Subject", value: "Project update" }
        ]
      }
    };
    const check6 = shouldSkipLoopProtection(emailLegit, "owner@example.com");
    assert.equal(check6.skip, false);
  });
});
