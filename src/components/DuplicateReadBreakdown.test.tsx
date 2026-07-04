import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DuplicateReadBreakdown } from "./DuplicateReadBreakdown";
import type { Summary, DuplicateReads } from "../api";

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    generatedAt: "2026-06-28T00:00:00.000Z",
    totals: { cost: 10, tokens: 100_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-28" },
    tokenSplit: { input: 100_000, output: 100_000, cacheCreate: 100_000, cacheRead: 700_000 },
    costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    models: [],
    daily: [],
    projects: [],
    drivers: { topModel: null, topDay: null, topDayModel: null, cacheReadRatio: 0, outputCostRatio: 0 },
    sessionStats: { avgColdStartTokens: 0, p90ColdStartTokens: 0, coldStartCost: 0 },
    overhead: {
      claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [],
      projectPlugins: [], mcpServers: [], totalAlwaysTokens: 1000, totalInvokeTokens: 0, totalEstimatedTokens: 1000,
    },
    warnings: { fallbackModels: [] },
    blocks: [],
    projection: null,
    activity: { matrix: [], max: 0, total: 0, peak: null },
    bySession: [],
    byTool: [],
    byMcpServer: [],
    ...overrides,
  };
}

const duplicateReads = (over: Partial<DuplicateReads> = {}): DuplicateReads => ({
  totalDuplicateReads: 3,
  totalDuplicateTokensApprox: 250,
  byFile: [
    { filePath: "/home/u/proj/a.ts", readCount: 3, duplicateCount: 2, duplicateTokensApprox: 200 },
    { filePath: "/home/u/proj/b.ts", readCount: 2, duplicateCount: 1, duplicateTokensApprox: 50 },
  ],
  isApprox: true,
  ...over,
});

describe("DuplicateReadBreakdown", () => {
  it("duplicateReads が未定義なら何も表示しない", () => {
    const { container } = render(<DuplicateReadBreakdown s={makeSummary()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("重複が0件なら何も表示しない", () => {
    const s = makeSummary({
      duplicateReads: duplicateReads({ totalDuplicateReads: 0, totalDuplicateTokensApprox: 0, byFile: [] }),
    });
    const { container } = render(<DuplicateReadBreakdown s={s} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("上位重複ファイルがテーブル表示される", () => {
    const s = makeSummary({ duplicateReads: duplicateReads() });
    render(<DuplicateReadBreakdown s={s} />);
    expect(screen.getByText("/home/u/proj/a.ts")).toBeInTheDocument();
    expect(screen.getByText("/home/u/proj/b.ts")).toBeInTheDocument();
    // a.ts の行に Read回数3・重複回数2 が表示される
    const row = screen.getByText("/home/u/proj/a.ts").closest("tr")!;
    const cells = [...row.querySelectorAll("td")].map((td) => td.textContent);
    expect(cells).toEqual(["/home/u/proj/a.ts", "3", "2", "200"]);
    expect(screen.getAllByText(/近似値/).length).toBeGreaterThan(0);
  });
});
