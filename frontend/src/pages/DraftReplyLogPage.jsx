import { useMemo, useState } from "react";

import { Button } from "../components/common/Button";
import { LoadingState, ErrorState } from "../components/common/States";

import { EmailActionFilters } from "../features/emailActions/EmailActionFilters";
import { EmailActionTable } from "../features/emailActions/EmailActionTable";
import { EmailActionDetail } from "../features/emailActions/EmailActionDetail";

import {
  useEmailActions,
  useEmailActionSummary,
  useSetEmailActionChecked,
  useSendEmailAction,
  useUpdateEmailActionDraft,
  useDeleteEmailActionDraft,
  useUpdateEmailActionLabel,
} from "../hooks/useEmailActions";

export const DraftReplyLogPage = () => {
  const [filters, setFilters] = useState({
    tab: "unchecked",
    checked: "",
    q: "",
    page: 1,
    limit: 20,
  });

  const [selected, setSelected] = useState(null);

  const summary = useEmailActionSummary();
  const setChecked = useSetEmailActionChecked();
  const sendAction = useSendEmailAction();
  const updateDraft = useUpdateEmailActionDraft();
  const deleteDraft = useDeleteEmailActionDraft();
  const updateLabel = useUpdateEmailActionLabel();

  const updateDraftLabel = (item, label, onSuccess) => {
    updateLabel.mutate(
      { id: item._id, label },
      {
        onSuccess: (result) => {
          setSelected(result.action);
          onSuccess?.();
        },
      },
    );
  };

  const sendDraft = (item) => {
    const confirmed = window.confirm(
      `Are you sure you want to send this email to ${item.to}?`,
    );

    if (!confirmed) return;

    sendAction.mutate(
      { id: item._id },
      {
        onSuccess: (result) => {
          setSelected(result.action);
        },
      },
    );
  };

  const handleUpdateDraft = (payload, callbacks) => {
    updateDraft.mutate(payload, {
      onSuccess: (result) => {
        setSelected(result.action);
        callbacks?.onSuccess?.(result);
      },
    });
  };

  const handleDeleteDraft = (payload) => {
    deleteDraft.mutate(payload, {
      onSuccess: () => {
        setSelected(null);
      },
    });
  };

  const queryParams = useMemo(() => {
    const params = {
      page: filters.page,
      limit: filters.limit,
    };

    if (filters.q) params.q = filters.q;
    if (filters.checked) params.checked = filters.checked;
    if (filters.tab === "unchecked") params.checked = "false";
    if (filters.tab === "draft") params.type = "draft";
    if (filters.tab === "reply") params.type = "reply";

    return params;
  }, [filters]);

  const actions = useEmailActions(queryParams);

  const toggleChecked = (item) => {
    setChecked.mutate(
      { id: item._id, checked: !item.checked },
      {
        onSuccess: (next) => setSelected(next),
      },
    );
  };

  if (actions.isLoading || summary.isLoading) {
    return <LoadingState label="Loading draft and reply log" />;
  }

  if (actions.error) {
    return <ErrorState message="Could not load draft and reply log." />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-2xl">
          Drafts & Replies
        </h1>

        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Review generated responses and keep track of what still needs
          attention.
        </p>
      </div>

      <EmailActionFilters
        filters={filters}
        setFilters={setFilters}
        summary={summary.data}
      />

      <EmailActionTable
        items={actions.data?.items || []}
        selectedId={selected?._id}
        onSelect={setSelected}
      />

      <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
        <span>{actions.data?.total || 0} records</span>

        <div className="flex gap-2">
          <Button
            variant="ghost"
            disabled={filters.page <= 1}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                page: current.page - 1,
              }))
            }
          >
            Previous
          </Button>

          <Button
            variant="ghost"
            disabled={filters.page >= (actions.data?.pages || 1)}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                page: current.page + 1,
              }))
            }
          >
            Next
          </Button>
        </div>
      </div>

      <EmailActionDetail
        item={selected}
        onClose={() => setSelected(null)}
        onToggleChecked={toggleChecked}
        isSaving={setChecked.isPending}
        onSendDraft={sendDraft}
        isSending={sendAction.isPending}
        sendError={
          sendAction.error?.response?.data?.message || sendAction.error?.message
        }
        onUpdateDraft={handleUpdateDraft}
        isUpdatingDraft={updateDraft.isPending}
        updateError={
          updateDraft.error?.response?.data?.message ||
          updateDraft.error?.message
        }
        onDeleteDraft={handleDeleteDraft}
        isDeletingDraft={deleteDraft.isPending}
        deleteError={
          deleteDraft.error?.response?.data?.message ||
          deleteDraft.error?.message
        }

        onUpdateLabel={updateDraftLabel}
        isUpdatingLabel={updateLabel.isPending}
        labelError={
          updateLabel.error?.response?.data?.message ||
          updateLabel.error?.message
        }
      />
    </div>
  );
};
