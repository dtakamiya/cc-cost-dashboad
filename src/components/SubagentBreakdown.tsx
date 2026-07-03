import type { Summary } from "../api";
import { compact, usd } from "../format";

const tok = (n: number) => `~${compact(n)} tok`;

// サブエージェント（isSidechain）委譲のトークン/コスト内訳。
// - 比率バー: main / subagent の2色で構成比を可視化
// - テーブル: 絶対トークン数・コスト（USD）
export function SubagentBreakdown({ s }: { s: Summary }) {
  const ss = s.subagentStats;
  // 古い API レスポンス（subagentStats 未提供）でもダッシュボード全体を巻き込まないよう描画をスキップ。
  if (!ss) return null;
  const subagentPct = ss.subagentRatio * 100;
  const mainPct = 100 - subagentPct;

  return (
    <section className="panel">
      <h2>サブエージェント委譲比率</h2>
      <div className="drivers">
        <div className="driver">
          <div className="driver-title">サブエージェント委譲比率（トークン基準）</div>
          <div className="driver-body">{subagentPct.toFixed(0)}%</div>
          <div className="driver-hint">
            サブエージェントは独立コンテキストで動作するため、フォーカスタスクではトークン削減に寄与しやすい。
            一方で起動オーバーヘッドがあるため、小タスクへの多用は逆効果になりうる。
          </div>
          <div
            role="img"
            aria-label={`main ${mainPct.toFixed(0)}%, subagent ${subagentPct.toFixed(0)}%`}
            style={{
              display: "flex",
              width: "100%",
              height: 10,
              borderRadius: 4,
              overflow: "hidden",
              marginTop: 10,
            }}
          >
            <div style={{ width: `${mainPct}%`, background: "var(--accent, #6366f1)" }} />
            <div style={{ width: `${subagentPct}%`, background: "var(--yellow, #eab308)" }} />
          </div>
          <table className="tbl" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>区分</th>
                <th style={{ textAlign: "right" }}>トークン</th>
                <th style={{ textAlign: "right" }}>コスト</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>メインスレッド</td>
                <td style={{ textAlign: "right" }}>{tok(ss.mainTokens)}</td>
                <td style={{ textAlign: "right" }}>{usd(ss.mainCost)}</td>
              </tr>
              <tr>
                <td>サブエージェント</td>
                <td style={{ textAlign: "right" }}>{tok(ss.subagentTokens)}</td>
                <td style={{ textAlign: "right" }}>{usd(ss.subagentCost)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
