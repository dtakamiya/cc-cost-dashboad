import { describe, it, expect } from "vitest";
import { aggregate } from "./aggregate.js";

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
