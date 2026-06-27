import type { Summary } from "../api";
import { buildRecommendations, type Priority } from "../advisor";
import { usd } from "../format";

const PRIORITY_LABEL: Record<Priority, string> = { high: "高", medium: "中", low: "低" };
const PRIORITY_TONE: Record<Priority, string> = { high: "warn", medium: "warn", low: "" };

export function OptimizationAdvisor({ s }: { s: Summary }) {
  const { items, totalEstMonthlySavings } = buildRecommendations(s);

  if (items.length === 0) {
    return (
      <section className="panel">
        <h2>最適化アドバイス</h2>
        <div className="driver tone-good">
          <div className="driver-body">目立った無駄は検出されませんでした 👍</div>
          <div className="driver-hint">使い方は効率的です。期間を変えると別の傾向が見える場合があります。</div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>最適化アドバイス</h2>
      {totalEstMonthlySavings > 0 && (
        <div className="advisor-headline">
          推定削減ポテンシャル <strong>{usd(totalEstMonthlySavings)}/月</strong>
          <span className="advisor-note">（現在の利用ペースからの目安）</span>
        </div>
      )}
      <div className="drivers">
        {items.map((it) => (
          <div className={`driver tone-${PRIORITY_TONE[it.priority]}`} key={it.id}>
            <div className="driver-title">
              <span className={`badge prio-${it.priority}`}>優先度 {PRIORITY_LABEL[it.priority]}</span>
              {it.estMonthlySavings > 0 && (
                <span className="advisor-saving">〜{usd(it.estMonthlySavings)}/月</span>
              )}
            </div>
            <div className="driver-body">{it.title}</div>
            <div className="driver-hint">{it.detail}</div>
            <div className="driver-action">→ {it.action}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
