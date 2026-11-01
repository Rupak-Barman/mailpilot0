import { useState } from "react";
import { FiPlus } from "react-icons/fi";
import { z } from "zod";
import { Button } from "../../components/common/Button";
import { Input, Select, Toggle } from "../../components/common/FormControls";
import { EmailChipInput } from "../../components/common/EmailChipInput";
import { actionOptions, toneOptions } from "../../utils/constants";
import { titleCase } from "../../utils/formatters";
import { useCreateLabel } from "../../hooks/useLabels";

const labelSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40, "Name is too long"),
  actionType: z.enum(["reply", "draft", "none"]),
  tone: z.enum(["formal", "casual", "friendly"]),
  grounding: z.enum(["strict", "flexible"]),
  markAsRead: z.boolean(),
});

export const LabelForm = () => {
  const [form, setForm] = useState({
    name: "",
    actionType: "none",
    tone: "friendly",
    grounding: "flexible",
    markAsRead: true,
    alwaysCc: [],
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
    createLabel.mutate(
      {
        name: parsed.data.name,
        tone: parsed.data.tone,
        grounding: parsed.data.grounding,
        markAsRead: parsed.data.markAsRead,
        action: { type: parsed.data.actionType },
        alwaysCc: (form.alwaysCc || []).map((c) =>
          typeof c === "object" ? c.email : c
        ),
      },
      {
        onSuccess: () =>
          setForm({
            name: "",
            actionType: "none",
            tone: "friendly",
            grounding: "flexible",
            markAsRead: true,
            alwaysCc: [],
          }),
      }
    );
  };

  return (
    <div className="space-y-3 border-b border-slate-200 p-3 dark:border-slate-800">
      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.9fr_0.9fr_1.5fr_auto_auto] lg:items-end">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Label name
          </label>
          <Input
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="VIP Clients"
            className="mt-2"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Action
          </label>
          <Select
            value={form.actionType}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                actionType: event.target.value,
                markAsRead:
                  event.target.value === "draft" ? false : current.markAsRead,
              }))
            }
            className="mt-2"
          >
            {actionOptions.map((option) => (
              <option key={option} value={option}>
                {titleCase(option)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Tone
          </label>
          <Select
            value={form.tone}
            onChange={(event) =>
              setForm((current) => ({ ...current, tone: event.target.value }))
            }
            className="mt-2"
          >
            {toneOptions.map((option) => (
              <option key={option} value={option}>
                {titleCase(option)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Grounding
            </label>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              (Default: Flexible)
            </span>
          </div>
          <Select
            value={form.grounding}
            onChange={(event) =>
              setForm((current) => ({ ...current, grounding: event.target.value }))
            }
            className="mt-2"
          >
            <option value="strict">Strict: only reply from my documents</option>
            <option value="flexible">Flexible: polite acknowledgements only</option>
          </Select>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Strict requires document matches. Flexible allows polite acknowledgements.
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-start">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Mark read
          </span>
          <Toggle
            checked={form.markAsRead}
            onChange={(checked) =>
              setForm((current) => ({ ...current, markAsRead: checked }))
            }
          />
        </div>
        <Button onClick={submit} disabled={createLabel.isPending}>
          <FiPlus className="h-4 w-4" />
          Add Label
        </Button>
      </div>

      {/* Always CC field */}
      <div className="border-t border-slate-100 pt-3 dark:border-zinc-800">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Always CC
        </label>
        <EmailChipInput
          value={form.alwaysCc}
          onChange={(next) => setForm((c) => ({ ...c, alwaysCc: next }))}
          placeholder="Always CC these email addresses when this rule triggers..."
          className="mt-1"
        />
      </div>

      {(error || createLabel.error) && (
        <p className="text-sm text-rose-500">
          {error ||
            createLabel.error?.response?.data?.message ||
            "Could not save label"}
        </p>
      )}
    </div>
  );
};
