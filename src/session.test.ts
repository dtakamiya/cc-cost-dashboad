import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isBloatedSession,
  BLOAT_CONTEXT_THRESHOLD,
  BLOAT_MIN_MESSAGES,
  fetchSessionTurns,
  filterSessions,
  computeCumulativeCostCurve,
  SPIKE_RATIO_THRESHOLD,
  computeCumulativeInputCurve,
  PROACTIVE_COMPACT_THRESHOLD,
} from "./api";
import type { SessionCost, SessionTurn } from "./api";

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
  firstTs: "2026-06-27T00:00:00.000Z",
  lastTs: "2026-06-27T01:00:00.000Z",
  avgContextPerMsg: 0,
  topModel: null,
  compactionCount: 0,
  ...over,
});

describe("fetchSessionTurns", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("正常レスポンスを SessionTurn[] として返す", async () => {
    const mockTurns = [
      { ts: "2026-06-27T01:00:00.000Z", model: "claude-sonnet-4-6", input: 1000, output: 500, cacheCreate: 0, cacheRead: 0, cost: 0.001 },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTurns),
    }));
    const result = await fetchSessionTurns("sess-abc");
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("claude-sonnet-4-6");
    expect(result[0].cost).toBe(0.001);
  });

  it("fetch が失敗したとき Error をスローする", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchSessionTurns("sess-abc")).rejects.toThrow("session turns fetch failed");
  });

  it("正しいURLにリクエストする", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal("fetch", mockFetch);
    await fetchSessionTurns("my-session-id");
    expect(mockFetch).toHaveBeenCalledWith("/api/sessions/my-session-id/turns");
  });
});

describe("filterSessions", () => {
  const sess = (over: Partial<SessionCost>): SessionCost => ({
    sessionId: "s1",
    cwd: "/home/u/proj",
    cost: 0,
    tokens: 0,
    messages: 0,
    input: 0,
    output: 0,
    cacheCreate: 0,
    cacheRead: 0,
    firstTs: null,
    lastTs: null,
    avgContextPerMsg: 0,
    topModel: null,
    compactionCount: 0,
    ...over,
  });

  it("クエリが空の場合は全件返す", () => {
    const sessions = [
      sess({ sessionId: "s1", cwd: "/home/u/proj-a" }),
      sess({ sessionId: "s2", cwd: "/home/u/proj-b" }),
    ];
    expect(filterSessions(sessions, "", "")).toHaveLength(2);
  });

  it("cwd の部分一致でフィルタする（大文字小文字を区別しない）", () => {
    const sessions = [
      sess({ sessionId: "s1", cwd: "/home/u/MyProject" }),
      sess({ sessionId: "s2", cwd: "/home/u/other" }),
    ];
    const result = filterSessions(sessions, "myproject", "");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s1");
  });

  it("topModel.model の部分一致でフィルタする（大文字小文字を区別しない）", () => {
    const sessions = [
      sess({ sessionId: "s1", topModel: { model: "claude-opus-4-8", cost: 1 } }),
      sess({ sessionId: "s2", topModel: { model: "claude-haiku-4-5", cost: 0.1 } }),
    ];
    const result = filterSessions(sessions, "", "opus");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s1");
  });

  it("cwd とモデル両方指定したとき両方一致するものだけ返す", () => {
    const sessions = [
      sess({ sessionId: "s1", cwd: "/home/u/proj-a", topModel: { model: "claude-opus-4-8", cost: 1 } }),
      sess({ sessionId: "s2", cwd: "/home/u/proj-a", topModel: { model: "claude-haiku-4-5", cost: 0.1 } }),
      sess({ sessionId: "s3", cwd: "/home/u/proj-b", topModel: { model: "claude-opus-4-8", cost: 1 } }),
    ];
    const result = filterSessions(sessions, "proj-a", "opus");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s1");
  });

  it("topModel が null の場合モデルフィルタで除外される", () => {
    const sessions = [
      sess({ sessionId: "s1", topModel: null }),
    ];
    expect(filterSessions(sessions, "", "opus")).toHaveLength(0);
  });
});

describe("isBloatedSession", () => {
  it("閾値超かつメッセージ数十分なら肥大化", () => {
    const s = session({
      messages: BLOAT_MIN_MESSAGES,
      avgContextPerMsg: BLOAT_CONTEXT_THRESHOLD + 1,
    });
    expect(isBloatedSession(s)).toBe(true);
  });

  it("閾値ちょうどは肥大化ではない（超過が条件）", () => {
    const s = session({
      messages: BLOAT_MIN_MESSAGES,
      avgContextPerMsg: BLOAT_CONTEXT_THRESHOLD,
    });
    expect(isBloatedSession(s)).toBe(false);
  });

  it("メッセージ数が不足なら肥大化ではない", () => {
    const s = session({
      messages: BLOAT_MIN_MESSAGES - 1,
      avgContextPerMsg: BLOAT_CONTEXT_THRESHOLD * 5,
    });
    expect(isBloatedSession(s)).toBe(false);
  });

  it("コンテキストが小さければ肥大化ではない", () => {
    const s = session({ messages: 100, avgContextPerMsg: 1000 });
    expect(isBloatedSession(s)).toBe(false);
  });

  it("カスタム閾値を尊重する", () => {
    const s = session({ messages: 3, avgContextPerMsg: 50_000 });
    expect(isBloatedSession(s, 40_000, 2)).toBe(true);
    expect(isBloatedSession(s, 60_000, 2)).toBe(false);
  });
});

