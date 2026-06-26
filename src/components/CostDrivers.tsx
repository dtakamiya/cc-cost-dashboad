import type { Summary } from "../api";
import { usd, pct } from "../format";

// 「なぜコストが高いか」を一目で示すパネル。
export function CostDrivers({ s }: { s: Summary }) {
  const d = s.drivers;
  const t = s.totals;
  const topShare = d.topModel && t.cost ? d.topModel.cost / t.cost : 0;

  type Tone = "good" | "warn" | "";
  const items: { title: string; body: string; hint: string; tone: Tone }[] = [];

  if (d.topModel) {
    const off = topShare > 0.6;
    items.push({
      title: "最大コストのモデル",
      body: `${d.topModel.model} — ${usd(d.topModel.cost)}（全体の ${pct(topShare)}）`,
      hint: off
        ? "高単価モデルに偏り。安価モデル（sonnet/haiku）への振り分けで削減余地。"
        : "モデル分散は良好。",
      tone: off ? "warn" : "good",
    });
  }
  if (d.topDay) {
    items.push({
      title: "最もコストの高い日",
      body: `${d.topDay.date} — ${usd(d.topDay.cost)}${
        d.topDayModel ? `（主因 ${d.topDayModel.model}）` : ""
      }`,
      hint: "スパイク日。日別推移で前後と比較し原因セッションを特定。",
      tone: "",
    });
  }
  {
    const off = d.cacheReadRatio < 0.5;
    items.push({
      title: "cache read 比率",
      body: pct(d.cacheReadRatio),
      hint: off
        ? "キャッシュが効いていない。input が割高になりがち。"
        : "キャッシュ良好（read は input の約 1/10 単価）。",
      tone: off ? "warn" : "good",
    });
  }
  {
    const off = d.outputCostRatio > 0.4;
    items.push({
      title: "output コスト比率",
      body: pct(d.outputCostRatio),
      hint: off
        ? "生成（output）が高コスト要因。出力長や effort の見直し余地。"
        : "output 比率は妥当。",
      tone: off ? "warn" : "good",
    });
  }

  return (
    <section className="panel">
      <h2>なぜコストが高いか</h2>
      <div className="drivers">
        {items.map((it) => (
          <div className={`driver${it.tone ? " " + it.tone : ""}`} key={it.title}>
            <div className="driver-title">{it.title}</div>
            <div className="driver-body">{it.body}</div>
            <div className="driver-hint">{it.hint}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
