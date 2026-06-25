export const usd = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const compact = (n: number) =>
  n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const pct = (n: number) => (n * 100).toFixed(1) + "%";

// モデル名→安定した色。
const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
const colorCache = new Map<string, string>();
export function modelColor(model: string): string {
  if (!colorCache.has(model)) {
    colorCache.set(model, PALETTE[colorCache.size % PALETTE.length]);
  }
  return colorCache.get(model)!;
}