describe("computeCumulativeCostCurve", () => {
  const turn = (over: Partial<SessionTurn>): SessionTurn => ({
    ts: null,
    model: "claude-sonnet-4-6",
    input: 0,
    output: 0,
    cacheCreate: 0,
    cacheRead: 0,
    cost: 0,
    ...over,
  });

  it("空配列を渡すと空配列を返す", () => {
    expect(computeCumulativeCostCurve([])).toEqual([]);
  });

  it("単一ターンでもエラーにならず1点で描画できる", () => {
    const result = computeCumulativeCostCurve([turn({ cost: 0.01 })]);
    expect(result).toHaveLength(1);
    expect(result[0].turnIndex).toBe(1);
    expect(result[0].cumulativeCost).toBeCloseTo(0.01);
    expect(result[0].isSpike).toBe(false);
  });

  it("累積コストが単調増加する", () => {
    const turns = [
      turn({ cost: 0.01 }),
      turn({ cost: 0.02 }),
      turn({ cost: 0.005 }),
    ];
    const result = computeCumulativeCostCurve(turns);
    expect(result.map((r) => r.turnIndex)).toEqual([1, 2, 3]);
    expect(result[0].cumulativeCost).toBeCloseTo(0.01);
    expect(result[1].cumulativeCost).toBeCloseTo(0.03);
    expect(result[2].cumulativeCost).toBeCloseTo(0.035);
    // 単調増加であること
    for (let i = 1; i < result.length; i++) {
      expect(result[i].cumulativeCost).toBeGreaterThanOrEqual(result[i - 1].cumulativeCost);
    }
  });

  it("傾きが急増したターンを isSpike = true としてマークする", () => {
    // 前のターンまでの平均コストに対し、SPIKE_RATIO_THRESHOLD 倍を超えるターンをスパイクとする
    const turns = [
      turn({ cost: 0.01 }),
      turn({ cost: 0.01 }),
      turn({ cost: 0.01 }),
      turn({ cost: 0.01 * (SPIKE_RATIO_THRESHOLD + 1) }), // 急増
    ];
    const result = computeCumulativeCostCurve(turns);
    expect(result[0].isSpike).toBe(false);
    expect(result[1].isSpike).toBe(false);
    expect(result[2].isSpike).toBe(false);
    expect(result[3].isSpike).toBe(true);
  });

  it("最初のターンは比較対象がないため isSpike は常に false", () => {
    const result = computeCumulativeCostCurve([turn({ cost: 100 })]);
    expect(result[0].isSpike).toBe(false);
  });
});

describe("computeCumulativeInputCurve", () => {
  const turn = (over: Partial<SessionTurn>): SessionTurn => ({
    ts: null,
    model: "claude-sonnet-4-6",
    input: 0,
    output: 0,
    cacheCreate: 0,
    cacheRead: 0,
    cost: 0,
    ...over,
  });

  it("空配列を渡すと空配列を返す", () => {
    expect(computeCumulativeInputCurve([])).toEqual([]);
  });

  it("各ターンの cacheRead + input を累積加算する", () => {
    const turns = [
      turn({ input: 1000, cacheRead: 2000 }),
      turn({ input: 500, cacheRead: 1500 }),
    ];
    const result = computeCumulativeInputCurve(turns);
    expect(result[0].input).toBe(3000);
    expect(result[0].cumulativeInput).toBe(3000);
    expect(result[1].input).toBe(2000);
    expect(result[1].cumulativeInput).toBe(5000);
  });

  it("turnIndex は1始まり", () => {
    const turns = [turn({ input: 1 }), turn({ input: 1 }), turn({ input: 1 })];
    const result = computeCumulativeInputCurve(turns);
    expect(result.map((r) => r.turnIndex)).toEqual([1, 2, 3]);
  });

  it("累積が閾値未満のターンは exceedsThreshold = false", () => {
    const result = computeCumulativeInputCurve([turn({ input: 100, cacheRead: 100 })]);
    expect(result[0].cumulativeInput).toBe(200);
    expect(result[0].exceedsThreshold).toBe(false);
  });

  it("累積が PROACTIVE_COMPACT_THRESHOLD を超えたターンで exceedsThreshold = true になる", () => {
    const turns = [
      turn({ input: PROACTIVE_COMPACT_THRESHOLD - 1000 }),
      turn({ input: 2000 }), // 累積が閾値を超える
    ];
    const result = computeCumulativeInputCurve(turns);
    expect(result[0].exceedsThreshold).toBe(false);
    expect(result[1].cumulativeInput).toBe(PROACTIVE_COMPACT_THRESHOLD + 1000);
    expect(result[1].exceedsThreshold).toBe(true);
  });

  it("境界値: ちょうど閾値は超過扱いにしない（> 比較で統一）", () => {
    const result = computeCumulativeInputCurve([turn({ input: PROACTIVE_COMPACT_THRESHOLD })]);
    expect(result[0].cumulativeInput).toBe(PROACTIVE_COMPACT_THRESHOLD);
    expect(result[0].exceedsThreshold).toBe(false);
  });

  it("閾値+1から超過扱いになる", () => {
    const result = computeCumulativeInputCurve([turn({ input: PROACTIVE_COMPACT_THRESHOLD + 1 })]);
    expect(result[0].exceedsThreshold).toBe(true);
  });

  it("一度超過したら以降のターンも exceedsThreshold = true のまま", () => {
    const turns = [
      turn({ input: PROACTIVE_COMPACT_THRESHOLD + 1 }),
      turn({ input: 0 }),
      turn({ input: 0 }),
    ];
    const result = computeCumulativeInputCurve(turns);
    expect(result[0].exceedsThreshold).toBe(true);
    expect(result[1].exceedsThreshold).toBe(true);
    expect(result[2].exceedsThreshold).toBe(true);
  });
});
