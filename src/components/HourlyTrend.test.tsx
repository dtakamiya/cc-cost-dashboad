import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HourlyTrend } from "./HourlyTrend";
import type { HourlyDisplay } from "../weekly";

describe("HourlyTrend", () => {
  const mockData: HourlyDisplay[] = [
    {
      hour: 0,
      tokens: 1500,
      cost: 0.5,
      breakdown: [
        { model: "claude-opus-4-8", cost: 0.3, tokens: 900 },
        { model: "claude-sonnet-4-6", cost: 0.2, tokens: 600 }
      ]
    },
    {
      hour: 1,
      tokens: 2300,
      cost: 0.8,
      breakdown: [
        { model: "claude-opus-4-8", cost: 0.5, tokens: 1400 },
        { model: "claude-sonnet-4-6", cost: 0.3, tokens: 900 }
      ]
    }
  ];

  it("renders hourly trend chart", () => {
    render(<HourlyTrend data={mockData} metric="cost" onMetricChange={() => {}} />);
    expect(screen.getByText(/直近24時間/)).toBeInTheDocument();
  });

  it("renders metric toggle button", () => {
    render(<HourlyTrend data={mockData} metric="cost" onMetricChange={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("renders data with correct structure", () => {
    render(<HourlyTrend data={mockData} metric="tokens" onMetricChange={() => {}} />);
    // グラフのタイトルが表示されることで、コンポーネントが正しくレンダリングされたことを確認
    expect(screen.getByText(/直近24時間/)).toBeInTheDocument();
  });
});
