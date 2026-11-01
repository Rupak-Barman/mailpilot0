import {
  FiInbox,
  FiSend,
  FiFileText,
  FiClock,
  FiAlertTriangle,
  FiHelpCircle,
  FiCheck,
  FiCheckCircle
} from "react-icons/fi";
import { Card } from "../../components/common/Card";
import { compactNumber } from "../../utils/formatters";

const metrics = [
  { key: "totalProcessed", fallbackKey: "totalEmails", label: "Total Processed", icon: FiInbox, tone: "text-slate-600 dark:text-slate-300" },
  { key: "sent",           fallbackKey: "reply",       label: "Replies Sent",   icon: FiSend,  tone: "text-emerald-600 dark:text-emerald-400" },
  { key: "drafted",        fallbackKey: "draft",       label: "Drafts Created", icon: FiFileText, tone: "text-blue-600 dark:text-blue-400" },
  { key: "draftsPending",  fallbackKey: null,          label: "Drafts Pending", icon: FiClock, tone: "text-indigo-600 dark:text-indigo-400" },
  { key: "failed",         fallbackKey: null,          label: "Failed",         icon: FiAlertTriangle, tone: "text-rose-600 dark:text-rose-400" },
  { key: "needsManual",    fallbackKey: null,          label: "Needs Manual",   icon: FiHelpCircle, tone: "text-amber-600 dark:text-amber-400" },
  { key: "resolvedManually", fallbackKey: null,        label: "Resolved Manually", icon: FiCheck, tone: "text-teal-600 dark:text-teal-400" }
];

export const MetricCards = ({ totals = {}, summary = {} }) => {
  const uncheckedCount = summary.unchecked ?? totals.unchecked ?? 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        const val = totals[metric.key] ?? (metric.fallbackKey ? totals[metric.fallbackKey] : 0) ?? 0;
        return (
          <Card key={metric.key} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {metric.label}
                </p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
                  {compactNumber(val)}
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
              All time · Requires review
            </p>
          </div>
          <FiCheckCircle className="h-5 w-5 text-amber-500 dark:text-amber-400" />
        </div>
      </Card>
    </div>
  );
};
