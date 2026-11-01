// Frontend central configuration module
export const API_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) ||
  (typeof process !== "undefined" && process.env?.VITE_API_URL) ||
  "http://localhost:3000";

export default {
  API_URL
};
