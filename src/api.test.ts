import { describe, it, expect, vi, afterEach } from "vitest";
import { filterSummary, filterSummaryByProject, filterPreviousPeriod, isDateRange, fetchPricing, subscribeToUpdates, fetchHourly, fetchSummary, sessionEfficiencyScore, sessionEfficiencyColor, isFrequentlyCompactedSession, type Summary, type DailyCost, type Pricing, type SessionCost, type HourlyData, type DateRange } from "./api";

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

const day = (
  date: string,
  total: number,
  projectTokens?: Record<string, number>,
  projectCosts?: Record<string, number>,
  subagent?: { mainTokens: number; mainCost: number; subagentTokens: number; subagentCost: number }
): DailyCost => ({
  date,
  models: { "claude-opus-4-8": total },
  total,
  tokenModels: { "claude-opus-4-8": total * 1000 },
  tokenTotal: total * 1000,
  projectTokens: projectTokens ?? { "/home/u/proj": total * 1000 },
  projectCosts: projectCosts ?? { "/home/u/proj": total },
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheReadRatio: 0,
  mainTokens: subagent?.mainTokens ?? total * 1000,
  mainCost: subagent?.mainCost ?? total,
  subagentTokens: subagent?.subagentTokens ?? 0,
  subagentCost: subagent?.subagentCost ?? 0,
});

const sess = (cwd: string, cost: number, tokens: number): SessionCost => ({
  sessionId: `sess-${cwd}-${cost}`,
  cwd,
  cost,
  tokens,
  messages: 10,
  input: tokens * 0.5,
  output: tokens * 0.3,
  cacheCreate: tokens * 0.1,
  cacheRead: tokens * 0.1,
  firstTs: "2026-06-27T00:00:00.000Z",
  lastTs: "2026-06-27T01:00:00.000Z",
  avgContextPerMsg: 100,
  topModel: { model: "claude-opus-4-8", cost },
  compactionCount: 0,
});

// プロジェクトフィルタテスト用 Summary
const summaryWithProjects = (): Summary => ({
  generatedAt: "2026-06-27T00:00:00.000Z",
  totals: { cost: 150, tokens: 150_000, sessions: 3, messages: 30, from: ymdAgo(5), to: ymdAgo(0) },
  tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  models: [{ model: "claude-opus-4-8", cost: 150, tokens: 150_000, isFallback: false }],
  daily: [
    day(
      ymdAgo(3), 60,
      { "/home/u/projA": 40_000, "/home/u/projB": 20_000 },
      { "/home/u/projA": 40, "/home/u/projB": 20 },
      { mainTokens: 45_000, mainCost: 45, subagentTokens: 15_000, subagentCost: 15 }
    ),
    day(
      ymdAgo(1), 90,
      { "/home/u/projA": 90_000 },
      { "/home/u/projA": 90 },
      { mainTokens: 72_000, mainCost: 72, subagentTokens: 18_000, subagentCost: 18 }
    ),
  ],
  projects: [
    { cwd: "/home/u/projA", cost: 100, tokens: 130_000 },
    { cwd: "/home/u/projB", cost: 50, tokens: 20_000 },
  ],
  drivers: {
    topModel: { model: "claude-opus-4-8", cost: 150, tokens: 150_000, isFallback: false },
    topDay: null,
    topDayModel: null,
    cacheReadRatio: 0,
    outputCostRatio: 0,
  },
  sessionStats: { avgColdStartTokens: 1000, p90ColdStartTokens: 2000, coldStartCost: 5 },
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
  bySession: [
    sess("/home/u/projA", 100, 130_000),
    sess("/home/u/projB", 50, 20_000),
  ],
  byTool: [],
  byMcpServer: [],
  subagentStats: {
    mainTokens: 117_000,
    mainCost: 117,
    subagentTokens: 33_000,
    subagentCost: 33,
    subagentRatio: 33_000 / 150_000,
  },
});

