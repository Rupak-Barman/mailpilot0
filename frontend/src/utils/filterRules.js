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

/**
 * Filter combination rules:
 * - Unchecked tab: cannot be "reviewed" (reviewed means checked: true)
 * - Drafts tab: drafts can be "draft" (pending), "sent" (sent draft), "failed", "reviewed", but never "needs_reply"
 * - Replies tab: replies can be "sent", "failed", "reviewed", but never "draft" or "needs_reply"
 * - Failed tab: items can be "failed" or "reviewed" (if marked resolved/checked)
 * - All tab: all statuses are allowed
 */
export const isStatusAllowedForTab = (tab, status) => {
  if (!status) return true; // "All statuses" is always valid
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

/**
 * Parse URL query search params into page filters.
 */
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

/**
 * Build URLSearchParams object from current filter state for URL persistence.
 */
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

/**
 * Build backend API query parameters sent to GET /email-actions.
 */
export const buildApiQueryParams = (filters = {}) => {
  const params = {
    page: filters.page || 1,
    limit: filters.limit || 20
  };

  if (filters.q && filters.q.trim()) {
    params.q = filters.q.trim();
  }

  // Map tab filter
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

  // Map status filter if valid for current tab
  const effectiveStatus = isStatusAllowedForTab(filters.tab, filters.status)
    ? filters.status
    : "";

  if (effectiveStatus) {
    params.status = effectiveStatus;
  }

  return params;
};

/**
 * Determine status badge for an email action record.
 * Status badges: Draft, Sent, Needs reply, Failed, Reviewed.
 */
export const getItemStatus = (item) => {
  if (!item) return "draft";
  const turns = Array.isArray(item.turns) ? item.turns : [];
  const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;

  // 1. Failed
  const isFailed =
    latestTurn?.outcome === "failed" ||
    latestTurn?.outcome === "needs_manual" ||
    item.status === "failed" ||
    item.status === "send_failed" ||
    latestTurn?.outgoing?.status === "failed";
  if (isFailed) return "failed";

  // 2. Sent
  const isSent =
    latestTurn?.outgoing?.status === "sent" ||
    item.status === "sent" ||
    latestTurn?.outcome === "sent";
  if (isSent) return "sent";

  // 3. Draft (pending review)
  const isDraft =
    latestTurn?.outgoing?.status === "draft" ||
    (latestTurn?.outgoing?.kind === "draft" && !latestTurn?.outgoing?.status) ||
    item.status === "draft" ||
    item.type === "draft";
  if (isDraft) return "draft";

  // 4. Reviewed (checked off)
  if (item.checked || item.status === "reviewed") return "reviewed";

  // 5. Needs reply (incoming with no outgoing reply or draft yet)
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

