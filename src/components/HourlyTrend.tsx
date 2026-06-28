import { useState } from "react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer
} from "recharts";
import type { HourlyDisplay } from "../weekly";
import { usd, compact, modelColor } from "../format";

interface HourlyTrendProps {
  data: HourlyDisplay[];
  metric: "cost" | "tokens";
  onMetricChange: (metric: "cost" | "tokens") => void;
}

interface HourlyTrendTooltipProps {
  active?: boolean;
  payload?: Array<{ dataKey: string; payload: Record<string, unknown> }>;
}

function HourlyTrendTooltip({ active, payload }: HourlyTrendTooltipProps) {
  if (!active || !payload?.[0]) return null;
  const data = payload[0].payload as Record<string, unknown>;
  const hour = data.hour as number;
  const model = payload[0].dataKey;
  const metric = data.metric as "cost" | "tokens";

  const breakdown = data.breakdown as Record<string, number> | undefined;
  if (!breakdown || !(model in breakdown)) return null;

  const value = breakdown[model] as number;

  return (
    <div
      style={{
        background: "var(--tooltip-bg)",
        border: "1px solid var(--tooltip-border)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        padding: 8,
        color: "var(--text)"
      }}
    >
      <p style={{ margin: "4px 0", fontWeight: 600 }}>{model}</p>
      <p style={{ margin: "2px 0", fontSize: 12 }}>時間: {hour}:00</p>
      <p style={{ margin: "2px 0", fontSize: 12 }}>
        {metric === "cost" ? `コスト: ${usd(value)}` : `トークン: ${compact(value)}`}
      </p>
    </div>
  );
}

export function HourlyTrend({ data, metric, onMetricChange }: HourlyTrendProps) {
  const [showMetric, setShowMetric] = useState<"cost" | "tokens">(metric);

  const handleToggle = () => {
    const newMetric = showMetric === "cost" ? "tokens" : "cost";
    setShowMetric(newMetric);
    onMetricChange(newMetric);
  };

  // 時間ごとにモデル別データをフラット化
  const chartData = data.map(hour => {
    const row: Record<string, any> = {
      hour: `${hour.hour}:00`,
      breakdown: {},
      metric: showMetric
    };

    hour.breakdown.forEach(item => {
      const value = showMetric === "cost" ? item.cost : (hour.tokens * item.cost) / hour.cost;
      row[item.model] = value;
      row.breakdown[item.model] = value;
    });

    return row;
  });

  // ユニークなモデル取得
  const models = Array.from(
    new Set(data.flatMap(h => h.breakdown.map(b => b.model)))
  );

  const title = showMetric === "cost" ? "コスト" : "トークン";

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>直近24時間（{title}）</h2>
        <button
          type="button"
          className="seg"
          onClick={handleToggle}
          style={{
            padding: "6px 12px",
            borderRadius: 4,
            background: "var(--btn-bg)",
            color: "var(--btn-text)",
            border: "1px solid var(--btn-border)",
            cursor: "pointer"
          }}
        >
          {showMetric === "cost" ? "トークン" : "コスト"} 表示
        </button>
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="hour" angle={-45} textAnchor="end" height={80} />
          <YAxis
            label={{
              value: showMetric === "cost" ? "コスト (USD)" : "トークン数",
              angle: -90,
              position: "insideLeft"
            }}
          />
          <Tooltip content={<HourlyTrendTooltip />} />
          <Legend />

          {models.map(model => (
            <Bar
              key={model}
              dataKey={model}
              stackId="a"
              fill={modelColor(model)}
              name={model}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </section>
  );
}
