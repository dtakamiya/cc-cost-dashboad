import { costOf, CACHE_WRITE_5M_MULTIPLIER, CACHE_WRITE_1H_MULTIPLIER, CACHE_READ_MULTIPLIER } from "./pricing.js";

const dayOf = (ts) => (ts ? ts.slice(0, 10) : "(unknown)");

const BLOCK_DURATION_MS = 5 * 60 * 60 * 1000; // 5時間
const BURN_WINDOW_MS = 15 * 60 * 1000; // スライディングウィンドウ: 15分
const BURN_WINDOW_MIN = 15;

/**
 * レコード配列から 5 時間課金ブロック配列を生成する（新しい順、最大 20 件）。
 * @param {object[]} records - 正規化レコード配列
 * @returns {object[]} 課金ブロック一覧
 */
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
      // 新ブロック開始（最初の利用時刻を起点に 5 時間）
      const startMs = t;
      block = { startMs, endMs: startMs + BLOCK_DURATION_MS, cost: 0, tokens: 0, models: {}, lastTs: t, recs: [] };
      blocks.push(block);
    }
    block.cost += c.total;
    block.tokens += tokens;
    block.models[r.model] = (block.models[r.model] || 0) + c.total;
    block.lastTs = t;
    block.recs.push({ ts: t, cost: c.total });
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
      const windowStart = Math.max(b.startMs, now - BURN_WINDOW_MS);
      const windowDurationMin = (Math.min(now, b.endMs) - windowStart) / 60000;
      const recentCost = b.recs
        .filter((rec) => rec.ts >= windowStart && rec.ts <= now)
        .reduce((s, rec) => s + rec.cost, 0);
      const recentBurnRatePerMin = isActive && windowDurationMin > 0
        ? recentCost / windowDurationMin
        : 0;
      return {
        start: new Date(b.startMs).toISOString(),
        end: new Date(b.endMs).toISOString(),
        isActive,
        cost: b.cost,
        tokens: b.tokens,
        durationMin,
        remainMin,
        burnRatePerMin: durationMin > 0 ? b.cost / durationMin : 0,
        recentBurnRatePerMin,
        topModel: topModel ? { model: topModel[0], cost: topModel[1] } : null,
      };
    });
}

/**
 * 直近24時間をを時間ごとに集計する。
 * @param {object[]} records - 正規化レコード配列
 * @returns {object[]} 24時間分のデータ（hour, tokens, cost, models）
 */
function computeHourly(records) {
  const withTs = records.filter((r) => r.ts);
  if (!withTs.length) {
    return Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      tokens: 0,
      cost: 0,
      models: [],
    }));
  }

  const now = new Date();
  const hourly = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    tokens: 0,
    cost: 0,
    models: {},
  }));

  const cutoffMs = now.getTime() - 24 * 60 * 60 * 1000;

  for (const r of withTs) {
    const recordDate = new Date(r.ts);
    const recordMs = recordDate.getTime();

    if (recordMs < cutoffMs) continue;

    const hour = recordDate.getHours();
    const c = costOf(r.model, r);
    const tokens = r.input + r.output + r.cacheCreate + r.cacheRead;

    hourly[hour].tokens += tokens;
    hourly[hour].cost += c.total;
    hourly[hour].models[r.model] = (hourly[hour].models[r.model] || 0) + c.total;
  }

  return hourly.map((h) => ({
    ...h,
    models: Object.entries(h.models).map(([model, cost]) => ({ model, cost })),
  }));
}

/**
 * レコード配列から当月の着地予測を計算する。データがなければ null を返す。
 * @param {object[]} records - 正規化レコード配列
 * @returns {object|null} 当月コスト予測オブジェクト
 */
