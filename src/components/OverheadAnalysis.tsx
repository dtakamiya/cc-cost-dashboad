import type { Summary, OverheadFile, McpServerOverhead } from "../api";
import {
  OVERHEAD_FILE_WARN_TOKENS,
  OVERHEAD_FILE_CAUTION_TOKENS,
  calculateOverheadStatus,
  rankFilesByImpact,
} from "../advisor";
import { compact, usd } from "../format";
import { OverheadGauge } from "./OverheadGauge";

const KB = (b: number) => `${(b / 1024).toFixed(1)} KB`;
const tok = (n: number) => `~${compact(n)} tok`;

type EfficiencyLevel = "good" | "caution" | "warn";

function efficiencyLevel(alwaysTokens: number): EfficiencyLevel {
  if (alwaysTokens > OVERHEAD_FILE_WARN_TOKENS) return "warn";
  if (alwaysTokens > OVERHEAD_FILE_CAUTION_TOKENS) return "caution";
  return "good";
}

const BADGE: Record<EfficiencyLevel, { label: string; color: string }> = {
  good:    { label: "✓ 良好",      color: "var(--green, #22c55e)" },
  caution: { label: "△ 要注意",    color: "var(--yellow, #eab308)" },
  warn:    { label: "✗ 最適化推奨", color: "var(--red, #ef4444)" },
};

function Row({
  label,
  file,
  monthlyCost,
}: {
  label: string;
  file: OverheadFile;
  monthlyCost: number;
}) {
  const invokeDelta = file.fullTokens - file.alwaysTokens;
  const level = efficiencyLevel(file.alwaysTokens);
  const badge = BADGE[level];
  return (
    <tr>
      <td>{label}</td>
      <td style={{ textAlign: "right" }}>{KB(file.bytes)}</td>
      <td style={{ textAlign: "right" }}>{tok(file.alwaysTokens)}</td>
      <td style={{ textAlign: "right", color: invokeDelta > 0 ? "var(--muted)" : "var(--subtle)" }}>
        {invokeDelta > 0 ? `+${tok(invokeDelta)}` : "—"}
      </td>
      <td style={{ textAlign: "right", fontSize: 11, color: "var(--muted)" }}>
        {monthlyCost > 0.001 ? usd(monthlyCost) + "/月" : "—"}
      </td>
      <td style={{ textAlign: "right", fontSize: 11, color: badge.color, whiteSpace: "nowrap" }}>
        {badge.label}
      </td>
    </tr>
  );
}

function McpRow({ server, monthlyCost }: { server: McpServerOverhead; monthlyCost: number }) {
  const isUnknown = server.estimatedTokens === null;
  return (
    <tr>
      <td>{server.name}</td>
      <td style={{ textAlign: "right" }}>
        {isUnknown ? "推定不可" : tok(server.estimatedTokens as number)}
      </td>
      <td style={{ textAlign: "right", fontSize: 11, color: "var(--muted)" }}>
        {!isUnknown && monthlyCost > 0.001 ? usd(monthlyCost) + "/月" : "—"}
      </td>
      <td style={{ textAlign: "right", fontSize: 11, color: "var(--subtle)" }}>
        {server.source === "estimated" ? "※推定" : server.source === "unknown" ? "推定不可" : "実測"}
      </td>
    </tr>
  );
}

