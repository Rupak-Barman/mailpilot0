// services/gmail.service.js
import "dotenv/config";
import { google } from "googleapis";
import { buildMimeMessage } from "../utils/helpers.js";
import { publishUserEvent } from "./events.service.js";

/**
 * Typed error for Google OAuth2 invalid_grant situations.
 */
export class InvalidGrantError extends Error {
  constructor(message = "Authentication expired. Please re-login.", cause) {
    super(message);
    this.name = "InvalidGrantError";
    this.code = "INVALID_GRANT";
    if (cause) this.cause = cause;
  }
}

/**
 * Determine whether an error represents an invalid_grant response from Google.
 */
export const isInvalidGrantError = (error) => {
  if (!error) return false;
  if (error instanceof InvalidGrantError) return true;
  const msg = String(error?.message || "");
  const desc = String(error?.response?.data?.error_description || "");
  const err = String(error?.response?.data?.error || "");
  const causeMsg = error?.cause ? String(error.cause.message || "") : "";
  return (
    msg.includes("invalid_grant") ||
    desc.includes("invalid_grant") ||
    err === "invalid_grant" ||
    causeMsg.includes("invalid_grant")
  );
};

/**
 * Handle invalid_grant by marking the user as needing re-login.
 */
export const handleInvalidGrant = async (user, error) => {
  if (user) {
    user.needsRelogin = true;
    user.syncStatus = "error";
    user.syncError = "Authentication expired. Please re-login.";
    try {
      if (typeof user.save === "function") {
        await user.save();
      }
      publishUserEvent(user._id, { type: "sync.changed", at: Date.now() });
    } catch (saveErr) {
      console.error("[gmail] Error saving user on invalid_grant:", saveErr);
    }
  }
};

/**
 * Create a googleapis OAuth2 client for a user.
 * Tokens are only persisted when the refresh flow emits changed tokens.
 */
export const getOAuth2Client = (user) => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  auth.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken
  });

  auth.on("tokens", async (tokens) => {
    let changed = false;
    if (tokens.access_token && tokens.access_token !== user.accessToken) {
      user.accessToken = tokens.access_token;
      changed = true;
    }
    if (tokens.refresh_token && tokens.refresh_token !== user.refreshToken) {
      user.refreshToken = tokens.refresh_token;
      changed = true;
    }
    if (changed) {
      try {
        if (typeof user.save === "function") {
          await user.save();
        }
      } catch (err) {
        console.error("[gmail] Error persisting refreshed tokens:", err);
      }
    }
  });

  return auth;
};

/**
 * Returns a plain googleapis Gmail client (without Proxy).
 */
export const getGmail = async (user) => {
  const auth = getOAuth2Client(user);
  return google.gmail({ version: "v1", auth });
};

/**
 * Determine whether an error is transient and safe to retry.
 * Transient: ECONNRESET, ETIMEDOUT, EAI_AGAIN, ECONNABORTED, HTTP 429, HTTP 5xx.
 * Never retry: invalid_grant, 401, 403, 404.
 */
export const isTransientError = (error) => {
  if (!error) return false;

  if (isInvalidGrantError(error)) return false;

  const status =
    error?.status ||
    error?.response?.status ||
    (typeof error?.code === "number" ? error.code : null);

  if (status === 401 || status === 403 || status === 404) {
    return false;
  }

  if (status === 429 || (status >= 500 && status < 600)) {
    return true;
  }

  const code = String(error?.code || error?.cause?.code || "");
  const transientCodes = [
    "ECONNRESET",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ECONNABORTED"
  ];

  if (transientCodes.includes(code)) {
    return true;
  }

  const msg = String(error?.message || "");
  const causeMsg = error?.cause ? String(error.cause.message || "") : "";
  for (const c of transientCodes) {
    if (msg.includes(c) || causeMsg.includes(c)) {
      return true;
    }
  }

  return false;
};

