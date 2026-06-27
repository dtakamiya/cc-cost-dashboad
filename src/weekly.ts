import type { DailyCost } from "./api";

export interface WeeklyCost {
  weekStart: string; // その週の月曜の日付 (YYYY-MM-DD)
  models: Record<string, number>;
  total: number;
  tokenModels: Record<string, number>;
  tokenTotal: number;
}

// "YYYY-MM-DD" を含む週の月曜の日付文字列を返す（月曜始まり、UTC ベース）。
export function weekStartOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=日, 1=月, ... 6=土
  const offset = (dow + 6) % 7; // 月曜からの経過日数
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function addInto(target: Record<string, number>, src: Record<string, number>) {
  for (const [k, v] of Object.entries(src)) target[k] = (target[k] ?? 0) + v;
}

// 日別配列を週単位（月曜始まり）に合算し、weekStart 昇順で返す。
export function toWeekly(daily: DailyCost[]): WeeklyCost[] {
  const byWeek = new Map<string, WeeklyCost>();
  for (const d of daily) {
    const weekStart = weekStartOf(d.date);
    let w = byWeek.get(weekStart);
    if (!w) {
      w = { weekStart, models: {}, total: 0, tokenModels: {}, tokenTotal: 0 };
      byWeek.set(weekStart, w);
    }
    addInto(w.models, d.models);
    addInto(w.tokenModels, d.tokenModels ?? {});
    w.total += d.total;
    w.tokenTotal += d.tokenTotal ?? 0;
  }
  return [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
