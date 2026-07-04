# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start both Express API (port 3001) + Vite dev server (port 5173)
npm run dev:server   # Express API only
npm run dev:web      # Vite frontend only
npm run build        # Production build
npm test             # Run all tests once (Vitest)
npm run test:watch   # Run tests in watch mode
npm run typecheck    # TypeScript type check (tsc --noEmit)
```

No lint script. TypeScript is configured with `strict: true`, `noUnusedLocals`, `noUnusedParameters`.

## Dependency Updates

Dependabot は毎週月曜（JST 09:00）に npm 依存の更新 PR を自動作成する（設定: `.github/dependabot.yml`）。

依存を手動更新した場合は以下の順でまとめて検証する:

```bash
npm install          # 依存を更新
npm test             # 全テストがパスすること
npm run typecheck    # 型エラーがないこと
npm run build        # ビルドが成功すること
```

メジャーバージョンアップ（React / Recharts / Express 等）は破壊的変更を伴う可能性があるため、
Dependabot の自動 PR 対象から除外している。手動で変更ログを確認してから更新すること。

## Architecture

This is a cost dashboard for Claude Code usage. It reads JSONL conversation logs from `~/.claude/projects/**/*.jsonl` and visualizes token costs.

**Data Flow:**
```text
~/.claude/projects/**/*.jsonl  (or CLAUDE_LOGS_DIR override)
  → server/parser.js     (readline stream, normalizes records, strips <synthetic> models)
  → server/aggregate.js  (single-pass aggregation into model-by-day summaries)
  → server/analyze.js    (filesystem overhead size measurement)
  → Express /api/summary (in-memory cache, reload via POST /api/reload)
  → React frontend       (fetches via Vite proxy /api → localhost:3001)
  → Recharts visualizations

server/watcher.js watches ~/.claude/projects for *.jsonl changes (debounced)
  and triggers a rebuild + SSE `update` event on /api/events → frontend auto-refetches
```

In production, Express serves the built `dist/` directory directly.

**Backend** (`server/` — plain ESM JavaScript):
- `server/index.js` — Express entry point, in-memory cache, API routes (`/api/summary`, `/api/reload`, `/api/hourly`, `/api/events`, `/api/sessions/:id/turns`, `/api/pricing`)
- `server/parser.js` — JSONL parsing logic (reads `CLAUDE_LOGS_DIR` env var, defaults to `~/.claude/projects`)
- `server/aggregate.js` — Aggregation logic
- `server/pricing.js` — Price table (USD/MTok, Claude 3/3.5/4 series); cache write 5m = 1.25x, cache write 1h = 2x, cache read = 0.1x
- `server/analyze.js` — Measures system-prompt overhead in `~/.claude/`
- `server/watcher.js` — Watches `~/.claude/projects` (or `CLAUDE_LOGS_DIR`) for `.jsonl` changes and triggers auto-reload

**Frontend** (`src/` — React + TypeScript):
- `src/api.ts` — API client + TypeScript type definitions (source of truth for data shapes)
- `src/format.ts` — Number formatting and model color mapping
- `src/weekly.ts` / `src/advisor.ts` — Business logic (weekly burn rate, optimization advice)
- `src/components/` — UI components (30+ files covering SummaryCards, CostDrivers, ModelBreakdown, DailyTrend, ActivityHeatmap, OverheadAnalysis, BudgetProjection, OptimizationAdvisor, ProjectBreakdown, SessionBreakdown, BillingBlocks, PeriodSelector, ContextBudget, ThinkingBreakdown, ToolBreakdown, McpServerBreakdown, SubagentBreakdown, CacheEfficiency, and more — see directory for the current list)

**Environment variables:** `PORT` (Express port, default `3001`), `CLAUDE_LOGS_DIR` (JSONL source dir, default `~/.claude/projects`). Both optional.

**Tests:** `src/components/*.test.tsx` / `src/*.test.ts` (frontend) and `server/*.test.js` (backend), both run by Vitest.
