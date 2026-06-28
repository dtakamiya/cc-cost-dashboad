import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRecords } from "./parser.js";

// JSONL 1行分の最小有効レコード
const VALID_LINE = JSON.stringify({
  type: "assistant",
  timestamp: "2026-06-28T00:00:00.000Z",
  sessionId: "test-session",
  cwd: "/tmp",
  message: {
    model: "claude-haiku-4-5-20251001",
    usage: { input_tokens: 10, output_tokens: 5 },
  },
});

function makeTmpLogDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-test-"));
  const projectDir = path.join(dir, "project1");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, "session.jsonl"), VALID_LINE + "\n");
  return dir;
}

// 壊れた JSONL 行（JSON.parse 失敗）
const BROKEN_LINE = "{ this is not valid json }";

// 対象外行（typeが assistant でない）
const SKIP_LINE = JSON.stringify({
  type: "user",
  timestamp: "2026-06-28T00:00:00.000Z",
  sessionId: "test-session",
  cwd: "/tmp",
  message: { content: "hello" },
});

describe("loadRecords - 解析品質メタデータ", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.CLAUDE_LOGS_DIR;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CLAUDE_LOGS_DIR;
    else process.env.CLAUDE_LOGS_DIR = originalEnv;
  });

  it("loadRecords() が { parsedLines, skippedLines, parseErrors, unreadableFiles } を返すか", async () => {
    // Arrange: 正常行1、壊れた行1、対象外行1 を含むファイルを作成
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-quality-test-"));
    const projectDir = path.join(tmpDir, "project1");
    fs.mkdirSync(projectDir, { recursive: true });
    const content = [VALID_LINE, BROKEN_LINE, SKIP_LINE].join("\n") + "\n";
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), content);

    try {
      process.env.CLAUDE_LOGS_DIR = tmpDir;
      const result = await loadRecords();

      // records は正常な assistant 行のみ（VALID_LINE の 1 件）
      expect(result.records).toHaveLength(1);
      // parsedLines は JSON.parse 成功行数（正常行 + 対象外行 = 2）
      expect(result.parsedLines).toBe(2);
      // parseErrors は JSON.parse エラー行数（壊れた行 = 1）
      expect(result.parseErrors).toBe(1);
      // skippedLines = parsedLines - records.length = 2 - 1 = 1（対象外行）
      expect(result.skippedLines).toBe(1);
      // unreadableFiles はファイルオープン失敗数（0）
      expect(result.unreadableFiles).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });


  it("空ファイルの場合 parsedLines=0, parseErrors=0, skippedLines=0", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-quality-test-"));
    const projectDir = path.join(tmpDir, "project1");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), "");

    try {
      process.env.CLAUDE_LOGS_DIR = tmpDir;
      const result = await loadRecords();

      expect(result.parsedLines).toBe(0);
      expect(result.parseErrors).toBe(0);
      expect(result.skippedLines).toBe(0);
      expect(result.unreadableFiles).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("複数のファイルが存在する場合、各ファイルのメタデータが正確に集計される", async () => {
    // Arrange: 複数の JSONL ファイルを作成
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-quality-test-"));
    const project1 = path.join(tmpDir, "project1");
    const project2 = path.join(tmpDir, "project2");
    fs.mkdirSync(project1, { recursive: true });
    fs.mkdirSync(project2, { recursive: true });

    // project1: 正常行 + 壊れた行 + 対象外行
    const project1Content = [VALID_LINE, BROKEN_LINE, SKIP_LINE].join("\n") + "\n";
    fs.writeFileSync(path.join(project1, "session.jsonl"), project1Content);

    // project2: 正常行のみ
    fs.writeFileSync(path.join(project2, "session.jsonl"), VALID_LINE + "\n");

    try {
      process.env.CLAUDE_LOGS_DIR = tmpDir;
      const result = await loadRecords();

      // records: 正常行 2 件（project1 の VALID_LINE + project2 の VALID_LINE）
      expect(result.records).toHaveLength(2);
      // parsedLines: JSON.parse 成功行数（project1: 2行 + project2: 1行）
      expect(result.parsedLines).toBe(3);
      // parseErrors: JSON.parse エラー行数（project1: 1行）
      expect(result.parseErrors).toBe(1);
      // skippedLines: parsedLines - records.length = 3 - 2 = 1
      expect(result.skippedLines).toBe(1);
      // fileCount: 2 ファイル
      expect(result.fileCount).toBe(2);
      // unreadableFiles: 0（エラーなし）
      expect(result.unreadableFiles).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("loadRecords - CLAUDE_LOGS_DIR", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.CLAUDE_LOGS_DIR;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CLAUDE_LOGS_DIR;
    else process.env.CLAUDE_LOGS_DIR = originalEnv;
  });

  it("CLAUDE_LOGS_DIR が設定されていればそのディレクトリを読む", async () => {
    const tmpDir = makeTmpLogDir();
    try {
      process.env.CLAUDE_LOGS_DIR = tmpDir;
      const { records, fileCount } = await loadRecords();
      expect(fileCount).toBe(1);
      expect(records).toHaveLength(1);
      expect(records[0].model).toBe("claude-haiku-4-5-20251001");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("CLAUDE_LOGS_DIR が存在しないパスでも空結果を返す（例外にならない）", async () => {
    process.env.CLAUDE_LOGS_DIR = "/nonexistent/path/parser-test-99999";
    const { records, fileCount } = await loadRecords();
    expect(records).toEqual([]);
    expect(fileCount).toBe(0);
  });

  it("CLAUDE_LOGS_DIR が空文字列の場合はデフォルト（~/.claude/projects）にフォールバックする", async () => {
    const expectedDir = path.join(os.homedir(), ".claude", "projects");
    const spy = vi.spyOn(fs, "readdirSync");
    process.env.CLAUDE_LOGS_DIR = "";
    try {
      await loadRecords();
      expect(spy).toHaveBeenCalledWith(expectedDir, { withFileTypes: true });
    } finally {
      spy.mockRestore();
    }
  });
});
