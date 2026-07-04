import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { ToolBreakdown } from "./ToolBreakdown";
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
  byTool: [
    { toolName: "Agent", key: "Agent:Explore", name: "Explore", calls: 15, sessions: 3 },
    { toolName: "Skill", key: "Skill:codebase-onboarding", name: "codebase-onboarding", calls: 8, sessions: 2 },
  ],
  byMcpServer: [],
};

describe("ToolBreakdown", () => {
  it("デフォルトで呼び出し回数ボタンがアクティブ", () => {
    render(<ToolBreakdown s={minimalSummary} />);
    const callsBtn = screen.getByRole("button", { name: "呼び出し回数" });
    const sessionsBtn = screen.getByRole("button", { name: "セッション数" });
    expect(callsBtn).toHaveAttribute("aria-pressed", "true");
    expect(sessionsBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("デフォルトでテーブルに呼び出し回数が表示される", () => {
    render(<ToolBreakdown s={minimalSummary} />);
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("セッション数ボタンを押すとセッション数がテーブルに表示される", async () => {
    const user = userEvent.setup();
    render(<ToolBreakdown s={minimalSummary} />);
    const sessionsBtn = screen.getByRole("button", { name: "セッション数" });
    await user.click(sessionsBtn);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("セッション数ボタンを押すとセッション数ボタンがアクティブになる", async () => {
    const user = userEvent.setup();
    render(<ToolBreakdown s={minimalSummary} />);
    const sessionsBtn = screen.getByRole("button", { name: "セッション数" });
    await user.click(sessionsBtn);
    expect(sessionsBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "呼び出し回数" })).toHaveAttribute("aria-pressed", "false");
  });
});
