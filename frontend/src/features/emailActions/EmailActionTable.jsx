import { FiCheck, FiFileText, FiCornerUpLeft, FiSquare } from "react-icons/fi";
import { Badge } from "../../components/common/Badge";
import { EmptyState } from "../../components/common/States";
import { formatDateTime, titleCase } from "../../utils/formatters";

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

export const EmailActionTable = ({ items = [], selectedId, onSelect }) => {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No draft or reply records"
        description="Generated replies and drafts will appear here after polling processes email."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="hidden min-w-[780px] lg:block">
        <table className="w-full text-left">
          <thead className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:border-zinc-800">
            <tr>
              <th className="w-12 px-4 py-3">Checked</th>
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
            {items.map((item) => {
              const messageCount = item.turns?.length || 1;
              const isNewReply = !item.checked && messageCount > 1;
              const latestTurn =
                item.turns && item.turns.length > 0
                  ? item.turns[item.turns.length - 1]
                  : null;
              const status =
                latestTurn?.outgoing?.status || item.status || "draft";
              const type =
                latestTurn?.outgoing?.kind || item.type || "draft";

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
                  {/* Checked checkbox */}
                  <td className="px-4 py-2.5">
                    {item.checked ? (
                      <FiCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <FiSquare className="h-4 w-4 text-slate-300 dark:text-zinc-600" />
                    )}
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

                  {/* Status from latest turn */}
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <Badge tone={getStatusTone(status)}>
                      {titleCase(status)}
                    </Badge>
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
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile view */}
      <div className="divide-y divide-slate-100 dark:divide-zinc-800 lg:hidden">
        {items.map((item) => {
          const messageCount = item.turns?.length || 1;
          const isNewReply = !item.checked && messageCount > 1;
          const latestTurn =
            item.turns && item.turns.length > 0
              ? item.turns[item.turns.length - 1]
              : null;
          const status =
            latestTurn?.outgoing?.status || item.status || "draft";
          const type =
            latestTurn?.outgoing?.kind || item.type || "draft";

          return (
            <button
              key={item._id}
              type="button"
              onClick={() => onSelect(item)}
              className="flex w-full flex-col gap-3 p-4 text-left transition hover:bg-slate-50 dark:hover:bg-zinc-800/60"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
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

                {item.checked ? (
                  <FiCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <FiSquare className="h-4 w-4 shrink-0 text-slate-300 dark:text-zinc-600" />
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={getStatusTone(status)}>
                  {titleCase(status)}
                </Badge>
                <span className="text-xs text-slate-400">
                  {messageCount} {messageCount === 1 ? "msg" : "msgs"}
                </span>
                <Badge tone="blue">{item.label || "Uncategorized"}</Badge>
                <Badge tone={type === "reply" ? "emerald" : "slate"}>
                  {titleCase(type)}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
