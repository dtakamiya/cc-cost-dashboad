import type { Summary } from "../api";
import { compact, usd } from "../format";

const KB = (b: number) => `${(b / 1024).toFixed(1)} KB`;
const tok = (n: number) => `~${compact(n)} tok`;

function Row({ label, bytes, estimatedTokens }: { label: string; bytes: number; estimatedTokens: number }) {
  return (
    <tr>
      <td>{label}</td>
      <td style={{ textAlign: "right" }}>{KB(bytes)}</td>
      <td style={{ textAlign: "right" }}>{tok(estimatedTokens)}</td>
    </tr>
  );
}

export function OverheadAnalysis({ s }: { s: Summary }) {
  const { overhead, sessionStats, totals } = s;
  const coldStartPct = totals.cost ? sessionStats.coldStartCost / totals.cost : 0;

  return (
    <section className="panel">
      <h2>コンテキストオーバーヘッド分析</h2>
      <div className="drivers">
        {/* システムプロンプト構成 */}
        <div className="driver">
          <div className="driver-title">システムプロンプト推定サイズ（毎セッション注入）</div>
          <div className="driver-body">{tok(overhead.totalEstimatedTokens)}</div>
          <div className="driver-hint">
            {overhead.totalEstimatedTokens > 3000
              ? "3,000 tokens 超過 → 毎セッション cold start コスト高。CLAUDE.md / スキルの削減を検討。"
              : "サイズは適正範囲内。"}
          </div>
          <table className="tbl" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>ファイル</th>
                <th style={{ textAlign: "right" }}>サイズ</th>
                <th style={{ textAlign: "right" }}>推定トークン</th>
              </tr>
            </thead>
            <tbody>
              {overhead.claudeMd && (
                <Row label={overhead.claudeMd.label} bytes={overhead.claudeMd.bytes} estimatedTokens={overhead.claudeMd.estimatedTokens} />
              )}
              {overhead.atRefs.map((r) => (
                <Row key={r.label} label={`@${r.label}`} bytes={r.bytes} estimatedTokens={r.estimatedTokens} />
              ))}
              {overhead.globalPlugins.flatMap((p) =>
                p.files.map((f) => (
                  <Row key={`${p.name}/${f.label}`} label={`[plugin] ${p.name} / ${f.label}`} bytes={f.bytes} estimatedTokens={f.estimatedTokens} />
                ))
              )}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td>合計</td>
                <td />
                <td style={{ textAlign: "right" }}>{tok(overhead.totalEstimatedTokens)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* セッション cold start */}
        <div className="driver">
          <div className="driver-title">セッション cold start（初回キャッシュ書き込み）</div>
          <div className="driver-body">
            平均 {tok(sessionStats.avgColdStartTokens)} / P90 {tok(sessionStats.p90ColdStartTokens)}
          </div>
          <div className="driver-hint">
            セッション開始時にシステムプロンプトをキャッシュ書き込み。
            {sessionStats.avgColdStartTokens > overhead.totalEstimatedTokens * 1.5
              ? " 平均が推定値より大幅に多い → CLAUDE.md 以外に大きなコンテキスト（長い会話引き継ぎ等）が存在。"
              : " 実測と推定値がほぼ一致。"}
          </div>
          <table className="tbl" style={{ marginTop: 10 }}>
            <tbody>
              <tr>
                <td>cold start 合計コスト</td>
                <td style={{ textAlign: "right" }}>{usd(sessionStats.coldStartCost)}</td>
              </tr>
              <tr>
                <td>総コストに占める割合</td>
                <td style={{ textAlign: "right" }}>{(coldStartPct * 100).toFixed(1)}%</td>
              </tr>
              <tr>
                <td>セッション数</td>
                <td style={{ textAlign: "right" }}>{totals.sessions.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>

          {overhead.projectPlugins.length > 0 && (
            <>
              <div className="driver-title" style={{ marginTop: 14 }}>プロジェクトスコープのスキル（参考）</div>
              <div style={{ fontSize: 12, color: "#b5b5c8", marginTop: 4, lineHeight: 1.6 }}>
                {overhead.projectPlugins.map((p) => (
                  <div key={p.name}>
                    <strong>{p.name}</strong>: {p.projectPaths.length} プロジェクト
                  </div>
                ))}
                <div style={{ marginTop: 4, color: "#9090a0" }}>
                  該当プロジェクトでのみ system prompt に追加される。不要ならそのプロジェクトでアンインストール可。
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
