import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseSkillFrontmatter, measureSkillContent } from "./analyze.js";

const skill = (fm, body = "x".repeat(4000)) => `---\n${fm}\n---\n${body}`;

describe("parseSkillFrontmatter", () => {
  it("インライン name / description を抽出", () => {
    const c = skill("name: my-skill\ndescription: Does a thing.");
    expect(parseSkillFrontmatter(c)).toEqual({
      name: "my-skill",
      description: "Does a thing.",
    });
  });

  it("複数行（block scalar）description を結合", () => {
    const c = skill("name: multi\ndescription: >\n  line one\n  line two\nmetadata: x");
    const r = parseSkillFrontmatter(c);
    expect(r.name).toBe("multi");
    expect(r.description).toBe("line one line two");
  });

  it("frontmatter が無ければ空", () => {
    expect(parseSkillFrontmatter("no frontmatter here")).toEqual({ name: "", description: "" });
  });

  it("CRLF 改行の frontmatter を正しく解析", () => {
    const c = "---\r\nname: crlf-skill\r\ndescription: Windows line endings.\r\n---\r\nbody";
    expect(parseSkillFrontmatter(c)).toEqual({
      name: "crlf-skill",
      description: "Windows line endings.",
    });
  });
});

describe("measureSkillContent (progressive disclosure)", () => {
  it("alwaysTokens は description のみ、fullTokens は全文", () => {
    const c = skill("name: s\ndescription: short desc", "B".repeat(8000));
    const m = measureSkillContent(c, "s");
    // 全文（~8KB超）は description（数十バイト）より遥かに大きい
    expect(m.fullTokens).toBeGreaterThan(m.alwaysTokens * 10);
    // baseline 互換フィールドは alwaysTokens と一致
    expect(m.estimatedTokens).toBe(m.alwaysTokens);
    expect(m.bytes).toBe(Buffer.byteLength(c, "utf8"));
  });

  it("description が無くても alwaysTokens は小さく fullTokens は全文サイズ", () => {
    const c = skill("name: s", "C".repeat(4000));
    const m = measureSkillContent(c, "s");
    expect(m.alwaysTokens).toBeLessThan(10);
    expect(m.fullTokens).toBeGreaterThan(900);
  });
});

// ─── analyzeOverhead 結合テスト ──────────────────────────────────────────────

// fs モックは watcher.test.js パターンに倣い、モジュールリセット + 動的インポートで実施。
describe("analyzeOverhead", () => {
  let mockFs;

  beforeEach(() => {
    vi.resetModules();
    mockFs = {
      readFileSync: vi.fn().mockReturnValue(null),
      readdirSync: vi.fn().mockReturnValue([]),
    };
    vi.doMock("node:fs", () => ({ default: mockFs }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("CLAUDE.mdがないときclaudeMdはnull", async () => {
    // readFileSync は常に例外を投げる（ファイルなし相当）
    mockFs.readFileSync.mockImplementation(() => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); });

    const { analyzeOverhead } = await import("./analyze.js");
    const result = analyzeOverhead();

    expect(result.claudeMd).toBeNull();
  });

  it("CLAUDE.mdがあるときbytes/alwaysTokens/fullTokensを返す", async () => {
    const content = "# My CLAUDE.md\n\nThis is a test config file.";

    mockFs.readFileSync.mockImplementation((p) => {
      // CLAUDE.md のパスのみ返し、その他はエラー
      if (String(p).endsWith("CLAUDE.md")) return content;
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    // settings.json 等も readFileSync で読むので、JSON parse エラーにならないよう空オブジェクトを返す
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p).endsWith("CLAUDE.md")) return content;
      if (String(p).endsWith("settings.json")) return "{}";
      if (String(p).endsWith(".claude.json")) return "{}";
      if (String(p).endsWith("installed_plugins.json")) return "{}";
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const { analyzeOverhead } = await import("./analyze.js");
    const result = analyzeOverhead();

    expect(result.claudeMd).not.toBeNull();
    expect(result.claudeMd.bytes).toBe(Buffer.byteLength(content, "utf8"));
    expect(result.claudeMd.alwaysTokens).toBeGreaterThan(0);
    expect(result.claudeMd.fullTokens).toBe(result.claudeMd.alwaysTokens);
  });

  it("totalAlwaysTokensが各ソースの合計になる", async () => {
    const claudeMdContent = "# CLAUDE\n" + "A".repeat(400);

    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p).endsWith("CLAUDE.md")) return claudeMdContent;
      if (String(p).endsWith("settings.json")) return "{}";
      if (String(p).endsWith(".claude.json")) return "{}";
      if (String(p).endsWith("installed_plugins.json")) return "{}";
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const { analyzeOverhead } = await import("./analyze.js");
    const result = analyzeOverhead();

    // CLAUDE.md の alwaysTokens が totalAlwaysTokens に反映されていること
    expect(result.totalAlwaysTokens).toBeGreaterThan(0);
    expect(result.totalAlwaysTokens).toBe(result.claudeMd.alwaysTokens);
    // personalSkills / plugins がない場合は claudeMd のみ
    expect(result.totalEstimatedTokens).toBe(result.totalAlwaysTokens);
  });
});

