import { Navigate } from "react-router-dom";
import { FiMail } from "react-icons/fi";
import { Button } from "../components/common/Button";
import { useAuth } from "../hooks/useAuth";

export const LoginPage = () => {
  const { isAuthed, loginUrl } = useAuth();

  if (isAuthed) return <Navigate to="/profile" replace />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-900 dark:bg-zinc-950 dark:text-slate-100">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {/* Wordmark */}
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 dark:bg-slate-100">
            <FiMail className="h-4 w-4 text-white dark:text-slate-900" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Mailpilot
          </span>
        </div>

        <h1 className="mt-8 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Sign in to your account
        </h1>

        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
          Connect your Gmail account to automatically classify emails, create
          drafts, and send replies — all from one dashboard.
        </p>

        <a href={loginUrl} className="mt-8 block">
          <Button variant="primary" className="h-10 w-full px-5 text-sm">
            <FiMail className="h-4 w-4" />
            Continue with Google
          </Button>
        </a>

        <p className="mt-5 text-center text-xs text-slate-400 dark:text-slate-500">
          By continuing you agree to grant Mailpilot read and write access to
          your Gmail inbox.
        </p>
      </section>
    </main>
  );
};
