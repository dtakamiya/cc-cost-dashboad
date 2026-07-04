import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ActivityHeatmap } from "./ActivityHeatmap";
import type { Summary } from "../api";

const baseSummary: Summary = {
  generatedAt: "2026-01-01T00:00:00Z",
  totals: { cost: 0, tokens: 100, sessions: 1, messages: 1, from: null, to: null },
  tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  models: [],
  daily: [],
  projects: [],
  drivers: {
    topModel: null,
    topDay: null,
    topDayModel: null,
    cacheReadRatio: 0,
    outputCostRatio: 0,
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
  activity: {
    matrix: Array.from({ length: 7 }, () => Array(24).fill(0).map((_, h) => (h === 10 ? 500 : 0))),
    max: 500,
    total: 3500,
    peak: { day: 0, hour: 10, tokens: 500 },
  },
  bySession: [],
  byTool: [],
  byMcpServer: [],
};

describe("ActivityHeatmap", () => {
  it("ヒートマップにrole=imgとaria-labelが付与されている", () => {
    const { container } = render(<ActivityHeatmap s={baseSummary} />);
    const heatmap = container.querySelector(".heatmap");
    expect(heatmap).toHaveAttribute("role", "img");
    expect(heatmap).toHaveAttribute("aria-label");
  });

  it("ヒートマップがheatmap-scrollクラスのラッパーを持つ", () => {
    const { container } = render(<ActivityHeatmap s={baseSummary} />);
    const scroll = container.querySelector(".heatmap-scroll");
    expect(scroll).toBeInTheDocument();
    const heatmap = scroll?.querySelector(".heatmap");
    expect(heatmap).toBeInTheDocument();
  });

  it("activity.totalが0のときnullをレンダリングする", () => {
    const s = { ...baseSummary, activity: { matrix: [], max: 0, total: 0, peak: null } };
    const { container } = render(<ActivityHeatmap s={s} />);
    expect(container.firstChild).toBeNull();
  });
});
