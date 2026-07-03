import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { ModelBreakdown } from "./ModelBreakdown";
import type { Summary } from "../api";

const minimalSummary: Summary = {
  generatedAt: "2026-01-01T00:00:00Z",
  totals: { cost: 0, tokens: 0, sessions: 0, messages: 0, from: null, to: null },
  tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  models: [
    { model: "claude-sonnet-4-5", cost: 1.23, tokens: 100000, isFallback: false },
    { model: "claude-haiku-4-5", cost: 0.05, tokens: 50000, isFallback: false },
  ],
  daily: [],
  projects: [],
  drivers: { topModel: null, topDay: null, topDayModel: null, cacheReadRatio: 0, outputCostRatio: 0 },
  sessionStats: { avgColdStartTokens: 0, p90ColdStartTokens: 0, coldStartCost: 0 },
  overhead: {
    claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [],
    projectPlugins: [], mcpServers: [], totalAlwaysTokens: 0,
    totalInvokeTokens: 0, totalEstimatedTokens: 0,
  },
  warnings: { fallbackModels: [] },
  blocks: [],
  projection: null,
  activity: { matrix: [], max: 0, total: 0, peak: null },
  bySession: [],
  byTool: [],
};

describe("ModelBreakdown", () => {
  it("デフォルトでトークンボタンがアクティブ", () => {
    render(<ModelBreakdown s={minimalSummary} />);
    const tokensBtn = screen.getByRole("button", { name: "トークン" });
    const costBtn = screen.getByRole("button", { name: "コスト" });
    expect(tokensBtn).toHaveAttribute("aria-pressed", "true");
    expect(costBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("デフォルトでテーブルにトークン値が表示される", () => {
    render(<ModelBreakdown s={minimalSummary} />);
    // 100,000 → "100K"
    expect(screen.getByText("100K")).toBeInTheDocument();
  });

  it("コストボタンを押すとコスト値がテーブルに表示される", async () => {
    const user = userEvent.setup();
    render(<ModelBreakdown s={minimalSummary} />);
    const costBtn = screen.getByRole("button", { name: "コスト" });
    await user.click(costBtn);
    // $1.23 が表示される
    expect(screen.getByText("$1.23")).toBeInTheDocument();
  });

  it("コストボタンを押すとコストボタンがアクティブになる", async () => {
    const user = userEvent.setup();
    render(<ModelBreakdown s={minimalSummary} />);
    const costBtn = screen.getByRole("button", { name: "コスト" });
    await user.click(costBtn);
    expect(costBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "トークン" })).toHaveAttribute("aria-pressed", "false");
  });

  it("テーブルヘッダーに実績単価とHaiku移行30%節約試算が表示される", () => {
    render(<ModelBreakdown s={minimalSummary} />);
    expect(screen.getByText("実績単価")).toBeInTheDocument();
    expect(screen.getByText("Haiku移行30%節約試算")).toBeInTheDocument();
  });

  it("Sonnet系モデル行にHaiku実績データがある場合は節約額が表示される", () => {
    render(<ModelBreakdown s={minimalSummary} />);
    // sonnetRate = 1.23/100000*1e6 = 12.3, haikuRate = 0.05/50000*1e6 = 1
    // saving = (12.3-1)*100000*0.3/1e6 * monthlyFactor(from/to=null→1日→30倍)
    const rows = screen.getAllByRole("row");
    const sonnetRow = rows.find((r) => r.textContent?.includes("claude-sonnet-4-5"));
    expect(sonnetRow?.textContent).not.toContain("—");
  });

  it("Haikuモデル自身の行では節約額欄が—になる", () => {
    render(<ModelBreakdown s={minimalSummary} />);
    const rows = screen.getAllByRole("row");
    const haikuRow = rows.find((r) => r.textContent?.includes("claude-haiku-4-5"));
    expect(haikuRow?.textContent).toContain("—");
  });

  it("Haiku実績データが1件も無い場合は全行の節約額が—になる", () => {
    const noHaikuSummary: Summary = {
      ...minimalSummary,
      models: [
        { model: "claude-sonnet-4-5", cost: 1.23, tokens: 100000, isFallback: false },
        { model: "claude-opus-4-8", cost: 5, tokens: 200000, isFallback: false },
      ],
    };
    render(<ModelBreakdown s={noHaikuSummary} />);
    const rows = screen.getAllByRole("row").filter((r) => r.querySelector("td"));
    for (const row of rows) {
      expect(row.textContent).toContain("—");
    }
  });

  it("tokens=0のモデル行はNaN・Infinityが表示されずクラッシュしない", () => {
    const zeroTokenSummary: Summary = {
      ...minimalSummary,
      models: [
        { model: "claude-sonnet-4-5", cost: 0, tokens: 0, isFallback: false },
        { model: "claude-haiku-4-5", cost: 0.05, tokens: 50000, isFallback: false },
      ],
    };
    render(<ModelBreakdown s={zeroTokenSummary} />);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
  });

  it("既存のトークン/コスト列表示が壊れていないこと（回帰）", async () => {
    const user = userEvent.setup();
    render(<ModelBreakdown s={minimalSummary} />);
    expect(screen.getByText("100K")).toBeInTheDocument();
    const costBtn = screen.getByRole("button", { name: "コスト" });
    await user.click(costBtn);
    expect(screen.getByText("$1.23")).toBeInTheDocument();
  });
});
