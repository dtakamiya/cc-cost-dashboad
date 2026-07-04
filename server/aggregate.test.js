import { describe, it, expect, vi, afterEach } from "vitest";
import { aggregate, filterRecordsByPeriod, computeCacheGapStats, computeModelSwitchStats, computeToolUsage, computeMcpUsage, computeToolResultUsage, computeToolResultOutliers, computeDuplicateReads, mergeToolResultTokensIntoSessions, CACHE_5M_TTL_MS, CACHE_1H_TTL_MS, MCP_OUTPUT_CAP_TOKENS, BASH_OUTPUT_CAP_TOKENS } from "./aggregate.js";
import { costOf } from "./pricing.js";

// 正規化レコードの最小ヘルパー（parser.js の出力形を模す）。
const rec = (over = {}) => ({
  ts: "2026-06-15T10:00:00.000Z",
  model: "claude-opus-4-8",
  cwd: "/home/u/proj",
  sessionId: "s1",
  input: 0,
  output: 0,
  cacheCreate: 0,
  cacheCreate1h: 0,
  cacheRead: 0,
  cache1h: false,
  isSidechain: false,
  ...over,
});

// opus input = 5 USD/MTok。1h write = ×2、5m write = ×1.25、read = ×0.1。
const INPUT_USD = 5 / 1_000_000;

describe("aggregate cacheStats", () => {
  it("1hレコードのみ: premium1h ≈ cacheWrite×0.375、create5mTokens=0", () => {
    const { cacheStats } = aggregate([
      rec({ cacheCreate: 1000, cacheCreate1h: 1000, cache1h: true }),
    ]);
    const expectedWrite = 1000 * INPUT_USD * 2; // 1h 書き込み
    expect(cacheStats.create1hTokens).toBe(1000);
    expect(cacheStats.create5mTokens).toBe(0);
    expect(cacheStats.write1hCost).toBeCloseTo(expectedWrite, 10);
    expect(cacheStats.write5mCost).toBe(0);
    expect(cacheStats.premium1h).toBeCloseTo(expectedWrite * 0.375, 10);
    // 超過分の別経路の検算: cacheCreate × inputUSD × 0.75
    expect(cacheStats.premium1h).toBeCloseTo(1000 * INPUT_USD * 0.75, 10);
  });

  it("5mレコードのみ: premium1h=0、write1hCost=0", () => {
    const { cacheStats } = aggregate([
      rec({ cacheCreate: 1000, cacheCreate1h: 0, cache1h: false }),
    ]);
    expect(cacheStats.premium1h).toBe(0);
    expect(cacheStats.write1hCost).toBe(0);
    expect(cacheStats.create1hTokens).toBe(0);
    expect(cacheStats.create5mTokens).toBe(1000);
    expect(cacheStats.write5mCost).toBeCloseTo(1000 * INPUT_USD * 1.25, 10);
  });

  it("read過多: roiNet>0（書き込みが読み込み節約で回収できている）", () => {
    const { cacheStats } = aggregate([
      rec({ cacheCreate: 1000, cacheRead: 1_000_000 }),
    ]);
    expect(cacheStats.roiNet).toBeGreaterThan(0);
    expect(cacheStats.readSavings).toBeGreaterThan(cacheStats.writeCost);
  });

  it("write過多・read無し: roiNet<0（書き込み未回収）", () => {
    const { cacheStats } = aggregate([
      rec({ cacheCreate: 1_000_000, cacheRead: 0 }),
    ]);
    expect(cacheStats.roiNet).toBeLessThan(0);
    expect(cacheStats.readSavings).toBe(0);
    expect(cacheStats.writeCost).toBeGreaterThan(0);
  });

  it("混在: create1hTokens + create5mTokens === tokenSplit.cacheCreate", () => {
    const s = aggregate([
      rec({ sessionId: "a", cacheCreate: 800, cacheCreate1h: 800, cache1h: true }),
      rec({ sessionId: "b", cacheCreate: 1200, cacheCreate1h: 0, cache1h: false }),
      rec({ sessionId: "c", cacheCreate: 500, cacheCreate1h: 300, cache1h: true }),
    ]);
    const { cacheStats, tokenSplit } = s;
    expect(cacheStats.create1hTokens + cacheStats.create5mTokens).toBe(tokenSplit.cacheCreate);
  });

  it("readSavings = costSplit.cacheRead × 9、roiNet = readSavings − writeCost", () => {
    const s = aggregate([rec({ cacheCreate: 2000, cacheRead: 500_000 })]);
    expect(s.cacheStats.readSavings).toBeCloseTo(s.costSplit.cacheRead * 9, 10);
    expect(s.cacheStats.writeCost).toBeCloseTo(s.costSplit.cacheWrite, 10);
    expect(s.cacheStats.roiNet).toBeCloseTo(
      s.cacheStats.readSavings - s.cacheStats.writeCost,
      10
    );
  });
});

describe("aggregate subagentStats (isSidechain 分離集計)", () => {
  it("main/subagent が混在する場合、トークンが正しく分離される", () => {
    const { subagentStats } = aggregate([
      rec({ sessionId: "a", isSidechain: false, input: 1000 }),
      rec({ sessionId: "a", isSidechain: true, input: 300 }),
      rec({ sessionId: "a", isSidechain: true, input: 200 }),
    ]);
    expect(subagentStats.mainTokens).toBe(1000);
    expect(subagentStats.subagentTokens).toBe(500);
  });

  it("全レコードが非sidechain（デフォルト）の場合、subagentTokens=0 かつ subagentRatio=0（NaNにならない）", () => {
    const { subagentStats } = aggregate([
      rec({ input: 1000 }),
      rec({ input: 500 }),
    ]);
    expect(subagentStats.subagentTokens).toBe(0);
    expect(subagentStats.subagentRatio).toBe(0);
    expect(Number.isNaN(subagentStats.subagentRatio)).toBe(false);
  });

  it("レコードが0件でも subagentRatio が0（ゼロ除算にならない）", () => {
    const { subagentStats } = aggregate([]);
    expect(subagentStats.mainTokens).toBe(0);
    expect(subagentStats.subagentTokens).toBe(0);
    expect(subagentStats.subagentRatio).toBe(0);
  });

  it("コスト（mainCost/subagentCost）がモデル価格ベースで正しく分離される", () => {
    const { subagentStats } = aggregate([
      rec({ isSidechain: false, model: "claude-opus-4-8", input: 1000 }), // 1000 * 5/1e6 = 0.005
      rec({ isSidechain: true, model: "claude-haiku-4-5", input: 2000 }), // 2000 * 1/1e6 = 0.002
    ]);
    expect(subagentStats.mainCost).toBeCloseTo(0.005, 10);
    expect(subagentStats.subagentCost).toBeCloseTo(0.002, 10);
  });

  it("subagentRatio = subagentTokens / (mainTokens + subagentTokens)", () => {
    const { subagentStats } = aggregate([
      rec({ isSidechain: false, input: 700 }),
      rec({ isSidechain: true, input: 300 }),
    ]);
    expect(subagentStats.subagentRatio).toBeCloseTo(0.3, 10);
  });

  it("daily[].mainTokens / daily[].subagentTokens が日別に正しく分離される", () => {
    const { daily } = aggregate([
      rec({ ts: "2026-06-15T10:00:00.000Z", isSidechain: false, input: 400 }),
      rec({ ts: "2026-06-15T11:00:00.000Z", isSidechain: true, input: 100 }),
      rec({ ts: "2026-06-16T10:00:00.000Z", isSidechain: false, input: 900 }),
      rec({ ts: "2026-06-16T11:00:00.000Z", isSidechain: true, input: 50 }),
    ]);
    const day1 = daily.find((d) => d.date === "2026-06-15");
    const day2 = daily.find((d) => d.date === "2026-06-16");
    expect(day1.mainTokens).toBe(400);
    expect(day1.subagentTokens).toBe(100);
    expect(day2.mainTokens).toBe(900);
    expect(day2.subagentTokens).toBe(50);
  });
});

describe("computeHourly (直近24時間の時間別集計)", () => {
  const NOW = new Date("2026-06-28T10:00:00.000Z").getTime();
  const INPUT_USD = 5 / 1_000_000;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aggregates last 24 hours by hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    // 直近30時間分のレコード作成（時間ごとに1つ）
    const records = [];
    for (let i = 29; i >= 0; i--) {
      const ts = new Date(NOW - i * 60 * 60 * 1000).toISOString();
      records.push(rec({ ts, input: 100_000 })); // 0.5 USD per record
    }

    const { hourly } = aggregate(records);

    expect(hourly).toBeDefined();
    expect(hourly.length).toBe(24);
    // ローリングウィンドウ: bucket[23] = 現在時間、bucket[0] = 23時間前
    const nowHour = new Date(NOW).getHours();
    expect(hourly[23].hour).toBe(nowHour);
    expect(hourly[0].hour).toBe((nowHour - 23 + 24) % 24);
    expect(hourly.every((h) => h.tokens > 0)).toBe(true);
    expect(hourly.every((h) => h.cost > 0)).toBe(true);
  });

  it("excludes records with null timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const validTs = new Date(NOW - 5 * 60 * 60 * 1000).toISOString();
    const records = [
      rec({ ts: null, input: 100_000 }),
      rec({ ts: validTs, input: 100_000 }),
    ];

    const { hourly } = aggregate(records);

    expect(hourly).toBeDefined();
    expect(hourly.length).toBe(24);
    expect(hourly.some((h) => h.tokens > 0)).toBe(true);
  });

  it("includes per-model cost and token breakdown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    // NOW は 2026-06-28T10:00:00.000Z (UTC)
    // JST では 2026-06-28T19:00:00 (hour 19)
    // 2 時間前なら hour 17
    const ts1 = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    const ts2 = new Date(NOW - 2 * 60 * 60 * 1000 + 10 * 60 * 1000).toISOString();

    const records = [
      rec({ ts: ts1, model: "claude-opus-4-8", input: 100_000 }),
      rec({ ts: ts2, model: "claude-opus-4-8", input: 50_000 }),
    ];

    const { hourly } = aggregate(records);

    // 2時間前のレコードなので、JST の hour を確認
    const nowLocal = new Date(NOW);
    const currentHour = nowLocal.getHours();
    const targetHour = (currentHour - 2 + 24) % 24;

    const targetHourData = hourly.find((h) => h.hour === targetHour);
    expect(targetHourData).toBeDefined();
    expect(targetHourData.models).toBeDefined();
    expect(Array.isArray(targetHourData.models)).toBe(true);
    expect(targetHourData.models.some((m) => m.model === "claude-opus-4-8")).toBe(true);
    expect(targetHourData.models.some((m) => m.model === "claude-opus-4-8" && m.tokens > 0)).toBe(true);
  });
});

