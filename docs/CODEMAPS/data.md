<!-- Generated: 2026-07-04 | Files scanned: 2 | Token estimate: ~550 -->

# Data

データベースなし。**ソースオブレコード = `~/.claude/projects/**/*.jsonl`**（Claude Codeのセッションログ）。
サーバーはこれを読み込みインメモリで集計するのみ（永続化・書き込みは行わない）。

## Source: JSONL ログ行

各行は Claude Code の会話イベント。集計対象は `type === "assistant"` かつ `message.usage` を持つ行のみ（[server/parser.js](../../server/parser.js) `toRecord()`）。

```text
{
  type: "assistant",
  timestamp: "2026-07-04T12:34:56.000Z",
  sessionId: "uuid",
  cwd: "/path/to/project",
  isSidechain: false,
  message: {
    model: "claude-sonnet-5",
    usage: {
      input_tokens, output_tokens,
      cache_creation_input_tokens, cache_read_input_tokens,
      cache_creation: { ephemeral_1h_input_tokens }
    },
    content: [{ type: "thinking" | "redacted_thinking" | "tool_use" | ..., ... }]
  }
}
```

除外条件: `model` が `<...>` 形式（`<synthetic>` 等の内部モデル）、`usage` または `model` が欠損。

## Normalized Record (parser.js 出力)

```text
{ ts, model, cwd, sessionId, input, output, cacheCreate, cacheCreate1h, cacheRead, cache1h,
  isSidechain, thinkingTokensApprox, hasThinking, thinkingBlockCount }
```

サブレコード種別（同じ差分読み込み機構で累積）: `compactions`（コンテキスト圧縮マーカー）, `toolUseRecords`, `toolResultRecords`。

## Aggregated: Summary (server/aggregate.js → src/api.ts の型がsource of truth)

[src/api.ts:170](../../src/api.ts) `Summary` インターフェース主要フィールド:

| フィールド | 内容 |
|---|---|
| `totals` | cost/tokens/sessions/messages/from/to |
| `tokenSplit` / `costSplit` | input/output/cacheCreate/cacheRead 内訳 |
| `models[]` | モデル別コスト（`ModelCost`） |
| `daily[]` | 日別コスト（`DailyCost`） |
| `projects[]` | プロジェクト(cwd)別コスト |
| `drivers` | topModel/topDay/cacheReadRatio 等のコストドライバー |
| `sessionStats` | コールドスタートトークン統計 |
| `overhead` | CLAUDE.md/skills/plugins/MCPサーバーのオーバーヘッド（`server/analyze.js`由来） |
| `blocks[]` | 5時間課金ブロック（`Block`） |
| `projection` | 予算予測 |
| `activity` | 曜日×時間ヒートマップ（`matrix: number[7][24]`） |
| `bySession[]` / `byTool[]` / `byMcpServer[]` / `toolResultBreakdown[]` | 各ディメンション別集計 |
| `toolResultOutliers` | MCP/Bash出力上限超過の検出結果 |

## Data Lifecycle

```text
1. server/watcher.js が .jsonl 変更を検知 (500ms debounce)
2. server/parser.js が offsetState を使い差分行のみ読み込み → 正規化レコード
3. server/index.js の rebuild() が累積キャッシュに破壊的追記
4. server/aggregate.js が累積レコード全体を再集計 → Summary
5. SSE (/api/events) で "update" 通知 → フロントが /api/summary を再フェッチ
```

書き込み系API・DBマイグレーションは存在しない（読み取り専用の解析ツール）。

## Environment Variables

| 変数 | 既定値 | 用途 |
|---|---|---|
| `CLAUDE_LOGS_DIR` | `~/.claude/projects` | JSONLログの読み込み元ディレクトリ |
| `PORT` | `3001` | Express待受ポート |
