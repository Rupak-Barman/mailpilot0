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
  FiRotateCcw,
  FiClock,
  FiCheck,
  FiRefreshCw,
  FiAlertCircle,
} from "react-icons/fi";

import { Button } from "../../components/common/Button";
import { Badge } from "../../components/common/Badge";
import { formatDateTime, titleCase } from "../../utils/formatters";
import { getFailureReasonLabel } from "./EmailActionTable";
import { EmailChipInput, parseRawRecipients } from "../../components/common/EmailChipInput";
import { AiAssistPanel } from "./AiAssistPanel";
import { aiAssistAction } from "../../api/emailActions.api";
import { useLabels } from "../../hooks/useLabels";
import { useKnowledgeFiles } from "../../hooks/useKnowledge";
import { useRetryGmailSyncAction } from "../../hooks/useEmailActions";
import { useDraftEditor } from "./useDraftEditor";

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
    case "deleted":
      return "rose";
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

  const initialTo = latestTurn?.outgoing?.to?.length
    ? latestTurn.outgoing.to
    : parseRawRecipients(item.to || "");
  const initialCc = latestTurn?.outgoing?.cc?.length
    ? latestTurn.outgoing.cc
    : parseRawRecipients(item.cc || "");
  const initialBcc = latestTurn?.outgoing?.bcc?.length
    ? latestTurn.outgoing.bcc
    : parseRawRecipients(item.bcc || "");

  const editor = useDraftEditor();
  const retrySyncMutation = useRetryGmailSyncAction();
  const [localSaveError, setLocalSaveError] = useState(null);

  const [showCc, setShowCc] = useState(() => initialCc.length > 0);
  const [showBcc, setShowBcc] = useState(() => initialBcc.length > 0);

  // Manual reply composer state for failed turns
  const [manualTo, setManualTo] = useState(() =>
    parseRawRecipients(latestTurn?.from || item.to || "")
  );
  const [manualCc, setManualCc] = useState(() =>
    parseRawRecipients(latestTurn?.outgoing?.cc || item.cc || "")
  );
  const [manualBcc, setManualBcc] = useState(() =>
    parseRawRecipients(latestTurn?.outgoing?.bcc || item.bcc || "")
  );
  const [showManualCc, setShowManualCc] = useState(false);
  const [showManualBcc, setShowManualBcc] = useState(false);

  const suggestedRecipients = parseRawRecipients(
    latestTurn?.outgoing?.suggestedCc || item.suggestedCc || []
  );

  const { data: userLabelsData } = useLabels();
  const { data: knowledgeFilesData } = useKnowledgeFiles();
  const userLabels = userLabelsData?.labels || userLabelsData || [];
  const knowledgeFiles = knowledgeFilesData?.files || knowledgeFilesData || [];

  const [isAiAssisting, setIsAiAssisting] = useState(false);
  const [aiAssistError, setAiAssistError] = useState(null);
  const [aiAssistNotice, setAiAssistNotice] = useState(null);
  const [assistPanelOpen, setAssistPanelOpen] = useState(false);
  const [composePreviewDraft, setComposePreviewDraft] = useState(null);
  const [showVersionsMenu, setShowVersionsMenu] = useState(false);
  const assistAbortRef = useRef(null);

  const versions = latestTurn?.outgoing?.versions || [];

  const getHeaderTitle = () => {
    if (
      latestTurn?.outcome === "failed" ||
      latestTurn?.outcome === "needs_manual" ||
      item.status === "failed" ||
      item.type === "failed"
    ) {
      return "Needs your reply";
    }
    if (latestTurn?.outgoing?.kind === "draft" || item.type === "draft") {
      return "Draft details";
    }
    if (latestTurn?.outgoing?.kind === "reply" || item.type === "reply") {
      return "Reply details";
    }
    return "Draft details";
  };

  const handleAiAssistGenerate = async ({ instruction, useKnowledge }) => {
    setIsAiAssisting(true);
    setAiAssistError(null);
    setAiAssistNotice(null);

    const abortController = new AbortController();
    assistAbortRef.current = abortController;

    const isRevise = Boolean(
      latestTurn?.outgoing?.kind === "draft" || item.type === "draft"
    );
    const mode = isRevise ? "revise" : "compose";
    const currentBody = isRevise ? editor.state.body : manualReplyText;
    const currentVersionId = isRevise
      ? editor.state.pendingPreview?.versionId
      : composePreviewDraft?.versionId;

    try {
      const turnId =
        latestTurn?.turnId ||
        latestTurn?._id ||
        latestTurn?.incomingMessageId ||
        latestIndex;
      const res = await aiAssistAction({
        id: item._id,
        turnId,
        mode,
        instruction,
        useKnowledge,
        currentBody,
        versionId: currentVersionId,
        signal: abortController.signal,
      });

      if (res.status === "no_knowledge") {
        setAiAssistNotice(
          res.notices?.[0] ||
            "No matching knowledge found in attached documents. Try writing without knowledge base or adding key facts to your instruction."
        );
        return;
      }

      const previewObj = {
        body: res.body,
        usedKnowledge: res.usedKnowledge,
        sources: res.sources || [],
        chunkCount: res.chunkCount || 0,
        bestDistance: res.bestDistance,
        ungrounded: res.ungrounded,
        notices: res.notices || [],
        versionId: res.versionId,
        previousBody: currentBody,
        mode,
        instruction,
        framing: res.framing,
      };

      // Update editor text immediately with preview
      if (isRevise) {
        editor.setAiPreview(previewObj);
        setIsEditing(true);
      } else {
        setComposePreviewDraft(previewObj);
        setManualReplyText(res.body);
      }
    } catch (err) {
      if (err.name === "CanceledError" || abortController.signal.aborted) {
        return;
      }
      const data = err.response?.data;
      setAiAssistError({
        code: data?.code || err.code,
        message: data?.message || err.message || "Failed to generate AI draft",
      });
    } finally {
      setIsAiAssisting(false);
      assistAbortRef.current = null;
    }
  };

  const handleAiAssistCancel = () => {
    if (assistAbortRef.current) {
      assistAbortRef.current.abort();
      assistAbortRef.current = null;
    }
    setIsAiAssisting(false);
  };

  const handleUseComposePreview = () => {
    if (!composePreviewDraft) return;

    let draftSubject = latestTurn?.incomingSubject || item.subject || "";
    if (!draftSubject.toLowerCase().startsWith("re:")) {
      draftSubject = `Re: ${draftSubject.replace(/^re:\s*/i, "")}`.trim();
    }

    const generationPayload = {
      mode: "user_assisted",
      instruction: composePreviewDraft.instruction,
      useKnowledge: composePreviewDraft.usedKnowledge,
      ungrounded: composePreviewDraft.ungrounded,
      sources: composePreviewDraft.sources,
      framing: composePreviewDraft.framing,
    };

    const versionPayload = {
      versionId: composePreviewDraft.versionId,
      body: composePreviewDraft.body,
      source: "ai_initial",
      instruction: composePreviewDraft.instruction,
      useKnowledge: composePreviewDraft.usedKnowledge,
    };

    onUpdateDraft(
      {
        id: item._id,
        to: manualTo,
        cc: manualCc,
        bcc: manualBcc,
        subject: draftSubject,
        body: composePreviewDraft.body,
        generation: generationPayload,
        version: versionPayload,
      },
      {
        onSuccess: () => {
          setComposePreviewDraft(null);
          setAssistPanelOpen(false);
        },
      }
    );
  };

  const handleDiscardComposePreview = () => {
    if (!composePreviewDraft) return;
    setManualReplyText(composePreviewDraft.previousBody);
    setComposePreviewDraft(null);
  };

  const handleReviseAgain = () => {
    editor.discardPreview();
    setAssistPanelOpen(true);
  };

  const handleUndo = () => {
    if (editor.state.pendingPreview) {
      editor.discardPreview();
    } else if (versions.length > 1) {
      const targetVersion = versions[versions.length - 2];
      editor.undo(targetVersion);
      setIsEditing(true);
    }
  };

  const handleRestoreVersion = (ver) => {
    editor.restoreVersion(ver);
    setIsEditing(true);
    setShowVersionsMenu(false);
  };

  const getUnaddedSuggested = (currentToList, currentCcList) => {
    const existingEmails = new Set([
      ...currentToList.map((r) => r.email.toLowerCase()),
      ...currentCcList.map((r) => r.email.toLowerCase()),
    ]);
    return suggestedRecipients.filter(
      (r) => !existingEmails.has(r.email.toLowerCase())
    );
  };

  const draftUnaddedSuggested = getUnaddedSuggested(
    editor.state.to,
    editor.state.cc
  );
  const manualUnaddedSuggested = getUnaddedSuggested(manualTo, manualCc);

  const handleAddReplyAllToDraft = () => {
    if (draftUnaddedSuggested.length === 0) return;
    editor.updateField("cc", [...editor.state.cc, ...draftUnaddedSuggested]);
    setShowCc(true);
    setLocalSaveError(null);
  };

  const handleAddReplyAllToManual = () => {
    if (manualUnaddedSuggested.length === 0) return;
    setManualCc((current) => [...current, ...manualUnaddedSuggested]);
    setShowManualCc(true);
  };

  // Label editing state
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(item.label || "");

  const latestTurnRef = useRef(null);

  useEffect(() => {
    const nextTo = latestTurn?.outgoing?.to?.length
      ? latestTurn.outgoing.to
      : parseRawRecipients(item.to || "");
    const nextCc = latestTurn?.outgoing?.cc?.length
      ? latestTurn.outgoing.cc
      : parseRawRecipients(item.cc || "");
    const nextBcc = latestTurn?.outgoing?.bcc?.length
      ? latestTurn.outgoing.bcc
      : parseRawRecipients(item.bcc || "");

    const baseVersionId =
      latestTurn?.outgoing?.versions?.[latestTurn.outgoing.versions.length - 1]
        ?.versionId ||
      latestTurn?.versionId ||
      null;

    editor.init({
      to: nextTo,
      cc: nextCc,
      bcc: nextBcc,
      subject: item.subject || "",
      body: latestTurn?.outgoing?.body || item.body || "",
      baseVersionId,
      syncStatus: latestTurn?.outgoing?.gmailSync || null,
    });

    setShowCc(nextCc.length > 0);
    setShowBcc(nextBcc.length > 0);

    setManualTo(parseRawRecipients(latestTurn?.from || item.to || ""));
    setManualCc(parseRawRecipients(latestTurn?.outgoing?.cc || item.cc || ""));
    setManualBcc(parseRawRecipients(latestTurn?.outgoing?.bcc || item.bcc || ""));

    setLabelValue(item.label || "");
    setIsEditingLabel(false);
    setIsEditing(false);
    setExpandedTurnIndices(new Set([latestIndex]));
    setLocalSaveError(null);
    setComposePreviewDraft(null);
  }, [
    item._id,
    item.to,
    item.subject,
    item.body,
    item.label,
    latestIndex,
    latestTurn?.outgoing?.body,
    latestTurn?.versionId,
  ]);

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
    latestOutgoingStatus !== "deleted" &&
    (!latestOutgoingStatus ||
      latestOutgoingStatus === "draft" ||
      latestOutgoingStatus === "failed");

  const isBusy =
    isUpdatingDraft ||
    isDeletingDraft ||
    isUpdatingLabel ||
    isSendingNow ||
    isManualSending ||
    isTryingAiDraft ||
    isAiAssisting;

  const handleManualSend = () => {
    if (!manualReplyText.trim()) {
      window.alert("Please enter a reply before sending.");
      return;
    }
    if (manualTo.length === 0) {
      window.alert("Please enter at least one recipient email address.");
      return;
    }
    const toNames = manualTo.map((r) => r.email).join(", ");
    const confirmed = window.confirm(`Send this manual reply to ${toNames}?`);
    if (!confirmed) return;

    onManualSend(
      {
        id: item._id,
        body: manualReplyText.trim(),
        to: manualTo,
        cc: manualCc,
        bcc: manualBcc,
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
    editor.updateField(name, value);
    setLocalSaveError(null);
  };

  // Save draft changes (operates on latest turn's draft)
  const handleSave = (options = {}) => {
    const { forceOverwrite = false } = options;

    if (assistAbortRef.current) {
      assistAbortRef.current.abort();
      assistAbortRef.current = null;
      setIsAiAssisting(false);
    }

    if (!editor.state.to || editor.state.to.length === 0) {
      window.alert("Please enter a recipient email address.");
      return;
    }

    if (!editor.state.subject.trim()) {
      window.alert("Please enter a subject.");
      return;
    }

    if (!editor.state.dirty && !editor.state.pendingPreview && !forceOverwrite) {
      editor.setNotice("No changes to save");
      setIsEditing(false);
      return;
    }

    setLocalSaveError(null);

    const bodyToSave = editor.state.body;
    let generationPayload = undefined;
    let versionPayload = undefined;

    if (editor.state.pendingPreview) {
      generationPayload = {
        mode: "user_assisted",
        instruction: editor.state.pendingPreview.instruction,
        useKnowledge: editor.state.pendingPreview.usedKnowledge,
        ungrounded: editor.state.pendingPreview.ungrounded,
        sources: editor.state.pendingPreview.sources,
        framing: editor.state.pendingPreview.framing,
      };
      versionPayload = {
        versionId: editor.state.pendingPreview.versionId,
        body: bodyToSave,
        source: "ai_revision",
        instruction: editor.state.pendingPreview.instruction,
        useKnowledge: editor.state.pendingPreview.usedKnowledge,
      };
    } else if (editor.state.source === "restore") {
      versionPayload = {
        body: bodyToSave,
        source: "restore",
      };
    } else if (bodyToSave !== editor.state.initialDraft.body) {
      versionPayload = {
        body: bodyToSave,
        source: "manual_edit",
      };
    }

    onUpdateDraft(
      {
        id: item._id,
        to: editor.state.to,
        cc: editor.state.cc,
        bcc: editor.state.bcc,
        subject: editor.state.subject.trim(),
        body: bodyToSave,
        baseVersionId: editor.state.baseVersionId,
        forceOverwrite,
        generation: generationPayload,
        version: versionPayload,
      },
      {
        onSuccess: (result) => {
          setIsEditing(false);
          const newVersionId =
            result.action?.turns?.[latestIndex]?.versionId ||
            result.action?.turns?.[latestIndex]?.outgoing?.versions?.slice(-1)[0]
              ?.versionId;
          const sync =
            result.gmailSync ||
            result.action?.turns?.[latestIndex]?.outgoing?.gmailSync;

          let noticeText = "Draft saved";
          if (sync?.state === "failed") {
            noticeText = `Draft saved in app; Gmail sync pending (${
              sync.reason || "sync failed"
            })`;
          } else if (result.warning) {
            noticeText = result.warning;
          }

          editor.markSaved({
            newVersionId,
            syncStatus: sync,
            notice: noticeText,
          });
        },
        onError: (err) => {
          if (err.response?.status === 409) {
            editor.setConflict({
              message:
                err.response.data?.message ||
                "This draft was modified elsewhere. Please reload or overwrite.",
              serverBody: err.response.data?.currentBody,
              serverSubject: err.response.data?.currentSubject,
              currentVersionId: err.response.data?.currentVersionId,
            });
          } else {
            setLocalSaveError(
              err.response?.data?.message ||
                err.message ||
                "Could not update draft."
            );
          }
        },
      }
    );
  };

  const handleCancel = () => {
    if (editor.state.dirty || editor.state.pendingPreview) {
      editor.setDiscardConfirm(true);
    } else {
      editor.discardChanges();
      setIsEditing(false);
    }
  };

  const handleConfirmDiscard = () => {
    editor.discardChanges();
    setIsEditing(false);
  };

  const handleKeepEditing = () => {
    editor.setDiscardConfirm(false);
  };

  const handleRetrySync = () => {
    setLocalSaveError(null);
    retrySyncMutation.mutate(
      { id: item._id },
      {
        onSuccess: (result) => {
          editor.setSyncStatus(result.gmailSync || { state: "synced" });
          editor.setNotice("Gmail draft updated successfully");
        },
        onError: (err) => {
          const msg =
            err.response?.data?.message ||
            err.message ||
            "Failed to sync with Gmail";
          editor.setSyncStatus({ state: "failed", reason: msg, at: new Date() });
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
              {getHeaderTitle()}
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

              <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                {isEditing ? editor.state.subject || "No subject" : item.subject || "No subject"}
              </p>
            </div>

            {/* Recipient / Partner */}
            <div className="sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                To / Participant
              </p>
              <p className="mt-2 break-words text-slate-600 dark:text-slate-300">
                {item.to || "Unknown"}
              </p>
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
                          {turnOutgoing?.sentFrom === "gmail" && (
                            <Badge tone="purple">Sent from Gmail</Badge>
                          )}
                          {turnOutgoing?.editedInGmail && (
                            <Badge tone="amber">Edited in Gmail</Badge>
                          )}
                          {turnStatus === "deleted" ? (
                            <Badge tone="rose">Deleted in Gmail</Badge>
                          ) : turnOutgoing ? (
                            <Badge tone={getStatusTone(turnStatus)}>
                              {titleCase(turnStatus)}
                            </Badge>
                          ) : null}
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

                          <div className="flex flex-wrap items-center gap-1.5">
                            {turnStatus === "deleted" ? (
                              <Badge tone="rose">Deleted in Gmail</Badge>
                            ) : (
                              <Badge tone={getStatusTone(turnStatus)}>
                                {titleCase(turnStatus)}
                              </Badge>
                            )}
                            {turnOutgoing?.sentFrom === "gmail" && (
                              <Badge tone="purple">Sent from Gmail</Badge>
                            )}
                            {turnOutgoing?.editedInGmail && (
                              <Badge tone="amber">Edited in Gmail</Badge>
                            )}
                          </div>
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
                          <div className="mt-2 space-y-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                            {/* To field with Cc / Bcc links */}
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                  To:
                                </label>
                                <div className="flex items-center gap-2 text-xs">
                                  {draftUnaddedSuggested.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={handleAddReplyAllToDraft}
                                      className="text-xs font-semibold text-blue-600 hover:text-blue-500 hover:underline dark:text-blue-400"
                                    >
                                      Add reply-all recipients (+{draftUnaddedSuggested.length})
                                    </button>
                                  )}
                                  {!showCc && (
                                    <button
                                      type="button"
                                      onClick={() => setShowCc(true)}
                                      className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                                    >
                                      Cc
                                    </button>
                                  )}
                                  {!showBcc && (
                                    <button
                                      type="button"
                                      onClick={() => setShowBcc(true)}
                                      className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                                    >
                                      Bcc
                                    </button>
                                  )}
                                </div>
                              </div>
                              <EmailChipInput
                                value={editor.state.to}
                                onChange={(next) => {
                                  editor.updateField("to", next);
                                  setLocalSaveError(null);
                                }}
                                placeholder="Enter recipient..."
                              />
                            </div>

                            {/* Cc field */}
                            {showCc && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Cc:
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowCc(false);
                                      editor.updateField("cc", []);
                                      setLocalSaveError(null);
                                    }}
                                    className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                  >
                                    Remove Cc
                                  </button>
                                </div>
                                <EmailChipInput
                                  value={editor.state.cc}
                                  onChange={(next) => {
                                    editor.updateField("cc", next);
                                    setLocalSaveError(null);
                                  }}
                                  placeholder="Add CC recipient..."
                                />
                              </div>
                            )}

                            {/* Bcc field */}
                            {showBcc && (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Bcc:
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowBcc(false);
                                      editor.updateField("bcc", []);
                                      setLocalSaveError(null);
                                    }}
                                    className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                  >
                                    Remove Bcc
                                  </button>
                                </div>
                                <EmailChipInput
                                  value={editor.state.bcc}
                                  onChange={(next) => {
                                    editor.updateField("bcc", next);
                                    setLocalSaveError(null);
                                  }}
                                  placeholder="Add BCC recipient..."
                                />
                              </div>
                            )}

                            {/* Subject */}
                            <div className="space-y-1">
                              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Subject:
                              </label>
                              <input
                                type="text"
                                name="subject"
                                value={editor.state.subject}
                                onChange={handleFieldChange}
                                maxLength={998}
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-200"
                              />
                            </div>

                            {/* Preview Banner for Revise Mode */}
                            {editor.state.pendingPreview && (
                              <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-3 space-y-2 dark:border-indigo-800 dark:bg-indigo-950/40">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                                      <FiCpu className="h-3 w-3" />
                                      AI Revision Preview
                                    </span>
                                    {editor.state.pendingPreview.sources &&
                                      editor.state.pendingPreview.sources.length > 0 && (
                                        <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200">
                                          Based on{" "}
                                          {editor.state.pendingPreview.sources
                                            .map((s) => s.docTitle)
                                            .join(", ")}{" "}
                                          ({editor.state.pendingPreview.chunkCount} passages)
                                        </span>
                                      )}
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <Button
                                      size="sm"
                                      variant="success"
                                      onClick={() => editor.acceptPreview()}
                                      disabled={isBusy}
                                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                    >
                                      <FiCheck className="h-3.5 w-3.5 mr-1" />
                                      Use this
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => editor.discardPreview()}
                                      disabled={isBusy}
                                    >
                                      Discard
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={handleReviseAgain}
                                      disabled={isBusy}
                                    >
                                      <FiRefreshCw className="h-3 w-3 mr-1" />
                                      Revise again
                                    </Button>
                                  </div>
                                </div>

                                {editor.state.pendingPreview.ungrounded && (
                                  <div className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                                    <FiAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                    <span>Ungrounded: check the facts</span>
                                  </div>
                                )}

                                {editor.state.pendingPreview.notices &&
                                  editor.state.pendingPreview.notices.length > 0 && (
                                    <div className="space-y-1 text-xs text-indigo-900 dark:text-indigo-200">
                                      {editor.state.pendingPreview.notices.map((n, i) => (
                                        <p key={i} className="flex items-center gap-1.5">
                                          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span>
                                          {n}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                              </div>
                            )}

                            {/* Body */}
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                  Message:
                                </label>
                                <div className="flex items-center gap-2">
                                  {(versions.length > 1 || editor.state.pendingPreview) && (
                                    <button
                                      type="button"
                                      onClick={handleUndo}
                                      title="Undo to previous version"
                                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                                    >
                                      <FiRotateCcw className="h-3 w-3" />
                                      Undo
                                    </button>
                                  )}
                                  {versions.length > 0 && (
                                    <div className="relative">
                                      <button
                                        type="button"
                                        onClick={() => setShowVersionsMenu(!showVersionsMenu)}
                                        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                                      >
                                        <FiClock className="h-3 w-3" />
                                        Versions ({versions.length})
                                      </button>
                                      {showVersionsMenu && (
                                        <div className="absolute right-0 top-6 z-30 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                                          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                            Revision History
                                          </div>
                                          <div className="max-h-48 overflow-y-auto space-y-1">
                                            {versions
                                              .slice()
                                              .reverse()
                                              .map((v, idx) => (
                                                <button
                                                  key={v.versionId || idx}
                                                  type="button"
                                                  onClick={() => handleRestoreVersion(v)}
                                                  className="w-full text-left rounded-md p-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                                                >
                                                  <div className="flex items-center justify-between font-medium text-slate-800 dark:text-slate-200">
                                                    <span>
                                                      {v.source === "ai_initial"
                                                        ? "Initial AI Draft"
                                                        : v.source === "ai_revision"
                                                        ? "AI Revision"
                                                        : v.source === "restore"
                                                        ? "Restored Version"
                                                        : "Manual Edit"}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400">
                                                      {formatDateTime(v.at)}
                                                    </span>
                                                  </div>
                                                  {v.instruction && (
                                                    <p className="truncate text-[10px] text-slate-500 italic">
                                                      "{v.instruction}"
                                                    </p>
                                                  )}
                                                </button>
                                              ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <textarea
                                name="body"
                                value={editor.state.body}
                                onChange={handleFieldChange}
                                rows={8}
                                maxLength={100000}
                                className="w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-xs leading-5 text-slate-800 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-200"
                              />
                            </div>

                            {/* Inline Discard Confirmation Prompt */}
                            {editor.state.showDiscardConfirm && (
                              <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
                                <span>Discard changes? Unsaved edits will be lost.</span>
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    onClick={handleConfirmDiscard}
                                    className="h-6 px-2 text-[11px]"
                                  >
                                    Discard
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleKeepEditing}
                                    className="h-6 px-2 text-[11px]"
                                  >
                                    Keep editing
                                  </Button>
                                </div>
                              </div>
                            )}

                            {/* Conflict Resolution Prompt (409) */}
                            {editor.state.conflict && (
                              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                                <div className="flex items-start gap-2">
                                  <FiAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                                  <div className="flex-1 space-y-1">
                                    <p className="font-semibold">Conflict: Draft was updated elsewhere</p>
                                    <p className="text-amber-800 dark:text-amber-300">
                                      {editor.state.conflict.message}
                                    </p>
                                    <div className="flex items-center gap-2 pt-1">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          editor.clearConflict();
                                          editor.discardChanges();
                                          setIsEditing(false);
                                        }}
                                      >
                                        Reload (Discard My Changes)
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="warning"
                                        onClick={() => handleSave({ forceOverwrite: true })}
                                        disabled={isBusy}
                                      >
                                        Overwrite
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Local Save Error */}
                            {localSaveError && (
                              <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
                                {localSaveError}
                              </div>
                            )}

                            {/* Non-blocking Gmail sync failure status */}
                            {editor.state.syncStatus?.state === "failed" && (
                              <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                                <div className="flex items-center gap-1.5">
                                  <FiAlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                                  <span>
                                    Saved in app. Gmail not updated:{" "}
                                    <span className="font-medium">
                                      {editor.state.syncStatus.reason ||
                                        "Gmail draft synchronization failed"}
                                    </span>
                                  </span>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={handleRetrySync}
                                  disabled={retrySyncMutation.isPending}
                                  className="ml-2 shrink-0 h-6 px-2 text-[11px]"
                                >
                                  {retrySyncMutation.isPending ? "Retrying..." : "Retry sync"}
                                </Button>
                              </div>
                            )}

                            {/* Aria-live notification / feedback */}
                            {editor.state.notice && (
                              <div
                                role="status"
                                aria-live="polite"
                                className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                              >
                                <FiCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                <span>{editor.state.notice}</span>
                              </div>
                            )}

                            <div className="flex items-center gap-2 pt-1">
                              <Button
                                variant="success"
                                onClick={() => handleSave()}
                                disabled={isBusy}
                              >
                                <FiSave className="h-3.5 w-3.5" />
                                {isUpdatingDraft ? "Saving..." : "Save Changes"}
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={handleCancel}
                                disabled={isBusy}
                              >
                                Cancel
                              </Button>
                            </div>

                            {/* Revise with AI panel inside editor */}
                            {isLatest && (
                              <div className="mt-3">
                                <AiAssistPanel
                                  mode="revise"
                                  labelName={latestTurn?.label || item.label}
                                  userLabels={userLabels}
                                  knowledgeFiles={knowledgeFiles}
                                  onGenerate={handleAiAssistGenerate}
                                  onCancel={handleAiAssistCancel}
                                  isLoading={isAiAssisting}
                                  error={aiAssistError}
                                  statusNotice={aiAssistNotice}
                                  isOpen={assistPanelOpen}
                                  onToggle={() => setAssistPanelOpen((prev) => !prev)}
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {/* To and Cc recipients display */}
                            {((turnOutgoing?.to && turnOutgoing.to.length > 0) ||
                              (turnOutgoing?.cc && turnOutgoing.cc.length > 0)) && (
                              <div className="space-y-0.5 rounded-md border border-slate-100 bg-slate-50/60 p-2 text-xs dark:border-zinc-800/80 dark:bg-zinc-950/40">
                                {turnOutgoing?.to && turnOutgoing.to.length > 0 && (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-semibold text-slate-500 dark:text-slate-400">
                                      To:
                                    </span>
                                    <span className="text-slate-800 dark:text-slate-200">
                                      {turnOutgoing.to
                                        .map((r) => (r.name ? `${r.name} <${r.email}>` : r.email))
                                        .join(", ")}
                                    </span>
                                  </div>
                                )}
                                {turnOutgoing?.cc && turnOutgoing.cc.length > 0 && (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-semibold text-slate-500 dark:text-slate-400">
                                      Cc:
                                    </span>
                                    <span className="text-slate-700 dark:text-slate-300">
                                      {turnOutgoing.cc
                                        .map((r) => (r.name ? `${r.name} <${r.email}>` : r.email))
                                        .join(", ")}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-700 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-slate-200">
                              {turnOutgoing?.body ||
                                (isLatest ? item.body : "") ||
                                "No outgoing body stored."}
                            </div>
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
                            <div className="mt-4 space-y-3 border-t border-rose-100 pt-3 dark:border-zinc-800">
                              <div className="flex items-center justify-between">
                                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                                  Compose manual reply
                                </label>
                                <div className="flex items-center gap-2 text-xs">
                                  {manualUnaddedSuggested.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={handleAddReplyAllToManual}
                                      className="text-xs font-semibold text-blue-600 hover:text-blue-500 hover:underline dark:text-blue-400"
                                    >
                                      Add reply-all recipients (+{manualUnaddedSuggested.length})
                                    </button>
                                  )}
                                  {!showManualCc && (
                                    <button
                                      type="button"
                                      onClick={() => setShowManualCc(true)}
                                      className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                                    >
                                      Cc
                                    </button>
                                  )}
                                  {!showManualBcc && (
                                    <button
                                      type="button"
                                      onClick={() => setShowManualBcc(true)}
                                      className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                                    >
                                      Bcc
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* To field */}
                              <div className="space-y-1">
                                <span className="text-[10px] font-semibold uppercase text-slate-400">To</span>
                                <EmailChipInput
                                  value={manualTo}
                                  onChange={setManualTo}
                                  placeholder="Recipient..."
                                />
                              </div>

                              {/* Cc field */}
                              {showManualCc && (
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-semibold uppercase text-slate-400">Cc</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowManualCc(false);
                                        setManualCc([]);
                                      }}
                                      className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                    >
                                      Remove Cc
                                    </button>
                                  </div>
                                  <EmailChipInput
                                    value={manualCc}
                                    onChange={setManualCc}
                                    placeholder="Add CC recipient..."
                                  />
                                </div>
                              )}

                              {/* Bcc field */}
                              {showManualBcc && (
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-semibold uppercase text-slate-400">Bcc</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowManualBcc(false);
                                        setManualBcc([]);
                                      }}
                                      className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                    >
                                      Remove Bcc
                                    </button>
                                  </div>
                                  <EmailChipInput
                                    value={manualBcc}
                                    onChange={setManualBcc}
                                    placeholder="Add BCC recipient..."
                                  />
                                </div>
                              )}

                              {/* Preview Banner for Compose Mode */}
                              {composePreviewDraft && composePreviewDraft.mode === "compose" && (
                                <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-3 space-y-2 dark:border-indigo-800 dark:bg-indigo-950/40">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                                        <FiCpu className="h-3 w-3" />
                                        AI Draft Preview
                                      </span>
                                      {composePreviewDraft.sources && composePreviewDraft.sources.length > 0 && (
                                        <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200">
                                          Based on {composePreviewDraft.sources.map((s) => s.docTitle).join(", ")} ({composePreviewDraft.chunkCount} passages)
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                      <Button
                                        size="sm"
                                        variant="success"
                                        onClick={handleUseComposePreview}
                                        disabled={isUpdatingDraft}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                      >
                                        <FiCheck className="h-3.5 w-3.5 mr-1" />
                                        {isUpdatingDraft ? "Saving..." : "Use this"}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={handleDiscardComposePreview}
                                        disabled={isUpdatingDraft}
                                      >
                                        Discard
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => {
                                          setComposePreviewDraft(null);
                                          setAssistPanelOpen(true);
                                        }}
                                        disabled={isUpdatingDraft}
                                      >
                                        <FiRefreshCw className="h-3 w-3 mr-1" />
                                        Revise again
                                      </Button>
                                    </div>
                                  </div>

                                  {composePreviewDraft.ungrounded && (
                                    <div className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                                      <FiAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                      <span>Ungrounded: check the facts</span>
                                    </div>
                                  )}

                                  {composePreviewDraft.notices && composePreviewDraft.notices.length > 0 && (
                                    <div className="space-y-1 text-xs text-indigo-900 dark:text-indigo-200">
                                      {composePreviewDraft.notices.map((n, i) => (
                                        <p key={i} className="flex items-center gap-1.5">
                                          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span>
                                          {n}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              <textarea
                                value={manualReplyText}
                                onChange={(e) => setManualReplyText(e.target.value)}
                                rows={5}
                                placeholder="Write your reply to send directly to recipient..."
                                className="w-full resize-y rounded-md border border-slate-300 bg-white p-2.5 text-xs leading-5 text-slate-800 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-200"
                              />

                              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                <Button
                                  variant="success"
                                  onClick={handleManualSend}
                                  disabled={isBusy || !manualReplyText.trim()}
                                >
                                  <FiSend className="h-3.5 w-3.5" />
                                  {isManualSending ? "Sending..." : "Send Reply"}
                                </Button>
                              </div>

                              {manualSendError && (
                                <p className="mt-1 text-xs text-red-600">{manualSendError}</p>
                              )}

                              {/* Write with AI panel replaces Try AI draft button */}
                              <div className="mt-3">
                                <AiAssistPanel
                                  mode="compose"
                                  labelName={latestTurn?.label || item.label}
                                  userLabels={userLabels}
                                  knowledgeFiles={knowledgeFiles}
                                  onGenerate={handleAiAssistGenerate}
                                  onCancel={handleAiAssistCancel}
                                  isLoading={isAiAssisting}
                                  error={aiAssistError}
                                  statusNotice={aiAssistNotice}
                                  isOpen={assistPanelOpen}
                                  onToggle={() => setAssistPanelOpen((prev) => !prev)}
                                />
                              </div>
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
          {editor.state.showDiscardConfirm && isEditing && (
            <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
              <span>Discard changes? Unsaved edits will be lost.</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={handleConfirmDiscard}
                  className="h-6 px-2 text-[11px]"
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleKeepEditing}
                  className="h-6 px-2 text-[11px]"
                >
                  Keep editing
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                if (isEditing) {
                  handleCancel();
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
                  onClick={() => handleSave()}
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
