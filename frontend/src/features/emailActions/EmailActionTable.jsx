import { FiCheck, FiFileText, FiCornerUpLeft, FiSquare } from "react-icons/fi";
import { Badge } from "../../components/common/Badge";
import { EmptyState } from "../../components/common/States";
import { formatDateTime, titleCase } from "../../utils/formatters";
import { getItemStatus, getStatusBadgeConfig } from "../../utils/filterRules";

export const getFailureReasonLabel = (reason) => {
  if (!reason) return "Other";
  const r = String(reason).toLowerCase();
  if (r.includes("knowledge") || r === "no_knowledge_match") {
    return "No knowledge match";
  }
  if (
    r.includes("invalid") ||
    r.includes("placeholder") ||
    r.includes("empty_body") ||
    r.includes("markdown") ||
    r.includes("json") ||
    r.includes("invented")
  ) {
    return "Invalid AI output";
  }
  if (
    r.includes("unavailable") ||
    r.includes("transient") ||
    r.includes("connect") ||
    r.includes("timeout") ||
    r.includes("ollama")
  ) {
    return "AI unavailable";
  }
  return "Other";
};

const getEmptyStateContent = (tab) => {
  switch (tab) {
    case "failed":
      return {
        title: "No failed emails",
        description: "Emails requiring manual attention or where AI generation failed will appear here."
      };
    case "draft":
      return {
        title: "No drafts",
        description: "Generated drafts awaiting your review will appear here."
      };
    case "reply":
      return {
        title: "No replies",
        description: "Sent replies and conversation threads will appear here."
      };
    case "unchecked":
      return {
        title: "No unchecked emails",
        description: "All caught up! New emails awaiting attention will appear here."
      };
    case "all":
    default:
      return {
        title: "No emails found",
        description: "Try adjusting your search query or filter options."
      };
  }
};

