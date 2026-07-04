import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { BillingBlocks } from "./BillingBlocks";
import type { Summary, Block } from "../api";

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    start: "2026-06-28T00:00:00Z",
    end: "2026-06-28T05:00:00Z",
    isActive: false,
    cost: 0.5,
    tokens: 10000,
    durationMin: 120,
    remainMin: 0,
    burnRatePerMin: 0.004,
    recentBurnRatePerMin: 0.003,
    topModel: { model: "claude-sonnet-4-6", cost: 0.5 },
    ...overrides,
  };
}

const minimalSummary: Summary = {
  generatedAt: "2026-06-28T00:00:00Z",
  totals: { cost: 0, tokens: 0, sessions: 0, messages: 0, from: null, to: null },
  tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  models: [],
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
  byMcpServer: [],
};

describe("BillingBlocks", () => {
  it("blocksが空の場合は何も表示しない", () => {
    const { container } = render(<BillingBlocks s={minimalSummary} />);
    expect(container.firstChild).toBeNull();
  });

  it("ACTIVEブロックは常時表示される", () => {
    const s = { ...minimalSummary, blocks: [makeBlock({ isActive: true, remainMin: 42 })] };
    render(<BillingBlocks s={s} />);
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText(/42 分/)).toBeInTheDocument();
  });

  it("履歴ブロックがあるときトグルボタンが表示される", () => {
    const s = { ...minimalSummary, blocks: [makeBlock({ isActive: false })] };
    render(<BillingBlocks s={s} />);
    expect(screen.getByRole("button", { name: /履歴/ })).toBeInTheDocument();
  });

  it("初期状態では履歴は折りたたまれている", () => {
    const s = { ...minimalSummary, blocks: [makeBlock({ isActive: false })] };
    render(<BillingBlocks s={s} />);
    const toggle = screen.getByRole("button", { name: /履歴/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("トグルボタンをクリックすると履歴が展開される", async () => {
    const user = userEvent.setup();
    const s = { ...minimalSummary, blocks: [makeBlock({ isActive: false })] };
    render(<BillingBlocks s={s} />);
    const toggle = screen.getByRole("button", { name: /履歴/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("折りたたみ時は履歴ブロックの行が非表示", () => {
    const s = {
      ...minimalSummary,
      blocks: [makeBlock({ isActive: false, tokens: 99999 })],
    };
    render(<BillingBlocks s={s} />);
    expect(screen.queryByText("100K", { exact: false })).not.toBeInTheDocument();
  });

  it("展開時は履歴ブロックの行が表示される", async () => {
    const user = userEvent.setup();
    const s = {
      ...minimalSummary,
      blocks: [makeBlock({ isActive: false, tokens: 99999 })],
    };
    render(<BillingBlocks s={s} />);
    await user.click(screen.getByRole("button", { name: /履歴/ }));
    expect(screen.getByText("100K", { exact: false })).toBeInTheDocument();
  });

  it("ACTIVEブロックのみの場合はトグルボタンが表示されない", () => {
    const s = { ...minimalSummary, blocks: [makeBlock({ isActive: true })] };
    render(<BillingBlocks s={s} />);
    expect(screen.queryByRole("button", { name: /履歴/ })).not.toBeInTheDocument();
  });

  it("履歴件数がトグルボタンに表示される", () => {
    const s = {
      ...minimalSummary,
      blocks: [makeBlock(), makeBlock(), makeBlock()],
    };
    render(<BillingBlocks s={s} />);
    expect(screen.getByRole("button", { name: /3件/ })).toBeInTheDocument();
  });

  describe("もっと見る機能", () => {
    it("履歴が5件以下の場合は「もっと見る」ボタンが表示されない", async () => {
      const user = userEvent.setup();
      const blocks = Array.from({ length: 4 }, (_, i) =>
        makeBlock({ start: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z` })
      );
      const s = { ...minimalSummary, blocks };
      render(<BillingBlocks s={s} />);
      await user.click(screen.getByRole("button", { name: /履歴/ }));
      expect(screen.queryByRole("button", { name: /もっと見る/ })).not.toBeInTheDocument();
    });

    it("履歴が6件以上の場合は「もっと見る」ボタンが表示される", async () => {
      const user = userEvent.setup();
      const blocks = Array.from({ length: 6 }, (_, i) =>
        makeBlock({ start: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z` })
      );
      const s = { ...minimalSummary, blocks };
      render(<BillingBlocks s={s} />);
      await user.click(screen.getByRole("button", { name: /履歴/ }));
      expect(screen.getByRole("button", { name: /もっと見る/ })).toBeInTheDocument();
    });

    it("初期表示は5件のみ表示される", async () => {
      const user = userEvent.setup();
      const blocks = Array.from({ length: 15 }, (_, i) =>
        makeBlock({ start: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z`, tokens: (i + 1) * 1000 })
      );
      const s = { ...minimalSummary, blocks };
      render(<BillingBlocks s={s} />);
      await user.click(screen.getByRole("button", { name: /履歴/ }));
      const rows = document.querySelectorAll(".block-row");
      expect(rows).toHaveLength(5);
    });

    it("「もっと見る」クリックで全件表示される", async () => {
      const user = userEvent.setup();
      const blocks = Array.from({ length: 15 }, (_, i) =>
        makeBlock({ start: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z` })
      );
      const s = { ...minimalSummary, blocks };
      render(<BillingBlocks s={s} />);
      await user.click(screen.getByRole("button", { name: /履歴/ }));
      await user.click(screen.getByRole("button", { name: /もっと見る/ }));
      const rows = document.querySelectorAll(".block-row");
      expect(rows).toHaveLength(15);
    });

    it("各履歴行にコストが表示される", async () => {
      const user = userEvent.setup();
      const s = { ...minimalSummary, blocks: [makeBlock({ cost: 1.23 })] };
      render(<BillingBlocks s={s} />);
      await user.click(screen.getByRole("button", { name: /履歴/ }));
      expect(screen.getByText(/1\.23/)).toBeInTheDocument();
    });

    it("昇順データでも最新5件が先頭に表示される", async () => {
      const user = userEvent.setup();
      // 古い順（昇順）で渡す: 6/01〜6/10
      const blocks = Array.from({ length: 10 }, (_, i) =>
        makeBlock({ start: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z` })
      );
      const s = { ...minimalSummary, blocks };
      render(<BillingBlocks s={s} />);
      await user.click(screen.getByRole("button", { name: /履歴/ }));
      const rows = document.querySelectorAll(".block-row");
      // 最新5件（6/06〜6/10）が表示されるはず
      expect(rows).toHaveLength(5);
      // 最初の行が最新（6/10）の時刻を含む
      expect(rows[0].textContent).toContain("6/10");
    });

    it("「もっと見る」展開後に履歴を閉じて再度開くと5件に戻る", async () => {
      const user = userEvent.setup();
      const blocks = Array.from({ length: 10 }, (_, i) =>
        makeBlock({ start: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z` })
      );
      const s = { ...minimalSummary, blocks };
      render(<BillingBlocks s={s} />);
      const toggle = screen.getByRole("button", { name: /履歴/ });
      await user.click(toggle);
      await user.click(screen.getByRole("button", { name: /もっと見る/ }));
      expect(document.querySelectorAll(".block-row")).toHaveLength(10);
      // 閉じる
      await user.click(toggle);
      // 再度開く
      await user.click(toggle);
      expect(document.querySelectorAll(".block-row")).toHaveLength(5);
    });
  });
});
