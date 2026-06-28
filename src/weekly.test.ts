import { describe, it, expect } from "vitest";
import { weekStartOf, toWeekly, toHourly } from "./weekly";
import type { DailyCost, HourlyData } from "./api";

const day = (date: string, models: Record<string, number>, tokenModels: Record<string, number>): DailyCost => ({
  date,
  models,
  total: Object.values(models).reduce((s, v) => s + v, 0),
  tokenModels,
  tokenTotal: Object.values(tokenModels).reduce((s, v) => s + v, 0),
  projectTokens: {},
});

describe("weekStartOf", () => {
  it("月曜はその日自身を返す", () => {
    expect(weekStartOf("2026-06-22")).toBe("2026-06-22"); // 月
  });

  it("週内の他の曜日は同じ週の月曜を返す", () => {
    expect(weekStartOf("2026-06-27")).toBe("2026-06-22"); // 土 → 月
    expect(weekStartOf("2026-06-24")).toBe("2026-06-22"); // 水 → 月
  });

  it("日曜は前週の月曜を返す（月曜始まり）", () => {
    expect(weekStartOf("2026-06-21")).toBe("2026-06-15"); // 日 → 前週月
  });

  it("月跨ぎでも正しい月曜を返す", () => {
    expect(weekStartOf("2026-07-01")).toBe("2026-06-29"); // 水 → 月(6/29)
  });
});

describe("toWeekly", () => {
  it("空配列は空配列を返す", () => {
    expect(toWeekly([])).toEqual([]);
  });

  it("同一週の複数日を1行に合算する", () => {
    const daily = [
      day("2026-06-22", { opus: 1 }, { opus: 100 }),
      day("2026-06-24", { opus: 2 }, { opus: 200 }),
    ];
    const w = toWeekly(daily);
    expect(w).toHaveLength(1);
    expect(w[0].weekStart).toBe("2026-06-22");
    expect(w[0].total).toBe(3);
    expect(w[0].tokenTotal).toBe(300);
    expect(w[0].models).toEqual({ opus: 3 });
    expect(w[0].tokenModels).toEqual({ opus: 300 });
  });

  it("モデル別に合算する", () => {
    const daily = [
      day("2026-06-22", { opus: 1, sonnet: 5 }, { opus: 100, sonnet: 500 }),
      day("2026-06-23", { opus: 2 }, { opus: 200 }),
    ];
    const w = toWeekly(daily);
    expect(w[0].models).toEqual({ opus: 3, sonnet: 5 });
    expect(w[0].tokenModels).toEqual({ opus: 300, sonnet: 500 });
  });

  it("別週は別行になり weekStart 昇順でソートされる", () => {
    const daily = [
      day("2026-06-29", { opus: 9 }, { opus: 900 }), // 翌週
      day("2026-06-22", { opus: 1 }, { opus: 100 }), // 前週
    ];
    const w = toWeekly(daily);
    expect(w.map((x) => x.weekStart)).toEqual(["2026-06-22", "2026-06-29"]);
    expect(w[0].total).toBe(1);
    expect(w[1].total).toBe(9);
  });
});

describe("toHourly", () => {
  it("空配列は空配列を返す", () => {
    expect(toHourly([])).toEqual([]);
  });

  it("単一データを変換する", () => {
    const hourly: HourlyData[] = [
      {
        hour: 0,
        tokens: 1500,
        cost: 0.5,
        models: [
          { model: "claude-opus-4-8", cost: 0.3, tokens: 900 },
          { model: "claude-sonnet-4-6", cost: 0.2, tokens: 600 }
        ]
      }
    ];
    const result = toHourly(hourly);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("hour", 0);
    expect(result[0]).toHaveProperty("tokens", 1500);
    expect(result[0]).toHaveProperty("cost", 0.5);
    expect(result[0]).toHaveProperty("breakdown");
  });

  it("複数時間のデータを変換する", () => {
    const hourly: HourlyData[] = [
      {
        hour: 0,
        tokens: 1500,
        cost: 0.5,
        models: [{ model: "claude-opus-4-8", cost: 0.5, tokens: 1500 }]
      },
      {
        hour: 1,
        tokens: 2300,
        cost: 0.8,
        models: [{ model: "claude-opus-4-8", cost: 0.8, tokens: 2300 }]
      }
    ];
    const result = toHourly(hourly);
    expect(result).toHaveLength(2);
    expect(result[0].hour).toBe(0);
    expect(result[1].hour).toBe(1);
  });

  it("モデル内訳を保持する", () => {
    const hourly: HourlyData[] = [
      {
        hour: 2,
        tokens: 3000,
        cost: 1.2,
        models: [
          { model: "claude-opus-4-8", cost: 0.7, tokens: 1750 },
          { model: "claude-sonnet-4-6", cost: 0.5, tokens: 1250 }
        ]
      }
    ];
    const result = toHourly(hourly);
    expect(result[0].breakdown).toHaveLength(2);
    expect(result[0].breakdown[0].model).toBe("claude-opus-4-8");
    expect(result[0].breakdown[0].cost).toBe(0.7);
    expect(result[0].breakdown[0].tokens).toBe(1750);
    expect(result[0].breakdown[1].model).toBe("claude-sonnet-4-6");
    expect(result[0].breakdown[1].cost).toBe(0.5);
  });
});
