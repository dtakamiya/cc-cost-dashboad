import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { DailyTrend } from "./DailyTrend";
import type { Summary } from "../api";

const minimalSummary: Summary = {
  generatedAt: "2026-01-01T00:00:00Z",
  totals: { cost: 0, tokens: 0, sessions: 0, messages: 0, from: null, to: null },
  tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  models: [
    { model: "claude-sonnet-4-5", cost: 1.23, tokens: 100000, isFallback: false },
  ],
  daily: [
    {
      date: "2026-01-01",
      models: { "claude-sonnet-4-5": 0.50 },
      total: 0.50,
      tokenModels: { "claude-sonnet-4-5": 50000 },
      tokenTotal: 50000,
      projectTokens: {},
    },
  ],
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
};

describe("period プロップによる初期ビュー制御", () => {
  it("period が '7d' のとき、日次ボタンがアクティブ", () => {
    render(<DailyTrend s={minimalSummary} period="7d" />);
    expect(screen.getByRole("button", { name: "日次" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "週次" })).toHaveAttribute("aria-pressed", "false");
  });

  it("period が '30d' のとき、日次ボタンがアクティブ", () => {
    render(<DailyTrend s={minimalSummary} period="30d" />);
    expect(screen.getByRole("button", { name: "日次" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "週次" })).toHaveAttribute("aria-pressed", "false");
  });

  it("period が '90d' のとき、週次ボタンがアクティブ", () => {
    render(<DailyTrend s={minimalSummary} period="90d" />);
    expect(screen.getByRole("button", { name: "週次" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "日次" })).toHaveAttribute("aria-pressed", "false");
  });

  it("period が 'all' のとき、週次ボタンがアクティブ", () => {
    render(<DailyTrend s={minimalSummary} period="all" />);
    expect(screen.getByRole("button", { name: "週次" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "日次" })).toHaveAttribute("aria-pressed", "false");
  });

  it("period が '90d' から '7d' に変わると日次ビューに切り替わる", () => {
    const { rerender } = render(<DailyTrend s={minimalSummary} period="90d" />);
    expect(screen.getByRole("button", { name: "週次" })).toHaveAttribute("aria-pressed", "true");
    rerender(<DailyTrend s={minimalSummary} period="7d" />);
    expect(screen.getByRole("button", { name: "日次" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "週次" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("週次集約バナー", () => {
  it("period='90d' のとき週次集約バナーが表示される", () => {
    render(<DailyTrend s={minimalSummary} period="90d" />);
    expect(screen.getByText("データ量が多いため週次集約で表示しています")).toBeInTheDocument();
  });

  it("period='7d' のときバナーは表示されない", () => {
    render(<DailyTrend s={minimalSummary} period="7d" />);
    expect(screen.queryByText("データ量が多いため週次集約で表示しています")).not.toBeInTheDocument();
  });

  it("period='90d' で手動日次切替するとバナーが消える", async () => {
    const user = userEvent.setup();
    render(<DailyTrend s={minimalSummary} period="90d" />);
    expect(screen.getByText("データ量が多いため週次集約で表示しています")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "日次" }));
    expect(screen.queryByText("データ量が多いため週次集約で表示しています")).not.toBeInTheDocument();
  });
});

describe("DailyTrend", () => {
  it("トークン/コスト切替ボタンが表示される", () => {
    render(<DailyTrend s={minimalSummary} />);
    expect(screen.getByRole("button", { name: "トークン" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "コスト" })).toBeInTheDocument();
  });

  it("デフォルトでトークンボタンがアクティブ", () => {
    render(<DailyTrend s={minimalSummary} />);
    expect(screen.getByRole("button", { name: "トークン" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "コスト" })).toHaveAttribute("aria-pressed", "false");
  });

  it("日次/週次切替ボタンも引き続き表示される", () => {
    render(<DailyTrend s={minimalSummary} />);
    expect(screen.getByRole("button", { name: "日次" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "週次" })).toBeInTheDocument();
  });

  it("コストボタンを押すとコストボタンがアクティブになる", async () => {
    const user = userEvent.setup();
    render(<DailyTrend s={minimalSummary} />);
    const costBtn = screen.getByRole("button", { name: "コスト" });
    await user.click(costBtn);
    expect(costBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "トークン" })).toHaveAttribute("aria-pressed", "false");
  });
});