describe("computeBlocks recentBurnRatePerMin (スライディングウィンドウ)", () => {
  const NOW = new Date("2026-06-28T10:00:00.000Z").getTime();
  // opus input = 5 USD/MTok
  const INPUT_USD = 5 / 1_000_000;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ウィンドウ外の古いレコードは recentBurnRatePerMin に含まれない", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    // 16分前のレコードはウィンドウ外（ウィンドウは15分）
    const outsideTs = new Date(NOW - 16 * 60 * 1000).toISOString();
    const { blocks } = aggregate([
      rec({ ts: outsideTs, input: 1_000_000 }), // 5 USD だがウィンドウ外
    ]);

    const active = blocks.find((b) => b.isActive);
    expect(active).toBeTruthy();
    expect(active.recentBurnRatePerMin).toBe(0);
  });

  it("ウィンドウ内のコストのみでバーンレートを計算する", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const outsideTs = new Date(NOW - 60 * 60 * 1000).toISOString(); // 60分前（ウィンドウ外）
    const insideTs = new Date(NOW - 10 * 60 * 1000).toISOString();  // 10分前（ウィンドウ内）

    const { blocks } = aggregate([
      rec({ ts: outsideTs, input: 1_000_000 }), // 5 USD、ウィンドウ外
      rec({ ts: insideTs, input: 300_000 }),      // 1.5 USD、ウィンドウ内
    ]);

    const active = blocks.find((b) => b.isActive);
    expect(active).toBeTruthy();
    // recentBurnRatePerMin = 1.5 USD / 15分 = 0.1
    expect(active.recentBurnRatePerMin).toBeCloseTo(300_000 * INPUT_USD / 15, 8);
  });

  it("ウィンドウ内にレコードが複数ある場合は合算する", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    // ブロックを60分前に開始させてウィンドウが15分フルになるよう設定
    const blockStartTs = new Date(NOW - 60 * 60 * 1000).toISOString(); // 60分前
    const ts1 = new Date(NOW - 14 * 60 * 1000).toISOString(); // 14分前（ウィンドウ内）
    const ts2 = new Date(NOW - 5 * 60 * 1000).toISOString();  // 5分前（ウィンドウ内）

    const { blocks } = aggregate([
      rec({ ts: blockStartTs, input: 0 }), // ブロック起点（コストなし）
      rec({ ts: ts1, input: 100_000 }), // 0.5 USD
      rec({ ts: ts2, input: 200_000 }), // 1.0 USD
    ]);

    const active = blocks.find((b) => b.isActive);
    expect(active).toBeTruthy();
    // windowStart = max(60分前, 15分前) = 15分前、windowDurationMin = 15
    // recentCost = 0.5 + 1.0 = 1.5 USD、recentBurnRatePerMin = 1.5 / 15 = 0.1
    expect(active.recentBurnRatePerMin).toBeCloseTo(300_000 * INPUT_USD / 15, 8);
  });

  it("ブロック開始直後（5分経過）はウィンドウを実経過時間に縮める", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    // ブロック開始5分後: windowStart=ブロック開始、windowDurationMin=5
    const ts = new Date(NOW - 3 * 60 * 1000).toISOString(); // 3分前にレコード

    const { blocks } = aggregate([
      rec({ ts: new Date(NOW - 5 * 60 * 1000).toISOString(), input: 0 }), // ブロック起点
      rec({ ts, input: 300_000 }), // 1.5 USD
    ]);

    const active = blocks.find((b) => b.isActive);
    expect(active).toBeTruthy();
    // windowDurationMin = 5分（ブロック開始からの経過時間）
    // recentBurnRatePerMin = 1.5 USD / 5分 = 0.3
    expect(active.recentBurnRatePerMin).toBeCloseTo(300_000 * INPUT_USD / 5, 8);
  });

  it("非アクティブブロックの recentBurnRatePerMin は 0", () => {
    // 5時間以上前のレコードなので非アクティブになる
    const oldTs = "2026-06-27T00:00:00.000Z";
    const { blocks } = aggregate([rec({ ts: oldTs, input: 1_000_000 })]);

    const inactive = blocks.find((b) => !b.isActive);
    expect(inactive).toBeTruthy();
    expect(inactive.recentBurnRatePerMin).toBe(0);
  });
});

// ─── computeProjection ───────────────────────────────────────────────────────

describe("computeProjection", () => {
  const FIXED_NOW = new Date("2026-06-15T12:00:00.000Z");

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recordsが空の場合はnullを返す", () => {
    const { projection } = aggregate([]);
    expect(projection).toBeNull();
  });

  it("当月外のレコードのみの場合はnullを返す（monthCostSoFar=0, projectedMonthCost=0）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    // 2026-05（先月）のレコードのみ
    const { projection } = aggregate([
      rec({ ts: "2026-05-10T10:00:00.000Z", input: 1_000 }),
    ]);
    // ts ありなので projection は返る（当月データは 0）
    expect(projection).not.toBeNull();
    expect(projection.monthCostSoFar).toBe(0);
    // daysPassed > 0 なので projectedMonthCost = 0（当月コストが 0 のため）
    expect(projection.projectedMonthCost).toBe(0);
  });

  it("daysPassed > 0 のとき projectedMonthCost を計算する", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    // 当月レコード: 2026-06-10（入力 1MTok = $5）
    const { projection } = aggregate([
      rec({ ts: "2026-06-10T10:00:00.000Z", input: 1_000_000 }),
    ]);

    expect(projection).not.toBeNull();
    expect(projection.monthCostSoFar).toBeCloseTo(5, 5);
    // daysPassed ≒ 15.5日、daysInMonth = 30 → projectedMonthCost ≈ 5/15.5*30
    expect(projection.projectedMonthCost).toBeGreaterThan(0);
    expect(projection.daysInMonth).toBe(30);
  });

  it("monthStrがYYYY-MM形式になる", () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    const { projection } = aggregate([
      rec({ ts: "2026-06-10T10:00:00.000Z", input: 100 }),
    ]);

    expect(projection).not.toBeNull();
    expect(projection.monthStr).toMatch(/^\d{4}-\d{2}$/);
    expect(projection.monthStr).toBe("2026-06");
  });
});

// ─── computeActivity ─────────────────────────────────────────────────────────

describe("computeActivity", () => {
  it("空配列のとき matrix は 7×24 の全0行列", () => {
    const { activity } = aggregate([]);
    expect(activity.matrix).toHaveLength(7);
    for (const row of activity.matrix) {
      expect(row).toHaveLength(24);
      expect(row.every((v) => v === 0)).toBe(true);
    }
    expect(activity.total).toBe(0);
    expect(activity.peak).toBeNull();
  });

  it("tsがないレコードは無視する", () => {
    const { activity } = aggregate([rec({ ts: null, input: 100_000 })]);
    expect(activity.total).toBe(0);
    expect(activity.peak).toBeNull();
  });

  it("各レコードが正しい[day][hour]バケットに振り分けられる", () => {
    // 2026-06-15 は月曜日 (day=1)、UTC 12:00
    const ts = "2026-06-15T12:00:00.000Z";
    const d = new Date(ts);
    const expectedDay = d.getDay();
    const expectedHour = d.getHours();
    const tokens = 500;

    const { activity } = aggregate([
      rec({ ts, input: tokens }),
    ]);

    expect(activity.matrix[expectedDay][expectedHour]).toBe(tokens);
    expect(activity.total).toBe(tokens);
  });

  it("peakが最大トークン数のセルを返す", () => {
    // 2 つのレコード: 片方が明らかに大きい
    const ts1 = "2026-06-15T10:00:00.000Z"; // day=1, hour depends on TZ
    const ts2 = "2026-06-16T14:00:00.000Z";
    const d1 = new Date(ts1);
    const d2 = new Date(ts2);

    const { activity } = aggregate([
      rec({ ts: ts1, input: 100 }),
      rec({ ts: ts2, input: 50_000 }),
    ]);

    expect(activity.peak).not.toBeNull();
    expect(activity.peak.day).toBe(d2.getDay());
    expect(activity.peak.hour).toBe(d2.getHours());
    expect(activity.peak.tokens).toBe(50_000);
  });

  it("totalが全トークンの合計になる", () => {
    const records = [
      rec({ ts: "2026-06-10T08:00:00.000Z", input: 100, output: 200, cacheCreate: 50, cacheRead: 30 }),
      rec({ ts: "2026-06-11T09:00:00.000Z", input: 400, output: 100, cacheCreate: 0, cacheRead: 0 }),
    ];
    const { activity } = aggregate(records);
    // 1件目: 100+200+50+30=380、2件目: 400+100=500
    expect(activity.total).toBe(380 + 500);
  });
});

// ─── computeSessions ─────────────────────────────────────────────────────────

