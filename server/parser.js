import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

/**
 * .claude/projects 配下の全 .jsonl ファイルを再帰列挙する。
 * @param {string} dir - 検索起点ディレクトリ
 * @returns {string[]} .jsonl ファイルの絶対パス一覧
 */
function findJsonlFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findJsonlFiles(full));
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

/**
 * usage を持つ assistant 行を正規化レコードに変換する。
 * synthetic モデルや usage 欠損行は null を返す。
 * @param {object} obj - JSONL の 1 行をパースしたオブジェクト
 * @returns {object|null} 正規化レコード、または対象外の場合 null
 */
function toRecord(obj) {
  if (!obj || obj.type !== "assistant") return null;
  const msg = obj.message || obj;
  const usage = msg.usage;
  const model = msg.model || obj.model;
  if (!usage || !model) return null;
  if (model.startsWith("<") && model.endsWith(">")) return null; // <synthetic> 等の内部モデルは除外

  const cacheCreate = usage.cache_creation_input_tokens || 0;
  const cc = usage.cache_creation || {};
  // 1h キャッシュ作成トークン（TTL 損益分岐分析に使用）。存在すれば 1h 単価扱い。
  const cacheCreate1h = cc.ephemeral_1h_input_tokens || 0;
  const cache1h = cacheCreate1h > 0;

  const { thinkingTokensApprox, hasThinking, thinkingBlockCount } = extractThinkingStats(msg.content);

  return {
    ts: obj.timestamp || null,
    model,
    cwd: obj.cwd || "(unknown)",
    sessionId: obj.sessionId || "(unknown)",
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheCreate,
    cacheCreate1h,
    cacheRead: usage.cache_read_input_tokens || 0,
    cache1h,
    isSidechain: obj.isSidechain === true,
    thinkingTokensApprox,
    hasThinking,
    thinkingBlockCount,
  };
}

/**
 * message.content[] から type === "thinking" / "redacted_thinking" のブロックを検出し、
 * テキスト長（合算）から近似トークン数を算出する。usage に thinking 専用フィールドが
 * 無いため、Math.ceil(合計文字数 / 4) の近似値とする（精度改善はスコープ外）。
 * redacted_thinking は平文を含まないため thinkingTokensApprox には寄与しないが、
 * 存在自体は hasThinking / thinkingBlockCount に反映する。
 * @param {unknown} content - message.content（配列でない場合は thinking なし扱い）
 * @returns {{ thinkingTokensApprox: number, hasThinking: boolean, thinkingBlockCount: number }}
 */
function extractThinkingStats(content) {
  if (!Array.isArray(content)) {
    return { thinkingTokensApprox: 0, hasThinking: false, thinkingBlockCount: 0 };
  }

  let totalChars = 0;
  let thinkingBlockCount = 0;
  for (const block of content) {
    if (!block || (block.type !== "thinking" && block.type !== "redacted_thinking")) continue;
    thinkingBlockCount++;
    totalChars += typeof block.thinking === "string" ? block.thinking.length : 0;
  }

  return {
    thinkingTokensApprox: thinkingBlockCount > 0 ? Math.ceil(totalChars / 4) : 0,
    hasThinking: thinkingBlockCount > 0,
    thinkingBlockCount,
  };
}

/**
 * assistant 行の message.content[] から Agent/Skill の tool_use を検出し、
 * 正規化レコードの配列として返す。対象がなければ空配列。
 * @param {object} obj - JSONL の 1 行をパースしたオブジェクト
 * @returns {object[]} tool_use 正規化レコードの配列（0件の場合は []）
 */
