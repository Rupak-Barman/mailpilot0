import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FiAlertCircle, FiCheckCircle, FiLoader, FiMail } from "react-icons/fi";
import { apiClient } from "../api/client";
import { useAuth } from "../hooks/useAuth";

export const AuthCallbackPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setToken } = useAuth();

  const [status, setStatus] = useState("loading"); // "loading" | "success" | "error"
  const [errorMessage, setErrorMessage] = useState("");
  const exchangedRef = useRef(false);

  useEffect(() => {
    if (exchangedRef.current) return;
    exchangedRef.current = true;

    const code = searchParams.get("code");

    // Immediately remove code from URL bar before network request
    if (typeof window !== "undefined") {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (!code) {
      setStatus("error");
      setErrorMessage("No authorization code found. Please sign in again.");
      return;
    }

    const exchangeCode = async () => {
      try {
        const response = await apiClient.post("/auth/exchange", { code });
        const token = response.data?.token;

        if (!token) {
          throw new Error("No token returned by server");
        }

        setStatus("success");
        setToken(token);

        // Brief delay for visual confirmation before redirecting to dashboard
        setTimeout(() => {
          navigate("/profile", { replace: true });
        }, 300);
      } catch (err) {
        setStatus("error");
        const serverError =
          err.response?.data?.error ||
          err.response?.data?.message ||
          "Authentication failed. The code may have expired or already been used.";
        setErrorMessage(serverError);
      }
    };

    exchangeCode();
  }, [searchParams, navigate, setToken]);

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

        {status === "loading" && (
          <div className="mt-8 text-center">
            <FiLoader className="mx-auto h-8 w-8 animate-spin text-slate-500 dark:text-slate-400" />
            <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Completing authentication...
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Securing session tokens. You will be redirected in a moment.
            </p>
          </div>
        )}

        {status === "success" && (
          <div className="mt-8 text-center">
            <FiCheckCircle className="mx-auto h-8 w-8 text-emerald-500" />
            <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Signed in successfully
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Redirecting to your dashboard...
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="mt-8">
            <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/50 dark:bg-rose-950/30">
              <FiAlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
              <div className="text-sm">
                <p className="font-semibold text-rose-900 dark:text-rose-200">
                  Authentication Failed
                </p>
                <p className="mt-1 text-rose-700 dark:text-rose-300">
                  {errorMessage}
                </p>
              </div>
            </div>

            <div className="mt-6 text-center">
              <Link
                to="/login"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-slate-900 px-5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Try again
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
};

