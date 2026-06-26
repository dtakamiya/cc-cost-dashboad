import { useEffect, useMemo, useState } from "react";
import { fetchSummary, filterSummary, type Period, type Summary } from "./api";
import { SummaryCards } from "./components/SummaryCards";
import { CostDrivers } from "./components/CostDrivers";
import { ModelBreakdown } from "./components/ModelBreakdown";
import { DailyTrend } from "./components/DailyTrend";
import { OverheadAnalysis } from "./components/OverheadAnalysis";
import { PeriodSelector } from "./components/PeriodSelector";
import { BillingBlocks } from "./components/BillingBlocks";
import { BudgetProjection } from "./components/BudgetProjection";

export default function App() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<Period>('7d');

  const displayData = useMemo(
    () => (data ? filterSummary(data, period) : null),
    [data, period]
  );

  async function load(reload = false) {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchSummary(reload));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(false);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <h1>Claude Code コストダッシュボード</h1>
          <div className="sub">JSONL ログから算出した利用コストの推定値</div>
        </div>
        <div className="topbar-actions">
          <PeriodSelector period={period} onChange={setPeriod} />
          <button className="reload" onClick={() => load(true)} disabled={loading}>
            {loading ? "集計中…" : "再読込"}
          </button>
        </div>
      </header>

      {error && <div className="error">読み込み失敗: {error}</div>}
      {!data && !error && <div className="loading">集計中…</div>}

      {displayData && (
        <>
          {displayData.warnings.fallbackModels.length > 0 && (
            <div className="warn">
              価格未登録のモデルあり（opus 価格で暫定計算）:{" "}
              {displayData.warnings.fallbackModels.join(", ")}
            </div>
          )}
          <SummaryCards s={displayData} />
          <BudgetProjection s={data!} />
          <BillingBlocks s={data!} />
          <CostDrivers s={displayData} />
          <div className="grid2">
            <ModelBreakdown s={displayData} />
            <DailyTrend s={displayData} />
          </div>
          <OverheadAnalysis s={displayData} />
          <footer className="foot">
            集計時刻 {new Date(displayData.generatedAt).toLocaleString("ja-JP")} ／ コストは価格表に基づく推定値
          </footer>
        </>
      )}
    </div>
  );
}
