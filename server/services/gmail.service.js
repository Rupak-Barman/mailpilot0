// services/gmail.service.js
import "dotenv/config";
import { google } from "googleapis";
import { buildMimeMessage } from "../utils/helpers.js";

/**
 * Determine whether an error represents an invalid_grant response from Google.
 */
export const isInvalidGrantError = (error) => {
  const msg = String(error?.message || "");
  const desc = String(error?.response?.data?.error_description || "");
  const err = String(error?.response?.data?.error || "");
  return (
    msg.includes("invalid_grant") ||
    desc.includes("invalid_grant") ||
    err === "invalid_grant"
  );
};

/**
 * Handle invalid_grant by marking the user as needing re-login.
 */
export const handleInvalidGrant = async (user, error) => {
  if (isInvalidGrantError(error) && user) {
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
 * Transparently wraps a Gmail API client so that calls failing with
 * invalid_grant will automatically flag needsRelogin on the user.
 */
export const wrapWithInvalidGrantHandler = (target, user) => {
  if (!target || (typeof target !== "object" && typeof target !== "function")) {
    return target;
  }

  return new Proxy(target, {
    get(obj, prop) {
      const val = obj[prop];
      if (typeof val === "function") {
        return async function (...args) {
          try {
            return await val.apply(this, args);
          } catch (err) {
            await handleInvalidGrant(user, err);
            throw err;
          }
        };
      }
      if (val && typeof val === "object") {
        return wrapWithInvalidGrantHandler(val, user);
      }
      return val;
    }
  });
};

/**
 * Returns an authenticated Gmail API client for the user.
 */
export const getGmail = async (user) => {
  const auth = getOAuth2Client(user);
  const gmail = google.gmail({ version: "v1", auth });
  return wrapWithInvalidGrantHandler(gmail, user);
};

/**
 * Helper to fetch user's Gmail profile (including current historyId).
 */
export const getProfile = async (userOrGmail, maybeUser) => {
  let gmail = userOrGmail;
  let user = maybeUser;

  if (
    userOrGmail &&
    !userOrGmail.users &&
    (userOrGmail.refreshToken || userOrGmail._id)
  ) {
    user = userOrGmail;
    gmail = await getGmail(user);
  }

  try {
    const res = await gmail.users.getProfile({ userId: "me" });
    return res.data;
  } catch (err) {
    if (user) await handleInvalidGrant(user, err);
    throw err;
  }
};

/**
 * Helper to list history records for incremental sync.
 */
export const listHistory = async (userOrGmail, params = {}, maybeUser) => {
  let gmail = userOrGmail;
  let user = maybeUser;

  if (
    userOrGmail &&
    !userOrGmail.users &&
    (userOrGmail.refreshToken || userOrGmail._id)
  ) {
    user = userOrGmail;
    gmail = await getGmail(user);
  }

  try {
    const res = await gmail.users.history.list({
      userId: "me",
      ...params
    });
    return res.data;
  } catch (err) {
    if (user) await handleInvalidGrant(user, err);
    throw err;
  }
};

export const historyList = listHistory;

export const setupDefaultLabels = async (user) => {
  if (user.labels && user.labels.length > 0) return;

  const gmail = await getGmail(user);

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
  await user.save();
};

/**
 * Update an existing Gmail draft.
 * The existing Gmail draft ID is retained.
 */
export const updateGmailDraft = async (
  gmail,
  { gmailDraftId, to, subject, body, threadId, inReplyTo, references, replyTo }
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
};

/**
 * Permanently delete an existing Gmail draft.
 */
export const deleteGmailDraft = async (gmail, gmailDraftId) => {
  if (!gmailDraftId) {
    throw new Error("Gmail draft ID is missing");
  }

  await gmail.users.drafts.delete({
    userId: "me",
    id: gmailDraftId
  });
};
