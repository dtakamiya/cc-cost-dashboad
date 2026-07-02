import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchSummary, type Period, type Summary } from "../api";

const SUMMARY_POLL_INTERVAL_MS = 30_000;

export function summaryQueryKey(period: Period) {
  return ["summary", period] as const;
}

export interface UseSummaryQueryResult {
  data: Summary | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  reload: () => Promise<Summary>;
  isReloading: boolean;
}

/**
 * /api/summary を period 単位でフェッチし、30秒間隔でポーリングする。
 * 手動リロードは reload() を呼ぶ（内部で fetchSummary(true) → キャッシュ無効化）。
 */
export function useSummaryQuery(period: Period): UseSummaryQueryResult {
  const queryClient = useQueryClient();
  const queryKey = summaryQueryKey(period);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchSummary(false, period),
    refetchInterval: SUMMARY_POLL_INTERVAL_MS,
  });

  const reloadMutation = useMutation({
    mutationFn: () => fetchSummary(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isFetching: query.isFetching,
    reload: () => reloadMutation.mutateAsync(),
    isReloading: reloadMutation.isPending,
  };
}
