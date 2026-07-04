export interface ModelCost {
  model: string;
  cost: number;
  tokens: number;
  isFallback: boolean;
  tokenSplit?: { input: number; output: number; cacheCreate: number; cacheRead: number };
}

export interface ModelPrice {
  input: number;
  output: number;
}

export interface PricingMultipliers {
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface Pricing {
  models: Record<string, ModelPrice>;
  multipliers: PricingMultipliers;
}

export interface DailyCost {
  date: string;
  models: Record<string, number>;
  total: number;
  tokenModels: Record<string, number>;
  tokenTotal: number;
  projectTokens: Record<string, number>;
  projectCosts?: Record<string, number>;
  sessions?: number;
  inputTokens: number;
  cacheReadTokens: number;
  // 日別のキャッシュ活用率 = cacheReadTokens / (inputTokens + cacheReadTokens)。
  // Summary.drivers.cacheReadRatio（全体集計、分母 = totalTokens）とは計算式が異なるため混同しないこと。
  cacheReadRatio: number;
  mainTokens?: number;
  mainCost?: number;
  subagentTokens?: number;
  subagentCost?: number;
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
  compactionCount: number; // 自動コンテキスト圧縮（compaction）の発生回数
}

export interface OverheadFile {
  label: string;
  bytes: number;
  alwaysTokens: number; // name + description（常時注入の近似）
  fullTokens: number;   // 全文（スキル起動時にのみ読まれる）
  estimatedTokens: number; // = alwaysTokens（後方互換）
}

// キャッシュ TTL 損益分岐（1h vs 5m, ROI）。すべて USD/トークンの集計値。
export interface CacheStats {
  create1hTokens: number; // 1h キャッシュ書き込みトークン
  create5mTokens: number; // 5m キャッシュ書き込みトークン
  write1hCost: number;    // 1h 書き込みコスト（USD）
  write5mCost: number;    // 5m 書き込みコスト（USD）
  premium1h: number;      // 1h を選んだことによる超過コスト（5m 比, USD）
  readSavings: number;    // キャッシュ読み込みによる節約額（USD）
  writeCost: number;      // キャッシュ書き込みコスト合計（USD）
  roiNet: number;         // readSavings − writeCost（負なら書き込み未回収）
}

// セッション内アイドルギャップによる5分キャッシュ失効（無駄な再書き込み）の集計。
export interface CacheGapStats {
  expiredGapCount: number;  // 失効ギャップ（5分TTL超の中断）の発生回数
  reWriteTokens: number;    // 失効直後に再書き込みされたトークン数
  reWriteCost: number;      // 再書き込みによる超過コスト（USD）
  affectedSessions: string[]; // 失効ギャップを持つセッションIDの重複なし配列
}

// セッション内モデル切替直後に発生するキャッシュ再作成コストの集計。
// プロンプトキャッシュはモデル固有のため、切替直後にcache creationが発生すると
// cache readで済むはずのトークンが再課金される。
export interface ModelSwitchStats {
  switchCount: number;      // モデルが変化した回数
  reCreateTokens: number;   // 切替直後に再作成されたトークン数
  reCreateCost: number;     // 再作成による超過コスト（USD）
  affectedSessions: string[]; // 再作成コストが発生したセッションIDの重複なし配列
}

// サブエージェント（isSidechain）委譲のトークン/コスト内訳。デリゲーションROI判断用。
export interface SubagentStats {
  mainTokens: number;
  mainCost: number;
  subagentTokens: number;
  subagentCost: number;
  subagentRatio: number; // subagentTokens / (mainTokens + subagentTokens)。0-1件でも0除算しない。
}

// tool_use（Agent/Skill）の呼び出し集計。ツール名ごとの使用回数・セッション数。
export interface ToolUsage {
  toolName: "Agent" | "Skill"; // Agent | Skill
  key: string; // e.g. "Agent:Explore" or "Skill:codebase-onboarding"
  name: string; // subagentType or skill name
  calls: number; // 呼び出し回数
  sessions: number; // ユニークセッション数
}

// MCP ツール（mcp__<server>__<tool>）呼び出しのサーバー単位集計。
// gh/aws/gcloud 等の CLI 代替が可能なサーバーを見極める判断材料として使う。
export interface McpServerUsage {
  serverName: string;
  calls: number;
  sessions: number;
}

// MCPサーバ1件あたりの常時オーバーヘッド推定。
// MCPツール定義は config（command/args）から静的取得できず実行時依存のため、
// 現状 source は常に "estimated"（保守的な既定値）。"measured" は将来の実測拡張用、
// "unknown" は推定不能な場合（estimatedTokens は null）に備えたフォールバック。
export interface McpServerOverhead {
  name: string;
  toolCount: number | null;
  estimatedTokens: number | null;
  source: "measured" | "estimated" | "unknown";
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
    claudeMd: OverheadFile | null;
    atRefs: OverheadFile[];
    globalPlugins: Array<{
      name: string;
      files: OverheadFile[];
      totalBytes: number;
      totalAlwaysTokens: number;
      totalFullTokens: number;
      totalEstimatedTokens: number;
    }>;
    personalSkills: OverheadFile[];
    projectPlugins: Array<{ name: string; projectPaths: string[] }>;
    mcpServers: McpServerOverhead[];
    totalAlwaysTokens: number;
    totalInvokeTokens: number;
    totalEstimatedTokens: number;
  };
  warnings: { fallbackModels: string[] };
  cacheStats?: CacheStats;
  cacheGapStats?: CacheGapStats;
  modelSwitch?: ModelSwitchStats;
  subagentStats?: SubagentStats;
  source?: {
    fileCount: number;
    parsedLines?: number;
    skippedLines?: number;
    parseErrors?: number;
    unreadableFiles?: number;
  };
  blocks: Block[];
  projection: Projection | null;
  activity: Activity;
  bySession: SessionCost[];
  byTool: ToolUsage[];
  byMcpServer: McpServerUsage[];
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
  recentBurnRatePerMin: number;
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

/** アクティブな課金ブロックが高バーンレートなら警告情報を、そうでなければ null を返す。 */
export function activeBurnWarning(
  blocks: Block[],
  threshold = DEFAULT_BURN_THRESHOLD_PER_MIN
): { perMin: number; remainMin: number } | null {
  const active = blocks.find((b) => b.isActive);
  if (!active || active.recentBurnRatePerMin < threshold) return null;
  return { perMin: active.recentBurnRatePerMin, remainMin: active.remainMin };
}

// コンテキスト肥大化の判定閾値（初期値、実データを見て調整する）。
// 1ターンの実コンテキストが大きく、かつメッセージ数が一定以上のセッションは
// /clear せず会話を伸ばし続けたことでコスト増の主因になっている可能性が高い。
export const BLOAT_CONTEXT_THRESHOLD = 100_000; // avgContextPerMsg がこのトークン数超で肥大化候補
export const BLOAT_MIN_MESSAGES = 10; // 短いセッションは誤検知になるため除外

/** セッションがコンテキスト肥大化（/clear 推奨）かどうかを返す。 */
export function isBloatedSession(
  s: SessionCost,
  contextThreshold = BLOAT_CONTEXT_THRESHOLD,
  minMessages = BLOAT_MIN_MESSAGES
): boolean {
  return s.messages >= minMessages && s.avgContextPerMsg > contextThreshold;
}

// セッション内でコンテキスト圧縮（compaction）がこの回数以上発生していれば「多発」とみなす。
export const COMPACTION_COUNT_THRESHOLD = 3;

/** セッションが頻繁にコンテキスト圧縮を起こしているか（先回り /compact 推奨）どうかを返す。 */
export function isFrequentlyCompactedSession(
  s: SessionCost,
  threshold = COMPACTION_COUNT_THRESHOLD
): boolean {
  return s.compactionCount >= threshold;
}

/** セッションのキャッシュ活用率スコア（0-100の整数）。cacheRead=0の場合はnull（計算をスキップ）。 */
export function sessionEfficiencyScore(s: SessionCost): number | null {
  if (s.cacheRead <= 0) return null;
  const ratio = s.cacheRead / (s.input + s.cacheRead);
  return Math.round(ratio * 100);
}

/** 効率スコアに応じた表示色（CSS変数）。null（cacheRead=0）はmuted。 */
export function sessionEfficiencyColor(score: number | null): string {
  if (score === null) return "var(--muted)";
  if (score >= 70) return "var(--success)";
  if (score >= 50) return "var(--warn)";
  return "var(--danger)";
}

// セッションの出力トークン比率がこの値超で「output高」とみなす既定閾値。
export const OUTPUT_HEAVY_SESSION_THRESHOLD = 0.4;

/** セッションの出力トークン比率（output / (input + output + cacheCreate + cacheRead)）を返す。分母が0なら0。 */
export function sessionOutputRatio(s: SessionCost): number {
  const total = s.input + s.output + s.cacheCreate + s.cacheRead;
  return total > 0 ? s.output / total : 0;
}

/** セッションが出力（output）過多かどうかを返す。 */
export function isOutputHeavySession(
  s: SessionCost,
  threshold = OUTPUT_HEAVY_SESSION_THRESHOLD
): boolean {
  return sessionOutputRatio(s) > threshold;
}

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export type FixedPeriod = '7d' | '30d' | '90d' | 'all';

export type Period = FixedPeriod | DateRange;

export type BillingMode = 'subscription' | 'api';

export const PERIOD_DAYS: Record<Exclude<FixedPeriod, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

export function isDateRange(p: Period): p is DateRange {
  return typeof p === 'object' && p !== null && 'from' in p && 'to' in p;
}

// 今日(00:00)から n 日前の Date を返す。期間フィルタの基準日計算に使う。
function dayStart(daysAgo: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

// Date を YYYY-MM-DD 文字列に整形する（daily.date と同形式）。
function ymd(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Summary を指定期間でフィルタして再集計した Summary を返す。 */
export function filterSummary(s: Summary, period: Period): Summary {
  if (isDateRange(period)) {
    const { from, to } = period;
    const filteredDaily = s.daily.filter(d => d.date >= from && d.date <= to);
    const filteredSessions = s.bySession
      .filter((sess) => {
        const d = sess.lastTs?.slice(0, 10) ?? "";
        return d >= from && d <= to;
      })
      .slice(0, 30);
    return buildPeriodSummary(s, filteredDaily, filteredSessions);
  }

  if (period === 'all') return { ...s, bySession: s.bySession.slice(0, 30) };

  const days = PERIOD_DAYS[period];
  // 現在期間: 今日を含む直近 days 日（cutoff = 今日 - (days-1)）。
  const cutoffStr = ymd(dayStart(days - 1));

  const filteredDaily = s.daily.filter(d => d.date >= cutoffStr);

  // セッションは単位として扱い、最終利用日(lastTs)が cutoff 以降のものを残し、コスト降順 top30 に絞る。
  // サーバーは全セッションを返すため、ここで期間フィルタ後の上位件数を決定する。
  const filteredSessions = s.bySession
    .filter((sess) => (sess.lastTs?.slice(0, 10) ?? "") >= cutoffStr)
    .slice(0, 30);

  return buildPeriodSummary(s, filteredDaily, filteredSessions);
}

/**
 * 現在期間の直前の同等期間（前期）の Summary を返す。
 * period='all' は前期が定義できないため null、前期にデータが無い場合も null を返す。
 */
export function filterPreviousPeriod(s: Summary, period: Period): Summary | null {
  if (period === 'all' || isDateRange(period)) return null;

  const days = PERIOD_DAYS[period];
  // 前期: 現在期間(今日 - (days-1) 〜 今日)の直前 days 日分。
  //   prevEnd   = 今日 - days       （現在期間の最古日の前日）
  //   prevStart = 今日 - (2*days-1)
  const prevStartStr = ymd(dayStart(days * 2 - 1));
  const prevEndStr = ymd(dayStart(days));

  const filteredDaily = s.daily.filter(d => d.date >= prevStartStr && d.date <= prevEndStr);
  if (filteredDaily.length === 0) return null;

  const filteredSessions = s.bySession
    .filter((sess) => {
      const d = sess.lastTs?.slice(0, 10) ?? "";
      return d >= prevStartStr && d <= prevEndStr;
    })
    .slice(0, 30);

  return buildPeriodSummary(s, filteredDaily, filteredSessions);
}

/**
 * filteredDaily（スケール後の絶対量を保持）から SubagentStats を正確に再合算する。
 * costRatio 近似ではなく、mainTokens/subagentTokens 等の絶対量を積算してから比率を再計算する。
 */
function sumSubagentStats(filteredDaily: DailyCost[]): SubagentStats {
  const mainTokens = filteredDaily.reduce((sum, d) => sum + (d.mainTokens ?? 0), 0);
  const mainCost = filteredDaily.reduce((sum, d) => sum + (d.mainCost ?? 0), 0);
  const subagentTokens = filteredDaily.reduce((sum, d) => sum + (d.subagentTokens ?? 0), 0);
  const subagentCost = filteredDaily.reduce((sum, d) => sum + (d.subagentCost ?? 0), 0);
  const total = mainTokens + subagentTokens;
  return { mainTokens, mainCost, subagentTokens, subagentCost, subagentRatio: total > 0 ? subagentTokens / total : 0 };
}

/**
 * 期間で絞り込んだ daily / sessions から Summary を再集計する共通ヘルパー。
 * filterSummary（現在期間）と filterPreviousPeriod（前期）が日付境界の計算だけを変えて共有する。
 */
function buildPeriodSummary(
  s: Summary,
  filteredDaily: DailyCost[],
  filteredSessions: SessionCost[]
): Summary {
  const costByModel = new Map<string, number>();
  const tokenByModel = new Map<string, number>();
  const tokenByProject = new Map<string, number>();
  const costByProject = new Map<string, number>();
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
    for (const [cwd, c] of Object.entries(day.projectCosts ?? {})) {
      costByProject.set(cwd, (costByProject.get(cwd) ?? 0) + c);
    }
  }
  const filteredProjects = [...tokenByProject.entries()]
    .map(([cwd, tokens]) => ({ cwd, tokens, cost: costByProject.get(cwd) ?? 0 }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);
  const filteredModels = s.models
    .map(m => ({ ...m, cost: costByModel.get(m.model) ?? 0, tokens: tokenByModel.get(m.model) ?? 0 }))
    .filter(m => m.cost > 0 || m.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  const totalCost = filteredDaily.reduce((sum, d) => sum + d.total, 0);
  const totalTokens = filteredDaily.reduce((sum, d) => sum + (d.tokenTotal ?? 0), 0);
  // cacheStats は日次に内訳が無いため、coldStartCost と同様コスト比でスケール近似する。
  const costRatio = s.totals.cost > 0 ? totalCost / s.totals.cost : 0;

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
      coldStartCost: s.sessionStats.coldStartCost * costRatio,
    },
    cacheStats: s.cacheStats && {
      create1hTokens: s.cacheStats.create1hTokens * costRatio,
      create5mTokens: s.cacheStats.create5mTokens * costRatio,
      write1hCost: s.cacheStats.write1hCost * costRatio,
      write5mCost: s.cacheStats.write5mCost * costRatio,
      premium1h: s.cacheStats.premium1h * costRatio,
      readSavings: s.cacheStats.readSavings * costRatio,
      writeCost: s.cacheStats.writeCost * costRatio,
      roiNet: s.cacheStats.roiNet * costRatio,
    },
    subagentStats: s.subagentStats && sumSubagentStats(filteredDaily),
  };
}

export interface PreviousPeriodTotals {
  cost: number;
  tokens: number;
  sessions: number;
}

export interface DeltaSummary {
  cost: number | null;
  tokens: number | null;
  sessions: number | null;
}

// 直前の同日数期間の集計を返す。データが不足する場合は null。
// cutoffStr: 現在期間の開始日（YYYY-MM-DD）、periodDays: 期間日数
export function computePreviousPeriod(
  allDaily: DailyCost[],
  cutoffStr: string,
  periodDays: number
): PreviousPeriodTotals | null {
  const cutoffMs = Date.parse(cutoffStr + "T00:00:00Z");
  const prevEndMs = cutoffMs - 86_400_000; // 現在期間の1日前
  const prevStartMs = prevEndMs - (periodDays - 1) * 86_400_000;
  const prevStartStr = new Date(prevStartMs).toISOString().slice(0, 10);
  const prevEndStr = new Date(prevEndMs).toISOString().slice(0, 10);

  const prevDays = allDaily.filter((d) => d.date >= prevStartStr && d.date <= prevEndStr);
  if (prevDays.length === 0) return null;

  const cost = prevDays.reduce((sum, d) => sum + d.total, 0);
  const tokens = prevDays.reduce((sum, d) => sum + (d.tokenTotal ?? 0), 0);
  const sessions = prevDays.reduce((sum, d) => sum + (d.sessions ?? 0), 0);
  return { cost, tokens, sessions };
}

// 現在期間と前期間の差分を % で返す。前期間が null か 0 の項目は null。
// 注: daily.sessions は server/aggregate.js で populate されないため、sessions delta は常に null
export function computeDelta(
  current: PreviousPeriodTotals,
  previous: PreviousPeriodTotals | null
): DeltaSummary | null {
  if (!previous) return null;
  const pct = (cur: number, prev: number): number | null => {
    if (prev === 0) return null;
    return ((cur - prev) / prev) * 100;
  };
  return {
    cost: pct(current.cost, previous.cost),
    tokens: pct(current.tokens, previous.tokens),
    sessions: null, // daily.sessions が populate されないため null に設定
  };
}

export type DeltaDir = 'up' | 'down' | 'flat';
export interface Delta {
  pct: number; // 変化率（例: 12.5 = +12.5%）
  dir: DeltaDir; // ±0.5% 未満は flat
}

// 前期比の変化率を計算する。前期がゼロ（比較不能）の場合は null を返す。
export function calcDelta(current: number, prev: number): Delta | null {
  if (prev === 0) return null;
  const pct = ((current - prev) / prev) * 100;
  const dir: DeltaDir = Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down';
  return { pct, dir };
}

// DailyTrend のオーバーレイ用に、daily の日付を offsetDays 日後ろへずらす（immutable）。
// 前期データを現在期間の X 軸へ重ねるために使う。
export function shiftDailyDates(daily: DailyCost[], offsetDays: number): DailyCost[] {
  return daily.map((d) => {
    const dt = new Date(`${d.date}T00:00:00`);
    dt.setDate(dt.getDate() + offsetDays);
    return { ...d, date: ymd(dt) };
  });
}

export interface SessionTurn {
  ts: string | null;
  model: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  cost: number;
}

export async function fetchSessionTurns(sessionId: string): Promise<SessionTurn[]> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/turns`);
  if (!res.ok) throw new Error("session turns fetch failed");
  return res.json() as Promise<SessionTurn[]>;
}

export interface CumulativeCostPoint {
  turnIndex: number;
  ts: string | null;
  cost: number;
  cumulativeCost: number;
  isSpike: boolean;
}

// 直前ターンまでの平均コストに対し、このターンのコストが何倍を超えたらスパイクとみなすか。
export const SPIKE_RATIO_THRESHOLD = 3;

/** セッション内ターン配列から累積コスト曲線を計算する。傾きが急増したターンには isSpike=true を付与する。 */
export function computeCumulativeCostCurve(turns: SessionTurn[]): CumulativeCostPoint[] {
  let cumulativeCost = 0;

  return turns.map((t, i) => {
    const avgSoFar = i > 0 ? cumulativeCost / i : 0;
    const isSpike = i > 0 && avgSoFar > 0 && t.cost > avgSoFar * SPIKE_RATIO_THRESHOLD;

    cumulativeCost += t.cost;

    return {
      turnIndex: i + 1,
      ts: t.ts,
      cost: t.cost,
      cumulativeCost,
      isSpike,
    };
  });
}

export function filterSessions(
  sessions: SessionCost[],
  cwdQuery: string,
  modelQuery: string
): SessionCost[] {
  const cwd = cwdQuery.toLowerCase();
  const model = modelQuery.toLowerCase();
  return sessions.filter((s) => {
    const cwdMatch = !cwd || s.cwd.toLowerCase().includes(cwd);
    const modelMatch = !model || (s.topModel?.model ?? "").toLowerCase().includes(model);
    return cwdMatch && modelMatch;
  });
}

/** プロジェクト（cwd）で Summary を絞り込む。cwdFilter が空のときは s をそのまま返す。 */
export function filterSummaryByProject(s: Summary, cwdFilter: string): Summary {
  if (!cwdFilter) return s;

  // bySession は表示用（top30 切り詰め済みの可能性あり）。totals は daily から算出する。
  const filteredSessions = s.bySession.filter((sess) => sess.cwd === cwdFilter);

  const filteredDaily = s.daily
    .filter((d) => (d.projectTokens[cwdFilter] ?? 0) > 0)
    .map((d) => {
      const projTokens = d.projectTokens[cwdFilter] ?? 0;
      const ratio = d.tokenTotal > 0 ? projTokens / d.tokenTotal : 0;
      return {
        ...d,
        tokenTotal: projTokens,
        total: d.total * ratio,
        models: Object.fromEntries(Object.entries(d.models).map(([m, c]) => [m, c * ratio])),
        tokenModels: Object.fromEntries(Object.entries(d.tokenModels ?? {}).map(([m, t]) => [m, t * ratio])),
        projectTokens: { [cwdFilter]: projTokens },
        mainTokens: (d.mainTokens ?? 0) * ratio,
        mainCost: (d.mainCost ?? 0) * ratio,
        subagentTokens: (d.subagentTokens ?? 0) * ratio,
        subagentCost: (d.subagentCost ?? 0) * ratio,
      };
    });

  // totals は切り詰め前のデータである daily から算出（bySession top30 切り詰めの影響を受けない）
  const totalCost = filteredDaily.reduce((sum, d) => sum + d.total, 0);
  const totalTokens = filteredDaily.reduce((sum, d) => sum + d.tokenTotal, 0);
  const totalMessages = filteredSessions.reduce((sum, sess) => sum + sess.messages, 0);
  const costRatio = s.totals.cost > 0 ? totalCost / s.totals.cost : 0;

  // models をフィルタ後 daily から再集計
  const costByModel = new Map<string, number>();
  const tokenByModel = new Map<string, number>();
  for (const d of filteredDaily) {
    for (const [m, c] of Object.entries(d.models)) {
      costByModel.set(m, (costByModel.get(m) ?? 0) + c);
    }
    for (const [m, t] of Object.entries(d.tokenModels ?? {})) {
      tokenByModel.set(m, (tokenByModel.get(m) ?? 0) + t);
    }
  }
  const filteredModels = s.models
    .map((m) => ({ ...m, cost: costByModel.get(m.model) ?? 0, tokens: tokenByModel.get(m.model) ?? 0 }))
    .filter((m) => m.cost > 0 || m.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  const filteredProjects = s.projects.filter((p) => p.cwd === cwdFilter);

  return {
    ...s,
    daily: filteredDaily,
    bySession: filteredSessions,
    projects: filteredProjects,
    models: filteredModels,
    totals: {
      ...s.totals,
      cost: totalCost,
      tokens: totalTokens,
      sessions: filteredSessions.length,
      messages: totalMessages,
    },
    drivers: {
      ...s.drivers,
      topModel: filteredModels[0] ?? null,
    },
    sessionStats: {
      ...s.sessionStats,
      coldStartCost: s.sessionStats.coldStartCost * costRatio,
    },
    cacheStats: s.cacheStats && {
      ...s.cacheStats,
      create1hTokens: s.cacheStats.create1hTokens * costRatio,
      create5mTokens: s.cacheStats.create5mTokens * costRatio,
      write1hCost: s.cacheStats.write1hCost * costRatio,
      write5mCost: s.cacheStats.write5mCost * costRatio,
      premium1h: s.cacheStats.premium1h * costRatio,
      readSavings: s.cacheStats.readSavings * costRatio,
      writeCost: s.cacheStats.writeCost * costRatio,
      roiNet: s.cacheStats.roiNet * costRatio,
    },
    subagentStats: s.subagentStats && sumSubagentStats(filteredDaily),
  };
}

export async function fetchPricing(): Promise<Pricing> {
  const res = await fetch("/api/pricing");
  if (!res.ok) throw new Error("pricing fetch failed");
  return res.json() as Promise<Pricing>;
}

export type UpdateCallback = () => void;

/**
 * /api/events (SSE) に接続し、update イベント受信時にコールバックを呼ぶ。
 * 戻り値の関数を呼ぶと EventSource を閉じて購読を解除する。
 */
export function subscribeToUpdates(onUpdate: UpdateCallback): () => void {
  const es = new EventSource("/api/events");
  es.addEventListener("update", onUpdate);
  return () => es.close();
}

// fetchSummary の period クエリ文字列を組み立てる。
function buildSummaryQuery(period?: Period): string {
  if (period === undefined) return "/api/summary";
  if (isDateRange(period)) {
    return `/api/summary?from=${period.from}&to=${period.to}`;
  }
  return `/api/summary?period=${period}`;
}

export async function fetchSummary(reload = false, period?: Period): Promise<Summary> {
  const res = reload
    ? await fetch("/api/reload", { method: "POST" })
    : await fetch(buildSummaryQuery(period));
  if (!res.ok) throw new Error(reload ? "reload failed" : "fetch failed");
  return res.json();
}

export interface HourlyData {
  hour: number;
  tokens: number;
  cost: number;
  models: Array<{ model: string; cost: number; tokens: number }>;
}

export interface HourlyResponse {
  hourly: HourlyData[];
}

export async function fetchHourly(): Promise<HourlyData[]> {
  const res = await fetch("/api/hourly");
  if (!res.ok) throw new Error("hourly fetch failed");
  const data = (await res.json()) as HourlyResponse;
  return data.hourly;
}
