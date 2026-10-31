import { apiClient } from "./client";

export const getProfileSettings = async () => {
  const { data } = await apiClient.get("/profile/settings");
  return data;
};

export const updateProfile = async (payload) => {
  const { data } = await apiClient.patch("/profile", payload);
  return data;
};
