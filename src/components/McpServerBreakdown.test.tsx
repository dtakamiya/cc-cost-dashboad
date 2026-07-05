import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { McpServerBreakdown } from "./McpServerBreakdown";
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
  byTool: [],
  byMcpServer: [],
};

describe("McpServerBreakdown", () => {
  it("byMcpServer が空の場合、何も表示しない", () => {
    const { container } = render(<McpServerBreakdown s={minimalSummary} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("サーバー別に表が描画される", () => {
    const s: Summary = {
      ...minimalSummary,
      byMcpServer: [
        { serverName: "ccd_session", calls: 50, sessions: 5, lastUsed: "2026-06-30T00:00:00.000Z" },
        { serverName: "gh", calls: 3, sessions: 2, lastUsed: "2026-06-29T00:00:00.000Z" },
      ],
    };
    render(<McpServerBreakdown s={s} />);
    expect(screen.getByText("ccd_session")).toBeInTheDocument();
    expect(screen.getByText("gh")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("呼び出し頻度が低いサーバーに CLI 代替を検討するヒントが表示される", () => {
    const s: Summary = {
      ...minimalSummary,
      byMcpServer: [
        { serverName: "gh", calls: 2, sessions: 1, lastUsed: "2026-06-29T00:00:00.000Z" },
      ],
    };
    render(<McpServerBreakdown s={s} />);
    expect(screen.getByText(/CLI/)).toBeInTheDocument();
  });

  it("呼び出し頻度が高いサーバーにはヒントが表示されない", () => {
    const s: Summary = {
      ...minimalSummary,
      byMcpServer: [
        { serverName: "ccd_session", calls: 100, sessions: 10, lastUsed: "2026-06-30T00:00:00.000Z" },
      ],
    };
    render(<McpServerBreakdown s={s} />);
    expect(screen.queryByText(/CLI/)).not.toBeInTheDocument();
  });

  it("callCount:0の定義済みMCPサーバーに未使用バッジを表示する", () => {
    const s: Summary = {
      ...minimalSummary,
      byMcpServer: [
        { serverName: "gh", calls: 5, sessions: 2, lastUsed: "2026-06-29T00:00:00.000Z" },
      ],
      overhead: {
        ...minimalSummary.overhead,
        mcpServers: [
          { name: "gh", toolCount: null, estimatedTokens: 1500, source: "estimated", callCount: 5, lastUsed: "2026-06-29T00:00:00.000Z" },
          { name: "unused-server", toolCount: null, estimatedTokens: 1500, source: "estimated", callCount: 0, lastUsed: null },
        ],
      },
    };
    render(<McpServerBreakdown s={s} />);
    expect(screen.getByText("未使用")).toBeInTheDocument();
  });

  it("callCountが0より大きい定義済みMCPサーバーには未使用バッジを表示しない", () => {
    const s: Summary = {
      ...minimalSummary,
      byMcpServer: [
        { serverName: "gh", calls: 5, sessions: 2, lastUsed: "2026-06-29T00:00:00.000Z" },
      ],
      overhead: {
        ...minimalSummary.overhead,
        mcpServers: [
          { name: "gh", toolCount: null, estimatedTokens: 1500, source: "estimated", callCount: 5, lastUsed: "2026-06-29T00:00:00.000Z" },
        ],
      },
    };
    render(<McpServerBreakdown s={s} />);
    expect(screen.queryByText("未使用")).not.toBeInTheDocument();
  });

  it("lastUsedがある場合、最終使用日をYYYY-MM-DD形式で表示する", () => {
    const s: Summary = {
      ...minimalSummary,
      byMcpServer: [
        { serverName: "gh", calls: 5, sessions: 2, lastUsed: "2026-06-29T10:00:00.000Z" },
      ],
      overhead: {
        ...minimalSummary.overhead,
        mcpServers: [
          { name: "gh", toolCount: null, estimatedTokens: 1500, source: "estimated", callCount: 5, lastUsed: "2026-06-29T10:00:00.000Z" },
        ],
      },
    };
    render(<McpServerBreakdown s={s} />);
    expect(screen.getByText("2026-06-29")).toBeInTheDocument();
  });

  it("lastUsedがnullの場合、未使用扱いのハイフン等が表示されクラッシュしない", () => {
    const s: Summary = {
      ...minimalSummary,
      byMcpServer: [
        { serverName: "unused-server", calls: 0, sessions: 0, lastUsed: null },
      ],
      overhead: {
        ...minimalSummary.overhead,
        mcpServers: [
          { name: "unused-server", toolCount: null, estimatedTokens: 1500, source: "estimated", callCount: 0, lastUsed: null },
        ],
      },
    };
    expect(() => render(<McpServerBreakdown s={s} />)).not.toThrow();
  });

  it("byMcpServerが空でもoverhead.mcpServersに定義済みサーバーがあれば未使用として表示する", () => {
    const s: Summary = {
      ...minimalSummary,
      byMcpServer: [],
      overhead: {
        ...minimalSummary.overhead,
        mcpServers: [
          { name: "unused-server", toolCount: null, estimatedTokens: 1500, source: "estimated", callCount: 0, lastUsed: null },
        ],
      },
    };
    render(<McpServerBreakdown s={s} />);
    expect(screen.getByText("unused-server")).toBeInTheDocument();
    expect(screen.getByText("未使用")).toBeInTheDocument();
  });

  it("定義済みだがログにのみ存在するサーバー名の不一致でもクラッシュしない", () => {
    const s: Summary = {
      ...minimalSummary,
      byMcpServer: [
        { serverName: "log-only-server", calls: 3, sessions: 1, lastUsed: "2026-06-20T00:00:00.000Z" },
      ],
      overhead: {
        ...minimalSummary.overhead,
        mcpServers: [
          { name: "defined-only-server", toolCount: null, estimatedTokens: 1500, source: "estimated", callCount: 0, lastUsed: null },
        ],
      },
    };
    expect(() => render(<McpServerBreakdown s={s} />)).not.toThrow();
  });
});
