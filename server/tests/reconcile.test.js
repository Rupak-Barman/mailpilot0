// tests/reconcile.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import EmailAction from "../models/EmailAction.js";
import { reconcileTurn, reconcileUser } from "../services/reconcile.service.js";
import { syncUser } from "../jobs/poll.job.js";
import { handleSendDraft, handleDeleteDraft } from "../routes/emailAction.routes.js";
import { google } from "googleapis";

const mockRes = () => {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    }
  };
};

describe("BATCH 5.6: Gmail Reconcile", () => {
  const originalProcessedEmailFindOne = ProcessedEmail.findOne;
  const originalProcessedEmailFindOneAndUpdate = ProcessedEmail.findOneAndUpdate;
  const originalProcessedEmailFind = ProcessedEmail.find;
  const originalEmailActionFind = EmailAction.find;
  const originalEmailActionFindOne = EmailAction.findOne;
  const originalEmailActionCreate = EmailAction.create;

  const originalGoogleGmail = google.gmail;
  const originalUserFindById = User.findById;

  beforeEach(() => {
    ProcessedEmail.findOne = async () => null;
    ProcessedEmail.findOneAndUpdate = async () => ({});
    ProcessedEmail.find = () => {
      const arr = [];
      arr.select = () => [];
      return arr;
    };
  });

  afterEach(() => {
    google.gmail = originalGoogleGmail;
    User.findById = originalUserFindById;
    ProcessedEmail.findOne = originalProcessedEmailFindOne;
    ProcessedEmail.findOneAndUpdate = originalProcessedEmailFindOneAndUpdate;
    ProcessedEmail.find = originalProcessedEmailFind;
    EmailAction.find = originalEmailActionFind;
    EmailAction.findOne = originalEmailActionFindOne;
    EmailAction.create = originalEmailActionCreate;
  });

  it("1. draft edited in Gmail: updates stored subject, to, body, messageId, sets editedInGmail=true and editedAt", async () => {
    const user = {
      _id: "user_rec_1",
      email: "agent@mailpilot.com"
    };

    const action = {
      _id: "act_rec_1",
      userId: "user_rec_1",
      threadId: "thread_123",
      subject: "Old Subject",
      to: "client@example.com",
      body: "Old draft body from AI.",
      turns: [
        {
          incomingMessageId: "msg_in_1",
          gmailThreadId: "thread_123",
          receivedAt: new Date(Date.now() - 60000),
          outcome: "drafted",
          outgoing: {
            kind: "draft",
            status: "draft",
            gmailDraftId: "draft_abc_1",
            gmailMessageId: "msg_old_1",
            subject: "Old Subject",
            to: "client@example.com",
            cc: "",
            bcc: "",
            body: "Old draft body from AI.",
            createdAt: new Date(Date.now() - 50000)
          }
        }
      ],
      save: async function () {
        return this;
      }
    };

    const mockGmail = {
      users: {
        drafts: {
          get: async ({ id }) => {
            assert.equal(id, "draft_abc_1");
            return {
              data: {
                id: "draft_abc_1",
                message: {
                  id: "msg_edited_new_99",
                  threadId: "thread_123",
                  payload: {
                    headers: [
                      { name: "Subject", value: "Updated Subject in Gmail" },
                      { name: "To", value: "updated_client@example.com" },
                      { name: "Cc", value: "team@example.com" },
                      { name: "Bcc", value: "archive@example.com" }
                    ],
                    mimeType: "text/plain",
                    body: {
                      data: Buffer.from("Here is the edited draft body written directly in Gmail web app.").toString("base64")
                    }
                  }
                }
              }
            };
          }
        }
      }
    };

    const result = await reconcileTurn(user, action, action.turns[0], { gmail: mockGmail });

    assert.equal(result.status, "draft");
    assert.equal(result.edited, true);

    const turn = action.turns[0];
    assert.equal(turn.outgoing.editedInGmail, true);
    assert.ok(turn.outgoing.editedAt instanceof Date);
    assert.equal(turn.outgoing.subject, "Updated Subject in Gmail");
    assert.equal(turn.outgoing.to[0]?.email, "updated_client@example.com");
    assert.equal(turn.outgoing.cc[0]?.email, "team@example.com");
    assert.equal(turn.outgoing.bcc[0]?.email, "archive@example.com");
    assert.equal(turn.outgoing.body, "Here is the edited draft body written directly in Gmail web app.");
    assert.equal(turn.outgoing.gmailMessageId, "msg_edited_new_99");
    assert.ok(turn.outgoing.lastReconciledAt instanceof Date);

    // Latest turn updates top-level action fields
    assert.equal(action.subject, "Updated Subject in Gmail");
    assert.equal(action.to, "updated_client@example.com");
    assert.equal(action.cc, "team@example.com");
    assert.equal(action.bcc, "archive@example.com");
    assert.equal(action.body, "Here is the edited draft body written directly in Gmail web app.");
    assert.equal(action.gmailMessageId, "msg_edited_new_99");
  });

  it("2. draft sent in Gmail: 404 from drafts.get finds SENT message in thread -> marks sent & ai_draft_sent", async () => {
    const user = {
      _id: "user_rec_2",
      email: "agent@mailpilot.com"
    };

    const draftCreatedAt = new Date(Date.now() - 30000);
    const sentTime = Date.now() - 5000;

    let processedEmailUpdated = null;
    ProcessedEmail.findOneAndUpdate = async (filter, update) => {
      processedEmailUpdated = { filter, update };
      return {};
    };

    const action = {
      _id: "act_rec_2",
      userId: "user_rec_2",
      threadId: "thread_456",
      turns: [
        {
          incomingMessageId: "msg_in_2",
          gmailThreadId: "thread_456",
          receivedAt: new Date(Date.now() - 60000),
          outcome: "drafted",
          outgoing: {
            kind: "draft",
            status: "draft",
            gmailDraftId: "draft_sent_in_gmail_404",
            createdAt: draftCreatedAt
          }
        }
      ],
      save: async function () {
        return this;
      }
    };

    const mockGmail = {
      users: {
        drafts: {
          get: async () => {
            const err = new Error("Draft not found");
            err.status = 404;
            throw err;
          }
        },
        threads: {
          get: async ({ id }) => {
            assert.equal(id, "thread_456");
            return {
              data: {
                id: "thread_456",
                messages: [
                  {
                    id: "msg_in_2",
                    internalDate: String(Date.now() - 60000),
                    labelIds: ["INBOX"]
                  },
                  {
                    id: "msg_sent_from_gmail_1",
                    internalDate: String(sentTime),
                    labelIds: ["SENT"]
                  }
                ]
              }
            };
          }
        }
      }
    };

    const result = await reconcileTurn(user, action, action.turns[0], { gmail: mockGmail });

    assert.equal(result.status, "sent");
    assert.equal(result.sentFrom, "gmail");

    const turn = action.turns[0];
    assert.equal(turn.outgoing.status, "sent");
    assert.equal(turn.outgoing.sentFrom, "gmail");
    assert.equal(turn.outgoing.gmailMessageId, "msg_sent_from_gmail_1");
    assert.equal(turn.outgoing.sentAt.getTime(), sentTime);
    assert.equal(action.status, "sent");

    assert.ok(processedEmailUpdated);
    assert.equal(processedEmailUpdated.update.$set.resolution, "ai_draft_sent");
    assert.equal(processedEmailUpdated.update.$set.sentAt.getTime(), sentTime);
  });

  it("3. draft deleted in Gmail: 404 with no SENT message -> marks status 'deleted' and ProcessedEmail resolution 'none'", async () => {
    const user = {
      _id: "user_rec_3",
      email: "agent@mailpilot.com"
    };

    let processedEmailUpdated = null;
    ProcessedEmail.findOneAndUpdate = async (filter, update) => {
      processedEmailUpdated = { filter, update };
      return {};
    };

    const action = {
      _id: "act_rec_3",
      userId: "user_rec_3",
      threadId: "thread_789",
      type: "draft",
      status: "draft",
      turns: [
        {
          incomingMessageId: "msg_in_3",
          gmailThreadId: "thread_789",
          receivedAt: new Date(Date.now() - 60000),
          outcome: "drafted",
          outgoing: {
            kind: "draft",
            status: "draft",
            gmailDraftId: "draft_del_404",
            createdAt: new Date(Date.now() - 30000)
          }
        }
      ],
      save: async function () {
        return this;
      }
    };

    const mockGmail = {
      users: {
        drafts: {
          get: async () => {
            const err = new Error("Draft deleted");
            err.status = 404;
            throw err;
          }
        },
        threads: {
          get: async () => ({
            data: {
              id: "thread_789",
              messages: [
                {
                  id: "msg_in_3",
                  internalDate: String(Date.now() - 60000),
                  labelIds: ["INBOX"]
                }
                // No SENT message
              ]
            }
          })
        }
      }
    };

    const result = await reconcileTurn(user, action, action.turns[0], { gmail: mockGmail });

    assert.equal(result.status, "deleted");
    assert.equal(action.turns[0].outgoing.status, "deleted");
    assert.notEqual(action.type, "draft"); // Leaves Drafts tab
    assert.equal(action.status, "reviewed"); // Visible under All

    assert.ok(processedEmailUpdated);
    assert.equal(processedEmailUpdated.update.$set.resolution, "none");
  });

  it("4. manual reply to a failed item: thread has SENT message after receivedAt -> marks resolved manually in Gmail", async () => {
    const user = {
      _id: "user_rec_4",
      email: "agent@mailpilot.com"
    };

    const receivedTime = Date.now() - 100000;
    const sentTime = Date.now() - 20000;

    let processedEmailUpdated = null;
    ProcessedEmail.findOneAndUpdate = async (filter, update) => {
      processedEmailUpdated = { filter, update };
      return {};
    };

    const action = {
      _id: "act_rec_4",
      userId: "user_rec_4",
      threadId: "thread_failed_1",
      type: "failed",
      status: "failed",
      turns: [
        {
          incomingMessageId: "msg_in_failed",
          gmailThreadId: "thread_failed_1",
          receivedAt: new Date(receivedTime),
          outcome: "needs_manual",
          failureReason: "no_knowledge_match"
        }
      ],
      save: async function () {
        return this;
      }
    };

    const mockGmail = {
      users: {
        threads: {
          get: async () => ({
            data: {
              id: "thread_failed_1",
              messages: [
                {
                  id: "msg_in_failed",
                  internalDate: String(receivedTime),
                  labelIds: ["INBOX"]
                },
                {
                  id: "msg_manual_reply_from_gmail",
                  internalDate: String(sentTime),
                  labelIds: ["SENT"]
                }
              ]
            }
          })
        }
      }
    };

    const result = await reconcileTurn(user, action, action.turns[0], { gmail: mockGmail });

    assert.equal(result.status, "sent");
    assert.equal(result.resolution, "manual");
    assert.equal(result.sentFrom, "gmail");

    const turn = action.turns[0];
    assert.equal(turn.outcome, "sent");
    assert.equal(turn.outgoing.status, "sent");
    assert.equal(turn.outgoing.composedManually, true);
    assert.equal(turn.outgoing.sentFrom, "gmail");
    assert.equal(turn.outgoing.gmailMessageId, "msg_manual_reply_from_gmail");

    assert.equal(action.status, "sent");
    assert.equal(action.type, "reply"); // Empties Failed tab

    assert.ok(processedEmailUpdated);
    assert.equal(processedEmailUpdated.update.$set.resolution, "manual");
    assert.equal(processedEmailUpdated.update.$set.outcome, "sent");
    assert.equal(processedEmailUpdated.update.$set.sentAt.getTime(), sentTime);
  });

  it("5. rate limiting of checks: skips turns reconciled < 2 minutes ago and caps at 30 turns per run", async () => {
    const user = {
      _id: "user_rec_5",
      email: "agent@mailpilot.com"
    };

    let draftsGetCount = 0;
    const mockGmail = {
      users: {
        drafts: {
          get: async () => {
            draftsGetCount++;
            return {
              data: {
                id: "draft_test",
                message: {
                  id: "msg_same",
                  payload: { headers: [] }
                }
              }
            };
          }
        }
      }
    };

    // Subcase 5a: Recently checked turn (<2 min) is skipped
    const recentAction = {
      _id: "act_recent",
      userId: "user_rec_5",
      threadId: "thread_rec_1",
      turns: [
        {
          gmailThreadId: "thread_rec_1",
          outgoing: {
            kind: "draft",
            status: "draft",
            gmailDraftId: "draft_skip_1",
            lastReconciledAt: new Date(Date.now() - 30 * 1000) // 30s ago
          }
        }
      ],
      save: async () => {}
    };

    EmailAction.find = () => ({
      sort: () => [recentAction]
    });

    const res1 = await reconcileUser(user, { gmail: mockGmail });
    assert.equal(res1.checkedCount, 0);
    assert.equal(draftsGetCount, 0);

    // Subcase 5b: Turn checked >2 min ago is processed
    recentAction.turns[0].outgoing.lastReconciledAt = new Date(Date.now() - 150 * 1000); // 2.5 min ago
    const res2 = await reconcileUser(user, { gmail: mockGmail });
    assert.equal(res2.checkedCount, 1);
    assert.equal(draftsGetCount, 1);

    // Subcase 5c: Cap at 30 turns per run
    draftsGetCount = 0;
    const manyActions = [];
    for (let i = 0; i < 35; i++) {
      manyActions.push({
        _id: `act_${i}`,
        userId: "user_rec_5",
        threadId: `thread_${i}`,
        turns: [
          {
            gmailThreadId: `thread_${i}`,
            outgoing: {
              kind: "draft",
              status: "draft",
              gmailDraftId: `draft_${i}`,
              lastReconciledAt: null
            }
          }
        ],
        save: async () => {}
      });
    }

    EmailAction.find = () => ({
      sort: () => manyActions
    });

    const res3 = await reconcileUser(user, { gmail: mockGmail });
    assert.equal(res3.checkedCount, 30);
    assert.equal(draftsGetCount, 30);
  });

  it("6. reconcile failure does not break the sync", async () => {
    const user = {
      _id: "user_rec_6",
      email: "agent@mailpilot.com",
      gmailHistoryId: "hist_100",
      syncStatus: "running",
      labels: [{ id: "lbl_1", name: "Support", enabled: true }],
      save: async function () {
        return this;
      }
    };

    const mockGmail = {
      users: {
        history: {
          list: async () => ({
            data: {
              historyId: "hist_101",
              history: []
            }
          })
        },
        drafts: {
          get: async () => {
            throw new Error("Fatal Gmail API error during reconcile");
          }
        }
      }
    };

    // Stale row query return empty
    ProcessedEmail.find = () => {
      const arr = [];
      arr.select = () => [];
      return arr;
    };

    EmailAction.find = () => ({
      sort: () => [
        {
          userId: user._id,
          threadId: "thread_err",
          turns: [
            {
              outgoing: {
                kind: "draft",
                status: "draft",
                gmailDraftId: "draft_err",
                lastReconciledAt: null
              }
            }
          ],
          save: async () => {}
        }
      ]
    });

    // Should complete cleanly without throwing
    const syncRes = await syncUser(user, { gmailClient: mockGmail });
    assert.equal(syncRes.success, true);
    assert.equal(user.syncStatus, "idle");
  });

  it("7. app Send action handles 404 by running reconcile and returning a clear 409 message", async () => {
    const fakeUser = {
      _id: "user_send_404",
      refreshToken: "fake-refresh"
    };
    User.findById = async () => fakeUser;

    const actionDoc = {
      _id: "act_send_404",
      userId: "user_send_404",
      threadId: "thread_send_404",
      type: "draft",
      status: "draft",
      gmailDraftId: "draft_send_404_id",
      turns: [
        {
          incomingMessageId: "msg_in_send_404",
          gmailThreadId: "thread_send_404",
          outgoing: {
            kind: "draft",
            status: "draft",
            gmailDraftId: "draft_send_404_id",
            createdAt: new Date(Date.now() - 30000)
          }
        }
      ],
      save: async function () {
        return this;
      }
    };
    EmailAction.findOne = async () => actionDoc;

    const mockGmail = {
      users: {
        drafts: {
          send: async () => {
            const err = new Error("Draft not found");
            err.status = 404;
            throw err;
          },
          get: async () => {
            const err = new Error("Draft not found");
            err.status = 404;
            throw err;
          }
        },
        threads: {
          get: async () => ({
            data: {
              id: "thread_send_404",
              messages: [
                {
                  id: "sent_msg_found",
                  internalDate: String(Date.now()),
                  labelIds: ["SENT"]
                }
              ]
            }
          })
        }
      }
    };
    google.gmail = () => mockGmail;

    const req = {
      user: { id: "user_send_404" },
      params: { id: "act_send_404" }
    };
    const res = mockRes();

    await handleSendDraft(req, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.jsonData.message, /already sent/i);
    assert.equal(actionDoc.turns[0].outgoing.status, "sent");
    assert.equal(actionDoc.turns[0].outgoing.sentFrom, "gmail");
  });

  it("8. app Delete action handles 404 by running reconcile and returning a clear message", async () => {
    const fakeUser = {
      _id: "user_del_404",
      refreshToken: "fake-refresh"
    };
    User.findById = async () => fakeUser;

    const actionDoc = {
      _id: "act_del_404",
      userId: "user_del_404",
      threadId: "thread_del_404",
      type: "draft",
      status: "draft",
      gmailDraftId: "draft_del_404_id",
      turns: [
        {
          incomingMessageId: "msg_in_del_404",
          gmailThreadId: "thread_del_404",
          outgoing: {
            kind: "draft",
            status: "draft",
            gmailDraftId: "draft_del_404_id",
            createdAt: new Date(Date.now() - 30000)
          }
        }
      ],
      save: async function () {
        return this;
      }
    };
    EmailAction.findOne = async () => actionDoc;

    const mockGmail = {
      users: {
        drafts: {
          delete: async () => {
            const err = new Error("Draft not found");
            err.status = 404;
            throw err;
          },
          get: async () => {
            const err = new Error("Draft not found");
            err.status = 404;
            throw err;
          }
        },
        threads: {
          get: async () => ({
            data: {
              id: "thread_del_404",
              messages: []
            }
          })
        }
      }
    };
    google.gmail = () => mockGmail;

    const req = {
      user: { id: "user_del_404" },
      params: { id: "act_del_404" }
    };
    const res = mockRes();

    await handleDeleteDraft(req, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.jsonData.message, /already deleted/i);
    assert.equal(actionDoc.turns[0].outgoing.status, "deleted");
  });
});
