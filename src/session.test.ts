import { describe, it, expect } from "vitest";
import {
  isBloatedSession,
  BLOAT_CONTEXT_THRESHOLD,
  BLOAT_MIN_MESSAGES,
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
  ...over,
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
