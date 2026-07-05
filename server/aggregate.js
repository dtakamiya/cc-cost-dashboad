import { costOf, CACHE_WRITE_5M_MULTIPLIER, CACHE_WRITE_1H_MULTIPLIER, CACHE_READ_MULTIPLIER } from "./pricing.js";

const dayOf = (ts) => (ts ? ts.slice(0, 10) : "(unknown)");

const BLOCK_DURATION_MS = 5 * 60 * 60 * 1000; // 5時間
const BURN_WINDOW_MS = 15 * 60 * 1000; // スライディングウィンドウ: 15分
const BURN_WINDOW_MIN = 15;

export const CACHE_5M_TTL_MS = 300_000; // 既定キャッシュTTL（5分）。これを超える中断でキャッシュが失効する。
export const CACHE_1H_TTL_MS = 3_600_000; // 1hキャッシュTTL。直前レコードが1h TTLの場合はこちらを閾値にする。

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
 * tool_use レコード配列をツール名ごとに集計する（calls 降順）。
 * Agent は subagentType で、Skill は skill で分離集計。
 * @param {object[]} toolUseRecords - tool_use レコード配列
 * @returns {object[]} ツール別サマリ（calls 降順）
 */
export function computeToolUsage(toolUseRecords = []) {
  if (!toolUseRecords.length) return [];

  const map = new Map(); // key (e.g. "Agent:Explore") -> { toolName, key, name, calls, sessions: Set }

  for (const r of toolUseRecords) {
    let key, name;

    if (r.toolName === "Agent") {
      key = `Agent:${r.subagentType || "(unknown)"}`;
      name = r.subagentType || "(unknown)";
    } else if (r.toolName === "Skill") {
      key = `Skill:${r.skill || "(unknown)"}`;
      name = r.skill || "(unknown)";
    } else {
      continue;
    }

    let entry = map.get(key);
    if (!entry) {
      entry = { toolName: r.toolName, key, name, calls: 0, sessions: new Set() };
      map.set(key, entry);
    }
    entry.calls += 1;
    // computeSessions と同様、sessionId 欠落レコードは集約すると無意味なため sessions には含めない。
    if (r.sessionId !== "(unknown)") entry.sessions.add(r.sessionId);
  }

  return [...map.values()]
    .map((entry) => ({ ...entry, sessions: entry.sessions.size }))
    .sort((a, b) => b.calls - a.calls);
}

/**
 * mcp__ プレフィックスの tool_use レコード配列を MCP サーバー単位で集計する（calls 降順）。
 * lastUsed は ts を持つレコードの最大値（ISO文字列比較で十分。欠落時は既存の lastUsed を維持）。
 * ts を持つレコードが1件も無いサーバーは lastUsed: null になる。
 * @param {object[]} toolUseRecords - tool_use レコード配列（serverName を持つもののみ対象）
 * @returns {object[]} サーバー別サマリ（calls 降順）
 */
export function computeMcpUsage(toolUseRecords = []) {
  if (!toolUseRecords.length) return [];

  const map = new Map(); // serverName -> { serverName, calls, sessions: Set, lastUsed }

  for (const r of toolUseRecords) {
    if (!r.serverName) continue;

    let entry = map.get(r.serverName);
    if (!entry) {
      entry = { serverName: r.serverName, calls: 0, sessions: new Set(), lastUsed: null };
      map.set(r.serverName, entry);
    }
    entry.calls += 1;
    if (r.sessionId !== "(unknown)") entry.sessions.add(r.sessionId);
    if (r.ts && (!entry.lastUsed || r.ts > entry.lastUsed)) entry.lastUsed = r.ts;
  }

  return [...map.values()]
    .map((entry) => ({ ...entry, sessions: entry.sessions.size }))
    .sort((a, b) => b.calls - a.calls);
}

