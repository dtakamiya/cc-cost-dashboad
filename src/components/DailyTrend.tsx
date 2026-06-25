import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import type { Summary } from "../api";
import { usd, modelColor } from "../format";

// 日別コスト推移（モデル別積み上げエリア）。スパイク日を視覚的に特定。
export function DailyTrend({ s }: { s: Summary }) {
  const models = s.models.map((m) => m.model);

  const data = s.daily.map((d) => {
    const row: Record<string, number | string> = { date: d.date };
    for (const m of models) row[m] = Number((d.models[m] || 0).toFixed(2));
    return row;
  });

  return (
    <section className="panel">
      <h2>日別コスト推移</h2>
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={data} margin={{ left: 8, right: 24, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
          <XAxis dataKey="date" stroke="#888" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(v) => usd(v)} stroke="#888" tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v: number) => usd(v)}
            contentStyle={{ background: "#1a1a26", border: "1px solid #333" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {models.map((m) => (
            <Area
              key={m}
              type="monotone"
              dataKey={m}
              stackId="1"
              stroke={modelColor(m)}
              fill={modelColor(m)}
              fillOpacity={0.6}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </section>
  );
}
