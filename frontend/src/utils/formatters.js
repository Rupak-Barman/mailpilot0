export const titleCase = (value = "") =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : "";

export const compactNumber = (value = 0) =>
  new Intl.NumberFormat("en", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);

export const formatDateTime = (value) => {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
};

export const asArray = (value) => Array.isArray(value) ? value : [];
