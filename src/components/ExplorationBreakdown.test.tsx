import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ExplorationBreakdown } from "./ExplorationBreakdown";
import type { Summary, ExplorationStats } from "../api";

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

const exploration = (over: Partial<ExplorationStats> = {}): ExplorationStats => ({
  heavySessions: [
    {
      sessionId: "s1",
      cwd: "/home/u/proj",
      explorationTokensApprox: 60_000,
      totalToolResultTokensApprox: 100_000,
      explorationRatio: 0.6,
    },
  ],
  isApprox: true,
  ...over,
});

describe("ExplorationBreakdown", () => {
  it("exploration が未定義なら何も表示しない", () => {
    const { container } = render(<ExplorationBreakdown s={makeSummary()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("heavySessionsが空なら何も表示しない", () => {
    const s = makeSummary({ exploration: exploration({ heavySessions: [] }) });
    const { container } = render(<ExplorationBreakdown s={s} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("探索過多セッションがテーブル表示される", () => {
    const s = makeSummary({ exploration: exploration() });
    render(<ExplorationBreakdown s={s} />);
    expect(screen.getByText("s1")).toBeInTheDocument();
    expect(screen.getByText("/home/u/proj")).toBeInTheDocument();
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(screen.getAllByText(/近似値/).length).toBeGreaterThan(0);
  });
});
