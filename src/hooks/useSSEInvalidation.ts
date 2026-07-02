import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeToUpdates } from "../api";
import { SUMMARY_QUERY_KEY_PREFIX } from "./useSummaryQuery";
import { hourlyQueryKey } from "./useHourlyQuery";

/**
 * SSE (/api/events) の update 通知を受信したら summary/hourly クエリを invalidate する。
 * enabled=false の間は購読しない（ライブ更新 OFF 時に対応）。
 */
export function useSSEInvalidation(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribeToUpdates(() => {
      queryClient.invalidateQueries({ queryKey: SUMMARY_QUERY_KEY_PREFIX, exact: false });
      queryClient.invalidateQueries({ queryKey: hourlyQueryKey });
    });
    return unsubscribe;
  }, [enabled, queryClient]);
}
