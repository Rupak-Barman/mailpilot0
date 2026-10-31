import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { FiBarChart2, FiFileText, FiUser } from "react-icons/fi";

const items = [
  { label: "Profile", path: "/profile",   icon: FiUser },
  { label: "Analytics", path: "/analytics", icon: FiBarChart2 },
  { label: "Logs",    path: "/logs",      icon: FiFileText }
];

export const MobileNav = () => (
  <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-slate-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-950 lg:hidden">
    {items.map((item) => {
      const Icon = item.icon;
      return (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) =>
            clsx(
              "flex flex-col items-center gap-1 rounded-md px-2 py-2 text-[11px] font-medium transition-colors",
              isActive
                ? "text-slate-900 dark:text-slate-50"
                : "text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            )
          }
        >
          <Icon className="h-4 w-4" />
          {item.label}
        </NavLink>
      );
    })}
  </nav>
);
