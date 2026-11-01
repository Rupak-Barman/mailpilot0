import { useEffect, useRef } from "react";
import { FiAlertTriangle, FiLoader } from "react-icons/fi";
import { Button } from "../../components/common/Button";

export const DeleteRuleDialog = ({
  isOpen,
  rule,
  onClose,
  onConfirm,
  isDeleting = false
}) => {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !isDeleting) {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isDeleting, onClose]);

  if (!isOpen || !rule) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      aria-describedby="delete-dialog-desc"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 animate-in zoom-in-95 duration-150 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
            <FiAlertTriangle className="h-5 w-5" />
          </div>

          <div>
            <h3
              id="delete-dialog-title"
              className="text-base font-bold text-slate-900 dark:text-slate-100"
            >
              Delete routing rule &ldquo;{rule.name}&rdquo;?
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              This action permanently deletes this rule and cannot be undone.
            </p>
          </div>
        </div>

        <div
          id="delete-dialog-desc"
          className="rounded-lg bg-slate-50 p-3.5 text-xs text-slate-700 dark:bg-zinc-800/60 dark:text-slate-300 space-y-2 border border-slate-100 dark:border-zinc-800"
        >
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            What happens when you delete this rule:
          </p>
          <ul className="list-disc pl-4 space-y-1.5 text-slate-600 dark:text-slate-300">
            <li>
              The routing rule will be removed from Mailpilot.
            </li>
            <li>
              The corresponding <strong>{rule.name}</strong> label will be deleted from your Gmail account.
            </li>
            <li>
              Existing emails in your inbox will <strong>not</strong> be deleted, but they will no longer carry this Gmail label.
            </li>
            <li>
              Future incoming emails will no longer be routed by this rule.
            </li>
          </ul>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={isDeleting}
            className="min-w-28"
          >
            {isDeleting ? (
              <>
                <FiLoader className="h-3.5 w-3.5 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete rule"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

