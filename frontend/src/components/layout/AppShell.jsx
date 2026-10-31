import { Navigate, Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileNav } from "./MobileNav";
import { useAuth } from "../../hooks/useAuth";
import { useProfileSettings } from "../../hooks/useProfileSettings";

export const AppShell = () => {
  const { isAuthed } = useAuth();
  const { data } = useProfileSettings();

  if (!isAuthed) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-zinc-950 dark:text-slate-50">
      <Sidebar />
      <Topbar email={data?.profile?.email} />
      <main className="pb-20 pt-4 lg:ml-64 lg:pb-8">
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-5 lg:px-7">
          <Outlet />
        </div>
      </main>
      <MobileNav />
    </div>
  );
};
