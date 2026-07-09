import { useEffect, useMemo, useRef, useState } from "react";
import { activeBurnWarning, filterSummary, filterSummaryByProject, filterPreviousPeriod, isDateRange, PERIOD_DAYS, type Period, type FixedPeriod, type BillingMode } from "./api";
import { usd } from "./format";
import { useSummaryQuery } from "./hooks/useSummaryQuery";
import { useHourlyQuery } from "./hooks/useHourlyQuery";
import { useSSEInvalidation } from "./hooks/useSSEInvalidation";
import { SummaryCards } from "./components/SummaryCards";
import { OptimizationAdvisor } from "./components/OptimizationAdvisor";
import { SavingsSimulator } from "./components/SavingsSimulator";
import { CostDrivers } from "./components/CostDrivers";
import { ThinkingBreakdown } from "./components/ThinkingBreakdown";
import { ModelBreakdown } from "./components/ModelBreakdown";
import { DailyTrend } from "./components/DailyTrend";
import { HourlyTrend } from "./components/HourlyTrend";
import { OverheadAnalysis } from "./components/OverheadAnalysis";
import { CacheEfficiency } from "./components/CacheEfficiency";
import { SubagentBreakdown } from "./components/SubagentBreakdown";
import { PeriodSelector } from "./components/PeriodSelector";
import { ProjectSelector } from "./components/ProjectSelector";
import { BillingBlocks } from "./components/BillingBlocks";
import { BudgetProjection } from "./components/BudgetProjection";
import { ProjectBreakdown } from "./components/ProjectBreakdown";
import { SessionBreakdown } from "./components/SessionBreakdown";
import { ToolBreakdown } from "./components/ToolBreakdown";
import { ToolResultBreakdown } from "./components/ToolResultBreakdown";
import { DuplicateReadBreakdown } from "./components/DuplicateReadBreakdown";
import { ExplorationBreakdown } from "./components/ExplorationBreakdown";
import { ToolResultOutliers } from "./components/ToolResultOutliers";
import { McpServerBreakdown } from "./components/McpServerBreakdown";
import { ActivityHeatmap } from "./components/ActivityHeatmap";
import { SectionNav, type SectionId } from "./components/SectionNav";
import { ContextBudget } from "./components/ContextBudget";
import { ScrollToTopButton } from "./components/ScrollToTopButton";
import { DataQualityBadge } from "./components/DataQualityBadge";
import { Icon } from "./components/icons/Icon";

