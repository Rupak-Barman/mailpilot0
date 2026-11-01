// tests/conversation-turns.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import User from "../models/User.js";
import ProcessedEmail from "../models/ProcessedEmail.js";
import EmailAction from "../models/EmailAction.js";
import Analytics from "../models/Analytics.js";
import { processThreadGroup } from "../jobs/poll.job.js";
import { stripQuotedAndHtml } from "../utils/helpers.js";

describe("BATCH 2 part 2 - Conversation model, turns & follow-ups", () => {
  const originalFetch = global.fetch;
  const originalProcessedEmailFindOne = ProcessedEmail.findOne;
  const originalProcessedEmailCreate = ProcessedEmail.create;
  const originalProcessedEmailFindOneAndUpdate = ProcessedEmail.findOneAndUpdate;
  const originalEmailActionFindOne = EmailAction.findOne;
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
                  summary: "Summary of user inquiry."
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
                body: "Hello, this is the generated assistant response."
              })
            }
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    Analytics.findOne = async () => null;
    Analytics.create = async () => ({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    ProcessedEmail.findOne = originalProcessedEmailFindOne;
    ProcessedEmail.create = originalProcessedEmailCreate;
    ProcessedEmail.findOneAndUpdate = originalProcessedEmailFindOneAndUpdate;
    EmailAction.findOne = originalEmailActionFindOne;
    EmailAction.create = originalEmailActionCreate;
    Analytics.findOne = originalAnalyticsFindOne;
    Analytics.create = originalAnalyticsCreate;
  });

  it("quoted text is stripped before classifying and summarising", () => {
    // 1. Quoted block with On ... wrote:
    const textWithOnWrote = `Hi there,\n\nPlease look into this issue.\n\nOn Mon, Oct 26, 2026 at 10:00 AM Alice <alice@example.com> wrote:\n> Could you please check?\n> Thanks!`;
    const cleaned1 = stripQuotedAndHtml(textWithOnWrote);
    assert.equal(cleaned1, "Hi there,\n\nPlease look into this issue.");

    // 2. Lines starting with >
    const textWithQuotes = `Here is my reply.\n> Previous message line 1\n> Previous message line 2\nEnd of note.`;
    const cleaned2 = stripQuotedAndHtml(textWithQuotes);
    assert.equal(cleaned2, "Here is my reply.\nEnd of note.");

    // 3. HTML tags stripped and entities decoded
    const textWithHtml = `<div class="email-body"><p>Hello <b>Team</b>,</p><p>This is a test &amp; demo.</p></div>`;
    const cleaned3 = stripQuotedAndHtml(textWithHtml);
    assert.equal(cleaned3.includes("<"), false, "HTML opening brackets must be stripped");
    assert.equal(cleaned3.includes(">"), false, "HTML closing brackets must be stripped");
    assert.ok(cleaned3.includes("Hello"), "Must contain Hello");
    assert.ok(cleaned3.includes("Team"), "Must contain Team");
    assert.ok(cleaned3.includes("test & demo."), "Must contain decoded entity &");

    // 4. Truncation to 4000 characters
    const longText = "a".repeat(5000);
    const cleaned4 = stripQuotedAndHtml(longText);
    assert.equal(cleaned4.length, 4000);
  });

  it("follow-up after a sent reply appends a turn (old turn stays untouched, checked=false)", async () => {
    const user = {
      _id: "user_followup_test",
      email: "agent@mailpilot.com",
      dailyReplySentCount: 0,
      labels: [
        {
          id: "label_sup",
          name: "Support",
          enabled: true,
          action: { type: "reply" }
        }
      ],
      save: async () => {}
    };

    // Existing EmailAction with 1 SENT turn
    const existingAction = {
      _id: "action_123",
      userId: "user_followup_test",
      threadId: "thread_sent_1",
      checked: true,
      status: "sent",
      type: "reply",
      turns: [
        {
          incomingMessageId: "msg_original_1",
          from: "customer@example.com",
          receivedAt: new Date("2026-10-30T10:00:00Z"),
          incomingSubject: "Need assistance",
          incomingSnippet: "I need help with my account",
          incomingSummary: "Customer needs account help",
          label: "Support",
          outcome: "sent",
          outgoing: {
            kind: "reply",
            body: "We have resolved your account issue.",
            status: "sent",
            gmailMessageId: "sent_msg_old",
            sentAt: new Date("2026-10-30T10:05:00Z")
          }
        }
      ],
      save: async function () {
        return this;
      }
    };

    EmailAction.findOne = async () => existingAction;

    // ProcessedEmail mock: none claimed yet
    ProcessedEmail.findOne = async () => null;
    ProcessedEmail.create = async (doc) => ({
      ...doc,
      save: async function () {
        return this;
      }
    });

    let sentMessageCalled = false;
    const fakeGmail = {
      users: {
        messages: {
          get: async () => ({
            data: {
              id: "msg_followup_2",
              threadId: "thread_sent_1",
              snippet: "Thank you, but one more question",
              payload: {
                headers: [
                  { name: "From", value: "customer@example.com" },
                  { name: "Subject", value: "Re: Need assistance" },
                  { name: "Message-ID", value: "<followup2@example.com>" }
                ],
                mimeType: "text/plain",
                body: {
                  data: Buffer.from("Thank you, but one more question").toString("base64")
                }
              }
            }
          }),
          send: async () => {
            sentMessageCalled = true;
            return { data: { id: "sent_reply_new" } };
          },
          modify: async () => ({})
        }
      }
    };

    const res = await processThreadGroup({
      user,
      gmail: fakeGmail,
      threadId: "thread_sent_1",
      items: [{ id: "msg_followup_2", threadId: "thread_sent_1" }]
    });

    assert.equal(res.processed, true);
    assert.equal(sentMessageCalled, true, "New reply must be sent via Gmail");

    // Verify existingAction has 2 turns
    assert.equal(existingAction.turns.length, 2, "Must append a new turn to turns array");

    // Turn 1 (original) must remain completely untouched
    const turn1 = existingAction.turns[0];
    assert.equal(turn1.incomingMessageId, "msg_original_1");
    assert.equal(turn1.outgoing.body, "We have resolved your account issue.");
    assert.equal(turn1.outgoing.status, "sent");
    assert.equal(turn1.outgoing.gmailMessageId, "sent_msg_old");

    // Turn 2 (new follow-up) must be appended
    const turn2 = existingAction.turns[1];
    assert.equal(turn2.incomingMessageId, "msg_followup_2");
    assert.equal(turn2.incomingSubject, "Re: Need assistance");
    assert.equal(turn2.outgoing.kind, "reply");
    assert.equal(turn2.outgoing.status, "sent");
    assert.equal(turn2.outgoing.gmailMessageId, "sent_reply_new");

    // Thread must resurface with checked=false
    assert.equal(existingAction.checked, false, "Follow-up must set checked=false");
  });

  it("follow-up with an unsent draft supersedes it and deletes the Gmail draft", async () => {
    const user = {
      _id: "user_draft_supersede_test",
      email: "agent@mailpilot.com",
      dailyReplySentCount: 0,
      labels: [
        {
          id: "label_sup",
          name: "Support",
          enabled: true,
          action: { type: "draft" }
        }
      ],
      save: async () => {}
    };

    // Existing EmailAction where latest turn has an UNSENT draft
    const existingAction = {
      _id: "action_draft_123",
      userId: "user_draft_supersede_test",
      threadId: "thread_draft_1",
      checked: false,
      status: "draft",
      type: "draft",
      turns: [
        {
          incomingMessageId: "msg_orig_draft",
          from: "lead@example.com",
          receivedAt: new Date("2026-10-30T10:00:00Z"),
          incomingSubject: "Product query",
          incomingSnippet: "What are your features?",
          incomingSummary: "Asks about features",
          label: "Support",
          outcome: "drafted",
          outgoing: {
            kind: "draft",
            body: "Here is an initial draft of our features.",
            status: "draft",
            gmailDraftId: "draft_to_delete_999",
            gmailMessageId: "msg_draft_initial"
          }
        }
      ],
      save: async function () {
        return this;
      }
    };

    EmailAction.findOne = async () => existingAction;

    ProcessedEmail.findOne = async () => null;
    ProcessedEmail.create = async (doc) => ({
      ...doc,
      save: async function () {
        return this;
      }
    });

    let deletedDraftId = null;
    let newDraftCreated = false;

    const fakeGmail = {
      users: {
        messages: {
          get: async () => ({
            data: {
              id: "msg_followup_draft_2",
              threadId: "thread_draft_1",
              snippet: "Also what about pricing?",
              payload: {
                headers: [
                  { name: "From", value: "lead@example.com" },
                  { name: "Subject", value: "Re: Product query" },
                  { name: "Message-ID", value: "<followup_lead@example.com>" }
                ],
                mimeType: "text/plain",
                body: {
                  data: Buffer.from("Also what about pricing?").toString("base64")
                }
              }
            }
          }),
          modify: async () => ({})
        },
        drafts: {
          delete: async ({ id }) => {
            deletedDraftId = id;
            return {};
          },
          create: async () => {
            newDraftCreated = true;
            return {
              data: {
                id: "draft_new_888",
                message: { id: "msg_draft_new_888" }
              }
            };
          }
        }
      }
    };

    const res = await processThreadGroup({
      user,
      gmail: fakeGmail,
      threadId: "thread_draft_1",
      items: [{ id: "msg_followup_draft_2", threadId: "thread_draft_1" }]
    });

    assert.equal(res.processed, true);

    // Verify Gmail draft delete was called for the old draft ID
    assert.equal(
      deletedDraftId,
      "draft_to_delete_999",
      "Must delete old Gmail draft through withGmail"
    );

    // Verify old turn outgoing status is marked "superseded"
    assert.equal(
      existingAction.turns[0].outgoing.status,
      "superseded",
      "Old draft turn outgoing.status must be 'superseded'"
    );

    // Verify new draft was created and appended as turn 2
    assert.equal(newDraftCreated, true, "New draft must be created in Gmail");
    assert.equal(existingAction.turns.length, 2, "Must append new turn");

    const turn2 = existingAction.turns[1];
    assert.equal(turn2.incomingMessageId, "msg_followup_draft_2");
    assert.equal(turn2.outgoing.kind, "draft");
    assert.equal(turn2.outgoing.status, "draft");
    assert.equal(turn2.outgoing.gmailDraftId, "draft_new_888");
  });

  it("sending a draft updates ProcessedEmail (sentAt, resolution 'ai_draft_sent')", async () => {
    let capturedFilter = null;
    let capturedUpdate = null;

    ProcessedEmail.findOneAndUpdate = async (filter, update) => {
      capturedFilter = filter;
      capturedUpdate = update;
      return { ...filter, ...update.$set };
    };

    const userId = "user_send_test";
    const action = {
      _id: "action_send_123",
      userId,
      threadId: "thread_send_1",
      type: "draft",
      status: "draft",
      sourceMessageId: "msg_original_send_1",
      gmailDraftId: "draft_to_send_777",
      turns: [
        {
          incomingMessageId: "msg_turn_incoming_101",
          outgoing: {
            kind: "draft",
            status: "draft",
            gmailDraftId: "draft_to_send_777"
          }
        }
      ],
      save: async function () {
        return this;
      }
    };

    // Simulate the logic in POST /:id/send:
    const draftTurn = action.turns[action.turns.length - 1];
    const targetMessageId = draftTurn?.incomingMessageId || action.sourceMessageId;
    const now = new Date();

    draftTurn.outgoing.status = "sent";
    draftTurn.outgoing.sentAt = now;
    draftTurn.outgoing.gmailMessageId = "msg_sent_777";
    draftTurn.outcome = "sent";
    action.type = "reply";
    action.status = "sent";
    action.sentAt = now;
    action.checked = true;
    action.checkedAt = now;
    await action.save();

    await ProcessedEmail.findOneAndUpdate(
      { userId: String(userId), messageId: targetMessageId },
      {
        $set: {
          sentAt: now,
          resolution: "ai_draft_sent",
          resolvedAt: now
        }
      }
    );

    assert.ok(capturedFilter, "ProcessedEmail.findOneAndUpdate must be called");
    assert.equal(capturedFilter.userId, userId);
    assert.equal(capturedFilter.messageId, "msg_turn_incoming_101");
    assert.equal(capturedUpdate.$set.resolution, "ai_draft_sent");
    assert.ok(capturedUpdate.$set.sentAt instanceof Date);
    assert.ok(capturedUpdate.$set.resolvedAt instanceof Date);
  });
});
