import { FiFileText, FiInbox, FiMinusCircle, FiSend, FiCheckCircle } from "react-icons/fi";
import { Card } from "../../components/common/Card";
import { compactNumber } from "../../utils/formatters";

const metrics = [
  { key: "totalEmails", label: "Total Emails",   icon: FiInbox,       tone: "text-slate-600 dark:text-slate-300" },
  { key: "reply",       label: "Replies Sent",   icon: FiSend,        tone: "text-emerald-600 dark:text-emerald-400" },
  { key: "draft",       label: "Drafts Created", icon: FiFileText,    tone: "text-blue-600 dark:text-blue-400" },
  { key: "none",        label: "No Action",      icon: FiMinusCircle, tone: "text-slate-400 dark:text-slate-500" }
];

export const MetricCards = ({ totals = {}, summary = {} }) => {
  const uncheckedCount = summary.unchecked ?? totals.unchecked ?? 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <Card key={metric.key} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {metric.label}
                </p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
                  {compactNumber(totals[metric.key] || 0)}
                </p>
              </div>
              <Icon className={`h-5 w-5 ${metric.tone}`} />
            </div>
          </Card>
        );
      })}

      <Card className="p-4 border-slate-300 bg-slate-50/50 dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Unchecked Items
            </p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              {compactNumber(uncheckedCount)}
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Requires review
            </p>
          </div>
          <FiCheckCircle className="h-5 w-5 text-amber-500 dark:text-amber-400" />
        </div>
      </Card>
    </div>
  );
};
