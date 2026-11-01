// frontend/src/features/labels/ruleLogic.js

export const RULE_COLOR_PALETTE = [
  { id: "blue", hex: "#3b82f6", name: "Blue", bgClass: "bg-blue-500", textClass: "text-blue-500" },
  { id: "emerald", hex: "#10b981", name: "Emerald", bgClass: "bg-emerald-500", textClass: "text-emerald-500" },
  { id: "indigo", hex: "#6366f1", name: "Indigo", bgClass: "bg-indigo-500", textClass: "text-indigo-500" },
  { id: "violet", hex: "#8b5cf6", name: "Violet", bgClass: "bg-violet-500", textClass: "text-violet-500" },
  { id: "amber", hex: "#f59e0b", name: "Amber", bgClass: "bg-amber-500", textClass: "text-amber-500" },
  { id: "rose", hex: "#f43f5e", name: "Rose", bgClass: "bg-rose-500", textClass: "text-rose-500" },
  { id: "cyan", hex: "#06b6d4", name: "Cyan", bgClass: "bg-cyan-500", textClass: "text-cyan-500" },
  { id: "orange", hex: "#f97316", name: "Orange", bgClass: "bg-orange-500", textClass: "text-orange-500" }
];

export const ACTION_EXPLANATIONS = {
  none: "None only labels the email",
  draft: "Draft saves it for your review",
  reply: "Reply sends automatically"
};

/**
 * Validates rule name.
 * Name must be 1-40 chars trimmed and unique case-insensitively.
 */
export function validateRuleName(name, existingLabels = [], currentLabelId = null) {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    return { valid: false, error: "Rule name is required." };
  }
  if (trimmed.length > 40) {
    return { valid: false, error: "Rule name must be 40 characters or fewer." };
  }

  const isDuplicate = existingLabels.some((l) => {
    const id = l._id || l.id;
    if (currentLabelId && String(id) === String(currentLabelId)) {
      return false;
    }
    return l.name && l.name.trim().toLowerCase() === trimmed.toLowerCase();
  });

  if (isDuplicate) {
    return { valid: false, error: "A rule with this name already exists." };
  }

  return { valid: true, error: null, value: trimmed };
}

/**
 * Computes default grounding based on selected knowledge bases.
 * Batch 3 logic: Strict when at least one document selected, Flexible when none.
 */
export function getDefaultGrounding(knowledgeDocumentIds = []) {
  return Array.isArray(knowledgeDocumentIds) && knowledgeDocumentIds.length > 0
    ? "strict"
    : "flexible";
}

/**
 * Evaluates inline warnings for rule configuration.
 * Warnings do NOT block saving.
 */
export function evaluateRuleWarnings({ actionType, grounding, knowledgeDocumentIds = [] }) {
  const warnings = [];
  if (actionType === "none") {
    return warnings;
  }

  const hasDocs = Array.isArray(knowledgeDocumentIds) && knowledgeDocumentIds.length > 0;

  // Strict chosen with no knowledge base
  if (grounding === "strict" && !hasDocs) {
    warnings.push({
      id: "strict-no-kb",
      type: "strict_without_docs",
      message: "Warning: Every email will need a manual reply because no knowledge bases are selected."
    });
  }

  // Reply chosen together with Flexible
  if (actionType === "reply" && grounding === "flexible") {
    warnings.push({
      id: "reply-flexible",
      type: "reply_flexible",
      message: "Warning: Replies will go out without checking your documents."
    });
  }

  return warnings;
}

/**
 * Determines whether AI styling/knowledge fields should be active or inactive.
 * When action is "none", style and grounding fields are not used.
 */
export function isActionNone(actionType) {
  return actionType === "none";
}

/**
 * Optimistic state manager for inline table edits.
 */
export function applyOptimisticUpdate(currentItems, id, field, nextValue) {
  return currentItems.map((item) => {
    const itemId = item._id || item.id;
    if (String(itemId) === String(id)) {
      if (field === "action") {
        return {
          ...item,
          action: {
            ...item.action,
            type: nextValue
          }
        };
      }
      return { ...item, [field]: nextValue };
    }
    return item;
  });
}

