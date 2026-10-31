import clsx from "clsx";

export const Card = ({ children, className }) => (
  <section
    className={clsx(
      "rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50 dark:border-zinc-800 dark:bg-zinc-900/90 dark:shadow-none",
      className
    )}
  >
    {children}
  </section>
);
