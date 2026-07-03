import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SubagentBreakdown } from "./SubagentBreakdown";
import type { Summary, SubagentStats } from "../api";

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    generatedAt: "2026-06-28T00:00:00.000Z",
    totals: { cost: 10, tokens: 100_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-28" },
    tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    models: [],
    daily: [],
    projects: [],
    drivers: { topModel: null, topDay: null, topDayModel: null, cacheReadRatio: 0, outputCostRatio: 0 },
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
    byTool: [],
    ...overrides,
  };
}

const defaultSubagentStats: SubagentStats = {
  mainTokens: 700_000,
  mainCost: 7,
  subagentTokens: 300_000,
  subagentCost: 3,
  subagentRatio: 0.3,
};

describe("SubagentBreakdown", () => {
  it("subagentStats が undefined のとき null 返却（何も描画しない）", () => {
    const s = makeSummary({ subagentStats: undefined });
    const { container } = render(<SubagentBreakdown s={s} />);
    expect(container.firstChild).toBeNull();
  });

  it("subagentRatio: 0 のとき「0%」表示になり例外が出ない", () => {
    const s = makeSummary({
      subagentStats: { mainTokens: 100, mainCost: 1, subagentTokens: 0, subagentCost: 0, subagentRatio: 0 },
    });
    render(<SubagentBreakdown s={s} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("比率・絶対トークン・絶対コストが期待通りテキストに現れる", () => {
    const s = makeSummary({ subagentStats: defaultSubagentStats });
    render(<SubagentBreakdown s={s} />);
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("$7.00")).toBeInTheDocument();
    expect(screen.getByText("$3.00")).toBeInTheDocument();
  });
});
