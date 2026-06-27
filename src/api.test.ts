import { describe, it, expect } from "vitest";
import { filterSummary, type Summary, type DailyCost } from "./api";

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

describe("filterSummary cacheStats", () => {
  it("7d は cacheStats をコスト比でスケールする", () => {
    const filtered = filterSummary(summary(), "7d");
    // 7d の総コスト = 20、全期間 = 100 → 比 0.2
    const ratio = 0.2;
    expect(filtered.cacheStats.premium1h).toBeCloseTo(7.5 * ratio, 6);
    expect(filtered.cacheStats.writeCost).toBeCloseTo(40 * ratio, 6);
    expect(filtered.cacheStats.roiNet).toBeCloseTo(50 * ratio, 6);
    expect(filtered.cacheStats.create1hTokens).toBeCloseTo(50_000 * ratio, 6);
  });

  it("all は cacheStats をそのまま保持する", () => {
    const filtered = filterSummary(summary(), "all");
    expect(filtered.cacheStats.premium1h).toBe(7.5);
    expect(filtered.cacheStats.roiNet).toBe(50);
  });
});
