import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEBOUNCE_MS = 500;

/**
 * 指定ディレクトリ配下の .jsonl ファイル変更を監視し、デバウンスしてコールバックを呼ぶ。
 * @param {string | null} dir 監視するディレクトリ。null のとき CLAUDE_LOGS_DIR または ~/.claude/projects を使う
 * @param {() => void} callback 変更検知時に呼ばれるコールバック
 * @returns {{ stop: () => void }}
 */
export function createWatcher(dir, callback) {
  const target =
    dir ??
    (process.env.CLAUDE_LOGS_DIR ??
      path.join(os.homedir(), ".claude", "projects"));

  let timer = null;
  let watcher = null;
  let running = false;
  let pending = false;

  const runCallback = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await callback();
    } catch (error) {
      console.error("watcher callback failed", error);
    } finally {
      running = false;
      if (pending) {
        pending = false;
        void runCallback();
      }
    }
  };

  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void runCallback();
    }, DEBOUNCE_MS);
  };

  try {
    watcher = fs.watch(target, { recursive: true }, (_eventType, filename) => {
      if (filename && filename.endsWith(".jsonl")) {
        debounced();
      }
    });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    // ディレクトリが存在しない場合はスキップ
  }

  return {
    stop() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    },
  };
}
