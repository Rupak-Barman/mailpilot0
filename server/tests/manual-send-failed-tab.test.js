import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import EmailAction from "../models/EmailAction.js";
import {
  handleManualSend,
  handleTryAiDraft,
  handleGetSummary,
  handleGetEmailActions,
  buildFailedFilter
} from "../routes/emailAction.routes.js";
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

describe("BATCH 3 UI: manual-send and failed-tab queries", () => {
  const originalGoogleGmail = google.gmail;
  const originalUserFindById = User.findById;
  const originalActionFindOne = EmailAction.findOne;
  const originalActionFind = EmailAction.find;
  const originalActionCount = EmailAction.countDocuments;
  const originalProcessedUpdate = ProcessedEmail.findOneAndUpdate;
  const originalFetch = global.fetch;

  let sentMessages = [];
  let createdDrafts = [];
  let updatedProcessed = [];
  let savedActions = [];

  const fakeUser = {
    _id: "user123",
    email: "user@example.com",
    name: "Alex Doe",
    description: "Support manager",
    refreshToken: "fake-refresh-token",
    labels: [
      {
        name: "Support",
        tone: "friendly",
        action: { type: "reply" },
        grounding: "strict",
        knowledgeDocumentIds: ["doc1"]
      }
    ]
  };

  const fakeGmailClient = {
    users: {
      messages: {
        send: async ({ userId, requestBody }) => {
          sentMessages.push({ userId, requestBody });
          return { data: { id: "sent_msg_999" } };
        },
        get: async ({ id }) => {
          return {
            data: {
              id,
              payload: {
                headers: [
                  { name: "Message-ID", value: "<sent_msg_999@mail.gmail.com>" }
                ]
              }
            }
          };
        }
      },
      drafts: {
        create: async ({ userId, requestBody }) => {
          createdDrafts.push({ userId, requestBody });
          return {
            data: {
              id: "draft_new_888",
              message: { id: "draft_msg_888" }
            }
          };
        }
      }
    }
  };

  beforeEach(() => {
    sentMessages = [];
    createdDrafts = [];
    updatedProcessed = [];
    savedActions = [];

    google.gmail = () => fakeGmailClient;

    User.findById = async (id) => {
      if (String(id) === "user123") return fakeUser;
      return null;
    };

    ProcessedEmail.findOneAndUpdate = async (filter, update) => {
      updatedProcessed.push({ filter, update });
      return { ...filter, ...update?.$set };
    };

    global.fetch = async (url, options) => {
      let promptContent = "";
      try {
        const body = JSON.parse(options.body);
        promptContent = body.messages?.[0]?.content || "";
      } catch {}

      if (promptContent.includes("Classify the incoming email")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              content: JSON.stringify({
                label: "Support",
                summary: "User requested technical assistance."
              })
            }
          })
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            content: JSON.stringify({
              can_answer: true,
              body: "Thank you for reaching out. We are actively investigating your issue."
            })
          }
        })
      };
    };
  });

  afterEach(() => {
    google.gmail = originalGoogleGmail;
    User.findById = originalUserFindById;
    EmailAction.findOne = originalActionFindOne;
    EmailAction.find = originalActionFind;
    EmailAction.countDocuments = originalActionCount;
    ProcessedEmail.findOneAndUpdate = originalProcessedUpdate;
    global.fetch = originalFetch;
  });

  it("handleManualSend sends via Gmail in turn's thread with threading headers and updates ProcessedEmail", async () => {
    const actionDoc = {
      _id: "action_1",
      userId: "user123",
      threadId: "gmail_thread_100",
      sourceMessageId: "inc_msg_100",
      to: "customer@example.com",
      subject: "Help with invoice",
      status: "failed",
      type: "failed",
      checked: false,
      turns: [
        {
          incomingMessageId: "inc_msg_100",
          gmailThreadId: "gmail_thread_turn_100",
          rfcMessageId: "<orig_100@mail.domain.com>",
          inReplyToHeader: "<prev_50@mail.domain.com>",
          referencesHeader: "<prev_50@mail.domain.com> <orig_100@mail.domain.com>",
          from: "customer@example.com",
          receivedAt: new Date(),
          incomingSubject: "Help with invoice",
          incomingSummary: "Needs invoice copy.",
          outcome: "needs_manual",
          failureReason: "no_knowledge_match"
        }
      ],
      save: async function () {
        savedActions.push(this);
        return this;
      }
    };

    EmailAction.findOne = async ({ _id, userId }) => {
      if (_id === "action_1" && userId === "user123") return actionDoc;
      return null;
    };

    const req = {
      user: { id: "user123" },
      params: { id: "action_1" },
      body: {
        body: "Here is your invoice attached. Please let us know if you need anything else."
      }
    };
    const res = mockRes();

    await handleManualSend(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonData.message, "Reply sent successfully");

    // Verify Gmail call
    assert.equal(sentMessages.length, 1);
    const sentPayload = sentMessages[0].requestBody;
    assert.equal(sentPayload.threadId, "gmail_thread_turn_100");
    assert.ok(sentPayload.raw, "MIME raw message should be built");

    // Decode raw MIME to check In-Reply-To, References, and Re: subject
    const rawDecoded = Buffer.from(sentPayload.raw, "base64").toString("utf8");
    assert.ok(rawDecoded.includes("In-Reply-To: <orig_100@mail.domain.com>"));
    assert.ok(rawDecoded.includes("References: <prev_50@mail.domain.com> <orig_100@mail.domain.com>"));

    // Verify turn update
    const latestTurn = actionDoc.turns[0];
    assert.equal(latestTurn.outcome, "sent");
    assert.equal(latestTurn.outgoing.composedManually, true);
    assert.equal(latestTurn.outgoing.status, "sent");
    assert.ok(latestTurn.outgoing.sentAt instanceof Date);
    assert.equal(latestTurn.outgoing.gmailMessageId, "sent_msg_999");
    assert.equal(latestTurn.outgoing.rfcMessageId, "<sent_msg_999@mail.gmail.com>");

    // Verify EmailAction state
    assert.equal(actionDoc.status, "sent");
    assert.equal(actionDoc.checked, true);
    assert.ok(actionDoc.sentAt instanceof Date);

    // Verify ProcessedEmail update
    assert.equal(updatedProcessed.length, 1);
    const procUpdate = updatedProcessed[0];
    assert.equal(procUpdate.filter.messageId, "inc_msg_100");
    assert.equal(procUpdate.update.$set.status, "done");
    assert.equal(procUpdate.update.$set.outcome, "sent");
    assert.equal(procUpdate.update.$set.resolution, "manual");
    assert.ok(procUpdate.update.$set.sentAt instanceof Date);
    assert.ok(procUpdate.update.$set.resolvedAt instanceof Date);
  });

  it("handleManualSend returns 400 when reply body is missing", async () => {
    const req = {
      user: { id: "user123" },
      params: { id: "action_1" },
      body: { body: "   " }
    };
    const res = mockRes();

    await handleManualSend(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonData.message, "Reply body is required");
  });

  it("handleTryAiDraft generates ungrounded draft and never auto-sends", async () => {
    const actionDoc = {
      _id: "action_failed_1",
      userId: "user123",
      threadId: "gmail_thread_failed",
      sourceMessageId: "msg_failed_1",
      to: "client@example.com",
      subject: "Uncertain query",
      status: "failed",
      type: "failed",
      checked: false,
      turns: [
        {
          incomingMessageId: "msg_failed_1",
          gmailThreadId: "gmail_thread_failed",
          rfcMessageId: "<msg_failed_1@client.com>",
          from: "client@example.com",
          receivedAt: new Date(),
          incomingSubject: "Uncertain query",
          incomingSummary: "Asking about ungrounded topic.",
          outcome: "needs_manual",
          failureReason: "no_knowledge_match"
        }
      ],
      save: async function () {
        savedActions.push(this);
        return this;
      }
    };

    EmailAction.findOne = async () => actionDoc;

    const req = {
      user: { id: "user123" },
      params: { id: "action_failed_1" },
      body: {}
    };
    const res = mockRes();

    await handleTryAiDraft(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonData.ungrounded, true);
    assert.ok(res.jsonData.warning.includes("without document grounding"));

    // Verify draft was created, NEVER message sent
    assert.equal(createdDrafts.length, 1);
    assert.equal(sentMessages.length, 0);

    // Verify turn outgoing
    const latestTurn = actionDoc.turns[0];
    assert.equal(latestTurn.outcome, "drafted");
    assert.equal(latestTurn.outgoing.kind, "draft");
    assert.equal(latestTurn.outgoing.status, "draft");
    assert.equal(latestTurn.outgoing.ungrounded, true);
    assert.equal(latestTurn.outgoing.gmailDraftId, "draft_new_888");

    // Verify EmailAction status
    assert.equal(actionDoc.status, "draft");
    assert.equal(actionDoc.type, "draft");
  });

  it("buildFailedFilter matches latest turn needs_manual or failed, and excludes resolved threads", () => {
    const filter = buildFailedFilter("user123");
    assert.equal(filter.userId, "user123");
    assert.ok(Array.isArray(filter.$or));

    // The $expr clause checks the last element of $turns.outcome
    const exprCondition = filter.$or[0];
    assert.deepEqual(exprCondition.turns, { $exists: true, $not: { $size: 0 } });
    assert.deepEqual(exprCondition.$expr, {
      $in: [
        { $arrayElemAt: ["$turns.outcome", -1] },
        ["failed", "needs_manual"]
      ]
    });
  });

  it("handleGetSummary returns accurate failed badge count", async () => {
    EmailAction.countDocuments = async (query) => {
      if (query.checked === false) return 5;
      if (query.type === "draft") return 2;
      if (query.type === "reply") return 3;
      if (query.$or) return 4; // failed query
      return 14;
    };

    const req = { user: { id: "user123" } };
    const res = mockRes();

    await handleGetSummary(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.jsonData, {
      unchecked: 5,
      drafts: 2,
      replies: 3,
      failed: 4,
      total: 14
    });
  });

  it("handleGetEmailActions with tab=failed filters by latest turn failed/needs_manual", async () => {
    let capturedFilter = null;
    EmailAction.find = (filter) => {
      capturedFilter = filter;
      return {
        sort: () => ({
          skip: () => ({
            limit: async () => [
              {
                _id: "failed_1",
                to: "someone@example.com",
                status: "failed",
                type: "failed",
                turns: [
                  {
                    outcome: "needs_manual",
                    failureReason: "no_knowledge_match",
                    incomingSummary: "Help requested."
                  }
                ]
              }
            ]
          })
        })
      };
    };
    EmailAction.countDocuments = async () => 1;

    const req = {
      user: { id: "user123" },
      query: { tab: "failed" }
    };
    const res = mockRes();

    await handleGetEmailActions(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonData.items.length, 1);
    assert.equal(res.jsonData.items[0]._id, "failed_1");

    // Verify capturedFilter includes the failed expressions
    assert.ok(capturedFilter.$and);
    const failedClause = capturedFilter.$and[0];
    assert.ok(failedClause.$or);
  });
});
