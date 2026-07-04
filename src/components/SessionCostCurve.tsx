import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
} from "recharts";
import type { SessionTurn } from "../api";
import { computeCumulativeCostCurve } from "../api";
import { usd } from "../format";

interface SessionCostCurveProps {
  turns: SessionTurn[] | null;
  loading: boolean;
}

interface CurveTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: { turnIndex: number; cumulativeCost: number; cost: number; isSpike: boolean } }>;
}

function CurveTooltip({ active, payload }: CurveTooltipProps) {
  if (!active || !payload?.[0]) return null;
  const p = payload[0].payload;
  return (
    <div
      style={{
        background: "var(--tooltip-bg)",
        border: "1px solid var(--tooltip-border)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        padding: 8,
        color: "var(--text)",
      }}
    >
      <p style={{ margin: "2px 0", fontSize: 12 }}>ターン #{p.turnIndex}</p>
      <p style={{ margin: "2px 0", fontSize: 12 }}>累積コスト: {usd(p.cumulativeCost)}</p>
      <p style={{ margin: "2px 0", fontSize: 12 }}>このターン: {usd(p.cost)}</p>
    </div>
  );
}

export function SessionCostCurve({ turns, loading }: SessionCostCurveProps) {
  if (loading) {
    return <div style={{ padding: "8px 12px", color: "var(--muted)", fontSize: 13 }}>読み込み中…</div>;
  }
  if (!turns || turns.length === 0) {
    return <div style={{ padding: "8px 12px", color: "var(--muted)", fontSize: 13 }}>ターンデータなし</div>;
  }

  const curve = computeCumulativeCostCurve(turns);
  const spikes = curve.filter((p) => p.isSpike);

  return (
    <div style={{ padding: "8px 12px" }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
        累積コスト推移（{curve.length} ターン）
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={curve} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="turnIndex" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => usd(v)} width={70} />
          <Tooltip content={<CurveTooltip />} />
          <Line
            type="monotone"
            dataKey="cumulativeCost"
            stroke="var(--accent, #3b82f6)"
            dot={{ r: 2 }}
            isAnimationActive={false}
          />
          {spikes.map((s) => (
            <ReferenceDot
              key={s.turnIndex}
              x={s.turnIndex}
              y={s.cumulativeCost}
              r={5}
              fill="var(--danger, #ef4444)"
              stroke="none"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {spikes.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--danger, #ef4444)", marginTop: 6 }}>
          ターン #{spikes.map((s) => s.turnIndex).join(", ")} でコストが急増しています。
          このあたりで /clear または /compact を検討してください。
        </div>
      )}
    </div>
  );
}
