<!-- Generated: 2026-07-04 | Files scanned: 6 | Token estimate: ~700 -->

# Backend Architecture

Plain ESM JavaScript（TypeScript化していない）。`server/*.test.js` で Vitest + supertest テスト。

## Routes

```text
GET  /api/summary?period=&from=&to=  → parsePeriodQuery → aggregate(filterRecordsByPeriod(recordsCache)) → JSON Summary
GET  /api/hourly                     → cache.hourly（24時間バケット）
POST /api/reload                     → rebuild()（30秒クールダウン、429+Retry-After）
GET  /api/events                     → SSE、rebuild完了時に "update" イベントを配信
GET  /api/sessions/:id/turns         → recordsCache を sessionId でフィルタ、ts昇順でターン明細返却
GET  /api/pricing                    → PRICING テーブル + キャッシュ倍率
GET  *                                → (本番のみ) dist/index.html を配信（SPA fallback）
```

## Key Files

- [server/index.js](../../server/index.js) (Express entry, ~260行) — ルート定義、インメモリキャッシュ管理、SSEクライアント管理
- [server/parser.js](../../server/parser.js) (~440行) — `loadRecords(offsetState, toolUseIdMap)` で差分JSONL読み込み。`toRecord()` が assistant行を正規化、`<synthetic>`モデル除外、thinking統計抽出
- [server/aggregate.js](../../server/aggregate.js) (~980行) — `aggregate(records, {compactions, toolUseRecords, toolResultRecords})` が単一パス集計のエントリポイント。`computeBlocks`（5時間課金ブロック）、`computeHourly`（24hバケット）、`filterRecordsByPeriod`、`computeToolResultOutliers` を含む
- [server/pricing.js](../../server/pricing.js) (~70行) — `PRICING` テーブル、`costOf(model, usage)` でUSDコスト計算、モデル名プレフィックス一致で未知バージョンを解決
- [server/analyze.js](../../server/analyze.js) (~280行) — `analyzeOverhead()` が `~/.claude/` 配下（CLAUDE.md, skills, agents等）のファイルサイズ→近似トークン数を測定
- [server/watcher.js](../../server/watcher.js) (~80行) — `createWatcher(dir, callback)` が `fs.watch` + 500ms debounce + 実行中フラグで多重起動防止

## Request Flow Example

```text
GET /api/summary?period=7d
  → parsePeriodQuery({period:"7d"}) → {days:7}
  → filterRecordsByPeriod(recordsCache, {days:7})
  → aggregate(filtered, {compactions, toolUseRecords, toolResultRecords})
  → periodSummary.blocks/projection/activity/source/overhead/toolResultOutliers は
    常に cache（全期間集計）の値で上書き（全期間依存コンポーネント用のため）
  → res.json(periodSummary)
```

## State Management (module-level, in-memory)

| 変数 | 役割 |
|---|---|
| `cache` | 直近の全期間集計結果（Summary） |
| `recordsCache` | 正規化レコードの累積配列（ターン詳細取得用） |
| `compactionsCache` / `toolUseRecordsCache` / `toolResultRecordsCache` | 累積サブレコード配列 |
| `offsetState` (Map) | ファイルパス毎の読み込み済みバイトオフセット |
| `toolUseIdMap` (Map) | tool_use_id → toolName（tool_result突き合わせ用） |
| `cumulativeSource` | source統計（fileCount/parsedLines/parseErrors/skippedLines/unreadableFiles）の累積 |
| `clients` (Set) | SSE接続中のレスポンスオブジェクト |

## Dependencies

- Express 4（HTTPサーバー、static配信）
- Node組み込み: `node:fs`, `node:path`, `node:os`, `node:url`
- データソース: ローカルファイルシステムのみ（外部API呼び出しなし）
