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
import type { Summary, McpServerUsage } from "../api";
import { compact } from "../format";

const TOOLTIP_STYLE = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-border)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
} as const;

const PALETTE = ["#818cf8", "#34d399", "#fbbf24", "#fb7185", "#c084fc", "#22d3ee", "#f472b6", "#a3e635"];

type DisplayMode = "calls" | "sessions";

// MCPサーバーの呼び出し回数がこの値未満の場合、CLIツールへの置き換えを検討する候補とみなす。
// 公式ドキュメントの指針（MCPサーバーはコンテキストを大量消費する）を踏まえ、
// 使用頻度が低い（＝コンテキスト消費に見合った価値を得られていない可能性が高い）サーバーを
// 絶対呼び出し回数の閾値で判定する。10回未満は「たまにしか使わない」の目安として設定。
const LOW_USAGE_CALLS_THRESHOLD = 10;

interface McpServerBreakdownTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: Record<string, unknown> }>;
}

function McpServerBreakdownTooltip({ active, payload }: McpServerBreakdownTooltipProps) {
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

export function McpServerBreakdown({ s }: { s: Summary }) {
  const [mode, setMode] = useState<DisplayMode>("calls");

  const byMcpServer = s.byMcpServer ?? [];
  const definedServers = s.overhead?.mcpServers ?? [];
  if (byMcpServer.length === 0 && definedServers.length === 0) return null;

  // 定義済みMCPサーバー（overhead.mcpServers、callCount/lastUsed突合済み）をサーバー名で引けるようにする。
  // ログにのみ存在し定義に無いサーバーは overhead.mcpServers に含まれないため undefined になる（想定内）。
  const overheadByName = new Map(definedServers.map((m) => [m.name, m]));

  // 棒グラフは実際の呼び出し実績（byMcpServer）のみを対象にする（0件のサーバーを含めるとグラフが崩れるため）。
  const data = byMcpServer.map((m: McpServerUsage) => {
    const overheadEntry = overheadByName.get(m.serverName);
    return {
      key: m.serverName,
      name: m.serverName,
      calls: m.calls,
      sessions: m.sessions,
      isLowUsage: m.calls < LOW_USAGE_CALLS_THRESHOLD,
      isUnused: overheadEntry?.callCount === 0,
      lastUsed: overheadEntry?.lastUsed ?? m.lastUsed,
    };
  });

  // テーブルは定義済みだが利用実績が一切無い（byMcpServerに現れない）サーバーも「未使用」として追加表示する。
  const usageNames = new Set(byMcpServer.map((m) => m.serverName));
  const neverUsedRows = definedServers
    .filter((m) => !usageNames.has(m.name))
    .map((m) => ({
      key: m.name,
      name: m.name,
      calls: 0,
      sessions: 0,
      isLowUsage: true,
      isUnused: m.callCount === 0,
      lastUsed: m.lastUsed,
    }));
  const tableRows = [...data, ...neverUsedRows];

  const dataKey = mode === "sessions" ? "sessions" : "calls";
  const fmt = (value: number) => compact(value);
  const total = data.reduce((sum, d) => sum + (mode === "sessions" ? d.sessions : d.calls), 0);
  const lowUsageServers = data.filter((d) => d.isLowUsage);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>MCPサーバー別ツール利用</h2>
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
      {data.length > 0 && (
        <ResponsiveContainer width="100%" height={Math.max(160, data.length * 52)}>
          <BarChart data={data} layout="vertical" margin={{ left: 120, right: 56 }}>
            <CartesianGrid horizontal={false} stroke="var(--grid)" />
            <XAxis type="number" tickFormatter={fmt} stroke="var(--axis)" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={120} stroke="var(--axis)" tick={{ fontSize: 12 }} />
            <Tooltip
              content={<McpServerBreakdownTooltip />}
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
      )}
      <table className="tbl">
        <thead>
          <tr>
            <th>MCPサーバー</th>
            <th>{mode === "sessions" ? "セッション数" : "呼び出し回数"}</th>
            <th>割合</th>
            <th>最終使用日</th>
          </tr>
        </thead>
        <tbody>
          {tableRows.map((d, i) => {
            const value = mode === "sessions" ? d.sessions : d.calls;
            return (
              <tr key={d.key}>
                <td>
                  <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                  {d.name}
                  {d.isUnused && <span className="badge">未使用</span>}
                </td>
                <td>{fmt(value)}</td>
                <td>{total > 0 ? ((value / total) * 100).toFixed(1) + "%" : "—"}</td>
                <td>{d.lastUsed ? d.lastUsed.slice(0, 10) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {lowUsageServers.length > 0 && (
        <p className="hint">
          呼び出し頻度が低いサーバー（
          {lowUsageServers.map((d) => d.name).join(", ")}
          ）は、gh/aws/gcloud等のCLIツールへの置き換えを検討するとコンテキスト効率が改善する可能性があります。
        </p>
      )}
    </section>
  );
}