export const EmailActionTable = ({
  items = [],
  selectedId,
  onSelect,
  onToggleChecked,
  isLoading = false,
  currentTab = "unchecked"
}) => {
  if (!isLoading && items.length === 0) {
    const empty = getEmptyStateContent(currentTab);
    return (
      <EmptyState
        title={empty.title}
        description={empty.description}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* Desktop Table View */}
      <div className="hidden min-w-[780px] lg:block">
        <table className="w-full text-left">
          <thead className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:border-zinc-800">
            <tr>
              <th className="w-14 px-4 py-3">Checked</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Recipient</th>
              <th className="px-4 py-3">Messages</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
            {isLoading ? (
              // Skeleton rows inside table while loading
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="animate-pulse">
                  <td className="px-4 py-3">
                    <div className="h-4 w-4 rounded bg-slate-200 dark:bg-zinc-800" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-48 rounded bg-slate-200 dark:bg-zinc-800" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-32 rounded bg-slate-200 dark:bg-zinc-800" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-16 rounded bg-slate-200 dark:bg-zinc-800" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-5 w-20 rounded bg-slate-200 dark:bg-zinc-800" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-5 w-20 rounded bg-slate-200 dark:bg-zinc-800" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-5 w-16 rounded bg-slate-200 dark:bg-zinc-800" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-24 rounded bg-slate-200 dark:bg-zinc-800" />
                  </td>
                </tr>
              ))
            ) : (
              items.map((item) => {
                const messageCount = item.turns?.length || 1;
                const isNewReply = !item.checked && messageCount > 1;
                const latestTurn =
                  item.turns && item.turns.length > 0
                    ? item.turns[item.turns.length - 1]
                    : null;
                const type =
                  latestTurn?.outgoing?.kind || item.type || "draft";
                const status = getItemStatus(item);
                const { label: statusLabel, tone: statusTone } =
                  getStatusBadgeConfig(status);
                const isFailed = status === "failed";
                const failureReason =
                  latestTurn?.failureReason || item.failureReason;

                return (
                  <tr
                    key={item._id}
                    onClick={() => onSelect(item)}
                    className={`cursor-pointer transition hover:bg-slate-50 dark:hover:bg-zinc-800/60 ${
                      selectedId === item._id
                        ? "bg-slate-100 dark:bg-zinc-800"
                        : ""
                    }`}
                  >
                    {/* Separate labelled checkbox for checked/unchecked */}
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleChecked?.(item);
                        }}
                        aria-label={item.checked ? "Mark unchecked" : "Mark checked"}
                        title={
                          item.checked
                            ? "Checked (click to uncheck)"
                            : "Unchecked (click to mark checked)"
                        }
                        className="group flex h-7 w-7 items-center justify-center rounded-md border border-transparent transition hover:border-slate-300 dark:hover:border-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer"
                      >
                        {item.checked ? (
                          <FiCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <FiSquare className="h-4 w-4 text-slate-300 group-hover:text-slate-400 dark:text-zinc-600 dark:group-hover:text-zinc-500" />
                        )}
                      </button>
                    </td>

                    {/* Subject + New reply marker */}
                    <td className="max-w-[260px] px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                          {item.subject || "No subject"}
                        </span>
                        {isNewReply && (
                          <span className="inline-flex shrink-0 items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                            New reply
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Recipient */}
                    <td className="max-w-[200px] truncate px-4 py-2.5 text-slate-500 dark:text-slate-400">
                      {item.to || "Unknown"}
                    </td>

                    {/* Messages Count */}
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                      {messageCount} {messageCount === 1 ? "message" : "messages"}
                    </td>

                    {/* Status Column with Labelled Badges */}
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={statusTone}>{statusLabel}</Badge>
                        {isFailed && failureReason && (
                          <Badge tone="amber">
                            {getFailureReasonLabel(failureReason)}
                          </Badge>
                        )}
                      </div>
                    </td>

                    {/* Category */}
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge tone="blue">{item.label || "Uncategorized"}</Badge>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Badge tone={type === "reply" ? "emerald" : "slate"}>
                        {type === "reply" ? (
                          <FiCornerUpLeft className="mr-1 h-3.5 w-3.5" />
                        ) : (
                          <FiFileText className="mr-1 h-3.5 w-3.5" />
                        )}
                        {titleCase(type)}
                      </Badge>
                    </td>

                    {/* Created */}
                    <td className="px-4 py-2.5 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                      {formatDateTime(item.createdAt)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="divide-y divide-slate-100 dark:divide-zinc-800 lg:hidden">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={`m-skeleton-${i}`} className="animate-pulse space-y-3 p-4">
              <div className="flex items-center justify-between">
                <div className="h-4 w-40 rounded bg-slate-200 dark:bg-zinc-800" />
                <div className="h-4 w-4 rounded bg-slate-200 dark:bg-zinc-800" />
              </div>
              <div className="h-3 w-28 rounded bg-slate-200 dark:bg-zinc-800" />
              <div className="flex gap-2">
                <div className="h-5 w-16 rounded bg-slate-200 dark:bg-zinc-800" />
                <div className="h-5 w-16 rounded bg-slate-200 dark:bg-zinc-800" />
              </div>
            </div>
          ))
        ) : (
          items.map((item) => {
            const messageCount = item.turns?.length || 1;
            const isNewReply = !item.checked && messageCount > 1;
            const latestTurn =
              item.turns && item.turns.length > 0
                ? item.turns[item.turns.length - 1]
                : null;
            const type =
              latestTurn?.outgoing?.kind || item.type || "draft";
            const status = getItemStatus(item);
            const { label: statusLabel, tone: statusTone } =
              getStatusBadgeConfig(status);
            const isFailed = status === "failed";
            const failureReason =
              latestTurn?.failureReason || item.failureReason;

            return (
              <div
                key={item._id}
                onClick={() => onSelect(item)}
                className="flex w-full flex-col gap-3 p-4 text-left transition hover:bg-slate-50 dark:hover:bg-zinc-800/60 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                        {item.subject || "No subject"}
                      </p>
                      {isNewReply && (
                        <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                          New reply
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
                      {item.to || "Unknown"}
                    </p>
                  </div>

                  {/* Separate labelled checkbox on mobile */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleChecked?.(item);
                    }}
                    aria-label={item.checked ? "Mark unchecked" : "Mark checked"}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-zinc-700 dark:text-slate-300 dark:hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer"
                  >
                    {item.checked ? (
                      <>
                        <FiCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>Checked</span>
                      </>
                    ) : (
                      <>
                        <FiSquare className="h-3.5 w-3.5 text-slate-400" />
                        <span>Unchecked</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone}>{statusLabel}</Badge>
                  {isFailed && failureReason && (
                    <Badge tone="amber">
                      {getFailureReasonLabel(failureReason)}
                    </Badge>
                  )}
                  <span className="text-xs text-slate-400">
                    {messageCount} {messageCount === 1 ? "msg" : "msgs"}
                  </span>
                  <Badge tone="blue">{item.label || "Uncategorized"}</Badge>
                  <Badge tone={type === "reply" ? "emerald" : "slate"}>
                    {titleCase(type)}
                  </Badge>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
