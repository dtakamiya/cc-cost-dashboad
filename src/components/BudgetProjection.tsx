import { useState, useEffect } from "react";
import type { Summary } from "../api";
import { usd } from "../format";

const BUDGET_KEY = "cc_monthly_budget";

function loadBudget(): number | null {
  const v = localStorage.getItem(BUDGET_KEY);
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) || n <= 0 ? null : n;
}

export function BudgetProjection({ s }: { s: Summary }) {
  const proj = s.projection;
  const [budget, setBudget] = useState<number | null>(loadBudget);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (budget !== null) localStorage.setItem(BUDGET_KEY, String(budget));
    else localStorage.removeItem(BUDGET_KEY);
  }, [budget]);

  if (!proj) return null;

  const projected = proj.projectedMonthCost;
  const overBudget = budget !== null && projected > budget;
  const pct = budget ? Math.min((proj.monthCostSoFar / budget) * 100, 100) : 0;
  const projPct = budget ? Math.min((projected / budget) * 100, 100) : 0;

  function submitBudget() {
    const n = parseFloat(input);
    setBudget(isNaN(n) || n <= 0 ? null : n);
    setEditing(false);
    setInput("");
  }

  return (
    <section className="panel">
      <div className="budget-header">
        <h2>当月コスト予測（{proj.monthStr}）</h2>
        {!editing ? (
          <button className="budget-edit-btn" onClick={() => { setInput(budget ? String(budget) : ""); setEditing(true); }}>
            {budget ? `予算 ${usd(budget)} を変更` : "月予算を設定"}
          </button>
        ) : (
          <span className="budget-input-row">
            <span>$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="例: 50"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitBudget()}
              autoFocus
              className="budget-input"
            />
            <button onClick={submitBudget}>保存</button>
            <button onClick={() => setEditing(false)}>キャンセル</button>
          </span>
        )}
      </div>

      {overBudget && (
        <div className="warn">
          予算超過見込み: 月末着地 {usd(projected)} ／ 予算 {usd(budget!)} （{usd(projected - budget!)} 超過）
        </div>
      )}

      <div className="budget-stats">
        <div className="block-stat">
          <div className="block-stat-label">当月消費（実績）</div>
          <div className="block-stat-value">{usd(proj.monthCostSoFar)}</div>
          <div className="block-stat-unit">{proj.daysPassed} 日経過</div>
        </div>
        <div className="block-stat">
          <div className="block-stat-label">月末着地予測</div>
          <div className={`block-stat-value ${overBudget ? "text-warn" : ""}`}>{usd(projected)}</div>
          <div className="block-stat-unit">残り {proj.daysRemain} 日</div>
        </div>
        <div className="block-stat">
          <div className="block-stat-label">日平均消費</div>
          <div className="block-stat-value">{usd(proj.daysPassed > 0 ? proj.monthCostSoFar / proj.daysPassed : 0)}</div>
          <div className="block-stat-unit">/日</div>
        </div>
        {budget && (
          <div className="block-stat">
            <div className="block-stat-label">予算残</div>
            <div className={`block-stat-value ${overBudget ? "text-warn" : ""}`}>
              {usd(Math.max(budget - proj.monthCostSoFar, 0))}
            </div>
            <div className="block-stat-unit">（予算 {usd(budget)}）</div>
          </div>
        )}
      </div>

      {budget && (
        <div className="budget-bar-wrap">
          <div className="budget-bar-bg">
            <div className="budget-bar-proj" style={{ width: `${projPct}%` }} />
            <div className="budget-bar-actual" style={{ width: `${pct}%` }} />
          </div>
          <div className="budget-bar-labels">
            <span>実績 {pct.toFixed(0)}%</span>
            <span>着地予測 {projPct.toFixed(0)}%</span>
          </div>
        </div>
      )}
    </section>
  );
}
