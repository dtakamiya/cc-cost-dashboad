export const usd = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const compact = (n: number) =>
  n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const pct = (n: number) => (n * 100).toFixed(1) + "%";

// モデル名→安定した色。既知モデルはプレフィックス一致で固有色を返す。
const PALETTE = ["#818cf8", "#34d399", "#fbbf24", "#fb7185", "#c084fc", "#22d3ee", "#f472b6", "#a3e635"];

// 既知モデルプレフィックス→固有色（長いプレフィックスを優先して照合）
export const MODEL_COLOR_MAP: Record<string, string> = {
  "claude-3-opus": "#fb7185",
  "claude-3-5-sonnet": "#c084fc",
  "claude-3-5-haiku": "#22d3ee",
  "claude-3-haiku": "#a3e635",
};

const colorCache = new Map<string, string>();
export function modelColor(model: string): string {
  if (colorCache.has(model)) return colorCache.get(model)!;

  // 既知プレフィックスに一致する場合は固有色を返す（長いプレフィックス優先）
  const hit = Object.keys(MODEL_COLOR_MAP)
    .filter((prefix) => model.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0];
  const color = hit ? MODEL_COLOR_MAP[hit] : PALETTE[colorCache.size % PALETTE.length];

  colorCache.set(model, color);
  return color;
}
