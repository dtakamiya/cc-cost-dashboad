import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  getBudgetLimit,
  setBudgetLimit,
  clearBudgetLimit,
  calcBudgetProgress,
  type BudgetProgress,
} from "./budget";

const STORAGE_KEY = "cc_budget_limit";

const makeLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
};

const localStorageMock = makeLocalStorageMock();

vi.stubGlobal("localStorage", localStorageMock);

describe("getBudgetLimit", () => {
  beforeEach(() => localStorage.clear());

  test("未設定の場合は null を返す", () => {
    expect(getBudgetLimit()).toBeNull();
  });

  test("設定済みの値を数値で返す", () => {
    localStorage.setItem(STORAGE_KEY, "100");
    expect(getBudgetLimit()).toBe(100);
  });

  test("不正な値は null を返す", () => {
    localStorage.setItem(STORAGE_KEY, "abc");
    expect(getBudgetLimit()).toBeNull();
  });

  test("0以下の値は null を返す", () => {
    localStorage.setItem(STORAGE_KEY, "0");
    expect(getBudgetLimit()).toBeNull();
    localStorage.setItem(STORAGE_KEY, "-50");
    expect(getBudgetLimit()).toBeNull();
  });
});

describe("setBudgetLimit", () => {
  beforeEach(() => localStorage.clear());

  test("正の値を localStorage に保存する", () => {
    setBudgetLimit(150);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("150");
  });

  test("小数点を含む値も保存できる", () => {
    setBudgetLimit(99.99);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("99.99");
  });

  test("0以下の値は TypeError を投げる", () => {
    expect(() => setBudgetLimit(0)).toThrow(TypeError);
    expect(() => setBudgetLimit(-10)).toThrow(TypeError);
  });

  test("NaN は TypeError を投げる", () => {
    expect(() => setBudgetLimit(NaN)).toThrow(TypeError);
  });

  test("Infinity は TypeError を投げる", () => {
    expect(() => setBudgetLimit(Infinity)).toThrow(TypeError);
  });
});

describe("clearBudgetLimit", () => {
  test("localStorage から予算を削除する", () => {
    localStorage.setItem(STORAGE_KEY, "200");
    clearBudgetLimit();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("calcBudgetProgress", () => {
  test("予算未設定の場合は null を返す", () => {
    expect(calcBudgetProgress(50, 80, null)).toBeNull();
  });

  test("予算0の場合は null を返す", () => {
    expect(calcBudgetProgress(50, 80, 0)).toBeNull();
  });

  test("正常ケース：実績と予測が予算内", () => {
    const result = calcBudgetProgress(50, 80, 100) as BudgetProgress;
    expect(result).not.toBeNull();
    expect(result.actualPct).toBe(50);  // 50/100*100
    expect(result.projectedPct).toBe(80); // 80/100*100
    expect(result.isOverBudget).toBe(false);
    expect(result.isProjectedOver).toBe(false);
  });

  test("予算超過：実績が予算を超えた場合", () => {
    const result = calcBudgetProgress(120, 150, 100) as BudgetProgress;
    expect(result.actualPct).toBe(100); // 上限は100%でクリップ
    expect(result.isOverBudget).toBe(true);
    expect(result.isProjectedOver).toBe(true);
  });

  test("予測のみ予算超過の場合", () => {
    const result = calcBudgetProgress(60, 110, 100) as BudgetProgress;
    expect(result.actualPct).toBe(60);
    expect(result.projectedPct).toBe(100); // 上限は100%でクリップ
    expect(result.isOverBudget).toBe(false);
    expect(result.isProjectedOver).toBe(true);
  });

  test("予測と実績のパーセントが0〜100の範囲にクリップされる", () => {
    const result = calcBudgetProgress(200, 300, 100) as BudgetProgress;
    expect(result.actualPct).toBe(100);
    expect(result.projectedPct).toBe(100);
  });

  test("実績がゼロの場合は0%を返す", () => {
    const result = calcBudgetProgress(0, 0, 100) as BudgetProgress;
    expect(result).not.toBeNull();
    expect(result.actualPct).toBe(0);
    expect(result.projectedPct).toBe(0);
    expect(result.isOverBudget).toBe(false);
    expect(result.isProjectedOver).toBe(false);
  });

  test("負のコスト（クレジット等）は0%にクリップされる", () => {
    const result = calcBudgetProgress(-10, -20, 100) as BudgetProgress;
    expect(result.actualPct).toBe(0);
    expect(result.projectedPct).toBe(0);
  });
});