function toToolUseRecords(obj) {
  if (!obj || obj.type !== "assistant") return [];
  const msg = obj.message || obj;
  const content = msg.content;
  if (!Array.isArray(content)) return [];

  const results = [];
  for (const block of content) {
    if (!block || block.type !== "tool_use") continue;
    const isMcp = typeof block.name === "string" && block.name.startsWith("mcp__");
    if (block.name !== "Agent" && block.name !== "Skill" && !isMcp) continue;

    const input = block.input || {};
    const base = {
      toolName: block.name,
      ts: obj.timestamp || null,
      sessionId: obj.sessionId || "(unknown)",
      cwd: obj.cwd || "(unknown)",
    };

    if (block.name === "Agent") {
      results.push({
        ...base,
        subagentType: input.subagent_type || null,
        description: input.description || null,
        skill: null,
      });
    } else if (block.name === "Skill") {
      results.push({
        ...base,
        subagentType: null,
        description: null,
        skill: input.skill || null,
      });
    } else {
      // mcp__<serverName>__<mcpTool>。サーバー名自体に "__" を含まない前提で、
      // 最後の "__" で分割する（UUID・ハイフンを含むサーバー名にも対応）。
      const rest = block.name.slice("mcp__".length);
      const splitIndex = rest.lastIndexOf("__");
      const serverName = splitIndex === -1 ? "(unknown)" : rest.slice(0, splitIndex);
      const mcpTool = splitIndex === -1 ? rest : rest.slice(splitIndex + 2);
      results.push({
        ...base,
        subagentType: null,
        description: null,
        skill: null,
        serverName,
        mcpTool,
      });
    }
  }
  return results;
}

/**
 * tool_result の content（文字列または [{type:"text", text:"..."}] 等の配列）から
 * 文字数を抽出する。null/undefined/非対応形式（数値・単体オブジェクト等）は 0 文字扱い。
 * @param {unknown} content - tool_result ブロックの content
 * @returns {number} 抽出した文字数（複数 text ブロックがあれば合算）
 */
export function extractToolResultChars(content) {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;

  let totalChars = 0;
  for (const block of content) {
    if (!block || block.type !== "text") continue;
    totalChars += typeof block.text === "string" ? block.text.length : 0;
  }
  return totalChars;
}

/**
 * assistant 行の message.content[] から tool_use ブロックの id -> name 対応を抽出する。
 * toToolUseRecords と異なり Agent/Skill/mcp__ に限定せず全ツール種別を対象とする
 * （tool_result 突き合わせ専用）。
 * @param {object} obj - JSONL の 1 行をパースしたオブジェクト
 * @returns {Map<string, string>} tool_use_id -> toolName の対応
 */
export function extractToolUseIdMap(obj) {
  const map = new Map();
  if (!obj || obj.type !== "assistant") return map;
  const msg = obj.message || obj;
  const content = msg.content;
  if (!Array.isArray(content)) return map;

  for (const block of content) {
    if (!block || block.type !== "tool_use") continue;
    if (typeof block.id !== "string" || typeof block.name !== "string") continue;
    map.set(block.id, block.name);
  }
  return map;
}

/**
 * user 行の message.content[] から tool_result ブロックを検出し、近似トークン数を
 * 算出した正規化レコードの配列として返す。tool_use_id が toolUseIdMap に無い場合は
 * toolName: "unknown" として記録する。
 * @param {object} obj - JSONL の 1 行をパースしたオブジェクト
 * @param {Map<string, string>} toolUseIdMap - tool_use_id -> toolName の対応（先行する assistant 行から構築）
 * @returns {object[]} tool_result 正規化レコードの配列（0件の場合は []）
 */
export function toToolResultRecords(obj, toolUseIdMap) {
  if (!obj || obj.type !== "user") return [];
  const msg = obj.message || obj;
  const content = msg.content;
  if (!Array.isArray(content)) return [];

  const results = [];
  for (const block of content) {
    if (!block || block.type !== "tool_result") continue;
    const toolUseId = block.tool_use_id || null;
    const toolName = (toolUseId && toolUseIdMap.get(toolUseId)) || "unknown";
    const chars = extractToolResultChars(block.content);
    results.push({
      ts: obj.timestamp || null,
      sessionId: obj.sessionId || "(unknown)",
      cwd: obj.cwd || "(unknown)",
      toolUseId,
      toolName,
      tokensApprox: Math.ceil(chars / 4),
    });
  }
  return results;
}

