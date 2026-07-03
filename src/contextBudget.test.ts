import { describe, it, expect } from "vitest";
import { computeContextBudget, HISTORY_DOMINANT_RATIO_THRESHOLD } from "./contextBudget";
import type { Summary } from "./api";

// 全区分が非ゼロの中立な Summary。各テストで必要箇所だけ上書きする。
const baseSummary = (over: Partial<Summary> = {}): Summary => ({
  generatedAt: "2026-06-30T00:00:00.000Z",
  totals: { cost: 100, tokens: 1_000_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-30" },
  tokenSplit: { input: 100_000, output: 100_000, cacheCreate: 100_000, cacheRead: 700_000 },
  costSplit: { input: 25, output: 25, cacheWrite: 25, cacheRead: 25 },
  models: [],
  daily: [],
  projects: [],
  drivers: {
    topModel: null,
    topDay: null,
    topDayModel: null,
    cacheReadRatio: 0.7,
    outputCostRatio: 0.25,
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
  blocks: [],
  projection: null,
  activity: { matrix: [], max: 0, total: 0, peak: null },
  bySession: [],
  ...over,
});

describe("computeContextBudget", () => {
  it("4区分の割合を合計100%で返す", () => {
    const budget = computeContextBudget(baseSummary());
    const total =
      budget.overheadPct + budget.historyPct + budget.inputPct + budget.outputPct;
    expect(total).toBeCloseTo(100, 5);
  });

  it("常時注入オーバーヘッドの割合が overhead.totalAlwaysTokens に基づいて算出される", () => {
    // totalAlwaysTokens=1000, cacheRead=700_000, input+cacheCreate=200_000, output=100_000 → 分母1_001_000
    const budget = computeContextBudget(baseSummary());
    expect(budget.overheadPct).toBeCloseTo((1000 / 1_001_000) * 100, 5);
  });

  it("会話履歴再送の割合が tokenSplit.cacheRead に基づいて算出される", () => {
    const budget = computeContextBudget(baseSummary());
    expect(budget.historyPct).toBeCloseTo((700_000 / 1_001_000) * 100, 5);
  });

  it("新規入力の割合が tokenSplit.input + tokenSplit.cacheCreate に基づいて算出される", () => {
    const budget = computeContextBudget(baseSummary());
    expect(budget.inputPct).toBeCloseTo((200_000 / 1_001_000) * 100, 5);
  });

  it("生成の割合が tokenSplit.output に基づいて算出される", () => {
    const budget = computeContextBudget(baseSummary());
    expect(budget.outputPct).toBeCloseTo((100_000 / 1_001_000) * 100, 5);
  });

  it("全トークンが0のとき例外を投げず、各割合が0を返す", () => {
    const budget = computeContextBudget(
      baseSummary({
        tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
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
      })
    );
    expect(budget.overheadPct).toBe(0);
    expect(budget.historyPct).toBe(0);
    expect(budget.inputPct).toBe(0);
    expect(budget.outputPct).toBe(0);
    expect(budget.historyDominant).toBe(false);
  });

  it("totalAlwaysTokens のみ0で他が非0のとき正しい割合になる", () => {
    const budget = computeContextBudget(
      baseSummary({
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
      })
    );
    // 分母 = 700_000 + 200_000 + 100_000 = 1_000_000
    expect(budget.overheadPct).toBe(0);
    expect(budget.historyPct).toBeCloseTo(70, 5);
  });

  it("historyReplayRatio が閾値超のとき historyDominant: true を返す", () => {
    const budget = computeContextBudget(
      baseSummary({
        tokenSplit: { input: 10_000, output: 10_000, cacheCreate: 10_000, cacheRead: 900_000 },
      })
    );
    expect(budget.historyPct / 100).toBeGreaterThan(HISTORY_DOMINANT_RATIO_THRESHOLD);
    expect(budget.historyDominant).toBe(true);
  });

  it("historyReplayRatio が閾値未満のとき historyDominant: false を返す", () => {
    const budget = computeContextBudget(
      baseSummary({
        tokenSplit: { input: 400_000, output: 400_000, cacheCreate: 0, cacheRead: 100_000 },
      })
    );
    expect(budget.historyDominant).toBe(false);
  });

  it("historyReplayRatio が閾値ちょうどのとき historyDominant: false を返す（境界値、超過のみ発火）", () => {
    // overhead=0, cacheRead=500_000, input+cacheCreate+output=500_000 → historyRatio = 0.5 ちょうど
    const budget = computeContextBudget(
      baseSummary({
        tokenSplit: { input: 250_000, output: 250_000, cacheCreate: 0, cacheRead: 500_000 },
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
      })
    );
    expect(budget.historyPct).toBeCloseTo(50, 5);
    expect(budget.historyDominant).toBe(false);
  });

  it("HISTORY_DOMINANT_RATIO_THRESHOLD がexportされている", () => {
    expect(HISTORY_DOMINANT_RATIO_THRESHOLD).toBe(0.5);
  });
});