describe("computeSessions", () => {
  it("空配列のとき空配列を返す", () => {
    const { bySession } = aggregate([]);
    expect(bySession).toEqual([]);
  });

  it("(unknown)セッションは除外される", () => {
    const { bySession } = aggregate([
      rec({ sessionId: "(unknown)", input: 1_000_000 }),
      rec({ sessionId: "valid-session", input: 500 }),
    ]);
    expect(bySession).toHaveLength(1);
    expect(bySession[0].sessionId).toBe("valid-session");
  });

  it("コスト降順でソートされる", () => {
    const { bySession } = aggregate([
      rec({ sessionId: "cheap",     input: 100 }),
      rec({ sessionId: "expensive", input: 1_000_000 }),
      rec({ sessionId: "mid",       input: 50_000 }),
    ]);
    expect(bySession[0].sessionId).toBe("expensive");
    expect(bySession[1].sessionId).toBe("mid");
    expect(bySession[2].sessionId).toBe("cheap");
  });

  it("avgContextPerMsg = (cacheRead + input) / messages", () => {
    const input = 200;
    const cacheRead = 800;
    const { bySession } = aggregate([
      rec({ sessionId: "s1", input, cacheRead }),
    ]);
    expect(bySession[0].avgContextPerMsg).toBe(input + cacheRead);
  });

  it("複数メッセージのとき messages でわる", () => {
    const { bySession } = aggregate([
      rec({ sessionId: "s1", ts: "2026-06-15T10:00:00.000Z", input: 100, cacheRead: 900 }),
      rec({ sessionId: "s1", ts: "2026-06-15T11:00:00.000Z", input: 200, cacheRead: 800 }),
    ]);
    // input合計=300, cacheRead合計=1700, messages=2 → avgContextPerMsg=1000
    expect(bySession[0].avgContextPerMsg).toBe((300 + 1700) / 2);
  });
});

// ─── computeBlocks 基本動作 ──────────────────────────────────────────────────

describe("computeBlocks 基本動作", () => {
  it("空配列のとき空配列を返す", () => {
    const { blocks } = aggregate([]);
    expect(blocks).toEqual([]);
  });

  it("21件以上のブロックは最新20件に切り詰められる", () => {
    // 各ブロック = 5時間。21件 = 105時間ずつ離す
    const records = Array.from({ length: 21 }, (_, i) => {
      const ms = Date.now() - (21 - i) * 6 * 60 * 60 * 1000; // 6時間ずつ
      return rec({ ts: new Date(ms).toISOString(), sessionId: `s${i}`, input: 100 });
    });
    const { blocks } = aggregate(records);
    expect(blocks).toHaveLength(20);
  });
});

// ─── 日別プロジェクト別コスト ────────────────────────────────────────────────

describe("日別プロジェクト別コスト（projectCosts）", () => {
  it("同日・単一プロジェクトのコスト合計が projectCosts に反映される", () => {
    const { daily } = aggregate([
      rec({ ts: "2026-06-15T10:00:00.000Z", cwd: "/home/u/proj", input: 1000 }),
      rec({ ts: "2026-06-15T11:00:00.000Z", cwd: "/home/u/proj", input: 2000 }),
    ]);
    const day = daily.find((d) => d.date === "2026-06-15");
    const expectedCost = (1000 + 2000) * INPUT_USD;
    expect(day.projectCosts["/home/u/proj"]).toBeCloseTo(expectedCost, 10);
  });

  it("同日・複数プロジェクトはそれぞれ独立して集計される", () => {
    const { daily } = aggregate([
      rec({ ts: "2026-06-15T10:00:00.000Z", cwd: "/home/u/proj-a", input: 1000 }),
      rec({ ts: "2026-06-15T11:00:00.000Z", cwd: "/home/u/proj-b", input: 3000 }),
    ]);
    const day = daily.find((d) => d.date === "2026-06-15");
    expect(day.projectCosts["/home/u/proj-a"]).toBeCloseTo(1000 * INPUT_USD, 10);
    expect(day.projectCosts["/home/u/proj-b"]).toBeCloseTo(3000 * INPUT_USD, 10);
  });

  it("複数日にまたがる同一プロジェクトは日ごとに別集計される", () => {
    const { daily } = aggregate([
      rec({ ts: "2026-06-15T10:00:00.000Z", cwd: "/home/u/proj", input: 1000 }),
      rec({ ts: "2026-06-16T10:00:00.000Z", cwd: "/home/u/proj", input: 5000 }),
    ]);
    const day1 = daily.find((d) => d.date === "2026-06-15");
    const day2 = daily.find((d) => d.date === "2026-06-16");
    expect(day1.projectCosts["/home/u/proj"]).toBeCloseTo(1000 * INPUT_USD, 10);
    expect(day2.projectCosts["/home/u/proj"]).toBeCloseTo(5000 * INPUT_USD, 10);
  });
});

// ─── aggregate: bySession の件数制限（sessionLimit） ───────────────────────

describe("aggregate: bySession の件数制限", () => {
  it("sessionLimit を指定すると上位N件（コスト降順）にスライスする", () => {
    const records = [
      rec({ sessionId: "cheap", input: 100 }),
      rec({ sessionId: "expensive", input: 1_000_000 }),
      rec({ sessionId: "mid", input: 50_000 }),
    ];
    const { bySession } = aggregate(records, { sessionLimit: 2 });
    expect(bySession).toHaveLength(2);
    expect(bySession[0].sessionId).toBe("expensive");
    expect(bySession[1].sessionId).toBe("mid");
  });

  it("sessionLimit 省略時はデフォルトで30件に制限する", () => {
    const records = Array.from({ length: 35 }, (_, i) =>
      rec({ sessionId: `s${i}`, input: i + 1 })
    );
    const { bySession } = aggregate(records);
    expect(bySession).toHaveLength(30);
  });

  it("sessionLimit を明示的に大きくすると上限を変更できる", () => {
    const records = Array.from({ length: 35 }, (_, i) =>
      rec({ sessionId: `s${i}`, input: i + 1 })
    );
    const { bySession } = aggregate(records, { sessionLimit: 35 });
    expect(bySession).toHaveLength(35);
  });
});

// ─── daily cacheReadRatio ────────────────────────────────────────────────
// daily[].cacheReadRatio = cacheRead / (input + cacheRead)（日別。分母が異なる
// drivers.cacheReadRatio = cacheRead / totalTokens とは別物なので混同しないこと）

describe("daily cacheReadRatio", () => {
  it("input と cacheRead がある日: cacheReadRatio = cacheRead/(input+cacheRead)", () => {
    const { daily } = aggregate([
      rec({ ts: "2026-06-15T10:00:00.000Z", input: 100, cacheRead: 300 }),
    ]);
    const day = daily.find((d) => d.date === "2026-06-15");
    expect(day.cacheReadRatio).toBeCloseTo(0.75, 10);
  });

  it("cacheWriteのみでcacheRead=0の日: cacheReadRatio=0", () => {
    const { daily } = aggregate([
      rec({ ts: "2026-06-15T10:00:00.000Z", cacheCreate: 500, cacheRead: 0 }),
    ]);
    const day = daily.find((d) => d.date === "2026-06-15");
    expect(day.cacheReadRatio).toBe(0);
  });

  it("inputもcacheReadも0の日: ゼロ除算せず0を返す", () => {
    const { daily } = aggregate([
      rec({ ts: "2026-06-15T10:00:00.000Z", input: 0, cacheRead: 0, output: 100 }),
    ]);
    const day = daily.find((d) => d.date === "2026-06-15");
    expect(day.cacheReadRatio).toBe(0);
  });

  it("複数日にまたがる場合、日ごとに独立して計算される", () => {
    const { daily } = aggregate([
      rec({ ts: "2026-06-15T10:00:00.000Z", input: 100, cacheRead: 100 }), // 0.5
      rec({ ts: "2026-06-16T10:00:00.000Z", input: 100, cacheRead: 900 }), // 0.9
    ]);
    const day1 = daily.find((d) => d.date === "2026-06-15");
    const day2 = daily.find((d) => d.date === "2026-06-16");
    expect(day1.cacheReadRatio).toBeCloseTo(0.5, 10);
    expect(day2.cacheReadRatio).toBeCloseTo(0.9, 10);
  });

  it("inputTokens, cacheReadTokens が日別に累積される", () => {
    const { daily } = aggregate([
      rec({ ts: "2026-06-15T10:00:00.000Z", input: 100, cacheRead: 300 }),
      rec({ ts: "2026-06-15T11:00:00.000Z", input: 50, cacheRead: 150 }),
    ]);
    const day = daily.find((d) => d.date === "2026-06-15");
    expect(day.inputTokens).toBe(150);
    expect(day.cacheReadTokens).toBe(450);
    expect(day.cacheReadRatio).toBeCloseTo(0.75, 10);
  });
});

// ─── computeSessions: compactionCount ────────────────────────────────────

describe("aggregate: compactionCount", () => {
  it("compactions 未指定時、compactionCount は 0", () => {
    const { bySession } = aggregate([rec({ sessionId: "s1", input: 100 })]);
    expect(bySession[0].compactionCount).toBe(0);
  });

  it("compactions が空配列でも compactionCount は 0", () => {
    const { bySession } = aggregate([rec({ sessionId: "s1", input: 100 })], { compactions: [] });
    expect(bySession[0].compactionCount).toBe(0);
  });

  it("該当セッションの圧縮マーカー件数が compactionCount に反映される", () => {
    const { bySession } = aggregate(
      [rec({ sessionId: "s1", input: 100 })],
      { compactions: [{ sessionId: "s1" }, { sessionId: "s1" }, { sessionId: "s1" }] }
    );
    expect(bySession[0].compactionCount).toBe(3);
  });

  it("複数セッションの圧縮マーカーがセッションごとに正しく振り分けられる", () => {
    const { bySession } = aggregate(
      [
        rec({ sessionId: "a", input: 1_000_000 }),
        rec({ sessionId: "b", input: 100 }),
      ],
      { compactions: [{ sessionId: "a" }, { sessionId: "b" }, { sessionId: "b" }] }
    );
    const a = bySession.find((s) => s.sessionId === "a");
    const b = bySession.find((s) => s.sessionId === "b");
    expect(a.compactionCount).toBe(1);
    expect(b.compactionCount).toBe(2);
  });

  it("records に無いセッションの圧縮マーカーは無視される（該当セッションが bySession に存在しないため）", () => {
    const { bySession } = aggregate(
      [rec({ sessionId: "s1", input: 100 })],
      { compactions: [{ sessionId: "unknown-session" }] }
    );
    expect(bySession).toHaveLength(1);
    expect(bySession[0].compactionCount).toBe(0);
  });
});

