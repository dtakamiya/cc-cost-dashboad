import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// fs.watch をモック
const mockClose = vi.fn();
const mockWatch = vi.fn();

vi.mock("node:fs", () => ({
  default: {
    watch: mockWatch,
  },
}));

// watcher.js は fs.watch をモック後にインポートする必要があるため動的インポート使用
let createWatcher;

beforeEach(async () => {
  vi.resetModules();
  mockWatch.mockReset();
  mockClose.mockReset();

  // デフォルトで watcher オブジェクトを返す
  mockWatch.mockReturnValue({ close: mockClose });

  // 動的インポートでリセット後のモジュールを取得
  const mod = await import("./watcher.js");
  createWatcher = mod.createWatcher;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createWatcher", () => {
  it("指定ディレクトリを fs.watch で監視する", () => {
    const callback = vi.fn();
    createWatcher("/some/dir", callback);

    expect(mockWatch).toHaveBeenCalledOnce();
    expect(mockWatch.mock.calls[0][0]).toBe("/some/dir");
    expect(mockWatch.mock.calls[0][1]).toMatchObject({ recursive: true });
  });

  it("短時間に複数の変更が来てもコールバックは一度だけ呼ばれる（デバウンス）", async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    createWatcher("/some/dir", callback);

    // fs.watch に渡したリスナーを取得
    const listener = mockWatch.mock.calls[0][2];

    // 3 回連続でイベント発火
    listener("change", "foo.jsonl");
    listener("change", "bar.jsonl");
    listener("change", "baz.jsonl");

    // デバウンス時間前はまだ呼ばれない
    expect(callback).not.toHaveBeenCalled();

    // デバウンス時間経過
    await vi.runAllTimersAsync();

    expect(callback).toHaveBeenCalledOnce();
  });

  it("デバウンス時間内の 2 回目変更は待機をリセットする", async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    createWatcher("/some/dir", callback);

    const listener = mockWatch.mock.calls[0][2];

    listener("change", "foo.jsonl");

    // デバウンス時間の半分だけ進める
    await vi.advanceTimersByTimeAsync(250);
    expect(callback).not.toHaveBeenCalled();

    // 再度イベント（リセットされるはず）
    listener("change", "bar.jsonl");

    // 最初のイベントから 500ms 以上経過しているが、2 回目から 500ms は経っていない
    await vi.advanceTimersByTimeAsync(250);
    expect(callback).not.toHaveBeenCalled();

    // 2 回目から 500ms 経過
    await vi.advanceTimersByTimeAsync(250);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("stop() を呼ぶと監視を終了し以後コールバックは呼ばれない", async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const watcher = createWatcher("/some/dir", callback);

    const listener = mockWatch.mock.calls[0][2];
    listener("change", "foo.jsonl");

    // stop を呼んでタイマーをキャンセル
    watcher.stop();

    // タイマーが進んでもコールバックは呼ばれない
    await vi.runAllTimersAsync();
    expect(callback).not.toHaveBeenCalled();

    // watcher.close() が呼ばれたことを確認
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("監視対象ディレクトリが存在しない場合は例外にならない", () => {
    mockWatch.mockImplementation(() => {
      const err = new Error("ENOENT: no such file or directory");
      err.code = "ENOENT";
      throw err;
    });

    const callback = vi.fn();
    // 例外をスローしないこと
    expect(() => createWatcher("/nonexistent/dir", callback)).not.toThrow();
  });

  it(".jsonl 以外のファイル変更はコールバックを呼ばない", async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    createWatcher("/some/dir", callback);

    const listener = mockWatch.mock.calls[0][2];
    listener("change", "README.md");
    listener("change", "config.json");

    await vi.runAllTimersAsync();
    expect(callback).not.toHaveBeenCalled();
  });

  it("コールバック実行中に変更が来ても直列化される（concurrent rebuild を防ぐ）", async () => {
    vi.useFakeTimers();

    let resolveFirst;
    const firstDone = new Promise((r) => (resolveFirst = r));
    const callOrder = [];

    const callback = vi
      .fn()
      .mockImplementationOnce(async () => {
        callOrder.push("start-1");
        await firstDone;
        callOrder.push("end-1");
      })
      .mockImplementationOnce(async () => {
        callOrder.push("start-2");
      });

    createWatcher("/some/dir", callback);
    const listener = mockWatch.mock.calls[0][2];

    // 1 回目のイベント → デバウンス → runCallback 開始
    listener("change", "a.jsonl");
    await vi.runAllTimersAsync();

    // 1 回目が実行中の間に 2 回目のイベント → pending=true になるはず
    listener("change", "b.jsonl");
    await vi.runAllTimersAsync();

    // 1 回目が完了していないのでコールバックは 1 回だけ
    expect(callback).toHaveBeenCalledTimes(1);

    // 1 回目を完了させる
    resolveFirst();
    await vi.runAllTimersAsync();

    // pending が処理されて 2 回目が実行される
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callOrder).toEqual(["start-1", "end-1", "start-2"]);
  });

  it("stop() 後に pending があっても再実行されない", async () => {
    vi.useFakeTimers();

    let resolveFirst;
    const firstDone = new Promise((r) => (resolveFirst = r));
    const callback = vi
      .fn()
      .mockImplementationOnce(() => firstDone)
      .mockImplementation(vi.fn());

    const w = createWatcher("/some/dir", callback);
    const listener = mockWatch.mock.calls[0][2];

    // 1 回目のイベント → runCallback 開始（実行中）
    listener("change", "a.jsonl");
    await vi.runAllTimersAsync();

    // 実行中に 2 回目のイベント → pending = true
    listener("change", "b.jsonl");
    await vi.runAllTimersAsync();

    // stop() で pending をクリア
    w.stop();

    // 1 回目を完了させても 2 回目は実行されない
    resolveFirst();
    await vi.runAllTimersAsync();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("dir が null のとき CLAUDE_LOGS_DIR または デフォルトパスを使う", () => {
    const callback = vi.fn();
    process.env.CLAUDE_LOGS_DIR = "/custom/logs";
    createWatcher(null, callback);

    expect(mockWatch.mock.calls[0][0]).toBe("/custom/logs");
    delete process.env.CLAUDE_LOGS_DIR;
  });
});
