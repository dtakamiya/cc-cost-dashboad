import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSummaryQuery } from "./useSummaryQuery";
import { createQueryClientWrapper } from "../testUtils/queryClientWrapper";
import * as api from "../api";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    fetchSummary: vi.fn(),
  };
});

const mockFetchSummary = vi.mocked(api.fetchSummary);

const minimalSummary: api.Summary = {
  generatedAt: "2026-01-01T00:00:00Z",
  totals: { cost: 0, tokens: 0, sessions: 0, messages: 0, from: null, to: null },
  tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  models: [],
  daily: [],
  projects: [],
  drivers: {
    topModel: null,
    topDay: null,
    topDayModel: null,
    cacheReadRatio: 0,
    outputCostRatio: 0,
  },
  sessionStats: { avgColdStartTokens: 0, p90ColdStartTokens: 0, coldStartCost: 0 },
  overhead: {
    claudeMd: null,
    atRefs: [],
    globalPlugins: [],
    personalSkills: [],
    projectPlugins: [],
    mcpServers: [],
    totalAlwaysTokens: 0,
    totalInvokeTokens: 0,
    totalEstimatedTokens: 0,
  },
  warnings: { fallbackModels: [] },
  blocks: [],
  projection: null,
  activity: { matrix: [], max: 0, total: 0, peak: null },
  bySession: [],
  byTool: [],
  byMcpServer: [],
};

describe("useSummaryQuery", () => {
  beforeEach(() => {
    mockFetchSummary.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("初回フェッチに成功すると data に Summary が入る", async () => {
    mockFetchSummary.mockResolvedValue(minimalSummary);
    const { wrapper } = createQueryClientWrapper();

    const { result } = renderHook(() => useSummaryQuery("7d"), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(minimalSummary));
    expect(mockFetchSummary).toHaveBeenCalledWith(false, "7d");
  });

  it("period が変わると再フェッチされる", async () => {
    mockFetchSummary.mockResolvedValue(minimalSummary);
    const { wrapper } = createQueryClientWrapper();

    const { result, rerender } = renderHook(
      ({ period }: { period: api.Period }) => useSummaryQuery(period),
      { wrapper, initialProps: { period: "7d" as api.Period } }
    );

    await waitFor(() => expect(result.current.data).toEqual(minimalSummary));
    expect(mockFetchSummary).toHaveBeenCalledWith(false, "7d");

    rerender({ period: "30d" as api.Period });

    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledWith(false, "30d"));
  });

  it("フェッチ失敗時に isError が true になる", async () => {
    mockFetchSummary.mockRejectedValue(new Error("network error"));
    const { wrapper } = createQueryClientWrapper();

    const { result } = renderHook(() => useSummaryQuery("7d"), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("30秒ごとにポーリングされる", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetchSummary.mockResolvedValue(minimalSummary);
    const { wrapper } = createQueryClientWrapper();

    const { result } = renderHook(() => useSummaryQuery("7d"), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(minimalSummary));
    expect(mockFetchSummary).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(2));
  });

  it("手動リロード実行時に fetchSummary(true) が呼ばれる", async () => {
    mockFetchSummary.mockResolvedValue(minimalSummary);
    const { wrapper } = createQueryClientWrapper();

    const { result } = renderHook(() => useSummaryQuery("7d"), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(minimalSummary));

    await act(async () => {
      await result.current.reload();
    });

    expect(mockFetchSummary).toHaveBeenCalledWith(true);
  });

  it("手動リロード成功時は追加の GET を発行せず reload レスポンスをそのままキャッシュに反映する", async () => {
    mockFetchSummary.mockResolvedValue(minimalSummary);
    const { wrapper } = createQueryClientWrapper();

    const { result } = renderHook(() => useSummaryQuery("7d"), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(minimalSummary));
    expect(mockFetchSummary).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.reload();
    });

    // reload(true) の呼び出し1回のみで、fetchSummary(false, "7d") による再フェッチは発生しない
    expect(mockFetchSummary).toHaveBeenCalledTimes(2);
    expect(mockFetchSummary).toHaveBeenNthCalledWith(2, true);
  });

  it("手動リロード失敗時は reload() が例外を投げず isReloadError が true になる", async () => {
    mockFetchSummary.mockResolvedValueOnce(minimalSummary);
    const { wrapper } = createQueryClientWrapper();

    const { result } = renderHook(() => useSummaryQuery("7d"), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(minimalSummary));

    mockFetchSummary.mockRejectedValueOnce(new Error("reload failed"));

    await act(async () => {
      await result.current.reload();
    });

    await waitFor(() => expect(result.current.isReloadError).toBe(true));
    expect(String(result.current.reloadError)).toContain("reload failed");
  });
});
