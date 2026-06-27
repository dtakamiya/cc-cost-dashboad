import { useEffect, useMemo, useRef, useState } from "react";
import {
  activeBurnWarning,
  computeDelta,
  computePreviousPeriod,
  fetchSummary,
  filterSummary,
  type DeltaSummary,
  type Period,
  type Summary,
} from "./api";
import { usd } from "./format";
import { SummaryCards } from "./components/SummaryCards";
import { OptimizationAdvisor } from "./components/OptimizationAdvisor";
import { CostDrivers } from "./components/CostDrivers";
import { ModelBreakdown } from "./components/ModelBreakdown";
import { DailyTrend } from "./components/DailyTrend";
import { OverheadAnalysis } from "./components/OverheadAnalysis";
import { PeriodSelector } from "./components/PeriodSelector";
import { BillingBlocks } from "./components/BillingBlocks";
import { BudgetProjection } from "./components/BudgetProjection";
import { ProjectBreakdown } from "./components/ProjectBreakdown";
import { SessionBreakdown } from "./components/SessionBreakdown";
import { ActivityHeatmap } from "./components/ActivityHeatmap";

export default function App() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<Period>('7d');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const inFlight = useRef(false);

  const displayData = useMemo(
    () => (data ? filterSummary(data, period) : null),
    [data, period]
  );

  const delta = useMemo((): DeltaSummary | null => {
    if (!data || !displayData || period === "all") return null;
    const cutoff = displayData.totals.from;
    if (!cutoff) return null;
    const periodDays: Record<Exclude<Period, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };
    const days = periodDays[period as Exclude<Period, "all">];
    const prev = computePreviousPeriod(data.daily, cutoff, days);
    return computeDelta(
      { cost: displayData.totals.cost, tokens: displayData.totals.tokens, sessions: displayData.totals.sessions },
      prev
    );
  }, [data, displayData, period]);

  const burn = data ? activeBurnWarning(data.blocks) : null;

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
    } catch (e) {
      if (!silent) setError(String(e));
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <h1>Claude Code コストダッシュボード</h1>
          <div className="sub">JSONL ログから算出した利用コストの推定値</div>
        </div>
        <div className="topbar-actions">
          {lastUpdated && (
            <span className="last-updated">
              最終更新 {new Date(lastUpdated).toLocaleTimeString("ja-JP")}
            </span>
          )}
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
          <PeriodSelector period={period} onChange={setPeriod} />
          <button className="reload" onClick={() => load(true)} disabled={loading}>
            {loading ? "集計中…" : "再読込"}
          </button>
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
          <SummaryCards s={displayData} delta={delta} />
          <OptimizationAdvisor s={displayData} />
          <BudgetProjection s={data!} />
          <BillingBlocks s={data!} />
          <CostDrivers s={displayData} />
          <div className="grid2">
            <ModelBreakdown s={displayData} />
            <DailyTrend s={displayData} />
          </div>
          <ProjectBreakdown s={displayData} />
          <SessionBreakdown s={displayData} />
          <ActivityHeatmap s={data!} />
          <OverheadAnalysis s={displayData} />
          <footer className="foot">
            集計時刻 {new Date(displayData.generatedAt).toLocaleString("ja-JP")} ／ コストは価格表に基づく推定値
          </footer>
        </>
      )}
    </div>
  );
}
