import { useState } from "react";
import type { Summary } from "../api";
import { defaultSimulatorInput, simulateSavings, type SimulatorInput } from "../simulator";
import { usd, pct } from "../format";

interface SliderConfig {
  key: keyof SimulatorInput;
  label: string;
  savingsLabel: string;
}

const SLIDERS: SliderConfig[] = [
  { key: "targetCacheHitRate", label: "キャッシュヒット率目標", savingsLabel: "キャッシュ改善" },
  { key: "haikuShiftRate", label: "Haiku移行率", savingsLabel: "モデル振替" },
  { key: "clearRate", label: "/clear実施率", savingsLabel: "文脈再送削減" },
];

export function SavingsSimulator({ s }: { s: Summary }) {
  const [input, setInput] = useState<SimulatorInput>(() => defaultSimulatorInput(s));

  if (s.totals.tokens === 0) return null;

  const result = simulateSavings(s, input);
  const savingsByKey: Record<keyof SimulatorInput, number> = {
    targetCacheHitRate: result.cacheSavings,
    haikuShiftRate: result.haikuSavings,
    clearRate: result.clearSavings,
  };

  const handleChange = (key: keyof SimulatorInput) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value) / 100;
    setInput((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <section className="panel">
      <h2>節約ポテンシャルシミュレーター</h2>
      <div className="advisor-headline">
        推定節約額 <strong>{usd(result.totalMonthlySavings)}/月</strong>
        <span className="advisor-note">（各施策は独立試算・相互作用は考慮しない目安値）</span>
      </div>
      <div className="drivers">
        {SLIDERS.map(({ key, label, savingsLabel }) => (
          <div className="driver" key={key}>
            <div className="driver-title">
              <span>{label}</span>
              <span className="advisor-saving">{pct(input[key])}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(input[key] * 100)}
              onChange={handleChange(key)}
              aria-label={label}
            />
            <div className="driver-hint">
              {savingsLabel}: 〜{usd(savingsByKey[key])}/月
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
