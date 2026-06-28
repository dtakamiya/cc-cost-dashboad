import { isBloatedSession, type Summary } from "./api";

// 最適化アドバイザー: 期間フィルタ済みの Summary を入力に、優先度順＋推定月間節約額付きの
// 具体的アクション一覧を生成する純粋関数群。サーバー集計は変更せず既存データのみ再利用する。
//
// 節約額は「ブレンド単価 × 期間実績 × 30/期間日数」で月換算した目安。
// 単価/比率は costSplit/tokenSplit（filterSummary では全期間値）から導出し、
// 絶対額は期間スコープ済みの totals/models/bySession/sessionStats.coldStartCost から取る。

export type Priority = "high" | "medium" | "low";

export interface OverheadStatus {
  current: number;
  target: number;
  status: "good" | "caution" | "warn";
  percentage: number;
  color: string;
}

export interface FileImpact {
  label: string;
  alwaysTokens: number;
  monthlySavings: number;
  rank: number;
}

export interface Recommendation {
  id: string;
  priority: Priority;
  title: string;
  detail: string; // 観測した事実（根拠）
  action: string; // 取るべき具体アクション
  estMonthlySavings: number; // USD。定量化できない場合は 0
}

export interface AdvisorResult {
  items: Recommendation[]; // estMonthlySavings 降順
  totalEstMonthlySavings: number;
  periodDays: number;
}

// --- ルール閾値（実データを見て調整可能） ---
export const OVERHEAD_TOKEN_THRESHOLD = 3000; // 常時注入がこのトークン数超で削減提案
export const OVERHEAD_TARGET_TOKENS = 1500; // 削減目標（差分が再課金される無駄分の近似）
export const OVERHEAD_FILE_WARN_TOKENS = 500; // ファイル個別: この値超で削減推奨
export const OVERHEAD_FILE_CAUTION_TOKENS = 200; // ファイル個別: この値超で要注意
export const OUTPUT_COST_RATIO_THRESHOLD = 0.4; // output コスト比率がこの値超で警告
export const CACHE_READ_RATIO_THRESHOLD = 0.5; // cache read 比率がこの値未満で警告
export const MODEL_SKEW_THRESHOLD = 0.6; // 最大モデルのトークン占有率がこの値超で偏り

// --- 節約見積りの保守的な係数（過大評価を避ける） ---
const BLOAT_SAVABLE_FRACTION = 0.5; // 肥大化セッションの再送文脈のうち /clear で避けられる割合
const MODEL_SHIFT_FRACTION = 0.3; // 高単価モデルから安価モデルへ振り替えられる割合
const OUTPUT_REDUCTION_FRACTION = 0.2; // 出力長見直しで削減できる割合

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

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

/** 常時注入トークン数から削減達成度ステータスを計算する。 */
export function calculateOverheadStatus(
  totalAlwaysTokens: number,
  target: number = OVERHEAD_TARGET_TOKENS
): OverheadStatus {
  const percentage = target > 0 ? (totalAlwaysTokens / target) * 100 : 0;
  let status: OverheadStatus["status"];
  let color: string;
  if (totalAlwaysTokens <= target) {
    status = "good";
    color = "var(--success)";
  } else if (totalAlwaysTokens <= OVERHEAD_TOKEN_THRESHOLD) {
    status = "caution";
    color = "var(--warn)";
  } else {
    status = "warn";
    color = "var(--danger)";
  }
  return { current: totalAlwaysTokens, target, status, percentage, color };
}

/** ファイル別常時注入をmonthlySavings降順でランク付けして返す。 */
export function rankFilesByImpact(
  s: Summary,
  cacheCreateRate: number,
  sessionFactor: number,
  monthlyFactor: number
): FileImpact[] {
  const candidates: Array<{ label: string; alwaysTokens: number }> = [];
  if (s.overhead.claudeMd) {
    candidates.push({ label: s.overhead.claudeMd.label, alwaysTokens: s.overhead.claudeMd.alwaysTokens });
  }
  for (const r of s.overhead.atRefs) {
    candidates.push({ label: `@${r.label}`, alwaysTokens: r.alwaysTokens });
  }
  for (const p of s.overhead.globalPlugins) {
    for (const f of p.files) {
      candidates.push({ label: `[plugin] ${p.name}/${f.label}`, alwaysTokens: f.alwaysTokens });
    }
  }
  for (const sk of s.overhead.personalSkills) {
    candidates.push({ label: `[skill] ${sk.label}`, alwaysTokens: sk.alwaysTokens });
  }
  return candidates
    .map((c) => ({
      label: c.label,
      alwaysTokens: c.alwaysTokens,
      monthlySavings: c.alwaysTokens * cacheCreateRate * sessionFactor * monthlyFactor,
      rank: 0,
    }))
    .sort((a, b) => b.monthlySavings - a.monthlySavings)
    .map((item, i) => ({ ...item, rank: i + 1 }));
}

