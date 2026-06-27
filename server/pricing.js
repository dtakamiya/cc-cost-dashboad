// 価格表（USD per 1M tokens）。input/output は実価格、cache 系は input から導出。
// cache write 5m = input × 1.25, cache write 1h = input × 2, cache read = input × 0.1。
// 価格を変えたいときはこの PRICING を編集するだけでダッシュボード全体に反映される。

export const CACHE_WRITE_5M_MULTIPLIER = 1.25; // cacheWrite 5m = input × 1.25
export const CACHE_WRITE_1H_MULTIPLIER = 2;    // cacheWrite 1h = input × 2
export const CACHE_READ_MULTIPLIER = 0.1;       // cacheRead = input × 0.1

export const PRICING = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5": { input: 10, output: 50 },
};

// 未知モデルのフォールバック単価（opus 相当）。使われたら isFallback=true を返す。
const FALLBACK = { input: 5, output: 25 };

const PER_TOKEN = 1 / 1_000_000;

// モデル名を価格表のキーに正規化。日付サフィックス（例 claude-haiku-4-5-20251001）を吸収。
function resolve(model) {
  if (!model) return null;
  if (PRICING[model]) return { key: model, rate: PRICING[model], isFallback: false };
  // 接頭辞一致（長いキー優先）
  const hit = Object.keys(PRICING)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (hit) return { key: hit, rate: PRICING[hit], isFallback: false };
  return { key: model, rate: FALLBACK, isFallback: true };
}

// usage: { input, output, cacheCreate, cacheRead, cache1h }
// 戻り: { total, input, output, cacheWrite, cacheRead, isFallback }（USD）
export function costOf(model, usage) {
  const { rate, isFallback } = resolve(model);
  const inUSD = rate.input * PER_TOKEN;
  const outUSD = rate.output * PER_TOKEN;
  const cacheWriteUSD = inUSD * (usage.cache1h ? CACHE_WRITE_1H_MULTIPLIER : CACHE_WRITE_5M_MULTIPLIER);
  const cacheReadUSD = inUSD * CACHE_READ_MULTIPLIER;

  const input = (usage.input || 0) * inUSD;
  const output = (usage.output || 0) * outUSD;
  const cacheWrite = (usage.cacheCreate || 0) * cacheWriteUSD;
  const cacheRead = (usage.cacheRead || 0) * cacheReadUSD;

  return {
    total: input + output + cacheWrite + cacheRead,
    input,
    output,
    cacheWrite,
    cacheRead,
    isFallback,
  };
}

export function knownModels() {
  return Object.keys(PRICING);
}
