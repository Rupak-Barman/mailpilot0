import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getProfileSettings, updateProfile } from "../api/profile.api";

export const useProfileSettings = () =>
  useQuery({
    queryKey: ["profile-settings"],
    queryFn: getProfileSettings
  });

export const useUpdateProfile = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-settings"] });
    }
  });
};
