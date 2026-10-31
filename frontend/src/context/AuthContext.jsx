import { useEffect, useMemo, useState } from "react";
import { setAuthToken } from "../api/client";
import { AuthContext } from "./authContext";

const TOKEN_KEY = "sendora_token";
const THEME_KEY = "sendora_theme";

const readInitialToken = () => {
  const params = new URLSearchParams(window.location.search);
  const nextToken = params.get("token");

  if (nextToken) {
    localStorage.setItem(TOKEN_KEY, nextToken);
    window.history.replaceState({}, document.title, window.location.pathname);
    return nextToken;
  }

  return localStorage.getItem(TOKEN_KEY) || "";
};

export const AuthProvider = ({ children }) => {
  const [token, setTokenState] = useState(readInitialToken);
  const [theme, setThemeState] = useState(() => localStorage.getItem(THEME_KEY) || "dark");

  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const loginUrl = "http://localhost:3000/auth/google";

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setTokenState("");
    setAuthToken("");
  };

  const setTheme = (nextTheme) => {
    setThemeState(nextTheme);
  };

  const value = useMemo(() => ({
    token,
    isAuthed: Boolean(token),
    loginUrl,
    logout,
    theme,
    setTheme
  }), [token, theme]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
