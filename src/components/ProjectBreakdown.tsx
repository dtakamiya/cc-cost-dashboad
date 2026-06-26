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
import { compact } from "../format";

const TOOLTIP_STYLE = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-border)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
} as const;

const PALETTE = ["#818cf8", "#34d399", "#fbbf24", "#fb7185", "#c084fc", "#22d3ee", "#f472b6", "#a3e635"];

function projectName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

export function ProjectBreakdown({ s }: { s: Summary }) {
  if (!s.projects || s.projects.length === 0) return null;

  const totalTokens = s.projects.reduce((sum, p) => sum + p.tokens, 0);
  const data = s.projects.slice(0, 8).map((p) => ({
    name: projectName(p.cwd),
    tokens: p.tokens,
  }));

  return (
    <section className="panel">
      <h2>プロジェクト別トークン使用量</h2>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 52)}>
        <BarChart data={data} layout="vertical" margin={{ left: 40, right: 56 }}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tickFormatter={(v) => compact(v)} stroke="var(--axis)" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={150} stroke="var(--axis)" tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(v: number) => compact(v)}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={TOOLTIP_STYLE}
          />
          <Bar dataKey="tokens" radius={[0, 4, 4, 0]} barSize={20}>
            {data.map((d, i) => (
              <Cell key={d.name} fill={PALETTE[i % PALETTE.length]} />
            ))}
            <LabelList
              dataKey="tokens"
              position="right"
              formatter={(v: number) => compact(v)}
              style={{ fill: "var(--muted)", fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <table className="tbl">
        <thead>
          <tr>
            <th>プロジェクト</th>
            <th>トークン</th>
            <th>割合</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={d.name}>
              <td>
                <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                {d.name}
              </td>
              <td>{compact(d.tokens)}</td>
              <td>{totalTokens > 0 ? ((d.tokens / totalTokens) * 100).toFixed(1) + "%" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