// 全期間 cost=100、cacheStats は全期間値。7d で一部のみ残す。
const summary = (): Summary => ({
  generatedAt: "2026-06-30T00:00:00.000Z",
  totals: { cost: 100, tokens: 100_000, sessions: 5, messages: 50, from: ymdAgo(40), to: ymdAgo(0) },
  tokenSplit: { input: 0, output: 0, cacheCreate: 100_000, cacheRead: 700_000 },
  costSplit: { input: 0, output: 0, cacheWrite: 40, cacheRead: 10 },
  models: [{ model: "claude-opus-4-8", cost: 100, tokens: 100_000, isFallback: false }],
  daily: [
    // 意図的に costRatio(0.2)とは異なる sidechain 分布にする（旧40, 旧80/新20 の内訳を持つ）。
    day(ymdAgo(40), 80, undefined, undefined, { mainTokens: 60_000, mainCost: 60, subagentTokens: 20_000, subagentCost: 20 }),
    day(ymdAgo(1), 20, undefined, undefined, { mainTokens: 5_000, mainCost: 5, subagentTokens: 15_000, subagentCost: 15 }),
  ], // 7d には ymdAgo(1) のみ入る
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
  subagentStats: {
    mainTokens: 65_000,
    mainCost: 65,
    subagentTokens: 35_000,
    subagentCost: 35,
    subagentRatio: 35_000 / 100_000,
  },
  blocks: [],
  projection: null,
  activity: { matrix: [], max: 0, total: 0, peak: null },
  bySession: [],
  byTool: [],
  byMcpServer: [],
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

describe("filterSummary subagentStats", () => {
  it("7d は daily から正確に再合算する（costRatio 近似ではない）", () => {
    const filtered = filterSummary(summary(), "7d");
    // 7d に残るのは ymdAgo(1) のみ: mainTokens=5_000, subagentTokens=15_000
    // costRatio(0.2)で全体(65_000/35_000)をスケールすると 13_000/7_000 になり、これとは異なる値になるはず
    expect(filtered.subagentStats!.mainTokens).toBe(5_000);
    expect(filtered.subagentStats!.subagentTokens).toBe(15_000);
    expect(filtered.subagentStats!.mainCost).toBeCloseTo(5, 6);
    expect(filtered.subagentStats!.subagentCost).toBeCloseTo(15, 6);
  });

  it("7d の subagentRatio はスケール後の絶対量から再計算される", () => {
    const filtered = filterSummary(summary(), "7d");
    // 15_000 / (5_000 + 15_000) = 0.75 （全体比 0.35 とは異なる）
    expect(filtered.subagentStats!.subagentRatio).toBeCloseTo(0.75, 10);
  });

  it("all は subagentStats をそのまま保持する", () => {
    const filtered = filterSummary(summary(), "all");
    expect(filtered.subagentStats!.mainTokens).toBe(65_000);
    expect(filtered.subagentStats!.subagentTokens).toBe(35_000);
    expect(filtered.subagentStats!.subagentRatio).toBeCloseTo(0.35, 10);
  });

  it("subagentStats が undefined の場合、フィルタ後も undefined のままになる", () => {
    const s = { ...summary(), subagentStats: undefined };
    const filtered = filterSummary(s, "7d");
    expect(filtered.subagentStats).toBeUndefined();
  });

  it("sidechain レコードが0件（main/subagentともに0）でも0除算せずsubagentRatio=0になる", () => {
    const s: Summary = {
      ...summary(),
      daily: [day(ymdAgo(1), 10, undefined, undefined, { mainTokens: 0, mainCost: 0, subagentTokens: 0, subagentCost: 0 })],
    };
    const filtered = filterSummary(s, "7d");
    expect(filtered.subagentStats!.mainTokens).toBe(0);
    expect(filtered.subagentStats!.subagentTokens).toBe(0);
    expect(filtered.subagentStats!.subagentRatio).toBe(0);
  });
});

describe("filterSummary projects コスト集計", () => {
  it("projects の cost が日別 projectCosts の合計になる（0固定ではない）", () => {
    const result = filterSummary(summaryWithProjects(), "7d");
    const projA = result.projects.find(p => p.cwd === "/home/u/projA");
    const projB = result.projects.find(p => p.cwd === "/home/u/projB");
    // projA: day1 40 + day2 90 = 130、projB: day1 20
    expect(projA?.cost).toBeCloseTo(130, 5);
    expect(projB?.cost).toBeCloseTo(20, 5);
  });
});

describe("filterSummaryByProject", () => {
  it("空文字フィルタのときは元の Summary を返す", () => {
    const s = summaryWithProjects();
    const result = filterSummaryByProject(s, "");
    expect(result).toBe(s);
  });

  it("bySession を選択した cwd のみに絞り込む", () => {
    const result = filterSummaryByProject(summaryWithProjects(), "/home/u/projA");
    expect(result.bySession).toHaveLength(1);
    expect(result.bySession[0].cwd).toBe("/home/u/projA");
  });

  it("選択プロジェクトのデータがない日を daily から除外する", () => {
    const s = summaryWithProjects();
    // projB は ymdAgo(3) の日のみにデータがある
    const result = filterSummaryByProject(s, "/home/u/projB");
    expect(result.daily).toHaveLength(1);
    expect(result.daily[0].date).toBe(s.daily[0].date);
  });

  it("daily の tokenTotal をそのプロジェクトのトークン数に更新する", () => {
    const result = filterSummaryByProject(summaryWithProjects(), "/home/u/projA");
    // day[0]: projA=40_000, day[1]: projA=90_000
    expect(result.daily[0].tokenTotal).toBe(40_000);
    expect(result.daily[1].tokenTotal).toBe(90_000);
  });

  it("daily の total をトークン比でスケールする", () => {
    const result = filterSummaryByProject(summaryWithProjects(), "/home/u/projA");
    // day[0]: total=60, projA比=40_000/60_000=2/3 → 40
    expect(result.daily[0].total).toBeCloseTo(40, 5);
    // day[1]: total=90, projA比=90_000/90_000=1 → 90
    expect(result.daily[1].total).toBeCloseTo(90, 5);
  });

  it("totals.cost と totals.tokens を daily（切り詰め前）から再計算する", () => {
    const result = filterSummaryByProject(summaryWithProjects(), "/home/u/projA");
    // day[0]: 60 * (40_000/60_000) = 40、day[1]: 90 * 1 = 90 → 合計 130
    expect(result.totals.cost).toBeCloseTo(130, 5);
    // tokenTotal: 40_000 + 90_000 = 130_000
    expect(result.totals.tokens).toBe(130_000);
  });

  it("models をフィルタ後 daily から再集計する", () => {
    const s = summaryWithProjects();
    const result = filterSummaryByProject(s, "/home/u/projA");
    expect(result.models).toHaveLength(1);
    // day[0]: opus cost = 60*(2/3)=40, day[1]: opus cost = 90*1=90 → 130
    expect(result.models[0].model).toBe("claude-opus-4-8");
    expect(result.models[0].cost).toBeCloseTo(130, 5);
  });

  it("totals.messages をフィルタ後 bySession から再計算する", () => {
    const result = filterSummaryByProject(summaryWithProjects(), "/home/u/projA");
    // projA のセッションは 1 件、messages=10
    expect(result.totals.messages).toBe(10);
  });

  it("projects を選択した cwd のみに絞り込む", () => {
    const result = filterSummaryByProject(summaryWithProjects(), "/home/u/projA");
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].cwd).toBe("/home/u/projA");
  });

  it("subagentStats がプロジェクト比率でスケールされた上で正確に合算される", () => {
    const result = filterSummaryByProject(summaryWithProjects(), "/home/u/projA");
    // day0: ratio=40_000/60_000=2/3 → main 45_000*2/3=30_000, subagent 15_000*2/3=10_000
    // day1: ratio=90_000/90_000=1   → main 72_000,          subagent 18_000
    // 合計: main=102_000, subagent=28_000
    expect(result.subagentStats!.mainTokens).toBeCloseTo(102_000, 5);
    expect(result.subagentStats!.subagentTokens).toBeCloseTo(28_000, 5);
    expect(result.subagentStats!.mainCost).toBeCloseTo(102, 5);
    expect(result.subagentStats!.subagentCost).toBeCloseTo(28, 5);
    // subagentRatio = 28_000 / (102_000 + 28_000)
    expect(result.subagentStats!.subagentRatio).toBeCloseTo(28_000 / 130_000, 10);
  });

  it("subagentStats が undefined の場合、プロジェクトフィルタ後も undefined のままになる", () => {
    const s = { ...summaryWithProjects(), subagentStats: undefined };
    const result = filterSummaryByProject(s, "/home/u/projA");
    expect(result.subagentStats).toBeUndefined();
  });
});