/**
 * 定義済み MCP サーバー一覧（analyzeOverhead の overhead.mcpServers）に、実際の利用実績
 * （computeMcpUsage の戻り値）を突合し、callCount・lastUsed を付与した新しい配列を返す。
 * ログにのみ存在するサーバー（定義に無いもの）は無視する（クラッシュしない・出力にも含めない）。
 * 元の mcpServers / byMcpServer 配列・要素は変更しない（イミュータブル）。
 * @param {object[]} mcpServers - analyzeOverhead().mcpServers（定義済みサーバー一覧）
 * @param {object[]} byMcpServer - computeMcpUsage() の戻り値（実際の利用実績）
 * @returns {object[]} callCount・lastUsed を付与した新しい配列
 */
export function enrichMcpServers(mcpServers = [], byMcpServer = []) {
  const usageByName = new Map(byMcpServer.map((u) => [u.serverName, u]));

  return mcpServers.map((m) => {
    const usage = usageByName.get(m.name);
    return {
      ...m,
      callCount: usage ? usage.calls : 0,
      lastUsed: usage ? usage.lastUsed : null,
    };
  });
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
 * tool_result レコード配列をツール種別（Read/Bash/Grep/unknown等）ごとに集計する
 * （tokensApprox 降順）。
 * @param {object[]} toolResultRecords - tool_result レコード配列（{ toolName, sessionId, tokensApprox }）
 * @returns {object[]} ツール別サマリ（tokensApprox 降順）
 */
export function computeToolResultUsage(toolResultRecords = []) {
  if (!toolResultRecords.length) return [];

  const map = new Map(); // toolName -> { toolName, tokensApprox, calls, sessions: Set }

  for (const r of toolResultRecords) {
    let entry = map.get(r.toolName);
    if (!entry) {
      entry = { toolName: r.toolName, tokensApprox: 0, calls: 0, sessions: new Set() };
      map.set(r.toolName, entry);
    }
    entry.tokensApprox += r.tokensApprox || 0;
    entry.calls += 1;
    if (r.sessionId !== "(unknown)") entry.sessions.add(r.sessionId);
  }

  return [...map.values()]
    .map((entry) => ({ ...entry, sessions: entry.sessions.size, isApprox: true }))
    .sort((a, b) => b.tokensApprox - a.tokensApprox);
}

// MCP系（mcp__*）tool_result の推奨上限（トークン近似）。MAX_MCP_OUTPUT_TOKENS 設定の目安値。
export const MCP_OUTPUT_CAP_TOKENS = 8000;
// Bash系（Bash含む非mcpツール全般）tool_result の推奨上限（トークン近似）。
// BASH_MAX_OUTPUT_LENGTH（文字数上限）の既定目安 20,000文字 ÷ 4 ≒ 5,000トークン。
export const BASH_OUTPUT_CAP_TOKENS = 5000;

const SAMPLE_SESSION_LIMIT = 5;

/**
 * 個別 tool_result レコードから上限超過分布を算出する。
 * mcp__ プレフィックスのツールは mcpCap、それ以外（Bash含む全て）は bashCap を閾値として適用する。
 * 超過判定は厳密に tokensApprox > cap（cap 丁度は非超過）。
 * @param {object[]} records - tool_result レコード配列（{ toolName, sessionId, tokensApprox }）
 * @param {{ mcpCap: number, bashCap: number }} caps - MCP系/Bash系それぞれの上限トークン数
 * @returns {{ overCount: number, maxTokensApprox: number, totalOverTokensApprox: number,
 *   byTool: Array<{ toolName: string, overCount: number, maxTokensApprox: number }>,
 *   sampleSessions: Array<{ sessionId: string, toolName: string, tokensApprox: number }>,
 *   isApprox: true }}
 */
export function computeToolResultOutliers(records, { mcpCap, bashCap }) {
  if (!records.length) {
    return { overCount: 0, maxTokensApprox: 0, totalOverTokensApprox: 0, byTool: [], sampleSessions: [], isApprox: true };
  }

  const byToolMap = new Map(); // toolName -> { toolName, overCount, maxTokensApprox }
  const sessionSamples = []; // { sessionId, toolName, tokensApprox }（sessionId !== "(unknown)" のみ）
  let overCount = 0;
  let maxTokensApprox = 0;
  let totalOverTokensApprox = 0;

  for (const r of records) {
    const tokensApprox = r.tokensApprox || 0;
    const cap = r.toolName.startsWith("mcp__") ? mcpCap : bashCap;
    if (tokensApprox <= cap) continue;

    overCount++;
    totalOverTokensApprox += tokensApprox;
    if (tokensApprox > maxTokensApprox) maxTokensApprox = tokensApprox;

    const entry = byToolMap.get(r.toolName) || { toolName: r.toolName, overCount: 0, maxTokensApprox: 0 };
    byToolMap.set(r.toolName, {
      toolName: r.toolName,
      overCount: entry.overCount + 1,
      maxTokensApprox: Math.max(entry.maxTokensApprox, tokensApprox),
    });

    if (r.sessionId !== "(unknown)") {
      sessionSamples.push({ sessionId: r.sessionId, toolName: r.toolName, tokensApprox });
    }
  }

  const byTool = [...byToolMap.values()].sort((a, b) => b.maxTokensApprox - a.maxTokensApprox);
  const sampleSessions = sessionSamples
    .sort((a, b) => b.tokensApprox - a.tokensApprox)
    .slice(0, SAMPLE_SESSION_LIMIT);

  return { overCount, maxTokensApprox, totalOverTokensApprox, byTool, sampleSessions, isApprox: true };
}

// duplicateReads.byFile の表示上限（重複トークン降順の上位のみ返す）。
const DUPLICATE_READ_FILE_LIMIT = 10;

/**
 * 同一セッション内で同じ filePath を複数回 Read した「重複読み込み」を集計する。
 * セッション×filePath ごとに2回目以降の Read を重複と数え、重複 Read の toolUseId を
 * tool_result レコードと突合して重複トークン（近似）を推定する。
 * 結果は可視化専用（isApprox: true）であり、totalCost/totalTokens には加算しないこと。
 * @param {object[]} toolUseRecords - tool_use レコード配列（toolName: "Read" のみ対象。filePath/toolUseId を持つ）
 * @param {object[]} toolResultRecords - tool_result レコード配列（{ toolUseId, tokensApprox }）
 * @returns {{ totalDuplicateReads: number, totalDuplicateTokensApprox: number,
 *   byFile: Array<{ filePath: string, readCount: number, duplicateCount: number, duplicateTokensApprox: number }>,
 *   isApprox: true }}
 */
export function computeDuplicateReads(toolUseRecords = [], toolResultRecords = []) {
  const tokensByToolUseId = new Map(); // toolUseId -> tokensApprox
  for (const r of toolResultRecords) {
    if (r.toolUseId) tokensByToolUseId.set(r.toolUseId, r.tokensApprox || 0);
  }

  const byFileMap = new Map(); // `${sessionId}\n${filePath}` -> { filePath, readCount, duplicateCount, duplicateTokensApprox }
  let totalDuplicateReads = 0;
  let totalDuplicateTokensApprox = 0;

  for (const r of toolUseRecords) {
    if (r.toolName !== "Read" || !r.filePath) continue;

    const key = `${r.sessionId}\n${r.filePath}`;
    let entry = byFileMap.get(key);
    if (!entry) {
      entry = { filePath: r.filePath, readCount: 0, duplicateCount: 0, duplicateTokensApprox: 0 };
      byFileMap.set(key, entry);
    }
    entry.readCount += 1;
    if (entry.readCount === 1) continue;

    const tokens = (r.toolUseId && tokensByToolUseId.get(r.toolUseId)) || 0;
    entry.duplicateCount += 1;
    entry.duplicateTokensApprox += tokens;
    totalDuplicateReads += 1;
    totalDuplicateTokensApprox += tokens;
  }

  // 同一 filePath が複数セッションで重複していた場合はファイル単位に合算して返す。
  const mergedByFile = new Map(); // filePath -> entry
  for (const entry of byFileMap.values()) {
    if (entry.duplicateCount === 0) continue;
    const merged = mergedByFile.get(entry.filePath);
    if (!merged) {
      mergedByFile.set(entry.filePath, { ...entry });
    } else {
      mergedByFile.set(entry.filePath, {
        filePath: entry.filePath,
        readCount: merged.readCount + entry.readCount,
        duplicateCount: merged.duplicateCount + entry.duplicateCount,
        duplicateTokensApprox: merged.duplicateTokensApprox + entry.duplicateTokensApprox,
      });
    }
  }

  const byFile = [...mergedByFile.values()]
    .sort((a, b) => b.duplicateTokensApprox - a.duplicateTokensApprox || b.duplicateCount - a.duplicateCount)
    .slice(0, DUPLICATE_READ_FILE_LIMIT);

  return { totalDuplicateReads, totalDuplicateTokensApprox, byFile, isApprox: true };
}

/**
 * セッション別サマリ配列に、tool_result 累積近似トークン数（toolResultTokensApprox）を
 * イミュータブルにマージする。sessionId が "(unknown)" の tool_result レコードは除外する。
 * @param {object[]} sessions - computeSessions() の戻り値（セッション別サマリ配列）
 * @param {object[]} toolResultRecords - tool_result レコード配列
 * @returns {object[]} toolResultTokensApprox を追加した新しいセッション別サマリ配列
 */
export function mergeToolResultTokensIntoSessions(sessions, toolResultRecords = []) {
  const bySession = new Map(); // sessionId -> 合算tokensApprox

  for (const r of toolResultRecords) {
    if (r.sessionId === "(unknown)") continue;
    bySession.set(r.sessionId, (bySession.get(r.sessionId) || 0) + (r.tokensApprox || 0));
  }

  return sessions.map((s) => ({
    ...s,
    toolResultTokensApprox: bySession.get(s.sessionId) || 0,
  }));
}

// tool_result 累積近似トークンがこの値超のセッションは、コスト順位に関わらず bySession に残す。
// src/api.ts の TOOL_RESULT_BLOAT_THRESHOLD と同値（フロントの isToolResultHeavySession 判定と揃える）。
export const TOOL_RESULT_BLOAT_THRESHOLD = 50_000;

/**
 * コスト降順の上位 limit 件に加え、tool_result 肥大セッション（低コストでも見えないコンテキスト肥大の
 * 主因になり得るセッション）を重複なく追加した配列を返す。コスト降順は維持する。
 * @param {object[]} sessions - toolResultTokensApprox マージ済みのセッション別サマリ配列（コスト降順）
 * @param {number} limit - コスト上位件数
 * @returns {object[]} 表示用セッション配列（コスト降順、tool_result肥大セッションを追加で含む）
 */
function selectSessionsForDisplay(sessions, limit) {
  if (limit === undefined) return sessions;

  const top = sessions.slice(0, limit);
  const topIds = new Set(top.map((s) => s.sessionId));
  const bloated = sessions.filter(
    (s) => !topIds.has(s.sessionId) && (s.toolResultTokensApprox || 0) > TOOL_RESULT_BLOAT_THRESHOLD
  );

  return [...top, ...bloated];
}

/**
 * セッション内アイドルギャップによるキャッシュ失効（無駄な再書き込み）を検出・定量化する。
 * 同一セッション内で連続レコード間のギャップが直前レコードのTTL（cache1hならCACHE_1H_TTL_MS、
 * それ以外はCACHE_5M_TTL_MS）を超えると、次のメッセージでプロンプトキャッシュが失効し、
 * cache read で済むはずの文脈が cache creation として再課金される。
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
      const ttlMs = prev.cache1h ? CACHE_1H_TTL_MS : CACHE_5M_TTL_MS;
      if (gapMs <= ttlMs) continue;

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
 * セッション内でのモデル切替直後に発生するキャッシュ再作成コストを検出する。
 * プロンプトキャッシュはモデル固有のため、切替直後にcache creationが発生すると
 * cache readで済むはずのトークンが再課金される。
 * @param {object[]} records - 正規化レコード配列
 * @returns {{ switchCount: number, reCreateTokens: number, reCreateCost: number, affectedSessions: string[] }}
 */
export function computeModelSwitchStats(records) {
  const bySession = new Map();

  for (const r of records) {
    if (r.sessionId === "(unknown)" || !r.ts || r.isSidechain) continue;
    if (!bySession.has(r.sessionId)) bySession.set(r.sessionId, []);
    bySession.get(r.sessionId).push(r);
  }

  let switchCount = 0;
  let reCreateTokens = 0;
  let reCreateCost = 0;
  const affectedSessions = new Set();

  for (const [sessionId, recs] of bySession) {
    const sorted = [...recs].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.model === prev.model) continue;

      switchCount++;

      if (cur.cacheCreate > 0 && cur.cacheCreate >= cur.cacheRead) {
        reCreateTokens += cur.cacheCreate;
        reCreateCost += costOf(cur.model, cur).cacheWrite;
        affectedSessions.add(sessionId);
      }
    }
  }

  return {
    switchCount,
    reCreateTokens,
    reCreateCost,
    affectedSessions: [...affectedSessions],
  };
}

