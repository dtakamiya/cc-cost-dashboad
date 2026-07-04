import { describe, it, expect } from "vitest";
import {
  buildRecommendations,
  calculateOverheadStatus,
  rankFilesByImpact,
  OVERHEAD_TOKEN_THRESHOLD,
  OVERHEAD_TARGET_TOKENS,
  OUTPUT_COST_RATIO_THRESHOLD,
  IDLE_REWRITE_COST_THRESHOLD,
  MODEL_SWITCH_REWRITE_COST_THRESHOLD,
  MCP_OVERHEAD_TOKEN_THRESHOLD,
} from "./advisor";
import { BLOAT_CONTEXT_THRESHOLD, BLOAT_MIN_MESSAGES, type Summary, type SessionCost } from "./api";

const session = (over: Partial<SessionCost>): SessionCost => ({
  sessionId: "s1",
  cwd: "/home/u/proj",
  cost: 0,
  tokens: 0,
  messages: 0,
  input: 0,
  output: 0,
  cacheCreate: 0,
  cacheRead: 0,
  firstTs: "2026-06-01T00:00:00.000Z",
  lastTs: "2026-06-01T01:00:00.000Z",
  avgContextPerMsg: 0,
  topModel: null,
  compactionCount: 0,
  ...over,
});

// 全ルールが「発火しない」中立な Summary（期間 = 30日）。各テストで必要箇所だけ上書きする。
const baseSummary = (over: Partial<Summary> = {}): Summary => ({
  generatedAt: "2026-06-30T00:00:00.000Z",
  totals: { cost: 100, tokens: 1_000_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-30" },
  tokenSplit: { input: 100_000, output: 100_000, cacheCreate: 100_000, cacheRead: 700_000 },
  costSplit: { input: 25, output: 25, cacheWrite: 25, cacheRead: 25 },
  models: [{ model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false }],
  daily: [],
  projects: [],
  drivers: {
    topModel: { model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false },
    topDay: null,
    topDayModel: null,
    cacheReadRatio: 0.7, // ≥ 0.5 → 発火しない
    outputCostRatio: 0.25, // ≤ 0.4 → 発火しない
  },
  sessionStats: { avgColdStartTokens: 2000, p90ColdStartTokens: 3000, coldStartCost: 10 },
  overhead: {
    claudeMd: null,
    atRefs: [],
    globalPlugins: [],
    personalSkills: [],
    projectPlugins: [],
    mcpServers: [],
    totalAlwaysTokens: 1000, // ≤ 3000 → 発火しない
    totalInvokeTokens: 0,
    totalEstimatedTokens: 1000,
  },
  warnings: { fallbackModels: [] },
  // 中立: 1hプレミアム無し・ROI黒字 → cache-ttl-premium ルールは発火しない
  cacheStats: {
    create1hTokens: 0,
    create5mTokens: 100_000,
    write1hCost: 0,
    write5mCost: 25,
    premium1h: 0,
    readSavings: 225, // costSplit.cacheRead(25) × 9
    writeCost: 25,
    roiNet: 200,
  },
  blocks: [],
  projection: null,
  activity: { matrix: [], max: 0, total: 0, peak: null },
  bySession: [],
  byTool: [],
  byMcpServer: [],
  ...over,
});

describe("buildRecommendations", () => {
  it("全ての推奨アイテムに shortTitle（空でない短縮見出し）が付与される", () => {
    const s = baseSummary({
      bySession: [
        session({
          sessionId: "big",
          messages: BLOAT_MIN_MESSAGES,
          avgContextPerMsg: BLOAT_CONTEXT_THRESHOLD + 1,
          cacheRead: 500_000,
        }),
      ],
    });
    const r = buildRecommendations(s);
    expect(r.items.length).toBeGreaterThan(0);
    for (const item of r.items) {
      expect(typeof item.shortTitle).toBe("string");
      expect(item.shortTitle.length).toBeGreaterThan(0);
    }
  });

  it("中立データでは推奨なし・節約0", () => {
    const r = buildRecommendations(baseSummary());
    expect(r.items).toEqual([]);
    expect(r.totalEstMonthlySavings).toBe(0);
    expect(r.periodDays).toBe(30);
  });

  it("肥大化セッションを検出し節約額を見積もる", () => {
    const s = baseSummary({
      bySession: [
        session({
          sessionId: "big",
          messages: BLOAT_MIN_MESSAGES,
          avgContextPerMsg: BLOAT_CONTEXT_THRESHOLD + 1,
          cacheRead: 500_000,
        }),
      ],
    });
    const r = buildRecommendations(s);
    const item = r.items.find((i) => i.id === "bloated-sessions");
    expect(item).toBeDefined();
    expect(item!.estMonthlySavings).toBeGreaterThan(0);
    // shortTitle: 件数付きの短縮見出し。既存の title（長文）は変更しない。
    expect(item!.shortTitle).toBe("セッションの肥大化（1件）");
    expect(item!.title).toBe("肥大化したセッションが文脈を再送している");
  });

  it("高単価モデル偏りは安価モデルが判明したときのみ発火", () => {
    // opus 90% 占有 + 安価な sonnet が存在
    const s = baseSummary({
      totals: { cost: 100, tokens: 1_000_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-30" },
      models: [
        { model: "claude-opus-4-8", cost: 90, tokens: 900_000, isFallback: false },
        { model: "claude-sonnet-4-6", cost: 3, tokens: 100_000, isFallback: false },
      ],
      drivers: {
        topModel: { model: "claude-opus-4-8", cost: 90, tokens: 900_000, isFallback: false },
        topDay: null,
        topDayModel: null,
        cacheReadRatio: 0.7,
        outputCostRatio: 0.25,
      },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "model-skew");
    expect(item).toBeDefined();
    expect(item!.estMonthlySavings).toBeGreaterThan(0);
  });

  it("安価モデルが無ければモデル偏りは発火しない", () => {
    const s = baseSummary({
      models: [{ model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false }],
      drivers: {
        topModel: { model: "claude-opus-4-8", cost: 100, tokens: 1_000_000, isFallback: false },
        topDay: null,
        topDayModel: null,
        cacheReadRatio: 0.7,
        outputCostRatio: 0.25,
      },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "model-skew");
    expect(item).toBeUndefined();
  });

  it("常時注入オーバーヘッド過大を検出", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        claudeMd: { label: "CLAUDE.md", bytes: 0, alwaysTokens: 5000, fullTokens: 5000, estimatedTokens: 5000 },
        totalAlwaysTokens: OVERHEAD_TOKEN_THRESHOLD + 2000,
      },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "overhead-baseline");
    expect(item).toBeDefined();
    expect(item!.estMonthlySavings).toBeGreaterThan(0);
  });

  it("output 比率過大を検出", () => {
    const s = baseSummary({
      drivers: { ...baseSummary().drivers, outputCostRatio: OUTPUT_COST_RATIO_THRESHOLD + 0.2 },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "output-heavy");
    expect(item).toBeDefined();
    expect(item!.estMonthlySavings).toBeGreaterThan(0);
  });

  it("低キャッシュ・未登録モデルは定性（節約0）で検出", () => {
    const s = baseSummary({
      drivers: { ...baseSummary().drivers, cacheReadRatio: 0.2 },
      warnings: { fallbackModels: ["mystery-model"] },
    });
    const r = buildRecommendations(s);
    expect(r.items.find((i) => i.id === "low-cache")?.estMonthlySavings).toBe(0);
    expect(r.items.find((i) => i.id === "fallback-pricing")?.estMonthlySavings).toBe(0);
  });

  it("1hプレミアムがROIを圧迫すると cache-ttl-premium が発火し節約額>0", () => {
    const s = baseSummary({
      totals: { cost: 100, tokens: 1_000_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-30" },
      cacheStats: {
        create1hTokens: 1_000_000,
        create5mTokens: 0,
        write1hCost: 10,
        write5mCost: 0,
        premium1h: 3.75, // 10 × 0.375
        readSavings: 1, // 回収できていない（roiNet < premium1h）
        writeCost: 10,
        roiNet: -9,
      },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "cache-ttl-premium");
    expect(item).toBeDefined();
    expect(item!.estMonthlySavings).toBeGreaterThan(0);
  });

  it("1hプレミアム0なら cache-ttl-premium は発火しない", () => {
    const item = buildRecommendations(baseSummary()).items.find((i) => i.id === "cache-ttl-premium");
    expect(item).toBeUndefined();
  });

  it("節約額の降順でソートされ合計が一致する", () => {
    const s = baseSummary({
      bySession: [
        session({ messages: BLOAT_MIN_MESSAGES, avgContextPerMsg: BLOAT_CONTEXT_THRESHOLD + 1, cacheRead: 500_000 }),
      ],
      drivers: { ...baseSummary().drivers, outputCostRatio: 0.6, cacheReadRatio: 0.2 },
    });
    const r = buildRecommendations(s);
    const savings = r.items.map((i) => i.estMonthlySavings);
    const sorted = [...savings].sort((a, b) => b - a);
    expect(savings).toEqual(sorted);
    expect(r.totalEstMonthlySavings).toBeCloseTo(savings.reduce((a, b) => a + b, 0), 6);
  });

  it("期間が短いほど月換算節約額が大きくなる", () => {
    const make = (from: string, to: string) =>
      baseSummary({
        totals: { cost: 100, tokens: 1_000_000, sessions: 5, messages: 50, from, to },
        drivers: { ...baseSummary().drivers, outputCostRatio: 0.6 },
      });
    const week = buildRecommendations(make("2026-06-24", "2026-06-30")).totalEstMonthlySavings;
    const month = buildRecommendations(make("2026-06-01", "2026-06-30")).totalEstMonthlySavings;
    expect(week).toBeGreaterThan(month);
  });

  it("500トークン超のファイルにファイル別オーバーヘッドアドバイスを出す", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        claudeMd: {
          label: "CLAUDE.md",
          bytes: 10000,
          alwaysTokens: 800, // > 500 → 要最適化
          fullTokens: 800,
          estimatedTokens: 800,
        },
        personalSkills: [
          { label: "heavy-skill", bytes: 5000, alwaysTokens: 600, fullTokens: 1200, estimatedTokens: 600 },
        ],
        totalAlwaysTokens: 1400, // < 3000 → ルール3（旧）は発火しないが個別ルールは発火
      },
    });
    const r = buildRecommendations(s);
    const fileItems = r.items.filter((i) => i.id.startsWith("overhead-file:"));
    expect(fileItems.length).toBeGreaterThan(0);
    fileItems.forEach((item) => {
      expect(item.estMonthlySavings).toBeGreaterThanOrEqual(0);
      expect(item.detail).toMatch(/トークン/);
    });
  });

  const premiumSummary = () =>
    baseSummary({
      totals: { cost: 100, tokens: 1_000_000, sessions: 5, messages: 50, from: "2026-06-01", to: "2026-06-30" },
      cacheStats: {
        create1hTokens: 1_000_000,
        create5mTokens: 0,
        write1hCost: 10,
        write5mCost: 0,
        premium1h: 3.75,
        readSavings: 1,
        writeCost: 10,
        roiNet: -9,
      },
    });

  it("billingMode省略時はapiとして扱われ、既存のcache-ttl-premiumが発火する", () => {
    const item = buildRecommendations(premiumSummary()).items.find((i) => i.id === "cache-ttl-premium");
    expect(item).toBeDefined();
  });

  it("billingMode='api'を明示してもcache-ttl-premiumは従来通り発火する", () => {
    const item = buildRecommendations(premiumSummary(), "api").items.find((i) => i.id === "cache-ttl-premium");
    expect(item).toBeDefined();
  });

  it("billingMode='subscription'のときcache-ttl-premiumは抑制される", () => {
    const item = buildRecommendations(premiumSummary(), "subscription").items.find(
      (i) => i.id === "cache-ttl-premium"
    );
    expect(item).toBeUndefined();
  });

  it("billingMode='subscription'でも他のルール（bloated-sessions等）は通常通り発火する", () => {
    const s = {
      ...premiumSummary(),
      bySession: [
        session({
          sessionId: "big",
          messages: BLOAT_MIN_MESSAGES,
          avgContextPerMsg: BLOAT_CONTEXT_THRESHOLD + 1,
          cacheRead: 500_000,
        }),
      ],
    };
    const item = buildRecommendations(s, "subscription").items.find((i) => i.id === "bloated-sessions");
    expect(item).toBeDefined();
  });

describe("buildRecommendations - frequent-compaction", () => {
  it("compactionCount が閾値(3)以上のセッションがあれば frequent-compaction 推奨を出す", () => {
    const s = baseSummary({
      bySession: [session({ sessionId: "compacted", compactionCount: 3 })],
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "frequent-compaction");
    expect(item).toBeDefined();
    expect(item!.priority).toBe("medium");
  });

  it("compactionCount が閾値未満なら frequent-compaction は発火しない", () => {
    const s = baseSummary({
      bySession: [session({ sessionId: "ok", compactionCount: 2 })],
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "frequent-compaction");
    expect(item).toBeUndefined();
  });

  it("該当セッションが無ければ frequent-compaction は発火しない", () => {
    const item = buildRecommendations(baseSummary()).items.find((i) => i.id === "frequent-compaction");
    expect(item).toBeUndefined();
  });
});

describe("buildRecommendations - idle-cache-expiry", () => {
  it("cacheGapStats が未提供のとき idle-cache-expiry は生成されない", () => {
    const s = baseSummary({ cacheGapStats: undefined });
    const item = buildRecommendations(s).items.find((i) => i.id === "idle-cache-expiry");
    expect(item).toBeUndefined();
  });

  it("reWriteCost が閾値以下のとき idle-cache-expiry は生成されない", () => {
    const s = baseSummary({
      cacheGapStats: {
        expiredGapCount: 1,
        reWriteTokens: 10,
        reWriteCost: IDLE_REWRITE_COST_THRESHOLD,
        affectedSessions: ["s1"],
      },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "idle-cache-expiry");
    expect(item).toBeUndefined();
  });

  it("reWriteCost が閾値超のとき idle-cache-expiry が medium priority で生成され、estMonthlySavings が月換算される", () => {
    const s = baseSummary({
      totals: { cost: 100, tokens: 1_000_000, sessions: 5, messages: 50, from: "2026-06-24", to: "2026-06-30" },
      cacheGapStats: {
        expiredGapCount: 5,
        reWriteTokens: 50_000,
        reWriteCost: IDLE_REWRITE_COST_THRESHOLD + 1,
        affectedSessions: ["s1", "s2"],
      },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "idle-cache-expiry");
    expect(item).toBeDefined();
    expect(item!.priority).toBe("medium");
    const periodDays = 7;
    const monthlyFactor = 30 / periodDays;
    expect(item!.estMonthlySavings).toBeCloseTo(
      (IDLE_REWRITE_COST_THRESHOLD + 1) * monthlyFactor,
      6
    );
  });

  it("billingMode='subscription' のとき idle-cache-expiry は除外される", () => {
    const s = baseSummary({
      cacheGapStats: {
        expiredGapCount: 5,
        reWriteTokens: 50_000,
        reWriteCost: IDLE_REWRITE_COST_THRESHOLD + 1,
        affectedSessions: ["s1"],
      },
    });
    const item = buildRecommendations(s, "subscription").items.find((i) => i.id === "idle-cache-expiry");
    expect(item).toBeUndefined();
  });
});

describe("buildRecommendations - model-switch-cost", () => {
  it("modelSwitch.reCreateCost が閾値超のとき model-switch-cost が medium priority で生成される", () => {
    const s = baseSummary({
      modelSwitch: {
        switchCount: 3,
        reCreateTokens: 50_000,
        reCreateCost: MODEL_SWITCH_REWRITE_COST_THRESHOLD + 1,
        affectedSessions: ["s1", "s2"],
      },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "model-switch-cost");
    expect(item).toBeDefined();
    expect(item!.priority).toBe("medium");
  });

  it("modelSwitch.reCreateCost が閾値以下のとき model-switch-cost は生成されない", () => {
    const s = baseSummary({
      modelSwitch: {
        switchCount: 3,
        reCreateTokens: 10,
        reCreateCost: MODEL_SWITCH_REWRITE_COST_THRESHOLD,
        affectedSessions: ["s1"],
      },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "model-switch-cost");
    expect(item).toBeUndefined();
  });

  it("billingMode='subscription' のとき model-switch-cost は除外される", () => {
    const s = baseSummary({
      modelSwitch: {
        switchCount: 3,
        reCreateTokens: 50_000,
        reCreateCost: MODEL_SWITCH_REWRITE_COST_THRESHOLD + 1,
        affectedSessions: ["s1"],
      },
    });
    const item = buildRecommendations(s, "subscription").items.find((i) => i.id === "model-switch-cost");
    expect(item).toBeUndefined();
  });
});

describe("buildRecommendations - mcp-overhead", () => {
  it("MCPサーバ推定トークン合計が閾値超のとき mcp-overhead 推奨を出す", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        mcpServers: [
          { name: "github", toolCount: null, estimatedTokens: MCP_OVERHEAD_TOKEN_THRESHOLD + 1, source: "estimated" },
        ],
      },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "mcp-overhead");
    expect(item).toBeDefined();
    expect(item!.priority).toBe("medium");
    expect(item!.estMonthlySavings).toBeGreaterThan(0);
  });

  it("MCP未設定（空配列）のとき mcp-overhead は発火しない", () => {
    const item = buildRecommendations(baseSummary()).items.find((i) => i.id === "mcp-overhead");
    expect(item).toBeUndefined();
  });

  it("MCPサーバ推定トークン合計が閾値以下のとき mcp-overhead は発火しない", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        mcpServers: [
          { name: "github", toolCount: null, estimatedTokens: MCP_OVERHEAD_TOKEN_THRESHOLD, source: "estimated" },
        ],
      },
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "mcp-overhead");
    expect(item).toBeUndefined();
  });

  it("estimatedTokensがnull（unknown）のサーバはnull扱いされクラッシュしない", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        mcpServers: [
          { name: "unknown-server", toolCount: null, estimatedTokens: null, source: "unknown" },
        ],
      },
    });
    expect(() => buildRecommendations(s)).not.toThrow();
    const item = buildRecommendations(s).items.find((i) => i.id === "mcp-overhead");
    expect(item).toBeUndefined();
  });
});