describe("isDateRange", () => {
  it("DateRange オブジェクトを true と判定する", () => {
    const range: DateRange = { from: "2025-06-01", to: "2025-06-14" };
    expect(isDateRange(range)).toBe(true);
  });

  it("固定期間文字列を false と判定する", () => {
    expect(isDateRange("7d")).toBe(false);
    expect(isDateRange("30d")).toBe(false);
    expect(isDateRange("90d")).toBe(false);
    expect(isDateRange("all")).toBe(false);
  });
});

describe("filterSummary カスタム日付範囲", () => {
  const makeAbsoluteSummary = (): Summary => ({
    generatedAt: "2025-06-15T00:00:00.000Z",
    totals: { cost: 100, tokens: 100_000, sessions: 3, messages: 30, from: "2025-05-01", to: "2025-06-15" },
    tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    models: [{ model: "claude-opus-4-8", cost: 100, tokens: 100_000, isFallback: false }],
    daily: [
      day("2025-05-10", 20),
      day("2025-06-01", 30),
      day("2025-06-10", 50),
    ],
    projects: [],
    drivers: { topModel: null, topDay: null, topDayModel: null, cacheReadRatio: 0, outputCostRatio: 0 },
    sessionStats: { avgColdStartTokens: 1000, p90ColdStartTokens: 2000, coldStartCost: 10 },
    overhead: {
      claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [],
      projectPlugins: [], mcpServers: [], totalAlwaysTokens: 0, totalInvokeTokens: 0, totalEstimatedTokens: 0,
    },
    warnings: { fallbackModels: [] },
    blocks: [],
    projection: null,
    activity: { matrix: [], max: 0, total: 0, peak: null },
    bySession: [
      { ...sess("/proj", 30, 30_000), lastTs: "2025-06-01T00:00:00.000Z" },
      { ...sess("/proj", 50, 50_000), lastTs: "2025-06-10T00:00:00.000Z" },
      { ...sess("/proj", 20, 20_000), lastTs: "2025-05-10T00:00:00.000Z" },
    ],
    byTool: [],
  byMcpServer: [],
  });

  it("from-to 範囲の日付のみ daily に残す", () => {
    const filtered = filterSummary(makeAbsoluteSummary(), { from: "2025-06-01", to: "2025-06-14" });
    expect(filtered.daily).toHaveLength(2);
    expect(filtered.daily[0].date).toBe("2025-06-01");
    expect(filtered.daily[1].date).toBe("2025-06-10");
  });

  it("from-to 範囲外の daily を除外する", () => {
    const filtered = filterSummary(makeAbsoluteSummary(), { from: "2025-06-01", to: "2025-06-14" });
    expect(filtered.daily.map(d => d.date)).not.toContain("2025-05-10");
  });

  it("lastTs が範囲内のセッションのみ残す", () => {
    const filtered = filterSummary(makeAbsoluteSummary(), { from: "2025-06-01", to: "2025-06-14" });
    expect(filtered.bySession).toHaveLength(2);
  });

  it("空の filteredDaily でも totals.cost が 0 になる", () => {
    const filtered = filterSummary(makeAbsoluteSummary(), { from: "2020-01-01", to: "2020-01-31" });
    expect(filtered.totals.cost).toBe(0);
    expect(filtered.daily).toHaveLength(0);
  });
});

