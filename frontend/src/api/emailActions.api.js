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

export const sendEmailAction = async ({ id }) => {
  const { data } = await apiClient.post(
    `/email-actions/${id}/send`,
  );

  return data;
};

export const updateEmailActionDraft = async ({
  id,
  to,
  subject,
  body,
}) => {
  const { data } = await apiClient.patch(
    `/email-actions/${id}`,
    { to, subject, body },
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

export const manualSendEmailAction = async ({ id, body, to, subject }) => {
  const { data } = await apiClient.post(
    `/email-actions/${id}/manual-send`,
    { body, to, subject }
  );

  return data;
};

export const tryAiDraftAction = async ({ id }) => {
  const { data } = await apiClient.post(
    `/email-actions/${id}/try-ai-draft`
  );

  return data;
};