describe("calculateOverheadStatus", () => {
  it("現在値が目標以下なら good を返す", () => {
    const result = calculateOverheadStatus(1000, 1500);
    expect(result.status).toBe("good");
    expect(result.color).toBe("var(--success)");
    expect(result.current).toBe(1000);
    expect(result.target).toBe(1500);
    expect(result.percentage).toBeCloseTo((1000 / 1500) * 100, 5);
  });

  it("現在値が目標超かつ3000以下なら caution を返す", () => {
    const result = calculateOverheadStatus(2000, 1500);
    expect(result.status).toBe("caution");
    expect(result.color).toBe("var(--warn)");
  });

  it("現在値が3000超なら warn を返す", () => {
    const result = calculateOverheadStatus(3500, 1500);
    expect(result.status).toBe("warn");
    expect(result.color).toBe("var(--danger)");
  });

  it("目標値が0の場合はpercentageを0にする", () => {
    const result = calculateOverheadStatus(1000, 0);
    expect(result.percentage).toBe(0);
  });

  it("現在値が0なら good を返す", () => {
    const result = calculateOverheadStatus(0, 1500);
    expect(result.status).toBe("good");
    expect(result.percentage).toBe(0);
  });

  it("デフォルト target は OVERHEAD_TARGET_TOKENS", () => {
    const result = calculateOverheadStatus(1000);
    expect(result.target).toBe(OVERHEAD_TARGET_TOKENS);
  });
});