// ─── filterRecordsByPeriod ───────────────────────────────────────────────

describe("filterRecordsByPeriod", () => {
  it("days 指定で直近N日のレコードのみ返す（今日を含む）", () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 86400000).toISOString().slice(0, 10);
    const tenDaysAgo = new Date(now.getTime() - 10 * 86400000).toISOString().slice(0, 10);

    const records = [
      rec({ sessionId: "recent", ts: `${today}T10:00:00.000Z` }),
      rec({ sessionId: "mid", ts: `${fiveDaysAgo}T10:00:00.000Z` }),
      rec({ sessionId: "old", ts: `${tenDaysAgo}T10:00:00.000Z` }),
    ];

    const filtered = filterRecordsByPeriod(records, { days: 7 });
    const ids = filtered.map((r) => r.sessionId);
    expect(ids).toContain("recent");
    expect(ids).toContain("mid");
    expect(ids).not.toContain("old");
  });

  it("from/to 指定で日付範囲のレコードのみ返す", () => {
    const records = [
      rec({ sessionId: "before", ts: "2026-06-01T10:00:00.000Z" }),
      rec({ sessionId: "inside", ts: "2026-06-15T10:00:00.000Z" }),
      rec({ sessionId: "after", ts: "2026-06-30T10:00:00.000Z" }),
    ];
    const filtered = filterRecordsByPeriod(records, { from: "2026-06-10", to: "2026-06-20" });
    expect(filtered.map((r) => r.sessionId)).toEqual(["inside"]);
  });

  it("period='all' のときは全件返す", () => {
    const records = [
      rec({ sessionId: "a", ts: "2026-06-01T10:00:00.000Z" }),
      rec({ sessionId: "b", ts: "2026-06-15T10:00:00.000Z" }),
    ];
    expect(filterRecordsByPeriod(records, "all")).toHaveLength(2);
  });

  it("period 未指定のときは全件返す", () => {
    const records = [
      rec({ sessionId: "a", ts: "2026-06-01T10:00:00.000Z" }),
      rec({ sessionId: "b", ts: "2026-06-15T10:00:00.000Z" }),
    ];
    expect(filterRecordsByPeriod(records)).toHaveLength(2);
  });

  it("ts が無いレコードは期間指定時に除外される", () => {
    const records = [
      rec({ sessionId: "no-ts", ts: null }),
      rec({ sessionId: "has-ts", ts: "2026-06-15T10:00:00.000Z" }),
    ];
    const filtered = filterRecordsByPeriod(records, { days: 365 * 10 });
    expect(filtered.map((r) => r.sessionId)).toEqual(["has-ts"]);
  });
});

describe("computeCacheGapStats", () => {
  it("ギャップが5分以内(299999ms)なら失効ギャップとしてカウントしない", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + 299_999;
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString() }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), cacheCreate: 100, cacheRead: 0 }),
    ];
    const stats = computeCacheGapStats(records);
    expect(stats.expiredGapCount).toBe(0);
    expect(stats.reWriteTokens).toBe(0);
    expect(stats.affectedSessions).toEqual([]);
  });

  it("ギャップが5分超(300001ms)なら失効ギャップとしてカウントする", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + CACHE_5M_TTL_MS + 1;
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString() }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), cacheCreate: 1000, cacheRead: 0 }),
    ];
    const stats = computeCacheGapStats(records);
    expect(stats.expiredGapCount).toBe(1);
    expect(stats.reWriteTokens).toBe(1000);
    expect(stats.affectedSessions).toEqual(["s1"]);
  });

  it("cacheReadがcacheCreate以上のメッセージは再書き込みコストに計上しない（ギャップ自体はカウントする）", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + CACHE_5M_TTL_MS + 1;
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString() }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), cacheCreate: 100, cacheRead: 200 }),
    ];
    const stats = computeCacheGapStats(records);
    expect(stats.expiredGapCount).toBe(1);
    expect(stats.reWriteTokens).toBe(0);
    expect(stats.reWriteCost).toBe(0);
    expect(stats.affectedSessions).toEqual(["s1"]);
  });

  it("cacheCreateがcacheRead以上のメッセージは再書き込みとして計上する", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + CACHE_5M_TTL_MS + 1;
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString() }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), cacheCreate: 500, cacheRead: 500 }),
    ];
    const stats = computeCacheGapStats(records);
    expect(stats.reWriteTokens).toBe(500);
    expect(stats.reWriteCost).toBeGreaterThan(0);
  });

  it("複数セッションを個別にグループ化して集計する（セッションを跨いだ入力でも正しく判定）", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + CACHE_5M_TTL_MS + 1;
    const records = [
      rec({ sessionId: "a", ts: new Date(t0).toISOString() }),
      rec({ sessionId: "b", ts: new Date(t0).toISOString() }),
      rec({ sessionId: "a", ts: new Date(t1).toISOString(), cacheCreate: 100, cacheRead: 0 }),
      rec({ sessionId: "b", ts: new Date(t0 + 1000).toISOString(), cacheCreate: 100, cacheRead: 0 }),
    ];
    const stats = computeCacheGapStats(records);
    expect(stats.expiredGapCount).toBe(1);
    expect(stats.affectedSessions).toEqual(["a"]);
  });

  it('sessionIdが"(unknown)"のレコードは除外する', () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + CACHE_5M_TTL_MS + 1;
    const records = [
      rec({ sessionId: "(unknown)", ts: new Date(t0).toISOString() }),
      rec({ sessionId: "(unknown)", ts: new Date(t1).toISOString(), cacheCreate: 100, cacheRead: 0 }),
    ];
    const stats = computeCacheGapStats(records);
    expect(stats.expiredGapCount).toBe(0);
    expect(stats.affectedSessions).toEqual([]);
  });

  it("tsが欠損しているレコードはギャップ判定をスキップする", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + CACHE_5M_TTL_MS + 1;
    const records = [
      rec({ sessionId: "s1", ts: null }),
      rec({ sessionId: "s1", ts: new Date(t0).toISOString() }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), cacheCreate: 100, cacheRead: 0 }),
    ];
    const stats = computeCacheGapStats(records);
    expect(stats.expiredGapCount).toBe(1);
  });

  it("入力配列がts順でソートされていなくても、セッション内でts昇順に並べ替えて判定する", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + CACHE_5M_TTL_MS + 1;
    const records = [
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), cacheCreate: 100, cacheRead: 0 }),
      rec({ sessionId: "s1", ts: new Date(t0).toISOString() }),
    ];
    const stats = computeCacheGapStats(records);
    expect(stats.expiredGapCount).toBe(1);
    expect(stats.reWriteTokens).toBe(100);
  });

  it("affectedSessionsは失効ギャップを持つセッションIDの重複なし配列を返す", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + CACHE_5M_TTL_MS + 1;
    const t2 = t1 + CACHE_5M_TTL_MS + 1;
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString() }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), cacheCreate: 100, cacheRead: 0 }),
      rec({ sessionId: "s1", ts: new Date(t2).toISOString(), cacheCreate: 100, cacheRead: 0 }),
    ];
    const stats = computeCacheGapStats(records);
    expect(stats.expiredGapCount).toBe(2);
    expect(stats.affectedSessions).toEqual(["s1"]);
  });

  it("reWriteCostはcostOf(model, record).cacheWriteの合算と一致する", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + CACHE_5M_TTL_MS + 1;
    const cur = { model: "claude-opus-4-8", cacheCreate: 700, cacheRead: 100, cacheCreate1h: 0, cache1h: false };
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString() }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), ...cur }),
    ];
    const stats = computeCacheGapStats(records);
    const expectedCost = costOf(cur.model, cur).cacheWrite;
    expect(stats.reWriteCost).toBeCloseTo(expectedCost, 10);
  });

  it("直前レコードがcache1hのとき、5分超1時間以内のギャップは失効ギャップとしてカウントしない", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + CACHE_5M_TTL_MS + 1; // 5分超だが1時間以内
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString(), cache1h: true }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), cacheCreate: 100, cacheRead: 0 }),
    ];
    const stats = computeCacheGapStats(records);
    expect(stats.expiredGapCount).toBe(0);
    expect(stats.affectedSessions).toEqual([]);
  });

  it("直前レコードがcache1hのとき、1時間超のギャップは失効ギャップとしてカウントする", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + CACHE_1H_TTL_MS + 1;
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString(), cache1h: true }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), cacheCreate: 100, cacheRead: 0 }),
    ];
    const stats = computeCacheGapStats(records);
    expect(stats.expiredGapCount).toBe(1);
    expect(stats.affectedSessions).toEqual(["s1"]);
  });
});

describe("aggregate() cacheGapStats", () => {
  it("aggregate() の戻り値に cacheGapStats が含まれる", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + CACHE_5M_TTL_MS + 1;
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString() }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), cacheCreate: 100, cacheRead: 0 }),
    ];
    const result = aggregate(records);
    expect(result.cacheGapStats).toBeDefined();
    expect(result.cacheGapStats.expiredGapCount).toBe(1);
    expect(result.cacheGapStats.affectedSessions).toEqual(["s1"]);
  });
});

