import { useQuery } from "@tanstack/react-query";
import { getAnalytics } from "../api/analytics.api";

export const useAnalytics = (filters) =>
  useQuery({
    queryKey: ["analytics", filters],
    queryFn: () => getAnalytics(filters)
  });