/**
 * コンテキスト圧縮（compaction）イベントの行をマーカーに変換する。
 * `isCompactSummary: true` または `type: "summary"` かつ sessionId を持つ行が対象。
 * ts は将来の期間別フィルタ対応向けに保持する（現状の集計では未使用）。
 * @param {object} obj - JSONL の 1 行をパースしたオブジェクト
 * @returns {{ sessionId: string, ts: string|null }|null} 圧縮マーカー、または対象外の場合 null
 */
function toCompactionMarker(obj) {
  if (!obj) return null;
  const isCompaction = obj.isCompactSummary === true || obj.type === "summary";
  if (!isCompaction || !obj.sessionId) return null;
  return { sessionId: obj.sessionId, ts: obj.timestamp || null };
}

/**
 * 1ファイル分を指定バイトオフセットから読み込み、正規化レコードとメタデータを返す。
 * 行の末尾に改行がない（書き込み途中の可能性がある）部分行は消費せず、offset を進めない。
 * @param {string} file - 読み込み対象ファイルの絶対パス
 * @param {number} startOffset - 読み込み開始バイトオフセット
 * @param {Map<string, string>} toolUseIdMap - tool_use_id -> toolName の対応。呼び出し中に破壊的に更新される
 * @returns {Promise<{ records: object[], compactions: object[], toolUseRecords: object[], toolResultRecords: object[], parsedLines: number, parseErrors: number, newOffset: number, readFailed: boolean }>}
 */
async function readFileFromOffset(file, startOffset, toolUseIdMap) {
  const records = [];
  const compactions = [];
  const toolUseRecords = [];
  const toolResultRecords = [];
  let parsedLines = 0;
  let parseErrors = 0;
  let bytesConsumed = startOffset;
  let readFailed = false;

  const stream = fs.createReadStream(file, { start: startOffset, encoding: "utf8" });
  let buffer = "";

  const handleError = () => {
    readFailed = true;
    stream.destroy();
  };
  stream.on("error", handleError);

  try {
    for await (const chunk of stream) {
      buffer += chunk;
      let newlineIndex;
      // eslint-disable-next-line no-cond-assign
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        const lineByteLength = Buffer.byteLength(line, "utf8") + 1; // +1 for "\n"
        buffer = buffer.slice(newlineIndex + 1);
        bytesConsumed += lineByteLength;

        if (!line) continue;
        let obj;
        try {
          obj = JSON.parse(line);
          parsedLines++;
        } catch {
          parseErrors++;
          continue; // 壊れた行はスキップ
        }
        const rec = toRecord(obj);
        if (rec) records.push(rec);
        const compaction = toCompactionMarker(obj);
        if (compaction) compactions.push(compaction);
        toolUseRecords.push(...toToolUseRecords(obj));

        // tool_use_id -> toolName の対応は tool_result より時系列で先に出現するため、
        // 呼び出し元から渡された toolUseIdMap を更新しながら、同じマップで突き合わせる。
        for (const [id, name] of extractToolUseIdMap(obj)) {
          toolUseIdMap.set(id, name);
        }
        toolResultRecords.push(...toToolResultRecords(obj, toolUseIdMap));
      }
    }
  } catch {
    readFailed = true;
  }
  // buffer に残った内容（改行なしの末尾未完了行）は消費しない＝ offset を進めない

  return { records, compactions, toolUseRecords, toolResultRecords, parsedLines, parseErrors, newOffset: bytesConsumed, readFailed };
}

