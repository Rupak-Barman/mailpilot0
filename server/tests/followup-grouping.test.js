// tests/followup-grouping.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import EmailAction from "../models/EmailAction.js";
import Analytics from "../models/Analytics.js";
import {
  processThreadGroup,
  findMatchingEmailAction,
  normalizeEmailAddress,
  extractHeaderMessageIds,
} from "../jobs/poll.job.js";

describe("BATCH 2.5: Grouping Follow-ups", () => {
  const originalFetch = global.fetch;
  const originalProcessedEmailFindOne = ProcessedEmail.findOne;
  const originalProcessedEmailCreate = ProcessedEmail.create;
  const originalProcessedEmailFindOneAndUpdate = ProcessedEmail.findOneAndUpdate;
  const originalEmailActionFindOne = EmailAction.findOne;
  const originalEmailActionFind = EmailAction.find;
  const originalEmailActionCreate = EmailAction.create;
  const originalAnalyticsFindOne = Analytics.findOne;
  const originalAnalyticsCreate = Analytics.create;

  beforeEach(() => {
    // Mock Ollama chat API response
    global.fetch = async (url, options) => {
      if (typeof url === "string" && url.includes("/api/chat")) {
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
                  summary: "Summary of inquiry.",
                }),
              },
            }),
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              content: JSON.stringify({
                can_answer: true,
                body: "Thank you for reaching out to us today. We will look into this promptly.",
              }),
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    Analytics.findOne = async () => null;
    Analytics.create = async () => ({});
    ProcessedEmail.findOne = async () => null;
    ProcessedEmail.create = async (doc) => ({ ...doc, save: async () => doc });
    ProcessedEmail.findOneAndUpdate = async () => ({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    ProcessedEmail.findOne = originalProcessedEmailFindOne;
    ProcessedEmail.create = originalProcessedEmailCreate;
    ProcessedEmail.findOneAndUpdate = originalProcessedEmailFindOneAndUpdate;
    EmailAction.findOne = originalEmailActionFindOne;
    EmailAction.find = originalEmailActionFind;
    EmailAction.create = originalEmailActionCreate;
    Analytics.findOne = originalAnalyticsFindOne;
    Analytics.create = originalAnalyticsCreate;
  });

  it("normalizeEmailAddress and extractHeaderMessageIds extract clean values", () => {
    assert.equal(
      normalizeEmailAddress("Alice Smith <Alice.Smith@Example.COM>"),
      "alice.smith@example.com"
    );
    assert.equal(
      normalizeEmailAddress("bob@example.com"),
      "bob@example.com"
    );
    assert.deepEqual(
      extractHeaderMessageIds("<msg1@mail.com> <msg2@mail.com>"),
      ["<msg1@mail.com>", "<msg2@mail.com>"]
    );
    assert.deepEqual(
      extractHeaderMessageIds("<single@mail.com>"),
      ["<single@mail.com>"]
    );
    assert.deepEqual(
      extractHeaderMessageIds("raw-id-without-brackets"),
      ["raw-id-without-brackets"]
    );
  });

  it("1. same thread: incoming email with matching threadId appends turn with linkedBy 'thread'", async () => {
    const user = {
      _id: "user_group_1",
      email: "agent@mailpilot.com",
      profileDescription: "Support",
      labels: [
        {
          id: "label_sup",
          name: "Support",
          enabled: true,
          action: { type: "draft" },
        },
      ],
      settings: { groupBySender: false },
    };

    const existingDoc = {
      _id: "doc_thread_1",
      userId: "user_group_1",
      threadId: "gmail_thread_100",
      turns: [
        {
          incomingMessageId: "msg_orig_1",
          gmailThreadId: "gmail_thread_100",
          rfcMessageId: "<msg1@example.com>",
          from: "Alice <alice@example.com>",
          receivedAt: new Date(Date.now() - 3600000),
          incomingSubject: "Help Needed",
          outcome: "drafted",
          outgoing: {
            kind: "draft",
            status: "draft",
            gmailDraftId: "draft_orig_1",
          },
        },
      ],
      checked: true,
      save: async function () {
        return this;
      },
    };

    EmailAction.findOne = async (query) => {
      if (
        query.userId === "user_group_1" &&
        query.$or?.some(
          (cond) =>
            cond.threadId === "gmail_thread_100" ||
            cond["turns.gmailThreadId"] === "gmail_thread_100"
        )
      ) {
        return existingDoc;
      }
      return null;
    };

    ProcessedEmail.findOne = async () => null;
    ProcessedEmail.create = async (doc) => ({ ...doc, save: async () => doc });

    const mockGmail = {
      users: {
        messages: {
          get: async () => ({
            data: {
              id: "msg_followup_1",
              threadId: "gmail_thread_100",
              internalDate: String(Date.now()),
              snippet: "Follow up on the help request",
              payload: {
                headers: [
                  { name: "From", value: "Alice <alice@example.com>" },
                  { name: "Subject", value: "Re: Help Needed" },
                  { name: "Message-ID", value: "<followup1@example.com>" },
                ],
                body: {
                  data: Buffer.from("Here is more info").toString("base64"),
                },
              },
            },
          }),
          modify: async () => ({}),
        },
        drafts: {
          create: async () => ({
            data: { id: "draft_new_1", message: { id: "msg_draft_new_1" } },
          }),
          delete: async () => ({}),
        },
      },
    };

    await processThreadGroup({
      user,
      threadId: "gmail_thread_100",
      items: [{ id: "msg_followup_1" }],
      gmail: mockGmail,
    });

    // Existing doc should have 2 turns now
    assert.equal(existingDoc.turns.length, 2);
    const addedTurn = existingDoc.turns[1];
    assert.equal(addedTurn.linkedBy, "thread");
    assert.equal(addedTurn.gmailThreadId, "gmail_thread_100");
    assert.equal(addedTurn.rfcMessageId, "<followup1@example.com>");
    assert.equal(existingDoc.checked, false);
  });

  it("2. different subject with matching In-Reply-To: appends turn with linkedBy 'headers'", async () => {
    const user = {
      _id: "user_group_2",
      email: "agent@mailpilot.com",
      profileDescription: "Support",
      labels: [
        {
          id: "label_sup",
          name: "Support",
          enabled: true,
          action: { type: "draft" },
        },
      ],
      settings: { groupBySender: false },
    };

    const existingDoc = {
      _id: "doc_thread_2",
      userId: "user_group_2",
      threadId: "gmail_thread_200",
      turns: [
        {
          incomingMessageId: "msg_orig_2",
          gmailThreadId: "gmail_thread_200",
          rfcMessageId: "<orig2@client.com>",
          from: "Bob <bob@client.com>",
          incomingSubject: "Inquiry about pricing",
          outcome: "sent",
          outgoing: {
            kind: "reply",
            status: "sent",
            rfcMessageId: "<sent_reply_2@mailpilot.com>",
          },
        },
      ],
      checked: true,
      save: async function () {
        return this;
      },
    };

    EmailAction.findOne = async (query) => {
      // (a) thread query should not match because incoming threadId is different
      if (query.$or?.some((c) => c.threadId === "gmail_thread_different_300")) {
        return null;
      }
      // (b) headers query matching In-Reply-To
      if (
        query.$or?.some(
          (c) =>
            c["turns.rfcMessageId"]?.$in?.includes("<orig2@client.com>") ||
            c["turns.outgoing.rfcMessageId"]?.$in?.includes("<sent_reply_2@mailpilot.com>")
        )
      ) {
        return existingDoc;
      }
      return null;
    };

    ProcessedEmail.findOne = async () => null;
    ProcessedEmail.create = async (doc) => ({ ...doc, save: async () => doc });

    const mockGmail = {
      users: {
        messages: {
          get: async () => ({
            data: {
              id: "msg_followup_2",
              threadId: "gmail_thread_different_300",
              internalDate: String(Date.now()),
              snippet: "Different subject inquiry",
              payload: {
                headers: [
                  { name: "From", value: "Bob <bob@client.com>" },
                  { name: "Subject", value: "A new topic from Bob" },
                  { name: "Message-ID", value: "<diff_subj_msg_2@client.com>" },
                  { name: "In-Reply-To", value: "<orig2@client.com>" },
                  { name: "References", value: "<orig2@client.com>" },
                ],
                body: { data: Buffer.from("Body text").toString("base64") },
              },
            },
          }),
          modify: async () => ({}),
        },
        drafts: {
          create: async () => ({
            data: { id: "draft_new_2", message: { id: "msg_draft_new_2" } },
          }),
        },
      },
    };

    await processThreadGroup({
      user,
      threadId: "gmail_thread_different_300",
      items: [{ id: "msg_followup_2" }],
      gmail: mockGmail,
    });

    assert.equal(existingDoc.turns.length, 2);
    const addedTurn = existingDoc.turns[1];
    assert.equal(addedTurn.linkedBy, "headers");
    assert.equal(addedTurn.gmailThreadId, "gmail_thread_different_300");
    assert.equal(addedTurn.inReplyToHeader, "<orig2@client.com>");
    // Record keeps its first threadId
    assert.equal(existingDoc.threadId, "gmail_thread_200");
    assert.equal(existingDoc.checked, false);
  });

  it("3. different subject, same sender, setting on (appended with linkedBy 'sender')", async () => {
    const user = {
      _id: "user_group_3",
      email: "agent@mailpilot.com",
      profileDescription: "Support",
      labels: [
        {
          id: "label_sup",
          name: "Support",
          enabled: true,
          action: { type: "draft" },
        },
      ],
      settings: { groupBySender: true }, // Setting ON
    };

    const existingDoc = {
      _id: "doc_thread_3",
      userId: "user_group_3",
      threadId: "gmail_thread_first_400",
      updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago (within 14 days)
      to: "Carol <carol@startup.io>",
      turns: [
        {
          incomingMessageId: "msg_carol_1",
          gmailThreadId: "gmail_thread_first_400",
          rfcMessageId: "<carol1@startup.io>",
          from: "Carol <carol@startup.io>",
          incomingSubject: "First subject",
          outcome: "drafted",
          outgoing: {
            kind: "draft",
            status: "draft",
            gmailDraftId: "draft_carol_old",
          },
        },
      ],
      checked: true,
      save: async function () {
        return this;
      },
    };

    // Neither thread nor headers match
    EmailAction.findOne = async () => null;

    EmailAction.find = () => ({
      sort: () => [existingDoc],
    });

    ProcessedEmail.findOne = async () => null;
    ProcessedEmail.create = async (doc) => ({ ...doc, save: async () => doc });

    const mockGmail = {
      users: {
        messages: {
          get: async () => ({
            data: {
              id: "msg_carol_2",
              threadId: "gmail_thread_new_500", // New thread
              internalDate: String(Date.now()),
              snippet: "Totally different subject from Carol",
              payload: {
                headers: [
                  { name: "From", value: "Carol <carol@startup.io>" },
                  { name: "Subject", value: "Completely different subject" },
                  { name: "Message-ID", value: "<carol2@startup.io>" },
                ],
                body: { data: Buffer.from("Hi again").toString("base64") },
              },
            },
          }),
          modify: async () => ({}),
        },
        drafts: {
          create: async () => ({
            data: { id: "draft_carol_new", message: { id: "msg_carol_draft" } },
          }),
          delete: async () => ({}),
        },
      },
    };

    await processThreadGroup({
      user,
      threadId: "gmail_thread_new_500",
      items: [{ id: "msg_carol_2" }],
      gmail: mockGmail,
    });

    assert.equal(existingDoc.turns.length, 2);
    const addedTurn = existingDoc.turns[1];
    assert.equal(addedTurn.linkedBy, "sender");
    assert.equal(addedTurn.gmailThreadId, "gmail_thread_new_500");
    assert.equal(addedTurn.incomingSubject, "Completely different subject");
    assert.equal(existingDoc.threadId, "gmail_thread_first_400"); // keeps original
    assert.equal(existingDoc.checked, false);
  });

  it("4. same setting off (creates separate record)", async () => {
    const user = {
      _id: "user_group_4",
      email: "agent@mailpilot.com",
      profileDescription: "Support",
      labels: [
        {
          id: "label_sup",
          name: "Support",
          enabled: true,
          action: { type: "draft" },
        },
      ],
      settings: { groupBySender: false }, // Setting OFF
    };

    let createdRecord = null;
    EmailAction.findOne = async () => null;
    EmailAction.find = () => ({ sort: () => [] });
    EmailAction.create = async (doc) => {
      createdRecord = doc;
      return doc;
    };

    ProcessedEmail.findOne = async () => null;
    ProcessedEmail.create = async (doc) => ({ ...doc, save: async () => doc });

    const mockGmail = {
      users: {
        messages: {
          get: async () => ({
            data: {
              id: "msg_dave_1",
              threadId: "gmail_thread_dave_600",
              internalDate: String(Date.now()),
              snippet: "Separate thread",
              payload: {
                headers: [
                  { name: "From", value: "Dave <dave@example.com>" },
                  { name: "Subject", value: "New Topic" },
                  { name: "Message-ID", value: "<dave1@example.com>" },
                ],
                body: { data: Buffer.from("Hello").toString("base64") },
              },
            },
          }),
          modify: async () => ({}),
        },
        drafts: {
          create: async () => ({
            data: { id: "draft_dave_1", message: { id: "dave_draft_msg" } },
          }),
        },
      },
    };

    await processThreadGroup({
      user,
      threadId: "gmail_thread_dave_600",
      items: [{ id: "msg_dave_1" }],
      gmail: mockGmail,
    });

    assert.ok(createdRecord, "Must create a new EmailAction record");
    assert.equal(createdRecord.threadId, "gmail_thread_dave_600");
    assert.equal(createdRecord.turns.length, 1);
  });

  it("5. sender outside the window (creates separate record)", async () => {
    const user = {
      _id: "user_group_5",
      email: "agent@mailpilot.com",
      profileDescription: "Support",
      labels: [
        {
          id: "label_sup",
          name: "Support",
          enabled: true,
          action: { type: "draft" },
        },
      ],
      settings: { groupBySender: true }, // Setting ON
    };

    const staleDoc = {
      _id: "doc_old_5",
      userId: "user_group_5",
      threadId: "thread_old_5",
      updatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // 20 days ago (outside 14-day window)
      to: "Emma <emma@example.com>",
      turns: [{ from: "Emma <emma@example.com>", outcome: "sent" }],
    };

    let createdRecord = null;
    EmailAction.findOne = async () => null;
    // Mongoose query with updatedAt filter returns empty because 20 days ago is before windowStart
    EmailAction.find = (query) => {
      if (query.updatedAt?.$gte && staleDoc.updatedAt < query.updatedAt.$gte) {
        return { sort: () => [] };
      }
      return { sort: () => [staleDoc] };
    };
    EmailAction.create = async (doc) => {
      createdRecord = doc;
      return doc;
    };

    ProcessedEmail.findOne = async () => null;
    ProcessedEmail.create = async (doc) => ({ ...doc, save: async () => doc });

    const mockGmail = {
      users: {
        messages: {
          get: async () => ({
            data: {
              id: "msg_emma_2",
              threadId: "thread_emma_new_700",
              internalDate: String(Date.now()),
              snippet: "Emma after 20 days",
              payload: {
                headers: [
                  { name: "From", value: "Emma <emma@example.com>" },
                  { name: "Subject", value: "Old contact reappears" },
                  { name: "Message-ID", value: "<emma2@example.com>" },
                ],
                body: { data: Buffer.from("Hi long time no see").toString("base64") },
              },
            },
          }),
          modify: async () => ({}),
        },
        drafts: {
          create: async () => ({
            data: { id: "draft_emma_2", message: { id: "emma_draft_msg" } },
          }),
        },
      },
    };

    await processThreadGroup({
      user,
      threadId: "thread_emma_new_700",
      items: [{ id: "msg_emma_2" }],
      gmail: mockGmail,
    });

    assert.ok(createdRecord, "Must create a separate EmailAction record when outside the window");
    assert.equal(createdRecord.threadId, "thread_emma_new_700");
  });

  it("6. a reply to a linked turn goes out in that turn's gmailThreadId", async () => {
    const user = {
      _id: "user_group_6",
      email: "agent@mailpilot.com",
      profileDescription: "Support",
      labels: [
        {
          id: "label_sup",
          name: "Support",
          enabled: true,
          action: { type: "reply" }, // Direct reply action
        },
      ],
      settings: { groupBySender: true },
    };

    const existingDoc = {
      _id: "doc_record_6",
      userId: "user_group_6",
      threadId: "initial_gmail_thread_001", // The record's original threadId
      updatedAt: new Date(),
      to: "Frank <frank@example.com>",
      turns: [
        {
          incomingMessageId: "msg_frank_1",
          gmailThreadId: "initial_gmail_thread_001",
          from: "Frank <frank@example.com>",
          outcome: "sent",
        },
      ],
      checked: true,
      save: async function () {
        return this;
      },
    };

    EmailAction.findOne = async () => null;
    EmailAction.find = () => ({ sort: () => [existingDoc] });

    let sentThreadIdPassed = null;

    const mockGmail = {
      users: {
        messages: {
          get: async (params) => {
            if (params.id === "msg_frank_2") {
              return {
                data: {
                  id: "msg_frank_2",
                  threadId: "linked_turn_gmail_thread_999", // The linked turn's own threadId
                  internalDate: String(Date.now()),
                  snippet: "Frank follow-up",
                  payload: {
                    headers: [
                      { name: "From", value: "Frank <frank@example.com>" },
                      { name: "Subject", value: "Follow-up question" },
                      { name: "Message-ID", value: "<frank2@example.com>" },
                    ],
                    body: { data: Buffer.from("Quick question").toString("base64") },
                  },
                },
              };
            }
            if (params.id === "sent_msg_frank_999") {
              return {
                data: {
                  id: "sent_msg_frank_999",
                  payload: {
                    headers: [
                      { name: "Message-ID", value: "<sent_frank_999@mailpilot.com>" },
                    ],
                  },
                },
              };
            }
            return { data: {} };
          },
          send: async ({ requestBody }) => {
            sentThreadIdPassed = requestBody.threadId;
            return { data: { id: "sent_msg_frank_999" } };
          },
          modify: async () => ({}),
        },
      },
    };

    await processThreadGroup({
      user,
      threadId: "linked_turn_gmail_thread_999",
      items: [{ id: "msg_frank_2" }],
      gmail: mockGmail,
    });

    // Verify the threadId passed to messages.send matches the turn's gmailThreadId, NOT the record's threadId!
    assert.equal(
      sentThreadIdPassed,
      "linked_turn_gmail_thread_999",
      "Reply must go out in the linked turn's gmailThreadId, not the record's initial threadId"
    );
    assert.notEqual(
      sentThreadIdPassed,
      "initial_gmail_thread_001",
      "Must never send in the record's initial threadId if turn's gmailThreadId differs"
    );

    // Verify turn outgoing rfcMessageId was fetched and stored
    const addedTurn = existingDoc.turns[1];
    assert.equal(addedTurn.gmailThreadId, "linked_turn_gmail_thread_999");
    assert.equal(addedTurn.outgoing.rfcMessageId, "<sent_frank_999@mailpilot.com>");
  });
});
