import type { Summary } from "../api";
import { compact } from "../format";

const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// トークン量 → セルの濃さ（0 は無色、それ以外は最小値を底上げして視認性を確保）。
function cellColor(tokens: number, max: number): string {
  if (tokens <= 0 || max <= 0) return "transparent";
  const ratio = tokens / max;
  const alpha = 0.12 + ratio * 0.88; // 0.12〜1.0
  return `rgba(124, 127, 255, ${alpha.toFixed(3)})`;
}

export function ActivityHeatmap({ s }: { s: Summary }) {
  const activity = s.activity;
  if (!activity || activity.total <= 0) return null;

  const { matrix, max, peak } = activity;

  return (
    <section className="panel">
      <h2>時間帯別アクティビティ</h2>
      <div className="heatmap-sub">
        曜日 × 時間帯のトークン使用量（ローカル時刻・全期間）
      </div>

      {peak && (
        <div className="heatmap-peak">
          最も活発な時間帯：
          <strong>
            {DAY_LABELS[peak.day]}曜 {String(peak.hour).padStart(2, "0")}時台
          </strong>
          （{compact(peak.tokens)} tokens）
        </div>
      )}

      <div className="heatmap">
        <div className="heatmap-corner" />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={`h${h}`} className="heatmap-hour">
            {h % 6 === 0 ? h : ""}
          </div>
        ))}

        {matrix.map((row, day) => (
          <DayRow key={day} day={day} row={row} max={max} />
        ))}
      </div>
    </section>
  );
}

function DayRow({ day, row, max }: { day: number; row: number[]; max: number }) {
  return (
    <>
      <div className="heatmap-day">{DAY_LABELS[day]}</div>
      {row.map((tokens, hour) => (
        <div
          key={hour}
          className="heatmap-cell"
          style={{ background: cellColor(tokens, max) }}
          title={`${DAY_LABELS[day]}曜 ${String(hour).padStart(2, "0")}時台 ・ ${compact(tokens)} tokens`}
        />
      ))}
    </>
  );
}