describe("computeModelSwitchStats", () => {
  it("単一モデルのみのセッション → switchCountが0、reCreateTokens/reCreateCostが0、affectedSessionsが空配列", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + 1000;
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString(), model: "claude-opus-4-8" }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), model: "claude-opus-4-8", cacheCreate: 100, cacheRead: 0 }),
    ];
    const stats = computeModelSwitchStats(records);
    expect(stats.switchCount).toBe(0);
    expect(stats.reCreateTokens).toBe(0);
    expect(stats.reCreateCost).toBe(0);
    expect(stats.affectedSessions).toEqual([]);
  });

  it("Opus→Sonnet切替直後にcacheCreate>0かつcacheCreate>=cacheReadのレコードがある → switchCountが1、reCreateTokens/reCreateCostが計上され、affectedSessionsに含まれる", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + 1000;
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString(), model: "claude-opus-4-8" }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), model: "claude-sonnet-4-5", cacheCreate: 500, cacheRead: 100 }),
    ];
    const stats = computeModelSwitchStats(records);
    expect(stats.switchCount).toBe(1);
    expect(stats.reCreateTokens).toBe(500);
    expect(stats.reCreateCost).toBeGreaterThan(0);
    expect(stats.affectedSessions).toEqual(["s1"]);
  });

  it("モデル切替はあるが切替直後のレコードでcacheReadがcacheCreateを上回る → switchCountは1のままだがreCreateTokens/reCreateCost/affectedSessionsには計上されない", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + 1000;
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString(), model: "claude-opus-4-8" }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), model: "claude-sonnet-4-5", cacheCreate: 100, cacheRead: 500 }),
    ];
    const stats = computeModelSwitchStats(records);
    expect(stats.switchCount).toBe(1);
    expect(stats.reCreateTokens).toBe(0);
    expect(stats.reCreateCost).toBe(0);
    expect(stats.affectedSessions).toEqual([]);
  });

  it('sessionIdが"(unknown)"のレコードは除外される', () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + 1000;
    const records = [
      rec({ sessionId: "(unknown)", ts: new Date(t0).toISOString(), model: "claude-opus-4-8" }),
      rec({ sessionId: "(unknown)", ts: new Date(t1).toISOString(), model: "claude-sonnet-4-5", cacheCreate: 100, cacheRead: 0 }),
    ];
    const stats = computeModelSwitchStats(records);
    expect(stats.switchCount).toBe(0);
    expect(stats.affectedSessions).toEqual([]);
  });

  it("複数セッションが独立して集計される", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + 1000;
    const records = [
      rec({ sessionId: "a", ts: new Date(t0).toISOString(), model: "claude-opus-4-8" }),
      rec({ sessionId: "a", ts: new Date(t1).toISOString(), model: "claude-sonnet-4-5", cacheCreate: 200, cacheRead: 0 }),
      rec({ sessionId: "b", ts: new Date(t0).toISOString(), model: "claude-opus-4-8" }),
      rec({ sessionId: "b", ts: new Date(t1).toISOString(), model: "claude-opus-4-8", cacheCreate: 200, cacheRead: 0 }),
    ];
    const stats = computeModelSwitchStats(records);
    expect(stats.switchCount).toBe(1);
    expect(stats.affectedSessions).toEqual(["a"]);
  });

  it("サブエージェント（isSidechain）のレコードはモデル切替検出から除外される", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + 1000;
    const t2 = t0 + 2000;
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString(), model: "claude-opus-4-8", isSidechain: false }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), model: "claude-haiku-4-5", isSidechain: true, cacheCreate: 100, cacheRead: 0 }),
      rec({ sessionId: "s1", ts: new Date(t2).toISOString(), model: "claude-opus-4-8", isSidechain: false, cacheCreate: 100, cacheRead: 0 }),
    ];
    const stats = computeModelSwitchStats(records);
    expect(stats.switchCount).toBe(0);
    expect(stats.reCreateTokens).toBe(0);
    expect(stats.affectedSessions).toEqual([]);
  });
});

describe("aggregate() modelSwitch", () => {
  it("aggregate() の戻り値に modelSwitch が含まれる", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z").getTime();
    const t1 = t0 + 1000;
    const records = [
      rec({ sessionId: "s1", ts: new Date(t0).toISOString(), model: "claude-opus-4-8" }),
      rec({ sessionId: "s1", ts: new Date(t1).toISOString(), model: "claude-sonnet-4-5", cacheCreate: 500, cacheRead: 100 }),
    ];
    const result = aggregate(records);
    expect(result.modelSwitch).toBeDefined();
    expect(result.modelSwitch.switchCount).toBe(1);
    expect(result.modelSwitch.affectedSessions).toEqual(["s1"]);
  });
});

// ─── computeToolUsage ─────────────────────────────────────────────────────

const toolUseRec = (over = {}) => ({
  toolName: "Agent",
  ts: "2026-06-15T10:00:00.000Z",
  sessionId: "s1",
  cwd: "/home/u/proj",
  subagentType: "Explore",
  description: null,
  skill: null,
  ...over,
});

describe("computeToolUsage", () => {
  it("空配列入力 → [] を返す", () => {
    const result = computeToolUsage([]);
    expect(result).toEqual([]);
  });

  it("単一 Agent tool_use → key, calls, sessions を集計する", () => {
    const toolUseRecords = [
      toolUseRec({ subagentType: "Explore", sessionId: "s1" }),
    ];
    const result = computeToolUsage(toolUseRecords);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      toolName: "Agent",
      key: "Agent:Explore",
      name: "Explore",
      calls: 1,
      sessions: 1,
    });
  });

  it("同一ツール複数呼び出し → calls が加算される", () => {
    const toolUseRecords = [
      toolUseRec({ subagentType: "Explore", sessionId: "s1" }),
      toolUseRec({ subagentType: "Explore", sessionId: "s1" }),
      toolUseRec({ subagentType: "Explore", sessionId: "s1" }),
    ];
    const result = computeToolUsage(toolUseRecords);
    expect(result).toHaveLength(1);
    expect(result[0].calls).toBe(3);
    expect(result[0].sessions).toBe(1);
  });

  it("複数セッション → sessions がユニーク数になる", () => {
    const toolUseRecords = [
      toolUseRec({ subagentType: "Explore", sessionId: "s1" }),
      toolUseRec({ subagentType: "Explore", sessionId: "s2" }),
      toolUseRec({ subagentType: "Explore", sessionId: "s1" }),
    ];
    const result = computeToolUsage(toolUseRecords);
    expect(result).toHaveLength(1);
    expect(result[0].calls).toBe(3);
    expect(result[0].sessions).toBe(2);
  });

  it("sessionId が (unknown) のレコードは sessions 集計から除外される（calls には含まれる）", () => {
    const toolUseRecords = [
      toolUseRec({ subagentType: "Explore", sessionId: "s1" }),
      toolUseRec({ subagentType: "Explore", sessionId: "(unknown)" }),
      toolUseRec({ subagentType: "Explore", sessionId: "(unknown)" }),
    ];
    const result = computeToolUsage(toolUseRecords);
    expect(result).toHaveLength(1);
    expect(result[0].calls).toBe(3);
    expect(result[0].sessions).toBe(1);
  });

  it("Agent/Skill が key で分離集計される", () => {
    const toolUseRecords = [
      toolUseRec({ toolName: "Agent", subagentType: "Explore", sessionId: "s1" }),
      toolUseRec({ toolName: "Skill", skill: "codebase-onboarding", subagentType: null, sessionId: "s1" }),
      toolUseRec({ toolName: "Agent", subagentType: "Explore", sessionId: "s1" }),
    ];
    const result = computeToolUsage(toolUseRecords);
    expect(result).toHaveLength(2);
    const agent = result.find((r) => r.key === "Agent:Explore");
    const skill = result.find((r) => r.key === "Skill:codebase-onboarding");
    expect(agent.calls).toBe(2);
    expect(skill.calls).toBe(1);
  });

  it("calls 降順ソート", () => {
    const toolUseRecords = [
      toolUseRec({ subagentType: "Plan", sessionId: "s1" }),
      toolUseRec({ subagentType: "Explore", sessionId: "s1" }),
      toolUseRec({ subagentType: "Explore", sessionId: "s1" }),
      toolUseRec({ subagentType: "Explore", sessionId: "s1" }),
    ];
    const result = computeToolUsage(toolUseRecords);
    expect(result[0].name).toBe("Explore");
    expect(result[0].calls).toBe(3);
    expect(result[1].name).toBe("Plan");
    expect(result[1].calls).toBe(1);
  });

  it("aggregate() の戻り値に byTool が含まれ、toolUseRecords オプションで渡される", () => {
    const records = [rec({ sessionId: "s1" })];
    const toolUseRecords = [
      toolUseRec({ subagentType: "Explore", sessionId: "s1" }),
      toolUseRec({ subagentType: "Explore", sessionId: "s1" }),
    ];
    const result = aggregate(records, { toolUseRecords });
    expect(result.byTool).toBeDefined();
    expect(result.byTool).toHaveLength(1);
    expect(result.byTool[0]).toEqual({
      toolName: "Agent",
      key: "Agent:Explore",
      name: "Explore",
      calls: 2,
      sessions: 1,
    });
  });

  it("toolUseRecords 未指定時は byTool は []", () => {
    const records = [rec({ sessionId: "s1" })];
    const result = aggregate(records);
    expect(result.byTool).toEqual([]);
  });
});

// ─── computeMcpUsage ─────────────────────────────────────────────────────

