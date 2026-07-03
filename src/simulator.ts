import { isBloatedSession, type Summary, type ModelCost } from "./api";
import { calcEffectiveRate } from "./format";

// 節約ポテンシャルシミュレーター: キャッシュヒット率目標・Haiku移行率・/clear実施率の
// 3つのスライダー値から、現在のデータを基に月額の推定節約額を試算する純粋関数群。
// 3施策は独立試算（相互作用は考慮しない）。

export interface SimulatorInput {
  targetCacheHitRate: number; // 0-1
  haikuShiftRate: number; // 0-1
  clearRate: number; // 0-1
}

export interface SimulatorBreakdown {
  cacheSavings: number;
  haikuSavings: number;
  clearSavings: number;
  totalMonthlySavings: number;
}

/** YYYY-MM-DD 文字列同士の包含日数を返す（最低 1 日）。 */
function periodDaysOf(from: string | null, to: string | null): number {
  if (!from || !to) return 1;
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/** コスト/トークン比率を安全に計算する（トークン 0 の場合は 0 を返す）。 */
const safeRate = (cost: number, tokens: number): number => (tokens > 0 ? cost / tokens : 0);

export function monthlyFactorOf(s: Summary): number {
  return 30 / periodDaysOf(s.totals.from, s.totals.to);
}

/** 現在の実績値をスライダー初期値として返す。 */
export function defaultSimulatorInput(s: Summary): SimulatorInput {
  return {
    targetCacheHitRate: s.drivers.cacheReadRatio,
    haikuShiftRate: 0,
    clearRate: 0,
  };
}

/** キャッシュヒット率目標を上げた場合の月額節約額を試算する。 */
export function simulateCacheHitSavings(s: Summary, targetCacheHitRate: number): number {
  const currentRate = s.drivers.cacheReadRatio;
  if (targetCacheHitRate <= currentRate) return 0;

  const inputRate = safeRate(s.costSplit.input, s.tokenSplit.input);
  const cacheReadRate = safeRate(s.costSplit.cacheRead, s.tokenSplit.cacheRead);
  const improvableTokens =
    s.tokenSplit.input *
    Math.min(1, (targetCacheHitRate - currentRate) / Math.max(1 - currentRate, 1e-9));
  const savings = improvableTokens * (inputRate - cacheReadRate) * monthlyFactorOf(s);
  return Math.max(0, savings);
}

// Haikuの実データが無い場合のフォールバック倍率（topモデル比、経験則による近似値）。
const HAIKU_FALLBACK_RATE_DIVISOR = 3;

/** Haiku移行率を上げた場合の月額節約額を試算する。 */
export function simulateHaikuShiftSavings(s: Summary, haikuShiftRate: number): number {
  const top = s.drivers.topModel;
  if (!top || top.tokens <= 0) return 0;

  const topRate = safeRate(top.cost, top.tokens);
  const haikuRates = s.models
    .filter((m) => /haiku/i.test(m.model) && m.tokens > 0)
    .map((m) => safeRate(m.cost, m.tokens));
  const haikuRate = haikuRates.length > 0 ? Math.min(...haikuRates) : topRate / HAIKU_FALLBACK_RATE_DIVISOR;
  if (haikuRate >= topRate) return 0;

  const savings = top.tokens * haikuShiftRate * (topRate - haikuRate) * monthlyFactorOf(s);
  return Math.max(0, savings);
}

/** /clear実施率を上げた場合の月額節約額を試算する。 */
export function simulateClearSavings(s: Summary, clearRate: number): number {
  const bloated = s.bySession.filter((sess) => isBloatedSession(sess));
  const reSentTokens = bloated.reduce((sum, sess) => sum + sess.cacheRead, 0);
  const cacheReadRate = safeRate(s.costSplit.cacheRead, s.tokenSplit.cacheRead);
  return reSentTokens * clearRate * cacheReadRate * monthlyFactorOf(s);
}

// ModelBreakdown の「Haikuへ移行した場合」試算に使う固定移行率。
export const HAIKU_MIGRATION_SHIFT_RATE = 0.3;

/** モデル一覧からHaiku系モデル（tokens>0、価格未登録のフォールバック行は除外）の中で最安の実績単価（USD/MTok）を返す。該当なしはnull。 */
export function resolveCheapestHaikuRate(models: ModelCost[]): number | null {
  const haikuRates = models
    .filter((m) => /haiku/i.test(m.model) && m.tokens > 0 && !m.isFallback)
    .map((m) => calcEffectiveRate(m.cost, m.tokens));
  return haikuRates.length > 0 ? Math.min(...haikuRates) : null;
}

/**
 * 対象モデルをHaikuへ shiftRate 分移行した場合の月額節約額を返す。
 * 対象がHaiku自身、tokens<=0、haikuRateがnull、または既にHaiku以下の単価の場合はnull。
 */
export function calcHaikuMigrationSaving(
  model: Pick<ModelCost, "model" | "cost" | "tokens">,
  haikuRate: number | null,
  shiftRate: number,
  s: Summary
): number | null {
  if (/haiku/i.test(model.model)) return null;
  if (model.tokens <= 0) return null;
  if (haikuRate === null) return null;

  const modelRate = calcEffectiveRate(model.cost, model.tokens);
  if (modelRate <= haikuRate) return null;

  return ((modelRate - haikuRate) * model.tokens * shiftRate) / 1_000_000 * monthlyFactorOf(s);
}

/** 3つのスライダー入力から節約額の内訳と合計を試算する。 */
export function simulateSavings(s: Summary, input: SimulatorInput): SimulatorBreakdown {
  const cacheSavings = simulateCacheHitSavings(s, input.targetCacheHitRate);
  const haikuSavings = simulateHaikuShiftSavings(s, input.haikuShiftRate);
  const clearSavings = simulateClearSavings(s, input.clearRate);
  return {
    cacheSavings,
    haikuSavings,
    clearSavings,
    totalMonthlySavings: cacheSavings + haikuSavings + clearSavings,
  };
}
