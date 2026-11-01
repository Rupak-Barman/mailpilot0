import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isStatusAllowedForTab,
  parseUrlParams,
  buildUrlParams,
  buildApiQueryParams,
  getItemStatus,
  getStatusBadgeConfig,
  TABS,
  STATUS_OPTIONS,
} from "../utils/filterRules.js";

import {
  buildEmailActionsFilter,
  buildDraftFilter,
  buildReplyFilter,
  buildFailedFilter,
} from "../routes/emailAction.routes.js";

describe("BATCH 4: Drafts & Replies UI - Filter combination rules", () => {
  it("defines standard tabs and status options", () => {
    assert.equal(TABS.length, 5);
    assert.deepEqual(
      TABS.map((t) => t.value),
      ["unchecked", "draft", "reply", "failed", "all"]
    );

    assert.equal(STATUS_OPTIONS.length, 6);
    assert.deepEqual(
      STATUS_OPTIONS.map((s) => s.value),
      ["", "draft", "sent", "needs_reply", "failed", "reviewed"]
    );
  });

  it("enforces valid status rules for Unchecked tab", () => {
    assert.equal(isStatusAllowedForTab("unchecked", ""), true);
    assert.equal(isStatusAllowedForTab("unchecked", "draft"), true);
    assert.equal(isStatusAllowedForTab("unchecked", "sent"), true);
    assert.equal(isStatusAllowedForTab("unchecked", "needs_reply"), true);
    assert.equal(isStatusAllowedForTab("unchecked", "failed"), true);
    // Unchecked items cannot be "reviewed" (reviewed means checked: true)
    assert.equal(isStatusAllowedForTab("unchecked", "reviewed"), false);
  });

  it("enforces valid status rules for Drafts tab", () => {
    assert.equal(isStatusAllowedForTab("draft", ""), true);
    assert.equal(isStatusAllowedForTab("draft", "draft"), true);
    // Sent draft stays in Drafts tab with Sent badge
    assert.equal(isStatusAllowedForTab("draft", "sent"), true);
    assert.equal(isStatusAllowedForTab("draft", "failed"), true);
    assert.equal(isStatusAllowedForTab("draft", "reviewed"), true);
    // Drafts cannot be "needs_reply"
    assert.equal(isStatusAllowedForTab("draft", "needs_reply"), false);
  });

  it("enforces valid status rules for Replies tab", () => {
    assert.equal(isStatusAllowedForTab("reply", ""), true);
    assert.equal(isStatusAllowedForTab("reply", "sent"), true);
    assert.equal(isStatusAllowedForTab("reply", "failed"), true);
    assert.equal(isStatusAllowedForTab("reply", "reviewed"), true);
    // Replies cannot be "draft" or "needs_reply"
    assert.equal(isStatusAllowedForTab("reply", "draft"), false);
    assert.equal(isStatusAllowedForTab("reply", "needs_reply"), false);
  });

  it("enforces valid status rules for Failed tab", () => {
    assert.equal(isStatusAllowedForTab("failed", ""), true);
    assert.equal(isStatusAllowedForTab("failed", "failed"), true);
    assert.equal(isStatusAllowedForTab("failed", "reviewed"), true);
    assert.equal(isStatusAllowedForTab("failed", "draft"), false);
    assert.equal(isStatusAllowedForTab("failed", "sent"), false);
    assert.equal(isStatusAllowedForTab("failed", "needs_reply"), false);
  });

  it("allows all statuses in All tab", () => {
    for (const opt of STATUS_OPTIONS) {
      assert.equal(isStatusAllowedForTab("all", opt.value), true);
    }
  });
});

describe("BATCH 4: URL Query-param builder & parser", () => {
  it("parseUrlParams extracts valid params with defaults", () => {
    const searchParams = new URLSearchParams("tab=draft&status=sent&q=invoice&page=2");
    const parsed = parseUrlParams(searchParams);

    assert.equal(parsed.tab, "draft");
    assert.equal(parsed.status, "sent");
    assert.equal(parsed.q, "invoice");
    assert.equal(parsed.page, 2);
    assert.equal(parsed.limit, 20);
  });

  it("parseUrlParams falls back to defaults for invalid or missing inputs", () => {
    const searchParams = new URLSearchParams("tab=invalid_tab&page=-5");
    const parsed = parseUrlParams(searchParams);

    assert.equal(parsed.tab, "unchecked");
    assert.equal(parsed.status, "");
    assert.equal(parsed.q, "");
    assert.equal(parsed.page, 1);
  });

  it("parseUrlParams rejects impossible status for the given tab", () => {
    // reviewed is impossible in unchecked tab
    const searchParams = new URLSearchParams("tab=unchecked&status=reviewed");
    const parsed = parseUrlParams(searchParams);

    assert.equal(parsed.tab, "unchecked");
    assert.equal(parsed.status, ""); // reset to ""
  });

  it("buildUrlParams serializes filters into URLSearchParams cleanly", () => {
    const params = buildUrlParams({
      tab: "draft",
      status: "sent",
      q: "meeting",
      page: 3,
    });

    assert.equal(params.get("tab"), "draft");
    assert.equal(params.get("status"), "sent");
    assert.equal(params.get("q"), "meeting");
    assert.equal(params.get("page"), "3");
  });

  it("buildUrlParams omits default values (unchecked tab, page 1, empty search)", () => {
    const params = buildUrlParams({
      tab: "unchecked",
      status: "",
      q: "   ",
      page: 1,
    });

    assert.equal(params.get("tab"), null);
    assert.equal(params.get("status"), null);
    assert.equal(params.get("q"), null);
    assert.equal(params.get("page"), null);
  });

  it("buildApiQueryParams maps frontend filters to backend API parameters", () => {
    const apiParams = buildApiQueryParams({
      tab: "draft",
      status: "sent",
      q: "proposal",
      page: 2,
      limit: 20,
    });

    assert.equal(apiParams.tab, "draft");
    assert.equal(apiParams.type, "draft");
    assert.equal(apiParams.status, "sent");
    assert.equal(apiParams.q, "proposal");
    assert.equal(apiParams.page, 2);
    assert.equal(apiParams.limit, 20);
  });

  it("buildApiQueryParams maps unchecked tab to checked=false", () => {
    const apiParams = buildApiQueryParams({
      tab: "unchecked",
      page: 1,
    });

    assert.equal(apiParams.checked, "false");
    assert.equal(apiParams.tab, undefined);
  });
});

