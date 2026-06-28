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
import { compact, usd, modelColor } from "../format";

const TOOLTIP_STYLE = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-border)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
} as const;

type DisplayMode = "tokens" | "cost";

interface ModelBreakdownTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: Record<string, unknown> }>;
}

function ModelBreakdownTooltip({ active, payload }: ModelBreakdownTooltipProps) {
  if (!active || !payload?.[0]) return null;
  const data = payload[0].payload as Record<string, unknown>;
  const model = data.model as string;
  const tokens = data.tokens as number;
  const cost = data.cost as number;

  return (
    <div style={TOOLTIP_STYLE}>
      <p style={{ margin: "4px 0", fontWeight: 600 }}>{model}</p>
      <p style={{ margin: "2px 0", fontSize: 12 }}>Token: {compact(tokens)}</p>
      <p style={{ margin: "2px 0", fontSize: 12 }}>Cost: {usd(cost)}</p>
    </div>
  );
}

export function ModelBreakdown({ s }: { s: Summary }) {
  const [mode, setMode] = useState<DisplayMode>("tokens");

  const data = s.models.map((m) => ({
    model: m.model,
    tokens: m.tokens,
    cost: m.cost,
    isFallback: m.isFallback,
  })).sort((a, b) => mode === "cost" ? b.cost - a.cost : b.tokens - a.tokens);

  const dataKey = mode === "cost" ? "cost" : "tokens";
  const fmt = mode === "cost" ? usd : compact;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>モデル別使用量</h2>
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
          <YAxis type="category" dataKey="model" width={150} stroke="var(--axis)" tick={{ fontSize: 12 }} />
          <Tooltip
            content={<ModelBreakdownTooltip />}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar dataKey={dataKey} radius={[0, 4, 4, 0]} barSize={20}>
            {data.map((d) => (
              <Cell key={d.model} fill={modelColor(d.model)} />
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
            <th>モデル</th>
            <th>{mode === "cost" ? "コスト" : "トークン"}</th>
            {mode === "cost" && <th>トークン</th>}
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
              <td>{mode === "cost" ? usd(d.cost) : compact(d.tokens)}</td>
              {mode === "cost" && <td>{compact(d.tokens)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
