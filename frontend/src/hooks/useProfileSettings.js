import { useQuery } from "@tanstack/react-query";
import { getProfileSettings } from "../api/profile.api";

export const useProfileSettings = () =>
  useQuery({
    queryKey: ["profile-settings"],
    queryFn: getProfileSettings,
  });