const mcpUseRec = (over = {}) => ({
  toolName: "mcp__ccd_session__mark_chapter",
  ts: "2026-06-15T10:00:00.000Z",
  sessionId: "s1",
  cwd: "/home/u/proj",
  serverName: "ccd_session",
  mcpTool: "mark_chapter",
  ...over,
});

describe("computeMcpUsage", () => {
  it("空配列入力 → [] を返す", () => {
    expect(computeMcpUsage([])).toEqual([]);
  });

  it("同一サーバーの複数呼び出しが calls に集計される", () => {
    const toolUseRecords = [
      mcpUseRec({ serverName: "ccd_session", sessionId: "s1" }),
      mcpUseRec({ serverName: "ccd_session", sessionId: "s1" }),
      mcpUseRec({ serverName: "ccd_session", sessionId: "s1" }),
    ];
    const result = computeMcpUsage(toolUseRecords);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ serverName: "ccd_session", calls: 3, sessions: 1 });
  });

  it("複数セッションにまたがる呼び出しで sessions のユニーク数が正しい", () => {
    const toolUseRecords = [
      mcpUseRec({ serverName: "ccd_session", sessionId: "s1" }),
      mcpUseRec({ serverName: "ccd_session", sessionId: "s2" }),
      mcpUseRec({ serverName: "ccd_session", sessionId: "s1" }),
    ];
    const result = computeMcpUsage(toolUseRecords);
    expect(result).toHaveLength(1);
    expect(result[0].calls).toBe(3);
    expect(result[0].sessions).toBe(2);
  });

  it("sessionId が (unknown) のレコードは sessions にカウントされない", () => {
    const toolUseRecords = [
      mcpUseRec({ serverName: "ccd_session", sessionId: "s1" }),
      mcpUseRec({ serverName: "ccd_session", sessionId: "(unknown)" }),
      mcpUseRec({ serverName: "ccd_session", sessionId: "(unknown)" }),
    ];
    const result = computeMcpUsage(toolUseRecords);
    expect(result[0].calls).toBe(3);
    expect(result[0].sessions).toBe(1);
  });

  it("calls 降順ソート", () => {
    const toolUseRecords = [
      mcpUseRec({ serverName: "gh", sessionId: "s1" }),
      mcpUseRec({ serverName: "ccd_session", sessionId: "s1" }),
      mcpUseRec({ serverName: "ccd_session", sessionId: "s1" }),
      mcpUseRec({ serverName: "ccd_session", sessionId: "s1" }),
    ];
    const result = computeMcpUsage(toolUseRecords);
    expect(result[0].serverName).toBe("ccd_session");
    expect(result[0].calls).toBe(3);
    expect(result[1].serverName).toBe("gh");
    expect(result[1].calls).toBe(1);
  });

  it("aggregate() の戻り値に byMcpServer が含まれ、toolUseRecords オプションで渡される", () => {
    const records = [rec({ sessionId: "s1" })];
    const toolUseRecords = [
      mcpUseRec({ serverName: "ccd_session", sessionId: "s1" }),
      mcpUseRec({ serverName: "ccd_session", sessionId: "s1" }),
    ];
    const result = aggregate(records, { toolUseRecords });
    expect(result.byMcpServer).toBeDefined();
    expect(result.byMcpServer).toEqual([{ serverName: "ccd_session", calls: 2, sessions: 1 }]);
  });

  it("toolUseRecords 未指定時は byMcpServer は []（回帰なし）", () => {
    const records = [rec({ sessionId: "s1" })];
    const result = aggregate(records);
    expect(result.byMcpServer).toEqual([]);
  });
});

describe("aggregate thinking トークン内訳", () => {
  it("thinkingTokensApproxを持つレコードでthinking.approxTokensが合算される", () => {
    const s = aggregate([
      rec({ output: 1000, thinkingTokensApprox: 300, hasThinking: true, thinkingBlockCount: 1 }),
      rec({ output: 500, thinkingTokensApprox: 100, hasThinking: true, thinkingBlockCount: 1 }),
    ]);
    expect(s.thinking.approxTokens).toBe(400);
    expect(s.thinking.hasAnyThinking).toBe(true);
  });

  it("thinking.outputShareはapproxTokens/tokenSplit.outputで算出される", () => {
    const s = aggregate([
      rec({ output: 1000, thinkingTokensApprox: 400, hasThinking: true, thinkingBlockCount: 1 }),
    ]);
    expect(s.thinking.outputShare).toBeCloseTo(0.4, 10);
  });

  it("thinkingTokensApproxがtokenSplit.outputを上回る近似誤差でも、outputShareは1でクランプされる", () => {
    const s = aggregate([
      rec({ output: 100, thinkingTokensApprox: 150, hasThinking: true, thinkingBlockCount: 1 }),
    ]);
    expect(s.thinking.outputShare).toBe(1);
  });

  it("outputが0の場合、outputShareは0除算にならず0になる", () => {
    const s = aggregate([
      rec({ output: 0, thinkingTokensApprox: 0, hasThinking: false, thinkingBlockCount: 0 }),
    ]);
    expect(s.thinking.outputShare).toBe(0);
    expect(s.thinking.approxTokens).toBe(0);
    expect(s.thinking.hasAnyThinking).toBe(false);
  });

  it("thinking.isApproxは常にtrue（近似値であることを明示）", () => {
    const s = aggregate([rec({})]);
    expect(s.thinking.isApprox).toBe(true);
  });

  it("thinkingTokensApproxを持つレコードでもtotalCost・totalTokensが変化しない（二重計上防止）", () => {
    const withoutThinking = aggregate([rec({ output: 1000 })]);
    const withThinking = aggregate([
      rec({ output: 1000, thinkingTokensApprox: 800, hasThinking: true, thinkingBlockCount: 1 }),
    ]);
    expect(withThinking.totals.cost).toBeCloseTo(withoutThinking.totals.cost, 10);
    expect(withThinking.totals.tokens).toBe(withoutThinking.totals.tokens);
    expect(withThinking.tokenSplit.output).toBe(withoutThinking.tokenSplit.output);
    expect(withThinking.costSplit.output).toBeCloseTo(withoutThinking.costSplit.output, 10);
  });

  it("thinkingフィールドが無いレコード（既存rec()デフォルト）でもthinkingTokensApproxが0扱いになる（後方互換）", () => {
    const s = aggregate([rec({ output: 100 })]);
    expect(s.thinking.approxTokens).toBe(0);
    expect(s.thinking.hasAnyThinking).toBe(false);
    expect(s.thinking.outputShare).toBe(0);
  });

  it("byModel各要素にthinkingTokensApproxが合算される", () => {
    const s = aggregate([
      rec({ model: "claude-opus-4-8", output: 1000, thinkingTokensApprox: 300, hasThinking: true, thinkingBlockCount: 1 }),
      rec({ model: "claude-opus-4-8", output: 500, thinkingTokensApprox: 100, hasThinking: true, thinkingBlockCount: 1 }),
      rec({ model: "claude-haiku-4-5", output: 200 }),
    ]);
    const opus = s.models.find((m) => m.model === "claude-opus-4-8");
    const haiku = s.models.find((m) => m.model === "claude-haiku-4-5");
    expect(opus.thinkingTokensApprox).toBe(400);
    expect(haiku.thinkingTokensApprox).toBe(0);
  });

  it("byDay各要素にthinkingTokensApproxが合算される", () => {
    const s = aggregate([
      rec({ ts: "2026-06-15T10:00:00.000Z", output: 1000, thinkingTokensApprox: 300, hasThinking: true, thinkingBlockCount: 1 }),
      rec({ ts: "2026-06-15T12:00:00.000Z", output: 500, thinkingTokensApprox: 100, hasThinking: true, thinkingBlockCount: 1 }),
      rec({ ts: "2026-06-16T10:00:00.000Z", output: 200 }),
    ]);
    const day1 = s.daily.find((d) => d.date === "2026-06-15");
    const day2 = s.daily.find((d) => d.date === "2026-06-16");
    expect(day1.thinkingTokensApprox).toBe(400);
    expect(day2.thinkingTokensApprox).toBe(0);
  });

  it("既存のcacheStats・driversは引き続き正しく計算される（回帰なし）", () => {
    const s = aggregate([
      rec({ cacheCreate: 1000, cacheCreate1h: 1000, cache1h: true, thinkingTokensApprox: 50, hasThinking: true, thinkingBlockCount: 1 }),
    ]);
    expect(s.cacheStats.create1hTokens).toBe(1000);
    expect(s.drivers).toBeDefined();
  });
});

// ─── computeToolResultUsage ───────────────────────────────────────────────

const toolResultRec = (over = {}) => ({
  ts: "2026-06-15T10:00:00.000Z",
  sessionId: "s1",
  cwd: "/home/u/proj",
  toolUseId: "toolu_1",
  toolName: "Read",
  tokensApprox: 100,
  ...over,
});