describe("BATCH 4: Status badge determination", () => {
  it("correctly identifies Sent status for a sent draft (retained in Drafts tab)", () => {
    const item = {
      type: "draft",
      status: "sent",
      turns: [
        {
          outcome: "sent",
          outgoing: {
            kind: "draft",
            status: "sent",
            sentAt: new Date(),
          },
        },
      ],
    };

    const status = getItemStatus(item);
    assert.equal(status, "sent");

    const badge = getStatusBadgeConfig(status);
    assert.equal(badge.label, "Sent");
    assert.equal(badge.tone, "emerald");
  });

  it("correctly identifies Draft status for an unsent draft", () => {
    const item = {
      type: "draft",
      status: "draft",
      turns: [
        {
          outcome: "drafted",
          outgoing: {
            kind: "draft",
            status: "draft",
          },
        },
      ],
    };

    const status = getItemStatus(item);
    assert.equal(status, "draft");

    const badge = getStatusBadgeConfig(status);
    assert.equal(badge.label, "Draft");
    assert.equal(badge.tone, "slate");
  });

  it("correctly identifies Failed status for a failed or needs_manual turn", () => {
    const item = {
      type: "failed",
      status: "failed",
      turns: [
        {
          outcome: "needs_manual",
          failureReason: "no_knowledge_match",
        },
      ],
    };

    const status = getItemStatus(item);
    assert.equal(status, "failed");

    const badge = getStatusBadgeConfig(status);
    assert.equal(badge.label, "Failed");
    assert.equal(badge.tone, "rose");
  });

  it("correctly identifies Reviewed status when checked=true", () => {
    const item = {
      checked: true,
      status: "reviewed",
      turns: [
        {
          outcome: "labeled",
        },
      ],
    };

    const status = getItemStatus(item);
    assert.equal(status, "reviewed");

    const badge = getStatusBadgeConfig(status);
    assert.equal(badge.label, "Reviewed");
    assert.equal(badge.tone, "purple");
  });

  it("correctly identifies Needs reply status when no outgoing reply exists yet", () => {
    const item = {
      checked: false,
      status: "needs_reply",
      turns: [
        {
          outcome: "labeled",
          incomingSubject: "Question about invoice",
        },
      ],
    };

    const status = getItemStatus(item);
    assert.equal(status, "needs_reply");

    const badge = getStatusBadgeConfig(status);
    assert.equal(badge.label, "Needs reply");
    assert.equal(badge.tone, "amber");
  });
});

describe("BATCH 4: Server-side search and filter query builder", () => {
  it("buildEmailActionsFilter combines tab, status, and search without overwriting $or clauses", () => {
    const filter = buildEmailActionsFilter({
      userId: "user_abc",
      tab: "draft",
      status: "sent",
      q: "refund request",
    });

    assert.equal(filter.userId, "user_abc");
    assert.equal(filter.type, "draft");
    assert.ok(Array.isArray(filter.$and));

    // Verify status condition is in $and
    const statusClause = filter.$and.find((c) =>
      c.$or?.some((clause) => clause.$expr || clause.status === "sent")
    );
    assert.ok(statusClause, "Should have status: sent condition in $and");

    // Verify search regex condition is in $and
    const searchClause = filter.$and.find((c) =>
      c.$or?.some((clause) => clause.subject || clause["turns.incomingSubject"])
    );
    assert.ok(searchClause, "Should have search condition in $and");

    // Verify search covers required fields: subject, to, summaries, bodies inside turns
    const orKeys = searchClause.$or.map((o) => Object.keys(o)[0]);
    assert.ok(orKeys.includes("subject"));
    assert.ok(orKeys.includes("to"));
    assert.ok(orKeys.includes("body"));
    assert.ok(orKeys.includes("summary"));
    assert.ok(orKeys.includes("turns.incomingSubject"));
    assert.ok(orKeys.includes("turns.incomingSummary"));
    assert.ok(orKeys.includes("turns.outgoing.body"));
    assert.ok(orKeys.includes("turns.from"));
  });

  it("buildDraftFilter matches latest turn outgoing.kind: draft", () => {
    const draftFilter = buildDraftFilter("user_123");
    assert.equal(draftFilter.userId, "user_123");
    assert.ok(Array.isArray(draftFilter.$or));
    assert.equal(draftFilter.$or[0].$expr.$eq[1], "draft");
  });

  it("buildReplyFilter matches latest turn outgoing.kind: reply", () => {
    const replyFilter = buildReplyFilter("user_123");
    assert.equal(replyFilter.userId, "user_123");
    assert.ok(Array.isArray(replyFilter.$or));
    assert.equal(replyFilter.$or[0].$expr.$eq[1], "reply");
  });

  it("buildFailedFilter matches latest turn outcome in failed or needs_manual", () => {
    const failedFilter = buildFailedFilter("user_123");
    assert.equal(failedFilter.userId, "user_123");
    assert.ok(Array.isArray(failedFilter.$or));
    assert.deepEqual(failedFilter.$or[0].$expr.$in[1], ["failed", "needs_manual"]);
  });
});

