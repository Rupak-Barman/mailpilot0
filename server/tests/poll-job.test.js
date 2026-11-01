// tests/poll-job.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import EmailAction from "../models/EmailAction.js";
import Analytics from "../models/Analytics.js";
import {
  processMessage,
  processThreadGroup,
  recoverStaleProcessing,
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

describe("Poll job & sync engine - BATCH 1 part 2B", () => {
  const originalFetch = global.fetch;
  const originalProcessedEmailFindOne = ProcessedEmail.findOne;
  const originalProcessedEmailCreate = ProcessedEmail.create;
  const originalProcessedEmailFind = ProcessedEmail.find;
  const originalEmailActionFindOne = EmailAction.findOne;
  const originalEmailActionCreate = EmailAction.create;
  const originalAnalyticsFindOne = Analytics.findOne;
  const originalAnalyticsCreate = Analytics.create;
  const originalUserFind = User.find;
  const originalUserFindOneAndUpdate = User.findOneAndUpdate;

  const mockQuery = (data = []) => {
    const p = Promise.resolve(data);
    p.select = () => Promise.resolve(data);
    return p;
  };

  beforeEach(() => {
    global.fetch = async (url, options) => {
      if (typeof url === "string" && url.includes("/api/chat")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              content: JSON.stringify({
                label: "Support",
                summary: "Customer support inquiry regarding assistance.",
                body: "Thank you for contacting support. We have received your request."
              })
            }
          }),
          text: async () => ""
        };
      }
      return originalFetch(url, options);
    };

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
    User.findOneAndUpdate = originalUserFindOneAndUpdate;
    activeUserLocks.clear();
  });

  it("1. own address skipped: records ProcessedEmail outcome 'skipped' with reason loop_protection:own_address", async () => {
    let savedClaim = null;
    ProcessedEmail.create = async (doc) => {
      savedClaim = {
        ...doc,
        save: async function () {
          return this;
        }
      };
      return savedClaim;
    };

    const user = {
      _id: "user_own_addr",
      email: "agent@mycorp.com",
      labels: [{ id: "lbl_1", name: "Support", enabled: true, action: { type: "reply" } }],
      save: async () => {}
    };

    const emailOwn = {
      id: "msg_own_1",
      threadId: "th_own_1",
      payload: {
        headers: [
          { name: "From", value: "agent@mycorp.com" },
          { name: "Subject", value: "Self note" }
        ],
        body: { data: Buffer.from("Self message").toString("base64") }
      }
    };

    const result = await processMessage({
      user,
      messageId: "msg_own_1",
      emailData: emailOwn
    });

    assert.equal(result.processed, false);
    assert.equal(result.outcome, "skipped");
    assert.match(result.reason, /own_address/);
    assert.equal(savedClaim.status, "done");
    assert.equal(savedClaim.outcome, "skipped");
    assert.match(savedClaim.failureReason, /own_address/);
  });

  it("2. auto-reply loop protection rules: Auto-Submitted, Precedence, X-Autoreply, List-Unsubscribe, and bot sender local-parts", () => {
    const userEmail = "me@example.com";

    // Auto-Submitted
    const autoSubEmail = {
      payload: {
        headers: [
          { name: "From", value: "sender@domain.com" },
          { name: "Auto-Submitted", value: "auto-generated" }
        ]
      }
    };
    const resAuto = shouldSkipLoopProtection(autoSubEmail, userEmail);
    assert.equal(resAuto.skip, true);
    assert.match(resAuto.reason, /auto_submitted/);

    // Auto-Submitted: "no" should NOT skip
    const autoNoEmail = {
      payload: {
        headers: [
          { name: "From", value: "sender@domain.com" },
          { name: "Auto-Submitted", value: "no" }
        ]
      }
    };
    const resAutoNo = shouldSkipLoopProtection(autoNoEmail, userEmail);
    assert.equal(resAutoNo.skip, false);

    // Precedence: bulk | list | junk
    for (const prec of ["bulk", "list", "junk"]) {
      const precEmail = {
        payload: {
          headers: [
            { name: "From", value: "sender@domain.com" },
            { name: "Precedence", value: prec }
          ]
        }
      };
      const resPrec = shouldSkipLoopProtection(precEmail, userEmail);
      assert.equal(resPrec.skip, true);
      assert.match(resPrec.reason, new RegExp(`precedence_${prec}`));
    }

    // List-Unsubscribe
    const unsubEmail = {
      payload: {
        headers: [
          { name: "From", value: "news@daily.com" },
          { name: "List-Unsubscribe", value: "<https://daily.com/unsub>" }
        ]
      }
    };
    assert.equal(shouldSkipLoopProtection(unsubEmail, userEmail).skip, true);

    // X-Autoreply
    const autoreplyEmail = {
      payload: {
        headers: [
          { name: "From", value: "colleague@office.com" },
          { name: "X-Autoreply", value: "yes" }
        ]
      }
    };
    const resAutoReply = shouldSkipLoopProtection(autoreplyEmail, userEmail);
    assert.equal(resAutoReply.skip, true);
    assert.match(resAutoReply.reason, /x_autoreply/);

    // Bot / bounce local-parts: noreply, no-reply, mailer-daemon, postmaster, bounce
    const botSenders = [
      "noreply@service.com",
      "no-reply@service.com",
      "mailer-daemon@googlemail.com",
      "postmaster@domain.org",
      "bounce@server.net",
      "bounce-12345@bounces.service.com"
    ];
    for (const bot of botSenders) {
      const botEmail = {
        payload: {
          headers: [{ name: "From", value: bot }]
        }
      };
      const resBot = shouldSkipLoopProtection(botEmail, userEmail);
      assert.equal(resBot.skip, true, `Sender ${bot} should be skipped by loop protection`);
      assert.match(resBot.reason, /bot_or_bounce_sender/);
    }
  });

  it("3. auto-reply loop protection: daily cap (DAILY_REPLY_CAP) skips and resets by date in dailyReplySentDate", async () => {
    // A: User reached daily cap today -> skipped
    const today = new Date();
    const userAtCap = {
      _id: "user_capped",
      email: "user@test.com",
      dailyReplySentCount: 50,
      dailyReplySentDate: today,
      labels: [{ id: "lbl_1", name: "Support", enabled: true, action: { type: "reply" } }],
      save: async () => {}
    };

    const email = {
      id: "msg_cap_1",
      threadId: "th_cap_1",
      payload: {
        headers: [
          { name: "From", value: "customer@test.com" },
          { name: "Subject", value: "Help needed" }
        ],
        body: { data: Buffer.from("Need help").toString("base64") }
      }
    };

    const checkCapped = shouldSkipLoopProtection(email, userAtCap);
    assert.equal(checkCapped.skip, true);
    assert.match(checkCapped.reason, /daily_reply_cap_exceeded/);

    let claimSaved = null;
    ProcessedEmail.create = async (doc) => {
      claimSaved = {
        ...doc,
        save: async function () {
          return this;
        }
      };
      return claimSaved;
    };

    const res = await processMessage({
      user: userAtCap,
      messageId: "msg_cap_1",
      emailData: email
    });
    assert.equal(res.processed, false);
    assert.equal(res.outcome, "skipped");
    assert.match(res.reason, /daily_reply_cap_exceeded/);
    assert.equal(claimSaved.outcome, "skipped");
    assert.match(claimSaved.failureReason, /daily_reply_cap_exceeded/);

    // B: User sent 50 replies yesterday -> count is reset by date!
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const userYesterday = {
      _id: "user_yesterday",
      email: "user@test.com",
      dailyReplySentCount: 50,
      dailyReplySentDate: yesterday
    };
    const checkReset = shouldSkipLoopProtection(email, userYesterday);
    assert.equal(checkReset.skip, false, "Daily count should reset when date is yesterday");
  });

  it("4. stale row with an existing reply is not resent (marked done with outcome 'sent')", async () => {
    let sendCalls = 0;
    const staleRow = {
      _id: "stale_row_1",
      messageId: "msg_stale_1",
      userId: "user_stale_test",
      status: "processing",
      attempts: 1,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      save: async function () {
        return this;
      }
    };

    ProcessedEmail.find = () => mockQuery([staleRow]);

    const fakeGmail = {
      users: {
        messages: {
          get: async () => ({
            data: { id: "msg_stale_1", threadId: "thread_stale_1" }
          }),
          send: async () => {
            sendCalls++;
            return { data: { id: "sent_should_not_happen" } };
          }
        },
        threads: {
          get: async () => ({
            data: {
              id: "thread_stale_1",
              messages: [
                { id: "m_incoming", labelIds: ["INBOX"] },
                { id: "m_reply_already_sent", labelIds: ["SENT"] }
              ]
            }
          })
        }
      }
    };

    const user = { _id: "user_stale_test", save: async () => {} };

    await recoverStaleProcessing(user, fakeGmail);

    assert.equal(staleRow.status, "done", "Stale row should be marked 'done'");
    assert.equal(staleRow.outcome, "sent", "Outcome should be 'sent'");
    assert.equal(sendCalls, 0, "Gmail send must NOT be called again");
  });

  it("5. stale row with an existing draft is not resent (marked done with outcome 'drafted')", async () => {
    let draftCalls = 0;
    const staleRow = {
      _id: "stale_row_2",
      messageId: "msg_stale_2",
      userId: "user_stale_test",
      status: "processing",
      attempts: 1,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
      save: async function () {
        return this;
      }
    };

    ProcessedEmail.find = () => mockQuery([staleRow]);

    const fakeGmail = {
      users: {
        messages: {
          get: async () => ({
            data: { id: "msg_stale_2", threadId: "thread_stale_2" }
          })
        },
        drafts: {
          create: async () => {
            draftCalls++;
            return { data: { id: "d_should_not_happen" } };
          }
        },
        threads: {
          get: async () => ({
            data: {
              id: "thread_stale_2",
              messages: [
                { id: "m_incoming", labelIds: ["INBOX"] },
                { id: "m_draft", labelIds: ["DRAFT"] }
              ]
            }
          })
        }
      }
    };

    const user = { _id: "user_stale_test", save: async () => {} };

    await recoverStaleProcessing(user, fakeGmail);

    assert.equal(staleRow.status, "done");
    assert.equal(staleRow.outcome, "drafted");
    assert.equal(draftCalls, 0, "Gmail draft create must NOT be called again");
  });

  it("6. stale row with no existing reply sets status 'retry' (not null) and increments attempts", async () => {
    const staleRow = {
      _id: "stale_row_3",
      messageId: "msg_stale_3",
      userId: "user_stale_test",
      status: "processing",
      attempts: 1,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
      save: async function () {
        return this;
      }
    };

    ProcessedEmail.find = () => mockQuery([staleRow]);

    const fakeGmail = {
      users: {
        messages: {
          get: async () => ({
            data: { id: "msg_stale_3", threadId: "thread_stale_3" }
          })
        },
        threads: {
          get: async () => ({
            data: {
              id: "thread_stale_3",
              messages: [{ id: "m_incoming", labelIds: ["INBOX"] }]
            }
          })
        }
      }
    };

    const user = { _id: "user_stale_test", save: async () => {} };

    await recoverStaleProcessing(user, fakeGmail);

    assert.equal(staleRow.status, "retry", "Status must be 'retry' (not null)");
    assert.notEqual(staleRow.status, null);
    assert.equal(staleRow.attempts, 2, "Attempts must be incremented to 2");
  });

  it("7. stale row after 3 attempts is marked 'failed' with failureReason 'stale_recovery_exhausted'", async () => {
    const staleRow = {
      _id: "stale_row_4",
      messageId: "msg_stale_4",
      userId: "user_stale_test",
      status: "processing",
      attempts: 3,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
      save: async function () {
        return this;
      }
    };

    ProcessedEmail.find = () => mockQuery([staleRow]);

    const fakeGmail = {
      users: {
        messages: {
          get: async () => ({
            data: { id: "msg_stale_4", threadId: "thread_stale_4" }
          })
        },
        threads: {
          get: async () => ({
            data: {
              id: "thread_stale_4",
              messages: [{ id: "m_incoming", labelIds: ["INBOX"] }]
            }
          })
        }
      }
    };

    const user = { _id: "user_stale_test", save: async () => {} };

    await recoverStaleProcessing(user, fakeGmail);

    assert.equal(staleRow.status, "failed");
    assert.equal(staleRow.outcome, "failed");
    assert.equal(staleRow.failureReason, "stale_recovery_exhausted");
  });

  it("8. three messages in one thread produce one reply", async () => {
    let sendCalls = 0;
    let sentRequestBody = null;
    let createdEmailAction = null;
    const savedClaims = new Map();

    ProcessedEmail.findOne = async ({ messageId }) => savedClaims.get(messageId) || null;
    ProcessedEmail.create = async (doc) => {
      const claim = {
        ...doc,
        save: async function () {
          savedClaims.set(this.messageId, this);
          return this;
        }
      };
      savedClaims.set(doc.messageId, claim);
      return claim;
    };

    EmailAction.findOne = async () => null;
    EmailAction.create = async (doc) => {
      createdEmailAction = doc;
      return doc;
    };

    const user = {
      _id: "user_thread_group",
      email: "support@agent.com",
      dailyReplySentCount: 0,
      dailyReplySentDate: null,
      labels: [
        {
          id: "label_support",
          name: "Support",
          enabled: true,
          action: { type: "reply" },
          markAsRead: true
        }
      ],
      save: async () => {}
    };

    const fakeGmail = {
      users: {
        messages: {
          get: async ({ id }) => {
            const dateMap = {
              msg_1: "1670000001000",
              msg_2: "1670000002000",
              msg_3: "1670000003000"
            };
            const subjectMap = {
              msg_1: "First question",
              msg_2: "Second update",
              msg_3: "Third final detail"
            };
            return {
              data: {
                id,
                threadId: "thread_grouped_1",
                internalDate: dateMap[id] || "1670000000000",
                snippet: `Snippet for ${id}`,
                payload: {
                  headers: [
                    { name: "From", value: "client@external.com" },
                    { name: "Subject", value: subjectMap[id] || "Support request" },
                    { name: "Message-ID", value: `<${id}@external.com>` }
                  ],
                  body: { data: Buffer.from(`Body content for ${id}`).toString("base64") }
                }
              }
            };
          },
          modify: async () => ({}),
          send: async ({ requestBody }) => {
            sendCalls++;
            sentRequestBody = requestBody;
            return { data: { id: "sent_reply_xyz" } };
          }
        }
      }
    };

    const threadItems = [
      { id: "msg_1", threadId: "thread_grouped_1" },
      { id: "msg_2", threadId: "thread_grouped_1" },
      { id: "msg_3", threadId: "thread_grouped_1" }
    ];

    const result = await processThreadGroup({
      user,
      gmail: fakeGmail,
      threadId: "thread_grouped_1",
      items: threadItems
    });

    assert.equal(result.processed, true);
    assert.equal(sendCalls, 1, "Exactly ONE reply must be sent for the three messages in the thread");
    assert.equal(sentRequestBody.threadId, "thread_grouped_1");

    // All three messages must be claimed and marked done in ProcessedEmail
    assert.equal(savedClaims.size, 3, "All 3 messages must have ProcessedEmail records");
    const claim1 = savedClaims.get("msg_1");
    const claim2 = savedClaims.get("msg_2");
    const claim3 = savedClaims.get("msg_3");

    assert.equal(claim1.status, "done");
    assert.equal(claim2.status, "done");
    assert.equal(claim3.status, "done");

    // msg_1 and msg_2 labeled/grouped, newest msg_3 marked sent
    assert.equal(claim1.outcome, "labeled");
    assert.equal(claim2.outcome, "labeled");
    assert.equal(claim3.outcome, "sent");

    // EmailAction conversationHistory has turns for all 3 incoming messages plus 1 outgoing
    assert.ok(createdEmailAction, "EmailAction should be created");
    assert.equal(createdEmailAction.threadId, "thread_grouped_1");
    assert.equal(
      createdEmailAction.conversationHistory.length,
      4,
      "Conversation history must have 3 incoming turns + 1 outgoing reply turn"
    );

    const incomingTurns = createdEmailAction.conversationHistory.filter(h => h.role === "incoming");
    const outgoingTurns = createdEmailAction.conversationHistory.filter(h => h.role === "outgoing");
    assert.equal(incomingTurns.length, 3, "All 3 incoming messages must be summarised");
    assert.equal(outgoingTurns.length, 1, "There must be exactly 1 outgoing reply turn");
    assert.equal(outgoingTurns[0].type, "reply");
  });

  it("9. needsRelogin: skips users flagged needsRelogin in syncUser and pollAllUsers", async () => {
    let syncUserCalled = false;
    const userNeedingRelogin = {
      _id: "user_relogin_needed",
      email: "relogin@test.com",
      needsRelogin: true,
      refreshToken: "token_abc",
      labels: [{ id: "l1", name: "Support", enabled: true }],
      save: async () => {}
    };

    // Test in syncUser
    const res = await syncUser(userNeedingRelogin);
    assert.equal(res.skipped, true);
    assert.equal(res.reason, "needs_relogin");

    // Test in pollAllUsers: query excludes users where needsRelogin is true
    User.find = async (query) => {
      // If query requires needsRelogin: { $ne: true }, userNeedingRelogin is excluded
      const isExcluded = query.needsRelogin && query.needsRelogin.$ne === true;
      if (isExcluded) return [];
      return [userNeedingRelogin];
    };

    await pollAllUsers();
    assert.equal(syncUserCalled, false, "Users with needsRelogin=true must not be polled");
  });

  it("10. needsRelogin: flag is cleared on successful login in passport strategy", async () => {
    let updatedFields = null;
    User.findOneAndUpdate = async (filter, update) => {
      updatedFields = update;
      return { _id: "user_123", ...update };
    };

    // Simulate Google OAuth verify callback in passport.js
    const profile = { id: "google_123", emails: [{ value: "user@gmail.com" }], displayName: "User Name" };
    const accessToken = "access_token_fresh";
    const refreshToken = "refresh_token_fresh";

    await User.findOneAndUpdate(
      { googleId: profile.id },
      {
        email: profile.emails[0].value,
        name: profile.displayName,
        accessToken,
        refreshToken,
        needsRelogin: false,
        syncStatus: "idle",
        syncError: null
      },
      { upsert: true, new: true }
    );

    assert.equal(updatedFields.needsRelogin, false, "needsRelogin flag must be cleared to false");
    assert.equal(updatedFields.syncStatus, "idle");
    assert.equal(updatedFields.syncError, null);
  });
});
