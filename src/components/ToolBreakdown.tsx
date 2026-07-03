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
import type { Summary, ToolUsage } from "../api";
import { compact } from "../format";

const TOOLTIP_STYLE = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-border)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
} as const;

const PALETTE = ["#818cf8", "#34d399", "#fbbf24", "#fb7185", "#c084fc", "#22d3ee", "#f472b6", "#a3e635"];

type DisplayMode = "calls" | "sessions";

interface ToolBreakdownTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: Record<string, unknown> }>;
}

function ToolBreakdownTooltip({ active, payload }: ToolBreakdownTooltipProps) {
  if (!active || !payload?.[0]) return null;
  const data = payload[0].payload as Record<string, unknown>;
  const name = data.name as string;
  const calls = data.calls as number;
  const sessions = data.sessions as number;

  return (
    <div style={TOOLTIP_STYLE}>
      <p style={{ margin: "4px 0", fontWeight: 600 }}>{name}</p>
      <p style={{ margin: "2px 0", fontSize: 12 }}>Calls: {compact(calls)}</p>
      <p style={{ margin: "2px 0", fontSize: 12 }}>Sessions: {compact(sessions)}</p>
    </div>
  );
}

export function ToolBreakdown({ s }: { s: Summary }) {
  const [mode, setMode] = useState<DisplayMode>("calls");

  if (!s.byTool || s.byTool.length === 0) return null;

  const data = s.byTool.map((t: ToolUsage) => ({
    key: t.key,
    name: t.name,
    toolName: t.toolName,
    calls: t.calls,
    sessions: t.sessions,
  }));

  const dataKey = mode === "sessions" ? "sessions" : "calls";
  const fmt = (value: number) => compact(value);
  const total = data.reduce((sum, d) => sum + (mode === "sessions" ? d.sessions : d.calls), 0);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>ツール利用状況</h2>
        <div className="seg" role="group" aria-label="表示モード">
          <button
            type="button"
            aria-pressed={mode === "calls"}
            className={mode === "calls" ? "active" : ""}
            onClick={() => setMode("calls")}
          >
            呼び出し回数
          </button>
          <button
            type="button"
            aria-pressed={mode === "sessions"}
            className={mode === "sessions" ? "active" : ""}
            onClick={() => setMode("sessions")}
          >
            セッション数
          </button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 52)}>
        <BarChart data={data} layout="vertical" margin={{ left: 120, right: 56 }}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tickFormatter={fmt} stroke="var(--axis)" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={120} stroke="var(--axis)" tick={{ fontSize: 12 }} />
          <Tooltip
            content={<ToolBreakdownTooltip />}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar dataKey={dataKey} radius={[0, 4, 4, 0]} barSize={20}>
            {data.map((d, i) => (
              <Cell key={d.key} fill={PALETTE[i % PALETTE.length]} />
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
            <th>ツール</th>
            <th>{mode === "sessions" ? "セッション数" : "呼び出し回数"}</th>
            <th>割合</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => {
            const value = mode === "sessions" ? d.sessions : d.calls;
            return (
              <tr key={d.key}>
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
