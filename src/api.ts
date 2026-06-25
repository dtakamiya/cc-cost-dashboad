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

export async function fetchSummary(reload = false): Promise<Summary> {
  const res = reload
    ? await fetch("/api/reload", { method: "POST" })
    : await fetch("/api/summary");
  if (!res.ok) throw new Error(reload ? "reload failed" : "fetch failed");
  return res.json();
}
