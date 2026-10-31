import { FiSearch } from "react-icons/fi";
import { Input, Select } from "../../components/common/FormControls";

const tabs = [
  { label: "Unchecked", value: "unchecked" },
  { label: "Drafts", value: "draft" },
  { label: "Replies", value: "reply" },
  { label: "All", value: "all" }
];

export const EmailActionFilters = ({ filters, setFilters, summary }) => (
  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
    <div className="flex gap-2 overflow-x-auto pb-1">
      {tabs.map(tab => (
        <button
          key={tab.value}
          type="button"
          onClick={() => setFilters(current => ({ ...current, tab: tab.value, page: 1 }))}
          className={`h-8 shrink-0 rounded-md border px-3 text-xs font-semibold transition ${
            filters.tab === tab.value
              ? "border-blue-300 bg-blue-500/15 text-blue-700 shadow-lg shadow-blue-500/10 dark:text-blue-100"
              : "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          {tab.label}
          {tab.value === "unchecked" && (
            <span className="ml-2 rounded-full bg-blue-200 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-300 dark:text-blue-950">
              {summary?.unchecked || 0}
            </span>
          )}
        </button>
      ))}
    </div>

    <div className="grid gap-3 sm:grid-cols-[1fr_160px] xl:w-[520px]">
      <div className="relative">
        <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={filters.q}
          onChange={(event) => setFilters(current => ({ ...current, q: event.target.value, page: 1 }))}
          placeholder="Search subject, recipient, body"
          className="pl-9"
        />
      </div>
      <Select
        value={filters.checked}
        onChange={(event) => setFilters(current => ({ ...current, checked: event.target.value, page: 1 }))}
      >
        <option value="">Any status</option>
        <option value="false">Unchecked</option>
        <option value="true">Checked</option>
      </Select>
    </div>
  </div>
);
