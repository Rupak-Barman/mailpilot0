import { FiMail, FiWifi } from "react-icons/fi";
import { Card } from "../../components/common/Card";
import { Badge } from "../../components/common/Badge";
import { useUpdateProfileSettings } from "../../hooks/useProfileSettings";

export const AccountPanel = ({ profile, settings }) => {
  const updateSettings = useUpdateProfileSettings();
  const currentSettings = settings || profile?.settings || {};
  const groupBySender = Boolean(currentSettings.groupBySender);

  const handleToggle = () => {
    updateSettings.mutate({
      groupBySender: !groupBySender,
    });
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-400/15 dark:text-blue-200">
            <FiMail className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Connected Account</p>
            <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {profile?.email || "Not connected"}
            </p>
          </div>
        </div>

        <Badge tone="emerald" className="w-fit">
          <FiWifi className="mr-1 h-3.5 w-3.5" />
          Active Sync
        </Badge>
      </div>

      <div className="border-t border-slate-100 pt-4 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Group follow-ups by sender
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Group follow-ups from the same sender into one conversation even when the subject differs (within 14 days).
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={groupBySender}
            onClick={handleToggle}
            disabled={updateSettings.isPending}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${
              groupBySender ? "bg-blue-600" : "bg-slate-200 dark:bg-zinc-700"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                groupBySender ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>
    </Card>
  );
};
