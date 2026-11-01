// services/gmail.service.js
import "dotenv/config";
import { google } from "googleapis";
import { buildMimeMessage } from "../utils/helpers.js";

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
 * Executes a function with a Gmail client. On invalid_grant error,
 * marks the user as needing re-login and rethrows a typed InvalidGrantError.
 */
export async function withGmail(userOrGmail, fn, maybeUser) {
  let user = maybeUser;
  let gmail = userOrGmail;

  if (userOrGmail && !userOrGmail.users) {
    user = userOrGmail;
    gmail = await getGmail(user);
  }

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
    throw err;
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
 * Send an existing Gmail draft.
 */
export const sendGmailDraft = async (gmailOrUser, gmailDraftId, maybeUser) => {
  if (!gmailDraftId) {
    throw new Error("Gmail draft ID is missing");
  }

  return withGmail(
    gmailOrUser,
    async (gmail) => {
      const response = await gmail.users.drafts.send({
        userId: "me",
        requestBody: {
          id: gmailDraftId
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
  gmailDraftId,
  maybeUser
) => {
  if (!gmailDraftId) {
    throw new Error("Gmail draft ID is missing");
  }

  return withGmail(
    gmailOrUser,
    async (gmail) => {
      await gmail.users.drafts.delete({
        userId: "me",
        id: gmailDraftId
      });
    },
    maybeUser
  );
};

/**
 * Setup default Gmail labels.
 */
export const setupDefaultLabels = async (user) => {
  if (user.labels && user.labels.length > 0) return;

  return withGmail(user, async (gmail) => {
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

    user.labels = created;
    if (typeof user.save === "function") {
      await user.save();
    }
    return user.labels;
  });
};
