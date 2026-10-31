import clsx from "clsx";

const palette = {
  // Default / neutral
  slate:
    "border-slate-200 bg-slate-100 text-slate-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-slate-300",
  // Primary accent (labels, types)
  blue:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
  // Success / sent
  emerald:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  // Warning
  amber:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  // Error / failed
  rose:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300"
};

export const Badge = ({ children, tone = "slate", className }) => (
  <span
    className={clsx(
      "inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium",
      palette[tone],
      className
    )}
  >
    {children}
  </span>
);
