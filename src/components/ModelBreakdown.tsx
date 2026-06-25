import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { Summary } from "../api";
import { usd, compact, modelColor } from "../format";

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
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 46)}>
        <BarChart data={data} layout="vertical" margin={{ left: 40, right: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
          <XAxis type="number" tickFormatter={(v) => usd(v)} stroke="#888" />
          <YAxis type="category" dataKey="model" width={150} stroke="#888" tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(v: number) => usd(v)}
            contentStyle={{ background: "#1a1a26", border: "1px solid #333" }}
          />
          <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
            {data.map((d) => (
              <Cell key={d.model} fill={modelColor(d.model)} />
            ))}
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