export function OverheadAnalysis({ s }: { s: Summary }) {
  const { overhead, sessionStats, totals } = s;
  const coldStartPct = totals.cost ? sessionStats.coldStartCost / totals.cost : 0;
  // 実測 cold start − ファイルで説明できる baseline = 未説明の固定コンテキスト（MCP/組込ツール/会話引き継ぎ等）
  const unexplained = Math.max(0, sessionStats.avgColdStartTokens - overhead.totalAlwaysTokens);

  // ファイル別月間コスト換算: alwaysTokens × cacheCreateRate × sessions × (30/periodDays)
  const cacheCreateRate = s.tokenSplit.cacheCreate > 0
    ? s.costSplit.cacheWrite / s.tokenSplit.cacheCreate
    : 0;
  const periodDays = (() => {
    const from = s.totals.from ? Date.parse(s.totals.from + "T00:00:00Z") : NaN;
    const to = s.totals.to ? Date.parse(s.totals.to + "T00:00:00Z") : NaN;
    if (Number.isNaN(from) || Number.isNaN(to)) return 1;
    return Math.max(1, Math.round((to - from) / 86_400_000) + 1);
  })();
  const monthlyFactor = 30 / periodDays;
  const fileMonthlyCost = (alwaysTokens: number) =>
    alwaysTokens * cacheCreateRate * s.totals.sessions * monthlyFactor;

  const overheadStatus = calculateOverheadStatus(overhead.totalAlwaysTokens);
  const impacts = rankFilesByImpact(s, cacheCreateRate, s.totals.sessions, monthlyFactor);
  const topImpacts = impacts.slice(0, 3);

  return (
    <section className="panel">
      <h2>コンテキストオーバーヘッド分析</h2>
      <div className="drivers">
        {/* 削減達成度ゲージ */}
        <div className="driver">
          <div className="driver-title">削減達成度ゲージ</div>
          <div className="driver-hint">
            現在の常時注入トークン数と目標値の比較。目標: 1,500 tok 以下が理想的。
          </div>
          <OverheadGauge status={overheadStatus} />
        </div>

        {/* ファイルインパクトランキング */}
        {topImpacts.length > 0 && (
          <div className="driver">
            <div className="driver-title">ファイルインパクト Top {topImpacts.length}（削減効果順）</div>
            <div className="driver-hint">
              削除または縮小した場合の月間推定節約額が大きい順。
            </div>
            <div className="impact-ranking">
              {topImpacts.map((item) => (
                <div key={item.label} className={`impact-item rank-${item.rank}`}>
                  <span className="rank-badge">#{item.rank}</span>
                  <span className="label">{item.label}</span>
                  <span className="savings">
                    {item.monthlySavings > 0.001 ? usd(item.monthlySavings) + "/月" : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

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
                <th style={{ textAlign: "right" }}>月間コスト（除外時削減）</th>
                <th style={{ textAlign: "right" }}>評価</th>
              </tr>
            </thead>
            <tbody>
              {impacts.map((item) => {
                // source メタデータから元の OverheadFile を引き当てる
                let file: OverheadFile | undefined;
                const source = item.source;
                if (source.kind === "claudeMd") {
                  file = overhead.claudeMd || undefined;
                } else if (source.kind === "atRef") {
                  file = overhead.atRefs.find((r) => r.label === source.label);
                } else if (source.kind === "plugin") {
                  const plugin = overhead.globalPlugins.find((p) => p.name === source.pluginName);
                  file = plugin?.files.find((f) => f.label === source.label);
                } else if (source.kind === "skill") {
                  file = overhead.personalSkills.find((sk) => sk.label === source.label);
                }
                if (!file) return null;
                return (
                  <Row
                    key={item.label}
                    label={item.label}
                    file={file}
                    monthlyCost={fileMonthlyCost(file.alwaysTokens)}
                  />
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td>合計</td>
                <td />
                <td style={{ textAlign: "right" }}>{tok(overhead.totalAlwaysTokens)}</td>
                <td style={{ textAlign: "right", color: "var(--muted)" }}>+{tok(overhead.totalInvokeTokens)}</td>
                <td />
                <td />
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
          {overhead.mcpServers.length > 0 && (() => {
            const mcpTotalTokens = overhead.mcpServers.reduce((sum, m) => sum + (m.estimatedTokens ?? 0), 0);
            const estimatedServers = overhead.mcpServers.filter((m) => m.estimatedTokens !== null);
            const perServerTokens = estimatedServers.length > 0 ? mcpTotalTokens / estimatedServers.length : 0;
            return (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                  <strong>MCP サーバ（{overhead.mcpServers.length}）</strong>
                </div>
                <table className="tbl" style={{ marginTop: 6 }}>
                  <thead>
                    <tr>
                      <th>サーバ</th>
                      <th style={{ textAlign: "right" }}>推定トークン</th>
                      <th style={{ textAlign: "right" }}>月間コスト</th>
                      <th style={{ textAlign: "right" }}>根拠</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overhead.mcpServers.map((server) => (
                      <McpRow
                        key={server.name}
                        server={server}
                        monthlyCost={fileMonthlyCost(server.estimatedTokens ?? 0)}
                      />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 600 }}>
                      <td>合計</td>
                      <td style={{ textAlign: "right" }}>{tok(mcpTotalTokens)}</td>
                      <td style={{ textAlign: "right", fontSize: 11, color: "var(--muted)" }}>
                        {usd(fileMonthlyCost(mcpTotalTokens))}/月
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
                <div style={{ fontSize: 11, color: "var(--subtle)", marginTop: 4 }}>
                  ※ MCPツール定義は実行時依存で静的計測できないため、保守的な既定値（サーバ1件あたり約{tok(perServerTokens)}）で推定。不要なサーバは無効化を検討。
                </div>
              </div>
            );
          })()}

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