describe("computeToolResultUsage", () => {
  it("空配列 -> []", () => {
    expect(computeToolResultUsage([])).toEqual([]);
  });

  it("複数種別が別々に集計される", () => {
    const records = [
      toolResultRec({ toolName: "Read", tokensApprox: 100, sessionId: "s1" }),
      toolResultRec({ toolName: "Bash", tokensApprox: 50, sessionId: "s1" }),
      toolResultRec({ toolName: "Read", tokensApprox: 200, sessionId: "s2" }),
    ];
    const result = computeToolResultUsage(records);
    expect(result).toHaveLength(2);
    const readEntry = result.find((r) => r.toolName === "Read");
    const bashEntry = result.find((r) => r.toolName === "Bash");
    expect(readEntry.tokensApprox).toBe(300);
    expect(readEntry.calls).toBe(2);
    expect(readEntry.sessions).toBe(2);
    expect(bashEntry.tokensApprox).toBe(50);
    expect(bashEntry.calls).toBe(1);
  });

  it("各エントリにisApprox: trueが付与される（近似値であることの明示）", () => {
    const records = [
      toolResultRec({ toolName: "Read", tokensApprox: 100 }),
      toolResultRec({ toolName: "Bash", tokensApprox: 50 }),
    ];
    const result = computeToolResultUsage(records);
    expect(result.every((r) => r.isApprox === true)).toBe(true);
  });

  it("unknownツール名も通常のツール名同様に集計される", () => {
    const records = [
      toolResultRec({ toolName: "unknown", tokensApprox: 10 }),
      toolResultRec({ toolName: "unknown", tokensApprox: 20 }),
    ];
    const result = computeToolResultUsage(records);
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe("unknown");
    expect(result[0].tokensApprox).toBe(30);
  });

  it("tokensApprox降順でソートされる", () => {
    const records = [
      toolResultRec({ toolName: "Grep", tokensApprox: 10 }),
      toolResultRec({ toolName: "Read", tokensApprox: 500 }),
      toolResultRec({ toolName: "Bash", tokensApprox: 100 }),
    ];
    const result = computeToolResultUsage(records);
    expect(result.map((r) => r.toolName)).toEqual(["Read", "Bash", "Grep"]);
  });

  it("sessionIdが(unknown)のレコードはsessions集計から除外される（tokensApproxには含む）", () => {
    const records = [
      toolResultRec({ toolName: "Read", tokensApprox: 100, sessionId: "s1" }),
      toolResultRec({ toolName: "Read", tokensApprox: 50, sessionId: "(unknown)" }),
    ];
    const result = computeToolResultUsage(records);
    expect(result[0].tokensApprox).toBe(150);
    expect(result[0].sessions).toBe(1);
  });
});

// ─── mergeToolResultTokensIntoSessions ────────────────────────────────────

describe("mergeToolResultTokensIntoSessions", () => {
  it("該当セッションにtoolResultTokensApproxが正しく合算される", () => {
    const sessions = [
      { sessionId: "s1", cost: 1, tokens: 100 },
      { sessionId: "s2", cost: 2, tokens: 200 },
    ];
    const toolResultRecords = [
      toolResultRec({ sessionId: "s1", tokensApprox: 300 }),
      toolResultRec({ sessionId: "s1", tokensApprox: 200 }),
      toolResultRec({ sessionId: "s2", tokensApprox: 50 }),
    ];
    const merged = mergeToolResultTokensIntoSessions(sessions, toolResultRecords);
    const s1 = merged.find((s) => s.sessionId === "s1");
    const s2 = merged.find((s) => s.sessionId === "s2");
    expect(s1.toolResultTokensApprox).toBe(500);
    expect(s2.toolResultTokensApprox).toBe(50);
  });

  it('sessionIdが"(unknown)"のtoolResultレコードは除外される', () => {
    const sessions = [{ sessionId: "s1", cost: 1, tokens: 100 }];
    const toolResultRecords = [
      toolResultRec({ sessionId: "(unknown)", tokensApprox: 999 }),
    ];
    const merged = mergeToolResultTokensIntoSessions(sessions, toolResultRecords);
    expect(merged[0].toolResultTokensApprox).toBe(0);
  });

  it("該当するtoolResultレコードが無いセッションは0になる", () => {
    const sessions = [{ sessionId: "s1", cost: 1, tokens: 100 }];
    const merged = mergeToolResultTokensIntoSessions(sessions, []);
    expect(merged[0].toolResultTokensApprox).toBe(0);
  });

  it("元のsessions配列やその要素を破壊的に変更しない（イミュータブル）", () => {
    const sessions = [{ sessionId: "s1", cost: 1, tokens: 100 }];
    const toolResultRecords = [toolResultRec({ sessionId: "s1", tokensApprox: 100 })];
    mergeToolResultTokensIntoSessions(sessions, toolResultRecords);
    expect(sessions[0].toolResultTokensApprox).toBeUndefined();
  });
});

// ─── aggregate(): toolResultBreakdown / bySession[].toolResultTokensApprox ─

describe("aggregate() toolResultBreakdown", () => {
  it("toolResultRecords オプションを渡すと toolResultBreakdown が戻り値に含まれる", () => {
    const records = [rec({ sessionId: "s1" })];
    const toolResultRecords = [
      toolResultRec({ sessionId: "s1", toolName: "Read", tokensApprox: 100 }),
    ];
    const result = aggregate(records, { toolResultRecords });
    expect(result.toolResultBreakdown).toBeDefined();
    expect(result.toolResultBreakdown).toHaveLength(1);
    expect(result.toolResultBreakdown[0].toolName).toBe("Read");
    expect(result.toolResultBreakdown[0].tokensApprox).toBe(100);
    expect(result.toolResultBreakdown[0].isApprox).toBe(true);
  });

  it("toolResultRecords 未指定時は toolResultBreakdown が []", () => {
    const result = aggregate([rec({ sessionId: "s1" })]);
    expect(result.toolResultBreakdown).toEqual([]);
  });

  it("totalCost・totalTokens・tokenSplit・costSplitにtoolResultのトークンが加算されない（二重計上防止）", () => {
    const records = [rec({ sessionId: "s1", output: 1000 })];
    const withoutToolResult = aggregate(records);
    const withToolResult = aggregate(records, {
      toolResultRecords: [toolResultRec({ sessionId: "s1", tokensApprox: 999999 })],
    });
    expect(withToolResult.totals.cost).toBeCloseTo(withoutToolResult.totals.cost, 10);
    expect(withToolResult.totals.tokens).toBe(withoutToolResult.totals.tokens);
    expect(withToolResult.tokenSplit).toEqual(withoutToolResult.tokenSplit);
    expect(withToolResult.costSplit).toEqual(withoutToolResult.costSplit);
  });

  it("bySession[].toolResultTokensApproxが正しく反映される", () => {
    const records = [rec({ sessionId: "s1" })];
    const toolResultRecords = [
      toolResultRec({ sessionId: "s1", tokensApprox: 300 }),
      toolResultRec({ sessionId: "s1", tokensApprox: 200 }),
    ];
    const result = aggregate(records, { toolResultRecords });
    const s1 = result.bySession.find((s) => s.sessionId === "s1");
    expect(s1.toolResultTokensApprox).toBe(500);
  });

  it("該当するtoolResultレコードが無いセッションはtoolResultTokensApproxが0", () => {
    const records = [rec({ sessionId: "s1" })];
    const result = aggregate(records);
    const s1 = result.bySession.find((s) => s.sessionId === "s1");
    expect(s1.toolResultTokensApprox).toBe(0);
  });

  it("sessionLimitでコスト上位から漏れる低コストセッションでも、tool_result肥大セッションはbySessionに追加で残る", () => {
    // s1: 低コスト・tool_result肥大（閾値超）、s2: 高コスト・tool_resultなし。sessionLimit=1。
    const records = [
      rec({ sessionId: "s1", input: 100 }),
      rec({ sessionId: "s2", input: 1_000_000 }),
    ];
    const toolResultRecords = [
      toolResultRec({ sessionId: "s1", tokensApprox: 60_000 }), // TOOL_RESULT_BLOAT_THRESHOLD(50_000)超
    ];
    const result = aggregate(records, { toolResultRecords, sessionLimit: 1 });
    // コスト上位1件(s2)に加え、tool_result肥大のs1が救済されるため2件になる。
    expect(result.bySession).toHaveLength(2);
    expect(result.bySession.map((s) => s.sessionId)).toEqual(expect.arrayContaining(["s1", "s2"]));
    const s1 = result.bySession.find((s) => s.sessionId === "s1");
    expect(s1.toolResultTokensApprox).toBe(60_000);
  });

  it("tool_result肥大でも閾値未満のセッションはsessionLimitで通常通り除外される", () => {
    const records = [
      rec({ sessionId: "s1", input: 100 }),
      rec({ sessionId: "s2", input: 1_000_000 }),
    ];
    const toolResultRecords = [
      toolResultRec({ sessionId: "s1", tokensApprox: 1000 }), // 閾値未満
    ];
    const result = aggregate(records, { toolResultRecords, sessionLimit: 1 });
    expect(result.bySession).toHaveLength(1);
    expect(result.bySession[0].sessionId).toBe("s2");
  });
});

// ─── computeToolResultOutliers ────────────────────────────────────────────

