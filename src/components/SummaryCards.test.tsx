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
    byTool: [],
    byMcpServer: [],
    ...overrides,
  };
}

describe("SummaryCards - 総コストカード", () => {
  it("総コストカードが常に表示される", () => {
    // Arrange
    const s = makeSummary();

    // Act
    render(<SummaryCards s={s} />);

    // Assert
    expect(screen.getByText("総コスト")).toBeInTheDocument();
  });

  it("総コストの値が $X.XX 形式で表示される", () => {
    // Arrange
    const s = makeSummary({ totals: { cost: 12.345, tokens: 100_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-28" } });

    // Act
    render(<SummaryCards s={s} />);

    // Assert: usd() フォーマッタで $12.35 になる
    expect(screen.getByText("$12.35")).toBeInTheDocument();
  });

  it("前期間との比較(delta)が総コストカードに表示される", () => {
    // Arrange
    const s = makeSummary({ totals: { cost: 20, tokens: 200_000, sessions: 10, messages: 100, from: "2026-06-01", to: "2026-06-28" } });
    const prev = makeSummary({ totals: { cost: 10, tokens: 100_000, sessions: 5, messages: 50, from: "2026-05-01", to: "2026-05-28" } });

    // Act
    render(<SummaryCards s={s} prev={prev} />);

    // Assert: delta バッジが総コストカード内に表示される（+100% = 2倍）
    expect(screen.getByText("総コスト")).toBeInTheDocument();
    const costCard = screen.getByText("総コスト").closest(".card");
    expect(costCard).toBeInTheDocument();
    expect(costCard).toHaveTextContent("+100.0% ▲");
  });

  it("カード順が 総トークン→セッション数→期間→総コスト になる", () => {
    // Arrange
    const s = makeSummary();

    // Act
    render(<SummaryCards s={s} />);

    // Assert: 4枚のカードラベルが順番通りに出る
    const labels = screen.getAllByText(/総トークン|セッション数|期間|総コスト/);
    const texts = labels.map((el) => el.textContent);
    expect(texts[0]).toBe("総トークン");
    expect(texts[1]).toBe("セッション数");
    expect(texts[2]).toBe("期間");
    expect(texts[3]).toBe("総コスト");
  });
});

describe("SummaryCards - KPIカードは4枚固定", () => {
  it("source があってもKPIカードは4枚のまま増えない（データ品質カードは削除）", () => {
    // Arrange
    const s = makeSummary({
      source: { fileCount: 3, parsedLines: 150, skippedLines: 5, parseErrors: 2, unreadableFiles: 0 },
    });

    // Act
    const { container } = render(<SummaryCards s={s} />);

    // Assert: .cards 配下の .card 要素は常に4枚
    expect(container.querySelectorAll(".cards > .card")).toHaveLength(4);
    expect(screen.queryByText("データ品質")).not.toBeInTheDocument();
  });

  it("source が undefined でもKPIカードは4枚", () => {
    // Arrange
    const s = makeSummary({ source: undefined });

    // Act
    const { container } = render(<SummaryCards s={s} />);

    // Assert
    expect(container.querySelectorAll(".cards > .card")).toHaveLength(4);
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

  it("各カードのアイコンが Icon コンポーネント(SVG)で描画される", () => {
    // Arrange
    const s = makeSummary();

    // Act
    const { container } = render(<SummaryCards s={s} />);

    // Assert: 絵文字ではなく data-testid 付きの svg アイコンが使われる
    expect(container.querySelector('[data-testid="icon-token"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="icon-sessions"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="icon-calendar"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="icon-cost"]')).toBeInTheDocument();
  });
});
