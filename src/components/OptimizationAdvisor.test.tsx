import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OptimizationAdvisor } from "./OptimizationAdvisor";
import type { Summary } from "../api";

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    generatedAt: "2026-06-28T00:00:00.000Z",
    totals: { cost: 10, tokens: 100_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-28" },
    tokenSplit: { input: 50_000, output: 20_000, cacheCreate: 10_000, cacheRead: 20_000 },
    costSplit: { input: 0.25, output: 0.4, cacheWrite: 0.1, cacheRead: 0.01 },
    models: [],
    daily: [],
    projects: [],
    drivers: {
      topModel: null,
      topDay: null,
      topDayModel: null,
      cacheReadRatio: 0.6,
      outputCostRatio: 0.2,
    },
    sessionStats: { avgColdStartTokens: 0, p90ColdStartTokens: 0, coldStartCost: 0 },
    overhead: {
      claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [],
      projectPlugins: [], mcpServers: [], totalAlwaysTokens: 0, totalInvokeTokens: 0, totalEstimatedTokens: 0,
    },
    warnings: { fallbackModels: [] },
    blocks: [],
    projection: null,
    activity: { matrix: [], max: 0, total: 0, peak: null },
    bySession: [],
    ...overrides,
  };
}

describe("OptimizationAdvisor", () => {
  it("セクション見出し「最適化アドバイス」が常に表示される", () => {
    render(<OptimizationAdvisor s={makeSummary()} />);
    expect(screen.getByText("最適化アドバイス")).toBeInTheDocument();
  });

  it("推奨がない場合「目立った無駄は検出されませんでした」を表示する", () => {
    // overhead / output ratio 等が良好な状態
    const s = makeSummary({
      tokenSplit: { input: 10_000, output: 5_000, cacheCreate: 0, cacheRead: 85_000 },
      costSplit: { input: 0.05, output: 0.1, cacheWrite: 0, cacheRead: 0.01 },
      drivers: {
        topModel: null,
        topDay: null,
        topDayModel: null,
        cacheReadRatio: 0.85,
        outputCostRatio: 0.15,
      },
      sessionStats: { avgColdStartTokens: 0, p90ColdStartTokens: 0, coldStartCost: 0 },
      overhead: {
        claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [],
        projectPlugins: [], mcpServers: [], totalAlwaysTokens: 500, totalInvokeTokens: 0, totalEstimatedTokens: 500,
      },
    });
    render(<OptimizationAdvisor s={s} />);
    expect(screen.getByText(/目立った無駄は検出されませんでした/)).toBeInTheDocument();
  });

  it("output コスト比率が高い場合アドバイスアイテムを表示する", () => {
    const s = makeSummary({
      totals: { cost: 10, tokens: 100_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-28" },
      tokenSplit: { input: 20_000, output: 75_000, cacheCreate: 0, cacheRead: 5_000 },
      costSplit: { input: 0.1, output: 7.5, cacheWrite: 0, cacheRead: 0.005 },
      drivers: {
        topModel: null,
        topDay: null,
        topDayModel: null,
        cacheReadRatio: 0.05,
        outputCostRatio: 0.75,
      },
    });
    render(<OptimizationAdvisor s={s} />);
    // アドバイスアイテムが表示される（優先度バッジ or アクション）
    const badges = screen.queryAllByText(/優先度/);
    expect(badges.length).toBeGreaterThan(0);
  });

  it("推奨がある場合「→」始まりのアクションが表示される", () => {
    const s = makeSummary({
      tokenSplit: { input: 20_000, output: 75_000, cacheCreate: 0, cacheRead: 5_000 },
      costSplit: { input: 0.1, output: 7.5, cacheWrite: 0, cacheRead: 0.005 },
      drivers: {
        topModel: null,
        topDay: null,
        topDayModel: null,
        cacheReadRatio: 0.05,
        outputCostRatio: 0.75,
      },
    });
    render(<OptimizationAdvisor s={s} />);
    const actions = screen.queryAllByText(/^→/);
    expect(actions.length).toBeGreaterThan(0);
  });
});
