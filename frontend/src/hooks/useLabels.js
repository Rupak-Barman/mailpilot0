import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLabel, disableLabel, getLabels, updateLabel } from "../api/labels.api";

export const useLabels = () =>
  useQuery({
    queryKey: ["labels"],
    queryFn: getLabels
  });

export const useCreateLabel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createLabel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
      queryClient.invalidateQueries({ queryKey: ["profile-settings"] });
    }
  });
};

export const useUpdateLabel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateLabel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
      queryClient.invalidateQueries({ queryKey: ["profile-settings"] });
    }
  });
};

export const useDisableLabel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: disableLabel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
      queryClient.invalidateQueries({ queryKey: ["profile-settings"] });
    }
  });
};
