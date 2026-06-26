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
import { compact, modelColor } from "../format";

const TOOLTIP_STYLE = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-border)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
} as const;

// 絶対パス cwd → 表示用ラベル（末尾ディレクトリ名）。
function shortName(cwd: string): string {
  if (!cwd || cwd === "(unknown)") return "(unknown)";
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

export function ProjectBreakdown({ s }: { s: Summary }) {
  const data = s.projects
    .map((p) => ({ cwd: p.cwd, name: shortName(p.cwd), tokens: p.tokens }))
    .filter((p) => p.tokens > 0);

  if (data.length === 0) return null;

  return (
    <section className="panel">
      <h2>プロジェクト別トークン使用量（全期間・上位10）</h2>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44)}>
        <BarChart data={data} layout="vertical" margin={{ left: 40, right: 64 }}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tickFormatter={(v) => compact(v)} stroke="var(--axis)" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={150} stroke="var(--axis)" tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(v: number) => compact(v)}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.cwd ?? ""}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={TOOLTIP_STYLE}
          />
          <Bar dataKey="tokens" radius={[0, 4, 4, 0]} barSize={18}>
            {data.map((d) => (
              <Cell key={d.cwd} fill={modelColor(d.name)} />
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
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.cwd}>
              <td>
                <span className="dot" style={{ background: modelColor(d.name) }} />
                <span title={d.cwd}>{d.name}</span>
              </td>
              <td>{compact(d.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
