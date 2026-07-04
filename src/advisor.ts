import { isBloatedSession, isFrequentlyCompactedSession, isOutputHeavySession, isProactiveThresholdSession, isToolResultHeavySession, PROACTIVE_COMPACT_THRESHOLD, type BillingMode, type Summary } from "./api";

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
  source:
    | { kind: "claudeMd"; label: string }
    | { kind: "atRef"; label: string }
    | { kind: "plugin"; pluginName: string; label: string }
    | { kind: "skill"; label: string };
}

export interface Recommendation {
  id: string;
  priority: Priority;
  title: string; // 長文見出し（後方互換のため維持）
  shortTitle: string; // 短縮見出し（件数付きなど、UI上の見出し表示用）
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
export const IDLE_REWRITE_COST_THRESHOLD = 0.01; // アイドル失効による再書き込みコスト(USD)がこの値超で提案
export const MODEL_SWITCH_REWRITE_COST_THRESHOLD = 0.01; // モデル切替による再作成コスト(USD)がこの値超で提案
export const MCP_OVERHEAD_TOKEN_THRESHOLD = 3000; // MCPサーバ推定トークン合計がこの値超で無効化検討を提案
export const THINKING_OUTPUT_SHARE_THRESHOLD = 0.5; // output中のthinking近似比率がこの値超で警告
export const DUPLICATE_READ_TOKEN_THRESHOLD = 20_000; // 同一ファイル重複Readの推定重複トークン合計がこの値超で警告

// --- 節約見積りの保守的な係数（過大評価を避ける） ---
const BLOAT_SAVABLE_FRACTION = 0.5; // 肥大化セッションの再送文脈のうち /clear で避けられる割合
const MODEL_SHIFT_FRACTION = 0.3; // 高単価モデルから安価モデルへ振り替えられる割合
const OUTPUT_REDUCTION_FRACTION = 0.2; // 出力長見直しで削減できる割合
const DIFF_OUTPUT_SAVABLE_FRACTION = 0.3; // diff出力に寄せることで削減できる出力トークンの割合
const DIFF_OUTPUT_TOP_SESSION_LIMIT = 3; // diff出力アドバイスで名指しする上位セッション数
const MCP_DISABLE_FRACTION = 0.5; // 全MCP無効化は非現実的なため、未使用分のみ無効化できると仮定する割合

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
  const candidates: Array<Omit<FileImpact, "monthlySavings" | "rank">> = [];
  if (s.overhead.claudeMd) {
    candidates.push({
      label: s.overhead.claudeMd.label,
      alwaysTokens: s.overhead.claudeMd.alwaysTokens,
      source: { kind: "claudeMd", label: s.overhead.claudeMd.label },
    });
  }
  for (const r of s.overhead.atRefs) {
    candidates.push({
      label: `@${r.label}`,
      alwaysTokens: r.alwaysTokens,
      source: { kind: "atRef", label: r.label },
    });
  }
  for (const p of s.overhead.globalPlugins) {
    for (const f of p.files) {
      candidates.push({
        label: `[plugin] ${p.name} / ${f.label}`,
        alwaysTokens: f.alwaysTokens,
        source: { kind: "plugin", pluginName: p.name, label: f.label },
      });
    }
  }
  for (const sk of s.overhead.personalSkills) {
    candidates.push({
      label: `[skill] ${sk.label}`,
      alwaysTokens: sk.alwaysTokens,
      source: { kind: "skill", label: sk.label },
    });
  }
  return candidates
    .map((c) => ({
      ...c,
      monthlySavings: c.alwaysTokens * cacheCreateRate * sessionFactor * monthlyFactor,
      rank: 0,
    }))
    .sort((a, b) => b.monthlySavings - a.monthlySavings)
    .map((item, i) => ({ ...item, rank: i + 1 }));
}

