import { describe, it, expect } from "vitest";
import { activeBurnWarning, DEFAULT_BURN_THRESHOLD_PER_MIN } from "./api";
import type { Block } from "./api";

const block = (over: Partial<Block>): Block => ({
  start: "2026-06-27T00:00:00.000Z",
  end: "2026-06-27T05:00:00.000Z",
  isActive: false,
  cost: 0,
  tokens: 0,
  durationMin: 0,
  remainMin: 0,
  burnRatePerMin: 0,
  recentBurnRatePerMin: 0,
  topModel: null,
  ...over,
});

describe("activeBurnWarning", () => {
  it("アクティブブロックが無ければ null", () => {
    const blocks = [block({ isActive: false, recentBurnRatePerMin: 99 })];
    expect(activeBurnWarning(blocks)).toBeNull();
  });

  it("空配列は null", () => {
    expect(activeBurnWarning([])).toBeNull();
  });

  it("recentBurnRatePerMin が閾値未満なら null", () => {
    const blocks = [
      block({ isActive: true, recentBurnRatePerMin: DEFAULT_BURN_THRESHOLD_PER_MIN - 0.01 }),
    ];
    expect(activeBurnWarning(blocks)).toBeNull();
  });

  it("閾値以上なら perMin と remainMin を返す", () => {
    const blocks = [
      block({ isActive: true, recentBurnRatePerMin: 0.8, remainMin: 42 }),
    ];
    expect(activeBurnWarning(blocks)).toEqual({ perMin: 0.8, remainMin: 42 });
  });

  it("閾値ちょうどでも警告を返す", () => {
    const blocks = [
      block({ isActive: true, recentBurnRatePerMin: DEFAULT_BURN_THRESHOLD_PER_MIN, remainMin: 10 }),
    ];
    expect(activeBurnWarning(blocks)).toEqual({
      perMin: DEFAULT_BURN_THRESHOLD_PER_MIN,
      remainMin: 10,
    });
  });

  it("カスタム閾値を尊重する", () => {
    const blocks = [block({ isActive: true, recentBurnRatePerMin: 0.3, remainMin: 5 })];
    expect(activeBurnWarning(blocks, 0.2)).toEqual({ perMin: 0.3, remainMin: 5 });
    expect(activeBurnWarning(blocks, 0.5)).toBeNull();
  });

  it("burnRatePerMin が高くても recentBurnRatePerMin が閾値未満なら null", () => {
    const blocks = [
      block({ isActive: true, burnRatePerMin: 0.9, recentBurnRatePerMin: 0.1 }),
    ];
    expect(activeBurnWarning(blocks)).toBeNull();
  });

  it("burnRatePerMin が低くても recentBurnRatePerMin が閾値以上なら警告", () => {
    const blocks = [
      block({ isActive: true, burnRatePerMin: 0.1, recentBurnRatePerMin: 0.8, remainMin: 30 }),
    ];
    expect(activeBurnWarning(blocks)).toEqual({ perMin: 0.8, remainMin: 30 });
  });
});
