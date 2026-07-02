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
  };
}

/**
 * 1ファイル分を指定バイトオフセットから読み込み、正規化レコードとメタデータを返す。
 * 行の末尾に改行がない（書き込み途中の可能性がある）部分行は消費せず、offset を進めない。
 * @param {string} file - 読み込み対象ファイルの絶対パス
 * @param {number} startOffset - 読み込み開始バイトオフセット
 * @returns {Promise<{ records: object[], parsedLines: number, parseErrors: number, newOffset: number, readFailed: boolean }>}
 */
async function readFileFromOffset(file, startOffset) {
  const records = [];
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
      }
    }
  } catch {
    readFailed = true;
  }
  // buffer に残った内容（改行なしの末尾未完了行）は消費しない＝ offset を進めない

  return { records, parsedLines, parseErrors, newOffset: bytesConsumed, readFailed };
}

/**
 * ~/.claude/projects 配下の JSONL を読み込み、正規化レコード配列と解析品質メタデータを返す。
 * offsetState を渡すと、前回読み込み済みのバイトオフセット以降のみを差分読み込みする。
 * offsetState は呼び出し元で保持し、このループを跨いで再利用することで差分（tail）読み込みを実現する。
 * 壊れた行や対象外行はスキップし、その数をカウントする。
 * @param {Map<string, {offset: number, mtimeMs: number}>} [offsetState] - ファイルパス毎の読み込み済みオフセット。呼び出し中に破壊的に更新される
 * @returns {Promise<{ records: object[], fileCount: number, parsedLines: number, parseErrors: number, skippedLines: number, unreadableFiles: number }>}
 */
export async function loadRecords(offsetState = new Map()) {
  const projectsDir = process.env.CLAUDE_LOGS_DIR || DEFAULT_PROJECTS_DIR;
  const files = findJsonlFiles(projectsDir);
  const records = [];
  let parsedLines = 0;
  let parseErrors = 0;
  let unreadableFiles = 0;

  for (const file of files) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      unreadableFiles++;
      continue;
    }

    const cached = offsetState.get(file);
    let startOffset = 0;
    if (cached && stat.size >= cached.offset && stat.mtimeMs >= cached.mtimeMs) {
      startOffset = cached.offset;
    }
    // それ以外（新規ファイル／切り詰め／mtime 後退）は offset 0 から再読み込みする

    const result = await readFileFromOffset(file, startOffset);
    if (result.readFailed) {
      unreadableFiles++;
      continue;
    }

    records.push(...result.records);
    parsedLines += result.parsedLines;
    parseErrors += result.parseErrors;

    offsetState.set(file, { offset: result.newOffset, mtimeMs: stat.mtimeMs });
  }

  const skippedLines = parsedLines - records.length;

  return { records, fileCount: files.length, parsedLines, parseErrors, skippedLines, unreadableFiles };
}
