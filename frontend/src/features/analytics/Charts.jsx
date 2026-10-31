import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer
} from "recharts";
import { FiCornerUpLeft, FiFileText, FiClock } from "react-icons/fi";
import { Card } from "../../components/common/Card";
import { Badge } from "../../components/common/Badge";
import { compactNumber, formatDateTime, titleCase } from "../../utils/formatters";

const actionColors = {
  draft: "#3b82f6", // muted primary blue
  reply: "#16a34a", // success green
  none: "#94a3b8"  // slate neutral
};

/**
 * Recent Activity Feed
 * Displays the latest processed email actions with category and status badges.
 */
export const RecentActivityFeed = ({ items = [] }) => (
  <Card className="flex flex-col p-5">
    <div className="mb-4 flex items-center justify-between">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Recent Activity
        </h2>
        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
          Latest processed emails and agent actions
        </p>
      </div>
      <FiClock className="h-4 w-4 text-slate-400" />
    </div>

    {items.length === 0 ? (
      <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 p-6 text-center dark:border-zinc-800">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          No recent activity
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Processed drafts and replies will appear here automatically.
        </p>
      </div>
    ) : (
      <div className="divide-y divide-slate-100 dark:divide-zinc-800">
        {items.map((item) => (
          <div
            key={item._id}
            className="flex items-center justify-between gap-4 py-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-zinc-800">
                {item.type === "reply" ? (
                  <FiCornerUpLeft className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <FiFileText className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                )}
              </span>

              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {item.subject || "No subject"}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="truncate max-w-[180px]">{item.to || "Unknown"}</span>
                  {item.label && (
                    <Badge tone="blue" className="py-0 text-[10px]">
                      {item.label}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
              <Badge
                tone={
                  item.status === "sent"
                    ? "emerald"
                    : item.status === "send_failed"
                      ? "rose"
                      : "slate"
                }
              >
                {item.status ? titleCase(item.status.replace("_", " ")) : titleCase(item.type)}
              </Badge>
              <span className="text-[11px] text-slate-400">
                {formatDateTime(item.createdAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    )}
  </Card>
);

/**
 * Action Breakdown Pie Chart
 */
export const ActionBreakdown = ({ totals = {} }) => {
  const data = [
    { name: "Drafts", value: totals.draft || 0, key: "draft" },
    { name: "Replies", value: totals.reply || 0, key: "reply" },
    { name: "None", value: totals.none || 0, key: "none" }
  ];
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <Card className="flex flex-col p-5">
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        Action Breakdown
      </h2>

      {total === 0 ? (
        <div className="flex min-h-40 items-center justify-center p-4 text-xs text-slate-400">
          No actions recorded in this period.
        </div>
      ) : (
        <>
          <div className="relative mt-2 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {data.map((item) => (
                    <Cell key={item.key} fill={actionColors[item.key]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {compactNumber(total)}
              </p>
              <p className="text-[11px] font-medium text-slate-400">Total</p>
            </div>
          </div>

          <div className="mt-2 space-y-1.5">
            {data.map((item) => {
              const percent = total ? Math.round((item.value / total) * 100) : 0;
              return (
                <div
                  key={item.key}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: actionColors[item.key] }}
                    />
                    {item.name}
                  </span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {percent}% ({item.value})
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
};

/**
 * Label Distribution
 */
export const LabelDistribution = ({ labels = {} }) => {
  const entries = Object.entries(labels).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, value]) => value), 1);
  const barColors = ["bg-blue-600", "bg-emerald-600", "bg-slate-500", "bg-amber-600", "bg-slate-400"];

  return (
    <Card className="flex flex-col p-5">
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        Category Distribution
      </h2>

      <div className="mt-3 flex-1 space-y-3">
        {entries.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">
            No category data in this period.
          </p>
        ) : (
          entries.map(([label, value], index) => {
            const percent = Math.round((value / max) * 100);
            return (
              <div
                key={label}
                className="grid grid-cols-[110px_1fr_40px] items-center gap-3 text-xs"
              >
                <span className="truncate font-medium text-slate-700 dark:text-slate-300">
                  {label}
                </span>
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-zinc-800">
                  <div
                    className={`h-full rounded-full ${barColors[index % barColors.length]}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span className="text-right font-medium text-slate-400 dark:text-slate-500">
                  {value}
                </span>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
};
