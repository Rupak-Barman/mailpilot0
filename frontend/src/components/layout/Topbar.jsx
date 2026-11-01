import { FiMoon, FiSun } from "react-icons/fi";
import { Button } from "../common/Button";
import { useAuth } from "../../hooks/useAuth";
import { useSyncStatus } from "../../hooks/useSyncStatus";

export const Topbar = ({ email, realtimeStatus }) => {
  const { theme, setTheme } = useAuth();
  const nextTheme = theme === "dark" ? "light" : "dark";
  const { data: syncData, isLoading, isError } = useSyncStatus();

  let dotColor = "bg-emerald-500";
  let statusText = "Synced";
  let textColor = "text-slate-500 dark:text-slate-400";
  let tooltip = "Gmail sync is up to date";

  if (isLoading) {
    dotColor = "bg-slate-400 animate-pulse";
    statusText = "Checking sync...";
    textColor = "text-slate-400 dark:text-slate-500";
    tooltip = "Checking sync status...";
  } else if (isError) {
    dotColor = "bg-rose-500";
    statusText = "Sync offline";
    textColor = "text-rose-500 dark:text-rose-400";
    tooltip = "Unable to reach server sync endpoint";
  } else if (syncData?.needsRelogin) {
    dotColor = "bg-amber-500 animate-pulse";
    statusText = "Re-login required";
    textColor = "text-amber-600 dark:text-amber-400";
    tooltip = "Google credentials expired. Please log out and back in.";
  } else if (syncData?.ollamaReachable === false) {
    dotColor = "bg-amber-500";
    statusText = "AI offline";
    textColor = "text-amber-600 dark:text-amber-400";
    tooltip = "Ollama is unreachable. Automatic replies and drafts are paused.";
  } else if (syncData?.status === "running") {
    dotColor = "bg-emerald-500 animate-pulse";
    statusText =
      syncData?.queueSize > 0
        ? `Syncing (${syncData.queueSize})`
        : "Syncing...";
    textColor = "text-emerald-600 dark:text-emerald-400";
    tooltip = "Processing incoming emails";
  } else if (syncData?.status === "error") {
    dotColor = "bg-rose-500";
    statusText = "Sync error";
    textColor = "text-rose-600 dark:text-rose-400";
    tooltip = syncData?.error || "An error occurred during sync";
  } else {
    dotColor = "bg-emerald-500";
    statusText = "Synced";
    textColor = "text-slate-500 dark:text-slate-400";
    tooltip = syncData?.lastSync
      ? `Last synced: ${new Date(syncData.lastSync).toLocaleTimeString()}`
      : "Sync idle";
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950 lg:pl-72 lg:pr-7">
      {/* Left: sync status & realtime indicator */}
      <div className="flex items-center gap-3">
        <div
          className={`flex items-center gap-2 text-xs font-medium ${textColor}`}
          title={tooltip}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
          {statusText}
        </div>

        {/* Realtime stream indicator */}
        {realtimeStatus === "live" && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
            title="Realtime stream active"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        )}

        {realtimeStatus === "reconnecting" && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
            title="Reconnecting realtime stream..."
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            Reconnecting...
          </span>
        )}
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          className="h-8 w-8 px-0"
          onClick={() => setTheme(nextTheme)}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <FiSun className="h-4 w-4" />
          ) : (
            <FiMoon className="h-4 w-4" />
          )}
        </Button>

        {email && (
          <span className="hidden rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-slate-400 sm:inline">
            {email}
          </span>
        )}
      </div>
    </header>
  );
};