const getBackoffDelay = (retryIndex) => {
  const baseDelays = [500, 1500, 4000];
  const base = baseDelays[retryIndex] ?? 4000;
  const jitter = Math.floor(Math.random() * (base * 0.25));
  return base + jitter;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes a function with a Gmail client.
 * Retries transient failures with exponential backoff (up to 3 retries).
 * On invalid_grant error, marks user as needing re-login and rethrows InvalidGrantError.
 */
export async function withGmail(userOrGmail, fn, maybeUser, options = {}) {
  let user = maybeUser;
  let gmail = userOrGmail;
  let opts = options;

  if (
    maybeUser &&
    typeof maybeUser === "object" &&
    !maybeUser._id &&
    !maybeUser.refreshToken &&
    (maybeUser.maxRetries !== undefined ||
      maybeUser.retryDelayFn !== undefined ||
      maybeUser.onRetry !== undefined)
  ) {
    opts = maybeUser;
    user = undefined;
  }

  if (userOrGmail && !userOrGmail.users) {
    user = userOrGmail;
    gmail = await getGmail(user);
  }

  const maxRetries = opts?.maxRetries ?? 3;
  let attempt = 0;

  while (true) {
    try {
      return await fn(gmail);
    } catch (err) {
      if (isInvalidGrantError(err)) {
        if (user) {
          await handleInvalidGrant(user, err);
        }
        throw new InvalidGrantError(
          err?.message || "Authentication expired. Please re-login.",
          err
        );
      }

      if (attempt < maxRetries && isTransientError(err)) {
        attempt++;
        const delay = opts?.retryDelayFn
          ? opts.retryDelayFn(attempt - 1)
          : getBackoffDelay(attempt - 1);
        const reason = err?.code || err?.status || err?.message || "unknown";
        console.warn(
          `[gmail] Transient error (${reason}). Retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`
        );
        if (opts?.onRetry) {
          opts.onRetry(err, attempt, delay);
        }
        await sleep(delay);
        continue;
      }

      throw err;
    }
  }
}

/**
 * Helper to fetch user's Gmail profile (including current historyId).
 */
export const getProfile = async (userOrGmail, maybeUser) => {
  return withGmail(
    userOrGmail,
    async (gmail) => {
      const res = await gmail.users.getProfile({ userId: "me" });
      return res.data;
    },
    maybeUser
  );
};

/**
 * Helper to list history records for incremental sync.
 */
export const listHistory = async (userOrGmail, params = {}, maybeUser) => {
  return withGmail(
    userOrGmail,
    async (gmail) => {
      const res = await gmail.users.history.list({
        userId: "me",
        ...params
      });
      return res.data;
    },
    maybeUser
  );
};

export const historyList = listHistory;

/**
 * Create a draft in Gmail.
 */
export const createGmailDraft = async (
  gmailOrUser,
  { to, subject, body, threadId, inReplyTo, references, replyTo },
  maybeUser
) => {
  const isReply = (subject ?? "").startsWith("Re:");
  const raw = buildMimeMessage({
    to,
    subject: subject ?? "",
    body,
    inReplyTo,
    references,
    replyTo,
    isReply
  });

  return withGmail(
    gmailOrUser,
    async (gmail) => {
      const response = await gmail.users.drafts.create({
        userId: "me",
        requestBody: {
          message: {
            raw,
            ...(threadId ? { threadId } : {})
          }
        }
      });
      return response.data;
    },
    maybeUser
  );
};

/**
 * Update an existing Gmail draft.
 * The existing Gmail draft ID is retained.
 */
export const updateGmailDraft = async (
  gmailOrUser,
  { gmailDraftId, to, subject, body, threadId, inReplyTo, references, replyTo },
  maybeUser
) => {
  if (!gmailDraftId) {
    throw new Error("Gmail draft ID is missing");
  }

  const isReply = (subject ?? "").startsWith("Re:");
  const raw = buildMimeMessage({
    to,
    subject: subject ?? "",
    body,
    inReplyTo,
    references,
    replyTo,
    isReply
  });

  return withGmail(
    gmailOrUser,
    async (gmail) => {
      const response = await gmail.users.drafts.update({
        userId: "me",
        id: gmailDraftId,
        requestBody: {
          message: {
            raw,
            ...(threadId ? { threadId } : {})
          }
        }
      });
      return response.data;
    },
    maybeUser
  );
};

/**
 * Retrieve an existing Gmail draft.
 */
export const getGmailDraft = async (
  gmailOrUser,
  draftId,
  maybeUser,
  options = {}
) => {
  if (!draftId) {
    throw new Error("Gmail draft ID is missing");
  }

  return withGmail(
    gmailOrUser,
    async (gmail) => {
      const response = await gmail.users.drafts.get({
        userId: "me",
        id: draftId,
        format: options.format || "full"
      });
      return response.data;
    },
    maybeUser
  );
};

/**
 * Send an existing Gmail draft.
 */
export const sendGmailDraft = async (
  gmailOrUser,
  draftIdOrParams,
  maybeUser
) => {
  const draftId =
    typeof draftIdOrParams === "object"
      ? draftIdOrParams?.gmailDraftId || draftIdOrParams?.id
      : draftIdOrParams;

  if (!draftId) {
    throw new Error("Gmail draft ID is missing");
  }

  return withGmail(
    gmailOrUser,
    async (gmail) => {
      const response = await gmail.users.drafts.send({
        userId: "me",
        requestBody: {
          id: draftId
        }
      });
      return response.data;
    },
    maybeUser
  );
};

/**
 * Send an email directly via Gmail messages.send.
 */
export const sendGmailMessage = async (
  gmailOrUser,
  { to, subject, body, threadId, inReplyTo, references, replyTo },
  maybeUser
) => {
  const isReply = (subject ?? "").startsWith("Re:");
  const raw = buildMimeMessage({
    to,
    subject: subject ?? "",
    body,
    inReplyTo,
    references,
    replyTo,
    isReply
  });

  return withGmail(
    gmailOrUser,
    async (gmail) => {
      const response = await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw,
          ...(threadId ? { threadId } : {})
        }
      });
      return response.data;
    },
    maybeUser
  );
};

