import type { Summary } from "../api";
import { compact } from "../format";

/**
 * 探索系ツール（Grep/Glob/WebSearch/WebFetch）のtool_result比率が高いセッションを一覧表示する。
 * 曖昧なプロンプト（"Fix the bug"等）はコードベース全体の当てずっぽうな探索を招き、探索系ツールの
 * tool_resultがコンテキストに累積・再送されてトークンを浪費する。このコンポーネントは可視化専用の
 * 近似値（isApprox）を表示するのみで、totalCost/totalTokensの計算には一切関与しない。
 */
export function ExplorationBreakdown({ s }: { s: Summary }) {
  const heavySessions = s.exploration?.heavySessions ?? [];
  if (heavySessions.length === 0) return null;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>探索系ツール偏重セッション</h2>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>※近似値（isApprox）</span>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th scope="col">セッション</th>
            <th scope="col">プロジェクト</th>
            <th scope="col">探索トークン数（近似）</th>
            <th scope="col">探索比率</th>
          </tr>
        </thead>
        <tbody>
          {heavySessions.map((h) => (
            <tr key={h.sessionId}>
              <td>{h.sessionId}</td>
              <td>{h.cwd}</td>
              <td>{compact(h.explorationTokensApprox)}</td>
              <td>{(h.explorationRatio * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
