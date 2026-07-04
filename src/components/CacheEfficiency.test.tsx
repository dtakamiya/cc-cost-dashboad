import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CacheEfficiency } from "./CacheEfficiency";
import type { Summary, CacheStats, CacheGapStats } from "../api";

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
    byMcpServer: [],
    ...overrides,
  };
}

const defaultCacheStats: CacheStats = {
  create1hTokens: 500,
  create5mTokens: 500,
  write1hCost: 0.005,
  write5mCost: 0.003125,
  premium1h: 0.00375,
  readSavings: 0.1,
  writeCost: 0.008125,
  roiNet: 0.091875,
};

describe("CacheEfficiency", () => {
  it("cacheStats が undefined のとき null 返却（何も描画しない）", () => {
    const s = makeSummary({ cacheStats: undefined });
    const { container } = render(<CacheEfficiency s={s} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("cacheStats がある場合セクションを描画する", () => {
    const s = makeSummary({ cacheStats: defaultCacheStats });
    render(<CacheEfficiency s={s} />);
    expect(screen.getByText("キャッシュ TTL 損益分岐")).toBeInTheDocument();
  });

  it("roiNet >= 0 のとき黒字表示（プラス符号）", () => {
    const s = makeSummary({ cacheStats: { ...defaultCacheStats, roiNet: 0.05 } });
    render(<CacheEfficiency s={s} />);
    expect(screen.getAllByText("+$0.05")).toHaveLength(2);
    expect(
      screen.getByText("キャッシュ書き込みコストを読み込み節約で回収できている（黒字）。"),
    ).toBeInTheDocument();
  });

  it("roiNet < 0 のとき赤字ヒントを表示する", () => {
    const s = makeSummary({
      cacheStats: { ...defaultCacheStats, roiNet: -0.01, readSavings: 0, writeCost: 0.01 },
    });
    render(<CacheEfficiency s={s} />);
    expect(screen.getByText(/書き込みコストが読み込み節約を上回っている/)).toBeInTheDocument();
  });

  it("TTL 内訳テーブルが描画される", () => {
    const s = makeSummary({ cacheStats: defaultCacheStats });
    render(<CacheEfficiency s={s} />);
    expect(screen.getByText("1h（×2）")).toBeInTheDocument();
    expect(screen.getByText("5m（×1.25）")).toBeInTheDocument();
  });

  it("cacheGapStats が未提供でも既存の ROI 表示は壊れない", () => {
    const s = makeSummary({ cacheStats: defaultCacheStats, cacheGapStats: undefined });
    render(<CacheEfficiency s={s} />);
    expect(screen.getByText("キャッシュ TTL 損益分岐")).toBeInTheDocument();
    expect(screen.queryByText("アイドル失効による再書き込み")).not.toBeInTheDocument();
  });

  it("expiredGapCount が0のときは追加セクションを表示しない", () => {
    const gapStats: CacheGapStats = {
      expiredGapCount: 0,
      reWriteTokens: 0,
      reWriteCost: 0,
      affectedSessions: [],
    };
    const s = makeSummary({ cacheStats: defaultCacheStats, cacheGapStats: gapStats });
    render(<CacheEfficiency s={s} />);
    expect(screen.queryByText("アイドル失効による再書き込み")).not.toBeInTheDocument();
  });

  it("expiredGapCount > 0 のとき発生回数と推定超過コストを表示する", () => {
    const gapStats: CacheGapStats = {
      expiredGapCount: 4,
      reWriteTokens: 20000,
      reWriteCost: 0.125,
      affectedSessions: ["s1", "s2"],
    };
    const s = makeSummary({ cacheStats: defaultCacheStats, cacheGapStats: gapStats });
    render(<CacheEfficiency s={s} />);
    expect(screen.getByText("アイドル失効による再書き込み")).toBeInTheDocument();
    expect(screen.getAllByText("4 回")).toHaveLength(2);
    expect(screen.getByText((_, el) => el?.textContent === "−$0.13")).toBeInTheDocument();
  });
});
