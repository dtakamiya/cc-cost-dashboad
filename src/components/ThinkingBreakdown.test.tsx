import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThinkingBreakdown } from "./ThinkingBreakdown";
import type { Summary } from "../api";

const baseSummary = (thinking: Summary["thinking"]): Summary => ({
  generatedAt: "2026-07-04T00:00:00.000Z",
  totals: { cost: 100, tokens: 1_000_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-30" },
  tokenSplit: { input: 100_000, output: 400_000, cacheCreate: 100_000, cacheRead: 400_000 },
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
  sessionStats: { avgColdStartTokens: 0, p90ColdStartTokens: 0, coldStartCost: 0 },
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
  warnings: { fallbackModels: [] },
  blocks: [],
  projection: null,
  activity: { matrix: [], max: 0, total: 0, peak: null },
  bySession: [],
  byTool: [],
  byMcpServer: [],
  thinking,
});

describe("ThinkingBreakdown", () => {
  it("thinkingデータが無い場合は何も描画しない", () => {
    const { container } = render(<ThinkingBreakdown s={baseSummary(undefined)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hasAnyThinkingがfalseの場合は何も描画しない", () => {
    const s = baseSummary({ approxTokens: 0, outputShare: 0, isApprox: true, hasAnyThinking: false });
    const { container } = render(<ThinkingBreakdown s={s} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("thinkingデータがある場合、output内訳（回答 vs thinking近似）と近似ラベルを表示する", () => {
    const s = baseSummary({ approxTokens: 160_000, outputShare: 0.4, isApprox: true, hasAnyThinking: true });
    render(<ThinkingBreakdown s={s} />);
    expect(screen.getAllByText(/近似/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/40\.0%/).length).toBeGreaterThan(0);
  });

  it("outputに既に含まれる内訳であり追加コストではないことを明示する文言がある", () => {
    const s = baseSummary({ approxTokens: 160_000, outputShare: 0.4, isApprox: true, hasAnyThinking: true });
    render(<ThinkingBreakdown s={s} />);
    expect(screen.getByText(/output.*既に含まれる|追加.*コストではない/)).toBeInTheDocument();
  });
});
