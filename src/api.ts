export interface ModelCost {
  model: string;
  cost: number;
  tokens: number;
  isFallback: boolean;
}

export interface DailyCost {
  date: string;
  models: Record<string, number>;
  total: number;
}

export interface Summary {
  generatedAt: string;
  totals: {
    cost: number;
    tokens: number;
    sessions: number;
    messages: number;
    from: string | null;
    to: string | null;
  };
  tokenSplit: { input: number; output: number; cacheCreate: number; cacheRead: number };
  costSplit: { input: number; output: number; cacheWrite: number; cacheRead: number };
  models: ModelCost[];
  daily: DailyCost[];
  projects: { cwd: string; cost: number }[];
  drivers: {
    topModel: ModelCost | null;
    topDay: { date: string; cost: number } | null;
    topDayModel: { model: string; cost: number } | null;
    cacheReadRatio: number;
    outputCostRatio: number;
  };
  sessionStats: {
    avgColdStartTokens: number;
    p90ColdStartTokens: number;
    coldStartCost: number;
  };
  overhead: {
    claudeMd: { label: string; bytes: number; estimatedTokens: number } | null;
    atRefs: Array<{ label: string; bytes: number; estimatedTokens: number }>;
    globalPlugins: Array<{
      name: string;
      files: Array<{ label: string; bytes: number; estimatedTokens: number }>;
      totalBytes: number;
      totalEstimatedTokens: number;
    }>;
    projectPlugins: Array<{ name: string; projectPaths: string[] }>;
    totalEstimatedTokens: number;
  };
  warnings: { fallbackModels: string[] };
  source?: { fileCount: number };
}

export type Period = '7d' | '30d' | '90d' | 'all';

const PERIOD_DAYS: Record<Exclude<Period, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

export function filterSummary(s: Summary, period: Period): Summary {
  if (period === 'all') return s;

  const days = PERIOD_DAYS[period];
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days + 1);
  const cutoffStr = [
    cutoff.getFullYear(),
    String(cutoff.getMonth() + 1).padStart(2, "0"),
    String(cutoff.getDate()).padStart(2, "0"),
  ].join("-");

  const filteredDaily = s.daily.filter(d => d.date >= cutoffStr);

  const costByModel = new Map<string, number>();
  for (const day of filteredDaily) {
    for (const [m, c] of Object.entries(day.models)) {
      costByModel.set(m, (costByModel.get(m) ?? 0) + c);
    }
  }
  const filteredModels = s.models
    .map(m => ({ ...m, cost: costByModel.get(m.model) ?? 0 }))
    .filter(m => m.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  const totalCost = filteredDaily.reduce((sum, d) => sum + d.total, 0);

  // topDay を filteredDaily から再計算
  let topDay: { date: string; cost: number } | null = null;
  let topDayModel: { model: string; cost: number } | null = null;
  for (const day of filteredDaily) {
    if (!topDay || day.total > topDay.cost) {
      topDay = { date: day.date, cost: day.total };
      const entries = Object.entries(day.models).sort(([, a], [, b]) => b - a);
      topDayModel = entries.length > 0 ? { model: entries[0][0], cost: entries[0][1] } : null;
    }
  }

  return {
    ...s,
    daily: filteredDaily,
    models: filteredModels,
    totals: {
      ...s.totals,
      cost: totalCost,
      from: filteredDaily[0]?.date ?? null,
      to: filteredDaily[filteredDaily.length - 1]?.date ?? null,
    },
    drivers: {
      ...s.drivers,
      topModel: filteredModels[0] ?? null,
      topDay,
      topDayModel,
    },
    sessionStats: s.sessionStats,
  };
}

export async function fetchSummary(reload = false): Promise<Summary> {
  const res = reload
    ? await fetch("/api/reload", { method: "POST" })
    : await fetch("/api/summary");
  if (!res.ok) throw new Error(reload ? "reload failed" : "fetch failed");
  return res.json();
}
