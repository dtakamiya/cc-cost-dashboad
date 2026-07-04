<!-- Generated: 2026-07-04 | Files scanned: 52 | Token estimate: ~650 -->

# Architecture

Claude Code 利用量の JSONL ログを解析し、トークンコストを可視化するダッシュボード。

## System

```text
~/.claude/projects/**/*.jsonl  (or CLAUDE_LOGS_DIR override)
  → server/parser.js     readline ストリームで正規化、<synthetic> モデル除外、差分読み込み(offsetState)
  → server/aggregate.js  モデル×日別サマリーへの単一パス集計 + 課金ブロック/burn rate/24h集計
  → server/analyze.js    ~/.claude/ 配下のファイルサイズからシステムプロンプトのオーバーヘッド測定
  → Express API (server/index.js)  インメモリキャッシュ、summary/reload/hourly/events/turns/pricing
  → React frontend (src/)  Vite dev proxy /api → localhost:3001、TanStack Query でフェッチ
  → Recharts で可視化

server/watcher.js が ~/.claude/projects を監視 (500ms debounce)
  → rebuild() 実行 → SSE `update` イベント (/api/events) → フロントが自動再フェッチ
```

本番では Express が `dist/` を直接配信する（`npm run build` 後、DIST 存在時のみ static + SPA fallback）。

## Service Boundaries

| Layer | Responsibility | Entry |
|---|---|---|
| Parser | JSONL → 正規化レコード（差分読み込み、tool_use/tool_result 紐付け） | [server/parser.js](../../server/parser.js) |
| Aggregator | レコード群 → Summary（日別/モデル別/セッション別/課金ブロック等） | [server/aggregate.js](../../server/aggregate.js) |
| Pricing | モデル別単価テーブル、cost計算 | [server/pricing.js](../../server/pricing.js) |
| Overhead analyzer | `~/.claude/` の CLAUDE.md・skills 等のサイズ測定 | [server/analyze.js](../../server/analyze.js) |
| Watcher | ファイル変更検知 → rebuild トリガー | [server/watcher.js](../../server/watcher.js) |
| API | Express ルーティング、インメモリキャッシュ、SSE配信 | [server/index.js](../../server/index.js) |
| Frontend | React + TanStack Query + Recharts | [src/App.tsx](../../src/App.tsx), [src/api.ts](../../src/api.ts) |

## Key Design Points

- **累積キャッシュ**: `recordsCache`/`compactionsCache`/`toolUseRecordsCache`/`toolResultRecordsCache` は差分読み込みのたびに破壊的追記（`concat` 回避でO(n)コピーを防止）。ファイル切り詰め検知時は全キャッシュを再初期化。
- **rebuild() の直列化**: `rebuildInFlight` で同時実行を防ぎ、offsetState の競合書き込みを回避。
- **period クエリ**: `all` / `7d` / `30d` / `90d` / `from-to` カスタム範囲。省略時は後方互換でキャッシュ全期間を返す。
- **リロードのレート制限**: `POST /api/reload` は30秒クールダウン（429 + Retry-After）。

## External Dependencies

- Express 4, React 18, Recharts 2, TanStack Query 5（詳細は [dependencies.md](./dependencies.md)）
- データソースは外部APIではなくローカルファイルシステム（`~/.claude/projects/**/*.jsonl`）

## Data Flow Diagrams

詳細なルート/コンポーネント階層は [backend.md](./backend.md) / [frontend.md](./frontend.md) を参照。
