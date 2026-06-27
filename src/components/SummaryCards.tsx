import type { Summary, DeltaSummary } from "../api";
import { compact } from "../format";

function DeltaBadge({ pct, invertColor = false }: { pct: number | null | undefined; invertColor?: boolean }) {
  if (pct == null) return null;
  const isUp = pct > 0;
  // コストは増加が悪（赤）、トークン/セッションも増加は赤にする（使用量なので）
  // invertColor=true なら増加を緑にする（将来の拡張用）
  const bad = isUp ? !invertColor : invertColor;
  const color = bad ? "var(--red, #ef4444)" : "var(--green, #22c55e)";
  const arrow = isUp ? "↑" : "↓";
  return (
    <span style={{ fontSize: 11, color, marginLeft: 6, fontWeight: 600 }}>
      {arrow} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export function SummaryCards({ s, delta }: { s: Summary; delta?: DeltaSummary | null }) {
  const t = s.totals;
  const cards = [
    {
      icon: "🔢",
      label: "総トークン",
      value: compact(t.tokens),
      sub: `${compact(t.messages)} メッセージ`,
      primary: true,
      deltaPct: delta?.tokens,
    },
    {
      icon: "🗂️",
      label: "セッション数",
      value: t.sessions.toLocaleString(),
      sub: `${s.source?.fileCount ?? 0} ファイル`,
      deltaPct: delta?.sessions,
    },
    {
      icon: "📅",
      label: "期間",
      value: t.from ?? "-",
      sub: `〜 ${t.to ?? "-"}`,
      deltaPct: undefined,
    },
  ];
  return (
    <div className="cards">
      {cards.map((c) => (
        <div className={c.primary ? "card primary" : "card"} key={c.label}>
          <div className="card-head">
            <span className="card-icon" aria-hidden="true">{c.icon}</span>
            <span className="card-label">{c.label}</span>
          </div>
          <div className="card-value">
            {c.value}
            <DeltaBadge pct={c.deltaPct} />
          </div>
          <div className="card-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
