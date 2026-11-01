import { apiClient } from "./client";

export const getSyncStatus = async () => {
  const { data } = await apiClient.get("/sync-status");
  return data;
};