describe("filterPreviousPeriod カスタム日付範囲", () => {
  it("DateRange を渡すと null を返す", () => {
    const result = filterPreviousPeriod(summary(), { from: "2025-06-01", to: "2025-06-14" });
    expect(result).toBeNull();
  });
});

describe("HourlyData type", () => {
  it("HourlyData type is properly defined", () => {
    const data: HourlyData = {
      hour: 10,
      tokens: 1000,
      cost: 5.0,
      models: [{ model: "claude-opus-4-8", cost: 5.0, tokens: 1000 }],
    };
    expect(data.hour).toBe(10);
    expect(data.tokens).toBe(1000);
    expect(data.cost).toBe(5.0);
    expect(data.models).toHaveLength(1);
    expect(data.models[0].tokens).toBe(1000);
  });
});

describe("fetchSummary の period クエリ", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const dummySummaryResponse = { generatedAt: "2026-01-01T00:00:00.000Z" };

  it("period 未指定のとき /api/summary をクエリ無しで呼ぶ", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dummySummaryResponse),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchSummary();

    expect(mockFetch).toHaveBeenCalledWith("/api/summary");
  });

  it("period='7d' を渡すと /api/summary?period=7d を呼ぶ", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dummySummaryResponse),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchSummary(false, "7d");

    expect(mockFetch).toHaveBeenCalledWith("/api/summary?period=7d");
  });

  it("period に DateRange を渡すと from/to をクエリ文字列に含める", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dummySummaryResponse),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchSummary(false, { from: "2026-06-01", to: "2026-06-10" });

    expect(mockFetch).toHaveBeenCalledWith("/api/summary?from=2026-06-01&to=2026-06-10");
  });

  it("reload=true のときは period を無視して POST /api/reload を呼ぶ", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dummySummaryResponse),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchSummary(true, "30d");

    expect(mockFetch).toHaveBeenCalledWith("/api/reload", { method: "POST" });
  });
});

