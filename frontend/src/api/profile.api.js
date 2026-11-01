import { apiClient } from "./client";

export const getProfileSettings = async () => {
  const { data } = await apiClient.get("/profile/settings");
  return data;
};
