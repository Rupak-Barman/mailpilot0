// utils/helpers.js
export const getHeader = (email, name) =>
  email.payload.headers.find(h => h.name === name)?.value || "";