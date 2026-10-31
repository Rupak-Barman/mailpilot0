import { useEffect, useState } from "react";
import { FiCheckSquare, FiTrash2 } from "react-icons/fi";
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

const dotColors = ["bg-blue-400", "bg-emerald-400", "bg-amber-400", "bg-blue-400", "bg-rose-400"];

const DocumentMultiSelect = ({ documents, value = [], onSave, labelName }) => {
  const [selected, setSelected] = useState(value);
  useEffect(() => setSelected(value || []), [value]);
  return (
    <>
      <select multiple value={selected} onChange={(event) => setSelected(Array.from(event.target.selectedOptions, option => option.value))}
        onBlur={() => { if (JSON.stringify(selected) !== JSON.stringify(value || [])) onSave(selected); }}
        className="w-56 min-h-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-100"
        aria-label={`Knowledge documents for ${labelName}`}>
        {documents.map(doc => <option key={doc.documentId} value={doc.documentId}>{doc.fileName}</option>)}
      </select>
      <p className="mt-1 text-[10px] text-slate-400">Ctrl/Cmd-click to select multiple; click elsewhere to save</p>
    </>
  );
};


export const LabelTable = ({ labels = [] }) => {
  const updateLabel = useUpdateLabel();
  const disableLabel = useDisableLabel();
  const { data: personas = [] } = usePersonas();
  const { data: documents = [] } = useKnowledgeFiles();

  const update = (label, payload) => {
    updateLabel.mutate({ labelId: label._id || label.id, payload });
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <FiCheckSquare className="h-4 w-4 text-blue-500 dark:text-blue-300" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Email Rules & Labels</h2>
        </div>
        <Badge tone="blue">{labels.filter(label => label.enabled !== false).length} active</Badge>
      </div>

      <LabelForm />

      {labels.length === 0 ? (
        <div className="p-4">
          <EmptyState title="No labels yet" description="Create your first rule to classify and handle incoming emails." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Label name</th>
                <th className="px-4 py-3">Default action</th>
                <th className="px-4 py-3">Tone</th>
                <th className="px-4 py-3">Writing persona</th>
                <th className="px-4 py-3">Knowledge documents</th>
                <th className="px-4 py-3">Mark read</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {labels.map((label, index) => (
                <tr key={label._id || label.id} className="transition hover:bg-slate-50 dark:hover:bg-slate-900">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className={`h-3 w-3 rounded-full ${dotColors[index % dotColors.length]}`} />
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{label.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Select
                      value={label.action?.type || "none"}
                      onChange={(event) => update(label, { action: { type: event.target.value } })}
                    >
                      {actionOptions.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}
                    </Select>
                  </td>
                  <td className="px-4 py-2.5">
                    <Select
                      value={label.tone || "friendly"}
                      onChange={(event) => update(label, { tone: event.target.value })}
                    >
                      {toneOptions.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}
                    </Select>
                  </td>
                  <td className="px-4 py-2.5">
                    <Select value={label.personaId || ""} onChange={(event) => update(label, { personaId: event.target.value })}>
                      <option value="">Default persona</option>
                      {personas.map(persona => <option key={persona._id} value={persona._id}>{persona.name}</option>)}
                    </Select>
                  </td>
                  <td className="px-4 py-2.5">
                    <DocumentMultiSelect documents={documents} value={label.knowledgeDocumentIds || []} labelName={label.name} onSave={(knowledgeDocumentIds) => update(label, { knowledgeDocumentIds })} />
                  </td>
                  <td className="px-4 py-2.5">
                    <Toggle
                      checked={label.markAsRead !== false}
                      onChange={(checked) => update(label, { markAsRead: checked })}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <Toggle
                      checked={label.enabled !== false}
                      onChange={(checked) => update(label, { enabled: checked })}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Permanently delete routing rule “${label.name}”? This also attempts to delete its Gmail label.`)) {
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
      {(disableLabel.error || updateLabel.error) && <p className="border-t border-rose-200 p-3 text-sm text-rose-600">{disableLabel.error?.response?.data?.message || updateLabel.error?.response?.data?.message || "Could not save the routing rule change."}</p>}
    </Card>
  );
};
