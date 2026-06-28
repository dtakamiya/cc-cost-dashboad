import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import App from "./App";
import * as api from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    fetchSummary: vi.fn(),
    subscribeToUpdates: vi.fn(() => () => {}),
    activeBurnWarning: vi.fn(() => null),
    filterSummary: vi.fn((s: api.Summary) => s),
    filterSummaryByProject: vi.fn((s: api.Summary) => s),
    filterPreviousPeriod: vi.fn(() => null),
  };
});

const mockFetchSummary = vi.mocked(api.fetchSummary);

const minimalSummary: api.Summary = {
  generatedAt: "2026-01-01T00:00:00Z",
  totals: { cost: 0, tokens: 0, sessions: 0, messages: 0, from: null, to: null },
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
};

describe("App - 自動更新エラー表示", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetchSummary.mockResolvedValue(minimalSummary);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("初回ロード成功後に autoRefreshError は表示されない", async () => {
    render(<App />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/自動更新失敗/)).toBeNull();
  });

  it("silent reload 失敗時に自動更新失敗メッセージが表示される", async () => {
    render(<App />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    mockFetchSummary.mockRejectedValueOnce(new Error("network error"));

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    await waitFor(() =>
      expect(screen.getByText(/自動更新失敗/)).toBeInTheDocument()
    );
  });

  it("silent reload 失敗時に通常の全画面エラーは表示されない", async () => {
    render(<App />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    mockFetchSummary.mockRejectedValueOnce(new Error("network error"));

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    await waitFor(() =>
      expect(screen.getByText(/自動更新失敗/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/読み込み失敗/)).toBeNull();
  });

  it("silent reload 成功後に autoRefreshError がクリアされる", async () => {
    render(<App />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    mockFetchSummary.mockRejectedValueOnce(new Error("network error"));
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await waitFor(() =>
      expect(screen.getByText(/自動更新失敗/)).toBeInTheDocument()
    );

    mockFetchSummary.mockResolvedValueOnce(minimalSummary);
    await act(async () => { vi.advanceTimersByTime(30_000); });

    await waitFor(() =>
      expect(screen.queryByText(/自動更新失敗/)).toBeNull()
    );
  });

  it("手動再読込成功後に autoRefreshError がクリアされる", async () => {
    render(<App />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    mockFetchSummary.mockRejectedValueOnce(new Error("network error"));
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await waitFor(() =>
      expect(screen.getByText(/自動更新失敗/)).toBeInTheDocument()
    );

    mockFetchSummary.mockResolvedValueOnce(minimalSummary);
    const reloadButton = screen.getByRole("button", { name: /再読込/ });
    await userEvent.click(reloadButton);

    await waitFor(() =>
      expect(screen.queryByText(/自動更新失敗/)).toBeNull()
    );
  });
});

describe("App - セクションナビゲーション", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetchSummary.mockResolvedValue(minimalSummary);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("データロード後にセクションナビゲーションが表示される", async () => {
    render(<App />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const nav = screen.getByRole("navigation", { name: /ダッシュボードセクション/ });
    expect(nav).toBeInTheDocument();
  });

  it("セクションナビゲーションが5つのボタンを表示する", async () => {
    render(<App />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const buttons = screen.getAllByRole("button");
    const navButtons = buttons.filter(btn =>
      ["概要", "コストドライバー", "プロジェクト", "セッション", "最適化"].includes(btn.textContent || "")
    );
    expect(navButtons.length).toBeGreaterThanOrEqual(5);
  });

  it("各セクションが ID 属性を持つ", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    expect(container.querySelector('[id="section-summary"]')).toBeInTheDocument();
    expect(container.querySelector('[id="section-drivers"]')).toBeInTheDocument();
    expect(container.querySelector('[id="section-project"]')).toBeInTheDocument();
    expect(container.querySelector('[id="section-session"]')).toBeInTheDocument();
    expect(container.querySelector('[id="section-optimization"]')).toBeInTheDocument();
  });

  it("トップバー操作と SectionNav が共存する", async () => {
    render(<App />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const topbar = screen.getByRole("banner");
    const sectionNav = screen.getByRole("navigation", { name: /ダッシュボードセクション/ });

    expect(topbar).toBeInTheDocument();
    expect(sectionNav).toBeInTheDocument();
  });

  it("セクションボタンクリックで scrollIntoView が呼ばれる", async () => {
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    render(<App />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("プロジェクト"));

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("セクションボタンクリック後、該当ボタンの aria-current が page になる", async () => {
    Element.prototype.scrollIntoView = vi.fn();

    render(<App />);
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("プロジェクト"));

    const projectBtn = screen.getByText("プロジェクト").closest("button");
    expect(projectBtn).toHaveAttribute("aria-current", "page");
  });
});
