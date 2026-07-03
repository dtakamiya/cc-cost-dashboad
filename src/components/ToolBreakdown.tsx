import type { Summary } from "../api";

// Agent（サブエージェント）/ Skill 呼び出しの件数集計。
// コスト紐付け（tool_use と usage トークンの対応）は行わない（YAGNI、別issue）。
export function ToolBreakdown({ s }: { s: Summary | null }) {
  const ts = s?.toolStats;
  const hasData = !!ts && (ts.agentCount > 0 || ts.skillCount > 0);

  if (!hasData) {
    return (
      <section className="panel">
        <h2>ツール呼び出し内訳</h2>
        <p className="sub">ツール呼び出しのデータがありません。</p>
      </section>
    );
  }

  const subagentEntries = Object.entries(ts.bySubagentType).sort((a, b) => b[1] - a[1]);
  const skillEntries = Object.entries(ts.bySkill).sort((a, b) => b[1] - a[1]);

  return (
    <section className="panel">
      <h2>ツール呼び出し内訳</h2>
      <p className="sub" style={{ marginTop: 0 }}>
        Agent（サブエージェント委譲）と Skill の呼び出し件数の内訳です。
      </p>
      <div className="drivers">
        <div className="driver">
          <div className="driver-title">Agent 呼び出し件数</div>
          <div className="driver-body">{ts.agentCount}</div>
        </div>
        <div className="driver">
          <div className="driver-title">Skill 呼び出し件数</div>
          <div className="driver-body">{ts.skillCount}</div>
        </div>
      </div>

      {subagentEntries.length > 0 && (
        <table className="tbl" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>subagentType</th>
              <th style={{ textAlign: "right" }}>件数</th>
            </tr>
          </thead>
          <tbody>
            {subagentEntries.map(([type, count]) => (
              <tr key={type}>
                <td>{type}</td>
                <td style={{ textAlign: "right" }}>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {skillEntries.length > 0 && (
        <table className="tbl" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>skill</th>
              <th style={{ textAlign: "right" }}>件数</th>
            </tr>
          </thead>
          <tbody>
            {skillEntries.map(([skill, count]) => (
              <tr key={skill}>
                <td>{skill}</td>
                <td style={{ textAlign: "right" }}>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
