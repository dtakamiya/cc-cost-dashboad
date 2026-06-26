export const usd = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const compact = (n: number) =>
  n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const pct = (n: number) => (n * 100).toFixed(1) + "%";

// モデル名→安定した色。
const PALETTE = ["#818cf8", "#34d399", "#fbbf24", "#fb7185", "#c084fc", "#22d3ee", "#f472b6", "#a3e635"];
const colorCache = new Map<string, string>();
export function modelColor(model: string): string {
  if (!colorCache.has(model)) {
    colorCache.set(model, PALETTE[colorCache.size % PALETTE.length]);
  }
  return colorCache.get(model)!;
}
