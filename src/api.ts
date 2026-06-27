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
  tokenModels: Record<string, number>;
  tokenTotal: number;
  projectTokens: Record<string, number>;
}

export interface SessionCost {
  sessionId: string;
  cwd: string;
  cost: number;
  tokens: number;
  messages: number;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  firstTs: string | null;
  lastTs: string | null;
  avgContextPerMsg: number; // Σ(cacheRead + input) / messages = 1ターンの実コンテキストサイズ proxy
  topModel: { model: string; cost: number } | null;
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
  projects: { cwd: string; cost: number; tokens: number }[];
  drivers: {
    topModel: ModelCost | null;
    topDay: { date: string; cost: number; tokens: number } | null;
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
  blocks: Block[];
  projection: Projection | null;
  activity: Activity;
  bySession: SessionCost[];
}

export interface Activity {
  matrix: number[][]; // [day 0-6][hour 0-23] = tokens
  max: number;
  total: number;
  peak: { day: number; hour: number; tokens: number } | null;
}

export interface Block {
  start: string;
  end: string;
  isActive: boolean;
  cost: number;
  tokens: number;
  durationMin: number;
  remainMin: number;
  burnRatePerMin: number;
  topModel: { model: string; cost: number } | null;
}

export interface Projection {
  monthStr: string;
  monthCostSoFar: number;
  daysPassed: number;
  daysRemain: number;
  daysInMonth: number;
  projectedMonthCost: number;
}

// アクティブブロックのバーンレート(USD/分)がこの値以上なら高バーンレート警告を出す。
// 5時間フルブロック換算の目安 ≒ threshold × 300分（0.5 → 約 $150/ブロック）。
export const DEFAULT_BURN_THRESHOLD_PER_MIN = 0.5;

// アクティブな課金ブロックが高バーンレートなら警告情報を、そうでなければ null を返す純粋関数。
export function activeBurnWarning(
  blocks: Block[],
  threshold = DEFAULT_BURN_THRESHOLD_PER_MIN
): { perMin: number; remainMin: number } | null {
  const active = blocks.find((b) => b.isActive);
  if (!active || active.burnRatePerMin < threshold) return null;
  return { perMin: active.burnRatePerMin, remainMin: active.remainMin };
}

// コンテキスト肥大化の判定閾値（初期値、実データを見て調整する）。
// 1ターンの実コンテキストが大きく、かつメッセージ数が一定以上のセッションは
// /clear せず会話を伸ばし続けたことでコスト増の主因になっている可能性が高い。
export const BLOAT_CONTEXT_THRESHOLD = 100_000; // avgContextPerMsg がこのトークン数超で肥大化候補
export const BLOAT_MIN_MESSAGES = 10; // 短いセッションは誤検知になるため除外

// セッションがコンテキスト肥大化（/clear 推奨）かどうかを返す純粋関数。
export function isBloatedSession(
  s: SessionCost,
  contextThreshold = BLOAT_CONTEXT_THRESHOLD,
  minMessages = BLOAT_MIN_MESSAGES
): boolean {
  return s.messages >= minMessages && s.avgContextPerMsg > contextThreshold;
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

  // セッションは単位として扱い、最終利用日(lastTs)が cutoff 以降のものを残す。
  const filteredSessions = s.bySession.filter(
    (sess) => (sess.lastTs?.slice(0, 10) ?? "") >= cutoffStr
  );

  const costByModel = new Map<string, number>();
  const tokenByModel = new Map<string, number>();
  const tokenByProject = new Map<string, number>();
  for (const day of filteredDaily) {
    for (const [m, c] of Object.entries(day.models)) {
      costByModel.set(m, (costByModel.get(m) ?? 0) + c);
    }
    for (const [m, t] of Object.entries(day.tokenModels ?? {})) {
      tokenByModel.set(m, (tokenByModel.get(m) ?? 0) + t);
    }
    for (const [cwd, t] of Object.entries(day.projectTokens ?? {})) {
      tokenByProject.set(cwd, (tokenByProject.get(cwd) ?? 0) + t);
    }
  }
  const filteredProjects = [...tokenByProject.entries()]
    .map(([cwd, tokens]) => ({ cwd, tokens, cost: 0 }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);
  const filteredModels = s.models
    .map(m => ({ ...m, cost: costByModel.get(m.model) ?? 0, tokens: tokenByModel.get(m.model) ?? 0 }))
    .filter(m => m.cost > 0 || m.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  const totalCost = filteredDaily.reduce((sum, d) => sum + d.total, 0);
  const totalTokens = filteredDaily.reduce((sum, d) => sum + (d.tokenTotal ?? 0), 0);

  // topDay を filteredDaily から再計算（トークン基準）
  let topDay: { date: string; cost: number; tokens: number } | null = null;
  let topDayModel: { model: string; cost: number } | null = null;
  for (const day of filteredDaily) {
    const dayTokens = day.tokenTotal ?? 0;
    if (!topDay || dayTokens > topDay.tokens) {
      topDay = { date: day.date, cost: day.total, tokens: dayTokens };
      const entries = Object.entries(day.models).sort(([, a], [, b]) => b - a);
      topDayModel = entries.length > 0 ? { model: entries[0][0], cost: entries[0][1] } : null;
    }
  }

  return {
    ...s,
    daily: filteredDaily,
    models: filteredModels,
    projects: filteredProjects,
    bySession: filteredSessions,
    totals: {
      ...s.totals,
      cost: totalCost,
      tokens: totalTokens,
      from: filteredDaily[0]?.date ?? null,
      to: filteredDaily[filteredDaily.length - 1]?.date ?? null,
    },
    drivers: {
      ...s.drivers,
      topModel: filteredModels[0] ?? null,
      topDay,
      topDayModel,
    },
    // coldStartCost は日次データに per-session 情報がないため、
    // 全期間コスト比でスケールして近似値を算出する
    sessionStats: {
      ...s.sessionStats,
      coldStartCost: s.totals.cost > 0
        ? s.sessionStats.coldStartCost * (totalCost / s.totals.cost)
        : 0,
    },
  };
}

export async function fetchSummary(reload = false): Promise<Summary> {
  const res = reload
    ? await fetch("/api/reload", { method: "POST" })
    : await fetch("/api/summary");
  if (!res.ok) throw new Error(reload ? "reload failed" : "fetch failed");
  return res.json();
}
