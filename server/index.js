import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { loadRecords } from "./parser.js";
import { aggregate, filterRecordsByPeriod } from "./aggregate.js";
import { analyzeOverhead } from "./analyze.js";
import { PRICING, CACHE_WRITE_5M_MULTIPLIER, CACHE_WRITE_1H_MULTIPLIER, CACHE_READ_MULTIPLIER, costOf } from "./pricing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const PORT = process.env.PORT || 3001;

const app = express();

const RELOAD_COOLDOWN_MS = 30 * 1000;
let lastReloadTime = 0;

let cache = null; // 直近の集計結果をメモリ保持
let recordsCache = null; // ターン詳細取得用の生レコードキャッシュ（累積）
let compactionsCache = null; // コンテキスト圧縮マーカーの累積キャッシュ（recordsCache と同様に差分読み込みで蓄積）
let toolUseRecordsCache = null; // tool_use レコード配列（recordsCache と同様に差分読み込みで蓄積）
let offsetState = new Map(); // ファイルパス毎の読み込み済みバイトオフセット（差分読み込み用）

// summary.source の累積カウンタ（差分読み込みでも UI 上「壊れて見えない」よう、リロード毎の値ではなく総計を保持する）
const cumulativeSource = {
  fileCount: 0,
  parsedLines: 0,
  parseErrors: 0,
  skippedLines: 0,
  unreadableFiles: 0,
};

// SSE クライアント管理
const clients = new Set();

function notifyClients() {
  for (const res of clients) {
    res.write("event: update\ndata: {}\n\n");
  }
}

let rebuildInFlight = null; // 実行中の rebuild() を共有し、offsetState/recordsCache への同時書き込みを防ぐ

async function rebuild() {
  if (rebuildInFlight) return rebuildInFlight;

  rebuildInFlight = (async () => {
    const { records, compactions = [], toolUseRecords = [], fileCount, parsedLines, parseErrors, skippedLines, unreadableFiles } = await loadRecords(offsetState);
    if (recordsCache) {
      // concat は毎回 recordsCache 全件をコピーし直すため、差分読み込みの効果を打ち消してしまう。
      // recordsCache は外部に参照を渡さない内部専用の蓄積キャッシュなので、破壊的な追記で対応する。
      for (const r of records) recordsCache.push(r);
    } else {
      recordsCache = records;
    }
    if (compactionsCache) {
      for (const c of compactions) compactionsCache.push(c);
    } else {
      compactionsCache = compactions;
    }
    if (toolUseRecordsCache) {
      for (const t of toolUseRecords) toolUseRecordsCache.push(t);
    } else {
      toolUseRecordsCache = toolUseRecords;
    }

    cumulativeSource.fileCount = fileCount; // fileCount は累積ではなく現在の総ファイル数のスナップショット
    cumulativeSource.parsedLines += parsedLines;
    cumulativeSource.parseErrors += parseErrors;
    cumulativeSource.skippedLines += skippedLines;
    cumulativeSource.unreadableFiles += unreadableFiles;

    const summary = aggregate(recordsCache, { compactions: compactionsCache, toolUseRecords: toolUseRecordsCache });
    summary.source = { ...cumulativeSource };
    summary.overhead = analyzeOverhead();
    cache = summary;
    return summary;
  })();

  try {
    return await rebuildInFlight;
  } finally {
    rebuildInFlight = null;
  }
}

const FIXED_PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * クエリパラメータから期間指定を解析する。
 * @param {{ period?: string, from?: string, to?: string }} query - Express req.query
 * @returns {{ ok: true, period: object | 'all' | undefined } | { ok: false, error: string }}
 */
function parsePeriodQuery(query) {
  const { period, from, to } = query;

  if (from !== undefined || to !== undefined) {
    if (!from || !to) {
      return { ok: false, error: "from と to は両方指定してください" };
    }
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return { ok: false, error: "from/to は YYYY-MM-DD 形式で指定してください" };
    }
    if (from > to) {
      return { ok: false, error: "from は to 以前の日付を指定してください" };
    }
    return { ok: true, period: { from, to } };
  }

  if (period === undefined) return { ok: true, period: undefined };
  if (period === "all") return { ok: true, period: "all" };
  if (Object.prototype.hasOwnProperty.call(FIXED_PERIOD_DAYS, period)) {
    return { ok: true, period: { days: FIXED_PERIOD_DAYS[period] } };
  }
  return { ok: false, error: `不正な period 値です: ${period}` };
}

app.get("/api/summary", async (req, res) => {
  try {
    if (!cache) await rebuild();

    const parsed = parsePeriodQuery(req.query);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }

    // period 省略時は後方互換のため cache（全期間）をそのまま返す
    if (parsed.period === undefined) {
      return res.json(cache);
    }

    const filteredRecords = filterRecordsByPeriod(recordsCache, parsed.period);
    // compactions は period 絞り込み対象外（YAGNI: セッション別の圧縮回数は全期間の実態を示せば十分なため、
    // 現状は日付ベースの絞り込みロジックを別途作らずそのまま渡す）。
    const periodSummary = aggregate(filteredRecords, { compactions: compactionsCache });
    // blocks/projection/activity は全期間依存コンポーネント用のため、常に cache（全期間集計）の値を使う
    periodSummary.blocks = cache.blocks;
    periodSummary.projection = cache.projection;
    periodSummary.activity = cache.activity;
    periodSummary.source = cache.source;
    periodSummary.overhead = cache.overhead;
    res.json(periodSummary);
  } catch (e) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/hourly", async (_req, res) => {
  try {
    if (!cache) await rebuild();
    res.json({ hourly: cache.hourly });
  } catch (e) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/reload", async (_req, res) => {
  const now = Date.now();
  const elapsed = now - lastReloadTime;
  if (elapsed < RELOAD_COOLDOWN_MS) {
    const remainingSec = Math.ceil((RELOAD_COOLDOWN_MS - elapsed) / 1000);
    return res
      .status(429)
      .set("Retry-After", String(remainingSec))
      .json({ error: "Rate limit exceeded", retryAfterSec: remainingSec });
  }
  try {
    lastReloadTime = now;
    const summary = await rebuild();
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: "Internal server error" });
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

export { app, notifyClients, rebuild };

// テスト時はサーバーを起動しない
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`cc-cost-dashboard API on http://localhost:${PORT}`);
  });

  const { createWatcher } = await import("./watcher.js");
  createWatcher(null, async () => {
    await rebuild();
    notifyClients();
  });
}
