import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  getEmailActions,
  getEmailActionSummary,
  setEmailActionChecked,
  sendEmailAction,
  updateEmailActionDraft,
  deleteEmailActionDraft,
  updateEmailActionLabel
} from "../api/emailActions.api";

export const useEmailActions = (params) =>
  useQuery({
    queryKey: ["email-actions", params],
    queryFn: () => getEmailActions(params),
  });

export const useEmailActionSummary = () =>
  useQuery({
    queryKey: ["email-action-summary"],
    queryFn: getEmailActionSummary,
  });

const invalidateEmailActionQueries = (queryClient) => {
  queryClient.invalidateQueries({
    queryKey: ["email-actions"],
  });

  queryClient.invalidateQueries({
    queryKey: ["email-action-summary"],
  });
};

export const useSetEmailActionChecked = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setEmailActionChecked,

    onSuccess: () => {
      invalidateEmailActionQueries(queryClient);

      queryClient.invalidateQueries({
        queryKey: ["profile-settings"],
      });
    },
  });
};

export const useSendEmailAction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: sendEmailAction,

    onSuccess: () => {
      invalidateEmailActionQueries(queryClient);

      queryClient.invalidateQueries({
        queryKey: ["analytics"],
      });
    },
  });
};

export const useUpdateEmailActionDraft = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateEmailActionDraft,

    onSuccess: (result) => {
      invalidateEmailActionQueries(queryClient);

      queryClient.invalidateQueries({
        queryKey: ["analytics"],
      });
    },
  });
};

export const useDeleteEmailActionDraft = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteEmailActionDraft,

    onSuccess: () => {
      invalidateEmailActionQueries(queryClient);

      queryClient.invalidateQueries({
        queryKey: ["analytics"],
      });
    },
  });
};

export const useUpdateEmailActionLabel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateEmailActionLabel,

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["email-actions"]
      });
    }
  });
};