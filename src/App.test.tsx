import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import App from "./App";
import { createQueryClientWrapper } from "./testUtils/queryClientWrapper";
import * as api from "./api";

// 各テストで独立した QueryClient を使い、キャッシュがテスト間で漏れないようにする。
function renderApp() {
  const { wrapper: Wrapper } = createQueryClientWrapper();
  return render(
    <Wrapper>
      <App />
    </Wrapper>
  );
}

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    fetchSummary: vi.fn(),
    fetchHourly: vi.fn().mockResolvedValue([]),
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
    renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/自動更新失敗/)).toBeNull();
  });

  it("silent reload 失敗時に自動更新失敗メッセージが表示される", async () => {
    renderApp();
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
    renderApp();
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
    renderApp();
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
    renderApp();
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

describe("App - トップバーモバイル2段構成", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetchSummary.mockResolvedValue(minimalSummary);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("トップバーに topbar-row-1 要素が存在する", async () => {
    const { container } = renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const row1 = container.querySelector(".topbar-row-1");
    expect(row1).toBeInTheDocument();
  });

  it("トップバーに topbar-row-2 要素が存在する", async () => {
    const { container } = renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const row2 = container.querySelector(".topbar-row-2");
    expect(row2).toBeInTheDocument();
  });

  it("topbar-row-1 に topbar-title が含まれている", async () => {
    const { container } = renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const row1 = container.querySelector(".topbar-row-1");
    const title = row1?.querySelector(".topbar-title");
    expect(title).toBeInTheDocument();
  });

  it("topbar-row-1 に last-updated が含まれている", async () => {
    const { container } = renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const row1 = container.querySelector(".topbar-row-1");
    const lastUpdated = row1?.querySelector(".last-updated");
    expect(lastUpdated).toBeInTheDocument();
  });

  it("topbar-row-2 に topbar-controls が含まれている", async () => {
    const { container } = renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const row2 = container.querySelector(".topbar-row-2");
    const controls = row2?.querySelector(".topbar-controls");
    expect(controls).toBeInTheDocument();
  });

  it("topbar-controls にライブ更新ボタンが含まれている", async () => {
    const { container } = renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const controls = container.querySelector(".topbar-controls");
    const liveToggle = controls?.querySelector(".live-toggle");
    expect(liveToggle).toBeInTheDocument();
  });

  it("topbar-controls に期間選択ボタンが含まれている", async () => {
    const { container } = renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const controls = container.querySelector(".topbar-controls");
    const periodSelector = controls?.querySelector(".period-selector");
    expect(periodSelector).toBeInTheDocument();
  });

  it("topbar-controls に再読込ボタンが含まれている", async () => {
    const { container } = renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const controls = container.querySelector(".topbar-controls");
    const reloadBtn = controls?.querySelector(".reload");
    expect(reloadBtn).toBeInTheDocument();
  });

  it("ライブ更新ボタンのクリックが機能する", async () => {
    renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const liveToggle = screen.getByRole("button", { name: /ライブ更新/ });
    expect(liveToggle).toBeInTheDocument();

    await userEvent.click(liveToggle);

    // ボタンの状態が変わることを確認
    expect(liveToggle.textContent).toMatch(/OFF/);
  });

  it("再読込ボタンのクリックが機能する", async () => {
    renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const reloadBtn = screen.getByRole("button", { name: /再読込/ });
    expect(reloadBtn).toBeInTheDocument();

    await userEvent.click(reloadBtn);

    // 再読込がトリガーされたことを確認
    await waitFor(() =>
      expect(mockFetchSummary).toHaveBeenCalledWith(true)
    );
  });
});

describe("App - テーマ切り替え", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetchSummary.mockResolvedValue(minimalSummary);
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    document.documentElement.removeAttribute("data-theme");
  });

  it("初期テーマがlocalStorageのthemeキーから復元される", async () => {
    localStorage.setItem("theme", "light");
    renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("OSがprefers-color-scheme:lightのとき、localStorage未設定なら初期テーマがlightになる", async () => {
    (globalThis.matchMedia as ReturnType<typeof vi.fn>).mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: light)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("テーマトグルボタンが存在する", async () => {
    const { container } = renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));
    expect(container.querySelector(".theme-toggle")).toBeInTheDocument();
  });

  it("テーマトグルボタンのクリックでライトモードに切り替わる", async () => {
    renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const toggle = screen.getByRole("button", { name: /ライト.*ダーク|ダーク.*ライト|テーマ/i });
    await userEvent.click(toggle);

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("ライトモード時にトグルボタンを押すとダークモードに戻る", async () => {
    localStorage.setItem("theme", "light");
    renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const toggle = screen.getByRole("button", { name: /ライト.*ダーク|ダーク.*ライト|テーマ/i });
    await userEvent.click(toggle);

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("テーマ切り替え後にlocalStorageが更新される", async () => {
    renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const toggle = screen.getByRole("button", { name: /ライト.*ダーク|ダーク.*ライト|テーマ/i });
    await userEvent.click(toggle);

    expect(localStorage.getItem("theme")).toBe("light");
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
    renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const nav = screen.getByRole("navigation", { name: /ダッシュボードセクション/ });
    expect(nav).toBeInTheDocument();
  });

  it("セクションナビゲーションが5つのボタンを表示する", async () => {
    renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const buttons = screen.getAllByRole("button");
    const navButtons = buttons.filter(btn =>
      ["概要", "コストドライバー", "プロジェクト", "セッション", "最適化"].includes(btn.textContent || "")
    );
    expect(navButtons.length).toBeGreaterThanOrEqual(5);
  });

  it("各セクションが ID 属性を持つ", async () => {
    const { container } = renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    expect(container.querySelector('[id="section-summary"]')).toBeInTheDocument();
    expect(container.querySelector('[id="section-drivers"]')).toBeInTheDocument();
    expect(container.querySelector('[id="section-project"]')).toBeInTheDocument();
    expect(container.querySelector('[id="section-session"]')).toBeInTheDocument();
    expect(container.querySelector('[id="section-optimization"]')).toBeInTheDocument();
  });

  it("トップバー操作と SectionNav が共存する", async () => {
    renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    const topbar = screen.getByRole("banner");
    const sectionNav = screen.getByRole("navigation", { name: /ダッシュボードセクション/ });

    expect(topbar).toBeInTheDocument();
    expect(sectionNav).toBeInTheDocument();
  });

  it("セクションボタンクリックで scrollIntoView が呼ばれる", async () => {
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("プロジェクト"));

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("セクションボタンクリック後、該当ボタンの aria-current が page になる", async () => {
    Element.prototype.scrollIntoView = vi.fn();

    renderApp();
    await waitFor(() => expect(mockFetchSummary).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("プロジェクト"));

    const projectBtn = screen.getByText("プロジェクト").closest("button");
    expect(projectBtn).toHaveAttribute("aria-current", "page");
  });
});