describe("rankFilesByImpact", () => {
  it("monthlySavings 降順でランク付けされる", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        claudeMd: {
          label: "CLAUDE.md",
          bytes: 1000,
          alwaysTokens: 500,
          fullTokens: 500,
          estimatedTokens: 500,
        },
        personalSkills: [
          { label: "big-skill", bytes: 5000, alwaysTokens: 800, fullTokens: 1200, estimatedTokens: 800 },
          { label: "small-skill", bytes: 500, alwaysTokens: 100, fullTokens: 200, estimatedTokens: 100 },
        ],
        totalAlwaysTokens: 1400,
      },
    });
    const impacts = rankFilesByImpact(s, 0.001, 5, 1);
    // monthlySavings降順ならbig-skillが先
    expect(impacts[0].alwaysTokens).toBeGreaterThanOrEqual(impacts[1].alwaysTokens);
    // rank は 1-based
    expect(impacts[0].rank).toBe(1);
    expect(impacts[1].rank).toBe(2);
  });

  it("月間削減見積もり = alwaysTokens × cacheCreateRate × sessionFactor × monthlyFactor", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        claudeMd: {
          label: "CLAUDE.md",
          bytes: 1000,
          alwaysTokens: 400,
          fullTokens: 400,
          estimatedTokens: 400,
        },
        totalAlwaysTokens: 400,
      },
    });
    const rate = 0.002;
    const sessions = 10;
    const factor = 1.5;
    const impacts = rankFilesByImpact(s, rate, sessions, factor);
    const expected = 400 * rate * sessions * factor;
    expect(impacts[0].monthlySavings).toBeCloseTo(expected, 6);
  });

  it("@ref, plugin, skill を含む複数タイプを集計してランク付けする", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        atRefs: [{ label: "ref1", bytes: 200, alwaysTokens: 300, fullTokens: 300, estimatedTokens: 300 }],
        globalPlugins: [
          {
            name: "my-plugin",
            totalBytes: 100,
            totalAlwaysTokens: 200,
            totalFullTokens: 400,
            totalEstimatedTokens: 200,
            files: [{ label: "main.md", bytes: 100, alwaysTokens: 200, fullTokens: 400, estimatedTokens: 200 }],
          },
        ],
        personalSkills: [
          { label: "my-skill", bytes: 500, alwaysTokens: 250, fullTokens: 500, estimatedTokens: 250 },
        ],
        totalAlwaysTokens: 750,
      },
    });
    const impacts = rankFilesByImpact(s, 0.001, 5, 1);
    expect(impacts.length).toBe(3);
    // label が含まれることを確認
    const labels = impacts.map((i) => i.label);
    expect(labels.some((l) => l.includes("ref1"))).toBe(true);
    expect(labels.some((l) => l.includes("my-plugin"))).toBe(true);
    expect(labels.some((l) => l.includes("my-skill"))).toBe(true);
  });

  it("source メタデータが正しく設定される（plugin の / エスケープテスト）", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        claudeMd: {
          label: "CLAUDE.md",
          bytes: 1000,
          alwaysTokens: 100,
          fullTokens: 100,
          estimatedTokens: 100,
        },
        atRefs: [{ label: "path/to/ref", bytes: 200, alwaysTokens: 150, fullTokens: 150, estimatedTokens: 150 }],
        globalPlugins: [
          {
            name: "plugin-with/slash",
            totalBytes: 100,
            totalAlwaysTokens: 200,
            totalFullTokens: 200,
            totalEstimatedTokens: 200,
            files: [
              { label: "file/with/slash", bytes: 100, alwaysTokens: 200, fullTokens: 200, estimatedTokens: 200 },
            ],
          },
        ],
        personalSkills: [
          { label: "skill/name", bytes: 500, alwaysTokens: 250, fullTokens: 500, estimatedTokens: 250 },
        ],
        totalAlwaysTokens: 700,
      },
    });
    const impacts = rankFilesByImpact(s, 0.001, 5, 1);
    // source フィールドの構造を確認
    const claudeMdImpact = impacts.find((i) => i.source.kind === "claudeMd");
    expect(claudeMdImpact).toBeDefined();
    expect(claudeMdImpact?.source.kind).toBe("claudeMd");

    const atRefImpact = impacts.find((i) => i.source.kind === "atRef");
    expect(atRefImpact).toBeDefined();
    expect(atRefImpact?.source.kind).toBe("atRef");
    expect((atRefImpact?.source as any).label).toBe("path/to/ref");

    const pluginImpact = impacts.find((i) => i.source.kind === "plugin");
    expect(pluginImpact).toBeDefined();
    expect(pluginImpact?.source.kind).toBe("plugin");
    expect((pluginImpact?.source as any).pluginName).toBe("plugin-with/slash");
    expect((pluginImpact?.source as any).label).toBe("file/with/slash");

    const skillImpact = impacts.find((i) => i.source.kind === "skill");
    expect(skillImpact).toBeDefined();
    expect(skillImpact?.source.kind).toBe("skill");
    expect((skillImpact?.source as any).label).toBe("skill/name");
  });
});

  it("200トークン以下のファイルはファイル別アドバイスを出さない", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        claudeMd: {
          label: "CLAUDE.md",
          bytes: 500,
          alwaysTokens: 150, // <= 200 → 良好
          fullTokens: 150,
          estimatedTokens: 150,
        },
        totalAlwaysTokens: 150,
      },
    });
    const r = buildRecommendations(s);
    const fileItems = r.items.filter((i) => i.id.startsWith("overhead-file:"));
    expect(fileItems.length).toBe(0);
  });

  it("500トークン超のファイルは最適化アドバイスを出す", () => {
    const s = baseSummary({
      overhead: {
        ...baseSummary().overhead,
        claudeMd: {
          label: "CLAUDE.md",
          bytes: 5000,
          alwaysTokens: 687, // > 500 → 要最適化
          fullTokens: 687,
          estimatedTokens: 687,
        },
        totalAlwaysTokens: 687,
      },
    });
    const r = buildRecommendations(s);
    const fileItems = r.items.filter((i) => i.id.startsWith("overhead-file:"));
    expect(fileItems.length).toBeGreaterThan(0);
    expect(fileItems[0].title).toContain("687");
    expect(fileItems[0].detail).toContain("毎セッション冒頭");
  });
});

