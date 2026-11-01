// services/gmail.service.js
import 'dotenv/config'; 
import { google } from "googleapis";
import axios from "axios";
import { buildMimeMessage } from "../utils/helpers.js";

export const getGmail = async (user) => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  const res = await axios.post("https://oauth2.googleapis.com/token", {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: user.refreshToken,
    grant_type: "refresh_token"
  });

  user.accessToken = res.data.access_token;
  await user.save();

  auth.setCredentials({ access_token: user.accessToken });

  return google.gmail({ version: "v1", auth });
};

export const setupDefaultLabels = async (user) => {
  if (user.labels && user.labels.length > 0) return;

  const gmail = await getGmail(user);

  const DEFAULT_LABELS = [
    { name: "Work", tone: "formal", markAsRead: true, enabled: true, action: { type: "reply", template: "I'll get back to you soon." } },
    { name: "Personal", tone: "friendly", markAsRead: true, enabled: true, action: { type: "none" } },
    { name: "Promotions", tone: "casual", markAsRead: true, enabled: true, action: { type: "none" } },
    { name: "Important", tone: "formal", markAsRead: false, enabled: true, action: { type: "draft", template: "Thanks, drafting a response." } }
  ];

  const created = [];
  const existingLabels = await gmail.users.labels.list({ userId: "me" });
  const existingByName = new Map(
    (existingLabels.data.labels || []).map(label => [label.name.toLowerCase(), label])
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
 *
 * The existing Gmail draft ID is retained.
 */
export const updateGmailDraft = async (
  gmail,
  { gmailDraftId, to, subject, body, threadId, inReplyTo, references, replyTo },
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
    isReply,
  });

  const response = await gmail.users.drafts.update({
    userId: "me",
    id: gmailDraftId,
    requestBody: {
      message: {
        raw,
        ...(threadId ? { threadId } : {}),
      },
    },
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
    id: gmailDraftId,
  });
};