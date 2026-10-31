import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { FiMoreHorizontal } from "react-icons/fi";
import { Card } from "../../components/common/Card";
import { compactNumber } from "../../utils/formatters";

const actionColors = {
  draft: "#a9c7ff",
  reply: "#4ade80",
  none: "#fca5a5"
};

export const VolumeTrendChart = ({ days = [] }) => (
  <Card className="flex flex-col p-4">
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-lg font-bold text-slate-950 dark:text-slate-50">Volume Trend</h2>
      <FiMoreHorizontal className="h-5 w-5 text-slate-400" />
    </div>
    <div className="flex-1 min-h-0 rounded-md border border-slate-200 bg-slate-100 p-3 dark:border-slate-800 dark:bg-slate-950/60">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={days}>
          <defs>
            <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#4ade80" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#4ade80" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }}
          />
          <Area type="monotone" dataKey="totalEmails" stroke="#4ade80" strokeWidth={4} fill="url(#volumeFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </Card>
);

export const ActionBreakdown = ({ totals = {} }) => {
  const data = [
    { name: "Drafts", value: totals.draft || 0, key: "draft" },
    { name: "Replies", value: totals.reply || 0, key: "reply" },
    { name: "None", value: totals.none || 0, key: "none" }
  ];
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <Card className="flex flex-col p-4">
      <h2 className="text-lg font-bold text-slate-950 dark:text-slate-50">Action Breakdown</h2>
      <div className="relative mt-3 flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
              {data.map(item => <Cell key={item.key} fill={actionColors[item.key]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-2xl font-bold text-slate-950 dark:text-slate-50">{compactNumber(total)}</p>
          <p className="text-xs font-semibold text-slate-400">Total</p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {data.map(item => {
          const percent = total ? Math.round((item.value / total) * 100) : 0;
          return (
            <div key={item.key} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: actionColors[item.key] }} />
                {item.name}
              </span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">{percent}%</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export const LabelDistribution = ({ labels = {} }) => {
  const entries = Object.entries(labels).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, value]) => value), 1);
  const colors = ["bg-blue-300", "bg-emerald-400", "bg-rose-300", "bg-blue-300", "bg-slate-400"];

  return (
    <Card className="flex flex-col p-4 overflow-auto">
      <h2 className="text-lg font-bold text-slate-950 dark:text-slate-50">Label Distribution</h2>
      <div className="mt-3 space-y-3 flex-1">
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No label data yet.</p>
        ) : entries.map(([label, value], index) => {
          const percent = Math.round((value / max) * 100);
          return (
            <div key={label} className="grid grid-cols-[120px_1fr_48px] items-center gap-4 text-sm">
              <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
              <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800">
                <div className={`h-full rounded-full ${colors[index % colors.length]}`} style={{ width: `${percent}%` }} />
              </div>
              <span className="text-right font-semibold text-slate-500 dark:text-slate-300">{value}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
};
