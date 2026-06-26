import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LabelList,
} from "recharts";
import type { Summary } from "../api";
import { usd, compact, modelColor } from "../format";

const TOOLTIP_STYLE = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-border)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
} as const;

export function ModelBreakdown({ s }: { s: Summary }) {
  const data = s.models.map((m) => ({
    model: m.model,
    cost: Number(m.cost.toFixed(2)),
    tokens: m.tokens,
    isFallback: m.isFallback,
  }));

  return (
    <section className="panel">
      <h2>モデル別コスト</h2>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 52)}>
        <BarChart data={data} layout="vertical" margin={{ left: 40, right: 56 }}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tickFormatter={(v) => usd(v)} stroke="var(--axis)" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="model" width={150} stroke="var(--axis)" tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(v: number) => usd(v)}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={TOOLTIP_STYLE}
          />
          <Bar dataKey="cost" radius={[0, 4, 4, 0]} barSize={20}>
            {data.map((d) => (
              <Cell key={d.model} fill={modelColor(d.model)} />
            ))}
            <LabelList
              dataKey="cost"
              position="right"
              formatter={(v: number) => usd(v)}
              style={{ fill: "var(--muted)", fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <table className="tbl">
        <thead>
          <tr>
            <th>モデル</th>
            <th>コスト</th>
            <th>トークン</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.model}>
              <td>
                <span className="dot" style={{ background: modelColor(d.model) }} />
                {d.model}
                {d.isFallback && <span className="badge">価格未登録</span>}
              </td>
              <td>{usd(d.cost)}</td>
              <td>{compact(d.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
