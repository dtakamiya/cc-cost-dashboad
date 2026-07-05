import type { Summary } from "../api";
import { compact, usd } from "../format";

const tok = (n: number) => `~${compact(n)} tok`;

// キャッシュ TTL 損益分岐パネル。
// - ROI: 読み込み節約額 − 書き込みコスト（黒字/赤字を色分け）
// - TTL 内訳: 1h vs 5m の書き込みトークン/コスト
// - 1h プレミアム: 2倍書き込みによる超過コスト（5m 比）
export function CacheEfficiency({ s }: { s: Summary }) {
  const cs = s.cacheStats;
  // 古い API レスポンス（cacheStats 未提供）でもダッシュボード全体を巻き込まないよう描画をスキップ。
  if (!cs) return null;
  const gs = s.cacheGapStats;
  const ms = s.modelSwitch;
  const ub = s.unexplainedCacheBust;
  const hasBustBreakdown = Boolean(gs) && Boolean(ms) && Boolean(ub);
  const roiPositive = cs.roiNet >= 0;
  const roiColor = roiPositive ? "var(--green, #22c55e)" : "var(--red, #ef4444)";
  const totalCreate = cs.create1hTokens + cs.create5mTokens;
  const pct1h = totalCreate > 0 ? (cs.create1hTokens / totalCreate) * 100 : 0;

  return (
    <section className="panel">
      <h2>キャッシュ TTL 損益分岐</h2>
      <div className="drivers">
        {/* キャッシュ ROI */}
        <div className="driver">
          <div className="driver-title">キャッシュ ROI（読み込み節約 − 書き込みコスト）</div>
          <div className="driver-body" style={{ color: roiColor }}>
            {roiPositive ? "+" : ""}{usd(cs.roiNet)}
          </div>
          <div className="driver-hint">
            {roiPositive
              ? "キャッシュ書き込みコストを読み込み節約で回収できている（黒字）。"
              : "書き込みコストが読み込み節約を上回っている（赤字）。同一作業を同セッションで継続し再利用を増やす。"}
          </div>
          <table className="tbl" style={{ marginTop: 10 }}>
            <tbody>
              <tr>
                <td>読み込み節約額</td>
                <td style={{ textAlign: "right", color: "var(--green, #22c55e)" }}>+{usd(cs.readSavings)}</td>
              </tr>
              <tr>
                <td>書き込みコスト</td>
                <td style={{ textAlign: "right", color: "var(--red, #ef4444)" }}>−{usd(cs.writeCost)}</td>
              </tr>
              <tr style={{ fontWeight: 600 }}>
                <td>純益</td>
                <td style={{ textAlign: "right", color: roiColor }}>{roiPositive ? "+" : ""}{usd(cs.roiNet)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* TTL 内訳と 1h プレミアム */}
        <div className="driver">
          <div className="driver-title">TTL 内訳（1h vs 5m 書き込み）</div>
          <div className="driver-body">{pct1h.toFixed(0)}% が 1h</div>
          <div className="driver-hint">
            2026年に TTL が 60分→5分へ短縮。1h キャッシュは書き込みが 2倍（5m は 1.25倍）のため、
            再利用が少ないと 2倍プレミアムが無駄になりやすい。
          </div>
          <table className="tbl" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>TTL</th>
                <th style={{ textAlign: "right" }}>書き込みトークン</th>
                <th style={{ textAlign: "right" }}>書き込みコスト</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1h（×2）</td>
                <td style={{ textAlign: "right" }}>{tok(cs.create1hTokens)}</td>
                <td style={{ textAlign: "right" }}>{usd(cs.write1hCost)}</td>
              </tr>
              <tr>
                <td>5m（×1.25）</td>
                <td style={{ textAlign: "right" }}>{tok(cs.create5mTokens)}</td>
                <td style={{ textAlign: "right" }}>{usd(cs.write5mCost)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td>1h プレミアム（5m 比超過）</td>
                <td />
                <td style={{ textAlign: "right", color: cs.premium1h > 0 ? "var(--yellow, #eab308)" : "var(--muted)" }}>
                  {cs.premium1h > 0 ? usd(cs.premium1h) : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {gs && gs.expiredGapCount > 0 && (
          <div className="driver">
            <div className="driver-title">アイドル失効による再書き込み</div>
            <div className="driver-body" style={{ color: "var(--yellow, #eab308)" }}>
              {gs.expiredGapCount} 回
            </div>
            <div className="driver-hint">
              セッション内で5分キャッシュTTLを超える中断があると、次のメッセージでキャッシュが失効し、
              cache read で済むはずの文脈が cache creation として再課金される。
              作業を連続化するか、重要なコンテキストは1h TTLで保護する。
            </div>
            <table className="tbl" style={{ marginTop: 10 }}>
              <tbody>
                <tr>
                  <td>失効ギャップ発生回数</td>
                  <td style={{ textAlign: "right" }}>{gs.expiredGapCount} 回</td>
                </tr>
                <tr>
                  <td>再書き込みトークン</td>
                  <td style={{ textAlign: "right" }}>{tok(gs.reWriteTokens)}</td>
                </tr>
                <tr style={{ fontWeight: 600 }}>
                  <td>推定超過コスト</td>
                  <td style={{ textAlign: "right", color: "var(--red, #ef4444)" }}>
                    −{usd(gs.reWriteCost)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {ub && ub.bustCount > 0 && (
          <div className="driver">
            <div className="driver-title">原因不明のキャッシュ再作成</div>
            <div className="driver-body" style={{ color: "var(--yellow, #eab308)" }}>
              {ub.bustCount} 回
            </div>
            <div className="driver-hint">
              モデル切替・アイドルギャップのいずれにも該当しないキャッシュ再作成。
              セッション途中のMCP/設定変更やツール構成の変化が原因の可能性がある。
            </div>
            <table className="tbl" style={{ marginTop: 10 }}>
              <tbody>
                <tr>
                  <td>発生回数</td>
                  <td style={{ textAlign: "right" }}>{ub.bustCount} 回</td>
                </tr>
                <tr>
                  <td>再作成トークン</td>
                  <td style={{ textAlign: "right" }}>{tok(ub.reCreateTokens)}</td>
                </tr>
                <tr style={{ fontWeight: 600 }}>
                  <td>推定超過コスト</td>
                  <td style={{ textAlign: "right", color: "var(--red, #ef4444)" }}>
                    −{usd(ub.reCreateCost)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {hasBustBreakdown && (
          <div className="driver">
            <div className="driver-title">バスト原因の内訳</div>
            <div className="driver-hint">
              キャッシュ再作成コストの発生要因を、判明している原因（モデル切替・アイドル失効）と
              原因不明に分けて内訳表示する。
            </div>
            <table className="tbl" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>原因</th>
                  <th style={{ textAlign: "right" }}>発生回数</th>
                  <th style={{ textAlign: "right" }}>超過コスト</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>モデル切替</td>
                  <td style={{ textAlign: "right" }}>{ms ? ms.switchCount : 0} 回</td>
                  <td style={{ textAlign: "right" }}>{usd(ms ? ms.reCreateCost : 0)}</td>
                </tr>
                <tr>
                  <td>アイドル失効</td>
                  <td style={{ textAlign: "right" }}>{gs ? gs.expiredGapCount : 0} 回</td>
                  <td style={{ textAlign: "right" }}>{usd(gs ? gs.reWriteCost : 0)}</td>
                </tr>
                <tr>
                  <td>原因不明</td>
                  <td style={{ textAlign: "right" }}>{ub ? ub.bustCount : 0} 回</td>
                  <td style={{ textAlign: "right" }}>{usd(ub ? ub.reCreateCost : 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
