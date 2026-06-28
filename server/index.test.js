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
  }));

  const mod = await import("./index.js");
  app = mod.app;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/summary", () => {
  it("200 と JSON を返す", async () => {
    const res = await request(app).get("/api/summary");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("generatedAt");
  });
});

describe("POST /api/reload", () => {
  it("200 と再集計した JSON を返す", async () => {
    const res = await request(app).post("/api/reload");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("generatedAt");
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
