import type { Summary, SessionCost } from "../api";
import { isBloatedSession } from "../api";
import { usd, compact } from "../format";

function projectName(cwd: string): string {
  return cwd.split(/[\\/]+/).filter(Boolean).pop() ?? cwd;
}

// firstTs〜lastTs を「6/27 14:30」形式の短い期間表記にする。
function periodLabel(s: SessionCost): string {
  if (!s.firstTs) return "—";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const start = fmt(s.firstTs);
  if (!s.lastTs || s.lastTs === s.firstTs) return start;
  return `${start} 〜 ${fmt(s.lastTs)}`;
}

export function SessionBreakdown({ s }: { s: Summary }) {
  if (!s.bySession || s.bySession.length === 0) return null;

  const rows = s.bySession.slice(0, 15);
  const bloatedCount = s.bySession.filter((sess) => isBloatedSession(sess)).length;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>セッション別コスト</h2>
        {bloatedCount > 0 && (
          <span className="badge">肥大化 {bloatedCount} 件</span>
        )}
      </div>
      <p className="sub" style={{ marginTop: 0 }}>
        会話履歴は毎ターン再送されるため、平均コンテキストが大きいセッションほど割高です。
        肥大化したセッションは <code>/clear</code> で新規会話に切り替えるとコストを抑えられます。
      </p>
      <table className="tbl">
        <thead>
          <tr>
            <th>プロジェクト</th>
            <th>コスト</th>
            <th>メッセージ</th>
            <th>平均コンテキスト</th>
            <th>期間</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((sess) => {
            const bloated = isBloatedSession(sess);
            return (
              <tr key={sess.sessionId}>
                <td>
                  {projectName(sess.cwd)}
                  {bloated && <span className="badge">/clear 推奨</span>}
                </td>
                <td>{usd(sess.cost)}</td>
                <td>{sess.messages.toLocaleString("en-US")}</td>
                <td>{compact(Math.round(sess.avgContextPerMsg))}</td>
                <td style={{ color: "var(--muted)", fontSize: 12 }}>{periodLabel(sess)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
