import type { Period } from '../api';

const OPTIONS: { value: Period; label: string }[] = [
  { value: '7d',  label: '直近7日' },
  { value: '30d', label: '直近30日' },
  { value: '90d', label: '直近90日' },
  { value: 'all', label: '全期間' },
];

export function PeriodSelector({ period, onChange }: {
  period: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div className="period-selector">
      {OPTIONS.map(o => (
        <button
          key={o.value}
          className={period === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
