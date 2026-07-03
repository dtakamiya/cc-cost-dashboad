import type { Summary } from "../api";
import { computeContextBudget } from "../contextBudget";

// 平均1ターンあたりのトークン構成比（常時注入オーバーヘッド／履歴再送／新規入力／生成）を
// 積み上げバーで可視化する。/context 相当の内訳ビュー。
export function ContextBudget({ s }: { s: Summary }) {
  const budget = computeContextBudget(s);
  const { overheadPct, historyPct, inputPct, outputPct, historyDominant } = budget;

  return (
    <section className="panel">
      <h2>コンテキスト予算内訳</h2>
      <div className="drivers">
        <div className="driver">
          <div className="driver-title">1ターンあたりのトークン構成比（近似）</div>
          <div
            role="img"
            aria-label={`常時注入 ${overheadPct.toFixed(0)}%, 履歴再送 ${historyPct.toFixed(0)}%, 新規入力 ${inputPct.toFixed(0)}%, 生成 ${outputPct.toFixed(0)}%`}
            style={{
              display: "flex",
              width: "100%",
              height: 10,
              borderRadius: 4,
              overflow: "hidden",
              marginTop: 10,
            }}
          >
            <div style={{ width: `${overheadPct}%`, background: "var(--red, #ef4444)" }} />
            <div style={{ width: `${historyPct}%`, background: "var(--yellow, #eab308)" }} />
            <div style={{ width: `${inputPct}%`, background: "var(--accent, #6366f1)" }} />
            <div style={{ width: `${outputPct}%`, background: "var(--green, #22c55e)" }} />
          </div>
          <table className="tbl" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>区分</th>
                <th style={{ textAlign: "right" }}>割合</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>常時注入オーバーヘッド</td>
                <td style={{ textAlign: "right" }}>{overheadPct.toFixed(0)}%</td>
              </tr>
              <tr>
                <td>会話履歴の再送</td>
                <td style={{ textAlign: "right" }}>{historyPct.toFixed(0)}%</td>
              </tr>
              <tr>
                <td>新規入力</td>
                <td style={{ textAlign: "right" }}>{inputPct.toFixed(0)}%</td>
              </tr>
              <tr>
                <td>生成</td>
                <td style={{ textAlign: "right" }}>{outputPct.toFixed(0)}%</td>
              </tr>
            </tbody>
          </table>
          {historyDominant && (
            <div className="driver-hint">
              会話履歴の再送がトークン構成の過半を占めています。/clear や新規セッションで履歴再送を減らすと削減余地があります。
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
