import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { loadRecords } from "./parser.js";
import { aggregate } from "./aggregate.js";
import { analyzeOverhead } from "./analyze.js";

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

// 本番: ビルド済みフロントを配信
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get("*", (_req, res) => res.sendFile(path.join(DIST, "index.html")));
}

app.listen(PORT, () => {
  console.log(`cc-cost-dashboard API on http://localhost:${PORT}`);
});