// ─── MCP サーバオーバーヘッド推定（issue #132） ──────────────────────────────

describe("analyzeOverhead - mcpServers", () => {
  let mockFs;

  beforeEach(() => {
    vi.resetModules();
    mockFs = {
      readFileSync: vi.fn().mockReturnValue(null),
      readdirSync: vi.fn().mockReturnValue([]),
    };
    vi.doMock("node:fs", () => ({ default: mockFs }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("MCP未設定環境ではmcpServersは空配列", async () => {
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p).endsWith("settings.json")) return "{}";
      if (String(p).endsWith(".claude.json")) return "{}";
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const { analyzeOverhead } = await import("./analyze.js");
    const result = analyzeOverhead();

    expect(result.mcpServers).toEqual([]);
  });

  it("各MCPサーバは name/toolCount:null/estimatedTokens===DEFAULT_MCP_SERVER_TOKENS/source:'estimated' を持つ", async () => {
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p).endsWith("settings.json")) return "{}";
      if (String(p).endsWith(".claude.json")) {
        return JSON.stringify({ mcpServers: { github: { command: "gh" } } });
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const { analyzeOverhead, DEFAULT_MCP_SERVER_TOKENS } = await import("./analyze.js");
    const result = analyzeOverhead();

    expect(result.mcpServers).toEqual([
      { name: "github", toolCount: null, estimatedTokens: DEFAULT_MCP_SERVER_TOKENS, source: "estimated" },
    ]);
  });

  it(".claude.json と settings.json の mcpServers をマージし重複排除する", async () => {
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p).endsWith(".claude.json")) {
        return JSON.stringify({ mcpServers: { github: {}, filesystem: {} } });
      }
      if (String(p).endsWith("settings.json")) {
        return JSON.stringify({ mcpServers: { filesystem: {}, slack: {} } });
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const { analyzeOverhead } = await import("./analyze.js");
    const result = analyzeOverhead();

    const names = result.mcpServers.map((m) => m.name).sort();
    expect(names).toEqual(["filesystem", "github", "slack"]);
    // 重複排除されているので3件のみ
    expect(result.mcpServers.length).toBe(3);
  });

  it("不正なJSONを含むファイルは無視し、他方から読めたサーバのみ返す", async () => {
    mockFs.readFileSync.mockImplementation((p) => {
      if (String(p).endsWith(".claude.json")) return "{ not valid json";
      if (String(p).endsWith("settings.json")) {
        return JSON.stringify({ mcpServers: { filesystem: {} } });
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const { analyzeOverhead } = await import("./analyze.js");
    const result = analyzeOverhead();

    expect(result.mcpServers.map((m) => m.name)).toEqual(["filesystem"]);
  });
});
