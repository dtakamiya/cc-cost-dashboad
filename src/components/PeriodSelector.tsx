import type { Period } from '../api';

const OPTIONS: { value: Period; label: string }[] = [
  { value: '7d',  label: '直近7日' },
  { value: '30d', label: '直近30日' },
  { value: '90d', label: '直近90日' },
  { value: 'all', label: '全期間' },
];

export function PeriodSelector({ period, onChange, compareMode, onCompareChange, canCompare }: {
  period: Period;
  onChange: (p: Period) => void;
  compareMode: boolean;
  onCompareChange: (v: boolean) => void;
  canCompare: boolean;
}) {
  return (
    <>
      <div className="period-selector" role="group" aria-label="表示期間">
        {OPTIONS.map(o => (
          <button
            key={o.value}
            type="button"
            className={period === o.value ? 'active' : ''}
            aria-pressed={period === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="compare-toggle"
        aria-pressed={compareMode}
        disabled={!canCompare}
        onClick={() => onCompareChange(!compareMode)}
        title={canCompare ? "前の同等期間と比較します" : "全期間では前期比較できません"}
      >
        前期比較 {compareMode ? "ON" : "OFF"}
      </button>
    </>
  );
}
