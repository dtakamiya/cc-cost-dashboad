import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionCostCurve } from "./SessionCostCurve";
import type { SessionTurn } from "../api";
import { SPIKE_RATIO_THRESHOLD } from "../api";

describe("SessionCostCurve", () => {
  const turn = (over: Partial<SessionTurn>): SessionTurn => ({
    ts: "2026-07-01T00:00:00.000Z",
    model: "claude-sonnet-4-6",
    input: 0,
    output: 0,
    cacheCreate: 0,
    cacheRead: 0,
    cost: 0,
    ...over,
  });

  it("ターンデータがない場合は「ターンデータなし」を表示する", () => {
    render(<SessionCostCurve turns={[]} loading={false} />);
    expect(screen.getByText(/ターンデータなし/)).toBeInTheDocument();
  });

  it("読み込み中は読み込み中メッセージを表示する", () => {
    render(<SessionCostCurve turns={null} loading={true} />);
    expect(screen.getByText(/読み込み中/)).toBeInTheDocument();
  });

  it("単一ターンでもエラーにならず描画される", () => {
    render(<SessionCostCurve turns={[turn({ cost: 0.01 })]} loading={false} />);
    expect(screen.getByText(/累積コスト推移/)).toBeInTheDocument();
  });

  it("複数ターンで累積コスト曲線のタイトルを表示する", () => {
    const turns = [turn({ cost: 0.01 }), turn({ cost: 0.02 })];
    render(<SessionCostCurve turns={turns} loading={false} />);
    expect(screen.getByText(/累積コスト推移/)).toBeInTheDocument();
  });

  it("傾き急増点がある場合はアドバイス注記を表示する", () => {
    const turns = [
      turn({ cost: 0.01 }),
      turn({ cost: 0.01 }),
      turn({ cost: 0.01 }),
      turn({ cost: 0.01 * (SPIKE_RATIO_THRESHOLD + 1) }),
    ];
    render(<SessionCostCurve turns={turns} loading={false} />);
    expect(screen.getByText(/\/clear/)).toBeInTheDocument();
  });

  it("傾き急増点がない場合はアドバイス注記を表示しない", () => {
    const turns = [turn({ cost: 0.01 }), turn({ cost: 0.011 })];
    render(<SessionCostCurve turns={turns} loading={false} />);
    expect(screen.queryByText(/\/clear または \/compact を検討/)).not.toBeInTheDocument();
  });
});
