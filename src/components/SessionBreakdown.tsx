import { useState, useRef } from "react";
import type { Summary, SessionCost, SessionTurn } from "../api";
import { isBloatedSession, fetchSessionTurns, filterSessions } from "../api";
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

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

function TurnsDetail({ turns, loading }: { turns: SessionTurn[] | null; loading: boolean }) {
  if (loading) {
    return <div style={{ padding: "8px 12px", color: "var(--muted)", fontSize: 13 }}>読み込み中…</div>;
  }
  if (!turns || turns.length === 0) {
    return <div style={{ padding: "8px 12px", color: "var(--muted)", fontSize: 13 }}>ターンデータなし</div>;
  }

  const maxCost = Math.max(...turns.map((t) => t.cost), 0.0001);

  return (
    <div style={{ padding: "8px 12px" }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
        会話ターン別トークン消費（{turns.length} ターン）
      </div>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--muted)" }}>
            <th style={{ textAlign: "left", fontWeight: "normal", paddingBottom: 4 }}>#</th>
            <th style={{ textAlign: "right", fontWeight: "normal", paddingBottom: 4 }}>入力</th>
            <th style={{ textAlign: "right", fontWeight: "normal", paddingBottom: 4 }}>出力</th>
            <th style={{ textAlign: "right", fontWeight: "normal", paddingBottom: 4 }}>キャッシュR</th>
            <th style={{ textAlign: "right", fontWeight: "normal", paddingBottom: 4 }}>コスト</th>
            <th style={{ paddingBottom: 4, paddingLeft: 8, width: "35%" }}></th>
          </tr>
        </thead>
        <tbody>
          {turns.map((turn, i) => (
            <tr key={i} style={{ borderTop: "1px solid var(--border, #e5e7eb)" }}>
              <td style={{ padding: "3px 4px", color: "var(--muted)" }}>{i + 1}</td>
              <td style={{ padding: "3px 4px", textAlign: "right" }}>{compact(turn.input)}</td>
              <td style={{ padding: "3px 4px", textAlign: "right" }}>{compact(turn.output)}</td>
              <td style={{ padding: "3px 4px", textAlign: "right" }}>{compact(turn.cacheRead)}</td>
              <td style={{ padding: "3px 4px", textAlign: "right" }}>{usd(turn.cost)}</td>
              <td style={{ padding: "3px 4px 3px 8px" }}>
                <div
                  style={{
                    height: 10,
                    width: `${Math.round((turn.cost / maxCost) * 100)}%`,
                    background: "var(--accent, #3b82f6)",
                    borderRadius: 2,
                    minWidth: turn.cost > 0 ? 2 : 0,
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SessionBreakdown({ s }: { s: Summary }) {
  const [cwdFilter, setCwdFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [turnsData, setTurnsData] = useState<SessionTurn[] | null>(null);
  const [turnsLoading, setTurnsLoading] = useState(false);
  // ref でインフライトリクエストのsessionIdを追跡し、古いレスポンスを破棄する
  const requestedIdRef = useRef<string | null>(null);

  if (!s.bySession || s.bySession.length === 0) return null;

  const filtered = filterSessions(s.bySession, cwdFilter, modelFilter);
  const rows = filtered.slice(0, 15);
  const bloatedCount = s.bySession.filter((sess) => isBloatedSession(sess)).length;

  const handleToggle = async (sessionId: string) => {
    if (requestedIdRef.current === sessionId) {
      requestedIdRef.current = null;
      setExpandedId(null);
      setTurnsData(null);
      return;
    }
    requestedIdRef.current = sessionId;
    setExpandedId(sessionId);
    setTurnsData(null);
    setTurnsLoading(true);
    try {
      const turns = await fetchSessionTurns(sessionId);
      if (requestedIdRef.current === sessionId) setTurnsData(turns);
    } catch {
      if (requestedIdRef.current === sessionId) setTurnsData([]);
    } finally {
      if (requestedIdRef.current === sessionId) setTurnsLoading(false);
    }
  };

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
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="プロジェクト名で絞り込み…"
          value={cwdFilter}
          onChange={(e) => setCwdFilter(e.target.value)}
          style={{
            flex: 1,
            minWidth: 150,
            padding: "4px 8px",
            fontSize: 13,
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: 4,
            background: "var(--bg, #fff)",
            color: "var(--fg, #111)",
          }}
        />
        <input
          type="text"
          placeholder="モデル名で絞り込み…"
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          style={{
            flex: 1,
            minWidth: 150,
            padding: "4px 8px",
            fontSize: 13,
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: 4,
            background: "var(--bg, #fff)",
            color: "var(--fg, #111)",
          }}
        />
        {(cwdFilter || modelFilter) && (
          <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>
            {filtered.length} 件
          </span>
        )}
      </div>
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
            const isExpanded = expandedId === sess.sessionId;
            return (
              <>
                <tr
                  key={sess.sessionId}
                  style={{
                    background: isExpanded ? "var(--hover-bg, rgba(59,130,246,0.06))" : undefined,
                  }}
                >
                  <td>
                    <button
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? "詳細を折りたたむ" : "詳細を展開"}
                      onClick={() => handleToggle(sess.sessionId)}
                      style={{
                        marginRight: 6,
                        padding: "1px 4px",
                        fontSize: 10,
                        cursor: "pointer",
                        background: "none",
                        border: "1px solid var(--border, #e5e7eb)",
                        borderRadius: 3,
                        color: "var(--muted)",
                        lineHeight: 1,
                      }}
                    >
                      {isExpanded ? "▼" : "▶"}
                    </button>
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
                {isExpanded && (
                  <tr key={`${sess.sessionId}-turns`}>
                    <td
                      colSpan={5}
                      style={{
                        padding: 0,
                        background: "var(--surface, #f9fafb)",
                        borderBottom: "1px solid var(--border, #e5e7eb)",
                      }}
                    >
                      <TurnsDetail turns={turnsData} loading={turnsLoading} />
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
