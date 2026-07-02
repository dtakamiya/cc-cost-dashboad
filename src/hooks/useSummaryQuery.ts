import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchSummary, type Period, type Summary } from "../api";

const SUMMARY_POLL_INTERVAL_MS = 30_000;

export const SUMMARY_QUERY_KEY_PREFIX = ["summary"] as const;

export function summaryQueryKey(period: Period): readonly [string, Period] {
  return [...SUMMARY_QUERY_KEY_PREFIX, period];
}

export interface UseSummaryQueryResult {
  data: Summary | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  reload: () => Promise<void>;
  isReloading: boolean;
  isReloadError: boolean;
  reloadError: unknown;
}

/**
 * /api/summary を period 単位でフェッチし、30秒間隔でポーリングする。
 * 手動リロードは reload() を呼ぶ（内部で fetchSummary(true) → 現在の period のキャッシュを更新、
 * 他 period は再フェッチさせず stale 化のみに留める）。
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
    onSuccess: (summary) => {
      // /api/reload は全期間分の再集計結果を返すため、そのまま現在の queryKey に反映すれば
      // 追加の GET /api/summary を発行せずに済む。他 period のキャッシュは stale 化のみ行う。
      queryClient.setQueryData(queryKey, summary);
      queryClient.invalidateQueries({
        queryKey: SUMMARY_QUERY_KEY_PREFIX,
        exact: false,
        refetchType: "none",
      });
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isFetching: query.isFetching,
    reload: async () => {
      try {
        await reloadMutation.mutateAsync();
      } catch {
        // 失敗は reloadMutation.isError / error 経由で呼び出し側に伝える。
        // ここで再スローすると onClick 側で未処理の Promise 拒否になるため握りつぶす。
      }
    },
    isReloading: reloadMutation.isPending,
    isReloadError: reloadMutation.isError,
    reloadError: reloadMutation.error,
  };
}
