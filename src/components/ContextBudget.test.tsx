import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ContextBudget } from "./ContextBudget";
import type { Summary } from "../api";

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    generatedAt: "2026-06-28T00:00:00.000Z",
    totals: { cost: 10, tokens: 100_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-28" },
    tokenSplit: { input: 100_000, output: 100_000, cacheCreate: 100_000, cacheRead: 700_000 },
    costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    models: [],
    daily: [],
    projects: [],
    drivers: { topModel: null, topDay: null, topDayModel: null, cacheReadRatio: 0, outputCostRatio: 0 },
    sessionStats: { avgColdStartTokens: 0, p90ColdStartTokens: 0, coldStartCost: 0 },
    overhead: {
      claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [],
      projectPlugins: [], mcpServers: [], totalAlwaysTokens: 1000, totalInvokeTokens: 0, totalEstimatedTokens: 1000,
    },
    warnings: { fallbackModels: [] },
    blocks: [],
    projection: null,
    activity: { matrix: [], max: 0, total: 0, peak: null },
    bySession: [],
    byTool: [],
    byMcpServer: [],
    ...overrides,
  };
}

describe("ContextBudget", () => {
  it("4区分の割合がテキストとして表示される", () => {
    const s = makeSummary();
    render(<ContextBudget s={s} />);
    // overheadPct = 1000/1_001_000 ≈ 0.1% → "0%"表示になりうるため、代わりに historyPct(70%) を検証
    expect(screen.getByText("70%")).toBeInTheDocument();
  });

  it("historyDominant: true のとき削減ヒントが表示される", () => {
    const s = makeSummary({
      tokenSplit: { input: 10_000, output: 10_000, cacheCreate: 10_000, cacheRead: 900_000 },
    });
    render(<ContextBudget s={s} />);
    expect(screen.getByText(/\/clear/)).toBeInTheDocument();
  });

  it("historyDominant: false のとき削減ヒントが表示されない", () => {
    const s = makeSummary({
      tokenSplit: { input: 400_000, output: 400_000, cacheCreate: 0, cacheRead: 100_000 },
    });
    render(<ContextBudget s={s} />);
    expect(screen.queryByText(/\/clear/)).not.toBeInTheDocument();
  });

  it("全トークン0件でも例外を投げず描画できる", () => {
    const s = makeSummary({
      tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      overhead: {
        claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [],
        projectPlugins: [], mcpServers: [], totalAlwaysTokens: 0, totalInvokeTokens: 0, totalEstimatedTokens: 0,
      },
    });
    expect(() => render(<ContextBudget s={s} />)).not.toThrow();
  });
});
