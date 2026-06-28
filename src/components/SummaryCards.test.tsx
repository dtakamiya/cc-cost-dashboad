import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SummaryCards } from "./SummaryCards";
import type { Summary } from "../api";

// テスト用の最小 Summary フィクスチャ
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
    activity: { matrix: [], max: 0, total: 0, peak: null },
    bySession: [],
    ...overrides,
  };
}

describe("SummaryCards - データ品質カード", () => {
  it("source が undefined のとき parsedLines 表示はない", () => {
    // Arrange
    const s = makeSummary({ source: undefined });

    // Act
    render(<SummaryCards s={s} />);

    // Assert: データ品質カードが表示されないことを確認
    expect(screen.queryByText("データ品質")).not.toBeInTheDocument();
  });

  it("source に parsedLines があるとき「データ品質」カードが表示される", () => {
    // Arrange
    const s = makeSummary({
      source: { fileCount: 3, parsedLines: 150, skippedLines: 5, parseErrors: 2, unreadableFiles: 0 },
    });

    // Act
    render(<SummaryCards s={s} />);

    // Assert
    expect(screen.getByText("データ品質")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
  });

  it("skippedLines > 0 のとき「スキップ」情報が表示される", () => {
    // Arrange
    const s = makeSummary({
      source: { fileCount: 3, parsedLines: 100, skippedLines: 10, parseErrors: 3, unreadableFiles: 0 },
    });

    // Act
    render(<SummaryCards s={s} />);

    // Assert: スキップ行数とエラー数が表示される
    const subText = screen.getByText(/スキップ: 10 行/);
    expect(subText).toBeInTheDocument();
    expect(subText.textContent).toContain("エラー: 3");
  });

  it("skippedLines が 0 のとき「完全」と表示される", () => {
    // Arrange
    const s = makeSummary({
      source: { fileCount: 3, parsedLines: 100, skippedLines: 0, parseErrors: 0, unreadableFiles: 0 },
    });

    // Act
    render(<SummaryCards s={s} />);

    // Assert
    expect(screen.getByText("完全")).toBeInTheDocument();
  });

  it("既存の「セッション数」カードは変わらず表示される", () => {
    // Arrange
    const s = makeSummary({
      source: { fileCount: 3, parsedLines: 100, skippedLines: 0, parseErrors: 0, unreadableFiles: 0 },
    });

    // Act
    render(<SummaryCards s={s} />);

    // Assert: 既存カードが壊れていないことを確認
    expect(screen.getByText("セッション数")).toBeInTheDocument();
    expect(screen.getByText("総トークン")).toBeInTheDocument();
    expect(screen.getByText("期間")).toBeInTheDocument();
  });
});
