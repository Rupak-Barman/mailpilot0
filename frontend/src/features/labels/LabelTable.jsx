import { useState, useMemo } from "react";
import {
  FiGitCommit,
  FiPlus,
  FiEdit2,
  FiTrash2,
  FiLoader,
  FiFileText,
  FiCheckCircle,
  FiAlertCircle
} from "react-icons/fi";
import clsx from "clsx";

import { Card } from "../../components/common/Card";
import { Badge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { Toggle } from "../../components/common/FormControls";
import { EmptyState } from "../../components/common/States";

import {
  useCreateLabel,
  useDisableLabel,
  useLabels,
  useUpdateLabel
} from "../../hooks/useLabels";
import { usePersonas } from "../../hooks/usePersonas";
import { useKnowledgeFiles } from "../../hooks/useKnowledge";

import { RuleDrawer } from "./RuleDrawer";
import { DeleteRuleDialog } from "./DeleteRuleDialog";
import { RULE_COLOR_PALETTE, applyOptimisticUpdate } from "./ruleLogic";

export const LabelTable = ({ labels: propsLabels = [], isLoading: propsIsLoading }) => {
  // Queries
  const { data: fetchedLabels, isLoading: queryIsLoading } = useLabels();
  const { data: personas = [] } = usePersonas();
  const { data: documents = [] } = useKnowledgeFiles();

  // Mutations
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const disableLabel = useDisableLabel();

  // Prefer fetchedLabels if query resolved, otherwise propsLabels
  const baseLabels = fetchedLabels || propsLabels || [];
  const isLoading = propsIsLoading || (queryIsLoading && baseLabels.length === 0);

  // Optimistic overrides for inline quick edits
  const [optimisticOverrides, setOptimisticOverrides] = useState({});
  const [savingQuickEdits, setSavingQuickEdits] = useState({});

  // Toast / feedback notification state
  const [toast, setToast] = useState(null);

  // Modal / Drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [deletingRule, setDeletingRule] = useState(null);

  // Apply optimistic overrides on top of base server labels
  const labels = useMemo(() => {
    return baseLabels.map((label) => {
      const id = label._id || label.id;
      if (optimisticOverrides[id]) {
        return { ...label, ...optimisticOverrides[id] };
      }
      return label;
    });
  }, [baseLabels, optimisticOverrides]);

  // Fast lookups for document names and persona names
  const documentMap = useMemo(() => {
    const map = new Map();
    for (const doc of documents) {
      map.set(doc.documentId, doc.displayName || doc.fileName || "Document");
    }
    return map;
  }, [documents]);

  const personaMap = useMemo(() => {
    const map = new Map();
    for (const p of personas) {
      map.set(p._id || p.id, p.name);
    }
    return map;
  }, [personas]);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 3500);
  };

  // Open Drawer in Add mode
  const handleOpenAdd = () => {
    setEditingRule(null);
    setIsDrawerOpen(true);
  };

  // Open Drawer in Edit mode
  const handleOpenEdit = (rule) => {
    setEditingRule(rule);
    setIsDrawerOpen(true);
  };

  // Save from drawer (either create or update)
  const handleSaveRule = (payload, { onError }) => {
    if (editingRule) {
      const ruleId = editingRule._id || editingRule.id;
      updateLabel.mutate(
        { labelId: ruleId, payload },
        {
          onSuccess: () => {
            setIsDrawerOpen(false);
            setEditingRule(null);
            showToast(`Rule "${payload.name}" updated successfully.`);
          },
          onError: (err) => {
            onError?.(err);
          }
        }
      );
    } else {
      createLabel.mutate(payload, {
        onSuccess: () => {
          setIsDrawerOpen(false);
          showToast(`Rule "${payload.name}" created successfully.`);
        },
        onError: (err) => {
          onError?.(err);
        }
      });
    }
  };

  // Quick inline edit: Action select
  const handleInlineActionChange = (label, newActionType) => {
    const id = label._id || label.id;
    const previousAction = label.action?.type || "none";
    if (previousAction === newActionType) return;

    // Apply optimistic update immediately
    setOptimisticOverrides((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        action: { ...(label.action || {}), type: newActionType }
      }
    }));
    setSavingQuickEdits((prev) => ({ ...prev, [id]: true }));

    updateLabel.mutate(
      {
        labelId: id,
        payload: { action: { type: newActionType } }
      },
      {
        onSuccess: () => {
          setSavingQuickEdits((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          showToast(`Updated action for "${label.name}".`);
        },
        onError: (err) => {
          // Rollback optimistic override
          setOptimisticOverrides((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setSavingQuickEdits((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          showToast(
            err?.response?.data?.message || `Failed to update action for "${label.name}".`,
            "error"
          );
        }
      }
    );
  };

  // Quick inline edit: Status toggle
  const handleInlineStatusToggle = (label, newStatus) => {
    const id = label._id || label.id;

    // Apply optimistic update immediately
    setOptimisticOverrides((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), enabled: newStatus }
    }));
    setSavingQuickEdits((prev) => ({ ...prev, [id]: true }));

    updateLabel.mutate(
      {
        labelId: id,
        payload: { enabled: newStatus }
      },
      {
        onSuccess: () => {
          setSavingQuickEdits((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          showToast(`Rule "${label.name}" ${newStatus ? "enabled" : "disabled"}.`);
        },
        onError: (err) => {
          // Rollback optimistic override
          setOptimisticOverrides((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setSavingQuickEdits((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          showToast(
            err?.response?.data?.message || `Failed to update status for "${label.name}".`,
            "error"
          );
        }
      }
    );
  };

  // Delete rule
  const handleConfirmDelete = () => {
    if (!deletingRule) return;
    const id = deletingRule._id || deletingRule.id;
    const name = deletingRule.name;

    disableLabel.mutate(id, {
      onSuccess: () => {
        setDeletingRule(null);
        showToast(`Rule "${name}" deleted.`);
      },
      onError: (err) => {
        showToast(
          err?.response?.data?.message || `Failed to delete rule "${name}".`,
          "error"
        );
      }
    });
  };

  // Count active rules
  const activeCount = labels.filter((l) => l.enabled !== false).length;

  return (
    <Card className="overflow-hidden">
      {/* Table Header */}
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
            <FiGitCommit className="h-5 w-5" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Routing Rules
              </h2>
              <Badge tone="blue">
                {activeCount} active
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Classify incoming emails and trigger automated drafting or replies.
            </p>
          </div>
        </div>

        <Button
          variant="primary"
          onClick={handleOpenAdd}
          className="self-start sm:self-center"
        >
          <FiPlus className="h-4 w-4" />
          Add rule
        </Button>
      </div>

      {/* Toast Notification (aria-live region) */}
      <div aria-live="polite" className="px-4">
        {toast && (
          <div
            className={clsx(
              "mt-3 flex items-center gap-2 rounded-lg p-2.5 text-xs font-medium animate-in fade-in duration-200",
              toast.type === "error"
                ? "bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/40"
                : "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/40"
            )}
          >
            {toast.type === "error" ? (
              <FiAlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            ) : (
              <FiCheckCircle className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            )}
            <span>{toast.message}</span>
          </div>
        )}
      </div>

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="p-4 space-y-3" role="status" aria-label="Loading routing rules">
          <span className="sr-only">Loading routing rules...</span>
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-14 rounded-lg bg-slate-100 dark:bg-zinc-800/60 animate-pulse"
            />
          ))}
        </div>
      ) : labels.length === 0 ? (
        /* Empty State */
        <div className="p-6 text-center">
          <EmptyState
            title="No rules yet, add your first rule"
            description="Create routing rules to classify incoming emails and automatically create drafts or replies."
          />
          <div className="mt-4">
            <Button variant="primary" onClick={handleOpenAdd}>
              <FiPlus className="h-4 w-4" />
              Add rule
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* DESKTOP TABLE (Hidden on mobile, self-contained scroll) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400 dark:border-zinc-800 dark:text-slate-500 bg-slate-50/50 dark:bg-zinc-900/50">
                <tr>
                  <th scope="col" className="px-4 py-3 min-w-[200px]">
                    Label
                  </th>
                  <th scope="col" className="px-4 py-3 min-w-[140px]">
                    Action
                  </th>
                  <th scope="col" className="px-4 py-3 min-w-[110px]">
                    Grounding
                  </th>
                  <th scope="col" className="px-4 py-3 min-w-[220px]">
                    Knowledge bases
                  </th>
                  <th scope="col" className="px-4 py-3 min-w-[140px]">
                    Persona
                  </th>
                  <th scope="col" className="px-4 py-3 min-w-[90px]">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 min-w-[100px] text-right">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                {labels.map((label, index) => {
                  const id = label._id || label.id;
                  const isQuickSaving = Boolean(savingQuickEdits[id]);
                  const actionType = label.action?.type || "none";
                  const isActionNone = actionType === "none";
                  const ruleColor =
                    label.color ||
                    RULE_COLOR_PALETTE[index % RULE_COLOR_PALETTE.length].hex;
                  const docIds = label.knowledgeDocumentIds || [];
                  const personaName = label.personaId
                    ? personaMap.get(label.personaId) || "Default"
                    : "Default";

                  return (
                    <tr
                      key={id}
                      className={clsx(
                        "transition-colors hover:bg-slate-50/70 dark:hover:bg-zinc-800/40",
                        label.enabled === false && "opacity-60 bg-slate-50/30 dark:bg-zinc-900/30"
                      )}
                    >
                      {/* Column 1: Colour dot and name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full shadow-xs ring-1 ring-black/10"
                            style={{ backgroundColor: ruleColor }}
                            aria-hidden="true"
                          />
                          <span
                            className="font-semibold text-slate-900 dark:text-slate-100 break-words"
                            title={label.name}
                          >
                            {label.name}
                          </span>
                        </div>
                      </td>

                      {/* Column 2: Action (compact select with inline quick edit) */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={actionType}
                            aria-label={`Action for ${label.name}`}
                            disabled={isQuickSaving}
                            onChange={(e) =>
                              handleInlineActionChange(label, e.target.value)
                            }
                            className="rounded-md border border-slate-200 bg-white py-1 px-2 text-xs font-medium text-slate-800 outline-none transition hover:border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-200 cursor-pointer"
                          >
                            <option value="none">None (Label only)</option>
                            <option value="draft">Draft (Review)</option>
                            <option value="reply">Reply (Auto-send)</option>
                          </select>
                          {isQuickSaving && (
                            <FiLoader className="h-3.5 w-3.5 animate-spin text-blue-500" />
                          )}
                        </div>
                      </td>

                      {/* Column 3: Grounding (badge) */}
                      <td className="px-4 py-3">
                        {isActionNone ? (
                          <span className="text-xs text-slate-400" title="Not used for action None">
                            —
                          </span>
                        ) : label.grounding === "strict" ? (
                          <Badge
                            tone="blue"
                            title="Strict: Only replies from selected documents"
                          >
                            Strict
                          </Badge>
                        ) : (
                          <Badge
                            tone="amber"
                            title="Flexible: General acknowledgements permitted"
                          >
                            Flexible
                          </Badge>
                        )}
                      </td>

                      {/* Column 4: Knowledge bases (chips with overflow) */}
                      <td className="px-4 py-3">
                        {isActionNone ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : docIds.length === 0 ? (
                          <span className="text-xs text-slate-400">None</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {docIds.slice(0, 2).map((docId) => {
                              const docName = documentMap.get(docId) || "Doc";
                              return (
                                <span
                                  key={docId}
                                  title={docName}
                                  className="inline-flex max-w-[130px] items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 truncate dark:bg-zinc-800 dark:text-slate-300"
                                >
                                  <FiFileText className="h-3 w-3 shrink-0 text-slate-400" />
                                  <span className="truncate">{docName}</span>
                                </span>
                              );
                            })}
                            {docIds.length > 2 && (
                              <span
                                title={docIds.map((id) => documentMap.get(id) || id).join(", ")}
                                className="inline-flex items-center rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-zinc-700 dark:text-slate-200 cursor-help"
                              >
                                +{docIds.length - 2} more
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Column 5: Persona */}
                      <td className="px-4 py-3">
                        {isActionNone ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          <span
                            className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate block max-w-[140px]"
                            title={personaName}
                          >
                            {personaName}
                          </span>
                        )}
                      </td>

                      {/* Column 6: Status toggle */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Toggle
                            checked={label.enabled !== false}
                            disabled={isQuickSaving}
                            onChange={(checked) =>
                              handleInlineStatusToggle(label, checked)
                            }
                          />
                        </div>
                      </td>

                      {/* Column 7: Actions (Edit, Delete) */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(label)}
                            aria-label={`Edit ${label.name}`}
                            title="Edit rule"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-zinc-800 dark:hover:text-slate-200 transition cursor-pointer"
                          >
                            <FiEdit2 className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeletingRule(label)}
                            aria-label={`Delete ${label.name}`}
                            title="Delete rule"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition cursor-pointer"
                          >
                            <FiTrash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* MOBILE VIEW: CARDS (Visible only on < md screens, 360px safe) */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-zinc-800">
            {labels.map((label, index) => {
              const id = label._id || label.id;
              const isQuickSaving = Boolean(savingQuickEdits[id]);
              const actionType = label.action?.type || "none";
              const isActionNone = actionType === "none";
              const ruleColor =
                label.color ||
                RULE_COLOR_PALETTE[index % RULE_COLOR_PALETTE.length].hex;
              const docIds = label.knowledgeDocumentIds || [];
              const personaName = label.personaId
                ? personaMap.get(label.personaId) || "Default"
                : "Default";

              return (
                <div
                  key={id}
                  className={clsx(
                    "p-4 space-y-3",
                    label.enabled === false && "opacity-60 bg-slate-50/50 dark:bg-zinc-900/30"
                  )}
                >
                  {/* Card Header: Color, Name, Status Toggle */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full shadow-xs ring-1 ring-black/10"
                        style={{ backgroundColor: ruleColor }}
                        aria-hidden="true"
                      />
                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {label.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Toggle
                        checked={label.enabled !== false}
                        disabled={isQuickSaving}
                        onChange={(checked) =>
                          handleInlineStatusToggle(label, checked)
                        }
                      />
                    </div>
                  </div>

                  {/* Card Body: Action & Grounding */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Action:</span>
                      <select
                        value={actionType}
                        disabled={isQuickSaving}
                        onChange={(e) =>
                          handleInlineActionChange(label, e.target.value)
                        }
                        className="rounded border border-slate-200 bg-white py-0.5 px-1.5 text-xs text-slate-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-200"
                      >
                        <option value="none">None</option>
                        <option value="draft">Draft</option>
                        <option value="reply">Reply</option>
                      </select>
                    </div>

                    {!isActionNone && (
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400">Grounding:</span>
                        {label.grounding === "strict" ? (
                          <Badge tone="blue">Strict</Badge>
                        ) : (
                          <Badge tone="amber">Flexible</Badge>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Card Knowledge bases & Persona */}
                  {!isActionNone && (
                    <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400 border-t border-slate-100 pt-2 dark:border-zinc-800/80">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400">Persona:</span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {personaName}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-slate-400">Docs:</span>
                        {docIds.length === 0 ? (
                          <span>None</span>
                        ) : (
                          docIds.map((docId) => (
                            <span
                              key={docId}
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700 dark:bg-zinc-800 dark:text-slate-300 truncate max-w-[120px]"
                            >
                              {documentMap.get(docId) || "Doc"}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* Card Actions: Edit & Delete buttons */}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      variant="ghost"
                      onClick={() => handleOpenEdit(label)}
                      className="text-xs h-7"
                    >
                      <FiEdit2 className="h-3 w-3" />
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => setDeletingRule(label)}
                      className="text-xs h-7"
                    >
                      <FiTrash2 className="h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Side Drawer for Add / Edit */}
      <RuleDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setEditingRule(null);
        }}
        initialData={editingRule}
        existingLabels={labels}
        personas={personas}
        documents={documents}
        onSave={handleSaveRule}
        isSaving={createLabel.isPending || updateLabel.isPending}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteRuleDialog
        isOpen={Boolean(deletingRule)}
        rule={deletingRule}
        onClose={() => setDeletingRule(null)}
        onConfirm={handleConfirmDelete}
        isDeleting={disableLabel.isPending}
      />
    </Card>
  );
};
