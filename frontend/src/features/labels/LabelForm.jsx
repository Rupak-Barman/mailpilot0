import { useState } from "react";
import { FiPlus } from "react-icons/fi";
import { z } from "zod";
import { Button } from "../../components/common/Button";
import { Input, Select, Toggle } from "../../components/common/FormControls";
import { actionOptions, toneOptions } from "../../utils/constants";
import { titleCase } from "../../utils/formatters";
import { useCreateLabel } from "../../hooks/useLabels";

const labelSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40, "Name is too long"),
  actionType: z.enum(["reply", "draft", "none"]),
  tone: z.enum(["formal", "casual", "friendly"]),
  markAsRead: z.boolean()
});

export const LabelForm = () => {
  const [form, setForm] = useState({
    name: "",
    actionType: "none",
    tone: "friendly",
    markAsRead: true
  });
  const [error, setError] = useState("");
  const createLabel = useCreateLabel();

  const submit = () => {
    const parsed = labelSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Invalid label");
      return;
    }

    setError("");
    createLabel.mutate({
      name: parsed.data.name,
      tone: parsed.data.tone,
      markAsRead: parsed.data.markAsRead,
      action: { type: parsed.data.actionType }
    }, {
      onSuccess: () => setForm({
        name: "",
        actionType: "none",
        tone: "friendly",
        markAsRead: true
      })
    });
  };

  return (
    <div className="grid gap-3 border-b border-slate-200 p-3 dark:border-slate-800 lg:grid-cols-[1.3fr_1fr_1fr_auto_auto] lg:items-end">
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Label name</label>
        <Input
          value={form.name}
          onChange={(event) => setForm(current => ({ ...current, name: event.target.value }))}
          placeholder="VIP Clients"
          className="mt-2"
        />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Action</label>
        <Select
          value={form.actionType}
          onChange={(event) => setForm(current => ({
            ...current,
            actionType: event.target.value,
            markAsRead: event.target.value === "draft" ? false : current.markAsRead
          }))}
          className="mt-2"
        >
          {actionOptions.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}
        </Select>
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tone</label>
        <Select
          value={form.tone}
          onChange={(event) => setForm(current => ({ ...current, tone: event.target.value }))}
          className="mt-2"
        >
          {toneOptions.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}
        </Select>
      </div>
      <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-start">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Mark read</span>
        <Toggle
          checked={form.markAsRead}
          onChange={(checked) => setForm(current => ({ ...current, markAsRead: checked }))}
        />
      </div>
      <Button onClick={submit} disabled={createLabel.isPending}>
        <FiPlus className="h-4 w-4" />
        Add Label
      </Button>
      {(error || createLabel.error) && (
        <p className="text-sm text-rose-500 lg:col-span-5">{error || createLabel.error?.response?.data?.message || "Could not save label"}</p>
      )}
    </div>
  );
};
