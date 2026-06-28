import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { loadRecords } from "./parser.js";
import { aggregate } from "./aggregate.js";
import { analyzeOverhead } from "./analyze.js";
import { PRICING, CACHE_WRITE_5M_MULTIPLIER, CACHE_WRITE_1H_MULTIPLIER, CACHE_READ_MULTIPLIER } from "./pricing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const PORT = process.env.PORT || 3001;

const app = express();

let cache = null; // 直近の集計結果をメモリ保持

async function rebuild() {
  const { records, fileCount } = await loadRecords();
  const summary = aggregate(records);
  summary.source = { fileCount };
  summary.overhead = analyzeOverhead();
  cache = summary;
  return summary;
}

app.get("/api/summary", async (_req, res) => {
  try {
    if (!cache) await rebuild();
    res.json(cache);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/reload", async (_req, res) => {
  try {
    const summary = await rebuild();
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/pricing", (_req, res) => {
  res.json({
    models: PRICING,
    multipliers: {
      cacheWrite5m: CACHE_WRITE_5M_MULTIPLIER,
      cacheWrite1h: CACHE_WRITE_1H_MULTIPLIER,
      cacheRead: CACHE_READ_MULTIPLIER,
    },
  });
});

// 本番: ビルド済みフロントを配信
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get("*", (_req, res) => res.sendFile(path.join(DIST, "index.html")));
}

export { app };

// テスト時はサーバーを起動しない
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`cc-cost-dashboard API on http://localhost:${PORT}`);
  });
}
