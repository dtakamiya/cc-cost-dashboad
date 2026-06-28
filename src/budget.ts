const STORAGE_KEY = "cc_budget_limit";

export function getBudgetLimit(): number | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function setBudgetLimit(value: number): void {
  localStorage.setItem(STORAGE_KEY, String(value));
}

export function clearBudgetLimit(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export interface BudgetProgress {
  actualPct: number;
  projectedPct: number;
  isOverBudget: boolean;
  isProjectedOver: boolean;
}

export function calcBudgetProgress(
  monthCostSoFar: number,
  projectedMonthCost: number,
  budgetLimit: number | null
): BudgetProgress | null {
  if (!budgetLimit || budgetLimit <= 0) return null;

  const raw = (v: number) => Math.min(100, (v / budgetLimit) * 100);

  const actualPct = raw(monthCostSoFar);
  const projectedPct = raw(projectedMonthCost);

  return {
    actualPct,
    projectedPct,
    isOverBudget: monthCostSoFar > budgetLimit,
    isProjectedOver: projectedMonthCost > budgetLimit,
  };
}
