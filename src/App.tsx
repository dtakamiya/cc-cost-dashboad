import { useEffect, useMemo, useRef, useState } from "react";
import { activeBurnWarning, filterSummary, filterSummaryByProject, filterPreviousPeriod, isDateRange, PERIOD_DAYS, type Period, type FixedPeriod } from "./api";
import { usd } from "./format";
import { useSummaryQuery } from "./hooks/useSummaryQuery";
import { useHourlyQuery } from "./hooks/useHourlyQuery";
import { useSSEInvalidation } from "./hooks/useSSEInvalidation";
import { SummaryCards } from "./components/SummaryCards";
import { OptimizationAdvisor } from "./components/OptimizationAdvisor";
import { CostDrivers } from "./components/CostDrivers";
import { ModelBreakdown } from "./components/ModelBreakdown";
import { DailyTrend } from "./components/DailyTrend";
import { HourlyTrend } from "./components/HourlyTrend";
import { OverheadAnalysis } from "./components/OverheadAnalysis";
import { CacheEfficiency } from "./components/CacheEfficiency";
import { PeriodSelector } from "./components/PeriodSelector";
import { ProjectSelector } from "./components/ProjectSelector";
import { BillingBlocks } from "./components/BillingBlocks";
import { BudgetProjection } from "./components/BudgetProjection";
import { ProjectBreakdown } from "./components/ProjectBreakdown";
import { SessionBreakdown } from "./components/SessionBreakdown";
import { ActivityHeatmap } from "./components/ActivityHeatmap";
import { SectionNav, type SectionId } from "./components/SectionNav";

export default function App() {
  const [period, setPeriod] = useState<Period>('7d');
  const [selectedProject, setSelectedProject] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);
  const [hourlyMetric, setHourlyMetric] = useState<"cost" | "tokens">("cost");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  const summaryRef = useRef<HTMLDivElement>(null);
  const driversRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<HTMLDivElement>(null);
  const optimizationRef = useRef<HTMLDivElement>(null);

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

  const burn = data ? activeBurnWarning(data.blocks) : null;

  const handleSectionClick = (id: SectionId) => {
    const refs: Record<SectionId, React.RefObject<HTMLDivElement>> = {
      summary: summaryRef,
      drivers: driversRef,
      project: projectRef,
      session: sessionRef,
      optimization: optimizationRef,
    };
    const ref = refs[id];
    if (ref?.current) {
      ref.current.scrollIntoView({ behavior: 'smooth' });
      setActiveSection(id);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row-1">
          <div className="topbar-title">
            <h1>Claude Code コストダッシュボード</h1>
            <div className="sub">JSONL ログから算出した利用コストの推定値</div>
          </div>
          {lastUpdated && (
            <span className="last-updated">
              最終更新 {new Date(lastUpdated).toLocaleTimeString("ja-JP")}
              {autoRefreshError && (
                <span className="auto-refresh-error" title={autoRefreshError}>
                  　⚠ 自動更新失敗
                </span>
              )}
            </span>
          )}
        </div>
        <div className="topbar-row-2">
          <div className="topbar-controls">
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
              className={`theme-toggle${theme === "light" ? " theme-light" : ""}`}
              aria-pressed={theme === "light"}
              aria-label="ライト/ダークモード切替"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            >
              {theme === "light" ? "☀" : "🌙"}
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
            <button className="reload" onClick={() => reload()} disabled={loading}>
              {loading ? "集計中…" : "再読込"}
            </button>
          </div>
        </div>
      </header>

      {error && !data && <div className="error">読み込み失敗: {error}</div>}
      {!data && !error && <div className="loading">集計中…</div>}

      {burn && (
        <div className="burn-warn">
          ⚠ 高バーンレート: {usd(burn.perMin)}/分（残り {burn.remainMin} 分）
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
              { id: 'session', label: 'セッション' },
              { id: 'optimization', label: '最適化' },
            ]}
            activeSection={activeSection}
            onSectionClick={handleSectionClick}
          />
          <section id="section-summary" ref={summaryRef}>
            <SummaryCards s={displayData} prev={prevDisplayData ?? undefined} />
            <OptimizationAdvisor s={displayData} />
            <BudgetProjection s={data!} />
            <BillingBlocks s={data!} />
          </section>
          <section id="section-drivers" ref={driversRef}>
            <CostDrivers s={displayData} />
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
          </section>
          <section id="section-session" ref={sessionRef}>
            <SessionBreakdown s={displayData} />
            <ActivityHeatmap s={data!} />
          </section>
          <section id="section-optimization" ref={optimizationRef}>
            <CacheEfficiency s={displayData} />
            <OverheadAnalysis s={displayData} />
          </section>
          <footer className="foot">
            集計時刻 {new Date(displayData.generatedAt).toLocaleString("ja-JP")} ／ コストは価格表に基づく推定値
          </footer>
        </>
      )}
    </div>
  );
}
