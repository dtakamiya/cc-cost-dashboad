import type { Summary, OverheadFile } from "../api";
import { compact, usd } from "../format";

const KB = (b: number) => `${(b / 1024).toFixed(1)} KB`;
const tok = (n: number) => `~${compact(n)} tok`;

function Row({ label, file }: { label: string; file: OverheadFile }) {
  const invokeDelta = file.fullTokens - file.alwaysTokens;
  return (
    <tr>
      <td>{label}</td>
      <td style={{ textAlign: "right" }}>{KB(file.bytes)}</td>
      <td style={{ textAlign: "right" }}>{tok(file.alwaysTokens)}</td>
      <td style={{ textAlign: "right", color: invokeDelta > 0 ? "var(--muted)" : "var(--subtle)" }}>
        {invokeDelta > 0 ? `+${tok(invokeDelta)}` : "—"}
      </td>
    </tr>
  );
}

export function OverheadAnalysis({ s }: { s: Summary }) {
  const { overhead, sessionStats, totals } = s;
  const coldStartPct = totals.cost ? sessionStats.coldStartCost / totals.cost : 0;
  // 実測 cold start − ファイルで説明できる baseline = 未説明の固定コンテキスト（MCP/組込ツール/会話引き継ぎ等）
  const unexplained = Math.max(0, sessionStats.avgColdStartTokens - overhead.totalAlwaysTokens);

  return (
    <section className="panel">
      <h2>コンテキストオーバーヘッド分析</h2>
      <div className="drivers">
        {/* システムプロンプト構成（常時注入の baseline） */}
        <div className="driver">
          <div className="driver-title">システムプロンプト baseline（毎セッション常時注入）</div>
          <div className="driver-body">{tok(overhead.totalAlwaysTokens)}</div>
          <div className="driver-hint">
            {overhead.totalAlwaysTokens > 3000
              ? "3,000 tokens 超過 → 毎セッション cold start コスト高。CLAUDE.md / スキル description の削減を検討。"
              : "baseline は適正範囲内。"}
            {" "}スキルは <strong>name + description のみ</strong>が常時注入され、全文（右列 +tok）は起動時にのみ加算される。
          </div>
          <table className="tbl" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>ファイル</th>
                <th style={{ textAlign: "right" }}>サイズ</th>
                <th style={{ textAlign: "right" }}>常時</th>
                <th style={{ textAlign: "right" }}>起動時</th>
              </tr>
            </thead>
            <tbody>
              {overhead.claudeMd && <Row label={overhead.claudeMd.label} file={overhead.claudeMd} />}
              {overhead.atRefs.map((r) => (
                <Row key={r.label} label={`@${r.label}`} file={r} />
              ))}
              {overhead.globalPlugins.flatMap((p) =>
                p.files.map((f) => (
                  <Row key={`${p.name}/${f.label}`} label={`[plugin] ${p.name} / ${f.label}`} file={f} />
                ))
              )}
              {overhead.personalSkills.map((sk) => (
                <Row key={`personal/${sk.label}`} label={`[skill] ${sk.label}`} file={sk} />
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td>合計</td>
                <td />
                <td style={{ textAlign: "right" }}>{tok(overhead.totalAlwaysTokens)}</td>
                <td style={{ textAlign: "right", color: "var(--muted)" }}>+{tok(overhead.totalInvokeTokens)}</td>
              </tr>
            </tfoot>
          </table>
          <div style={{ fontSize: 11, color: "var(--subtle)", marginTop: 6 }}>
            ※「常時」は frontmatter の name+description を bytes÷4 で近似した値。実注入フォーマットとは厳密一致しない。
          </div>
        </div>

        {/* 未説明の固定コンテキスト + cold start */}
        <div className="driver">
          <div className="driver-title">未説明の固定コンテキスト（MCP / 組込ツール等）</div>
          <div className="driver-body">{tok(unexplained)}</div>
          <div className="driver-hint">
            実測 cold start 平均（{tok(sessionStats.avgColdStartTokens)}）− ファイルで説明できる baseline（{tok(overhead.totalAlwaysTokens)}）の差分。
            MCP ツール定義・組込ツールスキーマ・長い会話引き継ぎ等が主因候補（これらは静的計測対象外）。
          </div>
          {overhead.mcpServers.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, lineHeight: 1.6 }}>
              <strong>MCP サーバ（{overhead.mcpServers.length}）:</strong> {overhead.mcpServers.join(", ")}
              <div style={{ color: "var(--subtle)", marginTop: 2 }}>
                各サーバのツール定義は実行時に注入され、上記差分の主因になりやすい。不要なサーバは無効化を検討。
              </div>
            </div>
          )}

          <div className="driver-title" style={{ marginTop: 14 }}>セッション cold start（初回キャッシュ書き込み）</div>
          <table className="tbl" style={{ marginTop: 6 }}>
            <tbody>
              <tr>
                <td>平均 / P90</td>
                <td style={{ textAlign: "right" }}>
                  {tok(sessionStats.avgColdStartTokens)} / {tok(sessionStats.p90ColdStartTokens)}
                </td>
              </tr>
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
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.6 }}>
                {overhead.projectPlugins.map((p) => (
                  <div key={p.name}>
                    <strong>{p.name}</strong>: {p.projectPaths.length} プロジェクト
                  </div>
                ))}
                <div style={{ marginTop: 4, color: "var(--subtle)" }}>
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
