import type { Summary } from "./api";

export interface ContextBudget {
  overheadPct: number;
  historyPct: number;
  inputPct: number;
  outputPct: number;
  historyDominant: boolean;
}

// 会話履歴の再送(cacheRead)がこの比率超なら「履歴再送が支配的」とみなす。
export const HISTORY_DOMINANT_RATIO_THRESHOLD = 0.5;

/**
 * 平均1ターンあたりのトークン構成比を4区分で算出する。
 * - 常時注入オーバーヘッド: overhead.totalAlwaysTokens
 * - 会話履歴の再送: tokenSplit.cacheRead
 * - 新規入力: tokenSplit.input + tokenSplit.cacheCreate（cacheCreateは初回書き込みであり再送ではないため新規入力側に含める）
 * - 生成: tokenSplit.output
 * 分母が0（トークン0件）の場合は各割合を0として返す。
 */
export function computeContextBudget(s: Summary): ContextBudget {
  const overheadTokens = s.overhead.totalAlwaysTokens;
  const historyTokens = s.tokenSplit.cacheRead;
  const inputTokens = s.tokenSplit.input + s.tokenSplit.cacheCreate;
  const outputTokens = s.tokenSplit.output;
  const total = overheadTokens + historyTokens + inputTokens + outputTokens;

  if (total <= 0) {
    return { overheadPct: 0, historyPct: 0, inputPct: 0, outputPct: 0, historyDominant: false };
  }

  const overheadPct = (overheadTokens / total) * 100;
  const historyPct = (historyTokens / total) * 100;
  const inputPct = (inputTokens / total) * 100;
  const outputPct = (outputTokens / total) * 100;
  const historyDominant = historyTokens / total > HISTORY_DOMINANT_RATIO_THRESHOLD;

  return { overheadPct, historyPct, inputPct, outputPct, historyDominant };
}
