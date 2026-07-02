import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

// 外部依存をすべてモック
vi.mock("./parser.js", () => ({
  loadRecords: vi.fn().mockResolvedValue({ records: [], fileCount: 0 }),
}));

vi.mock("./aggregate.js", () => ({
  aggregate: vi.fn().mockReturnValue({
    generatedAt: "2026-01-01T00:00:00.000Z",
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
      projectPlugins: [], mcpServers: [],
      totalAlwaysTokens: 0, totalInvokeTokens: 0, totalEstimatedTokens: 0,
    },
    warnings: { fallbackModels: [] },
    blocks: [],
    projection: null,
    activity: { matrix: [], max: 0, total: 0, peak: null },
    bySession: [],
    hourly: Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      tokens: 0,
      cost: 0,
      models: [],
    })),
  }),
}));

vi.mock("./analyze.js", () => ({
  analyzeOverhead: vi.fn().mockReturnValue({
    claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [],
    projectPlugins: [], mcpServers: [],
    totalAlwaysTokens: 0, totalInvokeTokens: 0, totalEstimatedTokens: 0,
  }),
}));

vi.mock("./pricing.js", () => ({
  PRICING: {},
  CACHE_WRITE_5M_MULTIPLIER: 1.25,
  CACHE_WRITE_1H_MULTIPLIER: 2,
  CACHE_READ_MULTIPLIER: 0.1,
  costOf: vi.fn().mockReturnValue({ total: 0.001, input: 0, output: 0.001, cacheWrite: 0, cacheRead: 0, isFallback: false }),
}));

let app;

beforeEach(async () => {
  vi.resetModules();
  // モックも再登録が必要
  vi.mock("./parser.js", () => ({
    loadRecords: vi.fn().mockResolvedValue({ records: [], fileCount: 0 }),
  }));
  vi.mock("./aggregate.js", () => ({
    aggregate: vi.fn().mockReturnValue({
      generatedAt: "2026-01-01T00:00:00.000Z",
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
        projectPlugins: [], mcpServers: [],
        totalAlwaysTokens: 0, totalInvokeTokens: 0, totalEstimatedTokens: 0,
      },
      warnings: { fallbackModels: [] },
      blocks: [],
      projection: null,
      activity: { matrix: [], max: 0, total: 0, peak: null },
      bySession: [],
      hourly: Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        tokens: 0,
        cost: 0,
        models: [],
      })),
    }),
  }));
  vi.mock("./analyze.js", () => ({
    analyzeOverhead: vi.fn().mockReturnValue({
      claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [],
      projectPlugins: [], mcpServers: [],
      totalAlwaysTokens: 0, totalInvokeTokens: 0, totalEstimatedTokens: 0,
    }),
  }));
  vi.mock("./pricing.js", () => ({
    PRICING: {},
    CACHE_WRITE_5M_MULTIPLIER: 1.25,
    CACHE_WRITE_1H_MULTIPLIER: 2,
    CACHE_READ_MULTIPLIER: 0.1,
    costOf: vi.fn().mockReturnValue({ total: 0.001, input: 0, output: 0.001, cacheWrite: 0, cacheRead: 0, isFallback: false }),
  }));

  const mod = await import("./index.js");
  app = mod.app;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("rebuild() - 解析品質メタデータ", () => {
  it("rebuild() が parser からの品質メタを source に含めるか", async () => {
    // Arrange
    const { loadRecords } = await import("./parser.js");
    vi.mocked(loadRecords).mockResolvedValueOnce({
      records: [],
      fileCount: 3,
      parsedLines: 100,
      parseErrors: 5,
      skippedLines: 10,
      unreadableFiles: 2,
    });

    // Act: POST /api/reload で rebuild() を実行
    const res = await request(app).post("/api/reload");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.source).toMatchObject({
      fileCount: 3,
      parsedLines: 100,
      parseErrors: 5,
      skippedLines: 10,
      unreadableFiles: 2,
    });
  });

  it("/api/summary が source.parsedLines, source.parseErrors を返すか", async () => {
    // Arrange
    const { loadRecords } = await import("./parser.js");
    vi.mocked(loadRecords).mockResolvedValueOnce({
      records: [],
      fileCount: 5,
      parsedLines: 200,
      parseErrors: 3,
      skippedLines: 7,
      unreadableFiles: 1,
    });

    // Act
    const res = await request(app).get("/api/summary");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.source).toHaveProperty("parsedLines", 200);
    expect(res.body.source).toHaveProperty("parseErrors", 3);
    expect(res.body.source).toHaveProperty("skippedLines", 7);
    expect(res.body.source).toHaveProperty("unreadableFiles", 1);
  });
});