function computeProjection(records) {
  const withTs = records.filter((r) => r.ts);
  if (!withTs.length) return null;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const monthStr = monthStart.toISOString().slice(0, 7);
  const monthRecords = withTs.filter((r) => {
    const ts = new Date(r.ts);
    return ts >= monthStart && ts < nextMonthStart;
  });

  const monthCost = monthRecords.reduce((s, r) => s + costOf(r.model, r).total, 0);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const localMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const localNextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysPassed = (now - localMonthStart) / 86400000;
  const daysRemain = (localNextMonthStart - now) / 86400000;
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

/**
 * レコード配列からセッション別サマリを生成する（コスト降順, 全件）。
 * avgContextPerMsg = Σ(cacheRead + input) / messages を 1 ターンの実コンテキストサイズの proxy とする。
 * 上位 N 件への制限はクライアント側（期間フィルタ後）で行う。
 * @param {object[]} records - 正規化レコード配列
 * @returns {object[]} セッション別サマリ（コスト降順）
 */
function computeSessions(records) {
  const map = new Map(); // sessionId -> 集計

  for (const r of records) {
    if (r.sessionId === "(unknown)") continue; // 集約すると無意味なため除外
    const c = costOf(r.model, r);
    const tokens = r.input + r.output + r.cacheCreate + r.cacheRead;

    let s = map.get(r.sessionId);
    if (!s) {
      s = {
        sessionId: r.sessionId,
        cwd: r.cwd,
        cost: 0,
        tokens: 0,
        messages: 0,
        input: 0,
        output: 0,
        cacheCreate: 0,
        cacheRead: 0,
        firstTs: r.ts || null, // undefined にならないよう null で初期化
        lastTs: r.ts || null,
        models: {}, // model -> cost（topModel 算出用）
      };
      map.set(r.sessionId, s);
    }

    s.cost += c.total;
    s.tokens += tokens;
    s.messages += 1;
    s.input += r.input;
    s.output += r.output;
    s.cacheCreate += r.cacheCreate;
    s.cacheRead += r.cacheRead;
    s.models[r.model] = (s.models[r.model] || 0) + c.total;
    if (r.ts) {
      if (!s.firstTs || r.ts < s.firstTs) s.firstTs = r.ts;
      if (!s.lastTs || r.ts > s.lastTs) {
        s.lastTs = r.ts;
        s.cwd = r.cwd; // lastTs が更新されるときだけ cwd を更新（resume で移動した場合の現在地）
      }
    }
  }

  return [...map.values()]
    .map((s) => {
      const topEntry = Object.entries(s.models).sort((a, z) => z[1] - a[1])[0];
      const { models, ...rest } = s;
      return {
        ...rest,
        avgContextPerMsg: s.messages > 0 ? (s.cacheRead + s.input) / s.messages : 0,
        topModel: topEntry ? { model: topEntry[0], cost: topEntry[1] } : null,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

/**
 * レコード配列から曜日(0=日)×時間帯(0-23) のトークン使用量行列とピークを生成する。
 * ローカル時刻基準（サーバー = ユーザーのマシン）。
 * @param {object[]} records - 正規化レコード配列
 * @returns {{ matrix: number[][], max: number, total: number, peak: object|null }}
 */
function computeActivity(records) {
  const matrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let total = 0;

  for (const r of records) {
    if (!r.ts) continue;
    const d = new Date(r.ts);
    const day = d.getDay();
    const hour = d.getHours();
    const tokens = r.input + r.output + r.cacheCreate + r.cacheRead;
    matrix[day][hour] += tokens;
    total += tokens;
  }

  let peak = null;
  let max = 0;
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      if (matrix[day][hour] > max) {
        max = matrix[day][hour];
        peak = { day, hour, tokens: matrix[day][hour] };
      }
    }
  }

  return { matrix, max, total, peak };
}

/**
 * 正規化レコード配列からダッシュボード用サマリを生成する。
 * @param {object[]} records - 正規化レコード配列
 * @returns {object} ダッシュボード表示用の集計サマリ
 */
export function aggregate(records) {
  let totalCost = 0;
  let totalTokens = 0;
  const tokenSplit = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  const costSplit = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

  // キャッシュ TTL 損益分岐（1h vs 5m, ROI）。すべて costOf 戻り値の合算で導く。
  const cacheStats = { create1hTokens: 0, create5mTokens: 0, write1hCost: 0, write5mCost: 0, premium1h: 0 };
  // 1h 書き込みのうち 5m 比で割高な割合（pricing.js の乗数から導出）。
  const PREMIUM_1H_FRACTION = 1 - CACHE_WRITE_5M_MULTIPLIER / CACHE_WRITE_1H_MULTIPLIER;

  const byModel = new Map(); // model -> {cost, tokens, isFallback}
  const byDay = new Map(); // date -> {costMap: Map(model->cost), tokenMap: Map(model->tokens)}
  const byProject = new Map(); // cwd -> {cost, tokens}
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

    // キャッシュ書き込みを TTL（1h/5m）で振り分け。
    const create1h = r.cacheCreate1h || 0;
    if (r.cache1h) {
      cacheStats.create1hTokens += create1h;
      cacheStats.create5mTokens += Math.max(0, r.cacheCreate - create1h);
      cacheStats.write1hCost += c.cacheWrite;
      cacheStats.premium1h += c.cacheWrite * PREMIUM_1H_FRACTION;
    } else {
      cacheStats.create5mTokens += r.cacheCreate;
      cacheStats.write5mCost += c.cacheWrite;
    }

    const m = byModel.get(r.model) || {
      cost: 0, tokens: 0, isFallback: c.isFallback,
      tokenSplit: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    };
    m.cost += c.total;
    m.tokens += tokens;
    m.tokenSplit.input += r.input;
    m.tokenSplit.output += r.output;
    m.tokenSplit.cacheCreate += r.cacheCreate;
    m.tokenSplit.cacheRead += r.cacheRead;
    byModel.set(r.model, m);
    if (c.isFallback) fallbackModels.add(r.model);

    const day = dayOf(r.ts);
    if (!byDay.has(day)) byDay.set(day, { costMap: new Map(), tokenMap: new Map(), projectTokenMap: new Map() });
    const dd = byDay.get(day);
    dd.costMap.set(r.model, (dd.costMap.get(r.model) || 0) + c.total);
    dd.tokenMap.set(r.model, (dd.tokenMap.get(r.model) || 0) + tokens);
    dd.projectTokenMap.set(r.cwd, (dd.projectTokenMap.get(r.cwd) || 0) + tokens);

    const prevProject = byProject.get(r.cwd) || { cost: 0, tokens: 0 };
    byProject.set(r.cwd, { cost: prevProject.cost + c.total, tokens: prevProject.tokens + tokens });
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

  // 日別（昇順）。各日 {date, models: {model: cost}, total, tokenModels: {model: tokens}, tokenTotal, projectTokens: {cwd: tokens}}
  const daily = [...byDay.entries()]
    .map(([date, { costMap, tokenMap, projectTokenMap }]) => {
      const models = Object.fromEntries(costMap);
      const total = [...costMap.values()].reduce((s, v) => s + v, 0);
      const tokenModels = Object.fromEntries(tokenMap);
      const tokenTotal = [...tokenMap.values()].reduce((s, v) => s + v, 0);
      const projectTokens = Object.fromEntries(projectTokenMap);
      return { date, models, total, tokenModels, tokenTotal, projectTokens };
    })
    .filter((d) => d.date !== "(unknown)")
    .sort((a, b) => a.date.localeCompare(b.date));

  // プロジェクト別（トークン降順, 上位10）
  const projects = [...byProject.entries()]
    .map(([cwd, { cost, tokens }]) => ({ cwd, cost, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
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

  // コストドライバ（トークン基準）
  const topModel = [...models].sort((a, b) => b.tokens - a.tokens)[0] || null;
  const topDay = [...daily].sort((a, b) => b.tokenTotal - a.tokenTotal)[0] || null;
  const topDayModel = topDay
    ? Object.entries(topDay.models).sort((a, b) => b[1] - a[1])[0]
    : null;
  const cacheReadRatio = totalTokens
    ? tokenSplit.cacheRead / totalTokens
    : 0;
  const outputCostRatio = totalCost ? costSplit.output / totalCost : 0;

  // キャッシュ ROI: 読み込み節約額 = read実支払 × (1/READ_MULTIPLIER - 1)（無キャッシュ比の差分）。
  // 純益 = 読み込み節約 − 書き込みコスト（負なら書き込みが回収できていない）。
  cacheStats.readSavings = costSplit.cacheRead * (1 / CACHE_READ_MULTIPLIER - 1);
  cacheStats.writeCost = costSplit.cacheWrite;
  cacheStats.roiNet = cacheStats.readSavings - cacheStats.writeCost;

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
      topDay: topDay ? { date: topDay.date, cost: topDay.total, tokens: topDay.tokenTotal } : null,
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
    cacheStats,
    blocks: computeBlocks(records),
    projection: computeProjection(records),
    activity: computeActivity(records),
    bySession: computeSessions(records),
    hourly: computeHourly(records),
  };
}
