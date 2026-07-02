import type { DailyCost, HourlyData } from "./api";

export interface WeeklyCost {
  weekStart: string; // その週の月曜の日付 (YYYY-MM-DD)
  models: Record<string, number>;
  total: number;
  tokenModels: Record<string, number>;
  tokenTotal: number;
  inputTokens: number;
  cacheReadTokens: number;
  // 週内の生トークン数を合算してから算出した比率 = cacheReadTokens / (inputTokens + cacheReadTokens)。
  // 日ごとの単純平均ではない（ボリューム差を無視しないため）。
  cacheReadRatio: number;
}

export interface HourlyDisplay {
  hour: number;
  tokens: number;
  cost: number;
  breakdown: Array<{
    model: string;
    cost: number;
    tokens: number;
  }>;
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
      w = {
        weekStart, models: {}, total: 0, tokenModels: {}, tokenTotal: 0,
        inputTokens: 0, cacheReadTokens: 0, cacheReadRatio: 0,
      };
      byWeek.set(weekStart, w);
    }
    addInto(w.models, d.models);
    addInto(w.tokenModels, d.tokenModels ?? {});
    w.total += d.total;
    w.tokenTotal += d.tokenTotal ?? 0;
    w.inputTokens += d.inputTokens ?? 0;
    w.cacheReadTokens += d.cacheReadTokens ?? 0;
  }
  const weeks = [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  return weeks.map((w) => ({
    ...w,
    cacheReadRatio: (w.inputTokens + w.cacheReadTokens) > 0
      ? w.cacheReadTokens / (w.inputTokens + w.cacheReadTokens)
      : 0,
  }));
}

// HourlyData配列をUI表示用のHourlyDisplay形式に変換する。
export function toHourly(hourlyData: HourlyData[]): HourlyDisplay[] {
  return hourlyData.map(hour => ({
    hour: hour.hour,
    tokens: hour.tokens,
    cost: hour.cost,
    breakdown: hour.models.map(item => ({
      model: item.model,
      cost: item.cost,
      tokens: item.tokens,
    }))
  }));
}