/**
 * ~/.claude/projects 配下の JSONL を読み込み、正規化レコード配列と解析品質メタデータを返す。
 * offsetState を渡すと、前回読み込み済みのバイトオフセット以降のみを差分読み込みする。
 * offsetState は呼び出し元で保持し、このループを跨いで再利用することで差分（tail）読み込みを実現する。
 * 壊れた行や対象外行はスキップし、その数をカウントする。
 * @param {Map<string, {offset: number, mtimeMs: number, dev: number, ino: number}>} [offsetState] - ファイルパス毎の読み込み済みオフセット。呼び出し中に破壊的に更新される
 * @param {Map<string, string>} [toolUseIdMap] - tool_use_id -> toolName の対応。呼び出し元がループを跨いで保持し、呼び出し中に破壊的に更新される
 * @returns {Promise<{ records: object[], compactions: object[], toolUseRecords: object[], toolResultRecords: object[], fileCount: number, parsedLines: number, parseErrors: number, skippedLines: number, unreadableFiles: number, truncationDetected: boolean }>}
 */
export async function loadRecords(offsetState = new Map(), toolUseIdMap = new Map()) {
  const projectsDir = process.env.CLAUDE_LOGS_DIR || DEFAULT_PROJECTS_DIR;
  const files = findJsonlFiles(projectsDir);
  const records = [];
  const compactions = [];
  const toolUseRecords = [];
  const toolResultRecords = [];
  let parsedLines = 0;
  let parseErrors = 0;
  let unreadableFiles = 0;
  let truncationDetected = false;

  // 事前に全ファイルの stat を取得する。切り詰め・mtime 後退を検知した場合、
  // offsetState 全体をクリアし、今回のループは「全ファイルを起点0から読み直す」形にする。
  // これにより、真偽だけでなく records/compactions/toolUseRecords も
  // 「切り詰め時は全ファイル全件」という一貫した戻り値になる。
  const stats = new Map();
  for (const file of files) {
    try {
      stats.set(file, fs.statSync(file));
    } catch {
      // 読み取り失敗はこの後のループで unreadableFiles としてカウントする
    }
  }
  for (const [file, stat] of stats) {
    const cached = offsetState.get(file);
    if (
      cached &&
      (stat.size < cached.offset ||
        stat.mtimeMs < cached.mtimeMs ||
        stat.dev !== cached.dev ||
        stat.ino !== cached.ino)
    ) {
      // サイズ縮小・mtime後退に加え、dev/ino の変化（同一パスでの削除→再作成によるファイル差し替え）も検知する。
      // 差し替え後のファイルがたまたま前回より大きいサイズ・新しい mtime を持っていても、
      // 別ファイルである以上は先頭から読み直す必要がある。
      truncationDetected = true;
      break;
    }
  }
  if (truncationDetected) {
    offsetState.clear(); // 他ファイル分も含め、今回は全件0から読み直す
    toolUseIdMap.clear(); // 全件読み直しに伴い、tool_use_id対応も再構築する
  }

  for (const file of files) {
    const stat = stats.get(file);
    if (!stat) {
      unreadableFiles++;
      continue;
    }

    const cached = offsetState.get(file);
    const startOffset = cached ? cached.offset : 0;

    const result = await readFileFromOffset(file, startOffset, toolUseIdMap);
    if (result.readFailed) {
      unreadableFiles++;
      continue;
    }

    records.push(...result.records);
    compactions.push(...result.compactions);
    toolUseRecords.push(...result.toolUseRecords);
    toolResultRecords.push(...result.toolResultRecords);
    parsedLines += result.parsedLines;
    parseErrors += result.parseErrors;

    offsetState.set(file, { offset: result.newOffset, mtimeMs: stat.mtimeMs, dev: stat.dev, ino: stat.ino });
  }

  const skippedLines = parsedLines - records.length;

  return { records, compactions, toolUseRecords, toolResultRecords, fileCount: files.length, parsedLines, parseErrors, skippedLines, unreadableFiles, truncationDetected };
}
