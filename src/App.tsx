import { useEffect, useMemo, useRef, useState } from "react";
import { activeBurnWarning, fetchSummary, filterSummary, filterSummaryByProject, filterPreviousPeriod, subscribeToUpdates, PERIOD_DAYS, type Period, type Summary, fetchHourly } from "./api";
import { usd } from "./format";
import { toHourly, type HourlyDisplay } from "./weekly";
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
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<Period>('7d');
  const [selectedProject, setSelectedProject] = useState("");
  const [compareMode, setCompareMode] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [autoRefreshError, setAutoRefreshError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);
  const [hourlyData, setHourlyData] = useState<HourlyDisplay[]>([]);
  const [hourlyLoading, setHourlyLoading] = useState(false);
  const [hourlyError, setHourlyError] = useState<string | null>(null);
  const [hourlyMetric, setHourlyMetric] = useState<"cost" | "tokens">("cost");
  const inFlight = useRef(false);

  const summaryRef = useRef<HTMLDivElement>(null);
  const driversRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<HTMLDivElement>(null);
  const optimizationRef = useRef<HTMLDivElement>(null);

  const canCompare = period !== 'all';

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

  // 全期間では前期が定義できないため比較モードを自動 OFF にする
  useEffect(() => {
    if (period === 'all') setCompareMode(false);
  }, [period]);

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

  // reload=true で再集計。silent=true のときは全画面ローディングを出さず data だけ差し替える（オートリフレッシュ用）。
  async function load(reload = false, silent = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!silent) setLoading(true);
    try {
      const summary = await fetchSummary(reload);
      setData(summary);
      setLastUpdated(Date.now());
      setError(null);
      setAutoRefreshError(null);
    } catch (e) {
      if (silent) {
        setAutoRefreshError(String(e));
      } else {
        setError(String(e));
      }
    } finally {
      if (!silent) setLoading(false);
      inFlight.current = false;
    }
  }

  useEffect(() => {
    load(false);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => load(true, true), 30_000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  // SSE でファイル変更を受信したら自動リロード
  useEffect(() => {
    if (!autoRefresh) return;
    const unsubscribe = subscribeToUpdates(() => {
      load(false, true);
    });
    return unsubscribe;
  }, [autoRefresh]);

  // Hourly データ取得
  useEffect(() => {
    (async () => {
      try {
        setHourlyLoading(true);
        setHourlyError(null);
        const hourlyList = await fetchHourly();
        const transformed = toHourly(hourlyList);
        setHourlyData(transformed);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        setHourlyError(errMsg);
      } finally {
        setHourlyLoading(false);
      }
    })();
  }, []);

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
            <button className="reload" onClick={() => load(true)} disabled={loading}>
              {loading ? "集計中…" : "再読込"}
            </button>
          </div>
        </div>
      </header>

      {error && <div className="error">読み込み失敗: {error}</div>}
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
            {hourlyLoading ? (
              <div className="panel">読み込み中...</div>
            ) : hourlyError ? (
              <div className="panel error">エラー: {hourlyError}</div>
            ) : hourlyData.length > 0 ? (
              <HourlyTrend
                data={hourlyData}
                metric={hourlyMetric}
                onMetricChange={setHourlyMetric}
              />
            ) : null}
            <div className="grid2">
              <ModelBreakdown s={displayData} />
              <DailyTrend
                s={displayData}
                prev={prevDisplayData ?? undefined}
                prevOffsetDays={canCompare ? PERIOD_DAYS[period as Exclude<Period, 'all'>] : undefined}
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
