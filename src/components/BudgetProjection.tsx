import type { Summary } from "../api";

// Pro プラン（定額）のためコスト予測パネルは非表示
export function BudgetProjection(_: { s: Summary }) {
  return null;
}
