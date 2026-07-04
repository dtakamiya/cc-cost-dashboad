import type { Summary } from "../api";
import { compact, pct } from "../format";

const THINKING_BREAKDOWN_DETAIL =
  "extended thinking（推論）はテキスト長からの近似値。output トークンに既に含まれる内訳であり、追加コストではない。";

/**
 * output（生成）トークンの内訳（回答 vs extended thinking近似）を表示する。
 * thinking はusageに専用フィールドが無いため近似値であり、「※近似」ラベルで明示する。
 * 誤って「追加コスト」と誤解されないよう、output内訳であることをUI文言で明示する。
 */
export function ThinkingBreakdown({ s }: { s: Summary }) {
  const th = s.thinking;
  if (!th || !th.hasAnyThinking) return null;

  const outputTokens = s.tokenSplit.output;
  const answerTokens = Math.max(0, outputTokens - th.approxTokens);

  return (
    <section className="panel">
      <h2>
        output内訳（回答 vs thinking）
        <span className="badge-approx" title={THINKING_BREAKDOWN_DETAIL}>
          ※近似
        </span>
      </h2>
      <div className="drivers">
        <div className="driver">
          <div className="driver-title">回答（表示分）</div>
          <div className="driver-body">{compact(answerTokens)} トークン（{pct(1 - th.outputShare)}）</div>
        </div>
        <div className="driver tone-warn">
          <div className="driver-title">extended thinking（推論、近似）</div>
          <div className="driver-body">{compact(th.approxTokens)} トークン（{pct(th.outputShare)}）</div>
          <div className="driver-hint">{THINKING_BREAKDOWN_DETAIL}</div>
        </div>
      </div>
    </section>
  );
}