/**
 * モデル切替・アイドルギャップのどちらにも該当しない「原因不明のキャッシュ再作成」を検出する。
 * computeModelSwitchStats / computeCacheGapStats と同一のペアを二重計上しないよう、
 * 分類の優先順位（1: モデル切替 → 2: アイドルギャップ → 3: 不明）で排他的に振り分ける。
 * @param {object[]} records - 正規化レコード配列
 * @returns {{ bustCount: number, reCreateTokens: number, reCreateCost: number, affectedSessions: string[] }}
 */
export function detectUnexplainedCacheBusts(records) {
  const bySession = new Map();

  for (const r of records) {
    if (r.sessionId === "(unknown)" || !r.ts || r.isSidechain) continue;
    if (!bySession.has(r.sessionId)) bySession.set(r.sessionId, []);
    bySession.get(r.sessionId).push(r);
  }

  let bustCount = 0;
  let reCreateTokens = 0;
  let reCreateCost = 0;
  const affectedSessions = new Set();

  for (const [sessionId, recs] of bySession) {
    const sorted = [...recs].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (!(cur.cacheCreate > 0 && cur.cacheCreate >= cur.cacheRead)) continue;

      // 1. モデル切替に帰属
      if (cur.model !== prev.model) continue;

      // 2. アイドルギャップに帰属
      const gapMs = new Date(cur.ts) - new Date(prev.ts);
      const ttlMs = prev.cache1h ? CACHE_1H_TTL_MS : CACHE_5M_TTL_MS;
      if (gapMs > ttlMs) continue;

      // 3. 原因不明
      bustCount++;
      reCreateTokens += cur.cacheCreate;
      reCreateCost += costOf(cur.model, cur).cacheWrite;
      affectedSessions.add(sessionId);
    }
  }

  return {
    bustCount,
    reCreateTokens,
    reCreateCost,
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
 * @param {{ sessionLimit?: number, compactions?: object[], toolUseRecords?: object[], toolResultRecords?: object[] }} [options] - sessionLimit 省略時は bySession を 30 件に制限する。
 *   compactions 省略時はセッションの compactionCount が全て 0 になる。
 *   toolUseRecords 省略時は byTool・byMcpServer が [] になる。
 *   toolResultRecords 省略時は toolResultBreakdown が [] になり、bySession[].toolResultTokensApprox は全て 0 になる。
 * @returns {object} ダッシュボード表示用の集計サマリ
 */
export function aggregate(records, { sessionLimit = DEFAULT_SESSION_LIMIT, compactions = [], toolUseRecords = [], toolResultRecords = [] } = {}) {
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
  // thinking近似トークンはoutputのサブセット（内訳）であり、totalCost/totalTokens/tokenSplit.output/
  // costSplit.outputには一切加算しない（二重計上禁止）。
  let thinkingTokensApprox = 0;

  for (const r of records) {
    const c = costOf(r.model, r);
    const tokens = r.input + r.output + r.cacheCreate + r.cacheRead;
    const recThinkingTokens = r.thinkingTokensApprox || 0;

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
      thinkingTokensApprox: 0,
    };
    m.cost += c.total;
    m.tokens += tokens;
    m.tokenSplit.input += r.input;
    m.tokenSplit.output += r.output;
    m.tokenSplit.cacheCreate += r.cacheCreate;
    m.tokenSplit.cacheRead += r.cacheRead;
    m.thinkingTokensApprox += recThinkingTokens;
    byModel.set(r.model, m);
    if (c.isFallback) fallbackModels.add(r.model);

    const day = dayOf(r.ts);
    if (!byDay.has(day)) {
      byDay.set(day, {
        costMap: new Map(), tokenMap: new Map(), projectTokenMap: new Map(), projectCostMap: new Map(),
        inputTokens: 0, cacheReadTokens: 0,
        mainTokens: 0, mainCost: 0, subagentTokens: 0, subagentCost: 0,
        thinkingTokensApprox: 0,
      });
    }
    const dd = byDay.get(day);
    dd.costMap.set(r.model, (dd.costMap.get(r.model) || 0) + c.total);
    dd.tokenMap.set(r.model, (dd.tokenMap.get(r.model) || 0) + tokens);
    dd.projectTokenMap.set(r.cwd, (dd.projectTokenMap.get(r.cwd) || 0) + tokens);
    dd.projectCostMap.set(r.cwd, (dd.projectCostMap.get(r.cwd) || 0) + c.total);
    dd.inputTokens += r.input;
    dd.cacheReadTokens += r.cacheRead;
    dd.thinkingTokensApprox += recThinkingTokens;

    thinkingTokensApprox += recThinkingTokens;

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
      thinkingTokensApprox: dayThinkingTokensApprox,
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
        thinkingTokensApprox: dayThinkingTokensApprox,
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
    // thinking（extended thinking）近似トークン内訳。あくまで tokenSplit.output に既に含まれる
    // 内訳の可視化であり、totalCost/totalTokens/tokenSplit/costSplit には加算していない（二重計上禁止）。
    thinking: {
      approxTokens: thinkingTokensApprox,
      outputShare: tokenSplit.output ? Math.min(1, thinkingTokensApprox / tokenSplit.output) : 0,
      isApprox: true,
      hasAnyThinking: thinkingTokensApprox > 0,
    },
    subagentStats: {
      mainTokens, mainCost, subagentTokens, subagentCost,
      subagentRatio: (mainTokens + subagentTokens) > 0 ? subagentTokens / (mainTokens + subagentTokens) : 0,
    },
    blocks: computeBlocks(records),
    projection: computeProjection(records),
    activity: computeActivity(records),
    // tool_result 累積近似トークン（toolResultTokensApprox）はtotalCost/totalTokens/tokenSplit/costSplit
    // には一切加算しない（二重計上禁止）。あくまでセッション別の「見えないコンテキスト肥大」内訳の可視化用。
    // sessionLimit によるコスト降順の絞り込みは、tool_result のマージ後に行う。さらに、コスト上位から
    // 漏れた低コスト・tool_result肥大セッションも selectSessionsForDisplay で追加救済する
    // （コストが低くても tool_result 蓄積がコンテキスト肥大の主因になり得るため）。
    bySession: selectSessionsForDisplay(
      mergeToolResultTokensIntoSessions(computeSessions(records, compactions), toolResultRecords),
      sessionLimit
    ),
    hourly: computeHourly(records),
    cacheGapStats: computeCacheGapStats(records),
    modelSwitch: computeModelSwitchStats(records),
    unexplainedCacheBust: detectUnexplainedCacheBusts(records),
    byTool: computeToolUsage(toolUseRecords),
    byMcpServer: computeMcpUsage(toolUseRecords),
    toolResultBreakdown: computeToolResultUsage(toolResultRecords),
  };
}
