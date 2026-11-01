import { useEffect, useRef, useState } from "react";

import {
  FiArrowLeft,
  FiCheckCircle,
  FiFileText,
  FiCornerUpLeft,
  FiX,
  FiSend,
  FiEdit2,
  FiTrash2,
  FiSave,
  FiInfo,
  FiChevronDown,
  FiChevronUp,
  FiExternalLink,
  FiAlertTriangle,
  FiCpu,
} from "react-icons/fi";

import { Button } from "../../components/common/Button";
import { Badge } from "../../components/common/Badge";
import { formatDateTime, titleCase } from "../../utils/formatters";
import { getFailureReasonLabel } from "./EmailActionTable";

export const EmailActionDetail = ({
  item,
  onClose,
  onToggleChecked,
  isSaving,
  onSendDraft,
  isSending,
  sendError,
  onUpdateDraft,
  isUpdatingDraft,
  updateError,
  onDeleteDraft,
  isDeletingDraft,
  deleteError,
  onUpdateLabel,
  isUpdatingLabel,
  labelError,
  onManualSend,
  isManualSending,
  manualSendError,
  onTryAiDraft,
  isTryingAiDraft,
  tryAiDraftError,
}) => (
  <>
    {item && (
      <EmailActionDetailContent
        key={item._id}
        item={item}
        onClose={onClose}
        onToggleChecked={onToggleChecked}
        isSaving={isSaving}
        onSendDraft={onSendDraft}
        isSending={isSending}
        sendError={sendError}
        onUpdateDraft={onUpdateDraft}
        isUpdatingDraft={isUpdatingDraft}
        updateError={updateError}
        onDeleteDraft={onDeleteDraft}
        isDeletingDraft={isDeletingDraft}
        deleteError={deleteError}
        onUpdateLabel={onUpdateLabel}
        isUpdatingLabel={isUpdatingLabel}
        labelError={labelError}
        onManualSend={onManualSend}
        isManualSending={isManualSending}
        manualSendError={manualSendError}
        onTryAiDraft={onTryAiDraft}
        isTryingAiDraft={isTryingAiDraft}
        tryAiDraftError={tryAiDraftError}
      />
    )}
  </>
);

const getStatusTone = (status) => {
  switch (status) {
    case "sent":
      return "emerald";
    case "draft":
      return "slate";
    case "sending":
      return "amber";
    case "superseded":
      return "slate";
    case "failed":
    case "send_failed":
      return "rose";
    default:
      return "slate";
  }
};