/** Summary を解析してコスト削減推奨アクション一覧を生成する。 */
export function buildRecommendations(s: Summary): AdvisorResult {
  const periodDays = periodDaysOf(s.totals.from, s.totals.to);
  const monthlyFactor = 30 / periodDays;

  const cacheReadRate = safeRate(s.costSplit.cacheRead, s.tokenSplit.cacheRead);

  const items: Recommendation[] = [];

  // 1. セッション肥大化 → /clear（high）
  const bloated = s.bySession.filter((sess) => isBloatedSession(sess));
  if (bloated.length > 0) {
    const reSentTokens = bloated.reduce((sum, sess) => sum + sess.cacheRead, 0);
    const savings = reSentTokens * cacheReadRate * BLOAT_SAVABLE_FRACTION * monthlyFactor;
    const cwds = [...new Set(bloated.map((b) => shortCwd(b.cwd)))].slice(0, 3).join(", ");
    items.push({
      id: "bloated-sessions",
      priority: "high",
      title: "肥大化したセッションが文脈を再送している",
      detail: `${bloated.length} 件のセッションが毎ターン巨大な会話履歴を再送（${cwds} ほか）。`,
      action: "区切りのよい所で /clear するか新規セッションを開始し、不要な履歴の再送を止める。",
      estMonthlySavings: savings,
    });
  }

  // 2. 高単価モデル偏り → 安価モデルへ振り分け（high）
  const top = s.drivers.topModel;
  if (top && s.totals.tokens > 0) {
    const topShare = top.tokens / s.totals.tokens;
    const topRate = safeRate(top.cost, top.tokens);
    const cheaper = cheapestOtherModel(s, top.model, topRate);
    if (topShare > MODEL_SKEW_THRESHOLD && cheaper) {
      const savings =
        top.tokens * MODEL_SHIFT_FRACTION * (topRate - cheaper.rate) * monthlyFactor;
      items.push({
        id: "model-skew",
        priority: "high",
        title: "高単価モデルにトークンが偏っている",
        detail: `${top.model} が全トークンの ${(topShare * 100).toFixed(0)}% を占有。`,
        action: `ルーチン作業（整形・調査・要約）を ${cheaper.model} に振り分ける。`,
        estMonthlySavings: Math.max(0, savings),
      });
    }
  }

  // 3. 常時注入オーバーヘッド過大 → システムプロンプト削減（medium）
  const baseline = s.overhead.totalAlwaysTokens;
  if (baseline > OVERHEAD_TOKEN_THRESHOLD) {
    const excess = baseline - OVERHEAD_TARGET_TOKENS;
    const avgCold = s.sessionStats.avgColdStartTokens;
    const fraction = avgCold > 0 ? Math.min(excess / avgCold, 1) : 0;
    const savings = s.sessionStats.coldStartCost * fraction * monthlyFactor;
    items.push({
      id: "overhead-baseline",
      priority: "medium",
      title: "常時注入のコンテキストが大きい",
      detail: `毎セッション冒頭で約 ${baseline.toLocaleString()} トークンをキャッシュ書き込み（${biggestOverhead(s)}）。`,
      action: "CLAUDE.md / プラグイン / スキルの常時注入分を削り、起動時のみ読む形に寄せる。",
      estMonthlySavings: savings,
    });
  }

  // 4. output 比率過大 → 出力長/effort 見直し（medium）
  if (s.drivers.outputCostRatio > OUTPUT_COST_RATIO_THRESHOLD) {
    const savings =
      s.totals.cost * s.drivers.outputCostRatio * OUTPUT_REDUCTION_FRACTION * monthlyFactor;
    items.push({
      id: "output-heavy",
      priority: "medium",
      title: "生成（output）が高コスト要因になっている",
      detail: `output がコスト全体の ${(s.drivers.outputCostRatio * 100).toFixed(0)}% を占有。`,
      action: "出力長の上限指定・簡潔な指示・effort 設定の見直しで生成量を抑える。",
      estMonthlySavings: savings,
    });
  }

  // 5. キャッシュ効率低下（low, 定性）
  if (s.drivers.cacheReadRatio < CACHE_READ_RATIO_THRESHOLD) {
    items.push({
      id: "low-cache",
      priority: "low",
      title: "キャッシュが効いていない",
      detail: `cache read 比率が ${(s.drivers.cacheReadRatio * 100).toFixed(0)}%（input が割高になりがち）。`,
      action: "関連作業は同一セッションで継続する。ただし肥大化（上記）とのトレードオフに注意。",
      estMonthlySavings: 0,
    });
  }

  // 3b. ファイル別常時注入オーバーヘッド（individual file > OVERHEAD_FILE_WARN_TOKENS）
  {
    const cacheCreateRate = safeRate(s.costSplit.cacheWrite, s.tokenSplit.cacheCreate);
    const sessionFactor = s.totals.sessions > 0 ? s.totals.sessions : 0;
    const candidates: Array<{ label: string; alwaysTokens: number }> = [];
    if (s.overhead.claudeMd) {
      candidates.push({ label: s.overhead.claudeMd.label, alwaysTokens: s.overhead.claudeMd.alwaysTokens });
    }
    for (const r of s.overhead.atRefs) {
      candidates.push({ label: `@${r.label}`, alwaysTokens: r.alwaysTokens });
    }
    for (const p of s.overhead.globalPlugins) {
      for (const f of p.files) {
        candidates.push({ label: `[plugin] ${p.name}/${f.label}`, alwaysTokens: f.alwaysTokens });
      }
    }
    for (const sk of s.overhead.personalSkills) {
      candidates.push({ label: `[skill] ${sk.label}`, alwaysTokens: sk.alwaysTokens });
    }
    for (const c of candidates) {
      if (c.alwaysTokens <= OVERHEAD_FILE_WARN_TOKENS) continue;
      // 削減目標: OVERHEAD_FILE_CAUTION_TOKENS まで圧縮した場合の節約
      const reducibleTokens = c.alwaysTokens - OVERHEAD_FILE_CAUTION_TOKENS;
      const savings = reducibleTokens * cacheCreateRate * sessionFactor * monthlyFactor;
      const actionText = c.label.startsWith("[skill]") || c.label.startsWith("[plugin]")
        ? `${c.label} の name/description を削減し、詳細は本文（起動時のみ読まれる）に移動する。`
        : `${c.label} のコンテンツを精査し、重要な情報は本文に、メタデータは簡潔にする。`;
      items.push({
        id: `overhead-file:${c.label}`,
        priority: "medium",
        title: `${c.label} が常時 ${c.alwaysTokens.toLocaleString()} トークンを消費`,
        detail: `毎セッション冒頭で ${c.alwaysTokens.toLocaleString()} トークンが注入される（推奨 ≤ ${OVERHEAD_FILE_CAUTION_TOKENS} トークン）。`,
        action: actionText,
        estMonthlySavings: Math.max(0, savings),
      });
    }
  }

  // 5b. 1h キャッシュ TTL プレミアム未回収（medium, 定量）
  // 2026年に TTL が 60分→5分へ短縮され、1h キャッシュ（書き込み 2倍）の損益分岐が厳しくなった。
  // プレミアムを払ったのに ROI 純益で吸収しきれていない場合に、5m 既定への寄せを提案する。
  const cs = s.cacheStats;
  if (cs && cs.premium1h > 0 && cs.roiNet < cs.premium1h) {
    items.push({
      id: "cache-ttl-premium",
      priority: "medium",
      title: "1h キャッシュの 2倍プレミアムが回収できていない",
      detail: `1h キャッシュ書き込みに約 ${cs.premium1h.toFixed(2)} USD の超過コスト（5m 比）。読み込み回収が不足。`,
      action: "短命セッションや再利用の少ない作業では 1h キャッシュ指定を避け、5m 既定に寄せる。",
      estMonthlySavings: Math.max(0, cs.premium1h * monthlyFactor),
    });
  }

  // 6. 価格未登録モデル（low, 情報）
  if (s.warnings.fallbackModels.length > 0) {
    items.push({
      id: "fallback-pricing",
      priority: "low",
      title: "価格未登録のモデルがある",
      detail: `${s.warnings.fallbackModels.join(", ")} は暫定単価で計算（数値は過小/過大の可能性）。`,
      action: "server/pricing.js に該当モデルの単価を追加して精度を上げる。",
      estMonthlySavings: 0,
    });
  }

  items.sort((a, b) => {
    if (b.estMonthlySavings !== a.estMonthlySavings) {
      return b.estMonthlySavings - a.estMonthlySavings;
    }
    return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  });

  const totalEstMonthlySavings = items.reduce((sum, it) => sum + it.estMonthlySavings, 0);
  return { items, totalEstMonthlySavings, periodDays };
}

