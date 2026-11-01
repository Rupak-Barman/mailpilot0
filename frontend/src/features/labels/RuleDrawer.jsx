import { useState, useEffect, useRef } from "react";
import {
  FiX,
  FiCheck,
  FiSearch,
  FiAlertTriangle,
  FiInfo,
  FiFileText,
  FiLoader
} from "react-icons/fi";
import clsx from "clsx";
import { Button } from "../../components/common/Button";
import { Input, Select, Toggle } from "../../components/common/FormControls";
import { toneOptions } from "../../utils/constants";
import { titleCase } from "../../utils/formatters";
import {
  RULE_COLOR_PALETTE,
  ACTION_EXPLANATIONS,
  validateRuleName,
  getDefaultGrounding,
  evaluateRuleWarnings,
  isActionNone
} from "./ruleLogic";

export const RuleDrawer = ({
  isOpen,
  onClose,
  initialData = null,
  existingLabels = [],
  personas = [],
  documents = [],
  onSave,
  isSaving = false
}) => {
  const isEditMode = Boolean(initialData?._id || initialData?.id);
  const currentId = initialData?._id || initialData?.id || null;

  // Form states
  const [name, setName] = useState("");
  const [color, setColor] = useState(RULE_COLOR_PALETTE[0].hex);
  const [actionType, setActionType] = useState("draft");
  const [tone, setTone] = useState("friendly");
  const [personaId, setPersonaId] = useState("");
  const [knowledgeDocumentIds, setKnowledgeDocumentIds] = useState([]);
  const [grounding, setGrounding] = useState("flexible");
  const [markAsRead, setMarkAsRead] = useState(false);
  const [enabled, setEnabled] = useState(true);

  // Search filter for knowledge bases in multi-select
  const [kbSearch, setKbSearch] = useState("");
  // Track if user explicitly picked grounding to avoid overriding their choice
  const [userTouchedGrounding, setUserTouchedGrounding] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [submitError, setSubmitError] = useState("");

  const drawerRef = useRef(null);
  const firstInputRef = useRef(null);

  // Initialize form when drawer opens or initialData changes
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setName(initialData.name || "");
        setColor(initialData.color || RULE_COLOR_PALETTE[0].hex);
        const act = initialData.action?.type || "none";
        setActionType(act);
        setTone(initialData.tone || "friendly");
        setPersonaId(initialData.personaId || "");
        const docIds = initialData.knowledgeDocumentIds || [];
        setKnowledgeDocumentIds(docIds);
        setGrounding(
          initialData.grounding ||
            (docIds.length > 0 ? "strict" : "flexible")
        );
        setMarkAsRead(
          typeof initialData.markAsRead === "boolean"
            ? initialData.markAsRead
            : act !== "draft"
        );
        setEnabled(initialData.enabled !== false);
        setUserTouchedGrounding(Boolean(initialData.grounding));
      } else {
        // Add mode defaults
        setName("");
        setColor(RULE_COLOR_PALETTE[0].hex);
        setActionType("draft");
        setTone("friendly");
        setPersonaId("");
        setKnowledgeDocumentIds([]);
        setGrounding("flexible");
        setMarkAsRead(false);
        setEnabled(true);
        setUserTouchedGrounding(false);
      }
      setKbSearch("");
      setValidationError("");
      setSubmitError("");

      // Focus first input
      setTimeout(() => {
        firstInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen, initialData]);

  // Handle escape key and focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && drawerRef.current) {
        const focusableElements = drawerRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Update grounding default when knowledgeDocumentIds change (if user hasn't manually overridden)
  const handleToggleDocument = (docId) => {
    const nextIds = knowledgeDocumentIds.includes(docId)
      ? knowledgeDocumentIds.filter((id) => id !== docId)
      : [...knowledgeDocumentIds, docId];

    setKnowledgeDocumentIds(nextIds);

    if (!userTouchedGrounding) {
      setGrounding(getDefaultGrounding(nextIds));
    }
  };

  const handleSelectAllDocuments = (selectAll) => {
    const nextIds = selectAll
      ? documents.map((doc) => doc.documentId)
      : [];
    setKnowledgeDocumentIds(nextIds);

    if (!userTouchedGrounding) {
      setGrounding(getDefaultGrounding(nextIds));
    }
  };

  const handleActionChange = (newAction) => {
    setActionType(newAction);
    // Draft defaults markAsRead to false, reply/none to true if previously unmodified
    if (newAction === "draft") {
      setMarkAsRead(false);
    } else if (newAction === "reply") {
      setMarkAsRead(true);
    }
  };

  const warnings = evaluateRuleWarnings({
    actionType,
    grounding,
    knowledgeDocumentIds
  });

  const handleSubmit = (e) => {
    e?.preventDefault();
    setSubmitError("");

    const nameValidation = validateRuleName(name, existingLabels, currentId);
    if (!nameValidation.valid) {
      setValidationError(nameValidation.error);
      firstInputRef.current?.focus();
      return;
    }
    setValidationError("");

    const payload = {
      name: nameValidation.value,
      color,
      action: {
        type: actionType,
        template: initialData?.action?.template || ""
      },
      tone,
      personaId: personaId || "",
      knowledgeDocumentIds,
      grounding: isActionNone(actionType)
        ? (initialData?.grounding || getDefaultGrounding(knowledgeDocumentIds))
        : grounding,
      markAsRead,
      enabled
    };

    onSave(payload, {
      onError: (err) => {
        setSubmitError(
          err?.response?.data?.message || err?.message || "Failed to save routing rule."
        );
      }
    });
  };

  if (!isOpen) return null;

  const filteredDocuments = documents.filter((doc) => {
    if (!kbSearch.trim()) return true;
    const q = kbSearch.toLowerCase();
    const title = (doc.displayName || doc.fileName || "").toLowerCase();
    return title.includes(q);
  });

  const allFilteredSelected =
    filteredDocuments.length > 0 &&
    filteredDocuments.every((doc) =>
      knowledgeDocumentIds.includes(doc.documentId)
    );

  const actionIsNone = isActionNone(actionType);

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-slate-900/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
      aria-labelledby="rule-drawer-title"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-6 sm:pl-16">
        <div
          ref={drawerRef}
          className="w-screen max-w-xl bg-white shadow-2xl flex flex-col dark:bg-zinc-900 dark:border-l dark:border-zinc-800 animate-in slide-in-from-right duration-200"
        >
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-zinc-800">
            <div>
              <h2
                id="rule-drawer-title"
                className="text-lg font-bold text-slate-900 dark:text-slate-100"
              >
                {isEditMode ? "Edit Routing Rule" : "Add Routing Rule"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Configure how Mailpilot categorizes and processes matching emails.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              aria-label="Close rule editor"
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:bg-zinc-800 dark:hover:text-slate-200 cursor-pointer"
            >
              <FiX className="h-5 w-5" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* Live status announcements */}
            <div aria-live="polite" className="sr-only">
              {submitError ? `Error: ${submitError}` : ""}
              {validationError ? `Validation error: ${validationError}` : ""}
            </div>

            {submitError && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300 flex items-start gap-2">
                <FiAlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}

            {/* GROUP 1: Rule Details (Name & Colour) */}
            <section className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                1. Rule Details
              </h3>

              <div>
                <label
                  htmlFor="rule-name-input"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300"
                >
                  Name <span className="text-rose-500">*</span>
                </label>
                <Input
                  id="rule-name-input"
                  ref={firstInputRef}
                  value={name}
                  maxLength={40}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (validationError) setValidationError("");
                  }}
                  placeholder="e.g. Inquiries, VIP Clients, Billing"
                  className={clsx("mt-1.5", validationError && "border-rose-500 ring-rose-500/20")}
                  aria-invalid={Boolean(validationError)}
                  aria-describedby={validationError ? "rule-name-error" : "rule-name-help"}
                />
                <div className="mt-1 flex items-center justify-between text-xs">
                  {validationError ? (
                    <span id="rule-name-error" className="text-rose-600 font-medium">
                      {validationError}
                    </span>
                  ) : (
                    <span id="rule-name-help" className="text-slate-500 dark:text-slate-400">
                      1-40 characters, unique across all rules.
                    </span>
                  )}
                  <span className="text-slate-400">{name.length}/40</span>
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300 mb-2">
                  Colour
                </span>
                <div
                  role="radiogroup"
                  aria-label="Rule colour palette"
                  className="flex flex-wrap items-center gap-2.5"
                >
                  {RULE_COLOR_PALETTE.map((pal) => {
                    const isSelected = color === pal.hex;
                    return (
                      <button
                        key={pal.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        aria-label={`Select ${pal.name} color`}
                        onClick={() => setColor(pal.hex)}
                        className={clsx(
                          "relative h-7 w-7 rounded-full transition-transform cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-900",
                          isSelected ? "scale-110 ring-2 ring-slate-900 dark:ring-white" : "hover:scale-105"
                        )}
                        style={{ backgroundColor: pal.hex }}
                      >
                        {isSelected && (
                          <FiCheck className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow-xs" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* GROUP 2: What should Mailpilot do? (Action) */}
            <section className="space-y-3 pt-3 border-t border-slate-100 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  2. What should Mailpilot do?
                </h3>
              </div>

              <div
                role="radiogroup"
                aria-label="Action selection"
                className="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
              >
                {[
                  { id: "none", label: "None", desc: ACTION_EXPLANATIONS.none },
                  { id: "draft", label: "Draft", desc: ACTION_EXPLANATIONS.draft },
                  { id: "reply", label: "Reply", desc: ACTION_EXPLANATIONS.reply }
                ].map((act) => {
                  const isSelected = actionType === act.id;
                  return (
                    <label
                      key={act.id}
                      className={clsx(
                        "relative flex flex-col p-3 rounded-lg border cursor-pointer transition-all text-left",
                        isSelected
                          ? "border-blue-600 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/20 shadow-xs"
                          : "border-slate-200 hover:border-slate-300 dark:border-zinc-700 dark:hover:border-zinc-600"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {act.label}
                        </span>
                        <input
                          type="radio"
                          name="rule-action"
                          value={act.id}
                          checked={isSelected}
                          onChange={() => handleActionChange(act.id)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                        />
                      </div>
                      <span className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
                        {act.desc}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            {/* SMART NOTICE WHEN ACTION IS NONE */}
            {actionIsNone && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-slate-300 flex items-center gap-2">
                <FiInfo className="h-4 w-4 shrink-0 text-blue-500" />
                <span>
                  Writing style and document knowledge bases are <strong>not used</strong> when the action is None (only labels the email). Previous selections are preserved.
                </span>
              </div>
            )}

            {/* GROUP 3: Writing Style (Tone & Persona) */}
            <section
              className={clsx(
                "space-y-4 pt-3 border-t border-slate-100 dark:border-zinc-800 transition-opacity",
                actionIsNone ? "opacity-40 pointer-events-none" : "opacity-100"
              )}
            >
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                3. Writing Style
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="rule-tone-select"
                    className="block text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300"
                  >
                    Tone
                  </label>
                  <Select
                    id="rule-tone-select"
                    value={tone}
                    disabled={actionIsNone}
                    onChange={(e) => setTone(e.target.value)}
                    className="mt-1.5"
                  >
                    {toneOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {titleCase(opt)}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Friendly, formal, or casual response tone.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="rule-persona-select"
                    className="block text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300"
                  >
                    Persona
                  </label>
                  <Select
                    id="rule-persona-select"
                    value={personaId}
                    disabled={actionIsNone}
                    onChange={(e) => setPersonaId(e.target.value)}
                    className="mt-1.5"
                  >
                    <option value="">Default persona</option>
                    {personas.map((p) => (
                      <option key={p._id || p.id} value={p._id || p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Custom instructions and sign-off.
                  </p>
                </div>
              </div>
            </section>

            {/* GROUP 4: Answer from my documents (Grounding & Knowledge Bases) */}
            <section
              className={clsx(
                "space-y-4 pt-3 border-t border-slate-100 dark:border-zinc-800 transition-opacity",
                actionIsNone ? "opacity-40 pointer-events-none" : "opacity-100"
              )}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  4. Answer from my documents
                </h3>
              </div>

              {/* Grounding Mode */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300 mb-1.5">
                  Grounding Mode
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label
                    className={clsx(
                      "flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition text-left",
                      grounding === "strict"
                        ? "border-blue-600 bg-blue-50/40 dark:border-blue-500 dark:bg-blue-950/20"
                        : "border-slate-200 dark:border-zinc-700 hover:border-slate-300"
                    )}
                  >
                    <input
                      type="radio"
                      name="rule-grounding"
                      value="strict"
                      checked={grounding === "strict"}
                      disabled={actionIsNone}
                      onChange={() => {
                        setGrounding("strict");
                        setUserTouchedGrounding(true);
                      }}
                      className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                        Strict
                      </span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                        Only answers questions directly supported by your documents. Fails if no match.
                      </span>
                    </div>
                  </label>

                  <label
                    className={clsx(
                      "flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition text-left",
                      grounding === "flexible"
                        ? "border-blue-600 bg-blue-50/40 dark:border-blue-500 dark:bg-blue-950/20"
                        : "border-slate-200 dark:border-zinc-700 hover:border-slate-300"
                    )}
                  >
                    <input
                      type="radio"
                      name="rule-grounding"
                      value="flexible"
                      checked={grounding === "flexible"}
                      disabled={actionIsNone}
                      onChange={() => {
                        setGrounding("flexible");
                        setUserTouchedGrounding(true);
                      }}
                      className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                        Flexible
                      </span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                        Allows polite acknowledgements and general assistance when documents don't match.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Inline Warnings (non-blocking) */}
              {!actionIsNone && warnings.length > 0 && (
                <div className="space-y-2">
                  {warnings.map((w) => (
                    <div
                      key={w.id}
                      className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200 flex items-start gap-2.5"
                    >
                      <FiAlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                      <div>
                        <span className="font-semibold block">Configuration Note</span>
                        <span className="mt-0.5 block">{w.message}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Knowledge Bases Multi-select with Search & Checkboxes */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                    Knowledge bases ({knowledgeDocumentIds.length} selected)
                  </label>
                  {documents.length > 0 && (
                    <button
                      type="button"
                      disabled={actionIsNone}
                      onClick={() => handleSelectAllDocuments(!allFilteredSelected)}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer disabled:opacity-50"
                    >
                      {allFilteredSelected ? "Deselect all" : "Select all"}
                    </button>
                  )}
                </div>

                {documents.length === 0 ? (
                  <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500 dark:border-zinc-700">
                    No documents uploaded yet. Upload PDFs in the AI Knowledge Base tab.
                  </p>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-2 dark:border-zinc-700 dark:bg-zinc-800/30">
                    {/* Search Input */}
                    <div className="relative mb-2">
                      <FiSearch className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        value={kbSearch}
                        disabled={actionIsNone}
                        onChange={(e) => setKbSearch(e.target.value)}
                        placeholder="Search uploaded documents..."
                        className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-100"
                      />
                    </div>

                    {/* Document List */}
                    <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                      {filteredDocuments.length === 0 ? (
                        <p className="py-2 text-center text-xs text-slate-400">
                          No documents matching "{kbSearch}"
                        </p>
                      ) : (
                        filteredDocuments.map((doc) => {
                          const isChecked = knowledgeDocumentIds.includes(
                            doc.documentId
                          );
                          return (
                            <label
                              key={doc.documentId}
                              className={clsx(
                                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition cursor-pointer select-none",
                                isChecked
                                  ? "bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200 font-medium"
                                  : "hover:bg-slate-100 text-slate-700 dark:hover:bg-zinc-800 dark:text-slate-300"
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={actionIsNone}
                                onChange={() =>
                                  handleToggleDocument(doc.documentId)
                                }
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <FiFileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              <span className="truncate">
                                {doc.displayName || doc.fileName}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* GROUP 5: Automation & Status */}
            <section className="space-y-4 pt-3 border-t border-slate-100 dark:border-zinc-800">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                5. Automation & Status
              </h3>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                    Mark as read
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Automatically mark incoming emails matching this rule as read in Gmail.
                  </p>
                </div>
                <Toggle
                  checked={markAsRead}
                  onChange={(checked) => setMarkAsRead(checked)}
                />
              </div>

              <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-100 dark:border-zinc-800">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                    Active Status
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Enable this rule to automatically process incoming emails.
                  </p>
                </div>
                <Toggle
                  checked={enabled}
                  onChange={(checked) => setEnabled(checked)}
                />
              </div>
            </section>
          </div>

          {/* Drawer Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-zinc-800">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={isSaving}
              className="min-w-28"
            >
              {isSaving ? (
                <>
                  <FiLoader className="h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              ) : isEditMode ? (
                "Save changes"
              ) : (
                "Add rule"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
