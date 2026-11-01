import { useMemo, useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import { Button } from "../components/common/Button";
import { ErrorState } from "../components/common/States";

import { EmailActionFilters } from "../features/emailActions/EmailActionFilters";
import { EmailActionTable } from "../features/emailActions/EmailActionTable";
import { EmailActionDetail } from "../features/emailActions/EmailActionDetail";

import { useSyncStatus } from "../hooks/useSyncStatus";
import {
  useEmailActions,
  useEmailActionSummary,
  useSetEmailActionChecked,
  useSendEmailAction,
  useUpdateEmailActionDraft,
  useDeleteEmailActionDraft,
  useUpdateEmailActionLabel,
  useManualSendEmailAction,
  useTryAiDraftAction,
} from "../hooks/useEmailActions";

import {
  parseUrlParams,
  buildUrlParams,
  buildApiQueryParams,
} from "../utils/filterRules";

export const DraftReplyLogPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Synchronize filter state with URL query parameters
  const filters = useMemo(() => parseUrlParams(searchParams), [searchParams]);

  const setFilters = (updater) => {
    const nextFilters =
      typeof updater === "function" ? updater(filters) : updater;
    setSearchParams(buildUrlParams(nextFilters));
  };

  const [selected, setSelected] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const prevSyncRef = useRef(null);
  const prevTotalRef = useRef(null);

  const queryParams = useMemo(() => buildApiQueryParams(filters), [filters]);

  const summary = useEmailActionSummary();
  const actions = useEmailActions(queryParams);
  const syncStatus = useSyncStatus();

  const setChecked = useSetEmailActionChecked();
  const sendAction = useSendEmailAction();
  const updateDraft = useUpdateEmailActionDraft();
  const deleteDraft = useDeleteEmailActionDraft();
  const updateLabel = useUpdateEmailActionLabel();
  const manualSendAction = useManualSendEmailAction();
  const tryAiDraftAction = useTryAiDraftAction();

  // Auto-refresh: refetch list and summary badges whenever lastSyncAt or processed count changes
  useEffect(() => {
    const lastSync = syncStatus.data?.lastSync || syncStatus.data?.lastSyncAt;
    const processedCount = syncStatus.data?.processedCount;

    if (prevSyncRef.current !== null) {
      const syncChanged =
        lastSync && lastSync !== prevSyncRef.current.lastSync;
      const countChanged =
        processedCount !== undefined &&
        processedCount !== prevSyncRef.current.processedCount;

      if (syncChanged || countChanged) {
        actions.refetch();
        summary.refetch();
      }
    }

    prevSyncRef.current = { lastSync, processedCount };
  }, [
    syncStatus.data?.lastSync,
    syncStatus.data?.lastSyncAt,
    syncStatus.data?.processedCount,
    actions,
    summary,
  ]);

  // Toast / badge notification when new items arrive
  useEffect(() => {
    if (actions.data?.total !== undefined) {
      if (
        prevTotalRef.current !== null &&
        actions.data.total > prevTotalRef.current
      ) {
        const diff = actions.data.total - prevTotalRef.current;
        setToastMessage(`${diff} new email${diff > 1 ? "s" : ""} received`);
        const timer = setTimeout(() => setToastMessage(null), 4000);
        return () => clearTimeout(timer);
      }
      prevTotalRef.current = actions.data.total;
    }
  }, [actions.data?.total]);

  // Reset action mutations whenever the selected item changes so errors are never shared across drafts
  useEffect(() => {
    updateDraft.reset();
    sendAction.reset();
    deleteDraft.reset();
    updateLabel.reset();
    manualSendAction.reset();
    tryAiDraftAction.reset();
  }, [selected?._id]);

  const handleManualSend = (payload, callbacks) => {
    manualSendAction.mutate(payload, {
      onSuccess: (result) => {
        setSelected(result.action);
        callbacks?.onSuccess?.(result);
      },
    });
  };

  const handleTryAiDraft = (payload, callbacks) => {
    tryAiDraftAction.mutate(payload, {
      onSuccess: (result) => {
        setSelected(result.action);
        callbacks?.onSuccess?.(result);
      },
    });
  };

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
      onError: (err) => {
        callbacks?.onError?.(err);
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

  const toggleChecked = (item) => {
    setChecked.mutate(
      { id: item._id, checked: !item.checked },
      {
        onSuccess: (next) => setSelected(next),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-2xl">
            Drafts & Replies
          </h1>

          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Review generated responses and keep track of what still needs
            attention.
          </p>
        </div>

        {/* Slim refreshing indicator while fetching in background */}
        {actions.isFetching && !actions.isLoading && (
          <div className="flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50/70 px-3 py-1 text-xs font-medium text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-blue-600 dark:bg-blue-400" />
            <span>Updating...</span>
          </div>
        )}
      </div>

      {/* Header, tabs, search box and filters stay mounted at all times */}
      <EmailActionFilters
        filters={filters}
        setFilters={setFilters}
        summary={summary.data}
      />

      {/* Error state with Retry button */}
      {actions.isError ? (
        <ErrorState
          message="Could not load draft and reply log."
          onRetry={() => actions.refetch()}
        />
      ) : (
        <EmailActionTable
          items={actions.data?.items || []}
          selectedId={selected?._id}
          onSelect={setSelected}
          onToggleChecked={toggleChecked}
          isLoading={actions.isLoading && !actions.data}
          currentTab={filters.tab}
        />
      )}

      {/* Pagination & stats */}
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

      {/* Floating notification badge for new items */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg transition dark:bg-slate-100 dark:text-slate-900">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

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
        onManualSend={handleManualSend}
        isManualSending={manualSendAction.isPending}
        manualSendError={
          manualSendAction.error?.response?.data?.message ||
          manualSendAction.error?.message
        }
        onTryAiDraft={handleTryAiDraft}
        isTryingAiDraft={tryAiDraftAction.isPending}
        tryAiDraftError={
          tryAiDraftAction.error?.response?.data?.message ||
          tryAiDraftAction.error?.message
        }
      />
    </div>
  );
};
