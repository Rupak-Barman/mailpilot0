import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getProfileSettings, updateProfileSettings } from "../api/profile.api";

export const useProfileSettings = () =>
  useQuery({
    queryKey: ["profile-settings"],
    queryFn: getProfileSettings,
  });

export const useUpdateProfileSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings) => updateProfileSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-settings"] });
    },
  });
};
