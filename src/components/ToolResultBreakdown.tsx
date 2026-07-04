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
import type { Summary, ToolResultUsage } from "../api";
import { isToolResultHeavySession } from "../api";
import { compact } from "../format";

const TOOLTIP_STYLE = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-border)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
} as const;

const PALETTE = ["#818cf8", "#34d399", "#fbbf24", "#fb7185", "#c084fc", "#22d3ee", "#f472b6", "#a3e635"];

const TOP_SESSION_LIMIT = 5;

interface ToolResultBreakdownTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: Record<string, unknown> }>;
}

function ToolResultBreakdownTooltip({ active, payload }: ToolResultBreakdownTooltipProps) {
  if (!active || !payload?.[0]) return null;
  const data = payload[0].payload as Record<string, unknown>;
  const toolName = data.toolName as string;
  const tokensApprox = data.tokensApprox as number;

  return (
    <div style={TOOLTIP_STYLE}>
      <p style={{ margin: "4px 0", fontWeight: 600 }}>{toolName}</p>
      <p style={{ margin: "2px 0", fontSize: 12 }}>近似トークン数: {compact(tokensApprox)}</p>
    </div>
  );
}

export function ToolResultBreakdown({ s }: { s: Summary }) {
  if (!s.toolResultBreakdown || s.toolResultBreakdown.length === 0) return null;

  const data = s.toolResultBreakdown.map((t: ToolResultUsage) => ({
    toolName: t.toolName,
    tokensApprox: Math.round(t.tokensApprox),
  }));

  const total = data.reduce((sum, d) => sum + d.tokensApprox, 0);
  const fmt = (value: number) => compact(value);

  const topSessions = s.bySession
    .filter((sess) => isToolResultHeavySession(sess))
    .sort((a, b) => (b.toolResultTokensApprox ?? 0) - (a.toolResultTokensApprox ?? 0))
    .slice(0, TOP_SESSION_LIMIT);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>ツール結果（tool_result）トークン累積</h2>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>※近似値（isApprox）</span>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 52)}>
        <BarChart data={data} layout="vertical" margin={{ left: 120, right: 56 }}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tickFormatter={fmt} stroke="var(--axis)" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="toolName" width={120} stroke="var(--axis)" tick={{ fontSize: 12 }} />
          <Tooltip
            content={<ToolResultBreakdownTooltip />}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar dataKey="tokensApprox" radius={[0, 4, 4, 0]} barSize={20}>
            {data.map((d, i) => (
              <Cell key={d.toolName} fill={PALETTE[i % PALETTE.length]} />
            ))}
            <LabelList
              dataKey="tokensApprox"
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
            <th>近似トークン数</th>
            <th>割合</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={d.toolName}>
              <td>
                <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                {d.toolName}
              </td>
              <td>{fmt(d.tokensApprox)}</td>
              <td>{total > 0 ? ((d.tokensApprox / total) * 100).toFixed(1) + "%" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {topSessions.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, margin: "12px 0 4px" }}>ツール結果が肥大化しているセッション（近似値）</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>セッション</th>
                <th>プロジェクト</th>
                <th>ツール結果トークン数（近似）</th>
              </tr>
            </thead>
            <tbody>
              {topSessions.map((sess) => (
                <tr key={sess.sessionId}>
                  <td>{sess.sessionId}</td>
                  <td>{sess.cwd}</td>
                  <td>{fmt(sess.toolResultTokensApprox ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
