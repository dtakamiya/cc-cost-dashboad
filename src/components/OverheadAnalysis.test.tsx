import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OverheadAnalysis } from "./OverheadAnalysis";
import type { Summary, OverheadFile } from "../api";

function makeOverheadFile(overrides: Partial<OverheadFile> = {}): OverheadFile {
  return {
    label: "CLAUDE.md",
    bytes: 1024,
    alwaysTokens: 256,
    fullTokens: 256,
    estimatedTokens: 256,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    generatedAt: "2026-06-28T00:00:00.000Z",
    totals: {
      cost: 10,
      tokens: 100_000,
      sessions: 5,
      messages: 50,
      from: "2026-06-01",
      to: "2026-06-28",
    },
    tokenSplit: { input: 40_000, output: 20_000, cacheCreate: 20_000, cacheRead: 20_000 },
    costSplit: { input: 0.2, output: 0.4, cacheWrite: 0.1, cacheRead: 0.02 },
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
    sessionStats: { avgColdStartTokens: 500, p90ColdStartTokens: 800, coldStartCost: 0.05 },
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
    ...overrides,
  };
}

describe("OverheadAnalysis", () => {
  it("セクション見出し「コンテキストオーバーヘッド分析」が表示される", () => {
    render(<OverheadAnalysis s={makeSummary()} />);
    expect(screen.getByText("コンテキストオーバーヘッド分析")).toBeInTheDocument();
  });

  it("overhead.claudeMd があるとき CLAUDE.md ラベルが表示される", () => {
    const s = makeSummary({
      overhead: {
        claudeMd: makeOverheadFile({ label: "CLAUDE.md", alwaysTokens: 300, fullTokens: 300 }),
        atRefs: [],
        globalPlugins: [],
        personalSkills: [],
        projectPlugins: [],
        mcpServers: [],
        totalAlwaysTokens: 300,
        totalInvokeTokens: 0,
        totalEstimatedTokens: 300,
      },
    });
    render(<OverheadAnalysis s={s} />);
    // CLAUDE.md は見出しとテーブル行の両方に出るので getAllByText を使う
    expect(screen.getAllByText("CLAUDE.md").length).toBeGreaterThan(0);
  });

  it("totalAlwaysTokens が 3000 超のとき削減提案ヒントが表示される", () => {
    const s = makeSummary({
      overhead: {
        claudeMd: makeOverheadFile({ alwaysTokens: 3500, fullTokens: 3500, bytes: 14_000 }),
        atRefs: [],
        globalPlugins: [],
        personalSkills: [],
        projectPlugins: [],
        mcpServers: [],
        totalAlwaysTokens: 3500,
        totalInvokeTokens: 0,
        totalEstimatedTokens: 3500,
      },
    });
    render(<OverheadAnalysis s={s} />);
    expect(screen.getByText(/3,000 tokens 超過/)).toBeInTheDocument();
  });

  it("totalAlwaysTokens が 0 のとき baseline は適正範囲内と表示される", () => {
    render(<OverheadAnalysis s={makeSummary()} />);
    expect(screen.getByText(/baseline は適正範囲内/)).toBeInTheDocument();
  });

  it("mcpServers がある場合 MCP 名を含むテキストが表示される", () => {
    const s = makeSummary({
      overhead: {
        claudeMd: null,
        atRefs: [],
        globalPlugins: [],
        personalSkills: [],
        projectPlugins: [],
        mcpServers: [
          { name: "github", toolCount: null, estimatedTokens: 1500, source: "estimated" },
          { name: "filesystem", toolCount: null, estimatedTokens: 1500, source: "estimated" },
        ],
        totalAlwaysTokens: 0,
        totalInvokeTokens: 0,
        totalEstimatedTokens: 0,
      },
    });
    render(<OverheadAnalysis s={s} />);
    expect(screen.getByText(/github/)).toBeInTheDocument();
    expect(screen.getByText(/filesystem/)).toBeInTheDocument();
  });

  it("mcpServers がある場合サーバ別の推定トークン・月間コストが表示される", () => {
    const s = makeSummary({
      totals: {
        cost: 10,
        tokens: 100_000,
        sessions: 5,
        messages: 50,
        from: "2026-06-01",
        to: "2026-06-28",
      },
      tokenSplit: { input: 40_000, output: 20_000, cacheCreate: 20_000, cacheRead: 20_000 },
      costSplit: { input: 0.2, output: 0.4, cacheWrite: 0.1, cacheRead: 0.02 },
      overhead: {
        claudeMd: null,
        atRefs: [],
        globalPlugins: [],
        personalSkills: [],
        projectPlugins: [],
        mcpServers: [
          { name: "github", toolCount: null, estimatedTokens: 1500, source: "estimated" },
        ],
        totalAlwaysTokens: 0,
        totalInvokeTokens: 0,
        totalEstimatedTokens: 0,
      },
    });
    render(<OverheadAnalysis s={s} />);
    expect(screen.getByText(/github/)).toBeInTheDocument();
    expect(screen.getAllByText(/1,500|~1.5k/).length).toBeGreaterThan(0);
  });

  it("source:'unknown'（estimatedTokens null）のサーバは推定不可と明示される", () => {
    const s = makeSummary({
      overhead: {
        claudeMd: null,
        atRefs: [],
        globalPlugins: [],
        personalSkills: [],
        projectPlugins: [],
        mcpServers: [
          { name: "mystery-server", toolCount: null, estimatedTokens: null, source: "unknown" },
        ],
        totalAlwaysTokens: 0,
        totalInvokeTokens: 0,
        totalEstimatedTokens: 0,
      },
    });
    render(<OverheadAnalysis s={s} />);
    expect(screen.getByText(/mystery-server/)).toBeInTheDocument();
    expect(screen.getAllByText(/推定不可/).length).toBeGreaterThan(0);
  });

  it("システムプロンプト baseline の合計トークンが表示される", () => {
    const s = makeSummary({
      overhead: {
        claudeMd: makeOverheadFile({ alwaysTokens: 250, fullTokens: 250 }),
        atRefs: [],
        globalPlugins: [],
        personalSkills: [],
        projectPlugins: [],
        mcpServers: [],
        totalAlwaysTokens: 250,
        totalInvokeTokens: 100,
        totalEstimatedTokens: 250,
      },
    });
    render(<OverheadAnalysis s={s} />);
    // "~250 tok" はテーブルフッターや driver-body 等複数箇所に出る可能性があるため getAllByText を使う
    expect(screen.getAllByText("~250 tok").length).toBeGreaterThan(0);
  });
});
