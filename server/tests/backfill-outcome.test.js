import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { determineOutcome } from "../tools/backfill-processed-outcome.js";

describe("backfill-processed-outcome determineOutcome", () => {
  it("maps failed status to failed outcome", () => {
    const res = determineOutcome({ status: "failed", action: "reply" });
    assert.deepEqual(res, { outcome: "failed" });
  });

  it("maps draft action to drafted outcome", () => {
    const res = determineOutcome({ status: "done", action: "draft" });
    assert.deepEqual(res, { outcome: "drafted", resolution: "none" });
  });

  it("maps reply action to sent outcome", () => {
    const res = determineOutcome({ status: "done", action: "reply" });
    assert.deepEqual(res, { outcome: "sent", resolution: "ai_reply_sent" });
  });

  it("maps none action to labeled outcome", () => {
    const res = determineOutcome({ status: "done", action: "none" });
    assert.deepEqual(res, { outcome: "labeled", resolution: "none" });
  });

  it("preserves existing resolution if already set", () => {
    const res = determineOutcome({ status: "done", action: "draft", resolution: "ai_draft_sent" });
    assert.deepEqual(res, { outcome: "drafted" });
  });
});
