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

// gradient の id に使える安全な文字列へ。
const safeId = (m: string) => "grad-" + m.replace(/[^a-zA-Z0-9_-]/g, "_");

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
          <defs>
            {models.map((m) => (
              <linearGradient key={m} id={safeId(m)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={modelColor(m)} stopOpacity={0.7} />
                <stop offset="100%" stopColor={modelColor(m)} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="date" stroke="var(--axis)" tick={{ fontSize: 11 }} tickMargin={8} />
          <YAxis tickFormatter={(v) => usd(v)} stroke="var(--axis)" tick={{ fontSize: 11 }} width={56} />
          <Tooltip
            formatter={(v: number) => usd(v)}
            cursor={{ stroke: "var(--axis)", strokeDasharray: "3 3" }}
            contentStyle={{
              background: "var(--tooltip-bg)",
              border: "1px solid var(--tooltip-border)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
          {models.map((m) => (
            <Area
              key={m}
              type="monotone"
              dataKey={m}
              stackId="1"
              stroke={modelColor(m)}
              strokeWidth={1.5}
              fill={`url(#${safeId(m)})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </section>
  );
}
