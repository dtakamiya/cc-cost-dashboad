<!-- Generated: 2026-07-04 | Files scanned: 1 (package.json) | Token estimate: ~350 -->

# Dependencies

## External Services

なし。全データはローカルファイルシステム（`~/.claude/projects/**/*.jsonl`）から読み込み、外部API・DB・SaaS連携は一切ない。

## Runtime Dependencies

| Package | Version | 用途 |
|---|---|---|
| `express` | ^4.21.2 | HTTPサーバー、静的ファイル配信、SSE |
| `react` / `react-dom` | ^18.3.1 | フロントエンドUI |
| `@tanstack/react-query` | ^5.101.2 | データフェッチ・キャッシュ・ポーリング・invalidation |
| `recharts` | ^2.13.3 | チャート描画（DailyTrend/HourlyTrend/ActivityHeatmap等） |

## Dev Dependencies

| Package | Version | 用途 |
|---|---|---|
| `vite` | ^5.4.11 | フロントエンドdevサーバー・ビルド |
| `@vitejs/plugin-react` | ^4.3.4 | Vite用Reactプラグイン |
| `typescript` | ^5.6.3 | 型チェック（`strict: true`） |
| `vitest` | ^4.1.9 | テストランナー（フロント・バックエンド共通） |
| `@testing-library/react` / `jest-dom` / `user-event` | ^16.3.2 / ^6.9.1 / ^14.6.1 | コンポーネントテスト |
| `jsdom` | ^29.1.1 | Vitestのブラウザ環境エミュレーション |
| `supertest` | ^7.2.2 | Express APIの統合テスト |
| `concurrently` | ^10.0.3 | `npm run dev` で server+web を同時起動 |

## Dependency Update Policy

- Dependabot が毎週月曜（JST 09:00）に自動更新PRを作成（`.github/dependabot.yml`）
- メジャーバージョンアップ（React/Recharts/Express等）は自動PR対象外。手動更新時は `npm install` → `npm test` → `npm run typecheck` → `npm run build` の順に検証
- 詳細は [CLAUDE.md](../../CLAUDE.md) の「Dependency Updates」節を参照

## Node/Module System

- ESM (`"type": "module"` in package.json)
- サーバーは Node組み込みモジュールのみ追加使用（`node:fs`, `node:path`, `node:os`, `node:url`）
