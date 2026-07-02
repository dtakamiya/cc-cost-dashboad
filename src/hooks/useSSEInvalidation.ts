import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeToUpdates } from "../api";

/**
 * SSE (/api/events) の update 通知を受信したら summary/hourly クエリを invalidate する。
 * enabled=false の間は購読しない（ライブ更新 OFF 時に対応）。
 */
export function useSSEInvalidation(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribeToUpdates(() => {
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["hourly"] });
    });
    return unsubscribe;
  }, [enabled, queryClient]);
}
