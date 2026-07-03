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

describe("loadRecords - isSidechain", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.CLAUDE_LOGS_DIR;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CLAUDE_LOGS_DIR;
    else process.env.CLAUDE_LOGS_DIR = originalEnv;
  });

  it("isSidechain: true を含む行は records に isSidechain: true として伝播する", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-sidechain-test-"));
    const projectDir = path.join(tmpDir, "project1");
    fs.mkdirSync(projectDir, { recursive: true });
    const sidechainLine = JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-28T00:00:00.000Z",
      sessionId: "test-session",
      cwd: "/tmp",
      isSidechain: true,
      message: {
        model: "claude-haiku-4-5-20251001",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), sidechainLine + "\n");

    try {
      process.env.CLAUDE_LOGS_DIR = tmpDir;
      const { records } = await loadRecords();
      expect(records).toHaveLength(1);
      expect(records[0].isSidechain).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("isSidechain フィールドが欠損している行は isSidechain: false になる", async () => {
    const tmpDir = makeTmpLogDir();
    try {
      process.env.CLAUDE_LOGS_DIR = tmpDir;
      const { records } = await loadRecords();
      expect(records).toHaveLength(1);
      expect(records[0].isSidechain).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
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

    const previousLogsDir = process.env.CLAUDE_LOGS_DIR;
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
      if (previousLogsDir === undefined) {
        delete process.env.CLAUDE_LOGS_DIR;
      } else {
        process.env.CLAUDE_LOGS_DIR = previousLogsDir;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("loadRecords - compaction markers", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.CLAUDE_LOGS_DIR;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CLAUDE_LOGS_DIR;
    else process.env.CLAUDE_LOGS_DIR = originalEnv;
  });

  it("isCompactSummary: true の行から compactions にセッションIDが集積される", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-compaction-test-"));
    const projectDir = path.join(tmpDir, "project1");
    fs.mkdirSync(projectDir, { recursive: true });
    const compactionLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "compacted" },
      isCompactSummary: true,
      uuid: "u1",
      timestamp: "2026-06-27T12:00:46.676Z",
      sessionId: "session-a",
      cwd: "/tmp",
    });
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), compactionLine + "\n");

    try {
      process.env.CLAUDE_LOGS_DIR = tmpDir;
      const { compactions } = await loadRecords();
      expect(compactions).toHaveLength(1);
      expect(compactions[0].sessionId).toBe("session-a");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("type: summary の行も compactions として集積される", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-compaction-test-"));
    const projectDir = path.join(tmpDir, "project1");
    fs.mkdirSync(projectDir, { recursive: true });
    const summaryLine = JSON.stringify({
      type: "summary",
      sessionId: "session-b",
    });
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), summaryLine + "\n");

    try {
      process.env.CLAUDE_LOGS_DIR = tmpDir;
      const { compactions } = await loadRecords();
      expect(compactions).toHaveLength(1);
      expect(compactions[0].sessionId).toBe("session-b");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("同一セッションで複数回圧縮された場合、複数件のcompactionsが積まれる（カウントはaggregate側の責務）", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-compaction-test-"));
    const projectDir = path.join(tmpDir, "project1");
    fs.mkdirSync(projectDir, { recursive: true });
    const line1 = JSON.stringify({ type: "user", isCompactSummary: true, sessionId: "session-c" });
    const line2 = JSON.stringify({ type: "user", isCompactSummary: true, sessionId: "session-c" });
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), line1 + "\n" + line2 + "\n");

    try {
      process.env.CLAUDE_LOGS_DIR = tmpDir;
      const { compactions } = await loadRecords();
      expect(compactions).toHaveLength(2);
      expect(compactions.every((c) => c.sessionId === "session-c")).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("圧縮マーカーが存在しないログでは compactions が空配列になる", async () => {
    const tmpDir = makeTmpLogDir();
    try {
      process.env.CLAUDE_LOGS_DIR = tmpDir;
      const { compactions } = await loadRecords();
      expect(compactions).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("isCompactSummary: true でも sessionId が無い行は compactions に含まれない", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-compaction-test-"));
    const projectDir = path.join(tmpDir, "project1");
    fs.mkdirSync(projectDir, { recursive: true });
    const line = JSON.stringify({ type: "user", isCompactSummary: true });
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), line + "\n");

    try {
      process.env.CLAUDE_LOGS_DIR = tmpDir;
      const { compactions } = await loadRecords();
      expect(compactions).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("差分読み込みでも複数ファイルにまたがって compactions が蓄積される", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-compaction-test-"));
    const project1 = path.join(tmpDir, "project1");
    const project2 = path.join(tmpDir, "project2");
    fs.mkdirSync(project1, { recursive: true });
    fs.mkdirSync(project2, { recursive: true });
    fs.writeFileSync(
      path.join(project1, "session.jsonl"),
      JSON.stringify({ type: "user", isCompactSummary: true, sessionId: "s1" }) + "\n"
    );
    fs.writeFileSync(
      path.join(project2, "session.jsonl"),
      JSON.stringify({ type: "summary", sessionId: "s2" }) + "\n"
    );

    try {
      process.env.CLAUDE_LOGS_DIR = tmpDir;
      const { compactions } = await loadRecords();
      expect(compactions).toHaveLength(2);
      expect(compactions.map((c) => c.sessionId).sort()).toEqual(["s1", "s2"]);
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

describe("loadRecords - 差分読み込み（offsetState）", () => {
  let originalEnv;
  let tmpDir;
  let projectDir;
  let logFile;

  beforeEach(() => {
    originalEnv = process.env.CLAUDE_LOGS_DIR;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-offset-test-"));
    projectDir = path.join(tmpDir, "project1");
    fs.mkdirSync(projectDir, { recursive: true });
    logFile = path.join(projectDir, "session.jsonl");
    process.env.CLAUDE_LOGS_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CLAUDE_LOGS_DIR;
    else process.env.CLAUDE_LOGS_DIR = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("空の offsetState を渡した場合、引数なし呼び出しと同じ挙動（フル読み込み）になる", async () => {
    fs.writeFileSync(logFile, VALID_LINE + "\n");

    const noArgResult = await loadRecords();
    const emptyMapResult = await loadRecords(new Map());

    expect(emptyMapResult.records).toHaveLength(noArgResult.records.length);
    expect(emptyMapResult.records).toHaveLength(1);
    expect(emptyMapResult.fileCount).toBe(noArgResult.fileCount);
    expect(emptyMapResult.parsedLines).toBe(noArgResult.parsedLines);
  });

  it("ファイルに変更がない場合、2回目の loadRecords 呼び出しは新規レコード0件を返す", async () => {
    fs.writeFileSync(logFile, VALID_LINE + "\n");

    const offsetState = new Map();
    const first = await loadRecords(offsetState);
    expect(first.records).toHaveLength(1);

    const second = await loadRecords(offsetState);
    expect(second.records).toHaveLength(0);
  });

  it("2回の loadRecords 呼び出しの間にファイルが追記された場合、新規追加分のみを返す", async () => {
    fs.writeFileSync(logFile, VALID_LINE + "\n");

    const offsetState = new Map();
    const first = await loadRecords(offsetState);
    expect(first.records).toHaveLength(1);

    fs.appendFileSync(logFile, VALID_LINE + "\n");

    const second = await loadRecords(offsetState);
    expect(second.records).toHaveLength(1);
  });

  it("読み込み後、offsetState に新しい offset と mtime が反映される", async () => {
    fs.writeFileSync(logFile, VALID_LINE + "\n");
    const expectedSize = fs.statSync(logFile).size;

    const offsetState = new Map();
    await loadRecords(offsetState);

    const entry = offsetState.get(logFile);
    expect(entry).toBeDefined();
    expect(entry.offset).toBe(expectedSize);
    expect(entry.mtimeMs).toBe(fs.statSync(logFile).mtimeMs);
  });

  it("改行なしの途中書き込み行（末尾未完了行）は消費されず、次回読み込みで丸ごと拾われる", async () => {
    fs.writeFileSync(logFile, VALID_LINE + "\n");

    const offsetState = new Map();
    const first = await loadRecords(offsetState);
    expect(first.records).toHaveLength(1);

    // 改行なしで部分行を追記（まだ書き込み中を想定）
    fs.appendFileSync(logFile, VALID_LINE);

    const second = await loadRecords(offsetState);
    expect(second.records).toHaveLength(0); // 未完了行は消費しない

    // 改行を追記して行を完成させる
    fs.appendFileSync(logFile, "\n");

    const third = await loadRecords(offsetState);
    expect(third.records).toHaveLength(1); // 完成した行が丸ごと拾われる
  });

  it("ファイルサイズがキャッシュ済み offset より縮小した場合（切り詰め）、offset 0 から再読み込みする", async () => {
    fs.writeFileSync(logFile, VALID_LINE + "\n" + VALID_LINE + "\n");

    const offsetState = new Map();
    const first = await loadRecords(offsetState);
    expect(first.records).toHaveLength(2);

    // ファイルを切り詰めて短くする
    fs.writeFileSync(logFile, VALID_LINE + "\n");

    const second = await loadRecords(offsetState);
    expect(second.records).toHaveLength(1); // 0 から再読み込みされ、切り詰め後の内容を返す
  });

  it("ファイルの mtime が後退した場合（ローテーション/置換）、offset 0 から再読み込みする", async () => {
    fs.writeFileSync(logFile, VALID_LINE + "\n");

    const offsetState = new Map();
    const first = await loadRecords(offsetState);
    expect(first.records).toHaveLength(1);

    const cachedEntry = offsetState.get(logFile);
    // 新しい内容で置換しつつ、mtime を過去に後退させる
    fs.writeFileSync(logFile, VALID_LINE + "\n" + VALID_LINE + "\n");
    const pastMtime = new Date(cachedEntry.mtimeMs - 60_000);
    fs.utimesSync(logFile, pastMtime, pastMtime);

    const second = await loadRecords(offsetState);
    expect(second.records).toHaveLength(2); // 0 から再読み込みされる
  });

  it("offsetState に存在しない新規ファイルは offset 0 から読み込まれる", async () => {
    fs.writeFileSync(logFile, VALID_LINE + "\n");

    const offsetState = new Map();
    const first = await loadRecords(offsetState);
    expect(first.records).toHaveLength(1);

    // 新規ファイルを追加
    const newFile = path.join(projectDir, "session2.jsonl");
    fs.writeFileSync(newFile, VALID_LINE + "\n" + VALID_LINE + "\n");

    const second = await loadRecords(offsetState);
    expect(second.records).toHaveLength(2); // 新規ファイルの全レコード
    expect(offsetState.has(newFile)).toBe(true);
  });

  it("差分読み込みで壊れたJSON行を追記した場合、parseErrorsが加算され、その行の分だけoffsetが前進して次回に持ち越されない", async () => {
    fs.writeFileSync(logFile, VALID_LINE + "\n");

    const offsetState = new Map();
    const first = await loadRecords(offsetState);
    expect(first.records).toHaveLength(1);
    expect(first.parseErrors).toBe(0);

    // 壊れたJSON行を追記
    fs.appendFileSync(logFile, "{not valid json\n");

    const second = await loadRecords(offsetState);
    expect(second.records).toHaveLength(0);
    expect(second.parseErrors).toBe(1);

    const entry = offsetState.get(logFile);
    expect(entry.offset).toBe(fs.statSync(logFile).size); // 壊れた行の分もoffsetが進んでいる

    // さらに正常な行を追記しても、壊れた行が再カウントされない
    fs.appendFileSync(logFile, VALID_LINE + "\n");
    const third = await loadRecords(offsetState);
    expect(third.records).toHaveLength(1);
    expect(third.parseErrors).toBe(0);
  });

  it("差分読み込みでファイルが読み取り不能になった場合、unreadableFilesが加算され、offsetStateは更新されず次回リトライされる", async () => {
    fs.writeFileSync(logFile, VALID_LINE + "\n");

    const offsetState = new Map();
    const first = await loadRecords(offsetState);
    expect(first.records).toHaveLength(1);
    const entryBefore = offsetState.get(logFile);

    // 2回目の読み込み中にファイルが削除される状況を再現する
    const originalStatSync = fs.statSync;
    const statSpy = vi.spyOn(fs, "statSync").mockImplementation((p, ...args) => {
      if (p === logFile) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return originalStatSync(p, ...args);
    });

    const second = await loadRecords(offsetState);
    expect(second.unreadableFiles).toBe(1);
    // offsetState は更新されない（stat 自体が失敗しているため、既存エントリのまま = 次回もこのファイルを対象にリトライされる）
    expect(offsetState.get(logFile)).toEqual(entryBefore);

    statSpy.mockRestore();

    // リトライで正しく読み込めることを確認
    fs.appendFileSync(logFile, VALID_LINE + "\n");
    const third = await loadRecords(offsetState);
    expect(third.records).toHaveLength(1);
    expect(third.unreadableFiles).toBe(0);
  });
});
