import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { Summary, ToolStats } from "../api";
import { ToolBreakdown } from "./ToolBreakdown";

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    generatedAt: "2026-06-28T00:00:00.000Z",
    totals: { cost: 10, tokens: 100_000, sessions: 1, messages: 50, from: "2026-06-01", to: "2026-06-28" },
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
    ...overrides,
  };
}

function makeToolStats(overrides: Partial<ToolStats> = {}): ToolStats {
  return {
    agentCount: 0,
    skillCount: 0,
    bySubagentType: {},
    bySkill: {},
    ...overrides,
  };
}

describe("ToolBreakdown", () => {
  it("s が null のとき空状態メッセージを表示する", () => {
    render(<ToolBreakdown s={null} />);
    expect(screen.getByText(/ツール呼び出しのデータがありません/)).toBeInTheDocument();
  });

  it("toolStats が undefined のとき空状態メッセージを表示する", () => {
    const s = makeSummary({ toolStats: undefined });
    render(<ToolBreakdown s={s} />);
    expect(screen.getByText(/ツール呼び出しのデータがありません/)).toBeInTheDocument();
  });

  it("agentCount/skillCount が0のとき空状態メッセージを表示する", () => {
    const s = makeSummary({ toolStats: makeToolStats() });
    render(<ToolBreakdown s={s} />);
    expect(screen.getByText(/ツール呼び出しのデータがありません/)).toBeInTheDocument();
  });

  it("Agent/Skill 呼び出し件数のサマリを表示する", () => {
    const s = makeSummary({
      toolStats: makeToolStats({ agentCount: 5, skillCount: 3 }),
    });
    render(<ToolBreakdown s={s} />);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("subagentType 別の内訳を表示する", () => {
    const s = makeSummary({
      toolStats: makeToolStats({
        agentCount: 3,
        bySubagentType: { "code-reviewer": 2, planner: 1 },
      }),
    });
    render(<ToolBreakdown s={s} />);
    expect(screen.getByText("code-reviewer")).toBeInTheDocument();
    expect(screen.getByText("planner")).toBeInTheDocument();
  });

  it("skill 別の内訳を表示する", () => {
    const s = makeSummary({
      toolStats: makeToolStats({
        skillCount: 2,
        bySkill: { "tdd-workflow": 2 },
      }),
    });
    render(<ToolBreakdown s={s} />);
    expect(screen.getByText("tdd-workflow")).toBeInTheDocument();
  });
});
