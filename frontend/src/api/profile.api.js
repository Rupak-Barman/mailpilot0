import { apiClient } from "./client";

export const getProfileSettings = async () => {
  const { data } = await apiClient.get("/profile/settings");
  return data;
};

export const updateProfileSettings = async (settings) => {
  const { data } = await apiClient.patch("/profile/settings", { settings });
  return data;
};
