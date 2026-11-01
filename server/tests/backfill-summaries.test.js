// tests/backfill-summaries.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  backfillSummaries,
  isSummaryMissing,
  SUMMARY_UNAVAILABLE_MESSAGE,
} from "../tools/backfill-summaries.js";

describe("backfill-summaries tool", () => {
  it("correctly identifies missing summaries", () => {
    assert.equal(isSummaryMissing(""), true);
    assert.equal(isSummaryMissing(null), true);
    assert.equal(isSummaryMissing(undefined), true);
    assert.equal(isSummaryMissing("   "), true);
    assert.equal(isSummaryMissing("No summary available"), true);
    assert.equal(isSummaryMissing("Incoming email message."), true);

    assert.equal(isSummaryMissing("Valid summary of incoming email."), false);
    assert.equal(isSummaryMissing(SUMMARY_UNAVAILABLE_MESSAGE), false);
  });

  it("backfills summary for turns missing summary using Ollama summarizer", async () => {
    let saved = false;

    const mockDoc = {
      _id: "doc1",
      userId: "user1",
      sourceMessageId: "msg1",
      summary: "",
      turns: [
        {
          incomingMessageId: "msg1",
          from: "Alice <alice@example.com>",
          incomingSubject: "Project Update",
          incomingSnippet: "Here is the update",
          incomingSummary: "",
        },
      ],
      save: async function () {
        saved = true;
      },
    };

    const mockActionModel = {
      find: () => Promise.resolve([mockDoc]),
    };

    const mockUserModel = {
      findById: async () => ({
        _id: "user1",
        email: "bob@example.com",
      }),
    };

    const mockMessageFetcher = async (user, messageId) => {
      assert.equal(messageId, "msg1");
      return {
        id: "msg1",
        snippet: "Here is the update on quarterly goals.",
        payload: {
          headers: [
            { name: "Subject", value: "Project Update" },
            { name: "From", value: "Alice <alice@example.com>" },
          ],
          body: {
            data: Buffer.from("Full body content of the email").toString("base64"),
          },
        },
      };
    };

    const mockOllamaSummarizer = async ({ from, subject, bodyText }) => {
      assert.equal(from, "Alice <alice@example.com>");
      assert.equal(subject, "Project Update");
      assert.match(bodyText, /Full body content/);
      return "Alice provided a detailed quarterly project update.";
    };

    const stats = await backfillSummaries({
      actionModel: mockActionModel,
      userModel: mockUserModel,
      messageFetcher: mockMessageFetcher,
      ollamaSummarizer: mockOllamaSummarizer,
      delayMs: 0,
    });

    assert.equal(stats.totalDocsScanned, 1);
    assert.equal(stats.summariesGenerated, 1);
    assert.equal(stats.docsUpdated, 1);
    assert.equal(saved, true);
    assert.equal(
      mockDoc.turns[0].incomingSummary,
      "Alice provided a detailed quarterly project update."
    );
    assert.equal(
      mockDoc.summary,
      "Alice provided a detailed quarterly project update."
    );
  });

  it("stores 'Summary unavailable...' when the Gmail message is gone (404)", async () => {
    let saved = false;

    const mockDoc = {
      _id: "doc2",
      userId: "user1",
      sourceMessageId: "deleted_msg",
      summary: "",
      turns: [
        {
          incomingMessageId: "deleted_msg",
          from: "Bob <bob@example.com>",
          incomingSubject: "Deleted Thread",
          incomingSummary: "",
        },
      ],
      save: async function () {
        saved = true;
      },
    };

    const mockActionModel = {
      find: () => Promise.resolve([mockDoc]),
    };

    const mockUserModel = {
      findById: async () => ({
        _id: "user1",
        email: "alice@example.com",
      }),
    };

    const mockMessageFetcher = async () => {
      const err = new Error("Requested entity was not found.");
      err.code = 404;
      throw err;
    };

    const stats = await backfillSummaries({
      actionModel: mockActionModel,
      userModel: mockUserModel,
      messageFetcher: mockMessageFetcher,
      ollamaSummarizer: async () => "Should not be called",
      delayMs: 0,
    });

    assert.equal(stats.summariesUnavailable, 1);
    assert.equal(stats.summariesGenerated, 0);
    assert.equal(saved, true);
    assert.equal(
      mockDoc.turns[0].incomingSummary,
      SUMMARY_UNAVAILABLE_MESSAGE
    );
  });

  it("is idempotent and skips turns that already have a summary", async () => {
    let saved = false;

    const mockDoc = {
      _id: "doc3",
      userId: "user1",
      sourceMessageId: "msg3",
      summary: "Existing valid summary",
      turns: [
        {
          incomingMessageId: "msg3",
          from: "Carol <carol@example.com>",
          incomingSummary: "Existing valid summary",
        },
      ],
      save: async function () {
        saved = true;
      },
    };

    const mockActionModel = {
      find: () => Promise.resolve([mockDoc]),
    };

    const mockUserModel = {
      findById: async () => ({ _id: "user1" }),
    };

    const stats = await backfillSummaries({
      actionModel: mockActionModel,
      userModel: mockUserModel,
      messageFetcher: async () => {
        throw new Error("Should not fetch for existing summary");
      },
      ollamaSummarizer: async () => {
        throw new Error("Should not summarize for existing summary");
      },
      delayMs: 0,
    });

    assert.equal(stats.turnsSkipped, 1);
    assert.equal(stats.summariesGenerated, 0);
    assert.equal(stats.docsUpdated, 0);
    assert.equal(saved, false);
  });

  it("respects dryRun=true and does not save", async () => {
    let saved = false;

    const mockDoc = {
      _id: "doc4",
      userId: "user1",
      sourceMessageId: "msg4",
      summary: "",
      turns: [
        {
          incomingMessageId: "msg4",
          from: "Dave <dave@example.com>",
          incomingSummary: "",
        },
      ],
      save: async function () {
        saved = true;
      },
    };

    const mockActionModel = {
      find: () => Promise.resolve([mockDoc]),
    };

    const mockUserModel = {
      findById: async () => ({ _id: "user1" }),
    };

    const mockMessageFetcher = async () => ({
      id: "msg4",
      snippet: "Meeting tomorrow",
      payload: { headers: [] },
    });

    const stats = await backfillSummaries({
      dryRun: true,
      actionModel: mockActionModel,
      userModel: mockUserModel,
      messageFetcher: mockMessageFetcher,
      ollamaSummarizer: async () => "Meeting summary",
      delayMs: 0,
    });

    assert.equal(stats.summariesGenerated, 1);
    assert.equal(saved, false);
  });
});
