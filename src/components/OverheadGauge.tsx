import type { OverheadStatus } from "../advisor";
import { compact } from "../format";

export function OverheadGauge({ status }: { status: OverheadStatus }) {
  const cappedPct = Math.min(Math.max(0, status.percentage), 100);

  return (
    <div className={`gauge gauge-${status.status}`}>
      <div className="gauge-bar-bg">
        <div
          className="gauge-bar-fill"
          style={{ width: `${cappedPct}%`, backgroundColor: status.color }}
        />
      </div>
      <div className="gauge-labels">
        <span>{compact(status.current)} tok</span>
        <span>目標: {compact(status.target)} tok</span>
        <span style={{ textAlign: "right" }}>{status.percentage.toFixed(0)}%</span>
      </div>
    </div>
  );
}
