import { useEffect, useState } from "react";
import { FiCheckSquare, FiTrash2, FiChevronDown } from "react-icons/fi";

import { Card } from "../../components/common/Card";
import { Badge } from "../../components/common/Badge";
import { Select, Toggle } from "../../components/common/FormControls";
import { EmptyState } from "../../components/common/States";

import { actionOptions, toneOptions } from "../../utils/constants";
import { titleCase } from "../../utils/formatters";

import { useDisableLabel, useUpdateLabel } from "../../hooks/useLabels";
import { usePersonas } from "../../hooks/usePersonas";
import { useKnowledgeFiles } from "../../hooks/useKnowledge";

import { LabelForm } from "./LabelForm";

const dotColors = [
  "bg-blue-400",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-blue-400",
  "bg-rose-400"
];

const DocumentMultiSelect = ({
  documents = [],
  value = [],
  onSave,
  labelName
}) => {
  const [selected, setSelected] = useState(value || []);

  useEffect(() => {
    setSelected(value || []);
  }, [value]);

  const allSelected =
    documents.length > 0 &&
    documents.every((doc) => selected.includes(doc.documentId));

  const selectedCount = documents.filter((doc) =>
    selected.includes(doc.documentId)
  ).length;

  const saveSelection = (nextSelection) => {
    setSelected(nextSelection);
    onSave(nextSelection);
  };

  const toggleDocument = (documentId, checked) => {
    let nextSelection;

    if (checked) {
      nextSelection = [...new Set([...selected, documentId])];
    } else {
      nextSelection = selected.filter((id) => id !== documentId);
    }

    saveSelection(nextSelection);
  };

  const toggleAll = (checked) => {
    const nextSelection = checked
      ? documents.map((doc) => doc.documentId)
      : [];

    saveSelection(nextSelection);
  };

  return (
    <details className="group relative w-64">
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:border-blue-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-200"
        aria-label={`Select knowledge bases for ${labelName}`}
      >
        <span className="truncate">
          {selectedCount === 0
            ? "Select knowledge bases"
            : `${selectedCount} of ${documents.length} selected`}
        </span>

        <FiChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>

      <div className="absolute left-0 top-full z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        {documents.length === 0 ? (
          <p className="px-2 py-3 text-xs text-slate-500">
            No knowledge bases uploaded yet.
          </p>
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border-b border-slate-100 px-2 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-zinc-800 dark:text-slate-100 dark:hover:bg-zinc-800">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => toggleAll(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />

              <span>
                Select all ({documents.length})
              </span>
            </label>

            <div className="space-y-1 pt-2">
              {documents.map((doc) => (
                <label
                  key={doc.documentId}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(doc.documentId)}
                    onChange={(event) =>
                      toggleDocument(
                        doc.documentId,
                        event.target.checked
                      )
                    }
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />

                  <span className="min-w-0 break-words text-slate-700 dark:text-slate-200">
                    {doc.displayName || doc.fileName}
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </details>
  );
};

export const LabelTable = ({ labels = [] }) => {
  const updateLabel = useUpdateLabel();
  const disableLabel = useDisableLabel();

  const { data: personas = [] } = usePersonas();
  const { data: documents = [] } = useKnowledgeFiles();

  const update = (label, payload) => {
    updateLabel.mutate({
      labelId: label._id || label.id,
      payload
    });
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <FiCheckSquare className="h-4 w-4 text-blue-500 dark:text-blue-300" />

          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Email Rules & Labels
          </h2>
        </div>

        <Badge tone="blue">
          {labels.filter((label) => label.enabled !== false).length} active
        </Badge>
      </div>

      <LabelForm />

      {labels.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No labels yet"
            description="Create your first rule to classify and handle incoming emails."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Label name</th>
                <th className="px-4 py-3">Default action</th>
                <th className="px-4 py-3">Tone</th>
                <th className="px-4 py-3">Grounding</th>
                <th className="px-4 py-3">Writing persona</th>
                <th className="px-4 py-3">Knowledge bases</th>
                <th className="px-4 py-3">Mark read</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {labels.map((label, index) => (
                <tr
                  key={label._id || label.id}
                  className="transition hover:bg-slate-50 dark:hover:bg-slate-900"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span
                        className={`h-3 w-3 rounded-full ${
                          dotColors[index % dotColors.length]
                        }`}
                      />

                      <span className="font-semibold text-slate-800 dark:text-slate-100">
                        {label.name}
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-2.5">
                    <Select
                      value={label.action?.type || "none"}
                      onChange={(event) =>
                        update(label, {
                          action: {
                            type: event.target.value
                          }
                        })
                      }
                    >
                      {actionOptions.map((option) => (
                        <option key={option} value={option}>
                          {titleCase(option)}
                        </option>
                      ))}
                    </Select>
                  </td>

                  <td className="px-4 py-2.5">
                    <Select
                      value={label.tone || "friendly"}
                      onChange={(event) =>
                        update(label, {
                          tone: event.target.value
                        })
                      }
                    >
                      {toneOptions.map((option) => (
                        <option key={option} value={option}>
                          {titleCase(option)}
                        </option>
                      ))}
                    </Select>
                  </td>

                  <td className="px-4 py-2.5">
                    <Select
                      value={
                        label.grounding ||
                        ((label.knowledgeDocumentIds?.length || 0) > 0 ? "strict" : "flexible")
                      }
                      onChange={(event) =>
                        update(label, {
                          grounding: event.target.value
                        })
                      }
                    >
                      <option value="strict">Strict (Docs)</option>
                      <option value="flexible">Flexible</option>
                    </Select>
                  </td>

                  <td className="px-4 py-2.5">
                    <Select
                      value={label.personaId || ""}
                      onChange={(event) =>
                        update(label, {
                          personaId: event.target.value
                        })
                      }
                    >
                      <option value="">Default persona</option>

                      {personas.map((persona) => (
                        <option key={persona._id} value={persona._id}>
                          {persona.name}
                        </option>
                      ))}
                    </Select>
                  </td>

                  <td className="px-4 py-2.5">
                    <DocumentMultiSelect
                      documents={documents}
                      value={label.knowledgeDocumentIds || []}
                      labelName={label.name}
                      onSave={(knowledgeDocumentIds) =>
                        update(label, { knowledgeDocumentIds })
                      }
                    />
                  </td>

                  <td className="px-4 py-2.5">
                    <Toggle
                      checked={label.markAsRead !== false}
                      onChange={(checked) =>
                        update(label, { markAsRead: checked })
                      }
                    />
                  </td>

                  <td className="px-4 py-2.5">
                    <Toggle
                      checked={label.enabled !== false}
                      onChange={(checked) =>
                        update(label, { enabled: checked })
                      }
                    />
                  </td>

                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Permanently delete routing rule "${label.name}"? This also attempts to delete its Gmail label.`
                          )
                        ) {
                          disableLabel.mutate(label._id || label.id);
                        }
                      }}
                      disabled={disableLabel.isPending}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-500"
                      aria-label="Delete routing rule"
                      title="Delete routing rule"
                    >
                      <FiTrash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(disableLabel.error || updateLabel.error) && (
        <p className="border-t border-rose-200 p-3 text-sm text-rose-600">
          {disableLabel.error?.response?.data?.message ||
            updateLabel.error?.response?.data?.message ||
            "Could not save the routing rule change."}
        </p>
      )}
    </Card>
  );
};