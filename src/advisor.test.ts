import { describe, it, expect } from "vitest";
import {
  buildRecommendations,
  OVERHEAD_TOKEN_THRESHOLD,
  OUTPUT_COST_RATIO_THRESHOLD,
} from "./advisor";
import { BLOAT_CONTEXT_THRESHOLD, BLOAT_MIN_MESSAGES, type Summary, type SessionCost } from "./api";

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

// 全ルールが「発火しない」中立な Summary（期間 = 30日）。各テストで必要箇所だけ上書きする。
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
    cacheReadRatio: 0.7, // ≥ 0.5 → 発火しない
    outputCostRatio: 0.25, // ≤ 0.4 → 発火しない
  },
  sessionStats: { avgColdStartTokens: 2000, p90ColdStartTokens: 3000, coldStartCost: 10 },
  overhead: {
    claudeMd: null,
    atRefs: [],
    globalPlugins: [],
    personalSkills: [],
    projectPlugins: [],
    mcpServers: [],
    totalAlwaysTokens: 1000, // ≤ 3000 → 発火しない
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

describe("buildRecommendations", () => {
  it("中立データでは推奨なし・節約0", () => {
    const r = buildRecommendations(baseSummary());
    expect(r.items).toEqual([]);
    expect(r.totalEstMonthlySavings).toBe(0);
    expect(r.periodDays).toBe(30);
  });

  it("肥大化セッションを検出し節約額を見積もる", () => {
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
    const r = buildRecommendations(s);
    const item = r.items.find((i) => i.id === "bloated-sessions");
    expect(item).toBeDefined();
    expect(item!.estMonthlySavings).toBeGreaterThan(0);
  });

  it("高単価モデル偏りは安価モデルが判明したときのみ発火", () => {
    // opus 90% 占有 + 安価な sonnet が存在
    const s = baseSummary({
      totals: { cost: 100, tokens: 1_000_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-30" },
      models: [
        { model: "claude-opus-4-8", cost: 90, tokens: 900_000, isFallback: false },
        { model: "claude-sonnet-4-6", cost: 3, tokens: 100_000, isFallback: false },
      ],
      drivers: {
        topModel: { model: "claude-opus-4-8", cost: 90, tokens: 900_000, isFallback: false },
        topDay: null,
        topDayModel: null,
        cacheReadRatio: 0.7,
        outputCostRatio: 0.25,
      },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "model-skew");
    expect(item).toBeDefined();
    expect(item!.estMonthlySavings).toBeGreaterThan(0);
  });

  it("安価モデルが無ければモデル偏りは発火しない", () => {
    const s = baseSummary({
      models: [{ model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false }],
      drivers: {
        topModel: { model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false },
        topDay: null,
        topDayModel: null,
        cacheReadRatio: 0.7,
        outputCostRatio: 0.25,
      },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "model-skew");
    expect(item).toBeUndefined();
  });

  it("常時注入オーバーヘッド過大を検出", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        claudeMd: { label: "CLAUDE.md", bytes: 0, alwaysTokens: 5000, fullTokens: 5000, estimatedTokens: 5000 },
        totalAlwaysTokens: OVERHEAD_TOKEN_THRESHOLD + 2000,
      },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "overhead-baseline");
    expect(item).toBeDefined();
    expect(item!.estMonthlySavings).toBeGreaterThan(0);
  });

  it("output 比率過大を検出", () => {
    const s = baseSummary({
      drivers: { ...baseSummary().drivers, outputCostRatio: OUTPUT_COST_RATIO_THRESHOLD + 0.2 },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "output-heavy");
    expect(item).toBeDefined();
    expect(item!.estMonthlySavings).toBeGreaterThan(0);
  });

  it("低キャッシュ・未登録モデルは定性（節約0）で検出", () => {
    const s = baseSummary({
      drivers: { ...baseSummary().drivers, cacheReadRatio: 0.2 },
      warnings: { fallbackModels: ["mystery-model"] },
    });
    const r = buildRecommendations(s);
    expect(r.items.find((i) => i.id === "low-cache")?.estMonthlySavings).toBe(0);
    expect(r.items.find((i) => i.id === "fallback-pricing")?.estMonthlySavings).toBe(0);
  });

  it("節約額の降順でソートされ合計が一致する", () => {
    const s = baseSummary({
      bySession: [
        session({ messages: BLOAT_MIN_MESSAGES, avgContextPerMsg: BLOAT_CONTEXT_THRESHOLD + 1, cacheRead: 500_000 }),
      ],
      drivers: { ...baseSummary().drivers, outputCostRatio: 0.6, cacheReadRatio: 0.2 },
    });
    const r = buildRecommendations(s);
    const savings = r.items.map((i) => i.estMonthlySavings);
    const sorted = [...savings].sort((a, b) => b - a);
    expect(savings).toEqual(sorted);
    expect(r.totalEstMonthlySavings).toBeCloseTo(savings.reduce((a, b) => a + b, 0), 6);
  });

  it("期間が短いほど月換算節約額が大きくなる", () => {
    const make = (from: string, to: string) =>
      baseSummary({
        totals: { cost: 100, tokens: 1_000_000, sessions: 5, messages: 50, from, to },
        drivers: { ...baseSummary().drivers, outputCostRatio: 0.6 },
      });
    const week = buildRecommendations(make("2026-06-24", "2026-06-30")).totalEstMonthlySavings;
    const month = buildRecommendations(make("2026-06-01", "2026-06-30")).totalEstMonthlySavings;
    expect(week).toBeGreaterThan(month);
  });

  it("500トークン超のファイルにファイル別オーバーヘッドアドバイスを出す", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        claudeMd: {
          label: "CLAUDE.md",
          bytes: 10000,
          alwaysTokens: 800, // > 500 → 要最適化
          fullTokens: 800,
          estimatedTokens: 800,
        },
        personalSkills: [
          { label: "heavy-skill", bytes: 5000, alwaysTokens: 600, fullTokens: 1200, estimatedTokens: 600 },
        ],
        totalAlwaysTokens: 1400, // < 3000 → ルール3（旧）は発火しないが個別ルールは発火
      },
    });
    const r = buildRecommendations(s);
    const fileItems = r.items.filter((i) => i.id.startsWith("overhead-file:"));
    expect(fileItems.length).toBeGreaterThan(0);
    fileItems.forEach((item) => {
      expect(item.estMonthlySavings).toBeGreaterThanOrEqual(0);
      expect(item.detail).toMatch(/トークン/);
    });
  });

  it("200トークン以下のファイルはファイル別アドバイスを出さない", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        claudeMd: {
          label: "CLAUDE.md",
          bytes: 500,
          alwaysTokens: 150, // <= 200 → 良好
          fullTokens: 150,
          estimatedTokens: 150,
        },
        totalAlwaysTokens: 150,
      },
    });
    const r = buildRecommendations(s);
    const fileItems = r.items.filter((i) => i.id.startsWith("overhead-file:"));
    expect(fileItems.length).toBe(0);
  });

  it("500トークン超のファイルは最適化アドバイスを出す", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        claudeMd: {
          label: "CLAUDE.md",
          bytes: 5000,
          alwaysTokens: 687, // > 500 → 要最適化
          fullTokens: 687,
          estimatedTokens: 687,
        },
        totalAlwaysTokens: 687,
      },
    });
    const r = buildRecommendations(s);
    const fileItems = r.items.filter((i) => i.id.startsWith("overhead-file:"));
    expect(fileItems.length).toBeGreaterThan(0);
    expect(fileItems[0].title).toContain("687");
    expect(fileItems[0].detail).toContain("毎セッション冒頭");
  });
});
