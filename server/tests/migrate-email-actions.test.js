// tests/migrate-email-actions.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import EmailAction from "../models/EmailAction.js";
import {
  buildTurnsFromGroup,
  deriveTopLevelFields,
  migrateEmailActions
} from "../tools/migrate-email-actions.js";

/**
 * Creates an in-memory mock Mongoose model for EmailAction.
 */
function createMockModel(initialDocs = []) {
  let docs = JSON.parse(JSON.stringify(initialDocs));
  const updateCalls = [];
  const deleteCalls = [];

  const collection = {
    _indexes: [
      {
        name: "userId_1_sourceMessageId_1_type_1",
        key: { userId: 1, sourceMessageId: 1, type: 1 }
      }
    ],
    indexes: async function () {
      return this._indexes;
    },
    dropIndex: async function (name) {
      this._indexes = this._indexes.filter((i) => i.name !== name);
    },
    createIndex: async function (spec, opts) {
      this._indexes.push({
        name: Object.keys(spec).join("_"),
        key: spec,
        unique: opts?.unique
      });
    }
  };

  const model = {
    find: () => ({
      lean: async () => JSON.parse(JSON.stringify(docs))
    }),
    updateOne: async (query, update) => {
      updateCalls.push({ query, update });
      const target = docs.find((d) => String(d._id) === String(query._id));
      if (target && update.$set) {
        Object.assign(target, update.$set);
      }
    },
    deleteMany: async (query) => {
      deleteCalls.push(query);
      if (query._id && query._id.$in) {
        const idSet = new Set(query._id.$in.map(String));
        docs = docs.filter((d) => !idSet.has(String(d._id)));
      }
    },
    collection,
    getDocs: () => docs,
    getUpdateCalls: () => updateCalls,
    getDeleteCalls: () => deleteCalls
  };

  return model;
}

const silentLogger = {
  log: () => {},
  error: () => {},
  warn: () => {}
};

describe("EmailAction Model Schema - BATCH 2 part 1", () => {
  it("disables autoIndex on EmailAction schema", () => {
    assert.equal(
      EmailAction.schema.options.autoIndex,
      false,
      "autoIndex must be explicitly disabled on EmailAction schema"
    );
  });

  it("contains turns array with the required schema and no origin field", () => {
    const paths = EmailAction.schema.paths;
    assert.ok(paths.turns, "turns field must exist on schema");

    const turnPaths = EmailAction.schema.path("turns").schema.paths;
    assert.ok(turnPaths.incomingMessageId, "incomingMessageId must exist in turn");
    assert.ok(turnPaths.from, "from must exist in turn");
    assert.ok(turnPaths.receivedAt, "receivedAt must exist in turn");
    assert.ok(turnPaths.incomingSubject, "incomingSubject must exist in turn");
    assert.ok(turnPaths.incomingSummary, "incomingSummary must exist in turn");
    assert.ok(turnPaths.outcome, "outcome must exist in turn");
    assert.ok(turnPaths.outgoing, "outgoing must exist in turn");

    const outgoingPaths = EmailAction.schema
      .path("turns")
      .schema.path("outgoing").schema.paths;
    assert.ok(outgoingPaths.kind, "outgoing.kind must exist in turn");
    assert.ok(outgoingPaths.status, "outgoing.status must exist in turn");
    assert.ok(outgoingPaths.body, "outgoing.body must exist in turn");

    // Check outgoing.status enum includes sending and superseded
    const outgoingStatusEnum = outgoingPaths.status.enumValues;
    assert.ok(
      outgoingStatusEnum.includes("sending"),
      "outgoing.status must include 'sending'"
    );
    assert.ok(
      outgoingStatusEnum.includes("superseded"),
      "outgoing.status must include 'superseded'"
    );

    // Confirm NO origin field exists anywhere
    assert.equal(paths.origin, undefined, "There must be NO origin field on EmailAction");
    assert.equal(turnPaths.origin, undefined, "There must be NO origin field on turn");
    assert.equal(
      outgoingPaths.origin,
      undefined,
      "There must be NO origin field on outgoing"
    );
  });

  it("preserves legacy fields so old documents still load", () => {
    const paths = EmailAction.schema.paths;
    assert.ok(paths.sourceMessageId, "sourceMessageId must be preserved");
    assert.ok(paths.conversationHistory, "conversationHistory must be preserved");
    assert.ok(paths.type, "type must be preserved");
    assert.ok(paths.summary, "summary must be preserved");
    assert.ok(paths.body, "body must be preserved");
    assert.ok(paths.checked, "checked must be preserved");
    assert.ok(paths.to, "to must be preserved");
    assert.ok(paths.subject, "subject must be preserved");
  });
});

