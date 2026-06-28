import { describe, it, expect, vi, afterEach } from "vitest";
import { filterSummary, fetchPricing, subscribeToUpdates, type Summary, type DailyCost, type Pricing } from "./api";

// 今日から daysAgo 日前の YYYY-MM-DD。
function ymdAgo(daysAgo: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

const day = (date: string, total: number): DailyCost => ({
  date,
  models: { "claude-opus-4-8": total },
  total,
  tokenModels: { "claude-opus-4-8": total * 1000 },
  tokenTotal: total * 1000,
  projectTokens: { "/home/u/proj": total * 1000 },
});

// 全期間 cost=100、cacheStats は全期間値。7d で一部のみ残す。
const summary = (): Summary => ({
  generatedAt: "2026-06-30T00:00:00.000Z",
  totals: { cost: 100, tokens: 100_000, sessions: 5, messages: 50, from: ymdAgo(40), to: ymdAgo(0) },
  tokenSplit: { input: 0, output: 0, cacheCreate: 100_000, cacheRead: 700_000 },
  costSplit: { input: 0, output: 0, cacheWrite: 40, cacheRead: 10 },
  models: [{ model: "claude-opus-4-8", cost: 100, tokens: 100_000, isFallback: false }],
  daily: [day(ymdAgo(40), 80), day(ymdAgo(1), 20)], // 7d には 20 のみ入る
  projects: [],
  drivers: {
    topModel: { model: "claude-opus-4-8", cost: 100, tokens: 100_000, isFallback: false },
    topDay: null,
    topDayModel: null,
    cacheReadRatio: 0.7,
    outputCostRatio: 0.1,
  },
  sessionStats: { avgColdStartTokens: 2000, p90ColdStartTokens: 3000, coldStartCost: 10 },
  overhead: {
    claudeMd: null,
    atRefs: [],
    globalPlugins: [],
    personalSkills: [],
    projectPlugins: [],
    mcpServers: [],
    totalAlwaysTokens: 1000,
    totalInvokeTokens: 0,
    totalEstimatedTokens: 1000,
  },
  warnings: { fallbackModels: [] },
  cacheStats: {
    create1hTokens: 50_000,
    create5mTokens: 50_000,
    write1hCost: 20,
    write5mCost: 20,
    premium1h: 7.5,
    readSavings: 90,
    writeCost: 40,
    roiNet: 50,
  },
  blocks: [],
  projection: null,
  activity: { matrix: [], max: 0, total: 0, peak: null },
  bySession: [],
});

describe("fetchPricing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("正常レスポンスを Pricing 型として返す", async () => {
    const mockPricing: Pricing = {
      models: {
        "claude-opus-4-8": { input: 5, output: 25 },
        "claude-haiku-4-5": { input: 1, output: 5 },
      },
      multipliers: { cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPricing),
    }));
    const result = await fetchPricing();
    expect(result.models["claude-opus-4-8"]).toEqual({ input: 5, output: 25 });
    expect(result.multipliers.cacheWrite5m).toBe(1.25);
    expect(result.multipliers.cacheRead).toBe(0.1);
  });

  it("fetch が失敗したとき Error をスローする", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));
    await expect(fetchPricing()).rejects.toThrow("pricing fetch failed");
  });
});

describe("subscribeToUpdates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("EventSource を /api/events に接続する", () => {
    const mockClose = vi.fn();
    const mockAddEventListener = vi.fn();
    const MockEventSource = vi.fn().mockImplementation(() => ({
      close: mockClose,
      addEventListener: mockAddEventListener,
    }));
    vi.stubGlobal("EventSource", MockEventSource);

    subscribeToUpdates(() => {});

    expect(MockEventSource).toHaveBeenCalledWith("/api/events");
  });

  it("update イベント受信時にコールバックを呼ぶ", () => {
    const mockClose = vi.fn();
    const captured: { listener: (() => void) | null } = { listener: null };
    const mockAddEventListener = vi.fn().mockImplementation((event: string, listener: () => void) => {
      if (event === "update") captured.listener = listener;
    });
    const MockEventSource = vi.fn().mockImplementation(() => ({
      close: mockClose,
      addEventListener: mockAddEventListener,
    }));
    vi.stubGlobal("EventSource", MockEventSource);

    const onUpdate = vi.fn();
    subscribeToUpdates(onUpdate);

    expect(mockAddEventListener).toHaveBeenCalledWith("update", onUpdate);

    // リスナーを直接呼び出してコールバックが動くか確認
    captured.listener?.();
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("戻り値の unsubscribe() を呼ぶと EventSource を閉じる", () => {
    const mockClose = vi.fn();
    const MockEventSource = vi.fn().mockImplementation(() => ({
      close: mockClose,
      addEventListener: vi.fn(),
    }));
    vi.stubGlobal("EventSource", MockEventSource);

    const unsubscribe = subscribeToUpdates(() => {});
    unsubscribe();

    expect(mockClose).toHaveBeenCalledOnce();
  });
});

describe("filterSummary cacheStats", () => {
  it("7d は cacheStats をコスト比でスケールする", () => {
    const filtered = filterSummary(summary(), "7d");
    // 7d の総コスト = 20、全期間 = 100 → 比 0.2
    const ratio = 0.2;
    expect(filtered.cacheStats!.premium1h).toBeCloseTo(7.5 * ratio, 6);
    expect(filtered.cacheStats!.writeCost).toBeCloseTo(40 * ratio, 6);
    expect(filtered.cacheStats!.roiNet).toBeCloseTo(50 * ratio, 6);
    expect(filtered.cacheStats!.create1hTokens).toBeCloseTo(50_000 * ratio, 6);
  });

  it("all は cacheStats をそのまま保持する", () => {
    const filtered = filterSummary(summary(), "all");
    expect(filtered.cacheStats!.premium1h).toBe(7.5);
    expect(filtered.cacheStats!.roiNet).toBe(50);
  });
});
