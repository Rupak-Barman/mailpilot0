import { useEffect, useState } from "react";
import { FiSearch } from "react-icons/fi";
import { Input, Select } from "../../components/common/FormControls";

const tabs = [
  { label: "Unchecked", value: "unchecked", key: "unchecked" },
  { label: "Drafts",    value: "draft",     key: "drafts" },
  { label: "Replies",   value: "reply",     key: "replies" },
  { label: "All",       value: "all",       key: "total" }
];

export const EmailActionFilters = ({ filters, setFilters, summary }) => {
  const [searchTerm, setSearchTerm] = useState(filters.q || "");

  // Debounce search input by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setFilters(current => {
        if (current.q === searchTerm) return current;
        return { ...current, q: searchTerm, page: 1 };
      });
    }, 300);

    return () => clearTimeout(handler);
  }, [searchTerm, setFilters]);

  // Synchronize internal search state if filters.q is externally reset
  useEffect(() => {
    if (filters.q !== searchTerm && filters.q === "") {
      setSearchTerm("");
    }
  }, [filters.q]);

  const handleTabChange = (tabValue) => {
    setFilters(current => ({
      ...current,
      tab: tabValue,
      page: 1
    }));
  };

  const handleStatusChange = (statusValue) => {
    setFilters(current => ({
      ...current,
      status: statusValue,
      page: 1
    }));
  };

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
      {/* Tabs with accurate badges */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((tab) => {
          const count = summary ? (summary[tab.key] ?? 0) : 0;
          const isActive = filters.tab === tab.value;

          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => handleTabChange(tab.value)}
              className={`h-8 shrink-0 rounded-md border px-3 text-xs font-medium transition ${
                isActive
                  ? "border-slate-300 bg-white text-slate-900 shadow-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-slate-100"
                  : "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-slate-400 dark:hover:bg-zinc-800"
              }`}
            >
              {tab.label}
              <span
                className={`ml-2 rounded px-1.5 py-0.2 text-[11px] font-semibold ${
                  isActive
                    ? "bg-slate-100 text-slate-800 dark:bg-zinc-700 dark:text-slate-200"
                    : "bg-slate-200/70 text-slate-600 dark:bg-zinc-800 dark:text-slate-400"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search and status filter */}
      <div className="grid gap-3 sm:grid-cols-[1fr_170px] xl:w-[540px]">
        <div className="relative">
          <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search subject, recipient, body"
            className="pl-9"
          />
        </div>

        <Select
          value={filters.status || ""}
          onChange={(event) => handleStatusChange(event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="unchecked">Unchecked</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="send_failed">Failed</option>
        </Select>
      </div>
    </div>
  );
};
