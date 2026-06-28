import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CostDrivers } from "./CostDrivers";
import type { Summary } from "../api";

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    generatedAt: "2026-06-28T00:00:00.000Z",
    totals: { cost: 10, tokens: 100_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-28" },
    tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
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

describe("CostDrivers", () => {
  it("セクション見出し「使用量分析」が表示される", () => {
    render(<CostDrivers s={makeSummary()} />);
    expect(screen.getByText("使用量分析")).toBeInTheDocument();
  });

  it("topModel が null のとき「最大トークン使用モデル」は表示されない", () => {
    render(<CostDrivers s={makeSummary()} />);
    expect(screen.queryByText("最大トークン使用モデル")).not.toBeInTheDocument();
  });

  it("topModel がある場合モデル名を含む行が表示される", () => {
    const s = makeSummary({
      totals: { cost: 10, tokens: 100_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-28" },
      drivers: {
        topModel: { model: "claude-opus-4-8", cost: 8, tokens: 80_000, isFallback: false },
        topDay: null,
        topDayModel: null,
        cacheReadRatio: 0.6,
        outputCostRatio: 0.2,
      },
    });
    render(<CostDrivers s={s} />);
    expect(screen.getByText("最大トークン使用モデル")).toBeInTheDocument();
    expect(screen.getByText(/claude-opus-4-8/)).toBeInTheDocument();
  });

  it("topDay がある場合「最もトークンの多い日」が表示される", () => {
    const s = makeSummary({
      drivers: {
        topModel: null,
        topDay: { date: "2026-06-20", cost: 3, tokens: 30_000 },
        topDayModel: null,
        cacheReadRatio: 0.6,
        outputCostRatio: 0.2,
      },
    });
    render(<CostDrivers s={s} />);
    expect(screen.getByText("最もトークンの多い日")).toBeInTheDocument();
    expect(screen.getByText(/2026-06-20/)).toBeInTheDocument();
  });

  it("cacheReadRatio < 0.5 のとき warn トーンのヒントが表示される", () => {
    const s = makeSummary({
      drivers: {
        topModel: null,
        topDay: null,
        topDayModel: null,
        cacheReadRatio: 0.3,
        outputCostRatio: 0.2,
      },
    });
    render(<CostDrivers s={s} />);
    expect(screen.getByText(/キャッシュが効いていない/)).toBeInTheDocument();
  });

  it("outputCostRatio > 0.4 のとき output 高コストヒントが表示される", () => {
    const s = makeSummary({
      drivers: {
        topModel: null,
        topDay: null,
        topDayModel: null,
        cacheReadRatio: 0.6,
        outputCostRatio: 0.5,
      },
    });
    render(<CostDrivers s={s} />);
    expect(screen.getByText(/生成（output）が高コスト要因/)).toBeInTheDocument();
  });

  it("cache read 比率と output コスト比率の見出しが常に表示される", () => {
    render(<CostDrivers s={makeSummary()} />);
    expect(screen.getByText("cache read 比率")).toBeInTheDocument();
    expect(screen.getByText("output コスト比率")).toBeInTheDocument();
  });
});
