import type { Summary } from "../api";
import { compact } from "../format";

export function DuplicateReadBreakdown({ s }: { s: Summary }) {
  const dup = s.duplicateReads;
  if (!dup || dup.totalDuplicateReads === 0) return null;

  const fmt = (value: number) => compact(value);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>同一ファイルの重複Read</h2>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>※近似値（isApprox）</span>
      </div>
      <p style={{ fontSize: 13, margin: "4px 0 12px" }}>
        同一セッション内で同じファイルの2回目以降のReadが {dup.totalDuplicateReads} 回発生し、
        推定 約 {fmt(dup.totalDuplicateTokensApprox)} トークンが重複しています。
        会話が長引いたら /clear で区切り、同一ファイルの再読込を避けてください。
      </p>
      <table className="tbl">
        <thead>
          <tr>
            <th>ファイル</th>
            <th>Read回数</th>
            <th>重複回数</th>
            <th>重複トークン数（近似）</th>
          </tr>
        </thead>
        <tbody>
          {dup.byFile.map((f) => (
            <tr key={f.filePath}>
              <td>{f.filePath}</td>
              <td>{f.readCount}</td>
              <td>{f.duplicateCount}</td>
              <td>{fmt(f.duplicateTokensApprox)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