describe("GET /api/summary", () => {
  it("200 と JSON を返す", async () => {
    const res = await request(app).get("/api/summary");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("generatedAt");
  });

  it("初回呼び出し時 rebuild() が実行されてキャッシュが生成される", async () => {
    // Arrange: モックは beforeEach でデフォルト値に設定済み
    const { loadRecords } = await import("./parser.js");
    const { aggregate } = await import("./aggregate.js");

    // Act
    const res = await request(app).get("/api/summary");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("generatedAt");
    expect(res.body).toHaveProperty("totals");
    expect(res.body).toHaveProperty("tokenSplit");
    expect(res.body).toHaveProperty("costSplit");
    expect(vi.mocked(loadRecords)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(aggregate)).toHaveBeenCalledTimes(1);
  });

  it("同じキャッシュから連続で /api/summary を呼び出すと generatedAt が同じ", async () => {
    // Arrange
    const { loadRecords } = await import("./parser.js");
    const { aggregate } = await import("./aggregate.js");
    vi.mocked(aggregate).mockReturnValue({
      generatedAt: "2026-06-28T10:00:00.000Z",
      totals: { cost: 0, tokens: 0, sessions: 0, messages: 0, from: null, to: null },
      tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
      models: [], daily: [], projects: [],
      drivers: { topModel: null, topDay: null, topDayModel: null, cacheReadRatio: 0, outputCostRatio: 0 },
      sessionStats: { avgColdStartTokens: 0, p90ColdStartTokens: 0, coldStartCost: 0 },
      overhead: { claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [], projectPlugins: [], mcpServers: [], totalAlwaysTokens: 0, totalInvokeTokens: 0, totalEstimatedTokens: 0 },
      warnings: { fallbackModels: [] },
      blocks: [], projection: null,
      activity: { matrix: [], max: 0, total: 0, peak: null },
      bySession: [],
    });

    // Act
    const res1 = await request(app).get("/api/summary");
    const res2 = await request(app).get("/api/summary");

    // Assert
    expect(res1.body.generatedAt).toBe("2026-06-28T10:00:00.000Z");
    expect(res2.body.generatedAt).toBe("2026-06-28T10:00:00.000Z");
    // キャッシュ効果: loadRecords は1回のみ
    expect(vi.mocked(loadRecords)).toHaveBeenCalledTimes(1);
  });

  it("キャッシュから返却したレスポンスは完全に同じ値", async () => {
    // Act
    const res1 = await request(app).get("/api/summary");
    const res2 = await request(app).get("/api/summary");

    // Assert
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body).toEqual(res2.body);
  });
});

