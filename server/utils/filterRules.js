export const TABS = [
  { label: "Unchecked", value: "unchecked", key: "unchecked" },
  { label: "Drafts",    value: "draft",     key: "drafts" },
  { label: "Replies",   value: "reply",     key: "replies" },
  { label: "Failed",    value: "failed",    key: "failed" },
  { label: "All",       value: "all",       key: "total" }
];

export const STATUS_OPTIONS = [
  { value: "",            label: "All statuses" },
  { value: "draft",       label: "Draft" },
  { value: "sent",        label: "Sent" },
  { value: "needs_reply", label: "Needs reply" },
  { value: "failed",      label: "Failed" },
  { value: "reviewed",    label: "Reviewed" }
];

export const isStatusAllowedForTab = (tab, status) => {
  if (!status) return true;
  switch (tab) {
    case "unchecked":
      return status !== "reviewed";
    case "draft":
      return status !== "needs_reply";
    case "reply":
      return status !== "draft" && status !== "needs_reply";
    case "failed":
      return status === "failed" || status === "reviewed";
    case "all":
    default:
      return true;
  }
};

export const parseUrlParams = (searchParams) => {
  const get = (key) => (typeof searchParams?.get === "function" ? searchParams.get(key) : searchParams?.[key]);

  const rawTab = get("tab") || "unchecked";
  const validTabs = ["unchecked", "draft", "reply", "failed", "all"];
  const tab = validTabs.includes(rawTab) ? rawTab : "unchecked";

  const rawStatus = get("status") || "";
  const status = isStatusAllowedForTab(tab, rawStatus) ? rawStatus : "";

  const q = get("q") || get("search") || "";

  const rawPage = parseInt(get("page"), 10);
  const page = !isNaN(rawPage) && rawPage > 0 ? rawPage : 1;

  return { tab, status, q, page, limit: 20 };
};

export const buildUrlParams = ({ tab, status, q, page }) => {
  const params = new URLSearchParams();
  if (tab && tab !== "unchecked") {
    params.set("tab", tab);
  }
  if (status && isStatusAllowedForTab(tab, status)) {
    params.set("status", status);
  }
  if (q && q.trim()) {
    params.set("q", q.trim());
  }
  if (page && Number(page) > 1) {
    params.set("page", String(page));
  }
  return params;
};

export const buildApiQueryParams = (filters = {}) => {
  const params = {
    page: filters.page || 1,
    limit: filters.limit || 20
  };

  if (filters.q && filters.q.trim()) {
    params.q = filters.q.trim();
  }

  if (filters.tab === "unchecked") {
    params.checked = "false";
  } else if (filters.tab === "draft") {
    params.tab = "draft";
    params.type = "draft";
  } else if (filters.tab === "reply") {
    params.tab = "reply";
    params.type = "reply";
  } else if (filters.tab === "failed") {
    params.tab = "failed";
  }

  const effectiveStatus = isStatusAllowedForTab(filters.tab, filters.status)
    ? filters.status
    : "";

  if (effectiveStatus) {
    params.status = effectiveStatus;
  }

  return params;
};

export const getItemStatus = (item) => {
  if (!item) return "draft";
  const turns = Array.isArray(item.turns) ? item.turns : [];
  const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;

  const isFailed =
    latestTurn?.outcome === "failed" ||
    latestTurn?.outcome === "needs_manual" ||
    item.status === "failed" ||
    item.status === "send_failed" ||
    latestTurn?.outgoing?.status === "failed";
  if (isFailed) return "failed";

  const isSent =
    latestTurn?.outgoing?.status === "sent" ||
    item.status === "sent" ||
    latestTurn?.outcome === "sent";
  if (isSent) return "sent";

  const isDraft =
    latestTurn?.outgoing?.status === "draft" ||
    (latestTurn?.outgoing?.kind === "draft" && !latestTurn?.outgoing?.status) ||
    item.status === "draft" ||
    item.type === "draft";
  if (isDraft) return "draft";

  if (item.checked || item.status === "reviewed") return "reviewed";

  if (item.status === "needs_reply" || !latestTurn?.outgoing) return "needs_reply";

  return item.status || "draft";
};

export const getStatusBadgeConfig = (status) => {
  switch (status) {
    case "sent":
      return { label: "Sent", tone: "emerald" };
    case "draft":
      return { label: "Draft", tone: "slate" };
    case "needs_reply":
      return { label: "Needs reply", tone: "amber" };
    case "failed":
      return { label: "Failed", tone: "rose" };
    case "reviewed":
      return { label: "Reviewed", tone: "purple" };
    default:
      return { label: "Draft", tone: "slate" };
  }
};
