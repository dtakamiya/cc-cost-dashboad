import { useState, useEffect } from 'react';
import { isDateRange, type Period, type FixedPeriod } from '../api';

const OPTIONS: { value: FixedPeriod; label: string }[] = [
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
  const [showDatePicker, setShowDatePicker] = useState(isDateRange(period));
  const [customFrom, setCustomFrom] = useState(isDateRange(period) ? period.from : '');
  const [customTo, setCustomTo] = useState(isDateRange(period) ? period.to : '');

  useEffect(() => {
    if (isDateRange(period)) {
      setShowDatePicker(true);
      setCustomFrom(period.from);
      setCustomTo(period.to);
    }
  }, [period]);

  const isCustomActive = isDateRange(period);

  function handleFixedPeriod(value: FixedPeriod) {
    setShowDatePicker(false);
    onChange(value);
  }

  function handleCustomClick() {
    setShowDatePicker(true);
  }

  function handleFromChange(value: string) {
    setCustomFrom(value);
    if (value && customTo) {
      onChange({ from: value, to: customTo });
    }
  }

  function handleToChange(value: string) {
    setCustomTo(value);
    if (customFrom && value) {
      onChange({ from: customFrom, to: value });
    }
  }

  return (
    <>
      <div className="period-selector" role="group" aria-label="表示期間">
        {OPTIONS.map(o => (
          <button
            key={o.value}
            type="button"
            className={!isCustomActive && period === o.value ? 'active' : ''}
            aria-pressed={!isCustomActive && period === o.value}
            onClick={() => handleFixedPeriod(o.value)}
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          className={isCustomActive ? 'active' : ''}
          aria-pressed={isCustomActive}
          onClick={handleCustomClick}
        >
          カスタム
        </button>
      </div>
      {showDatePicker && (
        <div className="custom-date-picker">
          <label>
            開始日
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={e => handleFromChange(e.target.value)}
            />
          </label>
          <label>
            終了日
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={e => handleToChange(e.target.value)}
            />
          </label>
        </div>
      )}
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
