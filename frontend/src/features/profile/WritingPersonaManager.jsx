import { useState } from "react";

import { Card } from "../../components/common/Card";
import { Input, Textarea } from "../../components/common/FormControls";
import { Button } from "../../components/common/Button";

import {
  usePersonas,
  useCreatePersona,
  useUpdatePersona,
  useDeletePersona
} from "../../hooks/usePersonas";

const blank = {
  name: "",
  instructions: "",
  signature: ""
};

export const WritingPersonaManager = () => {
  const {
    data: personas = [],
    isLoading
  } = usePersonas();

  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState("");

  const create = useCreatePersona();
  const update = useUpdatePersona();
  const remove = useDeletePersona();

  const isSaving = create.isPending || update.isPending;

  const save = () => {
    if (!form.name.trim()) {
      return;
    }

    const payload = {
      name: form.name.trim(),
      instructions: form.instructions.trim(),
      signature: form.signature.trim()
    };

    const onSuccess = () => {
      setForm(blank);
      setEditing("");
    };

    if (editing) {
      update.mutate(
        {
          personaId: editing,
          payload
        },
        { onSuccess }
      );
    } else {
      create.mutate(payload, { onSuccess });
    }
  };

  const edit = (persona) => {
    setEditing(persona._id);

    setForm({
      name: persona.name || "",
      instructions: persona.instructions || "",
      signature: persona.signature || ""
    });
  };

  const cancelEdit = () => {
    setEditing("");
    setForm(blank);
  };

  const updateField = (field, value) => {
    setForm((previous) => ({
      ...previous,
      [field]: value
    }));
  };

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">
          Writing Personas
        </h2>

        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Create different writing styles and assign one to each routing rule.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="text-xs font-semibold uppercase text-slate-400">
            Persona name
          </label>

          <Input
            className="mt-1"
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            placeholder="Professional"
            maxLength={80}
          />
        </div>

        <div className="md:col-span-2">
          <label className="text-xs font-semibold uppercase text-slate-400">
            Writing instructions
          </label>

          <Textarea
            className="mt-1"
            value={form.instructions}
            onChange={(event) =>
              updateField("instructions", event.target.value)
            }
            placeholder="Be concise, confident, and polite. Use natural language..."
            rows={4}
            maxLength={4000}
          />
        </div>

        <div className="md:col-span-2">
          <label className="text-xs font-semibold uppercase text-slate-400">
            Signature (optional)
          </label>

          <Input
            className="mt-1"
            value={form.signature}
            onChange={(event) =>
              updateField("signature", event.target.value)
            }
            placeholder="Best regards, ..."
            maxLength={1000}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={isSaving || !form.name.trim()}>
          {isSaving
            ? "Saving..."
            : editing
              ? "Save changes"
              : "Add persona"}
        </Button>

        {editing && (
          <Button variant="subtle" onClick={cancelEdit}>
            Cancel
          </Button>
        )}
      </div>

      {(create.error || update.error) && (
        <p className="text-sm text-rose-500">
          {create.error?.response?.data?.message ||
            update.error?.response?.data?.message ||
            "Could not save persona."}
        </p>
      )}

      <div className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-slate-500">
            Loading personas...
          </p>
        ) : personas.length === 0 ? (
          <p className="text-sm text-slate-500">
            No writing personas created yet.
          </p>
        ) : (
          personas.map((persona) => (
            <div
              key={persona._id}
              className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {persona.name}
                </p>

                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-500 dark:text-slate-400">
                  {persona.instructions || "No custom instructions"}
                </p>

                {persona.signature && (
                  <p className="mt-1 text-xs text-slate-400">
                    Signature: {persona.signature}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 gap-2">
                <Button onClick={() => edit(persona)}>
                  Edit
                </Button>

                <Button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete persona "${persona.name}"?`
                      )
                    ) {
                      remove.mutate(persona._id);
                    }
                  }}
                  disabled={remove.isPending}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {remove.error && (
        <p className="text-sm text-rose-500">
          {remove.error.response?.data?.message ||
            "Could not delete persona."}
        </p>
      )}
    </Card>
  );
};