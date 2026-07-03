import type { Delta, Summary } from "../api";
import { calcDelta } from "../api";
import { compact, usd } from "../format";
import { DeltaBadge } from "./DeltaBadge";
import { Icon, type IconName } from "./icons/Icon";

interface Card {
  icon: IconName;
  label: string;
  value: string;
  sub: string;
  primary?: boolean;
  delta?: Delta | null;
}

export function SummaryCards({ s, prev }: { s: Summary; prev?: Summary }) {
  const t = s.totals;
  const p = prev?.totals;

  const cards: Card[] = [
    {
      icon: "token",
      label: "総トークン",
      value: compact(t.tokens),
      sub: `${compact(t.messages)} メッセージ`,
      primary: true,
      delta: p ? calcDelta(t.tokens, p.tokens) : null,
    },
    {
      // セッション数・メッセージ数は totals が全期間固定値のため前期比は付けない
      icon: "sessions",
      label: "セッション数",
      value: t.sessions.toLocaleString(),
      sub: `${s.source?.fileCount ?? 0} ファイル`,
    },
    { icon: "calendar", label: "期間", value: t.from ?? "-", sub: `〜 ${t.to ?? "-"}` },
    {
      icon: "cost",
      label: "総コスト",
      value: usd(t.cost),
      sub: "期間内の合計",
      delta: p ? calcDelta(t.cost, p.cost) : null,
    },
  ];
  return (
    <div className="cards">
      {cards.map((c) => (
        <div className={c.primary ? "card primary" : "card"} key={c.label}>
          <div className="card-head">
            <Icon name={c.icon} className="card-icon" />
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