/**
 * Permanently delete an existing Gmail draft.
 */
export const deleteGmailDraft = async (
  gmailOrUser,
  draftIdOrParams,
  maybeUser
) => {
  const draftId =
    typeof draftIdOrParams === "object"
      ? draftIdOrParams?.gmailDraftId || draftIdOrParams?.id
      : draftIdOrParams;

  if (!draftId) {
    throw new Error("Gmail draft ID is missing");
  }

  return withGmail(
    gmailOrUser,
    async (gmail) => {
      await gmail.users.drafts.delete({
        userId: "me",
        id: draftId
      });
    },
    maybeUser
  );
};

/**
 * Get a specific Gmail message by ID.
 */
export const getMessage = async (
  gmailOrUser,
  messageIdOrParams,
  maybeUser
) => {
  const params =
    typeof messageIdOrParams === "string"
      ? { messageId: messageIdOrParams }
      : messageIdOrParams || {};
  const targetId = params.messageId || params.id;
  if (!targetId) throw new Error("Message ID is missing");
  const format = params.format || "full";

  return withGmail(
    gmailOrUser,
    async (gmail) => {
      const res = await gmail.users.messages.get({
        userId: "me",
        id: targetId,
        format
      });
      return res.data;
    },
    maybeUser
  );
};

/**
 * List Gmail messages matching a query.
 */
export const listMessages = async (gmailOrUser, params = {}, maybeUser) => {
  return withGmail(
    gmailOrUser,
    async (gmail) => {
      const res = await gmail.users.messages.list({
        userId: "me",
        ...params
      });
      return res.data;
    },
    maybeUser
  );
};

/**
 * Get a specific Gmail thread by ID.
 */