const EmailActionDetailContent = ({
  item,
  onClose,
  onToggleChecked,
  isSaving,
  onSendDraft,
  isSending,
  sendError,
  onUpdateDraft,
  isUpdatingDraft,
  updateError,
  onDeleteDraft,
  isDeletingDraft,
  deleteError,
  onUpdateLabel,
  isUpdatingLabel,
  labelError,
  onManualSend,
  isManualSending,
  manualSendError,
  onTryAiDraft,
  isTryingAiDraft,
  tryAiDraftError,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [manualReplyText, setManualReplyText] = useState("");

  // Derive chronological turns (oldest at index 0, newest at end)
  const turns =
    item.turns && item.turns.length > 0
      ? item.turns
      : [
          {
            incomingMessageId: item.sourceMessageId,
            from: item.to || "Unknown",
            receivedAt: item.createdAt,
            incomingSubject: item.subject,
            incomingSnippet: item.summary,
            incomingSummary: item.summary,
            label: item.label,
            outcome:
              item.type === "draft"
                ? "drafted"
                : item.type === "reply"
                ? "sent"
                : item.type === "none"
                ? "none"
                : "failed",
            outgoing: item.body
              ? {
                  kind: item.type === "reply" ? "reply" : "draft",
                  body: item.body,
                  status:
                    item.status === "sent"
                      ? "sent"
                      : item.status === "draft"
                      ? "draft"
                      : item.status || "draft",
                  sentAt: item.sentAt,
                  gmailDraftId: item.gmailDraftId,
                }
              : null,
          },
        ];

  const latestIndex = turns.length - 1;
  const latestTurn = turns[latestIndex];

  // Latest turn is expanded by default; older turns are collapsed
  const [expandedTurnIndices, setExpandedTurnIndices] = useState(
    () => new Set([latestIndex])
  );

  const [form, setForm] = useState({
    to: item.to || "",
    subject: item.subject || "",
    body: latestTurn?.outgoing?.body || item.body || "",
  });

  // Label editing state
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(item.label || "");

  const latestTurnRef = useRef(null);

  useEffect(() => {
    setForm({
      to: item.to || "",
      subject: item.subject || "",
      body: latestTurn?.outgoing?.body || item.body || "",
    });

    setLabelValue(item.label || "");
    setIsEditingLabel(false);
    setIsEditing(false);
    setExpandedTurnIndices(new Set([latestIndex]));
  }, [item._id, item.to, item.subject, item.body, item.label, latestIndex]);

  // Scroll to latest turn on open or item change
  useEffect(() => {
    const timer = setTimeout(() => {
      if (latestTurnRef.current) {
        latestTurnRef.current.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [item._id]);

  const toggleTurn = (index) => {
    setExpandedTurnIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const latestOutgoingStatus =
    latestTurn?.outgoing?.status || item.status || "draft";
  const isDraft =
    latestTurn?.outgoing?.kind === "draft" || item.type === "draft";
  const isSent = latestOutgoingStatus === "sent";
  const isSendingNow = isSending || latestOutgoingStatus === "sending";
  const cannotRetry = latestOutgoingStatus === "send_failed";
  const canEditDraft =
    isDraft &&
    (!latestOutgoingStatus ||
      latestOutgoingStatus === "draft" ||
      latestOutgoingStatus === "failed");

  const isBusy =
    isUpdatingDraft ||
    isDeletingDraft ||
    isUpdatingLabel ||
    isSendingNow ||
    isManualSending ||
    isTryingAiDraft;

  const handleManualSend = () => {
    if (!manualReplyText.trim()) {
      window.alert("Please enter a reply before sending.");
      return;
    }
    const confirmed = window.confirm(`Send this manual reply to ${item.to}?`);
    if (!confirmed) return;

    onManualSend(
      {
        id: item._id,
        body: manualReplyText.trim(),
        to: item.to,
        subject: item.subject,
      },
      {
        onSuccess: () => {
          setManualReplyText("");
        },
      }
    );
  };

  const handleTryAiDraft = () => {
    onTryAiDraft(
      { id: item._id },
      {
        onSuccess: () => {
          setManualReplyText("");
        },
      }
    );
  };

  const handleFieldChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  // Save draft changes (operates on latest turn's draft)
  const handleSave = () => {
    if (!form.to.trim()) {
      window.alert("Please enter a recipient email address.");
      return;
    }

    if (!form.subject.trim()) {
      window.alert("Please enter a subject.");
      return;
    }

    onUpdateDraft(
      {
        id: item._id,
        to: form.to.trim(),
        subject: form.subject.trim(),
        body: form.body,
      },
      {
        onSuccess: () => {
          setIsEditing(false);
        },
      }
    );
  };

  // Delete draft
  const handleDelete = () => {
    const confirmed = window.confirm(
      "Permanently delete this draft from Gmail and Mailpilot? This cannot be undone."
    );

    if (!confirmed) return;

    onDeleteDraft({ id: item._id });
  };

  // Save updated AI label
  const handleSaveLabel = () => {
    if (labelValue.length > 80) {
      window.alert("Label cannot exceed 80 characters.");
      return;
    }

    onUpdateLabel(item, labelValue.trim(), () => {
      setIsEditingLabel(false);
    });
  };

  // Original thread context from the first turn
  const firstTurn = turns[0];
  const originalSender = firstTurn?.from || item.to || "Unknown";
  const originalDate = firstTurn?.receivedAt || item.createdAt;
  const originalSnippet =
    firstTurn?.incomingSnippet ||
    firstTurn?.incomingSummary ||
    item.summary ||
    "";
  const firstTurnThreadId = firstTurn?.gmailThreadId || item.threadId || item.sourceMessageId;
  const firstTurnSubject = (firstTurn?.incomingSubject || item.subject || "").trim().toLowerCase();

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden"
        onClick={onClose}
      />

      <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-700 dark:bg-slate-950 sm:w-[520px]">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Close details"
            >
              <FiArrowLeft className="h-5 w-5" />
            </button>

            <h2 className="text-xl font-bold text-slate-950 dark:text-slate-50">
              {titleCase(item.type || "Conversation")} Details
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <FiX className="h-5 w-5" />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Thread meta header */}
          <div className="grid gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 sm:grid-cols-2">
            {/* Subject */}
            <div className="sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Subject
              </p>

              {isEditing ? (
                <input
                  name="subject"
                  value={form.subject}
                  onChange={handleFieldChange}
                  maxLength={998}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              ) : (
                <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {item.subject || "No subject"}
                </p>
              )}
            </div>

            {/* Recipient / Partner */}
            <div className="sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                To / Participant
              </p>

              {isEditing ? (
                <input
                  name="to"
                  type="email"
                  value={form.to}
                  onChange={handleFieldChange}
                  maxLength={1000}
                  required
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              ) : (
                <p className="mt-2 break-words text-slate-600 dark:text-slate-300">
                  {item.to || "Unknown"}
                </p>
              )}
            </div>

            {/* Category */}
            <div className="sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Category
              </p>

              {!isEditingLabel ? (
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone="blue">{item.label || "Uncategorized"}</Badge>

                  {canEditDraft && (
                    <button
                      type="button"
                      onClick={() => setIsEditingLabel(true)}
                      disabled={isBusy}
                      className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      <FiEdit2 className="h-3 w-3" />
                      Edit
                    </button>
                  )}
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    value={labelValue}
                    onChange={(e) => setLabelValue(e.target.value)}
                    maxLength={80}
                    placeholder="Enter category"
                    autoFocus
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="primary"
                      onClick={handleSaveLabel}
                      disabled={isUpdatingLabel}
                    >
                      <FiSave className="h-4 w-4" />
                      {isUpdatingLabel ? "Saving..." : "Save Category"}
                    </Button>

                    <Button
                      variant="ghost"
                      onClick={() => {
                        setLabelValue(item.label || "");
                        setIsEditingLabel(false);
                      }}
                      disabled={isUpdatingLabel}
                    >
                      Cancel
                    </Button>
                  </div>

                  {labelError && (
                    <p className="text-xs text-red-600">{labelError}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Chronological Timeline (newest at bottom) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Conversation Timeline ({turns.length} message{turns.length > 1 ? "s" : ""})
              </p>
              <span className="text-[11px] text-slate-400">
                Newest at bottom
              </span>
            </div>

            <div className="space-y-3">
              {turns.map((turn, index) => {
                const isLatest = index === latestIndex;
                const isExpanded = expandedTurnIndices.has(index);
                const turnOutgoing = turn.outgoing;
                const turnStatus = turnOutgoing?.status || (isLatest ? item.status : "draft");
                const turnThreadId = turn.gmailThreadId || firstTurnThreadId;
                const currentSubject = (turn.incomingSubject || "").trim();
                const hasSubjectDiff = Boolean(
                  currentSubject &&
                    firstTurnSubject &&
                    currentSubject.toLowerCase() !== firstTurnSubject
                );
                const linkedTag =
                  turn.linkedBy === "sender" ? (
                    <span className="inline-flex items-center rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:border-purple-800 dark:bg-purple-950/50 dark:text-purple-300">
                      Linked by sender
                    </span>
                  ) : turn.linkedBy === "headers" ? (
                    <span className="inline-flex items-center rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
                      Linked by reply headers
                    </span>
                  ) : null;

                if (!isExpanded) {
                  return (
                    <div
                      key={turn._id || index}
                      className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <button
                        type="button"
                        onClick={() => toggleTurn(index)}
                        className="flex w-full items-center justify-between gap-3 text-left"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600 dark:bg-zinc-800 dark:text-slate-300">
                            {index + 1}
                          </span>
                          <span className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                            {turn.from || item.to || "Unknown sender"}
                          </span>
                          {linkedTag}
                          {turnOutgoing && (
                            <Badge tone={getStatusTone(turnStatus)}>
                              {titleCase(turnStatus)}
                            </Badge>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-[11px] text-slate-400">
                            {formatDateTime(turn.receivedAt || item.createdAt)}
                          </span>
                          <FiChevronDown className="h-4 w-4 text-slate-400" />
                        </div>
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={turn._id || index}
                    ref={isLatest ? latestTurnRef : null}
                    className={`rounded-lg border p-4 shadow-sm transition ${
                      isLatest
                        ? "border-blue-200 bg-white ring-1 ring-blue-500/10 dark:border-blue-900/40 dark:bg-zinc-900"
                        : "border-slate-200 bg-slate-50/70 dark:border-zinc-800 dark:bg-zinc-900/60"
                    }`}
                  >
                    {/* Turn Header */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-zinc-800">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                            isLatest
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                              : "bg-slate-200 text-slate-700 dark:bg-zinc-800 dark:text-slate-300"
                          }`}
                        >
                          {index + 1}
                        </span>
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {isLatest ? "Latest Turn" : `Turn ${index + 1}`}
                        </span>
                        {linkedTag}
                      </div>

                      <div className="flex items-center gap-2">
                        {turnThreadId && (
                          <a
                            href={`https://mail.google.com/mail/u/0/#inbox/${turnThreadId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-500 hover:underline dark:text-blue-400"
                            title="Open in Gmail"
                          >
                            Open in Gmail
                            <FiExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <span className="text-xs text-slate-400">
                          {formatDateTime(turn.receivedAt || item.createdAt)}
                        </span>
                        {!isLatest && (
                          <button
                            type="button"
                            onClick={() => toggleTurn(index)}
                            className="rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            aria-label="Collapse turn"
                          >
                            <FiChevronUp className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Incoming Section */}
                    <div className="mt-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs">
                          <span className="font-semibold text-slate-500 dark:text-slate-400">
                            From:{" "}
                          </span>
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {turn.from || item.to || "Unknown sender"}
                          </span>
                        </div>
                        {turn.label && <Badge tone="blue">{turn.label}</Badge>}
                      </div>

                      {/* Collapsed note when subject differs from first turn */}
                      {hasSubjectDiff && (
                        <details className="rounded border border-slate-200 bg-slate-100/60 p-2 text-xs text-slate-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-slate-400">
                          <summary className="cursor-pointer font-medium hover:text-slate-900 dark:hover:text-slate-200">
                            Subject differs:{" "}
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {turn.incomingSubject}
                            </span>
                          </summary>
                          <p className="mt-1 pl-2 text-[11px] text-slate-500 dark:text-slate-400">
                            Original thread subject:{" "}
                            {firstTurn?.incomingSubject || item.subject}
                          </p>
                        </details>
                      )}

                      {/* Summary */}
                      <div className="rounded-md border border-slate-200/80 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-slate-300">
                        <div className="mb-1 flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[10px] text-slate-500 dark:text-slate-400">
                          <FiInfo className="h-3 w-3 text-slate-400" />
                          Incoming Summary
                        </div>
                        <p className="whitespace-pre-wrap">
                          {turn.incomingSummary ||
                            turn.incomingSnippet ||
                            item.summary ||
                            "No summary available"}
                        </p>
                      </div>
                    </div>

                    {/* Outgoing Reply / Draft section */}
                    {(turnOutgoing ||
                      turn.outcome === "drafted" ||
                      turn.outcome === "sent" ||
                      (isLatest && item.body)) && (
                      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-zinc-800">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {turnOutgoing?.kind === "reply" ||
                            (!turnOutgoing && item.type === "reply") ? (
                              <FiCornerUpLeft className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <FiFileText className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                            )}
                            <span>
                              {turnOutgoing?.kind === "reply" ||
                              (!turnOutgoing && item.type === "reply")
                                ? "Reply"
                                : "Draft"}
                            </span>
                          </div>

                          <Badge tone={getStatusTone(turnStatus)}>
                            {titleCase(turnStatus)}
                          </Badge>
                        </div>

                        {/* Outgoing Body / Editor */}
                        {turnOutgoing?.ungrounded && (
                          <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
                            <FiAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                            <div>
                              <span className="font-semibold">Ungrounded AI Draft:</span> Generated with document retrieval gate bypassed. Please review carefully before sending.
                            </div>
                          </div>
                        )}
                        {isLatest && isEditing ? (
                          <div className="mt-2 space-y-2">
                            <textarea
                              name="body"
                              value={form.body}
                              onChange={handleFieldChange}
                              rows={8}
                              maxLength={100000}
                              className="w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-xs leading-5 text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            />
                            <div className="flex items-center gap-2">
                              <Button
                                variant="success"
                                onClick={handleSave}
                                disabled={isBusy}
                              >
                                <FiSave className="h-3.5 w-3.5" />
                                {isUpdatingDraft ? "Saving..." : "Save Changes"}
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setForm({
                                    to: item.to || "",
                                    subject: item.subject || "",
                                    body:
                                      latestTurn?.outgoing?.body ||
                                      item.body ||
                                      "",
                                  });
                                  setIsEditing(false);
                                }}
                                disabled={isBusy}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-700 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-slate-200">
                            {turnOutgoing?.body ||
                              (isLatest ? item.body : "") ||
                              "No outgoing body stored."}
                          </div>
                        )}

                        {/* Sent Timestamp */}
                        {(turnStatus === "sent" || (isLatest && isSent)) && (
                          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                            Sent at:{" "}
                            {formatDateTime(
                              turnOutgoing?.sentAt ||
                                item.sentAt ||
                                turn.receivedAt
                            )}
                          </div>
                        )}

                        {/* Actions on Latest Turn */}
                        {isLatest && canEditDraft && !isEditing && (
                          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 dark:border-zinc-800">
                            <Button
                              variant="ghost"
                              onClick={() => setIsEditing(true)}
                              disabled={isBusy}
                            >
                              <FiEdit2 className="h-3.5 w-3.5" />
                              Edit
                            </Button>

                            <Button
                              variant="ghost"
                              onClick={handleDelete}
                              disabled={isBusy}
                            >
                              <FiTrash2 className="h-3.5 w-3.5" />
                              {isDeletingDraft ? "Deleting..." : "Delete"}
                            </Button>

                            {!isSent && (
                              <Button
                                variant="success"
                                onClick={() => onSendDraft(item)}
                                disabled={isBusy || cannotRetry}
                              >
                                <FiSend className="h-3.5 w-3.5" />
                                {isSendingNow ? "Sending..." : "Send Now"}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Outcome for non-outgoing turns */}
                    {!turnOutgoing && turn.outcome === "none" && (
                      <div className="mt-3 border-t border-slate-100 pt-2 dark:border-zinc-800">
                        <Badge tone="slate">No reply needed</Badge>
                      </div>
                    )}
                    {(!turnOutgoing || turnOutgoing.status === "failed") &&
                      (turn.outcome === "needs_manual" || turn.outcome === "failed" || turnStatus === "failed") && (
                        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50/40 p-3.5 text-xs dark:border-rose-900/40 dark:bg-zinc-950/50">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200/60 pb-2.5 dark:border-zinc-800">
                            <div className="flex items-center gap-1.5 font-semibold text-rose-900 dark:text-rose-200">
                              <Badge tone="rose">Failed</Badge>
                              <Badge tone="amber">
                                {getFailureReasonLabel(turn.failureReason || item.failureReason)}
                              </Badge>
                            </div>
                          </div>

                          <div className="mt-2.5 space-y-1.5 text-slate-700 dark:text-slate-300">
                            <p>
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                Reason:{" "}
                              </span>
                              {turn.failureReason
                                ? getFailureReasonLabel(turn.failureReason) + ` (${turn.failureReason})`
                                : "The AI could not confidently generate a grounded response."}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              <span className="font-semibold">Incoming Summary: </span>
                              {turn.incomingSummary || turn.incomingSnippet || item.summary || "No summary available"}
                            </p>
                          </div>

                          {/* Compose box for manual reply */}
                          {isLatest && (
                            <div className="mt-4 space-y-2.5 border-t border-rose-100 pt-3 dark:border-zinc-800">
                              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                                Compose manual reply
                              </label>
                              <textarea
                                value={manualReplyText}
                                onChange={(e) => setManualReplyText(e.target.value)}
                                rows={5}
                                placeholder="Write your reply to send directly to recipient..."
                                className="w-full resize-y rounded-md border border-slate-300 bg-white p-2.5 text-xs leading-5 text-slate-800 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-200"
                              />

                              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    variant="success"
                                    onClick={handleManualSend}
                                    disabled={isBusy || !manualReplyText.trim()}
                                  >
                                    <FiSend className="h-3.5 w-3.5" />
                                    {isManualSending ? "Sending..." : "Send Reply"}
                                  </Button>

                                  <Button
                                    variant="secondary"
                                    onClick={handleTryAiDraft}
                                    disabled={isBusy}
                                    title="Runs generation once with retrieval gate bypassed and creates an ungrounded draft"
                                  >
                                    <FiCpu className="h-3.5 w-3.5" />
                                    {isTryingAiDraft ? "Generating Draft..." : "Try AI draft anyway"}
                                  </Button>
                                </div>
                              </div>

                              {manualSendError && (
                                <p className="mt-1 text-xs text-red-600">{manualSendError}</p>
                              )}
                              {tryAiDraftError && (
                                <p className="mt-1 text-xs text-red-600">{tryAiDraftError}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Error messages */}
          {sendError && <p className="text-sm text-red-600">{sendError}</p>}
          {updateError && <p className="text-sm text-red-600">{updateError}</p>}
          {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
          {cannotRetry && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              The sending result could not be confirmed. Check your Gmail Sent
              folder before taking further action.
            </p>
          )}

          {/* Original Thread Context */}
          <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Original Thread Context
              </p>
              {firstTurnThreadId && (
                <a
                  href={`https://mail.google.com/mail/u/0/#inbox/${firstTurnThreadId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-500 hover:underline dark:text-blue-400"
                >
                  Open in Gmail
                  <FiExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>

            <div className="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
              <p>
                <span className="font-semibold text-slate-500 dark:text-slate-400">
                  Sender:{" "}
                </span>
                {originalSender}
              </p>
              <p>
                <span className="font-semibold text-slate-500 dark:text-slate-400">
                  Date:{" "}
                </span>
                {formatDateTime(originalDate)}
              </p>
              {originalSnippet && (
                <p className="mt-1 line-clamp-3 text-slate-500 dark:text-slate-400">
                  <span className="font-semibold">Snippet: </span>
                  {originalSnippet}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="flex flex-col gap-3 border-t border-slate-200 p-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                if (isEditing) {
                  setForm({
                    to: item.to || "",
                    subject: item.subject || "",
                    body: latestTurn?.outgoing?.body || item.body || "",
                  });
                  setIsEditing(false);
                } else {
                  onClose();
                }
              }}
              disabled={isBusy}
            >
              {isEditing ? "Cancel" : "Close"}
            </Button>

            <div className="flex flex-wrap items-center gap-2">
              {/* Save Draft when editing */}
              {isEditing && (
                <Button
                  variant="success"
                  onClick={handleSave}
                  disabled={isBusy}
                >
                  <FiSave className="h-4 w-4" />
                  {isUpdatingDraft ? "Saving..." : "Save Changes"}
                </Button>
              )}

              {/* Checked toggle button */}
              {!isEditing && !isEditingLabel && (
                <Button
                  variant={item.checked ? "ghost" : "success"}
                  onClick={() => onToggleChecked(item)}
                  disabled={isSaving || isBusy}
                >
                  <FiCheckCircle className="h-4 w-4" />
                  {item.checked ? "Mark as Unchecked" : "Mark as Checked"}
                </Button>
              )}
            </div>
          </div>
        </footer>
      </aside>
    </>
  );
};
