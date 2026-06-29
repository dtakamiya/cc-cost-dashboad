import { useState } from "react";
import type { Summary } from "../api";
import { compact, usd } from "../format";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const INITIAL_COUNT = 5;
const MAX_COUNT = 20;

export function BillingBlocks({ s }: { s: Summary }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const blocks = s.blocks ?? [];
  if (!blocks.length) return null;

  const active = blocks.find((b) => b.isActive);
  const history = blocks
    .filter((b) => !b.isActive)
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));

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
              <div className="block-stat-label">コスト</div>
              <div className="block-stat-value">{usd(active.cost)}</div>
            </div>
            <div className="block-stat">
              <div className="block-stat-label">直近15分バーンレート</div>
              <div className="block-stat-value">{usd(active.recentBurnRatePerMin)}<span className="block-stat-unit"> /分</span></div>
            </div>
            <div className="block-stat">
              <div className="block-stat-label">平均バーンレート</div>
              <div className="block-stat-value">{usd(active.burnRatePerMin)}<span className="block-stat-unit"> /分</span></div>
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

      {history.length > 0 && (
        <>
          <button
            className="history-toggle"
            aria-expanded={historyOpen}
            onClick={() => {
              setHistoryOpen((prev) => {
                if (prev) setShowAll(false);
                return !prev;
              });
            }}
          >
            {historyOpen ? "▼" : "▶"} 履歴（{history.length}件）
          </button>
          {historyOpen && (
            <>
              <div className="block-list">
                {history.slice(0, showAll ? MAX_COUNT : INITIAL_COUNT).map((b, i) => (
                  <div key={i} className="block-row">
                    <div className="block-row-time">{fmt(b.start)} 〜 {fmt(b.end)}</div>
                    <div className="block-row-tokens">{compact(b.tokens)} tok</div>
                    <div className="block-row-model">{b.topModel?.model ?? "-"}</div>
                    <div className="block-row-dur">{b.durationMin} 分</div>
                    <div className="block-row-cost">{usd(b.cost)}</div>
                  </div>
                ))}
              </div>
              {history.length > (showAll ? MAX_COUNT : INITIAL_COUNT) && (
                <button
                  className="history-show-more"
                  onClick={() => setShowAll(true)}
                >
                  もっと見る（残り {history.length - INITIAL_COUNT} 件）
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