export const getThread = async (gmailOrUser, threadIdOrParams, maybeUser) => {
  const params =
    typeof threadIdOrParams === "string"
      ? { threadId: threadIdOrParams }
      : threadIdOrParams || {};
  const targetId = params.threadId || params.id;
  if (!targetId) throw new Error("Thread ID is missing");
  const format = params.format || "full";

  return withGmail(
    gmailOrUser,
    async (gmail) => {
      const res = await gmail.users.threads.get({
        userId: "me",
        id: targetId,
        format
      });
      return res.data;
    },
    maybeUser
  );
};

/**
 * List all labels in Gmail account.
 */
export const listGmailLabels = async (gmailOrUser, maybeUser) => {
  return withGmail(
    gmailOrUser,
    async (gmail) => {
      const res = await gmail.users.labels.list({ userId: "me" });
      return res.data;
    },
    maybeUser
  );
};

/**
 * Create a new label in Gmail.
 */
export const createGmailLabel = async (
  gmailOrUser,
  { name, labelListVisibility, messageListVisibility } = {},
  maybeUser
) => {
  return withGmail(
    gmailOrUser,
    async (gmail) => {
      const res = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name,
          ...(labelListVisibility ? { labelListVisibility } : {}),
          ...(messageListVisibility ? { messageListVisibility } : {})
        }
      });
      return res.data;
    },
    maybeUser
  );
};

/**
 * Delete a label from Gmail by label ID.
 */
export const deleteGmailLabel = async (gmailOrUser, labelId, maybeUser) => {
  return withGmail(
    gmailOrUser,
    async (gmail) => {
      const res = await gmail.users.labels.delete({
        userId: "me",
        id: labelId
      });
      return res.data;
    },
    maybeUser
  );
};

/**
 * Setup default Gmail labels.
 */
export const setupDefaultLabels = async (userOrGmail, maybeUser) => {
  let user = maybeUser;

  if (userOrGmail && !userOrGmail.users) {
    user = userOrGmail;
  }

  if (user && user.labels && user.labels.length > 0) return user.labels;

  return withGmail(
    userOrGmail,
    async (gmail) => {
      const DEFAULT_LABELS = [
        {
          name: "Work",
          tone: "formal",
          markAsRead: true,
          enabled: true,
          action: { type: "reply", template: "I'll get back to you soon." }
        },
        {
          name: "Personal",
          tone: "friendly",
          markAsRead: true,
          enabled: true,
          action: { type: "none" }
        },
        {
          name: "Promotions",
          tone: "casual",
          markAsRead: true,
          enabled: true,
          action: { type: "none" }
        },
        {
          name: "Important",
          tone: "formal",
          markAsRead: false,
          enabled: true,
          action: { type: "draft", template: "Thanks, drafting a response." }
        }
      ];

      const created = [];
      const existingLabels = await gmail.users.labels.list({ userId: "me" });
      const existingByName = new Map(
        (existingLabels.data.labels || []).map((label) => [
          label.name.toLowerCase(),
          label
        ])
      );

      for (const l of DEFAULT_LABELS) {
        let gmailLabel = existingByName.get(l.name.toLowerCase());

        if (!gmailLabel) {
          const res = await gmail.users.labels.create({
            userId: "me",
            requestBody: { name: l.name }
          });
          gmailLabel = res.data;
        }

        created.push({
          name: l.name,
          id: gmailLabel.id,
          tone: l.tone,
          markAsRead: l.markAsRead,
          enabled: l.enabled,
          action: l.action
        });
      }

      if (user) {
        user.labels = created;
        if (typeof user.save === "function") {
          await user.save();
        }
      }
      return created;
    },
    user
  );
};

/**
 * Modify labels on a message using requestBody (never top-level parameters).
 */
export const modifyMessageLabels = async (
  gmailOrUser,
  { messageId, addLabelIds = [], removeLabelIds = [] },
  maybeUser
) => {
  return withGmail(
    gmailOrUser,
    async (gmail) => {
      const response = await gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: {
          ...(addLabelIds?.length ? { addLabelIds } : {}),
          ...(removeLabelIds?.length ? { removeLabelIds } : {})
        }
      });
      return response.data;
    },
    maybeUser
  );
};