describe("computeToolResultOutliers", () => {
  it("空配列なら overCount:0 の空サマリを返す", () => {
    const result = computeToolResultOutliers([], { mcpCap: MCP_OUTPUT_CAP_TOKENS, bashCap: BASH_OUTPUT_CAP_TOKENS });
    expect(result).toEqual({
      overCount: 0,
      maxTokensApprox: 0,
      totalOverTokensApprox: 0,
      byTool: [],
      sampleSessions: [],
      isApprox: true,
    });
  });

  it("bashCap丁度(5000)は超過扱いしない、5001は超過扱いする（境界値）", () => {
    const records = [
      toolResultRec({ toolName: "Bash", tokensApprox: BASH_OUTPUT_CAP_TOKENS, sessionId: "s1" }),
      toolResultRec({ toolName: "Bash", tokensApprox: BASH_OUTPUT_CAP_TOKENS + 1, sessionId: "s2" }),
    ];
    const result = computeToolResultOutliers(records, { mcpCap: MCP_OUTPUT_CAP_TOKENS, bashCap: BASH_OUTPUT_CAP_TOKENS });
    expect(result.overCount).toBe(1);
    expect(result.maxTokensApprox).toBe(BASH_OUTPUT_CAP_TOKENS + 1);
  });

  it("mcp__fooは8000丁度で非超過、8001で超過（mcpCap閾値の境界値）", () => {
    const records = [
      toolResultRec({ toolName: "mcp__foo", tokensApprox: MCP_OUTPUT_CAP_TOKENS, sessionId: "s1" }),
      toolResultRec({ toolName: "mcp__foo", tokensApprox: MCP_OUTPUT_CAP_TOKENS + 1, sessionId: "s2" }),
    ];
    const result = computeToolResultOutliers(records, { mcpCap: MCP_OUTPUT_CAP_TOKENS, bashCap: BASH_OUTPUT_CAP_TOKENS });
    expect(result.overCount).toBe(1);
    expect(result.maxTokensApprox).toBe(MCP_OUTPUT_CAP_TOKENS + 1);
  });

  it("mcp__*はmcpCap、Bash（や他ツール）はbashCapで別々の閾値が適用される", () => {
    const records = [
      // bashCapを超えるがmcpCap未満（mcp__ツールなら非超過になるはずの値）
      toolResultRec({ toolName: "mcp__foo", tokensApprox: BASH_OUTPUT_CAP_TOKENS + 100, sessionId: "s1" }),
      toolResultRec({ toolName: "Bash", tokensApprox: BASH_OUTPUT_CAP_TOKENS + 100, sessionId: "s2" }),
      toolResultRec({ toolName: "Read", tokensApprox: BASH_OUTPUT_CAP_TOKENS + 100, sessionId: "s3" }),
    ];
    const result = computeToolResultOutliers(records, { mcpCap: MCP_OUTPUT_CAP_TOKENS, bashCap: BASH_OUTPUT_CAP_TOKENS });
    // mcp__foo は mcpCap(8000) 未満なので超過なし。Bash/Read は bashCap(5000) 超なので超過。
    expect(result.overCount).toBe(2);
    const toolNames = result.byTool.map((t) => t.toolName);
    expect(toolNames).not.toContain("mcp__foo");
    expect(toolNames).toEqual(expect.arrayContaining(["Bash", "Read"]));
  });

  it("byToolはツール別にoverCountとmaxTokensApproxを正しく集計し降順ソートされる", () => {
    const records = [
      toolResultRec({ toolName: "Bash", tokensApprox: BASH_OUTPUT_CAP_TOKENS + 100, sessionId: "s1" }),
      toolResultRec({ toolName: "Bash", tokensApprox: BASH_OUTPUT_CAP_TOKENS + 500, sessionId: "s2" }),
      toolResultRec({ toolName: "Read", tokensApprox: BASH_OUTPUT_CAP_TOKENS + 9000, sessionId: "s3" }),
    ];
    const result = computeToolResultOutliers(records, { mcpCap: MCP_OUTPUT_CAP_TOKENS, bashCap: BASH_OUTPUT_CAP_TOKENS });
    expect(result.byTool).toEqual([
      { toolName: "Read", overCount: 1, maxTokensApprox: BASH_OUTPUT_CAP_TOKENS + 9000 },
      { toolName: "Bash", overCount: 2, maxTokensApprox: BASH_OUTPUT_CAP_TOKENS + 500 },
    ]);
  });

  it("sampleSessionsはtokensApprox降順で並び、sessionIdが(unknown)のレコードは除外される", () => {
    const records = [
      toolResultRec({ toolName: "Bash", tokensApprox: BASH_OUTPUT_CAP_TOKENS + 100, sessionId: "s1" }),
      toolResultRec({ toolName: "Bash", tokensApprox: BASH_OUTPUT_CAP_TOKENS + 9000, sessionId: "(unknown)" }),
      toolResultRec({ toolName: "Read", tokensApprox: BASH_OUTPUT_CAP_TOKENS + 500, sessionId: "s2" }),
    ];
    const result = computeToolResultOutliers(records, { mcpCap: MCP_OUTPUT_CAP_TOKENS, bashCap: BASH_OUTPUT_CAP_TOKENS });
    expect(result.sampleSessions.map((s) => s.sessionId)).toEqual(["s2", "s1"]);
    expect(result.sampleSessions[0].tokensApprox).toBe(BASH_OUTPUT_CAP_TOKENS + 500);
  });

  it("totalOverTokensApproxは超過レコードのみの合算になる", () => {
    const records = [
      toolResultRec({ toolName: "Bash", tokensApprox: BASH_OUTPUT_CAP_TOKENS, sessionId: "s1" }), // 非超過
      toolResultRec({ toolName: "Bash", tokensApprox: BASH_OUTPUT_CAP_TOKENS + 100, sessionId: "s2" }), // 超過
      toolResultRec({ toolName: "Read", tokensApprox: BASH_OUTPUT_CAP_TOKENS + 200, sessionId: "s3" }), // 超過
    ];
    const result = computeToolResultOutliers(records, { mcpCap: MCP_OUTPUT_CAP_TOKENS, bashCap: BASH_OUTPUT_CAP_TOKENS });
    expect(result.totalOverTokensApprox).toBe((BASH_OUTPUT_CAP_TOKENS + 100) + (BASH_OUTPUT_CAP_TOKENS + 200));
  });
});

// ─── computeDuplicateReads ────────────────────────────────────────────────

const readUseRec = (over = {}) => ({
  toolName: "Read",
  ts: "2026-06-15T10:00:00.000Z",
  sessionId: "s1",
  cwd: "/home/u/proj",
  subagentType: null,
  description: null,
  skill: null,
  filePath: "/home/u/proj/a.txt",
  toolUseId: "toolu_r1",
  ...over,
});

describe("computeDuplicateReads", () => {
  it("空入力で0値・空配列・isApprox: trueを返す", () => {
    const result = computeDuplicateReads([], []);
    expect(result).toEqual({
      totalDuplicateReads: 0,
      totalDuplicateTokensApprox: 0,
      byFile: [],
      isApprox: true,
    });
  });

  it("同一セッション×同一filePathの2回目以降を重複として数える", () => {
    const toolUseRecords = [
      readUseRec({ toolUseId: "toolu_1" }),
      readUseRec({ toolUseId: "toolu_2" }),
      readUseRec({ toolUseId: "toolu_3" }),
    ];
    const result = computeDuplicateReads(toolUseRecords, []);
    expect(result.totalDuplicateReads).toBe(2);
    expect(result.byFile).toHaveLength(1);
    expect(result.byFile[0].filePath).toBe("/home/u/proj/a.txt");
    expect(result.byFile[0].readCount).toBe(3);
    expect(result.byFile[0].duplicateCount).toBe(2);
  });

  it("初回のみのReadは重複に数えない", () => {
    const result = computeDuplicateReads([readUseRec()], []);
    expect(result.totalDuplicateReads).toBe(0);
    expect(result.byFile).toEqual([]);
  });

  it("異なるセッションの同一filePathは重複としない", () => {
    const toolUseRecords = [
      readUseRec({ toolUseId: "toolu_1", sessionId: "s1" }),
      readUseRec({ toolUseId: "toolu_2", sessionId: "s2" }),
    ];
    const result = computeDuplicateReads(toolUseRecords, []);
    expect(result.totalDuplicateReads).toBe(0);
  });

  it("重複Readのtool_resultトークンをtoolUseIdで突合し推定重複トークンとして合算する", () => {
    const toolUseRecords = [
      readUseRec({ toolUseId: "toolu_1" }),
      readUseRec({ toolUseId: "toolu_2" }),
      readUseRec({ toolUseId: "toolu_3" }),
    ];
    const toolResultRecords = [
      toolResultRec({ toolUseId: "toolu_1", tokensApprox: 100 }), // 初回: 非重複
      toolResultRec({ toolUseId: "toolu_2", tokensApprox: 120 }),
      toolResultRec({ toolUseId: "toolu_3", tokensApprox: 130 }),
    ];
    const result = computeDuplicateReads(toolUseRecords, toolResultRecords);
    expect(result.totalDuplicateTokensApprox).toBe(250);
    expect(result.byFile[0].duplicateTokensApprox).toBe(250);
  });

  it("対応するtool_resultが無い重複Readはトークン0として数える", () => {
    const toolUseRecords = [
      readUseRec({ toolUseId: "toolu_1" }),
      readUseRec({ toolUseId: "toolu_2" }),
    ];
    const result = computeDuplicateReads(toolUseRecords, []);
    expect(result.totalDuplicateReads).toBe(1);
    expect(result.totalDuplicateTokensApprox).toBe(0);
  });

  it("byFileはduplicateTokensApprox降順で上位10件に制限される", () => {
    const toolUseRecords = [];
    const toolResultRecords = [];
    for (let i = 0; i < 12; i++) {
      const filePath = `/home/u/proj/f${i}.txt`;
      toolUseRecords.push(
        readUseRec({ filePath, toolUseId: `toolu_${i}_a` }),
        readUseRec({ filePath, toolUseId: `toolu_${i}_b` }),
      );
      toolResultRecords.push(toolResultRec({ toolUseId: `toolu_${i}_b`, tokensApprox: (i + 1) * 10 }));
    }
    const result = computeDuplicateReads(toolUseRecords, toolResultRecords);
    expect(result.byFile).toHaveLength(10);
    expect(result.byFile[0].filePath).toBe("/home/u/proj/f11.txt");
    expect(result.byFile[0].duplicateTokensApprox).toBe(120);
    expect(result.totalDuplicateReads).toBe(12);
  });

  it("Read以外のtool_useレコードとfilePath欠落レコードは無視する", () => {
    const toolUseRecords = [
      { toolName: "Agent", sessionId: "s1", subagentType: "Explore", description: null, skill: null },
      readUseRec({ filePath: null, toolUseId: "toolu_1" }),
      readUseRec({ filePath: null, toolUseId: "toolu_2" }),
    ];
    const result = computeDuplicateReads(toolUseRecords, []);
    expect(result.totalDuplicateReads).toBe(0);
    expect(result.byFile).toEqual([]);
  });
});
