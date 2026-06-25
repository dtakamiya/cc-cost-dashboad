import type { Summary } from "../api";
import { usd, compact } from "../format";

export function SummaryCards({ s }: { s: Summary }) {
  const t = s.totals;
  const cards = [
    { label: "合計コスト", value: usd(t.cost), sub: "推定（価格表ベース）" },
    { label: "総トークン", value: compact(t.tokens), sub: `${compact(t.messages)} メッセージ` },
    { label: "セッション数", value: t.sessions.toLocaleString(), sub: `${s.source?.fileCount ?? 0} ファイル` },
    { label: "期間", value: t.from ?? "-", sub: `〜 ${t.to ?? "-"}` },
  ];
  return (
    <div className="cards">
      {cards.map((c) => (
        <div className="card" key={c.label}>
          <div className="card-label">{c.label}</div>
          <div className="card-value">{c.value}</div>
          <div className="card-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
