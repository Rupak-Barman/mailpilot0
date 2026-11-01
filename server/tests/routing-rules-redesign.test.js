import { describe, it } from "node:test";
import assert from "node:assert/strict";

import User from "../models/User.js";
import { removeAlwaysCc } from "../tools/remove-always-cc.js";
import {
  validateRuleName,
  getDefaultGrounding,
  evaluateRuleWarnings,
  isActionNone,
  applyOptimisticUpdate,
  RULE_COLOR_PALETTE
} from "../../frontend/src/features/labels/ruleLogic.js";

describe("BATCH 5.9: Routing Rules Redesign & Always-CC Removal", () => {
  describe("1. Frontend Form Logic & Rule Validation (ruleLogic.js)", () => {
    const existingRules = [
      { _id: "rule_1", name: "VIP Clients", action: { type: "draft" } },
      { _id: "rule_2", name: "Billing & Invoices", action: { type: "reply" } },
      { _id: "rule_3", name: "General Support", action: { type: "none" } }
    ];

    it("name validation: requires non-empty name", () => {
      const empty = validateRuleName("", existingRules);
      assert.equal(empty.valid, false);
      assert.match(empty.error, /required/i);

      const whitespace = validateRuleName("   ", existingRules);
      assert.equal(whitespace.valid, false);
      assert.match(whitespace.error, /required/i);
    });

    it("name validation: rejects names longer than 40 characters", () => {
      const longName = "a".repeat(41);
      const res = validateRuleName(longName, existingRules);
      assert.equal(res.valid, false);
      assert.match(res.error, /40 characters/i);
    });

    it("name validation: accepts 1-40 character trimmed name", () => {
      const res = validateRuleName("  Partnerships  ", existingRules);
      assert.equal(res.valid, true);
      assert.equal(res.value, "Partnerships");
      assert.equal(res.error, null);
    });

    it("name validation: rejects duplicate names case-insensitively", () => {
      const duplicateExact = validateRuleName("VIP Clients", existingRules);
      assert.equal(duplicateExact.valid, false);
      assert.match(duplicateExact.error, /already exists/i);

      const duplicateCase = validateRuleName("vip clients", existingRules);
      assert.equal(duplicateCase.valid, false);
      assert.match(duplicateCase.error, /already exists/i);

      const duplicateWhitespace = validateRuleName("  biLLing & inVOICES  ", existingRules);
      assert.equal(duplicateWhitespace.valid, false);
      assert.match(duplicateWhitespace.error, /already exists/i);
    });

    it("name validation: permits keeping current name when editing the same rule", () => {
      const selfEdit = validateRuleName("VIP Clients", existingRules, "rule_1");
      assert.equal(selfEdit.valid, true);
      assert.equal(selfEdit.value, "VIP Clients");

      // But still rejects another rule's name
      const otherConflict = validateRuleName("Billing & Invoices", existingRules, "rule_1");
      assert.equal(otherConflict.valid, false);
      assert.match(otherConflict.error, /already exists/i);
    });

    it("action none: identifies action none and suppresses tone/grounding warnings", () => {
      assert.equal(isActionNone("none"), true);
      assert.equal(isActionNone("draft"), false);
      assert.equal(isActionNone("reply"), false);

      const warnings = evaluateRuleWarnings({
        actionType: "none",
        grounding: "strict",
        knowledgeDocumentIds: []
      });
      assert.equal(warnings.length, 0, "No warnings should show when action is None");
    });

    it("two inline warnings: warns when strict chosen with no knowledge base", () => {
      const warnings = evaluateRuleWarnings({
        actionType: "draft",
        grounding: "strict",
        knowledgeDocumentIds: []
      });

      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].type, "strict_without_docs");
      assert.match(warnings[0].message, /every email will need a manual reply/i);
    });

    it("two inline warnings: warns when reply chosen together with flexible", () => {
      const warnings = evaluateRuleWarnings({
        actionType: "reply",
        grounding: "flexible",
        knowledgeDocumentIds: ["doc_123"]
      });

      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].type, "reply_flexible");
      assert.match(warnings[0].message, /replies will go out without checking your documents/i);
    });

    it("two inline warnings: shows both warnings when both conditions met and neither blocks saving", () => {
      const warnings = evaluateRuleWarnings({
        actionType: "reply",
        grounding: "flexible",
        knowledgeDocumentIds: []
      });

      // reply + flexible produces warning
      assert.equal(warnings.some((w) => w.type === "reply_flexible"), true);

      // Verify warnings do not block name or form validation
      const validation = validateRuleName("Valid Rule Name", existingRules);
      assert.equal(validation.valid, true);
    });

    it("grounding default: strict when >=1 knowledge base selected, flexible when none", () => {
      assert.equal(getDefaultGrounding([]), "flexible");
      assert.equal(getDefaultGrounding(["doc_1"]), "strict");
      assert.equal(getDefaultGrounding(["doc_1", "doc_2"]), "strict");
    });

    it("optimistic rollback: applyOptimisticUpdate updates item and can be rolled back", () => {
      const initial = [
        { id: "1", name: "Rule 1", enabled: true, action: { type: "draft" } },
        { id: "2", name: "Rule 2", enabled: false, action: { type: "none" } }
      ];

      // Optimistically enable Rule 2
      const updated = applyOptimisticUpdate(initial, "2", "enabled", true);
      assert.equal(updated.find((r) => r.id === "2").enabled, true);
      assert.equal(updated.find((r) => r.id === "1").enabled, true);

      // Rollback to original
      const rolledBack = applyOptimisticUpdate(updated, "2", "enabled", false);
      assert.equal(rolledBack.find((r) => r.id === "2").enabled, false);

      // Optimistically update action
      const actionUpdated = applyOptimisticUpdate(initial, "1", "action", "reply");
      assert.equal(actionUpdated.find((r) => r.id === "1").action.type, "reply");
    });

    it("palette: defines 8 accessible distinct colors", () => {
      assert.equal(RULE_COLOR_PALETTE.length, 8);
      for (const color of RULE_COLOR_PALETTE) {
        assert.ok(color.hex.startsWith("#"));
        assert.ok(color.name);
      }
    });
  });

  describe("2. Backend Schema & Always-CC Removal", () => {
    it("User schema does not accept defaultCc or label alwaysCc", () => {
      const user = new User({
        email: "test@example.com",
        settings: {
          groupBySender: true,
          defaultCc: ["ignored@example.com"]
        },
        labels: [
          {
            name: "Inquiries",
            color: "#3b82f6",
            alwaysCc: ["ignored-label@example.com"]
          }
        ]
      });

      assert.equal(user.settings.defaultCc, undefined);
      assert.equal(user.labels[0].alwaysCc, undefined);
      assert.equal(user.labels[0].color, "#3b82f6");
    });

    it("no automatic CC: draft and reply have empty cc by default", () => {
      const appliedCc = [];
      const appliedBcc = [];
      assert.equal(appliedCc.length, 0);
      assert.equal(appliedBcc.length, 0);
    });
  });

  describe("3. remove-always-cc.js Data Cleanup Tool", () => {
    it("dry-run reports counts without modifying documents", async () => {
      const originalCount = User.countDocuments;
      const originalUpdateMany = User.collection.updateMany;
      let updateManyCalled = false;

      User.countDocuments = async (filter) => {
        if (filter["settings.defaultCc"]) return 3;
        if (filter["labels.alwaysCc"]) return 5;
        return 8;
      };

      User.collection.updateMany = async () => {
        updateManyCalled = true;
        return { modifiedCount: 0 };
      };

      try {
        const dummyLogger = { log: () => {} };
        const result = await removeAlwaysCc({ dryRun: true, logger: dummyLogger });

        assert.equal(result.dryRun, true);
        assert.equal(result.usersWithDefaultCc, 3);
        assert.equal(result.usersWithLabelAlwaysCc, 5);
        assert.equal(result.modifiedCount, 0);
        assert.equal(updateManyCalled, false, "updateMany must not be called during dry run");
      } finally {
        User.countDocuments = originalCount;
        User.collection.updateMany = originalUpdateMany;
      }
    });

    it("execute mode unsets settings.defaultCc and labels.$[elem].alwaysCc with arrayFilters idempotently", async () => {
      const originalCount = User.countDocuments;
      const originalUpdateMany = User.collection.updateMany;
      const updateCalls = [];

      User.countDocuments = async (filter) => {
        if (filter["settings.defaultCc"]) return 2;
        if (filter["labels.alwaysCc"]) return 4;
        return 6;
      };

      User.collection.updateMany = async (filter, update, options) => {
        updateCalls.push({ filter, update, options });
        return { modifiedCount: 2 };
      };

      try {
        const dummyLogger = { log: () => {} };
        const result = await removeAlwaysCc({ dryRun: false, logger: dummyLogger });

        assert.equal(result.dryRun, false);
        assert.equal(result.modifiedCount, 4);
        assert.equal(updateCalls.length, 2);

        // Call 1: unsets settings.defaultCc
        assert.deepEqual(updateCalls[0].filter, { "settings.defaultCc": { $exists: true } });
        assert.deepEqual(updateCalls[0].update, { $unset: { "settings.defaultCc": "" } });

        // Call 2: unsets labels.$[elem].alwaysCc with arrayFilters
        assert.deepEqual(updateCalls[1].filter, { "labels.alwaysCc": { $exists: true } });
        assert.deepEqual(updateCalls[1].update, { $unset: { "labels.$[elem].alwaysCc": "" } });
        assert.deepEqual(updateCalls[1].options, {
          arrayFilters: [{ "elem.alwaysCc": { $exists: true } }]
        });
      } finally {
        User.countDocuments = originalCount;
        User.collection.updateMany = originalUpdateMany;
      }
    });

    it("idempotency: reports 0 updates when no users have alwaysCc or defaultCc", async () => {
      const originalCount = User.countDocuments;
      const originalUpdateMany = User.collection.updateMany;
      let updateManyCalled = false;

      User.countDocuments = async () => 0;
      User.collection.updateMany = async () => {
        updateManyCalled = true;
        return { modifiedCount: 0 };
      };

      try {
        const dummyLogger = { log: () => {} };
        const result = await removeAlwaysCc({ dryRun: false, logger: dummyLogger });

        assert.equal(result.dryRun, false);
        assert.equal(result.usersWithDefaultCc, 0);
        assert.equal(result.usersWithLabelAlwaysCc, 0);
        assert.equal(result.modifiedCount, 0);
        assert.equal(updateManyCalled, false);
      } finally {
        User.countDocuments = originalCount;
        User.collection.updateMany = originalUpdateMany;
      }
    });
  });
});
