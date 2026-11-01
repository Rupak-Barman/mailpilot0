import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FiCpu,
  FiChevronDown,
  FiChevronUp,
  FiLoader,
  FiXCircle,
  FiAlertCircle,
  FiBookOpen,
  FiEdit3,
} from "react-icons/fi";
import { Button } from "../../components/common/Button";

const QUICK_CHIPS = [
  "Shorter",
  "More formal",
  "Friendlier",
  "Fix grammar",
  "Add a polite closing",
];

export const AiAssistPanel = ({
  mode = "compose", // "compose" | "revise"
  labelName = "",
  userLabels = [],
  knowledgeFiles = [],
  onGenerate,
  onCancel,
  isLoading = false,
  error = null,
  statusNotice = null,
  isOpen = false,
  onToggle,
}) => {
  const [instruction, setInstruction] = useState("");
  const [useKnowledge, setUseKnowledge] = useState(true);

  // Find label and its documents
  const matchedLabel = (userLabels || []).find(
    (l) => l.name?.trim().toLowerCase() === String(labelName || "").trim().toLowerCase()
  );

  const documentIds = Array.isArray(matchedLabel?.knowledgeDocumentIds)
    ? matchedLabel.knowledgeDocumentIds.map(String)
    : [];

  const attachedDocs = (knowledgeFiles || []).filter((f) =>
    documentIds.includes(String(f._id || f.id || f.documentId))
  );

  const hasDocuments = documentIds.length > 0;

  // Sync default useKnowledge when label changes
  useEffect(() => {
    if (!hasDocuments) {
      setUseKnowledge(false);
    } else {
      setUseKnowledge(true);
    }
  }, [hasDocuments, labelName]);

  const docNamesList = attachedDocs.length > 0
    ? attachedDocs.map((d) => d.fileName || d.title || "document").slice(0, 3).join(", ")
    : hasDocuments
    ? `${documentIds.length} attached ${documentIds.length === 1 ? "doc" : "docs"}`
    : "";

  const handleChipClick = (chipText) => {
    setInstruction((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return chipText;
      if (trimmed.toLowerCase().includes(chipText.toLowerCase())) return prev;
      return `${trimmed}, ${chipText.toLowerCase()}`;
    });
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (isLoading) return;
    onGenerate({
      instruction: instruction.trim(),
      useKnowledge: hasDocuments && useKnowledge,
    });
  };

  const getFriendlyError = (err) => {
    if (!err) return null;
    const msg = typeof err === "string" ? err : err.message || "";
    const code = err.code || "";
    if (code === "ai_unavailable" || msg.includes("unavailable") || msg.includes("Ollama")) {
      return "Local AI engine (Ollama) is unavailable or taking too long. Please verify that Ollama is running and try again.";
    }
    if (code === "invalid_output" || msg.includes("validation") || msg.includes("invented")) {
      return "The AI generated an invalid draft (e.g. invented specifics or formatting issue). The draft was left unchanged. Try adjusting your instruction.";
    }
    if (code === "stale_turn" || msg.includes("stale") || msg.includes("newer message")) {
      return "A new message arrived in this thread or the draft was changed elsewhere. Please refresh the page.";
    }
    if (code === "no_knowledge" || msg.includes("No matching knowledge")) {
      return "No matching knowledge was found in your documents for this instruction. Try turning off knowledge base or adding key facts directly to your instruction.";
    }
    return msg;
  };

  const friendlyError = getFriendlyError(error);

  const titleText = mode === "revise" ? "Revise with AI" : "Write with AI";

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 transition-all dark:border-indigo-900/60 dark:bg-indigo-950/20">
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between p-3.5 text-left text-xs font-semibold text-indigo-950 hover:bg-indigo-100/60 dark:text-indigo-200 dark:hover:bg-indigo-900/40"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-white shadow-xs dark:bg-indigo-500">
            <FiCpu className="h-3.5 w-3.5" />
          </div>
          <span className="font-bold text-slate-900 dark:text-slate-100">{titleText}</span>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300">
            {mode === "revise" ? "Current draft edit" : "Guided draft"}
          </span>
        </div>
        <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
          <span className="text-[11px] font-normal">{isOpen ? "Hide panel" : "Show panel"}</span>
          {isOpen ? <FiChevronUp className="h-4 w-4" /> : <FiChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {/* Expanded Panel Content */}
      {isOpen && (
        <form onSubmit={handleSubmit} className="border-t border-indigo-100 p-3.5 space-y-3 dark:border-indigo-900/50">
          {/* Quick chips */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Quick adjustments:
            </label>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => handleChipClick(chip)}
                  disabled={isLoading}
                  className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-800 shadow-2xs hover:border-indigo-300 hover:bg-indigo-50 focus:outline-hidden disabled:opacity-50 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-200 dark:hover:bg-indigo-950/50"
                >
                  +{chip}
                </button>
              ))}
            </div>
          </div>

          {/* Instruction textarea */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor="ai-assist-instruction" className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {mode === "revise" ? "What should AI change?" : "What should AI write?"}
              </label>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {instruction.length}/1000
              </span>
            </div>
            <textarea
              id="ai-assist-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value.slice(0, 1000))}
              disabled={isLoading}
              rows={3}
              placeholder={
                mode === "revise"
                  ? "e.g. Say I'm available Friday afternoon and ask for the agenda"
                  : "e.g. Confirm the demo for tomorrow 2pm and request participant count"
              }
              className="w-full resize-y rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>

          {/* Knowledge base choice */}
          <div className="rounded-lg border border-slate-200/80 bg-white/80 p-3 space-y-2 dark:border-slate-800 dark:bg-slate-900/60">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <FiBookOpen className="h-3.5 w-3.5 text-indigo-500" />
              <span>Knowledge Base Grounding</span>
            </div>

            <div className="space-y-2 text-xs">
              <label
                className={`flex items-start gap-2.5 ${
                  hasDocuments ? "cursor-pointer" : "cursor-not-allowed opacity-60"
                }`}
              >
                <input
                  type="radio"
                  name="knowledgeMode"
                  checked={useKnowledge && hasDocuments}
                  onChange={() => hasDocuments && setUseKnowledge(true)}
                  disabled={!hasDocuments || isLoading}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="space-y-0.5">
                  <div className="font-medium text-slate-800 dark:text-slate-200">
                    Use my knowledge base
                    {matchedLabel?.name ? ` ("${matchedLabel.name}"${docNamesList ? `: ${docNamesList}` : ""})` : ""}
                  </div>
                  {!hasDocuments && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      No knowledge documents attached to this category.{" "}
                      <Link to="/labels" className="font-semibold underline hover:text-amber-700">
                        Link documents in Labels
                      </Link>
                    </p>
                  )}
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="knowledgeMode"
                  checked={!useKnowledge || !hasDocuments}
                  onChange={() => setUseKnowledge(false)}
                  disabled={isLoading}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    Don't use my knowledge base
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Write strictly from my instructions and incoming thread context
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Status or Error Notice */}
          {statusNotice && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              <FiAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{statusNotice}</span>
            </div>
          )}

          {friendlyError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
              <FiXCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{friendlyError}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="submit"
              variant="primary"
              disabled={isLoading || (mode === "revise" && !instruction.trim())}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {isLoading ? (
                <>
                  <FiLoader className="h-3.5 w-3.5 animate-spin" />
                  {mode === "revise" ? "Revising Draft..." : "Writing Draft..."}
                </>
              ) : (
                <>
                  <FiEdit3 className="h-3.5 w-3.5" />
                  {mode === "revise" ? "Revise Draft" : "Generate Draft"}
                </>
              )}
            </Button>

            {isLoading && (
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
};
