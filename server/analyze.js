import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");

function readSafe(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}

function bytes(content) {
  return Buffer.byteLength(content, "utf8");
}

// 1トークン ≈ 4バイト（英語基準。日本語混在時はやや少なめ）
function toTokens(b) {
  return Math.round(b / 4);
}

// CLAUDE.md の @file 参照を解析。
function parseAtRefs(content, baseDir) {
  const refs = [];
  for (const m of content.matchAll(/^@(\S+)/gm)) {
    refs.push({ name: m[1], fullPath: path.join(baseDir, m[1]) });
  }
  return refs;
}

// YAML frontmatter から単一フィールドを抽出。
// インライン（key: value）と block scalar（key: > / |）の複数行に素朴対応。
function parseYamlField(fm, key) {
  const lines = fm.replace(/\r/g, "").split("\n");
  let capturing = false;
  const buf = [];
  for (const line of lines) {
    if (!capturing) {
      const m = line.match(new RegExp(`^${key}:[ \\t]*(.*)$`));
      if (m) {
        capturing = true;
        const v = m[1].trim();
        // block scalar 指示子（>, |）は本文ではないので除外
        if (v && v !== ">" && v !== "|") buf.push(v);
      }
    } else {
      // 次のトップレベルキー（行頭が非空白）に達したら終了
      if (/^\S/.test(line)) break;
      buf.push(line.trim());
    }
  }
  return buf.join(" ").trim();
}

// SKILL.md の frontmatter から name / description を抽出。
export function parseSkillFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return { name: "", description: "" };
  const fm = m[1];
  return {
    name: parseYamlField(fm, "name"),
    description: parseYamlField(fm, "description"),
  };
}

// スキル本文を計測。
// alwaysTokens = name + description（ベースのシステムプロンプトへ常時注入される近似）
// fullTokens   = 全文（そのスキルを起動した時にのみ読まれる）
export function measureSkillContent(content, label, filePath = null) {
  const b = bytes(content);
  const { name, description } = parseSkillFrontmatter(content);
  const alwaysBytes = bytes(`${name}: ${description}`);
  const alwaysTokens = toTokens(alwaysBytes);
  return {
    label,
    path: filePath,
    bytes: b,
    alwaysTokens,
    fullTokens: toTokens(b),
    estimatedTokens: alwaysTokens, // baseline と整合（後方互換フィールド）
  };
}

// 常時全文注入されるファイル（CLAUDE.md / @ref / プラグイン CLAUDE.md）。always === full。
function measureFile(filePath, label) {
  const content = readSafe(filePath);
  if (!content) return null;
  const b = bytes(content);
  const t = toTokens(b);
  return { label, path: filePath, bytes: b, alwaysTokens: t, fullTokens: t, estimatedTokens: t };
}

function measureSkill(filePath, label) {
  const content = readSafe(filePath);
  if (!content) return null;
  return measureSkillContent(content, label, filePath);
}

// ~/.claude/plugins/cache 内で有効プラグインの CLAUDE.md / SKILL.md を計測。
function measurePlugin(pluginKey) {
  const [pluginName, marketplace] = pluginKey.split("@").reverse();
  const mkt = marketplace || pluginName;
  const cacheDir = path.join(CLAUDE_DIR, "plugins", "cache", mkt, pluginName);
  let versionDir = null;
  try {
    const vs = fs.readdirSync(cacheDir).filter((v) => v !== ".DS_Store");
    if (vs.length > 0) versionDir = path.join(cacheDir, vs[0]);
  } catch { return null; }
  if (!versionDir) return null;

  const files = [];
  let totalBytes = 0;
  let totalAlwaysTokens = 0;
  let totalFullTokens = 0;

  const main = measureFile(path.join(versionDir, "CLAUDE.md"), "CLAUDE.md");
  if (main) {
    files.push(main);
    totalBytes += main.bytes;
    totalAlwaysTokens += main.alwaysTokens;
    totalFullTokens += main.fullTokens;
  }

  const skillsDir = path.join(versionDir, "skills");
  try {
    for (const s of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      const sm = measureSkill(path.join(skillsDir, s.name, "SKILL.md"), `skills/${s.name}`);
      if (sm) {
        files.push(sm);
        totalBytes += sm.bytes;
        totalAlwaysTokens += sm.alwaysTokens;
        totalFullTokens += sm.fullTokens;
      }
    }
  } catch {}

  return {
    name: pluginKey,
    files,
    totalBytes,
    totalAlwaysTokens,
    totalFullTokens,
    totalEstimatedTokens: totalAlwaysTokens, // 後方互換（baseline）
  };
}

// 個人スキル（~/.claude/skills/*/SKILL.md、プラグイン外）を計測。
function measurePersonalSkills() {
  const dir = path.join(CLAUDE_DIR, "skills");
  const out = [];
  try {
    for (const s of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      const m = measureSkill(path.join(dir, s.name, "SKILL.md"), s.name);
      if (m) out.push(m);
    }
  } catch {}
  return out;
}

