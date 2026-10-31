import { FiMoon, FiSun } from "react-icons/fi";
import { Button } from "../common/Button";
import { useAuth } from "../../hooks/useAuth";

export const Topbar = ({ email }) => {
  const { theme, setTheme } = useAuth();
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950 lg:pl-72 lg:pr-7">
      {/* Left: sync status */}
      <div className="flex items-center gap-2 text-xs font-medium text-slate-400 dark:text-slate-500">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Syncing
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          className="h-8 w-8 px-0"
          onClick={() => setTheme(nextTheme)}
          aria-label="Toggle theme"
        >
          {theme === "dark"
            ? <FiSun className="h-4 w-4" />
            : <FiMoon className="h-4 w-4" />}
        </Button>

        {email && (
          <span className="hidden rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-slate-400 sm:inline">
            {email}
          </span>
        )}
      </div>
    </header>
  );
};
