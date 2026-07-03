import { describe, it, expect } from "vitest";
import {
  defaultSimulatorInput,
  simulateCacheHitSavings,
  simulateHaikuShiftSavings,
  simulateClearSavings,
  simulateSavings,
  resolveCheapestHaikuRate,
  calcHaikuMigrationSaving,
} from "./simulator";
import { BLOAT_CONTEXT_THRESHOLD, BLOAT_MIN_MESSAGES, type Summary, type SessionCost, type ModelCost } from "./api";

const session = (over: Partial<SessionCost>): SessionCost => ({
  sessionId: "s1",
  cwd: "/home/u/proj",
  cost: 0,
  tokens: 0,
  messages: 0,
  input: 0,
  output: 0,
  cacheCreate: 0,
  cacheRead: 0,
  firstTs: "2026-06-01T00:00:00.000Z",
  lastTs: "2026-06-01T01:00:00.000Z",
  avgContextPerMsg: 0,
  topModel: null,
  ...over,
});

// 全ルールが中立な Summary（期間 = 30日）。各テストで必要箇所だけ上書きする。
const baseSummary = (over: Partial<Summary> = {}): Summary => ({
  generatedAt: "2026-06-30T00:00:00.000Z",
  totals: { cost: 100, tokens: 1_000_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-30" },
  tokenSplit: { input: 100_000, output: 100_000, cacheCreate: 100_000, cacheRead: 700_000 },
  costSplit: { input: 25, output: 25, cacheWrite: 25, cacheRead: 25 },
  models: [{ model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false }],
  daily: [],
  projects: [],
  drivers: {
    topModel: { model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false },
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
  cacheStats: {
    create1hTokens: 0,
    create5mTokens: 100_000,
    write1hCost: 0,
    write5mCost: 25,
    premium1h: 0,
    readSavings: 225,
    writeCost: 25,
    roiNet: 200,
  },
  blocks: [],
  projection: null,
  activity: { matrix: [], max: 0, total: 0, peak: null },
  bySession: [],
  ...over,
});

describe("defaultSimulatorInput", () => {
  it("現在の実績値を初期値として返す", () => {
    const s = baseSummary();
    const input = defaultSimulatorInput(s);
    expect(input).toEqual({
      targetCacheHitRate: 0.7,
      haikuShiftRate: 0,
      clearRate: 0,
    });
  });
});

describe("simulateCacheHitSavings", () => {
  it("目標が現在値以下なら節約0を返す", () => {
    const s = baseSummary();
    expect(simulateCacheHitSavings(s, 0.7)).toBe(0);
    expect(simulateCacheHitSavings(s, 0.5)).toBe(0);
  });

  it("目標が現在値超なら正の節約額を返す", () => {
    const s = baseSummary();
    const savings = simulateCacheHitSavings(s, 0.9);
    expect(savings).toBeGreaterThan(0);
  });

  it("目標100%で改善余地が最大化される（改善トークンがinput全量に近づく）", () => {
    const s = baseSummary();
    const at100 = simulateCacheHitSavings(s, 1.0);
    const at90 = simulateCacheHitSavings(s, 0.9);
    expect(at100).toBeGreaterThan(at90);
  });

  it("tokenSplit.input=0でもNaN・Infinityにならない", () => {
    const s = baseSummary({ tokenSplit: { input: 0, output: 100_000, cacheCreate: 100_000, cacheRead: 700_000 } });
    const savings = simulateCacheHitSavings(s, 0.9);
    expect(Number.isFinite(savings)).toBe(true);
    expect(savings).toBe(0);
  });

  it("currentRateが1（改善余地なし）でもNaN・Infinityにならない", () => {
    const s = baseSummary({ drivers: { ...baseSummary().drivers, cacheReadRatio: 1 } });
    const savings = simulateCacheHitSavings(s, 1);
    expect(Number.isFinite(savings)).toBe(true);
    expect(savings).toBe(0);
  });
});

describe("simulateHaikuShiftSavings", () => {
  it("移行率0なら節約0を返す", () => {
    const s = baseSummary({
      models: [
        { model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false },
        { model: "claude-haiku-4-5", cost: 1, tokens: 100_000, isFallback: false },
      ],
    });
    expect(simulateHaikuShiftSavings(s, 0)).toBe(0);
  });

  it("移行率に応じて線形に増加する", () => {
    const s = baseSummary({
      models: [
        { model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false },
        { model: "claude-haiku-4-5", cost: 1, tokens: 100_000, isFallback: false },
      ],
    });
    const at50 = simulateHaikuShiftSavings(s, 0.5);
    const at100 = simulateHaikuShiftSavings(s, 1.0);
    expect(at100).toBeCloseTo(at50 * 2, 6);
    expect(at50).toBeGreaterThan(0);
  });

  it("topModelがHaiku自体（最安）の場合は0を返す", () => {
    const s = baseSummary({
      models: [{ model: "claude-haiku-4-5", cost: 10, tokens: 1_000_000, isFallback: false }],
      drivers: {
        ...baseSummary().drivers,
        topModel: { model: "claude-haiku-4-5", cost: 10, tokens: 1_000_000, isFallback: false },
      },
    });
    expect(simulateHaikuShiftSavings(s, 0.5)).toBe(0);
  });

  it("s.modelsが空でも動く（フォールバックレートを使用）", () => {
    const s = baseSummary({ models: [] });
    const savings = simulateHaikuShiftSavings(s, 0.5);
    expect(Number.isFinite(savings)).toBe(true);
    expect(savings).toBeGreaterThan(0);
  });

  it("topModelが無ければ0を返す", () => {
    const s = baseSummary({ drivers: { ...baseSummary().drivers, topModel: null } });
    expect(simulateHaikuShiftSavings(s, 0.5)).toBe(0);
  });

  it("topModel.tokensが0以下なら0を返す", () => {
    const s = baseSummary({
      drivers: {
        ...baseSummary().drivers,
        topModel: { model: "claude-opus-4-8", cost: 0, tokens: 0, isFallback: false },
      },
    });
    expect(simulateHaikuShiftSavings(s, 0.5)).toBe(0);
  });

  it("複数のHaiku変種がある場合は最安レートを採用する", () => {
    const s = baseSummary({
      models: [
        { model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false },
        // 単価: cost/tokens = 2/100_000 = 0.00002（高い方）
        { model: "claude-haiku-4-0", cost: 2, tokens: 100_000, isFallback: false },
        // 単価: cost/tokens = 1/100_000 = 0.00001（最安）
        { model: "claude-haiku-4-5", cost: 1, tokens: 100_000, isFallback: false },
      ],
    });
    const cheapestOnly = baseSummary({
      models: [
        { model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false },
        { model: "claude-haiku-4-5", cost: 1, tokens: 100_000, isFallback: false },
      ],
    });
    expect(simulateHaikuShiftSavings(s, 0.5)).toBeCloseTo(
      simulateHaikuShiftSavings(cheapestOnly, 0.5),
      6
    );
  });
});

describe("simulateClearSavings", () => {
  it("肥大化セッション無しで節約0を返す", () => {
    const s = baseSummary({ bySession: [] });
    expect(simulateClearSavings(s, 0.5)).toBe(0);
  });

  it("実施率に応じて節約額が増加する", () => {
    const s = baseSummary({
      bySession: [
        session({
          sessionId: "big",
          messages: BLOAT_MIN_MESSAGES,
          avgContextPerMsg: BLOAT_CONTEXT_THRESHOLD + 1,
          cacheRead: 500_000,
        }),
      ],
    });
    const at50 = simulateClearSavings(s, 0.5);
    const at100 = simulateClearSavings(s, 1.0);
    expect(at50).toBeGreaterThan(0);
    expect(at100).toBeCloseTo(at50 * 2, 6);
  });

  it("実施率0なら節約0を返す", () => {
    const s = baseSummary({
      bySession: [
        session({
          sessionId: "big",
          messages: BLOAT_MIN_MESSAGES,
          avgContextPerMsg: BLOAT_CONTEXT_THRESHOLD + 1,
          cacheRead: 500_000,
        }),
      ],
    });
    expect(simulateClearSavings(s, 0)).toBe(0);
  });
});

describe("simulateSavings", () => {
  it("3つの内訳の合計がtotalMonthlySavingsと一致する", () => {
    const s = baseSummary({
      models: [
        { model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false },
        { model: "claude-haiku-4-5", cost: 1, tokens: 100_000, isFallback: false },
      ],
      bySession: [
        session({
          sessionId: "big",
          messages: BLOAT_MIN_MESSAGES,
          avgContextPerMsg: BLOAT_CONTEXT_THRESHOLD + 1,
          cacheRead: 500_000,
        }),
      ],
    });
    const input = { targetCacheHitRate: 0.9, haikuShiftRate: 0.5, clearRate: 0.5 };
    const result = simulateSavings(s, input);
    expect(result.totalMonthlySavings).toBeCloseTo(
      result.cacheSavings + result.haikuSavings + result.clearSavings,
      6
    );
  });

  it("全スライダーが初期値（変化なし）では概ね0に近い", () => {
    const s = baseSummary();
    const input = defaultSimulatorInput(s);
    const result = simulateSavings(s, input);
    expect(result.totalMonthlySavings).toBeCloseTo(0, 6);
  });
});

describe("resolveCheapestHaikuRate", () => {
  it("Haikuモデルが無ければnullを返す", () => {
    const models: ModelCost[] = [
      { model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false },
    ];
    expect(resolveCheapestHaikuRate(models)).toBeNull();
  });

  it("複数のHaiku変種がある場合は最安単価を返す", () => {
    const models: ModelCost[] = [
      // 単価: 2/100_000*1e6 = 20
      { model: "claude-haiku-4-0", cost: 2, tokens: 100_000, isFallback: false },
      // 単価: 1/100_000*1e6 = 10（最安）
      { model: "claude-haiku-4-5", cost: 1, tokens: 100_000, isFallback: false },
    ];
    expect(resolveCheapestHaikuRate(models)).toBeCloseTo(10, 6);
  });

  it("tokens=0のHaikuは候補から除外される", () => {
    const models: ModelCost[] = [
      { model: "claude-haiku-4-0", cost: 5, tokens: 0, isFallback: false },
      { model: "claude-haiku-4-5", cost: 1, tokens: 100_000, isFallback: false },
    ];
    expect(resolveCheapestHaikuRate(models)).toBeCloseTo(10, 6);
  });
});

describe("calcHaikuMigrationSaving", () => {
  const s = baseSummary();
  const HAIKU_RATE = 10; // USD/MTok

  it("Sonnet行で正しい節約額を返す（月次換算込み）", () => {
    // sonnetRate = 100/1_000_000 * 1e6 = 100 USD/MTok
    const model: Pick<ModelCost, "model" | "cost" | "tokens"> = {
      model: "claude-sonnet-4-5",
      cost: 100,
      tokens: 1_000_000,
    };
    const shiftRate = 0.3;
    const expected = ((100 - HAIKU_RATE) * 1_000_000 * shiftRate) / 1_000_000; // period = 30日なのでmonthlyFactor=1
    const saving = calcHaikuMigrationSaving(model, HAIKU_RATE, shiftRate, s);
    expect(saving).toBeCloseTo(expected, 6);
  });

  it("対象自身がHaikuの場合はnullを返す", () => {
    const model: Pick<ModelCost, "model" | "cost" | "tokens"> = {
      model: "claude-haiku-4-5",
      cost: 1,
      tokens: 100_000,
    };
    expect(calcHaikuMigrationSaving(model, HAIKU_RATE, 0.3, s)).toBeNull();
  });

  it("tokens=0の場合はnullを返す", () => {
    const model: Pick<ModelCost, "model" | "cost" | "tokens"> = {
      model: "claude-sonnet-4-5",
      cost: 0,
      tokens: 0,
    };
    expect(calcHaikuMigrationSaving(model, HAIKU_RATE, 0.3, s)).toBeNull();
  });

  it("haikuRateがnullの場合はnullを返す", () => {
    const model: Pick<ModelCost, "model" | "cost" | "tokens"> = {
      model: "claude-sonnet-4-5",
      cost: 100,
      tokens: 1_000_000,
    };
    expect(calcHaikuMigrationSaving(model, null, 0.3, s)).toBeNull();
  });

  it("モデル単価がHaiku単価以下の場合はnullを返す", () => {
    // 単価 = 5/1_000_000 * 1e6 = 5 <= HAIKU_RATE(10)
    const model: Pick<ModelCost, "model" | "cost" | "tokens"> = {
      model: "claude-sonnet-4-5",
      cost: 5,
      tokens: 1_000_000,
    };
    expect(calcHaikuMigrationSaving(model, HAIKU_RATE, 0.3, s)).toBeNull();
  });
});
