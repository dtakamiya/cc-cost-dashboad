import type { Summary } from "../api";
import { compact } from "../format";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function BillingBlocks({ s }: { s: Summary }) {
  const blocks = s.blocks ?? [];
  if (!blocks.length) return null;

  const active = blocks.find((b) => b.isActive);

  return (
    <section className="panel">
      <h2>5時間アクティビティブロック</h2>

      {active && (
        <div className="block-active">
          <div className="block-active-header">
            <span className="block-active-badge">ACTIVE</span>
            <span>{fmt(active.start)} 〜 {fmt(active.end)}</span>
            <span className="block-active-remain">残り {active.remainMin} 分</span>
          </div>
          <div className="block-active-stats">
            <div className="block-stat">
              <div className="block-stat-label">総トークン</div>
              <div className="block-stat-value">{compact(active.tokens)}</div>
            </div>
            <div className="block-stat">
              <div className="block-stat-label">経過時間</div>
              <div className="block-stat-value">{active.durationMin}<span className="block-stat-unit"> 分</span></div>
            </div>
            <div className="block-stat">
              <div className="block-stat-label">残り時間</div>
              <div className="block-stat-value">{active.remainMin}<span className="block-stat-unit"> 分</span></div>
            </div>
          </div>
          {active.topModel && (
            <div className="block-active-model">主モデル: {active.topModel.model}</div>
          )}
        </div>
      )}

      <div className="block-list">
        {blocks.slice(0, 10).map((b, i) => (
          <div key={i} className={`block-row ${b.isActive ? "block-row-active" : ""}`}>
            <div className="block-row-time">{fmt(b.start)}</div>
            <div className="block-row-tokens">{compact(b.tokens)} tok</div>
            <div className="block-row-model">{b.topModel?.model ?? "-"}</div>
            <div className="block-row-dur">{b.durationMin} 分</div>
          </div>
        ))}
      </div>
    </section>
  );
}
