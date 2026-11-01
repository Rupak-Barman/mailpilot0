import axios from "axios";
import { API_URL } from "../config.js";

export const apiClient = axios.create({
  baseURL: API_URL
});

export const setAuthToken = (token) => {
  if (token) {
    apiClient.defaults.headers.common.Authorization = `Bearer ${token}`;
    return;
  }

  delete apiClient.defaults.headers.common.Authorization;
};

// State flag to prevent 401 handling loops or duplicate redirects during burst requests
let isHandling401 = false;

/**
 * Pure decision logic for handling 401 responses.
 * Can be tested independently without real window/browser dependencies.
 */
export function shouldHandle401(error, handlingFlag = isHandling401) {
  if (!error) return false;
  const status = error.response?.status;
  if (status !== 401) return false;

  const url = String(error.config?.url || "");
  // Do not intercept code exchange failures
  if (url.includes("/auth/exchange")) {
    return false;
  }

  // Prevent multiple simultaneous 401 redirects
  if (handlingFlag) {
    return false;
  }

  return true;
}

/**
 * Perform 401 cleanup and session expiry redirection.
 */
export function handle401Redirect({
  storage = typeof window !== "undefined" ? window.localStorage : null,
  session = typeof window !== "undefined" ? window.sessionStorage : null,
  navigate = (url) => { if (typeof window !== "undefined") window.location.href = url; }
} = {}) {
  if (isHandling401) return;
  isHandling401 = true;

  try {
    setAuthToken("");
    if (storage) {
      storage.removeItem("mailpilot_token");
    }
    if (session) {
      session.setItem("auth_flash_message", "Session expired, please sign in again.");
    }
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      navigate("/login");
    }
  } finally {
    setTimeout(() => {
      isHandling401 = false;
    }, 1500);
  }
}

// Attach response interceptor to apiClient
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (shouldHandle401(error)) {
      handle401Redirect();
    }
    return Promise.reject(error);
  }
);
