import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { McpServerBreakdown } from "./McpServerBreakdown";
import type { Summary } from "../api";

const minimalSummary: Summary = {
  generatedAt: "2026-01-01T00:00:00Z",
  totals: { cost: 0, tokens: 0, sessions: 0, messages: 0, from: null, to: null },
  tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  models: [],
  daily: [],
  projects: [],
  drivers: { topModel: null, topDay: null, topDayModel: null, cacheReadRatio: 0, outputCostRatio: 0 },
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
};

describe("McpServerBreakdown", () => {
  it("byMcpServer が空の場合、何も表示しない", () => {
    const { container } = render(<McpServerBreakdown s={minimalSummary} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("サーバー別に表が描画される", () => {
    const s: Summary = {
      ...minimalSummary,
      byMcpServer: [
        { serverName: "ccd_session", calls: 50, sessions: 5 },
        { serverName: "gh", calls: 3, sessions: 2 },
      ],
    };
    render(<McpServerBreakdown s={s} />);
    expect(screen.getByText("ccd_session")).toBeInTheDocument();
    expect(screen.getByText("gh")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("呼び出し頻度が低いサーバーに CLI 代替を検討するヒントが表示される", () => {
    const s: Summary = {
      ...minimalSummary,
      byMcpServer: [
        { serverName: "gh", calls: 2, sessions: 1 },
      ],
    };
    render(<McpServerBreakdown s={s} />);
    expect(screen.getByText(/CLI/)).toBeInTheDocument();
  });

  it("呼び出し頻度が高いサーバーにはヒントが表示されない", () => {
    const s: Summary = {
      ...minimalSummary,
      byMcpServer: [
        { serverName: "ccd_session", calls: 100, sessions: 10 },
      ],
    };
    render(<McpServerBreakdown s={s} />);
    expect(screen.queryByText(/CLI/)).not.toBeInTheDocument();
  });
});
