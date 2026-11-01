import { apiClient } from "./client";

export const getEmailActions = async (params = {}) => {
  const { data } = await apiClient.get("/email-actions", { params });
  return data;
};

export const getEmailActionSummary = async () => {
  const { data } = await apiClient.get("/email-actions/summary");
  return data;
};

export const setEmailActionChecked = async ({ id, checked }) => {
  const { data } = await apiClient.patch(
    `/email-actions/${id}/check`,
    { checked },
  );

  return data;
};

export const sendEmailAction = async ({ id, to, cc, bcc, subject, body }) => {
  const payload =
    to !== undefined || cc !== undefined || bcc !== undefined || subject !== undefined || body !== undefined
      ? { to, cc, bcc, subject, body }
      : undefined;
  const { data } = await apiClient.post(
    `/email-actions/${id}/send`,
    payload
  );

  return data;
};

export const updateEmailActionDraft = async ({
  id,
  to,
  cc,
  bcc,
  subject,
  body,
  baseVersionId,
  forceOverwrite,
  generation,
  version,
}) => {
  const { data } = await apiClient.patch(
    `/email-actions/${id}`,
    { to, cc, bcc, subject, body, baseVersionId, forceOverwrite, generation, version },
  );

  return data;
};

export const retryGmailSyncAction = async ({ id }) => {
  const { data } = await apiClient.post(
    `/email-actions/${id}/retry-gmail-sync`
  );

  return data;
};

export const deleteEmailActionDraft = async ({ id }) => {
  const { data } = await apiClient.delete(
    `/email-actions/${id}`,
  );

  return data;
};

export const updateEmailActionLabel = async ({ id, label }) => {
  const { data } = await apiClient.patch(
    `/email-actions/${id}/label`,
    { label }
  );

  return data;
};

export const manualSendEmailAction = async ({ id, body, to, cc, bcc, subject, isAiAssisted }) => {
  const { data } = await apiClient.post(
    `/email-actions/${id}/manual-send`,
    { body, to, cc, bcc, subject, isAiAssisted }
  );

  return data;
};

export const tryAiDraftAction = async ({ id }) => {
  const { data } = await apiClient.post(
    `/email-actions/${id}/try-ai-draft`
  );

  return data;
};

export const aiAssistAction = async ({
  id,
  turnId,
  mode,
  instruction,
  useKnowledge,
  currentBody,
  versionId,
  signal,
}) => {
  const { data } = await apiClient.post(
    `/email-actions/${id}/ai-assist`,
    { turnId, mode, instruction, useKnowledge, currentBody, versionId },
    { signal }
  );

  return data;
};