describe("EmailAction Migration - Merge Logic & Idempotency", () => {
  it("merges a single doc into 1 document with 1 turn", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const docId = new mongoose.Types.ObjectId().toString();

    const initialDocs = [
      {
        _id: docId,
        userId,
        threadId: "thread_1",
        sourceMessageId: "msg_1",
        type: "draft",
        status: "draft",
        label: "Pricing",
        to: "alice@example.com",
        subject: "Pricing Inquiry",
        summary: "Alice asks about pricing packages.",
        body: "Hi Alice, our pricing starts at $49/mo.",
        checked: false,
        createdAt: new Date("2026-10-30T10:00:00Z"),
        updatedAt: new Date("2026-10-30T10:00:00Z")
      }
    ];

    const mockModel = createMockModel(initialDocs);

    const result = await migrateEmailActions({
      dryRun: false,
      model: mockModel,
      logger: silentLogger
    });

    assert.equal(result.totalDocs, 1);
    assert.equal(result.threadCount, 1);
    assert.equal(result.groupsNeedingMerges, 0);
    assert.equal(result.mergedGroupsCount, 1);
    assert.equal(result.deletedDocsCount, 0);

    const updatedDocs = mockModel.getDocs();
    assert.equal(updatedDocs.length, 1);
    const updated = updatedDocs[0];

    assert.equal(updated.status, "draft");
    assert.equal(updated.type, "draft");
    assert.equal(updated.label, "Pricing");
    assert.equal(updated.turns.length, 1);

    const turn = updated.turns[0];
    assert.equal(turn.incomingMessageId, "msg_1");
    assert.equal(turn.incomingSubject, "Pricing Inquiry");
    assert.equal(turn.incomingSummary, "Alice asks about pricing packages.");
    assert.equal(turn.outcome, "drafted");
    assert.equal(turn.outgoing.kind, "draft");
    assert.equal(turn.outgoing.status, "draft");
    assert.equal(turn.outgoing.body, "Hi Alice, our pricing starts at $49/mo.");
  });

  it("merges draft+reply on the same thread into one document with two turns ordered by createdAt", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const doc1Id = new mongoose.Types.ObjectId().toString();
    const doc2Id = new mongoose.Types.ObjectId().toString();

    const initialDocs = [
      {
        _id: doc1Id,
        userId,
        threadId: "thread_multi_1",
        sourceMessageId: "msg_in_1",
        type: "draft",
        status: "draft",
        label: "Support",
        to: "bob@example.com",
        subject: "Help needed",
        summary: "Initial issue reported by Bob.",
        body: "Draft reply offering initial steps.",
        checked: false,
        createdAt: new Date("2026-10-30T09:00:00Z"),
        updatedAt: new Date("2026-10-30T09:05:00Z")
      },
      {
        _id: doc2Id,
        userId,
        threadId: "thread_multi_1",
        sourceMessageId: "msg_in_2",
        type: "reply",
        status: "sent",
        label: "Support",
        to: "bob@example.com",
        subject: "Re: Help needed",
        summary: "Bob confirmed steps and asked for follow up.",
        body: "Sent reply with final resolution.",
        checked: true,
        conversationHistory: [
          {
            role: "incoming",
            type: "summary",
            content: "Initial issue reported by Bob.",
            messageId: "msg_in_1",
            timestamp: new Date("2026-10-30T09:00:00Z")
          },
          {
            role: "incoming",
            type: "summary",
            content: "Bob confirmed steps and asked for follow up.",
            messageId: "msg_in_2",
            timestamp: new Date("2026-10-30T11:00:00Z")
          },
          {
            role: "outgoing",
            type: "reply",
            content: "Sent reply with final resolution.",
            timestamp: new Date("2026-10-30T11:05:00Z")
          }
        ],
        createdAt: new Date("2026-10-30T11:00:00Z"),
        updatedAt: new Date("2026-10-30T11:06:00Z")
      }
    ];

    const mockModel = createMockModel(initialDocs);

    const result = await migrateEmailActions({
      dryRun: false,
      model: mockModel,
      logger: silentLogger
    });

    assert.equal(result.totalDocs, 2);
    assert.equal(result.threadCount, 1);
    assert.equal(result.groupsNeedingMerges, 1);
    assert.equal(result.mergedGroupsCount, 1);
    assert.equal(result.deletedDocsCount, 1);

    // Only 1 doc should remain (target doc)
    const remainingDocs = mockModel.getDocs();
    assert.equal(remainingDocs.length, 1);

    const merged = remainingDocs[0];
    assert.equal(String(merged._id), doc1Id, "Earlier doc should be the target doc retained");
    assert.equal(merged.status, "sent", "Status should derive from latest turn");
    assert.equal(merged.type, "reply", "Type should derive from latest turn");
    assert.equal(merged.checked, true, "Checked should be true if any doc was checked");
    assert.equal(merged.turns.length, 2, "Merged document must have 2 turns ordered by createdAt");

    // Turn 1 (draft)
    const turn1 = merged.turns[0];
    assert.equal(turn1.incomingMessageId, "msg_in_1");
    assert.equal(turn1.incomingSummary, "Initial issue reported by Bob.");
    assert.equal(turn1.outgoing.kind, "draft");
    assert.equal(turn1.outgoing.status, "draft");
    assert.equal(turn1.outgoing.body, "Draft reply offering initial steps.");

    // Turn 2 (sent reply)
    const turn2 = merged.turns[1];
    assert.equal(turn2.incomingMessageId, "msg_in_2");
    assert.equal(turn2.incomingSummary, "Bob confirmed steps and asked for follow up.");
    assert.equal(turn2.outgoing.kind, "reply");
    assert.equal(turn2.outgoing.status, "sent");
    assert.equal(turn2.outgoing.body, "Sent reply with final resolution.");
    assert.equal(turn2.outcome, "sent");
  });

  it("is idempotent on a second run without duplicating or re-processing", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const doc1Id = new mongoose.Types.ObjectId().toString();
    const doc2Id = new mongoose.Types.ObjectId().toString();

    const initialDocs = [
      {
        _id: doc1Id,
        userId,
        threadId: "thread_idem_1",
        sourceMessageId: "msg_1",
        type: "draft",
        status: "draft",
        subject: "Thread test",
        summary: "Summary 1",
        body: "Body 1",
        createdAt: new Date("2026-10-30T10:00:00Z")
      },
      {
        _id: doc2Id,
        userId,
        threadId: "thread_idem_1",
        sourceMessageId: "msg_2",
        type: "reply",
        status: "sent",
        subject: "Re: Thread test",
        summary: "Summary 2",
        body: "Body 2",
        createdAt: new Date("2026-10-30T12:00:00Z")
      }
    ];

    const mockModel = createMockModel(initialDocs);

    // 1st run
    const result1 = await migrateEmailActions({
      dryRun: false,
      model: mockModel,
      logger: silentLogger
    });

    assert.equal(result1.mergedGroupsCount, 1);
    assert.equal(result1.alreadyMigratedGroups, 0);

    const docsAfterFirstRun = JSON.parse(JSON.stringify(mockModel.getDocs()));
    assert.equal(docsAfterFirstRun.length, 1);
    assert.equal(docsAfterFirstRun[0].turns.length, 2);

    const updateCallsCountAfterFirstRun = mockModel.getUpdateCalls().length;
    const deleteCallsCountAfterFirstRun = mockModel.getDeleteCalls().length;

    // 2nd run
    const result2 = await migrateEmailActions({
      dryRun: false,
      model: mockModel,
      logger: silentLogger
    });

    assert.equal(result2.totalDocs, 1);
    assert.equal(result2.threadCount, 1);
    assert.equal(result2.alreadyMigratedGroups, 1, "Should recognise group as already migrated");
    assert.equal(result2.mergedGroupsCount, 0, "No new groups should be merged");

    // Verify zero additional updates or deletes occurred
    assert.equal(mockModel.getUpdateCalls().length, updateCallsCountAfterFirstRun);
    assert.equal(mockModel.getDeleteCalls().length, deleteCallsCountAfterFirstRun);

    // Data must remain identical
    const docsAfterSecondRun = JSON.parse(JSON.stringify(mockModel.getDocs()));
    assert.deepEqual(docsAfterSecondRun, docsAfterFirstRun);
  });

  it("--dry-run calculates stats and plans index changes without writing anything", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const doc1Id = new mongoose.Types.ObjectId().toString();
    const doc2Id = new mongoose.Types.ObjectId().toString();

    const initialDocs = [
      {
        _id: doc1Id,
        userId,
        threadId: "thread_dry_1",
        sourceMessageId: "m1",
        type: "draft",
        status: "draft",
        createdAt: new Date("2026-10-30T10:00:00Z")
      },
      {
        _id: doc2Id,
        userId,
        threadId: "thread_dry_1",
        sourceMessageId: "m2",
        type: "reply",
        status: "sent",
        createdAt: new Date("2026-10-30T11:00:00Z")
      }
    ];

    const mockModel = createMockModel(initialDocs);

    const loggedLines = [];
    const testLogger = {
      log: (msg) => loggedLines.push(String(msg)),
      error: (msg) => loggedLines.push(String(msg))
    };

    const result = await migrateEmailActions({
      dryRun: true,
      model: mockModel,
      logger: testLogger
    });

    assert.equal(result.totalDocs, 2);
    assert.equal(result.threadCount, 1);
    assert.equal(result.groupsNeedingMerges, 1);

    // Verify NO writes were made
    assert.equal(mockModel.getUpdateCalls().length, 0, "Dry run must make no updates");
    assert.equal(mockModel.getDeleteCalls().length, 0, "Dry run must make no deletes");
    assert.equal(mockModel.getDocs().length, 2, "Dry run must leave all docs intact");

    // Indexes should NOT have changed
    const indexes = await mockModel.collection.indexes();
    assert.equal(indexes.length, 1);
    assert.equal(indexes[0].name, "userId_1_sourceMessageId_1_type_1");

    // Logs must mention planned index changes
    const fullLog = loggedLines.join("\n");
    assert.ok(fullLog.includes("Planned index changes (dry-run, not executed)"));
    assert.ok(fullLog.includes("Drop old unique index: { userId: 1, sourceMessageId: 1, type: 1 }"));
    assert.ok(fullLog.includes("Create new unique index: { userId: 1, threadId: 1 } (unique)"));
  });

  it("drops old unique index and creates new unique {userId, threadId} index in live migration", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const docId = new mongoose.Types.ObjectId().toString();

    const initialDocs = [
      {
        _id: docId,
        userId,
        threadId: "thread_idx_1",
        sourceMessageId: "msg_1",
        type: "draft",
        status: "draft",
        createdAt: new Date("2026-10-30T10:00:00Z")
      }
    ];

    const mockModel = createMockModel(initialDocs);

    await migrateEmailActions({
      dryRun: false,
      model: mockModel,
      logger: silentLogger
    });

    const indexes = await mockModel.collection.indexes();
    const hasOldIndex = indexes.some((i) => i.name === "userId_1_sourceMessageId_1_type_1");
    assert.equal(hasOldIndex, false, "Old index must be dropped");

    const newIndex = indexes.find((i) => i.key && i.key.userId === 1 && i.key.threadId === 1);
    assert.ok(newIndex, "New unique index on { userId: 1, threadId: 1 } must be created");
    assert.equal(newIndex.unique, true, "New index must be unique");
  });
});
