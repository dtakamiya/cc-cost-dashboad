import type { Summary } from "../api";
import { Icon } from "./icons/Icon";

interface DataQualityBadgeProps {
  source: Summary["source"];
}

/** ソースの詳細（スキップ行数など）を組み立てる。問題がなければ「完全」を返す。 */
function buildDetail(source: NonNullable<Summary["source"]>): string {
  const parts: string[] = [];
  if ((source.skippedLines ?? 0) > 0) parts.push(`スキップ: ${source.skippedLines} 行`);
  if ((source.parseErrors ?? 0) > 0) parts.push(`パースエラー: ${source.parseErrors}`);
  if ((source.unreadableFiles ?? 0) > 0) parts.push(`読込失敗: ${source.unreadableFiles} ファイル`);
  return parts.length > 0 ? parts.join(" / ") : "完全";
}

/** 最終更新時刻の横に表示する、データ品質の小さなバッジ。詳細はネイティブツールチップで示す。 */
export function DataQualityBadge({ source }: DataQualityBadgeProps) {
  if (source?.parsedLines === undefined) return null;

  return (
    <span className="data-quality-badge" title={buildDetail(source)}>
      <Icon name="check" size={12} />
      データ品質: 正常
    </span>
  );
}
