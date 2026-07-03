import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BudgetProjection } from "./BudgetProjection";
import type { Summary, Projection } from "../api";

function makeSummary(projection: Projection | null, overrides: Partial<Summary> = {}): Summary {
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
    projection,
    activity: { matrix: [], max: 0, total: 0, peak: null },
    bySession: [],
    byTool: [],
    ...overrides,
  };
}

const sampleProjection: Projection = {
  monthStr: "2026-06",
  monthCostSoFar: 8.5,
  daysPassed: 14,
  daysRemain: 16,
  daysInMonth: 30,
  projectedMonthCost: 18.21,
};

describe("BudgetProjection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("projection が null のとき何も描画しない", () => {
    const { container } = render(<BudgetProjection s={makeSummary(null)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("projection があるとき月を含む見出しを表示する", () => {
    render(<BudgetProjection s={makeSummary(sampleProjection)} />);
    expect(screen.getByText(/コスト予測.*2026-06/)).toBeInTheDocument();
  });

  it("今月の実績と着地予測が表示される", () => {
    render(<BudgetProjection s={makeSummary(sampleProjection)} />);
    expect(screen.getByText("今月の実績")).toBeInTheDocument();
    expect(screen.getByText("着地予測")).toBeInTheDocument();
  });

  it("経過日数が daysInMonth とともに表示される", () => {
    render(<BudgetProjection s={makeSummary(sampleProjection)} />);
    expect(screen.getByText("14 / 30 日")).toBeInTheDocument();
  });

  it("予算未設定のとき「予算を設定」ボタンが表示される", () => {
    render(<BudgetProjection s={makeSummary(sampleProjection)} />);
    expect(screen.getByRole("button", { name: "予算を設定" })).toBeInTheDocument();
  });

  it("「予算を設定」クリックで入力フォームが表示される", () => {
    render(<BudgetProjection s={makeSummary(sampleProjection)} />);
    fireEvent.click(screen.getByRole("button", { name: "予算を設定" }));
    expect(screen.getByLabelText(/月額予算上限/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "キャンセル" })).toBeInTheDocument();
  });

  it("予算保存後にバー（進捗）が表示される", () => {
    render(<BudgetProjection s={makeSummary(sampleProjection)} />);
    fireEvent.click(screen.getByRole("button", { name: "予算を設定" }));
    const input = screen.getByLabelText(/月額予算上限/);
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    // バーラベルが表示されること
    expect(screen.getByText(/実績 \d+%/)).toBeInTheDocument();
  });

  it("予算超過見込みのとき警告アイコン(Icon コンポーネント)が表示される", () => {
    render(<BudgetProjection s={makeSummary(sampleProjection)} />);
    fireEvent.click(screen.getByRole("button", { name: "予算を設定" }));
    const input = screen.getByLabelText(/月額予算上限/);
    // 予算 10 に対して着地予測 18.21 → 超過
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByTestId("icon-warning")).toBeInTheDocument();
    expect(screen.getByText(/予算超過見込み/)).toBeInTheDocument();
  });
});
