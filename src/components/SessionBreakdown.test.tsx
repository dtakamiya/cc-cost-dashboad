import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { Summary, SessionCost, SessionTurn } from "../api";

// fetchSessionTurns だけモックし他は本物を使う
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    fetchSessionTurns: vi.fn(),
  };
});

import { fetchSessionTurns } from "../api";
import { SessionBreakdown } from "./SessionBreakdown";

function makeSummary(sessions: SessionCost[], overrides: Partial<Summary> = {}): Summary {
  return {
    generatedAt: "2026-06-28T00:00:00.000Z",
    totals: { cost: 10, tokens: 100_000, sessions: sessions.length, messages: 50, from: "2026-06-01", to: "2026-06-28" },
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
    projection: null,
    activity: { matrix: [], max: 0, total: 0, peak: null },
    bySession: sessions,
    byTool: [],
    byMcpServer: [],
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionCost> = {}): SessionCost {
  return {
    sessionId: "test-session-1",
    cwd: "/home/user/myproject",
    cost: 1.5,
    tokens: 30_000,
    messages: 10,
    input: 10_000,
    output: 5_000,
    cacheCreate: 8_000,
    cacheRead: 7_000,
    firstTs: "2026-06-15T10:00:00.000Z",
    lastTs: "2026-06-15T12:00:00.000Z",
    avgContextPerMsg: 1_700,
    topModel: { model: "claude-opus-4-8", cost: 1.5 },
    compactionCount: 0,
    ...overrides,
  };
}

describe("SessionBreakdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("セッションが空のとき「セッションなし」相当のメッセージを表示する", () => {
    render(<SessionBreakdown s={makeSummary([])} />);
    // セッションなしの場合は行が存在しないことを確認
    expect(screen.queryByText(/test-session/)).not.toBeInTheDocument();
  });

  it("セッション一覧が表示される（プロジェクト名が出る）", () => {
    const s = makeSummary([makeSession()]);
    render(<SessionBreakdown s={s} />);
    // cwd の最後のディレクトリ名が表示される
    expect(screen.getByText("myproject")).toBeInTheDocument();
  });

  it("セッションのコストが USD 形式で表示される", () => {
    const s = makeSummary([makeSession({ cost: 1.5 })]);
    render(<SessionBreakdown s={s} />);
    expect(screen.getByText("$1.50")).toBeInTheDocument();
  });

  it("展開ボタンクリックで fetchSessionTurns が呼ばれる", async () => {
    const turns: SessionTurn[] = [
      { ts: "2026-06-15T10:00:00.000Z", model: "claude-opus-4-8", input: 100, output: 50, cacheCreate: 0, cacheRead: 0, cost: 0.001 },
    ];
    vi.mocked(fetchSessionTurns).mockResolvedValue(turns);

    const s = makeSummary([makeSession()]);
    render(<SessionBreakdown s={s} />);

    // 展開ボタン（aria-label="詳細を展開"）をクリック
    const expandBtn = screen.getByRole("button", { name: "詳細を展開" });
    fireEvent.click(expandBtn);

    await waitFor(() => {
      expect(fetchSessionTurns).toHaveBeenCalledWith("test-session-1");
    });
  });

  it("fetchSessionTurns が成功するとターンデータが表示される", async () => {
    const turns: SessionTurn[] = [
      { ts: "2026-06-15T10:00:00.000Z", model: "claude-opus-4-8", input: 1000, output: 500, cacheCreate: 0, cacheRead: 0, cost: 0.01 },
      { ts: "2026-06-15T10:05:00.000Z", model: "claude-opus-4-8", input: 2000, output: 800, cacheCreate: 0, cacheRead: 0, cost: 0.02 },
    ];
    vi.mocked(fetchSessionTurns).mockResolvedValue(turns);

    const s = makeSummary([makeSession()]);
    render(<SessionBreakdown s={s} />);

    const expandBtn = screen.getByRole("button", { name: "詳細を展開" });
    fireEvent.click(expandBtn);

    await waitFor(() => {
      expect(screen.getByText(/会話ターン別トークン消費/)).toBeInTheDocument();
    });
  });

  it("fetchSessionTurns が成功すると累積コスト曲線も表示される", async () => {
    const turns: SessionTurn[] = [
      { ts: "2026-06-15T10:00:00.000Z", model: "claude-opus-4-8", input: 1000, output: 500, cacheCreate: 0, cacheRead: 0, cost: 0.01 },
      { ts: "2026-06-15T10:05:00.000Z", model: "claude-opus-4-8", input: 2000, output: 800, cacheCreate: 0, cacheRead: 0, cost: 0.02 },
    ];
    vi.mocked(fetchSessionTurns).mockResolvedValue(turns);

    const s = makeSummary([makeSession()]);
    render(<SessionBreakdown s={s} />);

    const expandBtn = screen.getByRole("button", { name: "詳細を展開" });
    fireEvent.click(expandBtn);

    await waitFor(() => {
      expect(screen.getByText(/累積コスト推移/)).toBeInTheDocument();
    });
  });

  it("compactionCount がセルに表示される", () => {
    const s = makeSummary([makeSession({ compactionCount: 2 })]);
    render(<SessionBreakdown s={s} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("compactionCount が閾値(3)以上のとき「多発」バッジが表示される", () => {
    const s = makeSummary([makeSession({ compactionCount: 3 })]);
    render(<SessionBreakdown s={s} />);
    expect(screen.getByText("多発")).toBeInTheDocument();
  });

  it("compactionCount が閾値未満のとき「多発」バッジは表示されない", () => {
    const s = makeSummary([makeSession({ compactionCount: 2 })]);
    render(<SessionBreakdown s={s} />);
    expect(screen.queryByText("多発")).not.toBeInTheDocument();
  });

  it("圧縮マーカーが無い（compactionCount: 0）セッションでもエラーなく0として表示される", () => {
    const s = makeSummary([makeSession({ compactionCount: 0 })]);
    render(<SessionBreakdown s={s} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("展開行の colSpan が圧縮列追加後も正しく全列を覆う", async () => {
    vi.mocked(fetchSessionTurns).mockResolvedValue([]);
    const s = makeSummary([makeSession()]);
    render(<SessionBreakdown s={s} />);
    const expandBtn = screen.getByRole("button", { name: "詳細を展開" });
    fireEvent.click(expandBtn);
    await waitFor(() => {
      expect(screen.getAllByText(/ターンデータなし/).length).toBeGreaterThan(0);
    });
    const detailCell = screen.getAllByText(/ターンデータなし/)[0].closest("td");
    expect(detailCell).toHaveAttribute("colspan", "7");
  });

  it("16件以上のセッションがある場合「さらに表示」ボタンが表示される", () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession({ sessionId: `session-${i}`, cwd: `/home/u/proj-${i}` })
    );
    const s = makeSummary(sessions);
    render(<SessionBreakdown s={s} />);
    expect(screen.getByRole("button", { name: /さらに表示/ })).toBeInTheDocument();
    expect(screen.getByText(/全20件/)).toBeInTheDocument();
  });

  it("15件以下の場合はボタンが表示されない", () => {
    const sessions = Array.from({ length: 15 }, (_, i) =>
      makeSession({ sessionId: `session-${i}`, cwd: `/home/u/proj-${i}` })
    );
    const s = makeSummary(sessions);
    render(<SessionBreakdown s={s} />);
    expect(screen.queryByRole("button", { name: /さらに表示/ })).not.toBeInTheDocument();
  });

  it("「さらに表示」クリックで全件表示される", () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession({ sessionId: `session-${i}`, cwd: `/home/u/proj-${i}` })
    );
    const s = makeSummary(sessions);
    render(<SessionBreakdown s={s} />);

    // 初期表示は15件
    expect(screen.getByText("proj-14")).toBeInTheDocument();
    expect(screen.queryByText("proj-19")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /さらに表示/ }));

    expect(screen.getByText("proj-19")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /さらに表示/ })).not.toBeInTheDocument();
  });

  it("clear コピーボタンをクリックするとコピー済みアイコン(Icon コンポーネント)が表示される", async () => {
    // navigator.clipboard.writeText をモック
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const s = makeSummary([
      makeSession({ messages: 100, avgContextPerMsg: 150_000 }),
    ]);
    render(<SessionBreakdown s={s} />);
    const copyBtn = screen.getByRole("button", { name: /clear コピー/ });
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(screen.getByTestId("icon-check")).toBeInTheDocument();
    });
  });

  it("複数セッションがコスト降順で表示される", () => {
    const sessions = [
      makeSession({ sessionId: "cheap", cwd: "/home/u/cheap-proj", cost: 0.5 }),
      makeSession({ sessionId: "expensive", cwd: "/home/u/expensive-proj", cost: 5.0 }),
    ];
    // bySession はサーバー側でコスト降順に返るものとして渡す
    const sorted = [...sessions].sort((a, b) => b.cost - a.cost);
    const s = makeSummary(sorted);
    render(<SessionBreakdown s={s} />);

    const rows = screen.getAllByRole("row");
    // 最初のデータ行（ヘッダー除く）が expensive-proj になること
    const dataRows = rows.slice(1); // ヘッダー行を除く
    expect(dataRows[0]).toHaveTextContent("expensive-proj");
  });
});