describe("POST /api/reload", () => {
  it("200 と再集計した JSON を返す", async () => {
    const res = await request(app).post("/api/reload");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("generatedAt");
  });

  it("reload 前後で generatedAt が異なる（キャッシュが更新される）", async () => {
    // Arrange: 1回目の generatedAt
    const { loadRecords } = await import("./parser.js");
    const { aggregate } = await import("./aggregate.js");
    vi.mocked(aggregate).mockReturnValue({
      generatedAt: "2026-06-28T10:00:00.000Z",
      totals: { cost: 0, tokens: 0, sessions: 0, messages: 0, from: null, to: null },
      tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
      models: [], daily: [], projects: [],
      drivers: { topModel: null, topDay: null, topDayModel: null, cacheReadRatio: 0, outputCostRatio: 0 },
      sessionStats: { avgColdStartTokens: 0, p90ColdStartTokens: 0, coldStartCost: 0 },
      overhead: { claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [], projectPlugins: [], mcpServers: [], totalAlwaysTokens: 0, totalInvokeTokens: 0, totalEstimatedTokens: 0 },
      warnings: { fallbackModels: [] },
      blocks: [], projection: null,
      activity: { matrix: [], max: 0, total: 0, peak: null },
      bySession: [],
    });

    // Act: 1回目
    const res1 = await request(app).get("/api/summary");

    // Arrange: 2回目用に generatedAt を更新
    vi.mocked(aggregate).mockReturnValue({
      generatedAt: "2026-06-28T10:01:00.000Z",
      totals: { cost: 0, tokens: 0, sessions: 0, messages: 0, from: null, to: null },
      tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
      models: [], daily: [], projects: [],
      drivers: { topModel: null, topDay: null, topDayModel: null, cacheReadRatio: 0, outputCostRatio: 0 },
      sessionStats: { avgColdStartTokens: 0, p90ColdStartTokens: 0, coldStartCost: 0 },
      overhead: { claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [], projectPlugins: [], mcpServers: [], totalAlwaysTokens: 0, totalInvokeTokens: 0, totalEstimatedTokens: 0 },
      warnings: { fallbackModels: [] },
      blocks: [], projection: null,
      activity: { matrix: [], max: 0, total: 0, peak: null },
      bySession: [],
    });
    await request(app).post("/api/reload");
    expect(vi.mocked(loadRecords)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(aggregate)).toHaveBeenCalledTimes(2);

    // Act: 2回目
    const res2 = await request(app).get("/api/summary");

    // Assert
    expect(res1.body.generatedAt).toBe("2026-06-28T10:00:00.000Z");
    expect(res2.body.generatedAt).toBe("2026-06-28T10:01:00.000Z");
    expect(res1.body.generatedAt).not.toBe(res2.body.generatedAt);
  });

  it("reload 後の /api/summary は新しい totals.cost を返す", async () => {
    // Arrange: 初期 cost
    const { loadRecords } = await import("./parser.js");
    const { aggregate } = await import("./aggregate.js");
    vi.mocked(aggregate).mockReturnValue({
      generatedAt: "2026-06-28T10:00:00.000Z",
      totals: { cost: 10.0, tokens: 0, sessions: 0, messages: 0, from: null, to: null },
      tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
      models: [], daily: [], projects: [],
      drivers: { topModel: null, topDay: null, topDayModel: null, cacheReadRatio: 0, outputCostRatio: 0 },
      sessionStats: { avgColdStartTokens: 0, p90ColdStartTokens: 0, coldStartCost: 0 },
      overhead: { claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [], projectPlugins: [], mcpServers: [], totalAlwaysTokens: 0, totalInvokeTokens: 0, totalEstimatedTokens: 0 },
      warnings: { fallbackModels: [] },
      blocks: [], projection: null,
      activity: { matrix: [], max: 0, total: 0, peak: null },
      bySession: [],
    });

    // Act: 初回
    const res1 = await request(app).get("/api/summary");
    expect(res1.body.totals.cost).toBe(10.0);

    // Arrange: cost を変更
    vi.mocked(aggregate).mockReturnValue({
      generatedAt: "2026-06-28T10:01:00.000Z",
      totals: { cost: 20.0, tokens: 0, sessions: 0, messages: 0, from: null, to: null },
      tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      costSplit: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
      models: [], daily: [], projects: [],
      drivers: { topModel: null, topDay: null, topDayModel: null, cacheReadRatio: 0, outputCostRatio: 0 },
      sessionStats: { avgColdStartTokens: 0, p90ColdStartTokens: 0, coldStartCost: 0 },
      overhead: { claudeMd: null, atRefs: [], globalPlugins: [], personalSkills: [], projectPlugins: [], mcpServers: [], totalAlwaysTokens: 0, totalInvokeTokens: 0, totalEstimatedTokens: 0 },
      warnings: { fallbackModels: [] },
      blocks: [], projection: null,
      activity: { matrix: [], max: 0, total: 0, peak: null },
      bySession: [],
    });
    await request(app).post("/api/reload");
    expect(vi.mocked(loadRecords)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(aggregate)).toHaveBeenCalledTimes(2);

    // Act: reload 後
    const res2 = await request(app).get("/api/summary");

    // Assert
    expect(res2.body.totals.cost).toBe(20.0);
  });
});

