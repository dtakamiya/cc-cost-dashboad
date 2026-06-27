import { useState } from "react";
import type { Summary, SessionCost } from "../api";
import { isBloatedSession } from "../api";
import { usd, compact } from "../format";
import { buildClearCommand } from "../clearCommand";

function projectName(cwd: string): string {
  return cwd.split(/[\\/]+/).filter(Boolean).pop() ?? cwd;
}

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

function CopyButton({ cwd }: { cwd: string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(buildClearCommand(cwd));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable or denied — button remains inert.
    }
  };

  return (
    <button
      onClick={handleClick}
      style={{
        marginLeft: 6,
        padding: "1px 6px",
        fontSize: 11,
        cursor: "pointer",
        background: copied ? "var(--green, #22c55e)" : "var(--accent, #3b82f6)",
        color: "#fff",
        border: "none",
        borderRadius: 4,
        whiteSpace: "nowrap",
      }}
      title={buildClearCommand(cwd)}
    >
      {copied ? "コピー済み ✓" : "clear コピー"}
    </button>
  );
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
                  {bloated && (
                    <>
                      <span className="badge">/clear 推奨</span>
                      <CopyButton cwd={sess.cwd} />
                    </>
                  )}
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
