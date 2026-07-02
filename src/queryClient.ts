import { QueryClient } from "@tanstack/react-query";

// アプリ全体で共有する QueryClient。
// staleTime: 30秒ポーリング間隔と揃え、無駄な再フェッチを避ける。
// retry: サーバーが落ちている間に無限リトライしないよう、最小限に留める。
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
