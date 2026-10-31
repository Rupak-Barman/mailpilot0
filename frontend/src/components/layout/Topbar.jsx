import { FiBell, FiCheckCircle, FiMoon, FiSun, FiUser } from "react-icons/fi";
import { Button } from "../common/Button";
import { useAuth } from "../../hooks/useAuth";

export const Topbar = ({ email }) => {
  const { theme, setTheme } = useAuth();
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90 lg:pl-72 lg:pr-7">
      <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-emerald-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-emerald-400">
        <FiCheckCircle className="h-4 w-4" />
        Syncing
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          className="h-9 w-9 px-0"
          onClick={() => setTheme(nextTheme)}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <FiSun className="h-4 w-4" /> : <FiMoon className="h-4 w-4" />}
        </Button>
        <FiBell className="h-5 w-5 text-slate-500 dark:text-slate-300" />
        <span className="hidden text-sm text-slate-600 dark:text-slate-300 sm:inline">{email || "user@gmail.com"}</span>
        <FiUser className="h-7 w-7 text-slate-500 dark:text-slate-300" />
      </div>
    </header>
  );
};
