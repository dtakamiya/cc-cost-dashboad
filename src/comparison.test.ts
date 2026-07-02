import { describe, it, expect } from "vitest";
import {
  filterPreviousPeriod,
  calcDelta,
  shiftDailyDates,
  type Summary,
  type DailyCost,
} from "./api";

// 今日(00:00)から n 日前の YYYY-MM-DD 文字列を返すテストヘルパー。
// filterPreviousPeriod / filterSummary は new Date() を基準にするため、テストも相対日付で組む。
function daysAgoStr(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

const day = (date: string, total: number, tokenTotal: number): DailyCost => ({
  date,
  models: { "claude-opus-4-8": total },
  total,
  tokenModels: { "claude-opus-4-8": tokenTotal },
  tokenTotal,
  projectTokens: { "/home/u/proj": tokenTotal },
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheReadRatio: 0,
});

const baseSummary = (daily: DailyCost[]): Summary => ({
  generatedAt: "2026-06-30T00:00:00.000Z",
  totals: { cost: 1000, tokens: 10_000_000, sessions: 5, messages: 50, from: null, to: null },
  tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  models: [{ model: "claude-opus-4-8", cost: 1000, tokens: 10_000_000, isFallback: false }],
  daily,
  projects: [],
  drivers: {
    topModel: { model: "claude-opus-4-8", cost: 1000, tokens: 10_000_000, isFallback: false },
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
    create5mTokens: 0,
    write1hCost: 0,
    write5mCost: 0,
    premium1h: 0,
    readSavings: 0,
    writeCost: 0,
    roiNet: 0,
  },
  blocks: [],
  projection: null,
  activity: { matrix: [], max: 0, total: 0, peak: null },
  bySession: [],
});

describe("filterPreviousPeriod", () => {
  it("period='all' のときは null を返す", () => {
    const s = baseSummary([day(daysAgoStr(0), 10, 100)]);
    expect(filterPreviousPeriod(s, "all")).toBeNull();
  });

  it("period='7d' で前期7日分(8〜14日前)のコスト・トークンを集計する", () => {
    // 現在期間: 0〜6日前 / 前期: 7〜13日前
    const daily: DailyCost[] = [];
    for (let i = 0; i < 14; i++) daily.push(day(daysAgoStr(i), 10, 100));
    const prev = filterPreviousPeriod(baseSummary(daily), "7d");
    expect(prev).not.toBeNull();
    // 前期 7日分のみ → コスト 70 / トークン 700
    expect(prev!.totals.cost).toBe(70);
    expect(prev!.totals.tokens).toBe(700);
    expect(prev!.daily).toHaveLength(7);
  });

  it("前期にデータが無い場合は null を返す", () => {
    // 現在期間(0〜6日前)のみのデータ
    const daily: DailyCost[] = [];
    for (let i = 0; i < 7; i++) daily.push(day(daysAgoStr(i), 10, 100));
    expect(filterPreviousPeriod(baseSummary(daily), "7d")).toBeNull();
  });

  it("前期の終端が現在期間に混入しない（境界日のフェンスポスト）", () => {
    // 6日前(現在期間の最古日)と 7日前(前期の最新日)
    const daily = [day(daysAgoStr(6), 99, 999), day(daysAgoStr(7), 10, 100)];
    const prev = filterPreviousPeriod(baseSummary(daily), "7d");
    expect(prev).not.toBeNull();
    // 7日前のみが前期に含まれる（6日前は現在期間なので除外）
    expect(prev!.daily).toHaveLength(1);
    expect(prev!.daily[0].date).toBe(daysAgoStr(7));
    expect(prev!.totals.cost).toBe(10);
  });

  it("period='30d' で前期30日分を集計する", () => {
    const daily: DailyCost[] = [];
    for (let i = 0; i < 60; i++) daily.push(day(daysAgoStr(i), 5, 50));
    const prev = filterPreviousPeriod(baseSummary(daily), "30d");
    expect(prev).not.toBeNull();
    expect(prev!.daily).toHaveLength(30);
    expect(prev!.totals.cost).toBe(150);
  });
});

describe("calcDelta", () => {
  it("増加: calcDelta(110, 100) → +10% up", () => {
    expect(calcDelta(110, 100)).toEqual({ pct: 10, dir: "up" });
  });

  it("減少: calcDelta(90, 100) → -10% down", () => {
    expect(calcDelta(90, 100)).toEqual({ pct: -10, dir: "down" });
  });

  it("横ばい: calcDelta(100, 100) → 0% flat", () => {
    expect(calcDelta(100, 100)).toEqual({ pct: 0, dir: "flat" });
  });

  it("微小変化(±0.5%未満)は flat 扱い", () => {
    const d = calcDelta(100.3, 100);
    expect(d!.dir).toBe("flat");
  });

  it("前期も今期もゼロは比較不能で null", () => {
    expect(calcDelta(0, 0)).toBeNull();
  });

  it("前期ゼロは比較不能で null", () => {
    expect(calcDelta(50, 0)).toBeNull();
  });

  it("完全減少: calcDelta(0, 100) → -100% down", () => {
    expect(calcDelta(0, 100)).toEqual({ pct: -100, dir: "down" });
  });
});

describe("shiftDailyDates", () => {
  it("日付を offsetDays 日後ろにずらす", () => {
    const result = shiftDailyDates([day("2026-06-14", 1, 1)], 7);
    expect(result[0].date).toBe("2026-06-21");
  });

  it("月またぎでも正しくずらす", () => {
    const result = shiftDailyDates([day("2026-06-28", 1, 1)], 7);
    expect(result[0].date).toBe("2026-07-05");
  });

  it("空配列はそのまま空配列を返す", () => {
    expect(shiftDailyDates([], 7)).toEqual([]);
  });

  it("日付以外のフィールドは保持し、元配列を変更しない（immutable）", () => {
    const input = [day("2026-06-14", 42, 4200)];
    const result = shiftDailyDates(input, 7);
    expect(result[0].total).toBe(42);
    expect(result[0].tokenTotal).toBe(4200);
    expect(result[0].models).toEqual({ "claude-opus-4-8": 42 });
    // 元データは不変
    expect(input[0].date).toBe("2026-06-14");
  });
});
