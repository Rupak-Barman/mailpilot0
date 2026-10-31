import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { FiBarChart2, FiFileText, FiUser, FiLogOut, FiMail } from "react-icons/fi";
import { useAuth } from "../../hooks/useAuth";

const items = [
  { label: "Profile & Rules", path: "/profile", icon: FiUser },
  { label: "Analytics",       path: "/analytics", icon: FiBarChart2 },
  { label: "Drafts & Replies",path: "/logs",      icon: FiFileText }
];

export const Sidebar = () => {
  const { logout } = useAuth();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-5 dark:border-zinc-800 dark:bg-zinc-950 lg:flex">
      {/* Wordmark */}
      <div className="flex items-center gap-2.5 px-1">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-900 dark:bg-slate-100">
          <FiMail className="h-3.5 w-3.5 text-white dark:text-slate-900" />
        </span>
        <span className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Mailpilot
        </span>
      </div>

      {/* Nav items */}
      <nav className="mt-10 flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-slate-100 text-slate-900 dark:bg-zinc-800 dark:text-slate-50"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-zinc-900 dark:hover:text-slate-200"
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      {/* Logout */}
      <button
        type="button"
        onClick={logout}
        className="mt-auto flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-zinc-900 dark:hover:text-slate-300"
      >
        <FiLogOut className="h-4 w-4 shrink-0" />
        Sign out
      </button>
    </aside>
  );
};
