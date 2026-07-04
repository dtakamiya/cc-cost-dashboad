import type { Summary } from "../api";
import { compact } from "../format";

export function ToolResultOutliers({ s }: { s: Summary }) {
  const outliers = s.toolResultOutliers;
  if (!outliers || outliers.overCount === 0) return null;

  const fmt = (value: number) => compact(value);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>ツール出力の上限超過（tool_result）</h2>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>※近似値（isApprox）</span>
      </div>
      <p style={{ fontSize: 13, margin: "4px 0 12px" }}>
        {outliers.overCount} 件の tool_result が推奨上限を超過（最大 約 {fmt(outliers.maxTokensApprox)} トークン、
        超過分合計 約 {fmt(outliers.totalOverTokensApprox)} トークン）。
        MAX_MCP_OUTPUT_TOKENS / BASH_MAX_OUTPUT_LENGTH の設定を検討してください。
      </p>
      <table className="tbl">
        <thead>
          <tr>
            <th>ツール</th>
            <th>超過件数</th>
            <th>最大トークン数（近似）</th>
          </tr>
        </thead>
        <tbody>
          {outliers.byTool.map((t) => (
            <tr key={t.toolName}>
              <td>{t.toolName}</td>
              <td>{t.overCount}</td>
              <td>{fmt(t.maxTokensApprox)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {outliers.sampleSessions.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, margin: "12px 0 4px" }}>該当セッション（近似値）</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>セッション</th>
                <th>ツール</th>
                <th>トークン数（近似）</th>
              </tr>
            </thead>
            <tbody>
              {outliers.sampleSessions.map((sess, i) => (
                <tr key={`${sess.sessionId}-${i}`}>
                  <td>{sess.sessionId}</td>
                  <td>{sess.toolName}</td>
                  <td>{fmt(sess.tokensApprox)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
