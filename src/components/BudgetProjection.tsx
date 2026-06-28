import { useState } from "react";
import type { Summary } from "../api";
import {
  getBudgetLimit,
  setBudgetLimit,
  clearBudgetLimit,
  calcBudgetProgress,
} from "../budget";

function fmt(v: number) {
  return v < 10 ? `$${v.toFixed(2)}` : `$${v.toFixed(1)}`;
}

export function BudgetProjection({ s }: { s: Summary }) {
  const proj = s.projection;
  const [budgetLimit, setBudgetLimitState] = useState<number | null>(getBudgetLimit);
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState("");

  if (!proj) return null;

  const progress = calcBudgetProgress(
    proj.monthCostSoFar,
    proj.projectedMonthCost,
    budgetLimit
  );

  const handleSave = () => {
    const n = parseFloat(inputVal);
    if (!Number.isFinite(n) || n <= 0) return;
    setBudgetLimit(n);
    setBudgetLimitState(n);
    setEditing(false);
    setInputVal("");
  };

  const handleClear = () => {
    clearBudgetLimit();
    setBudgetLimitState(null);
    setEditing(false);
    setInputVal("");
  };

  return (
    <section className="card">
      <div className="budget-header">
        <h2>コスト予測（{proj.monthStr}）</h2>
        {!editing && (
          <button
            className="budget-edit-btn"
            onClick={() => {
              setInputVal(budgetLimit != null ? String(budgetLimit) : "");
              setEditing(true);
            }}
          >
            {budgetLimit != null ? "予算を編集" : "予算を設定"}
          </button>
        )}
      </div>

      {editing && (
        <div className="budget-input-row">
          <label htmlFor="monthly-budget-limit">月額予算上限 $</label>
          <input
            id="monthly-budget-limit"
            className="budget-input"
            type="number"
            min="0.01"
            step="any"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            autoFocus
          />
          <button onClick={handleSave}>保存</button>
          {budgetLimit != null && (
            <button onClick={handleClear}>クリア</button>
          )}
          <button onClick={() => setEditing(false)}>キャンセル</button>
        </div>
      )}

      <div className="budget-stats">
        <div>
          <div className="stat-label">今月の実績</div>
          <div className="stat-value">{fmt(proj.monthCostSoFar)}</div>
        </div>
        <div>
          <div className="stat-label">着地予測</div>
          <div className={`stat-value${progress?.isProjectedOver ? " text-warn" : ""}`}>
            {fmt(proj.projectedMonthCost)}
          </div>
        </div>
        <div>
          <div className="stat-label">経過日数</div>
          <div className="stat-value">{proj.daysPassed} / {proj.daysInMonth} 日</div>
        </div>
        <div>
          <div className="stat-label">月額予算</div>
          <div className={`stat-value${progress?.isOverBudget ? " text-warn" : ""}`}>
            {budgetLimit != null ? fmt(budgetLimit) : "—"}
          </div>
        </div>
      </div>

      {progress && (
        <>
          <div className="budget-bar-bg">
            <div
              className="budget-bar-proj"
              style={{ width: `${progress.projectedPct}%` }}
            />
            <div
              className="budget-bar-actual"
              style={{ width: `${progress.actualPct}%` }}
            />
          </div>
          <div className="budget-bar-labels">
            <span>実績 {progress.actualPct.toFixed(0)}%</span>
            <span className={progress.isProjectedOver ? "text-warn" : ""}>
              予測 {progress.projectedPct.toFixed(0)}%
              {progress.isProjectedOver && " ⚠ 予算超過見込み"}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
