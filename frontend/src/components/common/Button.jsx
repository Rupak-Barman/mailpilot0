import clsx from "clsx";

const variants = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:text-white dark:hover:bg-blue-600",
  success: "bg-emerald-500 text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:hover:bg-emerald-600",
  ghost: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-200 dark:hover:bg-zinc-800",
  subtle: "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-zinc-800 dark:text-slate-200 dark:hover:bg-zinc-700"
};

export const Button = ({ children, className, variant = "primary", ...props }) => (
  <button
    type="button"
    className={clsx(
      "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
      variants[variant],
      className
    )}
    {...props}
  >
    {children}
  </button>
);
