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

function measureFile(filePath, label) {
  const content = readSafe(filePath);
  if (!content) return null;
  const b = bytes(content);
  return { label, path: filePath, bytes: b, estimatedTokens: toTokens(b) };
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

  const main = measureFile(path.join(versionDir, "CLAUDE.md"), "CLAUDE.md");
  if (main) { files.push(main); totalBytes += main.bytes; }

  const skillsDir = path.join(versionDir, "skills");
  try {
    for (const s of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      const sm = measureFile(path.join(skillsDir, s.name, "SKILL.md"), `skills/${s.name}`);
      if (sm) { files.push(sm); totalBytes += sm.bytes; }
    }
  } catch {}

  return { name: pluginKey, files, totalBytes, totalEstimatedTokens: toTokens(totalBytes) };
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

export function analyzeOverhead() {
  const result = {
    claudeMd: null,
    atRefs: [],
    globalPlugins: [],
    projectPlugins: [],
    totalEstimatedTokens: 0,
  };

  // CLAUDE.md 本体
  const claudeMdContent = readSafe(path.join(CLAUDE_DIR, "CLAUDE.md"));
  if (claudeMdContent) {
    const b = bytes(claudeMdContent);
    result.claudeMd = { label: "CLAUDE.md", bytes: b, estimatedTokens: toTokens(b) };
    result.totalEstimatedTokens += toTokens(b);

    for (const ref of parseAtRefs(claudeMdContent, CLAUDE_DIR)) {
      const m = measureFile(ref.fullPath, ref.name);
      if (m) {
        result.atRefs.push(m);
        result.totalEstimatedTokens += m.estimatedTokens;
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
      result.totalEstimatedTokens += p.totalEstimatedTokens;
    }
  }

  // プロジェクトスコープのプラグイン（参考情報）
  result.projectPlugins = projectScopedPlugins();

  return result;
}
