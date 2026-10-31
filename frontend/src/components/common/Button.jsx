import clsx from "clsx";

const variants = {
  primary:
    "bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 dark:focus-visible:ring-slate-100",
  success:
    "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 dark:bg-emerald-500 dark:hover:bg-emerald-600",
  ghost:
    "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-300 dark:hover:bg-zinc-800 dark:hover:text-slate-100",
  subtle:
    "bg-slate-100 text-slate-700 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-300 dark:bg-zinc-800 dark:text-slate-300 dark:hover:bg-zinc-700",
  danger:
    "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 dark:bg-red-500 dark:hover:bg-red-600"
};

export const Button = ({ children, className, variant = "primary", ...props }) => (
  <button
    type="button"
    className={clsx(
      "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      variants[variant],
      className
    )}
    {...props}
  >
    {children}
  </button>
);
