import { useEffect, useState } from "react";
import { fetchSummary, type Summary } from "./api";
import { SummaryCards } from "./components/SummaryCards";
import { CostDrivers } from "./components/CostDrivers";
import { ModelBreakdown } from "./components/ModelBreakdown";
import { DailyTrend } from "./components/DailyTrend";
import { OverheadAnalysis } from "./components/OverheadAnalysis";

export default function App() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        <h1>Claude Code コストダッシュボード</h1>
        <button onClick={() => load(true)} disabled={loading}>
          {loading ? "集計中…" : "再読込"}
        </button>
      </header>

      {error && <div className="error">読み込み失敗: {error}</div>}
      {!data && !error && <div className="loading">集計中…</div>}

      {data && (
        <>
          {data.warnings.fallbackModels.length > 0 && (
            <div className="warn">
              価格未登録のモデルあり（opus 価格で暫定計算）:{" "}
              {data.warnings.fallbackModels.join(", ")}
            </div>
          )}
          <SummaryCards s={data} />
          <CostDrivers s={data} />
          <div className="grid2">
            <ModelBreakdown s={data} />
            <DailyTrend s={data} />
          </div>
          <OverheadAnalysis s={data} />
          <footer className="foot">
            集計時刻 {new Date(data.generatedAt).toLocaleString("ja-JP")} ／ コストは価格表に基づく推定値
          </footer>
        </>
      )}
    </div>
  );
}
