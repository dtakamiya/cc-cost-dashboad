import { describe, it, expect, vi, afterEach } from "vitest";
import { aggregate, filterRecordsByPeriod, computeCacheGapStats, CACHE_5M_TTL_MS, CACHE_1H_TTL_MS } from "./aggregate.js";
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
