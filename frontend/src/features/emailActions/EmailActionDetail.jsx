import { useEffect, useState } from "react";

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
} from "react-icons/fi";

import { Button } from "../../components/common/Button";
import { Badge } from "../../components/common/Badge";
import { formatDateTime, titleCase } from "../../utils/formatters";

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
      />
    )}
  </>
);

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
}) => {
  const [isEditing, setIsEditing] = useState(false);

  const [form, setForm] = useState({
    to: item.to || "",
    subject: item.subject || "",
    body: item.body || "",
  });

  // Label editing state
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(item.label || "");

  useEffect(() => {
    setForm({
      to: item.to || "",
      subject: item.subject || "",
      body: item.body || "",
    });

    setLabelValue(item.label || "");
    setIsEditingLabel(false);
  }, [item._id, item.to, item.subject, item.body, item.label]);

  const isDraft = item.type === "draft";
  const isSent = item.status === "sent";

  const isSendingNow = isSending || item.status === "sending";

  const cannotRetry = item.status === "send_failed";

  const canEditDraft =
    isDraft && (!item.status || item.status === "draft");

  const isBusy =
    isUpdatingDraft ||
    isDeletingDraft ||
    isUpdatingLabel ||
    isSendingNow;

  const handleFieldChange = (event) => {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  // Save draft changes
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
      },
    );
  };

  // Delete draft
  const handleDelete = () => {
    const confirmed = window.confirm(
      "Permanently delete this draft from Gmail and Mailpilot? This cannot be undone.",
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

    onUpdateLabel(
      item,
      labelValue.trim(),
      () => {
        setIsEditingLabel(false);
      },
    );
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden"
        onClick={onClose}
      />

      <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-700 dark:bg-slate-950 sm:w-[480px]">

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
              {titleCase(item.type)} Details
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            <FiX className="h-5 w-5" />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">

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

            {/* Recipient */}
            <div className="sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                To
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

            {/* AI Label */}
            <div className="sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                AI Label
              </p>

              {!isEditingLabel ? (
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone="blue">
                    {item.label || "Unlabeled"}
                  </Badge>

                  {canEditDraft && (
                    <button
                      type="button"
                      onClick={() => setIsEditingLabel(true)}
                      disabled={isBusy}
                      className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 dark:text-blue-400"
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
                    placeholder="Enter label"
                    autoFocus
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="success"
                      onClick={handleSaveLabel}
                      disabled={isUpdatingLabel}
                    >
                      <FiSave className="h-4 w-4" />
                      {isUpdatingLabel ? "Saving..." : "Save Label"}
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
                    <p className="text-xs text-red-600">
                      {labelError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Generated information */}
          <div className="mt-6 flex items-center justify-between">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-200">
              {item.type === "reply" ? (
                <FiCornerUpLeft className="h-4 w-4" />
              ) : (
                <FiFileText className="h-4 w-4" />
              )}

              Generated {item.type}
            </p>

            <p className="text-sm text-slate-400">
              {formatDateTime(item.createdAt)}
            </p>
          </div>

          {/* Email Body */}
          {isEditing ? (
            <div className="mt-4">
              <label
                htmlFor="draft-body"
                className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400"
              >
                Email Body
              </label>

              <textarea
                id="draft-body"
                name="body"
                value={form.body}
                onChange={handleFieldChange}
                rows={12}
                maxLength={100000}
                className="w-full resize-y rounded-lg border border-slate-300 bg-white p-4 text-sm leading-6 text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              />
            </div>
          ) : (
            <div className="mt-4 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-100 p-4 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              {item.body || "No generated body stored."}
            </div>
          )}

          {/* Sent status */}
          {isSent && (
            <div className="mt-4">
              <Badge tone="emerald">
                Successfully sent
              </Badge>

              {item.sentAt && (
                <p className="mt-2 text-xs text-slate-500">
                  Sent at: {formatDateTime(item.sentAt)}
                </p>
              )}
            </div>
          )}

          {/* Send failed warning */}
          {cannotRetry && (
            <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">
              The sending result could not be confirmed. Check your Gmail Sent
              folder before taking further action.
            </p>
          )}

          {/* Errors */}
          {sendError && (
            <p className="mt-4 text-sm text-red-600">
              {sendError}
            </p>
          )}

          {updateError && (
            <p className="mt-4 text-sm text-red-600">
              {updateError}
            </p>
          )}

          {deleteError && (
            <p className="mt-4 text-sm text-red-600">
              {deleteError}
            </p>
          )}

          {/* Original Thread Context */}
          <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Original Thread Context
            </p>

            <p className="mt-3 break-words text-sm leading-6 text-slate-500 dark:text-slate-400">
              Source message id: {item.sourceMessageId || "Unavailable"}
            </p>
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
                    body: item.body || "",
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

            <div className="flex flex-wrap gap-2">

              {/* Edit and Delete */}
              {canEditDraft && !isEditing && !isEditingLabel && (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => setIsEditing(true)}
                    disabled={isBusy}
                  >
                    <FiEdit2 className="h-4 w-4" />
                    Edit
                  </Button>

                  <Button
                    variant="ghost"
                    onClick={handleDelete}
                    disabled={isBusy}
                  >
                    <FiTrash2 className="h-4 w-4" />
                    {isDeletingDraft ? "Deleting..." : "Delete"}
                  </Button>
                </>
              )}

              {/* Save Draft */}
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

              {/* Send Draft */}
              {isDraft && !isEditing && !isEditingLabel && !isSent && (
                <Button
                  variant="success"
                  onClick={() => onSendDraft(item)}
                  disabled={isBusy || cannotRetry}
                >
                  <FiSend className="h-4 w-4" />
                  {isSendingNow ? "Sending..." : "Send Now"}
                </Button>
              )}

              {isSent && (
                <Badge tone="emerald">
                  Sent
                </Badge>
              )}

              {/* Checked status */}
              {!isEditing && !isEditingLabel && (
                <Button
                  variant={item.checked ? "ghost" : "success"}
                  onClick={() => onToggleChecked(item)}
                  disabled={isSaving || isBusy}
                >
                  <FiCheckCircle className="h-4 w-4" />
                  {item.checked
                    ? "Mark as Unchecked"
                    : "Mark as Checked"}
                </Button>
              )}
            </div>
          </div>
        </footer>
      </aside>
    </>
  );
};