// installed_plugins.json からプロジェクトスコープのプラグイン一覧取得。
function projectScopedPlugins() {
  const installedPath = path.join(CLAUDE_DIR, "plugins", "installed_plugins.json");
  const content = readSafe(installedPath);
  if (!content) return [];
  let data;
  try { data = JSON.parse(content); } catch { return []; }
  const plugins = data.plugins || {};
  const result = [];
  for (const [name, installs] of Object.entries(plugins)) {
    const scoped = installs.filter((i) => i.scope !== "global");
    if (scoped.length > 0) {
      result.push({
        name,
        projectPaths: scoped.map((i) => i.projectPath),
      });
    }
  }
  return result;
}

// MCP サーバのツール定義トークンの保守的な既定推定値。
// MCPツール定義は config（command/args のみ）から静的に取得できず実行時依存のため、
// 実測せず一律この定数で見積もる（過小評価より過大評価を許容する保守的な値）。
export const DEFAULT_MCP_SERVER_TOKENS = 1500;

// 静的に定義された MCP サーバ名を列挙し、各サーバのオーバーヘッドを保守的に推定する。
// ~/.claude.json のトップレベル mcpServers と ~/.claude/settings.json の mcpServers をマージ。
// ツール定義のトークンは実行時（サーバ起動後のtools/list応答）依存のため静的計測できない。
// そのため toolCount は常に null、estimatedTokens は DEFAULT_MCP_SERVER_TOKENS、
// source は "estimated" を返す（実測できたケースが増えたら "measured" を返す拡張余地を残す）。
// （アプリ管理のコネクタ由来 MCP はファイルに現れないため列挙対象外）
function listMcpServers() {
  const names = new Set();
  for (const p of [
    path.join(os.homedir(), ".claude.json"),
    path.join(CLAUDE_DIR, "settings.json"),
  ]) {
    const content = readSafe(p);
    if (!content) continue;
    try {
      const data = JSON.parse(content);
      for (const k of Object.keys(data.mcpServers || {})) names.add(k);
    } catch {}
  }
  return [...names].map((name) => ({
    name,
    toolCount: null,
    estimatedTokens: DEFAULT_MCP_SERVER_TOKENS,
    source: "estimated",
  }));
}

export function analyzeOverhead() {
  const result = {
    claudeMd: null,
    atRefs: [],
    globalPlugins: [],
    personalSkills: [],
    projectPlugins: [],
    mcpServers: [],
    totalAlwaysTokens: 0,
    totalInvokeTokens: 0,
    totalEstimatedTokens: 0, // = totalAlwaysTokens（baseline、後方互換）
  };

  // baseline（常時注入）と起動時上限（全スキル fullTokens 合計）を別集計
  let always = 0;
  let invoke = 0;

  // CLAUDE.md 本体（常時全文）
  const claudeMdContent = readSafe(path.join(CLAUDE_DIR, "CLAUDE.md"));
  if (claudeMdContent) {
    const b = bytes(claudeMdContent);
    const t = toTokens(b);
    result.claudeMd = { label: "CLAUDE.md", bytes: b, alwaysTokens: t, fullTokens: t, estimatedTokens: t };
    always += t;

    for (const ref of parseAtRefs(claudeMdContent, CLAUDE_DIR)) {
      const m = measureFile(ref.fullPath, ref.name);
      if (m) {
        result.atRefs.push(m);
        always += m.alwaysTokens;
      }
    }
  }

  // グローバル有効プラグイン（settings.json の enabledPlugins）
  const settings = (() => {
    const c = readSafe(path.join(CLAUDE_DIR, "settings.json"));
    try { return c ? JSON.parse(c) : {}; } catch { return {}; }
  })();
  for (const [key, enabled] of Object.entries(settings.enabledPlugins || {})) {
    if (!enabled) continue;
    const p = measurePlugin(key);
    if (p) {
      result.globalPlugins.push(p);
      always += p.totalAlwaysTokens;
      // プラグイン CLAUDE.md は常時注入（always）なので、起動時上限はスキルの delta（full - always）のみ
      for (const f of p.files) {
        if (f.label.startsWith("skills/")) invoke += Math.max(0, f.fullTokens - f.alwaysTokens);
      }
    }
  }

  // 個人スキル（~/.claude/skills）
  result.personalSkills = measurePersonalSkills();
  for (const s of result.personalSkills) {
    always += s.alwaysTokens;
    invoke += Math.max(0, s.fullTokens - s.alwaysTokens);
  }

  // プロジェクトスコープのプラグイン（参考情報）
  result.projectPlugins = projectScopedPlugins();

  // MCP サーバ（静的計測対象外。名前のみ）
  result.mcpServers = listMcpServers();

  result.totalAlwaysTokens = always;
  result.totalInvokeTokens = invoke;
  result.totalEstimatedTokens = always;

  return result;
}
