<!-- Generated: 2026-07-04 | Files scanned: 33 | Token estimate: ~800 -->

# Frontend Architecture

React 18 + TypeScript(strict) + Vite + TanStack Query + Recharts。テストは各コンポーネント横に `*.test.tsx`（Vitest + RTL）。

## Entry & Page Tree

```text
src/main.tsx → QueryClientProvider(queryClient.ts) → App.tsx

App.tsx (単一ページ、セクション分割 + IntersectionObserver スクロールスパイ)
├─ topbar: タイトル / 最終更新 / ライブ更新トグル / リロード / テーマ切替 / 課金モード切替 / ProjectSelector / PeriodSelector
├─ section-summary:      SummaryCards, OptimizationAdvisor, BudgetProjection, BillingBlocks
├─ section-drivers:      CostDrivers, ThinkingBreakdown, HourlyTrend, ModelBreakdown, DailyTrend
├─ section-project:      ProjectBreakdown, ToolBreakdown, ToolResultBreakdown, McpServerBreakdown
├─ section-toolOutput:   ToolResultOutliers (条件付き: overCount > 0)
├─ section-session:      SessionBreakdown, ActivityHeatmap
├─ section-contextBudget:ContextBudget
├─ section-optimization: CacheEfficiency, SubagentBreakdown, OverheadAnalysis, SavingsSimulator
└─ ScrollToTopButton (フローティング)
```

`SectionNav` がセクション一覧を表示し、クリックで `scrollIntoView` + `activeSection` 更新。

## State Management

| Hook | 役割 |
|---|---|
| [useSummaryQuery](../../src/hooks/useSummaryQuery.ts) | `/api/summary?period=` を30秒ポーリング。`reload()` は `/api/reload` 呼び出し→現queryKeyに反映、他periodはinvalidate(refetchType:none)のみ |
| [useHourlyQuery](../../src/hooks/useHourlyQuery.ts) | `/api/hourly` フェッチ |
| [useSSEInvalidation](../../src/hooks/useSSEInvalidation.ts) | `/api/events` SSE購読、update受信時に summary/hourly クエリを invalidate（`enabled=false`で購読停止＝ライブ更新OFF） |

ローカルUI状態（`App.tsx` 内 `useState`）: `period`, `selectedProject`, `compareMode`, `autoRefresh`, `activeSection`, `hourlyMetric`, `theme`（localStorage永続化）, `billingMode`（localStorage永続化）。

## Key Files

- [src/api.ts](../../src/api.ts) (~700行) — 型定義（Summary/DailyCost/SessionCost/ToolUsage 等）+ `fetchSummary`/`subscribeToUpdates`/`filterSummary`/`filterSummaryByProject`/`filterPreviousPeriod` 等のデータ整形関数。**型定義のsource of truth**
- [src/App.tsx](../../src/App.tsx) (~350行) — ルートコンポーネント、レイアウトとセクション制御
- [src/advisor.ts](../../src/advisor.ts) / [src/weekly.ts](../../src/weekly.ts) — 最適化アドバイス・週次バーンレートのビジネスロジック（UIから分離）
- [src/format.ts](../../src/format.ts) — 数値フォーマット、モデル別カラーマッピング
- [src/budget.ts](../../src/budget.ts) / [src/contextBudget.ts](../../src/contextBudget.ts) / [src/simulator.ts](../../src/simulator.ts) — 予算計算・コンテキスト予算・節約シミュレーション

## Components (src/components/, 28 files)

主要カテゴリ:
- **サマリー系**: SummaryCards, DataQualityBadge, DeltaBadge
- **トレンド系**: DailyTrend, HourlyTrend, ActivityHeatmap, SessionCostCurve, InputContextCurve
- **内訳系**: ModelBreakdown, ProjectBreakdown, SessionBreakdown, ToolBreakdown, ToolResultBreakdown, McpServerBreakdown, SubagentBreakdown, ThinkingBreakdown
- **コスト分析**: CostDrivers, CacheEfficiency, OverheadAnalysis, OverheadGauge, BudgetProjection, BillingBlocks
- **アウトライヤー**: ToolResultOutliers
- **アドバイス**: OptimizationAdvisor, SavingsSimulator
- **コントロール**: PeriodSelector, ProjectSelector, SectionNav, ScrollToTopButton
- **共通**: icons/Icon, ContextBudget

## Data Flow

```text
useSummaryQuery(period) → Summary
  → filterSummary(data, period) → filterSummaryByProject(_, selectedProject) → displayData
  → compareMode時: filterPreviousPeriod(data, period) → filterSummaryByProject(_, selectedProject) → prevDisplayData
  → 各 section component に displayData / prevDisplayData を props で渡す
```

## Build & Test

```bash
npm run dev:web   # Vite dev server (5173), /api を localhost:3001 にプロキシ
npm run build     # vite build → dist/
npm test          # Vitest（*.test.ts / *.test.tsx）
npm run typecheck # tsc --noEmit (strict, noUnusedLocals, noUnusedParameters)
```
