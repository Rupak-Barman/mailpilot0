import {
  keepPreviousData,
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
  updateEmailActionLabel,
  manualSendEmailAction,
  tryAiDraftAction,
} from "../api/emailActions.api";

export const useEmailActions = (params) =>
  useQuery({
    queryKey: ["email-actions", params],
    queryFn: () => getEmailActions(params),
    placeholderData: keepPreviousData,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });

export const useEmailActionSummary = () =>
  useQuery({
    queryKey: ["email-action-summary"],
    queryFn: getEmailActionSummary,
    placeholderData: keepPreviousData,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });

const invalidateEmailActionQueries = (queryClient) => {
  queryClient.invalidateQueries({
    queryKey: ["email-actions"],
  });

  queryClient.invalidateQueries({
    queryKey: ["email-action-summary"],
  });

  queryClient.invalidateQueries({
    queryKey: ["analytics"],
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
    },
  });
};

export const useUpdateEmailActionDraft = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateEmailActionDraft,

    onSuccess: () => {
      invalidateEmailActionQueries(queryClient);
    },
  });
};

export const useDeleteEmailActionDraft = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteEmailActionDraft,

    onSuccess: () => {
      invalidateEmailActionQueries(queryClient);
    },
  });
};

export const useUpdateEmailActionLabel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateEmailActionLabel,

    onSuccess: () => {
      invalidateEmailActionQueries(queryClient);
    },
  });
};

export const useManualSendEmailAction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: manualSendEmailAction,

    onSuccess: () => {
      invalidateEmailActionQueries(queryClient);
    },
  });
};

export const useTryAiDraftAction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: tryAiDraftAction,

    onSuccess: () => {
      invalidateEmailActionQueries(queryClient);
    },
  });
};