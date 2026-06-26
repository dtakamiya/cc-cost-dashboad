import type { Summary } from "../api";
import { usd, compact } from "../format";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function BillingBlocks({ s }: { s: Summary }) {
  const blocks = s.blocks ?? [];
  if (!blocks.length) return null;

  const active = blocks.find((b) => b.isActive);

  return (
    <section className="panel">
      <h2>5時間課金ブロック</h2>

      {active && (
        <div className="block-active">
          <div className="block-active-header">
            <span className="block-active-badge">ACTIVE</span>
            <span>{fmt(active.start)} 〜 {fmt(active.end)}</span>
            <span className="block-active-remain">残り {active.remainMin} 分</span>
          </div>
          <div className="block-active-stats">
            <div className="block-stat">
              <div className="block-stat-label">ブロック消費</div>
              <div className="block-stat-value">{usd(active.cost)}</div>
            </div>
            <div className="block-stat">
              <div className="block-stat-label">バーンレート</div>
              <div className="block-stat-value">{usd(active.burnRatePerMin * 60)}<span className="block-stat-unit">/h</span></div>
            </div>
            <div className="block-stat">
              <div className="block-stat-label">ブロック着地予測</div>
              <div className="block-stat-value">{usd(active.burnRatePerMin * (active.durationMin + active.remainMin))}</div>
            </div>
            <div className="block-stat">
              <div className="block-stat-label">総トークン</div>
              <div className="block-stat-value">{compact(active.tokens)}</div>
            </div>
          </div>
          {active.topModel && (
            <div className="block-active-model">主モデル: {active.topModel.model} ({usd(active.topModel.cost)})</div>
          )}
        </div>
      )}

      <div className="block-list">
        {blocks.slice(0, 10).map((b, i) => (
          <div key={i} className={`block-row ${b.isActive ? "block-row-active" : ""}`}>
            <div className="block-row-time">{fmt(b.start)}</div>
            <div className="block-row-cost">{usd(b.cost)}</div>
            <div className="block-row-tokens">{compact(b.tokens)} tok</div>
            <div className="block-row-model">{b.topModel?.model ?? "-"}</div>
            <div className="block-row-dur">{b.durationMin} 分</div>
          </div>
        ))}
      </div>
    </section>
  );
}
