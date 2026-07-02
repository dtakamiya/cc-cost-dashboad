import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { DailyTrend } from "./DailyTrend";
import type { Summary } from "../api";

// jsdom は要素に実サイズを与えないため、ResponsiveContainer（内部で ResizeObserver
// のコールバックを待って幅/高さを state にセットする）配下の recharts が子要素を
// 描画しない。offsetWidth/offsetHeight をモックし、ResizeObserver のコールバックを
// 即時発火させることでテスト環境でも描画させる。
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 320 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 320 });
  // recharts は軸ラベルの幅計測に非表示 span (#recharts_measurement_span) の
  // getBoundingClientRect を使う。テキスト長に応じたおおよその幅を返し、
  // 軸の描画がスキップされないようにする。
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const isMeasurementSpan = this.id === "recharts_measurement_span";
    const width = isMeasurementSpan ? (this.textContent?.length ?? 0) * 7 : 0;
    const height = isMeasurementSpan ? 14 : 0;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => {} } as DOMRect;
  };
  // jsdom は SVGElement.getBBox 未実装のため、recharts の YAxis 幅計算が例外になり描画がスキップされる。
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ width: 40, height: 16, x: 0, y: 0 }) as DOMRect;

  globalThis.ResizeObserver = class {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: { width: 800, height: 320 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
});

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
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheReadRatio: 0,
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

describe("キャッシュ活用率トレンド", () => {
  it("60%と80%の目標ラインのラベルが表示される", () => {
    const { container } = render(<DailyTrend s={minimalSummary} />);
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(container).toBeTruthy();
  });

  it("凡例にキャッシュ活用率の系列が表示される", () => {
    render(<DailyTrend s={minimalSummary} />);
    expect(screen.getByText("キャッシュ活用率")).toBeInTheDocument();
  });

  it("キャッシュ活用率の折れ線（recharts-line）が描画される", () => {
    const { container } = render(<DailyTrend s={minimalSummary} />);
    const lines = container.querySelectorAll(".recharts-line");
    expect(lines.length).toBeGreaterThan(0);
  });
});
