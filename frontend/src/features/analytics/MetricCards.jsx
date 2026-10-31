import { FiFileText, FiInbox, FiMinusCircle, FiSend, FiEdit3 } from "react-icons/fi";
import { Card } from "../../components/common/Card";
import { compactNumber } from "../../utils/formatters";

const metrics = [
  { key: "totalEmails", label: "Total Emails", icon: FiInbox, tone: "text-blue-400" },
  { key: "reply", label: "Replies Sent", icon: FiSend, tone: "text-emerald-400" },
  { key: "draft", label: "Drafts Created", icon: FiFileText, tone: "text-blue-400" },
  { key: "none", label: "No Action", icon: FiMinusCircle, tone: "text-rose-300" }
];

export const MetricCards = ({ totals = {}, summary = {} }) => (
  <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
    {metrics.map((metric) => {
      const Icon = metric.icon;
      return (
        <Card key={metric.key} className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{metric.label}</p>
              <p className="mt-1 text-xl font-bold text-slate-950 dark:text-slate-50">{compactNumber(totals[metric.key] || 0)}</p>
            </div>
            <Icon className={`h-5 w-5 ${metric.tone}`} />
          </div>
        </Card>
      );
    })}

    <Card className="border-emerald-300 bg-emerald-400 p-3 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-400">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider">Unchecked Items</p>
          <p className="mt-1 text-2xl font-black">{compactNumber(summary.unchecked || 0)}</p>
        </div>
        <FiEdit3 className="h-5 w-5" />
      </div>
      <p className="mt-1 text-sm font-semibold opacity-80">Requires review</p>
    </Card>
  </div>
);
