import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { google } from "googleapis";
import {
  draftEditorReducer,
  initialEditorState,
  computeDirty,
  areRecipientsEqual,
} from "../../frontend/src/features/emailActions/draftEditorReducer.js";
import {
  syncDraftToGmail,
  handleUpdateDraft,
  handleRetryGmailSync,
} from "../routes/emailAction.routes.js";
import EmailAction from "../models/EmailAction.js";
import User from "../models/User.js";

const mockRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
};

describe("BATCH 5.8: Draft Editor State & Save-First Sync-Second Tests", () => {
  describe("1. useDraftEditor Pure Reducer & Single Source of Truth", () => {
    it("initializes clean state from draft configuration with dirty: false", () => {
      const initial = {
        to: [{ name: "Alice", email: "alice@example.com" }],
        cc: [{ name: "Bob", email: "bob@example.com" }],
        bcc: [],
        subject: "Project Update",
        body: "Hello Alice,\n\nHere is the update.\n\nBest,\nUser",
        baseVersionId: "v1_init",
        syncStatus: { state: "synced" },
      };

      const state = draftEditorReducer(initialEditorState, {
        type: "INIT",
        payload: initial,
      });

      assert.equal(state.dirty, false);
      assert.equal(state.pendingPreview, null);
      assert.equal(state.source, "manual_edit");
      assert.equal(state.baseVersionId, "v1_init");
      assert.equal(state.body, initial.body);
      assert.equal(state.subject, "Project Update");
      assert.deepEqual(state.to, initial.to);
      assert.deepEqual(state.cc, initial.cc);
      assert.equal(state.syncStatus?.state, "synced");
    });

    it("typing in body or subject marks dirty: true; typing back marks dirty: false", () => {
      let state = draftEditorReducer(initialEditorState, {
        type: "INIT",
        payload: {
          to: [{ name: "Alice", email: "alice@example.com" }],
          subject: "Test Subject",
          body: "Original body text",
        },
      });

      assert.equal(state.dirty, false);

      // User types in body
      state = draftEditorReducer(state, {
        type: "UPDATE_FIELD",
        payload: { field: "body", value: "Updated body text by user" },
      });
      assert.equal(state.dirty, true);
      assert.equal(state.body, "Updated body text by user");

      // User types back to original body
      state = draftEditorReducer(state, {
        type: "UPDATE_FIELD",
        payload: { field: "body", value: "Original body text" },
      });
      assert.equal(state.dirty, false);

      // User changes subject
      state = draftEditorReducer(state, {
        type: "UPDATE_FIELD",
        payload: { field: "subject", value: "New Subject" },
      });
      assert.equal(state.dirty, true);
    });

    it("recipient equality handles reordering and case-insensitivity without false dirty flags", () => {
      const r1 = [{ name: "Alice", email: "Alice@example.com" }];
      const r2 = [{ name: "Alice", email: "alice@example.com" }];
      assert.ok(areRecipientsEqual(r1, r2));

      const r3 = [{ name: "Bob", email: "bob@example.com" }];
      assert.ok(!areRecipientsEqual(r1, r3));
    });

    it("AI revision preview sets body, pendingPreview, source 'ai_revision' and marks dirty: true", () => {
      let state = draftEditorReducer(initialEditorState, {
        type: "INIT",
        payload: {
          to: [{ name: "Alice", email: "alice@example.com" }],
          subject: "Draft",
          body: "Original draft",
        },
      });

      const previewPayload = {
        body: "AI revised paragraph 1\n\nAI revised paragraph 2",
        instruction: "make it friendlier",
        usedKnowledge: true,
        sources: [{ docTitle: "Policy.pdf" }],
        versionId: "v_ai_prev_1",
        previousBody: "Original draft",
        mode: "revise",
      };

      state = draftEditorReducer(state, {
        type: "SET_AI_PREVIEW",
        payload: previewPayload,
      });

      assert.equal(state.dirty, true);
      assert.equal(state.source, "ai_revision");
      assert.equal(state.body, previewPayload.body);
      assert.ok(state.pendingPreview);
      assert.equal(state.pendingPreview.instruction, "make it friendlier");

      // 'Use this' (ACCEPT_PREVIEW) only clears pending preview banner; does not change dirty or source
      state = draftEditorReducer(state, { type: "ACCEPT_PREVIEW" });
      assert.equal(state.pendingPreview, null);
      assert.equal(state.source, "ai_revision");
      assert.equal(state.dirty, true);
      assert.equal(state.body, previewPayload.body);
    });

    it("discarding AI preview reverts to previous text and recalculates dirty", () => {
      let state = draftEditorReducer(initialEditorState, {
        type: "INIT",
        payload: {
          to: [{ name: "Alice", email: "alice@example.com" }],
          subject: "Draft",
          body: "Original draft text",
        },
      });

      state = draftEditorReducer(state, {
        type: "SET_AI_PREVIEW",
        payload: {
          body: "AI generated suggestion",
          previousBody: "Original draft text",
          instruction: "shorten",
        },
      });
      assert.equal(state.dirty, true);

      state = draftEditorReducer(state, { type: "DISCARD_PREVIEW" });
      assert.equal(state.pendingPreview, null);
      assert.equal(state.body, "Original draft text");
      assert.equal(state.dirty, false);
    });

    it("restoring a version sets source 'restore' and marks dirty: true if different from initial", () => {
      let state = draftEditorReducer(initialEditorState, {
        type: "INIT",
        payload: {
          to: [{ name: "Alice", email: "alice@example.com" }],
          subject: "Draft",
          body: "Current draft",
        },
      });

      state = draftEditorReducer(state, {
        type: "RESTORE_VERSION",
        payload: { body: "Version 1 older draft", versionId: "v1" },
      });

      assert.equal(state.dirty, true);
      assert.equal(state.source, "restore");
      assert.equal(state.body, "Version 1 older draft");
    });

    it("undo discards active preview or restores previous version", () => {
      let state = draftEditorReducer(initialEditorState, {
        type: "INIT",
        payload: {
          to: [{ name: "Alice", email: "alice@example.com" }],
          subject: "Draft",
          body: "Original body",
        },
      });

      // Preview active: undo reverts preview
      state = draftEditorReducer(state, {
        type: "SET_AI_PREVIEW",
        payload: { body: "AI preview body", previousBody: "Original body" },
      });
      state = draftEditorReducer(state, { type: "UNDO" });
      assert.equal(state.body, "Original body");
      assert.equal(state.pendingPreview, null);

      // No preview active: undo to target previous version
      state = draftEditorReducer(state, {
        type: "UNDO",
        payload: { version: { body: "Older body v0" } },
      });
      assert.equal(state.body, "Older body v0");
      assert.equal(state.source, "restore");
    });

    it("discard changes reverts all fields to initialDraft values", () => {
      let state = draftEditorReducer(initialEditorState, {
        type: "INIT",
        payload: {
          to: [{ name: "Alice", email: "alice@example.com" }],
          subject: "Initial Subject",
          body: "Initial body",
        },
      });

      state = draftEditorReducer(state, {
        type: "UPDATE_FIELD",
        payload: { field: "body", value: "Dirty modified body" },
      });
      state = draftEditorReducer(state, {
        type: "UPDATE_FIELD",
        payload: { field: "subject", value: "Dirty modified subject" },
      });
      assert.equal(state.dirty, true);

      state = draftEditorReducer(state, { type: "DISCARD_CHANGES" });
      assert.equal(state.dirty, false);
      assert.equal(state.body, "Initial body");
      assert.equal(state.subject, "Initial Subject");
    });

    it("handles optimistic concurrency conflict state (SET_CONFLICT & CLEAR_CONFLICT)", () => {
      let state = draftEditorReducer(initialEditorState, {
        type: "INIT",
        payload: { body: "My draft", baseVersionId: "v1" },
      });

      state = draftEditorReducer(state, {
        type: "SET_CONFLICT",
        payload: {
          message: "Conflict detected",
          currentVersionId: "v2",
        },
      });
      assert.ok(state.conflict);
      assert.equal(state.conflict.currentVersionId, "v2");

      state = draftEditorReducer(state, { type: "CLEAR_CONFLICT" });
      assert.equal(state.conflict, null);
    });
  });

  describe("2. Server Save-First, Sync-Second (PATCH /email-actions/:id)", () => {
    it("saves preview text and generation metadata without clicking 'Use this' first", async () => {
      const mockAction = {
        _id: "action_auto_accept",
        userId: "user_test_1",
        subject: "Original Subject",
        body: "Old body",
        turns: [
          {
            turnId: "turn_1",
            outcome: "drafted",
            versionId: "v1",
            outgoing: {
              kind: "draft",
              body: "Old body",
              status: "draft",
              gmailDraftId: "draft_123",
              versions: [{ versionId: "v1", body: "Old body", source: "ai_initial" }],
            },
          },
        ],
        save: async function () {
          return this;
        },
      };

      const originalFindOne = EmailAction.findOne;
      const originalUserFindById = User.findById;
      const originalGmail = google.gmail;

      let gmailUpdated = false;
      google.gmail = () => ({
        users: {
          drafts: {
            update: async () => {
              gmailUpdated = true;
              return { data: { id: "draft_123" } };
            },
          },
        },
      });

      EmailAction.findOne = () => Promise.resolve(mockAction);
      User.findById = () => Promise.resolve({
        _id: "user_test_1",
        email: "test@example.com",
        refreshToken: "mock_refresh_token",
        settings: {},
      });

      const req = {
        params: { id: "action_auto_accept" },
        user: { id: "user_test_1" },
        body: {
          to: [{ name: "Recipient", email: "recipient@example.com" }],
          cc: [],
          bcc: [],
          subject: "Updated Subject",
          body: "AI revision text auto accepted",
          baseVersionId: "v1",
          generation: {
            mode: "user_assisted",
            instruction: "make it friendlier",
            useKnowledge: true,
          },
          version: {
            versionId: "v2_ai_rev",
            body: "AI revision text auto accepted",
            source: "ai_revision",
            instruction: "make it friendlier",
            useKnowledge: true,
          },
        },
      };

      const res = mockRes();
      await handleUpdateDraft(req, res);

      EmailAction.findOne = originalFindOne;
      User.findById = originalUserFindById;
      google.gmail = originalGmail;

      assert.equal(res.statusCode, 200);
      assert.ok(gmailUpdated);
      assert.equal(mockAction.turns[0].outgoing.body, "AI revision text auto accepted");
      assert.equal(mockAction.turns[0].outgoing.generation?.instruction, "make it friendlier");
      const latestVersion = mockAction.turns[0].outgoing.versions.slice(-1)[0];
      assert.equal(latestVersion.source, "ai_revision");
      assert.equal(latestVersion.instruction, "make it friendlier");
    });

    it("saves restored version with source 'restore'", async () => {
      const mockAction = {
        _id: "action_restore_test",
        userId: "user_test_1",
        subject: "Subject",
        body: "Current modified text",
        turns: [
          {
            turnId: "turn_1",
            outcome: "drafted",
            versionId: "v2",
            outgoing: {
              kind: "draft",
              body: "Current modified text",
              status: "draft",
              gmailDraftId: "draft_123",
              versions: [
                { versionId: "v1", body: "Initial text", source: "ai_initial" },
                { versionId: "v2", body: "Current modified text", source: "manual_edit" },
              ],
            },
          },
        ],
        save: async function () {
          return this;
        },
      };

      const originalFindOne = EmailAction.findOne;
      const originalUserFindById = User.findById;
      const originalGmail = google.gmail;

      google.gmail = () => ({
        users: {
          drafts: {
            update: async () => ({ data: { id: "draft_123" } }),
          },
        },
      });

      EmailAction.findOne = () => Promise.resolve(mockAction);
      User.findById = () => Promise.resolve({
        _id: "user_test_1",
        email: "test@example.com",
        refreshToken: "mock_refresh_token",
      });

      const req = {
        params: { id: "action_restore_test" },
        user: { id: "user_test_1" },
        body: {
          to: [{ name: "Recipient", email: "recipient@example.com" }],
          subject: "Subject",
          body: "Initial text", // Restored from v1
          baseVersionId: "v2",
          version: {
            body: "Initial text",
            source: "restore",
          },
        },
      };

      const res = mockRes();
      await handleUpdateDraft(req, res);

      EmailAction.findOne = originalFindOne;
      User.findById = originalUserFindById;
      google.gmail = originalGmail;

      assert.equal(res.statusCode, 200);
      assert.equal(mockAction.turns[0].outgoing.body, "Initial text");
      const latestVersion = mockAction.turns[0].outgoing.versions.slice(-1)[0];
      assert.equal(latestVersion.source, "restore");
    });

    it("detects optimistic concurrency conflict and returns 409", async () => {
      const mockAction = {
        _id: "action_conflict_test",
        userId: "user_test_1",
        subject: "Subject",
        turns: [
          {
            turnId: "turn_1",
            versionId: "v_server_3",
            outgoing: {
              kind: "draft",
              status: "draft",
              versions: [
                { versionId: "v_server_1" },
                { versionId: "v_server_2" },
                { versionId: "v_server_3" },
              ],
            },
          },
        ],
        save: async function () {
          return this;
        },
      };

      const originalFindOne = EmailAction.findOne;
      EmailAction.findOne = () => Promise.resolve(mockAction);

      const req = {
        params: { id: "action_conflict_test" },
        user: { id: "user_test_1" },
        body: {
          to: [{ name: "Recipient", email: "recipient@example.com" }],
          subject: "Subject",
          body: "My stale edit",
          baseVersionId: "v_server_1", // User started from v1, but server is at v3!
        },
      };

      const res = mockRes();
      await handleUpdateDraft(req, res);
      EmailAction.findOne = originalFindOne;

      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, "conflict");
      assert.equal(res.body.currentVersionId, "v_server_3");
    });

    it("forces overwrite when forceOverwrite: true is provided with mismatched baseVersionId", async () => {
      const mockAction = {
        _id: "action_overwrite_test",
        userId: "user_test_1",
        subject: "Subject",
        turns: [
          {
            turnId: "turn_1",
            versionId: "v_server_3",
            outgoing: {
              kind: "draft",
              status: "draft",
              body: "Server body",
              gmailDraftId: "draft_123",
              versions: [{ versionId: "v_server_3", body: "Server body" }],
            },
          },
        ],
        save: async function () {
          return this;
        },
      };

      const originalFindOne = EmailAction.findOne;
      const originalUserFindById = User.findById;
      const originalGmail = google.gmail;

      google.gmail = () => ({
        users: {
          drafts: {
            update: async () => ({ data: { id: "draft_123" } }),
          },
        },
      });

      EmailAction.findOne = () => Promise.resolve(mockAction);
      User.findById = () => Promise.resolve({
        _id: "user_test_1",
        email: "test@example.com",
        refreshToken: "mock_refresh_token",
      });

      const req = {
        params: { id: "action_overwrite_test" },
        user: { id: "user_test_1" },
        body: {
          to: [{ name: "Recipient", email: "recipient@example.com" }],
          subject: "Subject",
          body: "Forced user body",
          baseVersionId: "v_server_1", // Mismatch
          forceOverwrite: true, // But forceOverwrite enabled!
        },
      };

      const res = mockRes();
      await handleUpdateDraft(req, res);

      EmailAction.findOne = originalFindOne;
      User.findById = originalUserFindById;
      google.gmail = originalGmail;

      assert.equal(res.statusCode, 200);
      assert.equal(mockAction.turns[0].outgoing.body, "Forced user body");
    });

    it("save-first: saves text in MongoDB first, and returns 200 with gmailSync.state='failed' when Gmail fails", async () => {
      const mockAction = {
        _id: "action_save_first_test",
        userId: "user_test_1",
        subject: "Subject",
        body: "Old body",
        turns: [
          {
            turnId: "turn_1",
            versionId: "v1",
            outgoing: {
              kind: "draft",
              body: "Old body",
              status: "draft",
              gmailDraftId: "draft_123",
              versions: [{ versionId: "v1", body: "Old body" }],
            },
          },
        ],
        save: async function () {
          return this;
        },
      };

      const originalFindOne = EmailAction.findOne;
      const originalUserFindById = User.findById;
      const originalGmail = google.gmail;

      // Simulate non-transient 403 error when updating Gmail (to avoid withGmail exponential retry backoff delays)
      const err403 = new Error("Rate limit / access forbidden");
      err403.status = 403;

      google.gmail = () => ({
        users: {
          drafts: {
            update: async () => {
              throw err403;
            },
          },
        },
      });

      EmailAction.findOne = () => Promise.resolve(mockAction);
      User.findById = () => Promise.resolve({
        _id: "user_test_1",
        email: "test@example.com",
        refreshToken: "mock_refresh_token",
      });

      const req = {
        params: { id: "action_save_first_test" },
        user: { id: "user_test_1" },
        body: {
          to: [{ name: "Recipient", email: "recipient@example.com" }],
          subject: "Subject",
          body: "Persisted text despite Gmail error",
          baseVersionId: "v1",
        },
      };

      const res = mockRes();
      await handleUpdateDraft(req, res);

      EmailAction.findOne = originalFindOne;
      User.findById = originalUserFindById;
      google.gmail = originalGmail;

      // MongoDB draft MUST be updated and HTTP status MUST be 200 (not 500/502)
      assert.equal(res.statusCode, 200);
      assert.equal(mockAction.turns[0].outgoing.body, "Persisted text despite Gmail error");
      assert.equal(mockAction.turns[0].outgoing.gmailSync?.state, "failed");
      assert.ok(mockAction.turns[0].outgoing.gmailSync?.reason);
      assert.equal(res.body.gmailSync?.state, "failed");
    });

    it("Gmail 404 sent check: marks turn sent when message was sent from Gmail", async () => {
      const mockAction = {
        _id: "action_404_sent_test",
        userId: "user_test_1",
        threadId: "thread_123",
        subject: "Subject",
        turns: [
          {
            turnId: "turn_1",
            outcome: "drafted",
            gmailThreadId: "thread_123",
            outgoing: {
              kind: "draft",
              status: "draft",
              createdAt: new Date(Date.now() - 60000),
              gmailDraftId: "draft_stale_123",
            },
          },
        ],
        save: async function () {
          return this;
        },
      };

      const originalGmail = google.gmail;

      const err404 = new Error("Draft not found");
      err404.status = 404;

      google.gmail = () => ({
        users: {
          drafts: {
            update: async () => {
              throw err404;
            },
          },
          threads: {
            get: async () => ({
              data: {
                messages: [
                  {
                    id: "msg_sent_1",
                    labelIds: ["SENT"],
                    internalDate: Date.now().toString(),
                  },
                ],
              },
            }),
          },
        },
      });

      const user = { _id: "user_test_1", email: "me@example.com", refreshToken: "mock_refresh_token" };
      const syncResult = await syncDraftToGmail({
        user,
        action: mockAction,
        turn: mockAction.turns[0],
        parsedTo: [{ email: "test@example.com" }],
        targetCc: [],
        targetBcc: [],
        subject: "Subject",
        body: "Body",
      });

      google.gmail = originalGmail;

      assert.equal(syncResult.success, true);
      assert.equal(syncResult.alreadySent, true);
      assert.equal(mockAction.turns[0].outgoing.status, "sent");
      assert.equal(mockAction.status, "sent");
    });

    it("Gmail 404 missing draft: recreates missing draft in thread with current text", async () => {
      const mockAction = {
        _id: "action_404_recreate_test",
        userId: "user_test_1",
        threadId: "thread_456",
        subject: "Subject",
        turns: [
          {
            turnId: "turn_1",
            outcome: "drafted",
            gmailThreadId: "thread_456",
            outgoing: {
              kind: "draft",
              status: "draft",
              createdAt: new Date(),
              gmailDraftId: "draft_deleted_456",
            },
          },
        ],
        save: async function () {
          return this;
        },
      };

      const originalGmail = google.gmail;

      const err404 = new Error("Draft not found");
      err404.status = 404;

      let recreatedDraftCalled = false;
      google.gmail = () => ({
        users: {
          drafts: {
            update: async () => {
              throw err404;
            },
            create: async () => {
              recreatedDraftCalled = true;
              return { data: { id: "new_recreated_draft_789" } };
            },
          },
          threads: {
            get: async () => ({
              data: {
                messages: [{ id: "incoming_1", labelIds: ["INBOX"] }],
              },
            }),
          },
        },
      });

      const user = { _id: "user_test_1", email: "me@example.com", refreshToken: "mock_refresh_token" };
      const syncResult = await syncDraftToGmail({
        user,
        action: mockAction,
        turn: mockAction.turns[0],
        parsedTo: [{ email: "test@example.com" }],
        targetCc: [],
        targetBcc: [],
        subject: "Subject",
        body: "Recreated body",
      });

      google.gmail = originalGmail;

      assert.equal(syncResult.success, true);
      assert.equal(syncResult.recreated, true);
      assert.ok(recreatedDraftCalled);
      assert.equal(mockAction.turns[0].outgoing.gmailDraftId, "new_recreated_draft_789");
    });
  });

  describe("3. Retry Gmail Synchronization (POST /email-actions/:id/retry-gmail-sync)", () => {
    it("successfully retries failed sync for the draft turn", async () => {
      const mockAction = {
        _id: "action_retry_test",
        userId: "user_test_1",
        subject: "Subject",
        body: "Saved draft body",
        turns: [
          {
            turnId: "turn_1",
            outgoing: {
              kind: "draft",
              status: "draft",
              body: "Saved draft body",
              to: [{ name: "User", email: "user@example.com" }],
              cc: [],
              bcc: [],
              gmailDraftId: "draft_retry_1",
              gmailSync: { state: "failed", reason: "Connection timeout" },
            },
          },
        ],
        save: async function () {
          return this;
        },
      };

      const originalFindOne = EmailAction.findOne;
      const originalUserFindById = User.findById;
      const originalGmail = google.gmail;

      google.gmail = () => ({
        users: {
          drafts: {
            update: async () => ({ data: { id: "draft_retry_1" } }),
          },
        },
      });

      EmailAction.findOne = () => Promise.resolve(mockAction);
      User.findById = () => Promise.resolve({
        _id: "user_test_1",
        email: "me@example.com",
        refreshToken: "mock_refresh_token",
      });

      const req = {
        params: { id: "action_retry_test" },
        user: { id: "user_test_1" },
      };

      const res = mockRes();
      await handleRetryGmailSync(req, res);

      EmailAction.findOne = originalFindOne;
      User.findById = originalUserFindById;
      google.gmail = originalGmail;

      assert.equal(res.statusCode, 200);
      assert.equal(mockAction.turns[0].outgoing.gmailSync?.state, "synced");
      assert.equal(res.body.gmailSync?.state, "synced");
    });

    it("returns 400 when attempting to retry sync on a non-draft turn", async () => {
      const mockAction = {
        _id: "action_sent_test",
        userId: "user_test_1",
        turns: [
          {
            turnId: "turn_1",
            outgoing: {
              kind: "reply",
              status: "sent",
            },
          },
        ],
      };

      const originalFindOne = EmailAction.findOne;
      const originalUserFindById = User.findById;

      EmailAction.findOne = () => Promise.resolve(mockAction);
      User.findById = () => Promise.resolve({ _id: "user_test_1" });

      const req = {
        params: { id: "action_sent_test" },
        user: { id: "user_test_1" },
      };

      const res = mockRes();
      await handleRetryGmailSync(req, res);

      EmailAction.findOne = originalFindOne;
      User.findById = originalUserFindById;

      assert.equal(res.statusCode, 400);
      assert.ok(res.body.message?.includes("No active draft"));
    });
  });
});
