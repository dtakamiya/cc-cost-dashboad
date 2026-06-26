import { costOf } from "./pricing.js";

const dayOf = (ts) => (ts ? ts.slice(0, 10) : "(unknown)");

const BLOCK_DURATION_MS = 5 * 60 * 60 * 1000; // 5時間

// レコード配列 → 5時間課金ブロック配列（新しい順、最大20件）
function computeBlocks(records) {
  const withTs = records.filter((r) => r.ts).sort((a, b) => (a.ts < b.ts ? -1 : 1));
  if (!withTs.length) return [];

  const blocks = [];
  let block = null;

  for (const r of withTs) {
    const t = new Date(r.ts).getTime();
    const c = costOf(r.model, r);
    const tokens = r.input + r.output + r.cacheCreate + r.cacheRead;

    if (!block || t >= block.endMs) {
      // 新ブロック開始（時単位切り捨て）
      const startMs = Math.floor(t / (60 * 60 * 1000)) * (60 * 60 * 1000);
      block = { startMs, endMs: startMs + BLOCK_DURATION_MS, cost: 0, tokens: 0, models: {}, lastTs: t };
      blocks.push(block);
    }
    block.cost += c.total;
    block.tokens += tokens;
    block.models[r.model] = (block.models[r.model] || 0) + c.total;
    block.lastTs = t;
  }

  const now = Date.now();
  return blocks
    .slice(-20)
    .reverse()
    .map((b) => {
      const isActive = now < b.endMs && now - b.lastTs < BLOCK_DURATION_MS;
      const durationMin = Math.round((Math.min(now, b.endMs) - b.startMs) / 60000);
      const remainMin = isActive ? Math.round((b.endMs - now) / 60000) : 0;
      const topModel = Object.entries(b.models).sort((a, z) => z[1] - a[1])[0];
      return {
        start: new Date(b.startMs).toISOString(),
        end: new Date(b.endMs).toISOString(),
        isActive,
        cost: b.cost,
        tokens: b.tokens,
        durationMin,
        remainMin,
        burnRatePerMin: durationMin > 0 ? b.cost / durationMin : 0,
        topModel: topModel ? { model: topModel[0], cost: topModel[1] } : null,
      };
    });
}

// レコード配列 → 当月の着地予測
function computeProjection(records) {
  const withTs = records.filter((r) => r.ts);
  if (!withTs.length) return null;

  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthRecords = withTs.filter((r) => r.ts.startsWith(monthStr));

  const monthCost = monthRecords.reduce((s, r) => s + costOf(r.model, r).total, 0);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed = now.getDate() + now.getHours() / 24;
  const daysRemain = daysInMonth - daysPassed;
  const projectedMonthCost = daysPassed > 0 ? (monthCost / daysPassed) * daysInMonth : 0;

  return {
    monthStr,
    monthCostSoFar: monthCost,
    daysPassed: Math.floor(daysPassed),
    daysRemain: Math.round(daysRemain),
    daysInMonth,
    projectedMonthCost,
  };
}

