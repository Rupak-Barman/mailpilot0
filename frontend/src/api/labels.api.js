import { apiClient } from "./client";
export const getLabels = async () => (await apiClient.get("/labels")).data;
export const createLabel = async (payload) => (await apiClient.post("/labels", payload)).data;
export const updateLabel = async ({ labelId, payload }) => (await apiClient.patch(`/labels/${labelId}`, payload)).data;
export const disableLabel = async (labelId) => (await apiClient.delete(`/labels/${labelId}`)).data;