describe("エラーハンドリング", () => {
  it("GET /api/summary - aggregate() が例外を throw するとステータス 500", async () => {
    // Arrange: キャッシュなし状態で aggregate が例外を投げる
    const { aggregate } = await import("./aggregate.js");
    vi.mocked(aggregate).mockImplementationOnce(() => {
      throw new Error("Aggregate failed");
    });

    // Act
    const res = await request(app).get("/api/summary");

    // Assert
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });

  it("POST /api/reload - loadRecords() が rejection するとステータス 500", async () => {
    // Arrange
    const { loadRecords } = await import("./parser.js");
    vi.mocked(loadRecords).mockRejectedValueOnce(new Error("Load failed"));

    // Act
    const res = await request(app).post("/api/reload");

    // Assert
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });

  it("GET /api/summary（キャッシュなし時）- loadRecords() が rejection するとステータス 500", async () => {
    // Arrange: キャッシュなし（beforeEach でモジュール再ロードされているので初回 GET になる）
    const { loadRecords } = await import("./parser.js");
    vi.mocked(loadRecords).mockRejectedValueOnce(new Error("Load failed"));

    // Act
    const res = await request(app).get("/api/summary");

    // Assert
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });
});

describe("GET /api/sessions/:id/turns", () => {
  it("recordsCache が未ロードの場合は空配列を返す", async () => {
    const res = await request(app).get("/api/sessions/any-id/turns");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("存在しないセッションIDは空配列を返す", async () => {
    await request(app).post("/api/reload");
    const res = await request(app).get("/api/sessions/nonexistent/turns");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("指定セッションのターンを ts・model・input・output・cost 付きで返す", async () => {
    const { loadRecords } = await import("./parser.js");
    vi.mocked(loadRecords).mockResolvedValueOnce({
      records: [
        {
          ts: "2026-06-27T01:00:00.000Z",
          model: "claude-sonnet-4-6",
          cwd: "/home/u/proj",
          sessionId: "sess-abc",
          input: 1000,
          output: 500,
          cacheCreate: 0,
          cacheCreate1h: 0,
          cacheRead: 0,
          cache1h: false,
        },
      ],
      fileCount: 1,
    });
    await request(app).post("/api/reload");

    const res = await request(app).get("/api/sessions/sess-abc/turns");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      ts: "2026-06-27T01:00:00.000Z",
      model: "claude-sonnet-4-6",
      input: 1000,
      output: 500,
      cacheCreate: 0,
      cacheRead: 0,
    });
    expect(typeof res.body[0].cost).toBe("number");
  });

  it("ターンは ts 昇順でソートされる", async () => {
    const { loadRecords } = await import("./parser.js");
    vi.mocked(loadRecords).mockResolvedValueOnce({
      records: [
        { ts: "2026-06-27T02:00:00.000Z", model: "claude-sonnet-4-6", cwd: "/p", sessionId: "s1", input: 100, output: 50, cacheCreate: 0, cacheCreate1h: 0, cacheRead: 0, cache1h: false },
        { ts: "2026-06-27T01:00:00.000Z", model: "claude-sonnet-4-6", cwd: "/p", sessionId: "s1", input: 200, output: 100, cacheCreate: 0, cacheCreate1h: 0, cacheRead: 0, cache1h: false },
      ],
      fileCount: 1,
    });
    await request(app).post("/api/reload");

    const res = await request(app).get("/api/sessions/s1/turns");
    expect(res.body[0].ts).toBe("2026-06-27T01:00:00.000Z");
    expect(res.body[1].ts).toBe("2026-06-27T02:00:00.000Z");
  });
});

describe("GET /api/hourly (24時間集計)", () => {
  it("returns 24-hour aggregated data", async () => {
    // モックの戻り値を明示的に設定
    const { aggregate } = await vi.importMock("./aggregate.js");
    aggregate.mockReturnValueOnce({
      hourly: Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        tokens: 100 + i,
        cost: 1.0 + i * 0.1,
        models: [{ model: "claude-opus-4-8", cost: 1.0 + i * 0.1 }],
      })),
    });

    const res = await request(app).get("/api/hourly");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("hourly");
    expect(Array.isArray(res.body.hourly)).toBe(true);
    expect(res.body.hourly).toHaveLength(24);
    expect(res.body.hourly[0]).toHaveProperty("hour", 0);
    expect(res.body.hourly[23]).toHaveProperty("hour", 23);
    expect(res.body.hourly[0]).toHaveProperty("tokens");
    expect(res.body.hourly[0]).toHaveProperty("cost");
    expect(res.body.hourly[0]).toHaveProperty("models");
  });

  it("returns 500 on aggregation error", async () => {
    const { aggregate: mockAggregate } = await vi.importMock("./aggregate.js");
    mockAggregate.mockImplementationOnce(() => {
      throw new Error("Aggregation failed");
    });

    const res = await request(app).get("/api/hourly");

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });
});

