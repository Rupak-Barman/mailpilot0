import { FiCheck, FiFileText, FiCornerUpLeft, FiSquare } from "react-icons/fi";
import { Badge } from "../../components/common/Badge";
import { EmptyState } from "../../components/common/States";
import { formatDateTime, titleCase } from "../../utils/formatters";

export const EmailActionTable = ({ items = [], selectedId, onSelect }) => {
  if (items.length === 0) {
    return <EmptyState title="No draft or reply records" description="Generated replies and drafts will appear here after polling processes email." />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/90 dark:border-slate-700 dark:bg-slate-900/80">
      <div className="hidden min-w-[780px] lg:block">
        <table className="w-full text-left">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400 dark:border-slate-800">
            <tr>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Recipient</th>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {items.map(item => (
              <tr
                key={item._id}
                onClick={() => onSelect(item)}
                className={`cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/70 ${
                  selectedId === item._id ? "bg-blue-500/10 dark:bg-blue-400/10" : ""
                }`}
              >
                <td className="px-4 py-2.5">
                  {item.checked ? (
                    <FiCheck className="h-5 w-5 text-blue-500" />
                  ) : (
                    <FiSquare className="h-5 w-5 text-slate-400" />
                  )}
                </td>
                <td className="max-w-[260px] truncate px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">{item.subject || "No subject"}</td>
                <td className="max-w-[220px] truncate px-4 py-2.5 text-slate-500 dark:text-slate-400">{item.to || "Unknown"}</td>
                <td className="px-4 py-2.5"><Badge tone="blue">{item.label || "Unlabeled"}</Badge></td>
                <td className="px-4 py-2.5">
                  <Badge tone={item.type === "reply" ? "emerald" : "blue"}>
                    {item.type === "reply" ? <FiCornerUpLeft className="mr-1 h-3.5 w-3.5" /> : <FiFileText className="mr-1 h-3.5 w-3.5" />}
                    {titleCase(item.type)}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">{formatDateTime(item.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-slate-200 dark:divide-slate-800 lg:hidden">
        {items.map(item => (
          <button
            key={item._id}
            type="button"
            onClick={() => onSelect(item)}
            className="flex w-full flex-col gap-3 p-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/70"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{item.subject || "No subject"}</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{item.to || "Unknown"}</p>
              </div>
                    {item.checked ? <FiCheck className="h-5 w-5 text-blue-500" /> : <FiSquare className="h-5 w-5 text-slate-400" />}
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="blue">{item.label || "Unlabeled"}</Badge>
              <Badge tone={item.type === "reply" ? "emerald" : "blue"}>{titleCase(item.type)}</Badge>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
