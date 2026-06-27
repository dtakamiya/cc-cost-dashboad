import type { Delta } from "../api";

interface DeltaBadgeProps {
  delta: Delta | null;
}

// 前期比の変化率バッジ。delta が null（比較不能 or 比較モード OFF）のときは何も表示しない。
export function DeltaBadge({ delta }: DeltaBadgeProps) {
  if (!delta) return null;
  const { pct, dir } = delta;
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "±";
  const sign = pct > 0 ? "+" : "";
  const label = dir === "flat" ? "±0.0%" : `${sign}${pct.toFixed(1)}% ${arrow}`;
  return (
    <span className={`delta delta-${dir}`} title="前の期間との比較">
      {label}
    </span>
  );
}