describe("sessionEfficiencyScore", () => {
  it("cacheRead=0 のとき null を返す", () => {
    const s = { ...sess("/proj", 10, 1000), cacheRead: 0, input: 100 };
    expect(sessionEfficiencyScore(s)).toBeNull();
  });

  it("input=30, cacheRead=70 のとき score=70 を返す", () => {
    const s = { ...sess("/proj", 10, 1000), input: 30, cacheRead: 70 };
    expect(sessionEfficiencyScore(s)).toBe(70);
  });

  it("境界値: score=49 相当は danger 判定になる値を返す", () => {
    const s = { ...sess("/proj", 10, 1000), input: 51, cacheRead: 49 };
    expect(sessionEfficiencyScore(s)).toBe(49);
  });

  it("境界値: score=50 相当を返す", () => {
    const s = { ...sess("/proj", 10, 1000), input: 50, cacheRead: 50 };
    expect(sessionEfficiencyScore(s)).toBe(50);
  });

  it("境界値: score=69 相当を返す", () => {
    const s = { ...sess("/proj", 10, 1000), input: 31, cacheRead: 69 };
    expect(sessionEfficiencyScore(s)).toBe(69);
  });
});

describe("sessionEfficiencyColor", () => {
  it("null のとき muted 色を返す", () => {
    expect(sessionEfficiencyColor(null)).toBe("var(--muted)");
  });

  it("score=49 のとき danger 色を返す", () => {
    expect(sessionEfficiencyColor(49)).toBe("var(--danger)");
  });

  it("score=50 のとき warn 色を返す", () => {
    expect(sessionEfficiencyColor(50)).toBe("var(--warn)");
  });

  it("score=69 のとき warn 色を返す", () => {
    expect(sessionEfficiencyColor(69)).toBe("var(--warn)");
  });

  it("score=70 のとき success 色を返す", () => {
    expect(sessionEfficiencyColor(70)).toBe("var(--success)");
  });
});

describe("isFrequentlyCompactedSession", () => {
  it("compactionCount がデフォルト閾値(3)以上なら true", () => {
    const s = { ...sess("/proj", 10, 1000), compactionCount: 3 };
    expect(isFrequentlyCompactedSession(s)).toBe(true);
  });

  it("compactionCount が閾値未満なら false", () => {
    const s = { ...sess("/proj", 10, 1000), compactionCount: 2 };
    expect(isFrequentlyCompactedSession(s)).toBe(false);
  });

  it("compactionCount=0 なら false", () => {
    const s = { ...sess("/proj", 10, 1000), compactionCount: 0 };
    expect(isFrequentlyCompactedSession(s)).toBe(false);
  });

  it("カスタム閾値を尊重する", () => {
    const s = { ...sess("/proj", 10, 1000), compactionCount: 5 };
    expect(isFrequentlyCompactedSession(s, 5)).toBe(true);
    expect(isFrequentlyCompactedSession(s, 6)).toBe(false);
  });
});

describe("fetchHourly API function", () => {
  const mockHourly: HourlyData[] = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    tokens: 100 + i,
    cost: 1.0 + i * 0.1,
    models: [{ model: "claude-opus-4-8", cost: 1.0 + i * 0.1, tokens: 100 + i }],
  }));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns unwrapped HourlyData array on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ hourly: mockHourly }),
    }));

    const result = await fetchHourly();
    expect(result).toHaveLength(24);
    expect(result[0].hour).toBe(0);
    expect(result[0].tokens).toBe(100);
    expect(result[0].models[0].tokens).toBe(100);
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(fetchHourly()).rejects.toThrow("hourly fetch failed");
  });
});