/** Summary を解析してコスト削減推奨アクション一覧を生成する。 */
export function buildRecommendations(s: Summary, billingMode: BillingMode = "api"): AdvisorResult {
  const periodDays = periodDaysOf(s.totals.from, s.totals.to);
  const monthlyFactor = 30 / periodDays;

  const cacheReadRate = safeRate(s.costSplit.cacheRead, s.tokenSplit.cacheRead);
  const cacheCreateRate = safeRate(s.costSplit.cacheWrite, s.tokenSplit.cacheCreate);
  const sessionFactor = s.totals.sessions > 0 ? s.totals.sessions : 0;

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
      shortTitle: `セッションの肥大化（${bloated.length}件）`,
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
        shortTitle: `モデル偏り（${top.model}）`,
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
      shortTitle: `常時注入オーバーヘッド過大（${baseline.toLocaleString()}トークン）`,
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
      shortTitle: `output過多（コスト比 ${(s.drivers.outputCostRatio * 100).toFixed(0)}%）`,
      detail: `output がコスト全体の ${(s.drivers.outputCostRatio * 100).toFixed(0)}% を占有。`,
      action: "出力長の上限指定・簡潔な指示・effort 設定の見直しで生成量を抑える。",
      estMonthlySavings: savings,
    });
  }

  // 4b. 出力（output）過多な個別セッション → diff出力を促す（medium, 定量）
  // 4.の"output-heavy"は全体傾向のみを示すため、こちらは個別セッション名+diffアクションを提示する。
  const outputHeavySessions = s.bySession.filter((sess) => isOutputHeavySession(sess));
  if (outputHeavySessions.length > 0) {
    const outputRate = safeRate(s.costSplit.output, s.tokenSplit.output);
    const savings = outputHeavySessions.reduce((sum, sess) => {
      return sum + sess.output * outputRate * DIFF_OUTPUT_SAVABLE_FRACTION * monthlyFactor;
    }, 0);
    if (savings > 0) {
      const topSessions = [...outputHeavySessions]
        .sort((a, b) => b.output - a.output)
        .slice(0, DIFF_OUTPUT_TOP_SESSION_LIMIT);
      const cwds = [...new Set(topSessions.map((sess) => shortCwd(sess.cwd)))].join(", ");
      items.push({
        id: "diff-output-advice",
        priority: "medium",
        title: "特定セッションで出力（生成）トークンが集中している",
        shortTitle: `出力集中セッション（${outputHeavySessions.length}件）`,
        detail: `${outputHeavySessions.length} 件のセッションで出力トークン比率が高い（${cwds} ほか）。`,
        action: "全文書き直しではなく diff（差分）形式での出力を指示し、生成トークン量を抑える。",
        estMonthlySavings: savings,
      });
    }
  }

  // 5. キャッシュ効率低下（low, 定性）
  if (s.drivers.cacheReadRatio < CACHE_READ_RATIO_THRESHOLD) {
    items.push({
      id: "low-cache",
      priority: "low",
      title: "キャッシュが効いていない",
      shortTitle: "キャッシュ効率の低下",
      detail: `cache read 比率が ${(s.drivers.cacheReadRatio * 100).toFixed(0)}%（input が割高になりがち）。`,
      action: "関連作業は同一セッションで継続する。ただし肥大化（上記）とのトレードオフに注意。",
      estMonthlySavings: 0,
    });
  }

  // 3b. ファイル別常時注入オーバーヘッド（individual file > OVERHEAD_FILE_WARN_TOKENS）
  {
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
        shortTitle: `${c.label} の常時注入過大`,
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
  if (billingMode !== "subscription" && cs && cs.premium1h > 0 && cs.roiNet < cs.premium1h) {
    items.push({
      id: "cache-ttl-premium",
      priority: "medium",
      title: "1h キャッシュの 2倍プレミアムが回収できていない",
      shortTitle: "1hキャッシュのプレミアム未回収",
      detail: `1h キャッシュ書き込みに約 ${cs.premium1h.toFixed(2)} USD の超過コスト（5m 比）。読み込み回収が不足。`,
      action: "短命セッションや再利用の少ない作業では 1h キャッシュ指定を避け、5m 既定に寄せる。",
      estMonthlySavings: Math.max(0, cs.premium1h * monthlyFactor),
    });
  }

  // 5c. セッション内アイドルギャップによる5分キャッシュ失効（medium, 定量）
  // 中断が5分TTLを超えるとキャッシュが失効し、cache read で済むはずの文脈が
  // cache creation として再課金される。サブスクは定額のため課金インパクトが薄く除外する。
  const gs = s.cacheGapStats;
  if (billingMode !== "subscription" && gs && gs.reWriteCost > IDLE_REWRITE_COST_THRESHOLD) {
    items.push({
      id: "idle-cache-expiry",
      priority: "medium",
      title: "5分キャッシュの中断による無駄な再書き込み",
      shortTitle: `アイドルによるキャッシュ失効（${gs.expiredGapCount}回）`,
      detail: `${gs.expiredGapCount} 回のアイドルギャップ（5分TTL超の中断）でキャッシュが失効し、約 ${gs.reWriteTokens.toLocaleString()} トークンが再書き込みされた（約 ${gs.reWriteCost.toFixed(2)} USD）。`,
      action: "セッション内の中断時間を最小化するか、重要なコンテキストは1h TTLで保護する。",
      estMonthlySavings: gs.reWriteCost * monthlyFactor,
    });
  }

  // 5d. セッション内モデル切替によるキャッシュ再作成（medium, 定量）
  // プロンプトキャッシュはモデル固有のため、切替直後にcache creationが発生すると
  // cache readで済むはずのトークンが再課金される。
  const ms = s.modelSwitch;
  if (billingMode !== "subscription" && ms && ms.reCreateCost > MODEL_SWITCH_REWRITE_COST_THRESHOLD) {
    items.push({
      id: "model-switch-cost",
      priority: "medium",
      title: "セッション内モデル切替によるキャッシュ再作成",
      shortTitle: `モデル切替による再作成コスト（${ms.switchCount}回切替）`,
      detail: `${ms.switchCount} 回のモデル切替のうち、約 ${ms.reCreateTokens.toLocaleString()} トークンがキャッシュ再作成として再課金された（約 ${ms.reCreateCost.toFixed(2)} USD）。`,
      action: "タスク中はモデルを固定する（同一タスク内でのOpus/Sonnet切替を避ける）。",
      estMonthlySavings: ms.reCreateCost * monthlyFactor,
    });
  }

  // 5e. MCPサーバオーバーヘッド過大 → 未使用MCPの無効化検討（medium, 定量）
  // MCPツール定義は実行時依存で静的計測できないため、各サーバは保守的な既定推定値
  // （server/analyze.js の DEFAULT_MCP_SERVER_TOKENS）で見積もられている。
  // estimatedTokens が null（source:"unknown"）のサーバは 0 扱いで合算する。
  // action は「未使用分のみ無効化」を促すため、節約額も全サーバ無効化ではなく
  // MCP_DISABLE_FRACTION（部分的な無効化）を前提に保守的へ寄せる。
  {
    const mcpTotalTokens = s.overhead.mcpServers.reduce(
      (sum, m) => sum + (m.estimatedTokens ?? 0),
      0
    );
    if (mcpTotalTokens > MCP_OVERHEAD_TOKEN_THRESHOLD) {
      const savings =
        mcpTotalTokens * MCP_DISABLE_FRACTION * cacheCreateRate * sessionFactor * monthlyFactor;
      const serverNames = s.overhead.mcpServers.map((m) => m.name).slice(0, 5).join(", ");
      items.push({
        id: "mcp-overhead",
        priority: "medium",
        title: "MCPサーバのツール定義が常時オーバーヘッドになっている",
        shortTitle: `MCPオーバーヘッド過大（${mcpTotalTokens.toLocaleString()}トークン）`,
        detail: `${s.overhead.mcpServers.length} 件の MCP サーバ（${serverNames}）で推定 約 ${mcpTotalTokens.toLocaleString()} トークンが毎セッション常時注入される（保守的な推定値。全サーバ無効化時の上限）。`,
        action: "未使用・低頻度のMCPサーバを無効化するか、gh/aws等のCLI代替を検討する。",
        estMonthlySavings: Math.max(0, savings),
      });
    }
  }

  // 6b. コンテキスト圧縮が多発 → 先回りして /compact（medium, 定性）
  const frequentlyCompacted = s.bySession.filter((sess) => isFrequentlyCompactedSession(sess));
  if (frequentlyCompacted.length > 0) {
    const cwds = [...new Set(frequentlyCompacted.map((b) => shortCwd(b.cwd)))].slice(0, 3).join(", ");
    items.push({
      id: "frequent-compaction",
      priority: "medium",
      title: "頻繁なコンテキスト圧縮が発生している",
      shortTitle: `頻発するコンテキスト圧縮（${frequentlyCompacted.length}件）`,
      detail: `${frequentlyCompacted.length} 件のセッションで自動コンテキスト圧縮（compaction）が繰り返し発生（${cwds} ほか）。`,
      action: "区切りの良いタイミングで先回りして /compact を実行し、意図しない圧縮によるコンテキスト欠落を防ぐ。",
      estMonthlySavings: 0,
    });
  }

  // 5f. extended thinking（推論）トークンがoutputの大部分を占める（medium, 定性）
  // thinkingはoutputに既に含まれる内訳であり、二重の追加コストではない。あくまで
  // 「見えないコスト」の比率が高いことへの注意喚起であり、節約額は定量化しない（0のまま）。
  const th = s.thinking;
  if (th && th.hasAnyThinking && th.outputShare > THINKING_OUTPUT_SHARE_THRESHOLD) {
    items.push({
      id: "thinking-heavy",
      priority: "medium",
      title: "output（生成）の大部分がextended thinking（推論）に費やされている",
      shortTitle: `thinking比率過大（推定 ${(th.outputShare * 100).toFixed(0)}%）`,
      detail: `output トークンのうち約 ${(th.outputShare * 100).toFixed(0)}%（推定 約 ${th.approxTokens.toLocaleString()} トークン）がextended thinking（推論、outputに既に含まれる内訳）と推定される。`,
      action: "MAX_THINKING_TOKENS を引き下げる、またはadaptive thinkingを活用し、複雑な推論が不要なタスクでは無効化を検討する。",
      estMonthlySavings: 0,
    });
  }

  // 5g. tool_result（Read/Bash/Grep等）累積によるコンテキスト肥大 → subagent委譲（medium, 定性）
  // ツール実行結果は user 行に格納され、実行のたびにコンテキストへ蓄積・再送される。
  // 累積が閾値を超えるセッションは、大きなファイル読み込み等をsubagentに委譲することで
  // メインコンテキストの肥大を避けられる可能性が高い。金額換算は困難なため0のまま。
  const toolResultHeavySessions = s.bySession.filter((sess) => isToolResultHeavySession(sess));
  if (toolResultHeavySessions.length > 0) {
    const cwds = [...new Set(toolResultHeavySessions.map((sess) => shortCwd(sess.cwd)))].slice(0, 3).join(", ");
    items.push({
      id: "tool-result-bloat",
      priority: "medium",
      title: "ツール実行結果の累積がコンテキストを肥大させている",
      shortTitle: `ツール結果の肥大（${toolResultHeavySessions.length}件）`,
      detail: `${toolResultHeavySessions.length} 件のセッションで Read/Bash/Grep 等のツール結果累積が大きい（${cwds} ほか、近似値）。`,
      action: "大きなファイル読み込みや大量出力を伴う調査は subagent（Explore等）に委譲し、メインコンテキストへの再送を避ける。",
      estMonthlySavings: 0,
    });
  }

  // 5h. 累積入力トークンが絶対閾値(250k)を超過 → proactiveな /compact・/clear（medium, 定性）
  // "bloated-sessions"（avgContextPerMsg × messages の相対的な肥大化）や
  // "frequent-compaction"（自動compaction回数）とは異なり、こちらは
  // cacheRead + input の累積絶対量そのものが閾値を超えたかどうかで判定する。
  // ターン単位のリアルタイム判定はグラフ側（InputContextCurve）で行うため、
  // ここではセッション累計による近似のみを扱う。
  const proactiveThresholdSessions = s.bySession.filter((sess) => isProactiveThresholdSession(sess));
  if (proactiveThresholdSessions.length > 0) {
    const cwds = [...new Set(proactiveThresholdSessions.map((sess) => shortCwd(sess.cwd)))]
      .slice(0, 3)
      .join(", ");
    items.push({
      id: "proactive-compact-threshold",
      priority: "medium",
      title: "累積入力トークンが閾値を超えたセッションがある",
      shortTitle: `累積入力トークン超過（${proactiveThresholdSessions.length}件）`,
      detail: `${proactiveThresholdSessions.length} 件のセッションで累積入力トークン（cache read + input）が ${PROACTIVE_COMPACT_THRESHOLD.toLocaleString()} を超過（${cwds} ほか）。`,
      action: "250kトークン到達前にproactiveに /compact を実行するか、無関係なタスクに移る際は /clear で会話を区切る。",
      estMonthlySavings: 0,
    });
  }

  // 5i. 個別tool_resultの上限超過 → MAX_MCP_OUTPUT_TOKENS/BASH_MAX_OUTPUT_LENGTH設定（medium, 定性）
  // 5g.のtool-result-bloatはセッション累積合計・subagent委譲の話だが、こちらは「1件の巨大な
  // tool_result」が上限超過していることに着目し、env設定による上限そのものの導入を促す。
  const outliers = s.toolResultOutliers;
  if (outliers && outliers.overCount > 0) {
    const topTools = outliers.byTool.map((t) => t.toolName).slice(0, 3).join(", ");
    items.push({
      id: "tool-output-cap",
      priority: "medium",
      title: "上限を超える巨大なツール出力（tool_result）がある",
      shortTitle: `ツール出力の上限超過（${outliers.overCount}件）`,
      detail: `${outliers.overCount} 件の tool_result が推奨上限を超過（最大 約 ${outliers.maxTokensApprox.toLocaleString()} トークン、該当ツール: ${topTools} ほか、近似値）。1件の巨大な出力がそのままコンテキストに残り続け、以降のターンでも再送され続ける。`,
      action: "settings.json に MAX_MCP_OUTPUT_TOKENS=8000 と BASH_MAX_OUTPUT_LENGTH=20000 を設定し、個別ツール出力の上限を強制する。",
      estMonthlySavings: 0,
    });
  }

  // 5j. 同一ファイルの重複Read → /clear・再読込回避（medium, 定性）
  // 同一セッションで同じファイルを再Readすると全文が再びコンテキストへ蓄積される。
  // 推定重複トークンはtool_result近似値ベースの可視化専用であり、金額換算はしない（0のまま）。
  const dup = s.duplicateReads;
  if (dup && dup.totalDuplicateTokensApprox > DUPLICATE_READ_TOKEN_THRESHOLD) {
    const topFiles = dup.byFile.map((f) => f.filePath.split("/").pop() ?? f.filePath).slice(0, 3).join(", ");
    items.push({
      id: "duplicate-reads",
      priority: "medium",
      title: "同一セッション内で同じファイルが繰り返しReadされている",
      shortTitle: `重複Read（${dup.totalDuplicateReads}回）`,
      detail: `同一ファイルの2回目以降のReadが ${dup.totalDuplicateReads} 回発生し、推定 約 ${dup.totalDuplicateTokensApprox.toLocaleString()} トークンが重複（${topFiles} ほか、近似値）。`,
      action: "会話が長引いたら /clear で区切り、同一ファイルの再読込を避ける。再確認は必要な行範囲のみの部分Readにする。",
      estMonthlySavings: 0,
    });
  }

  // 6. 価格未登録モデル（low, 情報）
  if (s.warnings.fallbackModels.length > 0) {
    items.push({
      id: "fallback-pricing",
      priority: "low",
      title: "価格未登録のモデルがある",
      shortTitle: `価格未登録モデル（${s.warnings.fallbackModels.length}件）`,
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