/** topModel 以外で最も単価の安いモデル（単価が topRate 未満）を返す。 */
function cheapestOtherModel(
  s: Summary,
  topModelName: string,
  topRate: number
): { model: string; rate: number } | null {
  let best: { model: string; rate: number } | null = null;
  for (const m of s.models) {
    if (m.model === topModelName || m.tokens <= 0) continue;
    const rate = m.cost / m.tokens;
    if (rate >= topRate) continue;
    if (!best || rate < best.rate) best = { model: m.model, rate };
  }
  return best;
}

/** 常時注入のうち最も大きい寄与を持つファイルの表示用ラベルを返す。 */
function biggestOverhead(s: Summary): string {
  const candidates: Array<{ label: string; tokens: number }> = [];
  if (s.overhead.claudeMd) {
    candidates.push({ label: "CLAUDE.md", tokens: s.overhead.claudeMd.alwaysTokens });
  }
  for (const p of s.overhead.globalPlugins) {
    candidates.push({ label: `プラグイン ${p.name}`, tokens: p.totalAlwaysTokens });
  }
  for (const p of s.overhead.personalSkills) {
    candidates.push({ label: p.label, tokens: p.alwaysTokens });
  }
  for (const r of s.overhead.atRefs) {
    candidates.push({ label: r.label, tokens: r.alwaysTokens });
  }
  const top = candidates.sort((a, b) => b.tokens - a.tokens)[0];
  return top ? `最大: ${top.label}` : "CLAUDE.md / プラグイン / スキル";
}

/** /Users/x/work/foo → foo（表示を短く）。 */
function shortCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd;
}
