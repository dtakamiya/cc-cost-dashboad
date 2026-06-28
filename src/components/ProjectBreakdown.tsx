import { useState } from "react";
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
import { compact, usd } from "../format";

const TOOLTIP_STYLE = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-border)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
} as const;

const PALETTE = ["#818cf8", "#34d399", "#fbbf24", "#fb7185", "#c084fc", "#22d3ee", "#f472b6", "#a3e635"];

type DisplayMode = "tokens" | "cost";

function projectName(cwd: string): string {
  return cwd.split(/[\\/]+/).filter(Boolean).pop() ?? cwd;
}

export function ProjectBreakdown({ s }: { s: Summary }) {
  const [mode, setMode] = useState<DisplayMode>("tokens");

  if (!s.projects || s.projects.length === 0) return null;

  const data = s.projects.slice(0, 8).map((p) => ({
    cwd: p.cwd,
    name: projectName(p.cwd),
    tokens: p.tokens,
    cost: p.cost,
  }));

  const dataKey = mode === "cost" ? "cost" : "tokens";
  const fmt = mode === "cost" ? usd : compact;
  const total = data.reduce((sum, d) => sum + (mode === "cost" ? d.cost : d.tokens), 0);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>プロジェクト別使用量</h2>
        <div className="seg" role="group" aria-label="表示モード">
          <button type="button" aria-pressed={mode === "tokens"} className={mode === "tokens" ? "active" : ""} onClick={() => setMode("tokens")}>
            トークン
          </button>
          <button type="button" aria-pressed={mode === "cost"} className={mode === "cost" ? "active" : ""} onClick={() => setMode("cost")}>
            コスト
          </button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 52)}>
        <BarChart data={data} layout="vertical" margin={{ left: 40, right: 56 }}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tickFormatter={fmt} stroke="var(--axis)" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={150} stroke="var(--axis)" tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(v: number) => fmt(v)}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={TOOLTIP_STYLE}
          />
          <Bar dataKey={dataKey} radius={[0, 4, 4, 0]} barSize={20}>
            {data.map((d, i) => (
              <Cell key={d.cwd} fill={PALETTE[i % PALETTE.length]} />
            ))}
            <LabelList
              dataKey={dataKey}
              position="right"
              formatter={fmt}
              style={{ fill: "var(--muted)", fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <table className="tbl">
        <thead>
          <tr>
            <th>プロジェクト</th>
            <th>{mode === "cost" ? "コスト" : "トークン"}</th>
            <th>割合</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => {
            const value = mode === "cost" ? d.cost : d.tokens;
            return (
              <tr key={d.cwd}>
                <td>
                  <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                  {d.name}
                </td>
                <td>{fmt(value)}</td>
                <td>{total > 0 ? ((value / total) * 100).toFixed(1) + "%" : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
