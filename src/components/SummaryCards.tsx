import type { Summary } from "../api";
import { compact } from "../format";

export function SummaryCards({ s }: { s: Summary }) {
  const t = s.totals;
  const cards = [
    { icon: "🔢", label: "総トークン", value: compact(t.tokens), sub: `${compact(t.messages)} メッセージ`, primary: true },
    { icon: "🗂️", label: "セッション数", value: t.sessions.toLocaleString(), sub: `${s.source?.fileCount ?? 0} ファイル` },
    { icon: "📅", label: "期間", value: t.from ?? "-", sub: `〜 ${t.to ?? "-"}` },
  ];
  return (
    <div className="cards">
      {cards.map((c) => (
        <div className={c.primary ? "card primary" : "card"} key={c.label}>
          <div className="card-head">
            <span className="card-icon" aria-hidden="true">{c.icon}</span>
            <span className="card-label">{c.label}</span>
          </div>
          <div className="card-value">{c.value}</div>
          <div className="card-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
