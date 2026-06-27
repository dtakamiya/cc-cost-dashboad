import type { Delta, Summary } from "../api";
import { calcDelta } from "../api";
import { compact } from "../format";
import { DeltaBadge } from "./DeltaBadge";

export function SummaryCards({ s, prev }: { s: Summary; prev?: Summary }) {
  const t = s.totals;
  const p = prev?.totals;
  const cards: { icon: string; label: string; value: string; sub: string; primary?: boolean; delta?: Delta | null }[] = [
    {
      icon: "🔢",
      label: "総トークン",
      value: compact(t.tokens),
      sub: `${compact(t.messages)} メッセージ`,
      primary: true,
      delta: p ? calcDelta(t.tokens, p.tokens) : null,
    },
    {
      // セッション数・メッセージ数は totals が全期間固定値のため前期比は付けない
      icon: "🗂️",
      label: "セッション数",
      value: t.sessions.toLocaleString(),
      sub: `${s.source?.fileCount ?? 0} ファイル`,
    },
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
          <div className="card-value">
            {c.value}
            <DeltaBadge delta={c.delta ?? null} />
          </div>
          <div className="card-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
