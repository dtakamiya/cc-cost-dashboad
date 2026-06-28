import type { Delta, Summary } from "../api";
import { calcDelta } from "../api";
import { compact, usd } from "../format";
import { DeltaBadge } from "./DeltaBadge";

export function SummaryCards({ s, prev }: { s: Summary; prev?: Summary }) {
  const t = s.totals;
  const p = prev?.totals;
  const src = s.source;
  const qualityCard = src?.parsedLines !== undefined
    ? {
        icon: "✓",
        label: "データ品質",
        value: src.parsedLines.toLocaleString(),
        sub: (() => {
          const parts: string[] = [];
          if ((src.skippedLines ?? 0) > 0) parts.push(`スキップ: ${src.skippedLines} 行`);
          if ((src.parseErrors ?? 0) > 0) parts.push(`パースエラー: ${src.parseErrors}`);
          if ((src.unreadableFiles ?? 0) > 0) parts.push(`読込失敗: ${src.unreadableFiles} ファイル`);
          return parts.length > 0 ? parts.join(" / ") : "完全";
        })(),
      }
    : null;

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
    {
      icon: "💰",
      label: "総コスト",
      value: usd(t.cost),
      sub: "期間内の合計",
      delta: p ? calcDelta(t.cost, p.cost) : null,
    },
    ...(qualityCard ? [qualityCard] : []),
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