describe("diff-output-advice", () => {
  it("出力比率が高い上位セッションが存在する場合にdiff出力アドバイスを提示する", () => {
    const s = baseSummary({
      bySession: [
        session({
          sessionId: "output-heavy-1",
          cwd: "/home/u/projX",
          cost: 10,
          output: 900,
          input: 100,
          cacheCreate: 0,
          cacheRead: 0,
        }),
      ],
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "diff-output-advice");
    expect(item).toBeDefined();
    expect(item!.detail).toContain("projX");
    expect(item!.action).toContain("diff");
  });

  it("該当セッションが無い場合はRecommendationを生成しない", () => {
    const s = baseSummary({
      bySession: [
        session({
          sessionId: "balanced",
          cost: 10,
          output: 100,
          input: 900,
          cacheCreate: 0,
          cacheRead: 0,
        }),
      ],
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "diff-output-advice");
    expect(item).toBeUndefined();
  });

  it("出力トークンが全セッションでゼロの場合にゼロ除算エラーやNaNのestMonthlySavingsを出さない", () => {
    const s = baseSummary({
      bySession: [
        session({ sessionId: "zero-1", cost: 0, output: 0, input: 0, cacheCreate: 0, cacheRead: 0 }),
      ],
    });
    const r = buildRecommendations(s);
    const item = r.items.find((i) => i.id === "diff-output-advice");
    expect(item).toBeUndefined();
    for (const it of r.items) {
      expect(Number.isNaN(it.estMonthlySavings)).toBe(false);
    }
  });

  it("推定月間節約額が正の値であること", () => {
    const s = baseSummary({
      bySession: [
        session({
          sessionId: "output-heavy-2",
          cwd: "/home/u/projY",
          cost: 20,
          output: 900,
          input: 100,
          cacheCreate: 0,
          cacheRead: 0,
        }),
      ],
    });
    const item = buildRecommendations(s).items.find((i) => i.id === "diff-output-advice");
    expect(item).toBeDefined();
    expect(item!.estMonthlySavings).toBeGreaterThan(0);
  });

  it("既存のoutput-heavyルールと同時に出ても両方独立して存在すること（idの重複がない）", () => {
    const s = baseSummary({
      drivers: { ...baseSummary().drivers, outputCostRatio: OUTPUT_COST_RATIO_THRESHOLD + 0.2 },
      bySession: [
        session({
          sessionId: "output-heavy-3",
          cwd: "/home/u/projZ",
          cost: 15,
          output: 900,
          input: 100,
          cacheCreate: 0,
          cacheRead: 0,
        }),
      ],
    });
    const r = buildRecommendations(s);
    const outputHeavy = r.items.find((i) => i.id === "output-heavy");
    const diffAdvice = r.items.find((i) => i.id === "diff-output-advice");
    expect(outputHeavy).toBeDefined();
    expect(diffAdvice).toBeDefined();
    const ids = r.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildRecommendations - thinking（推論）トークン比率", () => {
  it("thinking.outputShareが閾値超のとき、MAX_THINKING_TOKENS等を促す提案が出る", () => {
    const s = baseSummary({
      thinking: { approxTokens: 60_000, outputShare: 0.6, isApprox: true, hasAnyThinking: true },
    });
    const r = buildRecommendations(s);
    const item = r.items.find((i) => i.id === "thinking-heavy");
    expect(item).toBeDefined();
    expect(item?.action).toMatch(/MAX_THINKING_TOKENS/);
  });

  it("thinking.outputShareが閾値以下のとき、提案は出ない", () => {
    const s = baseSummary({
      thinking: { approxTokens: 10_000, outputShare: 0.3, isApprox: true, hasAnyThinking: true },
    });
    const r = buildRecommendations(s);
    expect(r.items.find((i) => i.id === "thinking-heavy")).toBeUndefined();
  });

  it("thinkingデータが無い場合、提案は出ない", () => {
    const r = buildRecommendations(baseSummary());
    expect(r.items.find((i) => i.id === "thinking-heavy")).toBeUndefined();
  });

  it("hasAnyThinkingがfalseの場合、outputShareが閾値超でも提案は出ない（防御的チェック）", () => {
    const s = baseSummary({
      thinking: { approxTokens: 0, outputShare: 0, isApprox: true, hasAnyThinking: false },
    });
    const r = buildRecommendations(s);
    expect(r.items.find((i) => i.id === "thinking-heavy")).toBeUndefined();
  });
});

describe("buildRecommendations - tool-result-bloat", () => {
  it("tool_result肥大セッションが存在する場合、subagent委譲を促す提案が出る", () => {
    const s = baseSummary({
      bySession: [session({ toolResultTokensApprox: 60_000 })],
    });
    const r = buildRecommendations(s);
    const item = r.items.find((i) => i.id === "tool-result-bloat");
    expect(item).toBeDefined();
    expect(item?.priority).toBe("medium");
    expect(item?.action).toMatch(/subagent|Explore/);
  });

  it("肥大セッションが存在しない場合、提案は出ない", () => {
    const s = baseSummary({
      bySession: [session({ toolResultTokensApprox: 100 })],
    });
    const r = buildRecommendations(s);
    expect(r.items.find((i) => i.id === "tool-result-bloat")).toBeUndefined();
  });

  it("bySessionが空の場合、提案は出ない", () => {
    const r = buildRecommendations(baseSummary({ bySession: [] }));
    expect(r.items.find((i) => i.id === "tool-result-bloat")).toBeUndefined();
  });

  it("toolResultTokensApproxが未定義のセッションのみの場合、提案は出ない（後方互換）", () => {
    const s = baseSummary({ bySession: [session({})] });
    const r = buildRecommendations(s);
    expect(r.items.find((i) => i.id === "tool-result-bloat")).toBeUndefined();
  });
});

describe("buildRecommendations - proactive-compact-threshold", () => {
  it("cacheRead + input が250kを超えるセッションがあれば proactive-compact-threshold 推奨を出す", () => {
    const s = baseSummary({
      bySession: [session({ sessionId: "big-input", cacheRead: 200_000, input: 60_000 })],
    });
    const r = buildRecommendations(s);
    const item = r.items.find((i) => i.id === "proactive-compact-threshold");
    expect(item).toBeDefined();
    expect(item!.priority).toBe("medium");
  });

  it("cacheRead + input が250k未満のセッションのみの場合は発火しない", () => {
    const s = baseSummary({
      bySession: [session({ sessionId: "small-input", cacheRead: 100_000, input: 50_000 })],
    });
    const r = buildRecommendations(s);
    expect(r.items.find((i) => i.id === "proactive-compact-threshold")).toBeUndefined();
  });

  it("中立な baseSummary() に対して誤発火しない", () => {
    const r = buildRecommendations(baseSummary());
    expect(r.items.find((i) => i.id === "proactive-compact-threshold")).toBeUndefined();
  });
});

describe("buildRecommendations - tool-output-cap", () => {
  it("toolResultOutliers.overCountが正のとき、MAX_MCP_OUTPUT_TOKENS/BASH_MAX_OUTPUT_LENGTHのアクションを提示する", () => {
    const s = baseSummary({
      toolResultOutliers: {
        overCount: 2,
        maxTokensApprox: 12_000,
        totalOverTokensApprox: 20_000,
        byTool: [{ toolName: "Bash", overCount: 2, maxTokensApprox: 12_000 }],
        sampleSessions: [{ sessionId: "s1", toolName: "Bash", tokensApprox: 12_000 }],
        isApprox: true,
      },
    });
    const r = buildRecommendations(s);
    const item = r.items.find((i) => i.id === "tool-output-cap");
    expect(item).toBeDefined();
    expect(item?.action).toMatch(/MAX_MCP_OUTPUT_TOKENS/);
    expect(item?.action).toMatch(/BASH_MAX_OUTPUT_LENGTH/);
  });

  it("toolResultOutliersが未指定のとき、tool-output-capは出ない", () => {
    const r = buildRecommendations(baseSummary({ toolResultOutliers: undefined }));
    expect(r.items.find((i) => i.id === "tool-output-cap")).toBeUndefined();
  });

  it("toolResultOutliers.overCountが0のとき、tool-output-capは出ない", () => {
    const s = baseSummary({
      toolResultOutliers: {
        overCount: 0,
        maxTokensApprox: 0,
        totalOverTokensApprox: 0,
        byTool: [],
        sampleSessions: [],
        isApprox: true,
      },
    });
    const r = buildRecommendations(s);
    expect(r.items.find((i) => i.id === "tool-output-cap")).toBeUndefined();
  });

  it("tool-result-bloatとtool-output-capの両方が発火する場合、idが重複せず両方存在する", () => {
    const s = baseSummary({
      bySession: [session({ toolResultTokensApprox: 60_000 })],
      toolResultOutliers: {
        overCount: 1,
        maxTokensApprox: 9_000,
        totalOverTokensApprox: 9_000,
        byTool: [{ toolName: "mcp__foo", overCount: 1, maxTokensApprox: 9_000 }],
        sampleSessions: [{ sessionId: "s1", toolName: "mcp__foo", tokensApprox: 9_000 }],
        isApprox: true,
      },
    });
    const r = buildRecommendations(s);
    const ids = r.items.map((i) => i.id);
    expect(ids.filter((id) => id === "tool-result-bloat")).toHaveLength(1);
    expect(ids.filter((id) => id === "tool-output-cap")).toHaveLength(1);
  });
});
