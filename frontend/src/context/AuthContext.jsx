import { useEffect, useMemo, useState } from "react";
import { apiClient, setAuthToken } from "../api/client";
import { AuthContext } from "./authContext";
import { API_URL } from "../config.js";

const TOKEN_KEY = "mailpilot_token";
const THEME_KEY = "mailpilot_theme";

const readInitialToken = () => {
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

  const loginUrl = `${API_URL}/auth/google`;

  const setToken = (nextToken) => {
    if (nextToken) {
      localStorage.setItem(TOKEN_KEY, nextToken);
      setTokenState(nextToken);
      setAuthToken(nextToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      setTokenState("");
      setAuthToken("");
    }
  };

  const logout = async () => {
    try {
      await apiClient.post("/auth/logout");
    } catch (_) {}
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
    setToken,
    logout,
    theme,
    setTheme
  }), [token, theme, loginUrl]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
