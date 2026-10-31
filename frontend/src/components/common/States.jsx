import { FiAlertCircle, FiLoader } from "react-icons/fi";

export const LoadingState = ({ label = "Loading" }) => (
  <div className="flex min-h-32 items-center justify-center gap-3 text-sm text-slate-500 dark:text-slate-400">
    <FiLoader className="h-5 w-5 animate-spin" />
    {label}
  </div>
);

export const EmptyState = ({ title, description }) => (
  <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-5 text-center dark:border-zinc-700">
    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
    <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>
  </div>
);

export const ErrorState = ({ message = "Something went wrong." }) => (
  <div className="flex min-h-28 items-center justify-center gap-2 rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
    <FiAlertCircle className="h-5 w-5" />
    {message}
  </div>
);
