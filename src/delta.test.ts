import { describe, it, expect } from "vitest";
import { computePreviousPeriod, computeDelta, type DailyCost } from "./api";

const day = (date: string, total: number, tokenTotal: number, sessions: number): DailyCost => ({
  date,
  models: {},
  total,
  tokenModels: {},
  tokenTotal,
  projectTokens: {},
  sessions,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheReadRatio: 0,
});

describe("computePreviousPeriod", () => {
  it("直前の同日数スライスを返す", () => {
    const daily: DailyCost[] = [
      day("2026-06-01", 10, 100, 1),
      day("2026-06-02", 20, 200, 2),
      day("2026-06-03", 30, 300, 3),
      day("2026-06-04", 40, 400, 4),
    ];
    // periodDays=2 → 直近2日は 2026-06-03/04、前期間は 2026-06-01/02
    const prev = computePreviousPeriod(daily, "2026-06-03", 2);
    expect(prev?.cost).toBeCloseTo(30); // 10 + 20
    expect(prev?.tokens).toBeCloseTo(300); // 100 + 200
    expect(prev?.sessions).toBe(3); // 1 + 2
  });

  it("前期間データが足りない場合は null を返す", () => {
    const daily: DailyCost[] = [
      day("2026-06-03", 30, 300, 3),
      day("2026-06-04", 40, 400, 4),
    ];
    const prev = computePreviousPeriod(daily, "2026-06-03", 2);
    expect(prev).toBeNull();
  });
});

describe("computeDelta", () => {
  it("前期間比のパーセント差分を返す（sessions は常に null）", () => {
    const delta = computeDelta(
      { cost: 120, tokens: 1200, sessions: 12 },
      { cost: 100, tokens: 1000, sessions: 10 }
    );
    expect(delta?.cost).toBeCloseTo(20);
    expect(delta?.tokens).toBeCloseTo(20);
    expect(delta?.sessions).toBeNull(); // daily.sessions が populate されないため常に null
  });

  it("前期間が0の項目は null（0除算回避）、sessions は常に null", () => {
    const delta = computeDelta(
      { cost: 120, tokens: 0, sessions: 12 },
      { cost: 0, tokens: 0, sessions: 10 }
    );
    expect(delta?.cost).toBeNull();
    expect(delta?.tokens).toBeNull();
    expect(delta?.sessions).toBeNull(); // daily.sessions が populate されないため常に null
  });

  it("前期間が null なら null を返す", () => {
    const delta = computeDelta({ cost: 120, tokens: 100, sessions: 5 }, null);
    expect(delta).toBeNull();
  });
});
