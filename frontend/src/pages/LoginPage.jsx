import { Navigate } from "react-router-dom";
import { FiMail } from "react-icons/fi";
import { HiSparkles } from "react-icons/hi2";
import { Button } from "../components/common/Button";
import { useAuth } from "../hooks/useAuth";

export const LoginPage = () => {
  const { isAuthed, loginUrl } = useAuth();

  if (isAuthed) return <Navigate to="/profile" replace />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-900 dark:bg-zinc-950 dark:text-slate-100">
      <section className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl shadow-blue-900/10 dark:border-zinc-800 dark:bg-zinc-900/80 dark:shadow-blue-900/20">
        <div className="flex items-center gap-3">
          <HiSparkles className="h-8 w-8 text-blue-600 dark:text-blue-500" />
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Milpilot</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Intelligent Gmail automation</p>
          </div>
        </div>

        <p className="mt-8 text-lg leading-7 text-slate-600 dark:text-slate-300">
          Connect Gmail to classify unread emails, create drafts or replies, and review everything from one calm dashboard.
        </p>

        <a href={loginUrl} className="mt-8 inline-flex">
          <Button variant="primary" className="h-10 px-5 text-sm">
            <FiMail className="h-4 w-4" />
            Continue with Google
          </Button>
        </a>
      </section>
    </main>
  );
};
