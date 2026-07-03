import { costOf, CACHE_WRITE_5M_MULTIPLIER, CACHE_WRITE_1H_MULTIPLIER, CACHE_READ_MULTIPLIER } from "./pricing.js";

const dayOf = (ts) => (ts ? ts.slice(0, 10) : "(unknown)");

const BLOCK_DURATION_MS = 5 * 60 * 60 * 1000; // 5時間
const BURN_WINDOW_MS = 15 * 60 * 1000; // スライディングウィンドウ: 15分
const BURN_WINDOW_MIN = 15;

export const CACHE_5M_TTL_MS = 300_000; // 既定キャッシュTTL（5分）。これを超える中断でキャッシュが失効する。

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
 * 直近24時間を時間ごとに集計する。
 * @param {object[]} records - 正規化レコード配列
 * @returns {object[]} 24時間分のデータ（hour, tokens, cost, models）
 */
function computeHourly(records) {
  const withTs = records.filter((r) => r.ts);

  const now = new Date();
  // 現在時間の開始（分・秒をゼロに）でアンカーを作る
  const nowHourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);

  // 24バケット: index 0 = 23時間前、index 23 = 現在時間（時刻順）
  const hourly = Array.from({ length: 24 }, (_, i) => {
    const bucketTime = new Date(nowHourStart.getTime() - (23 - i) * 60 * 60 * 1000);
    return {
      hour: bucketTime.getHours(),
      tokens: 0,
      cost: 0,
      models: {},
    };
  });

  if (!withTs.length) {
    return hourly.map((h) => ({ ...h, models: [] }));
  }

  // 23時間前の時間の始まりをカットオフにする
  const cutoffMs = nowHourStart.getTime() - 23 * 60 * 60 * 1000;

  for (const r of withTs) {
    const recordDate = new Date(r.ts);
    const diffMs = recordDate.getTime() - cutoffMs;
    if (diffMs < 0) continue;

    const bucketIndex = Math.min(Math.floor(diffMs / (60 * 60 * 1000)), 23);
    const cost = costOf(r.model, r);
    const tokens = r.input + r.output + r.cacheCreate + r.cacheRead;

    hourly[bucketIndex].tokens += tokens;
    hourly[bucketIndex].cost += cost.total;

    if (!hourly[bucketIndex].models[r.model]) {
      hourly[bucketIndex].models[r.model] = { cost: 0, tokens: 0 };
    }
    hourly[bucketIndex].models[r.model].cost += cost.total;
    hourly[bucketIndex].models[r.model].tokens += tokens;
  }

  return hourly.map((h) => ({
    ...h,
    models: Object.entries(h.models).map(([model, v]) => ({ model, cost: v.cost, tokens: v.tokens })),
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
 * レコード配列からセッション別サマリを生成する（コスト降順）。
 * avgContextPerMsg = Σ(cacheRead + input) / messages を 1 ターンの実コンテキストサイズの proxy とする。
 * @param {object[]} records - 正規化レコード配列
 * @param {object[]} [compactions] - 圧縮マーカー配列（{ sessionId }）。usage行とは別経路で集計する。
 * @param {{ limit?: number }} [options] - limit 指定時は上位N件（コスト降順）にスライスする。省略時は全件返す。
 * @returns {object[]} セッション別サマリ（コスト降順）
 */
function computeSessions(records, compactions = [], { limit } = {}) {
  const compactionCounts = new Map(); // sessionId -> 圧縮回数
  for (const c of compactions) {
    compactionCounts.set(c.sessionId, (compactionCounts.get(c.sessionId) || 0) + 1);
  }

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

  const sorted = [...map.values()]
    .map((s) => {
      const topEntry = Object.entries(s.models).sort((a, z) => z[1] - a[1])[0];
      const { models, ...rest } = s;
      return {
        ...rest,
        avgContextPerMsg: s.messages > 0 ? (s.cacheRead + s.input) / s.messages : 0,
        topModel: topEntry ? { model: topEntry[0], cost: topEntry[1] } : null,
        compactionCount: compactionCounts.get(s.sessionId) || 0,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  return limit === undefined ? sorted : sorted.slice(0, limit);
}

/**
 * セッション内アイドルギャップによる5分キャッシュ失効（無駄な再書き込み）を検出・定量化する。
 * 同一セッション内で連続レコード間のギャップが CACHE_5M_TTL_MS を超えると、
 * 次のメッセージでプロンプトキャッシュが失効し、cache read で済むはずの文脈が
 * cache creation として再課金される。
 * @param {object[]} records - 正規化レコード配列
 * @returns {{ expiredGapCount: number, reWriteTokens: number, reWriteCost: number, affectedSessions: string[] }}
 */
export function computeCacheGapStats(records) {
  const bySession = new Map(); // sessionId -> レコード配列

  for (const r of records) {
    if (r.sessionId === "(unknown)" || !r.ts) continue;
    if (!bySession.has(r.sessionId)) bySession.set(r.sessionId, []);
    bySession.get(r.sessionId).push(r);
  }

  let expiredGapCount = 0;
  let reWriteTokens = 0;
  let reWriteCost = 0;
  const affectedSessions = new Set();

  for (const [sessionId, recs] of bySession) {
    const sorted = [...recs].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const gapMs = new Date(cur.ts) - new Date(prev.ts);
      if (gapMs <= CACHE_5M_TTL_MS) continue;

      expiredGapCount++;
      affectedSessions.add(sessionId);

      if (cur.cacheCreate > 0 && cur.cacheCreate >= cur.cacheRead) {
        reWriteTokens += cur.cacheCreate;
        reWriteCost += costOf(cur.model, cur).cacheWrite;
      }
    }
  }

  return {
    expiredGapCount,
    reWriteTokens,
    reWriteCost,
    affectedSessions: [...affectedSessions],
  };
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

const DEFAULT_SESSION_LIMIT = 30;

/**
 * レコード配列を指定期間で絞り込む。
 * @param {object[]} records - 正規化レコード配列
 * @param {{days: number} | {from: string, to: string} | 'all' | undefined} [period] - 期間指定。
 *   `{ days }` は今日を含む直近N日、`{ from, to }` は YYYY-MM-DD の日付範囲（両端含む）、
 *   `'all'` または未指定は全件を返す。
 * @returns {object[]} 絞り込み後のレコード配列
 */
export function filterRecordsByPeriod(records, period) {
  if (period === undefined || period === "all") return records;

  if ("days" in period) {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (period.days - 1));
    const cutoffMs = cutoff.getTime();
    return records.filter((r) => r.ts && new Date(r.ts).getTime() >= cutoffMs);
  }

  const { from, to } = period;
  return records.filter((r) => {
    if (!r.ts) return false;
    const day = dayOf(r.ts);
    return day >= from && day <= to;
  });
}

/**
 * 正規化レコード配列からダッシュボード用サマリを生成する。
 * @param {object[]} records - 正規化レコード配列
 * @param {{ sessionLimit?: number, compactions?: object[] }} [options] - sessionLimit 省略時は bySession を 30 件に制限する。
 *   compactions 省略時はセッションの compactionCount が全て 0 になる。
 * @returns {object} ダッシュボード表示用の集計サマリ
 */
export function aggregate(records, { sessionLimit = DEFAULT_SESSION_LIMIT, compactions = [] } = {}) {
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
  let mainTokens = 0, mainCost = 0, subagentTokens = 0, subagentCost = 0;

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
    if (!byDay.has(day)) {
      byDay.set(day, {
        costMap: new Map(), tokenMap: new Map(), projectTokenMap: new Map(), projectCostMap: new Map(),
        inputTokens: 0, cacheReadTokens: 0,
        mainTokens: 0, mainCost: 0, subagentTokens: 0, subagentCost: 0,
      });
    }
    const dd = byDay.get(day);
    dd.costMap.set(r.model, (dd.costMap.get(r.model) || 0) + c.total);
    dd.tokenMap.set(r.model, (dd.tokenMap.get(r.model) || 0) + tokens);
    dd.projectTokenMap.set(r.cwd, (dd.projectTokenMap.get(r.cwd) || 0) + tokens);
    dd.projectCostMap.set(r.cwd, (dd.projectCostMap.get(r.cwd) || 0) + c.total);
    dd.inputTokens += r.input;
    dd.cacheReadTokens += r.cacheRead;

    if (r.isSidechain) {
      dd.subagentTokens += tokens;
      dd.subagentCost += c.total;
      subagentTokens += tokens;
      subagentCost += c.total;
    } else {
      dd.mainTokens += tokens;
      dd.mainCost += c.total;
      mainTokens += tokens;
      mainCost += c.total;
    }

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
  // cacheReadRatio は日別のキャッシュ活用率 = cacheRead / (input + cacheRead)。
  // 全体集計の drivers.cacheReadRatio（分母 = totalTokens）とは計算式が異なるため混同しないこと。
  const daily = [...byDay.entries()]
    .map(([date, {
      costMap, tokenMap, projectTokenMap, projectCostMap, inputTokens, cacheReadTokens,
      mainTokens: dayMainTokens, mainCost: dayMainCost, subagentTokens: daySubagentTokens, subagentCost: daySubagentCost,
    }]) => {
      const models = Object.fromEntries(costMap);
      const total = [...costMap.values()].reduce((s, v) => s + v, 0);
      const tokenModels = Object.fromEntries(tokenMap);
      const tokenTotal = [...tokenMap.values()].reduce((s, v) => s + v, 0);
      const projectTokens = Object.fromEntries(projectTokenMap);
      const projectCosts = Object.fromEntries(projectCostMap);
      const cacheReadRatio = (inputTokens + cacheReadTokens) > 0
        ? cacheReadTokens / (inputTokens + cacheReadTokens)
        : 0;
      return {
        date, models, total, tokenModels, tokenTotal, projectTokens, projectCosts,
        inputTokens, cacheReadTokens, cacheReadRatio,
        mainTokens: dayMainTokens, mainCost: dayMainCost, subagentTokens: daySubagentTokens, subagentCost: daySubagentCost,
      };
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
  // 全体集計用のキャッシュ読込比率。分母 = totalTokens（input+output+cacheCreate+cacheRead）。
  // 日別の daily[].cacheReadRatio（分母 = input + cacheRead）とは計算式が異なるので混同しないこと。
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
    subagentStats: {
      mainTokens, mainCost, subagentTokens, subagentCost,
      subagentRatio: (mainTokens + subagentTokens) > 0 ? subagentTokens / (mainTokens + subagentTokens) : 0,
    },
    blocks: computeBlocks(records),
    projection: computeProjection(records),
    activity: computeActivity(records),
    bySession: computeSessions(records, compactions, { limit: sessionLimit }),
    hourly: computeHourly(records),
    cacheGapStats: computeCacheGapStats(records),
  };
}
