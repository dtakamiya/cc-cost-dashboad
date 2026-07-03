import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isBloatedSession,
  BLOAT_CONTEXT_THRESHOLD,
  BLOAT_MIN_MESSAGES,
  fetchSessionTurns,
  filterSessions,
} from "./api";
import type { SessionCost } from "./api";

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
