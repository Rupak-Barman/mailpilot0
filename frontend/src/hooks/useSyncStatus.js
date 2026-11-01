import { useQuery } from "@tanstack/react-query";
import { getSyncStatus } from "../api/sync.api";

export const useSyncStatus = () => {
  return useQuery({
    queryKey: ["sync-status"],
    queryFn: getSyncStatus,
    refetchInterval: 15_000,
    retry: 1,
    staleTime: 5_000
  });
};