describe("セキュリティ強化", () => {
  describe("エラーレスポンスの汎用化", () => {
    it("GET /api/summary - 500エラーレスポンスに内部詳細（スタックトレース等）が含まれない", async () => {
      // Arrange
      const { aggregate } = await import("./aggregate.js");
      vi.mocked(aggregate).mockImplementationOnce(() => {
        throw new Error("Internal path: /home/user/.claude/secret");
      });

      // Act
      const res = await request(app).get("/api/summary");

      // Assert
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
      expect(res.body.error).not.toContain("/home/user");
      expect(res.body.error).not.toContain("secret");
      expect(res.body.error).not.toContain("Internal path");
    });

    it("POST /api/reload - 500エラーレスポンスに内部詳細が含まれない", async () => {
      // Arrange
      const { loadRecords } = await import("./parser.js");
      vi.mocked(loadRecords).mockRejectedValueOnce(new Error("Stack trace: /home/user/.config"));

      // Act
      const res = await request(app).post("/api/reload");

      // Assert
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
      expect(res.body.error).not.toContain("Stack trace");
      expect(res.body.error).not.toContain("/home/user");
    });

    it("GET /api/hourly - 500エラーレスポンスに内部詳細が含まれない", async () => {
      // Arrange
      const { aggregate } = await import("./aggregate.js");
      vi.mocked(aggregate).mockImplementationOnce(() => {
        throw new Error("Secret key: sk-ant-12345");
      });

      // Act
      const res = await request(app).get("/api/hourly");

      // Assert
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
      expect(res.body.error).not.toContain("sk-ant-12345");
      expect(res.body.error).not.toContain("Secret key");
    });
  });

  describe("POST /api/reload - レート制限", () => {
    it("最初の呼び出しは 200 を返す", async () => {
      const res = await request(app).post("/api/reload");
      expect(res.status).toBe(200);
    });

    it("30秒以内の連続呼び出しは 429 を返す", async () => {
      // Arrange: 1回目は成功させる
      await request(app).post("/api/reload");

      // Act: 即座に2回目
      const res = await request(app).post("/api/reload");

      // Assert
      expect(res.status).toBe(429);
      expect(res.body).toHaveProperty("error", "Rate limit exceeded");
      expect(res.body).toHaveProperty("retryAfterSec");
      expect(typeof res.body.retryAfterSec).toBe("number");
      expect(res.headers["retry-after"]).toBeDefined();
    });

    it("429レスポンスには再試行可能時間のヒントが含まれる", async () => {
      // Arrange
      await request(app).post("/api/reload");

      // Act
      const res = await request(app).post("/api/reload");

      // Assert
      expect(res.status).toBe(429);
      expect(res.body.retryAfterSec).toBeGreaterThan(0);
      expect(res.body.retryAfterSec).toBeLessThanOrEqual(30);
      expect(res.headers["retry-after"]).toBe(String(res.body.retryAfterSec));
    });
  });
});

