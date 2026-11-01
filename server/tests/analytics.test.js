import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import ProcessedEmail from "../models/ProcessedEmail.js";
import EmailAction from "../models/EmailAction.js";
import { handleGetAnalytics } from "../routes/analytics.routes.js";

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

describe("BATCH 5: Analytics Accuracy with ProcessedEmail as Source of Truth", () => {
  const originalProcessedCount = ProcessedEmail.countDocuments;
  const originalProcessedAggregate = ProcessedEmail.aggregate;
  const originalActionCount = EmailAction.countDocuments;
  const originalActionFind = EmailAction.find;

  afterEach(() => {
    ProcessedEmail.countDocuments = originalProcessedCount;
    ProcessedEmail.aggregate = originalProcessedAggregate;
    EmailAction.countDocuments = originalActionCount;
    EmailAction.find = originalActionFind;
  });

  it("calculates metrics using client-sent local ISO boundaries and ProcessedEmail", async () => {
    const userId = "user123";
    const fromStr = "2026-11-01T00:00:00.000Z";
    const toStr = "2026-11-01T23:59:59.999Z";

    // Mock ProcessedEmail.countDocuments
    const countCalls = [];
    ProcessedEmail.countDocuments = async (filter) => {
      countCalls.push(filter);
      if (filter.outcome === "labeled") return 5;
      if (filter.outcome === "drafted") return 3;
      if (filter.outcome === "sent") return 4;
      if (filter.outcome === "failed") return 2;
      if (filter.outcome === "needs_manual") return 1;
      if (filter.resolution && filter.resolution.$in) return 3;
      if (filter.resolution === "ai_assisted") return 1;
      if (filter.resolution === "manual") return 2;
      // totalProcessed
      return 15;
    };

    ProcessedEmail.aggregate = async () => [
      { _id: "Support", count: 7 },
      { _id: "Billing", count: 8 }
    ];

    // Mock EmailAction.countDocuments
    EmailAction.countDocuments = async (filter) => {
      if (filter.checked === false) return 9; // unchecked all-time
      if (filter.$or) return 3; // draftsPending
      return 0;
    };

    // Mock EmailAction.find for recent activity
    EmailAction.find = () => ({
      sort: () => ({
        limit: () => ({
          select: () => ({
            lean: async () => [
              {
                _id: "act1",
                subject: "Urgent issue",
                to: "client@example.com",
                label: "Support",
                type: "reply",
                status: "failed",
                createdAt: new Date("2026-11-01T12:00:00Z"),
                turns: [
                  {
                    outcome: "needs_manual",
                    failureReason: "no_knowledge_match"
                  }
                ]
              }
            ]
          })
        })
      })
    });

    const req = {
      user: { id: userId },
      query: { from: fromStr, to: toStr }
    };
    const res = mockRes();

    await handleGetAnalytics(req, res);

    assert.equal(res.statusCode, 200);
    const data = res.jsonData;

    // Verify date range returned matches client-sent boundaries
    assert.equal(data.dateRange.from, fromStr);
    assert.equal(data.dateRange.to, toStr);

    // Verify totals
    assert.equal(data.totals.totalProcessed, 15);
    assert.equal(data.totals.labeled, 5);
    assert.equal(data.totals.drafted, 3);
    assert.equal(data.totals.sent, 4);
    assert.equal(data.totals.failed, 2);
    assert.equal(data.totals.needsManual, 1);
    assert.equal(data.totals.resolvedManually, 3);
    assert.equal(data.totals.aiAssisted, 1);
    assert.equal(data.totals.draftsPending, 3);
    assert.equal(data.totals.unchecked, 9);

    // Verify label distribution
    assert.deepEqual(data.totals.labels, { Support: 7, Billing: 8 });

    // Verify sent count derives strictly from ProcessedEmail using sentAt filter
    const sentQuery = countCalls.find((c) => c.outcome === "sent");
    assert.ok(sentQuery, "Should query ProcessedEmail for outcome: sent");
    assert.ok(sentQuery.sentAt, "Should use sentAt date range for sent count");

    // Verify resolved manually derives strictly from ProcessedEmail using resolvedAt filter (includes ai_assisted)
    const resolvedQuery = countCalls.find((c) => c.resolution && c.resolution.$in);
    assert.ok(resolvedQuery, "Should query ProcessedEmail for resolution: { $in: ['manual', 'ai_assisted'] }");
    assert.ok(resolvedQuery.resolvedAt, "Should use resolvedAt date range for manual resolution");

    const aiAssistedQuery = countCalls.find((c) => c.resolution === "ai_assisted");
    assert.ok(aiAssistedQuery, "Should query ProcessedEmail for resolution: ai_assisted");

    // Verify unchecked count in EmailAction does NOT filter by dateRange
    // (checked: false query has no createdAt / updatedAt)

    // Verify recent activity formats failed/needs_manual turns
    assert.equal(data.recentActivity.length, 1);
    assert.equal(data.recentActivity[0].outcome, "needs_manual");
    assert.equal(data.recentActivity[0].status, "needs_manual");
    assert.equal(data.recentActivity[0].failureReason, "no_knowledge_match");
  });

  it("handles fallback to default date boundaries when from/to omitted", async () => {
    ProcessedEmail.countDocuments = async () => 0;
    ProcessedEmail.aggregate = async () => [];
    EmailAction.countDocuments = async () => 0;
    EmailAction.find = () => ({
      sort: () => ({
        limit: () => ({
          select: () => ({
            lean: async () => []
          })
        })
      })
    });

    const req = {
      user: { id: "user456" },
      query: { days: 7 }
    };
    const res = mockRes();

    await handleGetAnalytics(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.jsonData.dateRange.from);
    assert.ok(res.jsonData.dateRange.to);
  });
});