export default function App() {
  const [period, setPeriod] = useState<Period>('7d');
  const [selectedProject, setSelectedProject] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);
  const [topbarHeight, setTopbarHeight] = useState(108);
  const [hourlyMetric, setHourlyMetric] = useState<"cost" | "tokens">("cost");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  const [billingMode, setBillingMode] = useState<BillingMode>(() => {
    const saved = localStorage.getItem("billingMode");
    if (saved === "subscription" || saved === "api") return saved;
    return "api";
  });

  const summaryRef = useRef<HTMLDivElement>(null);
  const driversRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<HTMLDivElement>(null);
  const contextBudgetRef = useRef<HTMLDivElement>(null);
  const optimizationRef = useRef<HTMLDivElement>(null);
  const toolOutputRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLElement>(null);

  const sectionRefs = useMemo<Record<SectionId, React.RefObject<HTMLDivElement>>>(
    () => ({
      summary: summaryRef,
      drivers: driversRef,
      project: projectRef,
      session: sessionRef,
      contextBudget: contextBudgetRef,
      optimization: optimizationRef,
      toolOutput: toolOutputRef,
    }),
    []
  );

  const canCompare = !isDateRange(period) && period !== 'all';

  const {
    data,
    isLoading: isSummaryLoading,
    isError: isSummaryError,
    error: summaryError,
    reload,
    isReloading,
    isReloadError,
    reloadError,
  } = useSummaryQuery(period);
  const { data: hourlyDataRaw } = useHourlyQuery();
  const hourlyData = hourlyDataRaw ?? [];
  useSSEInvalidation(autoRefresh);

  const error = isSummaryError ? String(summaryError) : null;
  const loading = isReloading || isSummaryLoading;
  const autoRefreshError = isSummaryError && data
    ? String(summaryError)
    : isReloadError
      ? String(reloadError)
      : null;
  const lastUpdated = data ? Date.parse(data.generatedAt) : null;

  const displayData = useMemo(
    () => (data ? filterSummaryByProject(filterSummary(data, period), selectedProject) : null),
    [data, period, selectedProject]
  );

  const prevDisplayData = useMemo(() => {
    if (!compareMode || !data) return null;
    const prev = filterPreviousPeriod(data, period);
    if (!prev) return null;
    return filterSummaryByProject(prev, selectedProject);
  }, [data, period, compareMode, selectedProject]);

  // 全期間・カスタム範囲では前期が定義できないため比較モードを自動 OFF にする
  useEffect(() => {
    if (period === 'all' || isDateRange(period)) setCompareMode(false);
  }, [period]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("billingMode", billingMode);
  }, [billingMode]);

  const burn = data ? activeBurnWarning(data.blocks) : null;

  const handleSectionClick = (id: SectionId) => {
    const ref = sectionRefs[id];
    if (ref?.current) {
      ref.current.scrollIntoView({ behavior: 'smooth' });
      setActiveSection(id);
    }
  };

  // スクロールスパイ: ビューポート内に入ったセクションを自動でハイライトする
  useEffect(() => {
    if (!displayData) return;

    const ratios = new Map<SectionId, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace(/^section-/, "") as SectionId;
          ratios.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }

        const next = [...ratios.entries()].sort((a, b) => b[1] - a[1])[0];
        if (next && next[1] > 0) {
          setActiveSection(next[0]);
        }
      },
      { rootMargin: `-${topbarHeight}px 0px -60% 0px`, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    Object.values(sectionRefs).forEach((ref) => {
      if (ref.current) observer.observe(ref.current);
    });

    return () => observer.disconnect();
  }, [displayData, sectionRefs, topbarHeight]);

  // topbar の実測高さを section-nav の sticky オフセット・スクロールスパイの両方へ反映する（折り返しで高さが変わっても追従させる）
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;

    const updateHeight = () => {
      const height = el.offsetHeight;
      document.documentElement.style.setProperty("--topbar-height", `${height}px`);
      setTopbarHeight(height);
    };
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="app">
      <header className="topbar" ref={topbarRef}>
        <div className="topbar-row-1">
          <div className="topbar-title">
            <h1>Claude Code コストダッシュボード</h1>
            <div className="sub">JSONL ログから算出した利用コストの推定値</div>
          </div>
          {lastUpdated && (
            <span className="last-updated">
              最終更新 {new Date(lastUpdated).toLocaleTimeString("ja-JP")}
              <DataQualityBadge source={data?.source} />
              {autoRefreshError && (
                <span className="auto-refresh-error" title={autoRefreshError}>
                  　<Icon name="warning" size={12} /> 自動更新失敗
                </span>
              )}
            </span>
          )}
        </div>
        <div className="topbar-row-2">
          <div className="topbar-controls">
            <div className="control-group">
              <button
                type="button"
                className={`live-toggle ${autoRefresh ? "live-on" : ""}`}
                aria-pressed={autoRefresh}
                onClick={() => setAutoRefresh((v) => !v)}
                title="30秒ごとに自動で再集計します"
              >
                <span className="live-dot" />
                ライブ更新 {autoRefresh ? "ON" : "OFF"}
              </button>
              <button
                type="button"
                className="reload"
                aria-label="再読込"
                title="再読込"
                onClick={() => reload()}
                disabled={loading}
              >
                <Icon name="refresh" className={loading ? "spin" : undefined} />
              </button>
            </div>
            <button
              type="button"
              className={`theme-toggle${theme === "light" ? " theme-light" : ""}`}
              aria-pressed={theme === "light"}
              aria-label="ライト/ダークモード切替"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            >
              <Icon name={theme === "light" ? "sun" : "moon"} />
            </button>
            <button
              type="button"
              className="billing-mode-toggle"
              aria-pressed={billingMode === "subscription"}
              aria-label="課金モード切替（サブスクリプション/API従量課金）"
              title="課金モードに応じてキャッシュTTLアドバイスを補正します"
              onClick={() => setBillingMode((m) => (m === "api" ? "subscription" : "api"))}
            >
              {billingMode === "subscription" ? "サブスク" : "API従量課金"}
            </button>
            {data && data.projects.length > 0 && (
              <ProjectSelector
                projects={data.projects}
                selected={selectedProject}
                onChange={setSelectedProject}
              />
            )}
            <PeriodSelector
              period={period}
              onChange={setPeriod}
              compareMode={compareMode}
              onCompareChange={setCompareMode}
              canCompare={canCompare}
            />
          </div>
        </div>
      </header>

      {error && !data && <div className="error">読み込み失敗: {error}</div>}
      {!data && !error && <div className="loading">集計中…</div>}

      {burn && (
        <div className="burn-warn">
          <Icon name="warning" size={14} /> 高バーンレート: {usd(burn.perMin)}/分（残り {burn.remainMin} 分）
        </div>
      )}

      {displayData && (
        <>
          {displayData.warnings.fallbackModels.length > 0 && (
            <div className="warn">
              価格未登録のモデルあり（opus 価格で暫定計算）:{" "}
              {displayData.warnings.fallbackModels.join(", ")}
            </div>
          )}
          <SectionNav
            sections={[
              { id: 'summary', label: '概要' },
              { id: 'drivers', label: 'コストドライバー' },
              { id: 'project', label: 'プロジェクト' },
              ...(displayData.toolResultOutliers && displayData.toolResultOutliers.overCount > 0
                ? [{ id: 'toolOutput' as const, label: 'ツール出力上限' }]
                : []),
              { id: 'session', label: 'セッション' },
              { id: 'contextBudget', label: 'コンテキスト予算' },
              { id: 'optimization', label: '最適化' },
            ]}
            activeSection={activeSection}
            onSectionClick={handleSectionClick}
          />
          <section id="section-summary" ref={summaryRef}>
            <SummaryCards s={displayData} prev={prevDisplayData ?? undefined} />
            <OptimizationAdvisor s={displayData} billingMode={billingMode} />
            <BudgetProjection s={data!} />
            <BillingBlocks s={data!} />
          </section>
          <section id="section-drivers" ref={driversRef}>
            <CostDrivers s={displayData} />
            <ThinkingBreakdown s={displayData} />
            {hourlyData.length > 0 && (
              <HourlyTrend
                data={hourlyData}
                metric={hourlyMetric}
                onMetricChange={setHourlyMetric}
              />
            )}
            <div className="grid2">
              <ModelBreakdown s={displayData} />
              <DailyTrend
                s={displayData}
                prev={prevDisplayData ?? undefined}
                prevOffsetDays={canCompare && !isDateRange(period) ? PERIOD_DAYS[period as Exclude<FixedPeriod, 'all'>] : undefined}
                period={period}
              />
            </div>
          </section>
          <section id="section-project" ref={projectRef}>
            <ProjectBreakdown s={displayData} />
            <ToolBreakdown s={displayData} />
            <ToolResultBreakdown s={displayData} />
            <DuplicateReadBreakdown s={displayData} />
            <ExplorationBreakdown s={displayData} />
            <McpServerBreakdown s={displayData} />
          </section>
          <section id="section-toolOutput" ref={toolOutputRef}>
            <ToolResultOutliers s={displayData} />
          </section>
          <section id="section-session" ref={sessionRef}>
            <SessionBreakdown s={displayData} />
            <ActivityHeatmap s={data!} />
          </section>
          <section id="section-contextBudget" ref={contextBudgetRef}>
            <ContextBudget s={displayData} />
          </section>
          <section id="section-optimization" ref={optimizationRef}>
            <CacheEfficiency s={displayData} />
            <SubagentBreakdown s={displayData} />
            <OverheadAnalysis s={displayData} />
            <SavingsSimulator s={displayData} />
          </section>
          <footer className="foot">
            集計時刻 {new Date(displayData.generatedAt).toLocaleString("ja-JP")} ／ コストは価格表に基づく推定値
          </footer>
        </>
      )}
      <ScrollToTopButton />
    </div>
  );
}
