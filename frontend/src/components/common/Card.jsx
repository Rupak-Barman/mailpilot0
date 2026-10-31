import clsx from "clsx";

export const Card = ({ children, className }) => (
  <section
    className={clsx(
      "rounded-lg border border-slate-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900",
      className
    )}
  >
    {children}
  </section>
);
