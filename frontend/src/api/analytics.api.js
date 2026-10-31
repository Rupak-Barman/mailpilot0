import { apiClient } from "./client";

export const getAnalytics = async ({ days = 7, from, to } = {}) => {
  const params = from || to ? { from, to } : { days };
  const { data } = await apiClient.get("/analytics", { params });
  return data;
};