describe("差分読み込み（インクリメンタルリロード）", () => {
  it("新しい行が追記された後の2回目の POST /api/reload は、既存レコードを重複させずに更新済みの合計を反映する", async () => {
    const { loadRecords } = await import("./parser.js");
    const { aggregate } = await import("./aggregate.js");

    // レート制限クールダウン（30秒）を回避するため Date.now をスパイする
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(1_000_000);

    // 1回目のリロード: 1件の新規レコード
    vi.mocked(loadRecords).mockResolvedValueOnce({
      records: [
        {
          ts: "2026-06-27T01:00:00.000Z",
          model: "claude-sonnet-4-6",
          cwd: "/home/u/proj",
          sessionId: "sess-1",
          input: 1000,
          output: 500,
          cacheCreate: 0,
          cacheCreate1h: 0,
          cacheRead: 0,
          cache1h: false,
        },
      ],
      fileCount: 1,
      parsedLines: 1,
      parseErrors: 0,
      skippedLines: 0,
      unreadableFiles: 0,
    });
    await request(app).post("/api/reload");

    // クールダウン経過後を模擬
    dateNowSpy.mockReturnValue(1_000_000 + 31_000);

    // 2回目のリロード: ファイルに追記された1件の新規レコードのみを返す（差分読み込み）
    vi.mocked(loadRecords).mockResolvedValueOnce({
      records: [
        {
          ts: "2026-06-27T02:00:00.000Z",
          model: "claude-sonnet-4-6",
          cwd: "/home/u/proj",
          sessionId: "sess-1",
          input: 2000,
          output: 1000,
          cacheCreate: 0,
          cacheCreate1h: 0,
          cacheRead: 0,
          cache1h: false,
        },
      ],
      fileCount: 1,
      parsedLines: 1,
      parseErrors: 0,
      skippedLines: 0,
      unreadableFiles: 0,
    });
    await request(app).post("/api/reload");

    // aggregate は累積済みの全レコード（1回目 + 2回目 = 2件）で呼ばれているはず（重複なし）
    expect(vi.mocked(aggregate)).toHaveBeenCalledTimes(2);
    const lastCallRecords = vi.mocked(aggregate).mock.calls[1][0];
    expect(lastCallRecords).toHaveLength(2);
    expect(lastCallRecords.map((r) => r.sessionId + r.ts)).toEqual([
      "sess-12026-06-27T01:00:00.000Z",
      "sess-12026-06-27T02:00:00.000Z",
    ]);

    dateNowSpy.mockRestore();
  });

  it("GET /api/sessions/:id/turns は初回ロードと差分リロードの両方のレコードを含む", async () => {
    const { loadRecords } = await import("./parser.js");

    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(2_000_000);

    vi.mocked(loadRecords).mockResolvedValueOnce({
      records: [
        {
          ts: "2026-06-27T01:00:00.000Z",
          model: "claude-sonnet-4-6",
          cwd: "/home/u/proj",
          sessionId: "sess-abc",
          input: 1000,
          output: 500,
          cacheCreate: 0,
          cacheCreate1h: 0,
          cacheRead: 0,
          cache1h: false,
        },
      ],
      fileCount: 1,
      parsedLines: 1,
      parseErrors: 0,
      skippedLines: 0,
      unreadableFiles: 0,
    });
    await request(app).post("/api/reload");

    // クールダウン経過後を模擬
    dateNowSpy.mockReturnValue(2_000_000 + 31_000);

    vi.mocked(loadRecords).mockResolvedValueOnce({
      records: [
        {
          ts: "2026-06-27T02:00:00.000Z",
          model: "claude-sonnet-4-6",
          cwd: "/home/u/proj",
          sessionId: "sess-abc",
          input: 2000,
          output: 1000,
          cacheCreate: 0,
          cacheCreate1h: 0,
          cacheRead: 0,
          cache1h: false,
        },
      ],
      fileCount: 1,
      parsedLines: 1,
      parseErrors: 0,
      skippedLines: 0,
      unreadableFiles: 0,
    });
    await request(app).post("/api/reload");

    const res = await request(app).get("/api/sessions/sess-abc/turns");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((t) => t.ts)).toEqual([
      "2026-06-27T01:00:00.000Z",
      "2026-06-27T02:00:00.000Z",
    ]);

    dateNowSpy.mockRestore();
  });
});

describe("GET /api/events (SSE)", () => {
  it("Content-Type: text/event-stream を返す", async () => {
    const res = await request(app)
      .get("/api/events")
      .buffer(false)
      .parse((res, callback) => {
        // SSE は keep-alive なので少量受信したら即終了
        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString();
          // connected イベントが来たら終了
          if (data.includes("connected")) {
            res.destroy();
          }
        });
        res.on("close", () => callback(null, data));
        res.on("error", () => callback(null, data));
      });

    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
  });

  it("接続時に connected イベントを送信する", async () => {
    let receivedData = "";

    await new Promise((resolve) => {
      request(app)
        .get("/api/events")
        .buffer(false)
        .parse((res, callback) => {
          res.on("data", (chunk) => {
            receivedData += chunk.toString();
            if (receivedData.includes("connected")) {
              res.destroy();
            }
          });
          res.on("close", () => {
            callback(null, receivedData);
            resolve(undefined);
          });
          res.on("error", () => {
            callback(null, receivedData);
            resolve(undefined);
          });
        })
        .then(() => resolve(undefined))
        .catch(() => resolve(undefined));
    });

    expect(receivedData).toContain("event: connected");
  });
});
