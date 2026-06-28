import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { loadRecords } from "./parser.js";
import { aggregate } from "./aggregate.js";
import { analyzeOverhead } from "./analyze.js";
import { PRICING, CACHE_WRITE_5M_MULTIPLIER, CACHE_WRITE_1H_MULTIPLIER, CACHE_READ_MULTIPLIER, costOf } from "./pricing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const PORT = process.env.PORT || 3001;

const app = express();

let cache = null; // 直近の集計結果をメモリ保持
let recordsCache = null; // ターン詳細取得用の生レコードキャッシュ

// SSE クライアント管理
const clients = new Set();

function notifyClients() {
  for (const res of clients) {
    res.write("event: update\ndata: {}\n\n");
  }
}

async function rebuild() {
  const { records, fileCount, parsedLines, parseErrors, skippedLines, unreadableFiles } = await loadRecords();
  recordsCache = records;
  const summary = aggregate(records);
  summary.source = { fileCount, parsedLines, parseErrors, skippedLines, unreadableFiles };
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

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write("event: connected\ndata: {}\n\n");
  clients.add(res);
  req.on("close", () => {
    clients.delete(res);
  });
});

app.get("/api/sessions/:id/turns", (req, res) => {
  if (!recordsCache) return res.json([]);
  const { id } = req.params;
  const turns = recordsCache
    .filter((r) => r.sessionId === id)
    .map((r) => ({
      ts: r.ts,
      model: r.model,
      input: r.input,
      output: r.output,
      cacheCreate: r.cacheCreate,
      cacheRead: r.cacheRead,
      cost: costOf(r.model, r).total,
    }))
    .sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));
  res.json(turns);
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

export { app, notifyClients };

// テスト時はサーバーを起動しない
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`cc-cost-dashboard API on http://localhost:${PORT}`);
  });

  const { createWatcher } = await import("./watcher.js");
  createWatcher(null, async () => {
    await rebuild();
    notifyClients();
  });
}