// 正規化レコード配列 → ダッシュボード用サマリ。
export function aggregate(records) {
  let totalCost = 0;
  let totalTokens = 0;
  const tokenSplit = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  const costSplit = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

  const byModel = new Map(); // model -> {cost, tokens, isFallback}
  const byDay = new Map(); // date -> Map(model -> cost)
  const byProject = new Map(); // cwd -> cost
  const sessions = new Set();
  const sessionFirstMsg = new Map(); // sessionId -> 最初のレコード（cold start 計測用）
  let minTs = null;
  let maxTs = null;
  let fallbackModels = new Set();

  for (const r of records) {
    const c = costOf(r.model, r);
    const tokens = r.input + r.output + r.cacheCreate + r.cacheRead;

    totalCost += c.total;
    totalTokens += tokens;
    tokenSplit.input += r.input;
    tokenSplit.output += r.output;
    tokenSplit.cacheCreate += r.cacheCreate;
    tokenSplit.cacheRead += r.cacheRead;
    costSplit.input += c.input;
    costSplit.output += c.output;
    costSplit.cacheWrite += c.cacheWrite;
    costSplit.cacheRead += c.cacheRead;

    const m = byModel.get(r.model) || { cost: 0, tokens: 0, isFallback: c.isFallback };
    m.cost += c.total;
    m.tokens += tokens;
    byModel.set(r.model, m);
    if (c.isFallback) fallbackModels.add(r.model);

    const day = dayOf(r.ts);
    if (!byDay.has(day)) byDay.set(day, new Map());
    const dm = byDay.get(day);
    dm.set(r.model, (dm.get(r.model) || 0) + c.total);

    byProject.set(r.cwd, (byProject.get(r.cwd) || 0) + c.total);
    sessions.add(r.sessionId);

    // セッション初回メッセージ（最古 ts）を記録
    if (r.ts) {
      const prev = sessionFirstMsg.get(r.sessionId);
      if (!prev || r.ts < prev.ts) sessionFirstMsg.set(r.sessionId, r);
    }

    if (r.ts) {
      if (!minTs || r.ts < minTs) minTs = r.ts;
      if (!maxTs || r.ts > maxTs) maxTs = r.ts;
    }
  }

  // モデル別（コスト降順）
  const models = [...byModel.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.cost - a.cost);

  // 日別（昇順）。各日 {date, models: {model: cost}, total}
  const daily = [...byDay.entries()]
    .map(([date, mm]) => {
      const m = Object.fromEntries(mm);
      const total = [...mm.values()].reduce((s, v) => s + v, 0);
      return { date, models: m, total };
    })
    .filter((d) => d.date !== "(unknown)")
    .sort((a, b) => a.date.localeCompare(b.date));

  // プロジェクト別（コスト降順, 上位10）
  const projects = [...byProject.entries()]
    .map(([cwd, cost]) => ({ cwd, cost }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  // セッション cold start 統計（初回メッセージのキャッシュ作成量 = システムプロンプト規模の proxy）
  const firstMsgs = [...sessionFirstMsg.values()];
  const coldCreateArr = firstMsgs.map((r) => r.cacheCreate).sort((a, b) => a - b);
  const avgColdStart = coldCreateArr.length
    ? coldCreateArr.reduce((s, v) => s + v, 0) / coldCreateArr.length
    : 0;
  const p90ColdStart = coldCreateArr[Math.floor(coldCreateArr.length * 0.9)] || 0;
  let coldStartCost = 0;
  for (const r of firstMsgs) coldStartCost += costOf(r.model, r).cacheWrite;

  // コストドライバ（なぜ高いか）
  const topModel = models[0] || null;
  const topDay = [...daily].sort((a, b) => b.total - a.total)[0] || null;
  const topDayModel = topDay
    ? Object.entries(topDay.models).sort((a, b) => b[1] - a[1])[0]
    : null;
  const cacheReadRatio = totalTokens
    ? tokenSplit.cacheRead / totalTokens
    : 0;
  const outputCostRatio = totalCost ? costSplit.output / totalCost : 0;

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      cost: totalCost,
      tokens: totalTokens,
      sessions: sessions.size,
      messages: records.length,
      from: minTs ? dayOf(minTs) : null,
      to: maxTs ? dayOf(maxTs) : null,
    },
    tokenSplit,
    costSplit,
    models,
    daily,
    projects,
    drivers: {
      topModel,
      topDay: topDay ? { date: topDay.date, cost: topDay.total } : null,
      topDayModel: topDayModel
        ? { model: topDayModel[0], cost: topDayModel[1] }
        : null,
      cacheReadRatio,
      outputCostRatio,
    },
    sessionStats: {
      avgColdStartTokens: Math.round(avgColdStart),
      p90ColdStartTokens: Math.round(p90ColdStart),
      coldStartCost,
    },
    warnings: {
      fallbackModels: [...fallbackModels],
    },
    blocks: computeBlocks(records),
    projection: computeProjection(records),
  };
}
