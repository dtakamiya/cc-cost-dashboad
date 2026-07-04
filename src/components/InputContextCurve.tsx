import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { SessionTurn } from "../api";
import { computeCumulativeInputCurve, PROACTIVE_COMPACT_THRESHOLD } from "../api";
import { compact } from "../format";

interface InputContextCurveProps {
  turns: SessionTurn[] | null;
  loading: boolean;
}

interface CurveTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: { turnIndex: number; cumulativeInput: number; input: number; exceedsThreshold: boolean } }>;
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
      <p style={{ margin: "2px 0", fontSize: 12 }}>累積入力トークン: {compact(p.cumulativeInput)}</p>
      <p style={{ margin: "2px 0", fontSize: 12 }}>このターン: {compact(p.input)}</p>
    </div>
  );
}

export function InputContextCurve({ turns, loading }: InputContextCurveProps) {
  if (loading) {
    return <div style={{ padding: "8px 12px", color: "var(--muted)", fontSize: 13 }}>読み込み中…</div>;
  }
  if (!turns || turns.length === 0) {
    return <div style={{ padding: "8px 12px", color: "var(--muted)", fontSize: 13 }}>ターンデータなし</div>;
  }

  const curve = computeCumulativeInputCurve(turns);
  const exceeded = curve.filter((p) => p.exceedsThreshold);

  return (
    <div style={{ padding: "8px 12px" }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
        累積入力トークン推移（{curve.length} ターン）
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={curve} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="turnIndex" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => compact(v)} width={70} />
          <Tooltip content={<CurveTooltip />} />
          <ReferenceLine
            y={PROACTIVE_COMPACT_THRESHOLD}
            stroke="var(--danger, #ef4444)"
            strokeDasharray="4 4"
          />
          <Line
            type="monotone"
            dataKey="cumulativeInput"
            stroke="var(--accent, #3b82f6)"
            dot={{ r: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {exceeded.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--danger, #ef4444)", marginTop: 6 }}>
          ターン #{exceeded.map((p) => p.turnIndex).join(", ")} で累積入力トークンが{" "}
          {compact(PROACTIVE_COMPACT_THRESHOLD)} を超過しています。
          このあたりで /clear または /compact を検討してください。
        </div>
      )}
    </div>
  );
}
