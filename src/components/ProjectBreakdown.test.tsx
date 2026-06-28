import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { ProjectBreakdown } from "./ProjectBreakdown";
import type { Summary } from "../api";

const minimalSummary: Summary = {
  generatedAt: "2026-01-01T00:00:00Z",
  totals: { cost: 0, tokens: 0, sessions: 0, messages: 0, from: null, to: null },
  tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  models: [],
  daily: [],
  projects: [
    { cwd: "/home/user/project-alpha", cost: 2.50, tokens: 200000 },
    { cwd: "/home/user/project-beta", cost: 0.75, tokens: 80000 },
  ],
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
};

describe("ProjectBreakdown", () => {
  it("デフォルトでトークンボタンがアクティブ", () => {
    render(<ProjectBreakdown s={minimalSummary} />);
    const tokensBtn = screen.getByRole("button", { name: "トークン" });
    const costBtn = screen.getByRole("button", { name: "コスト" });
    expect(tokensBtn).toHaveAttribute("aria-pressed", "true");
    expect(costBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("デフォルトでテーブルにトークン値が表示される", () => {
    render(<ProjectBreakdown s={minimalSummary} />);
    // 200,000 → "200K"
    expect(screen.getByText("200K")).toBeInTheDocument();
  });

  it("コストボタンを押すとコスト値がテーブルに表示される", async () => {
    const user = userEvent.setup();
    render(<ProjectBreakdown s={minimalSummary} />);
    const costBtn = screen.getByRole("button", { name: "コスト" });
    await user.click(costBtn);
    expect(screen.getByText("$2.50")).toBeInTheDocument();
  });

  it("コストボタンを押すとコストボタンがアクティブになる", async () => {
    const user = userEvent.setup();
    render(<ProjectBreakdown s={minimalSummary} />);
    const costBtn = screen.getByRole("button", { name: "コスト" });
    await user.click(costBtn);
    expect(costBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "トークン" })).toHaveAttribute("aria-pressed", "false");
  });
});
