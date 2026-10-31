import clsx from "clsx";

const palette = {
  violet: "border-violet-300/50 bg-violet-100 text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-200",
  emerald: "border-emerald-300/50 bg-emerald-100 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
  blue: "border-blue-300/50 bg-blue-100 text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-200",
  slate: "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  rose: "border-rose-300/50 bg-rose-100 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200"
};

export const Badge = ({ children, tone = "slate", className }) => (
  <span className={clsx("inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium", palette[tone], className)}>
    {children}
  </span>
);
