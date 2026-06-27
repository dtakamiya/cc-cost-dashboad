import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
