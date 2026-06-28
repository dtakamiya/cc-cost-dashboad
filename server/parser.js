import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

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
 * ~/.claude/projects 配下の全 JSONL を読み込み、正規化レコード配列と解析品質メタデータを返す。
 * 壊れた行や対象外行はスキップし、その数をカウントする。
 * @returns {Promise<{ records: object[], fileCount: number, parsedLines: number, parseErrors: number, skippedLines: number, unreadableFiles: number }>}
 */
export async function loadRecords() {
  const projectsDir = process.env.CLAUDE_LOGS_DIR || DEFAULT_PROJECTS_DIR;
  const files = findJsonlFiles(projectsDir);
  const records = [];
  let parsedLines = 0;
  let parseErrors = 0;
  let unreadableFiles = 0;

  for (const file of files) {
    let stream;
    try {
      stream = fs.createReadStream(file, { encoding: "utf8" });
    } catch {
      unreadableFiles++;
      continue;
    }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
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

  const skippedLines = parsedLines - records.length;

  return { records, fileCount: files.length, parsedLines, parseErrors, skippedLines, unreadableFiles };
}
