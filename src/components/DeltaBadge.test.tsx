import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DeltaBadge } from "./DeltaBadge";
import type { Delta } from "../api";

describe("DeltaBadge", () => {
  it("delta が null のとき何も描画しない", () => {
    const { container } = render(<DeltaBadge delta={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("dir=up のとき ▲ と正のパーセントを表示する", () => {
    const delta: Delta = { pct: 12.5, dir: "up" };
    render(<DeltaBadge delta={delta} />);
    expect(screen.getByText("+12.5% ▲")).toBeInTheDocument();
  });

  it("dir=down のとき ▼ と負のパーセントを表示する", () => {
    const delta: Delta = { pct: -8.3, dir: "down" };
    render(<DeltaBadge delta={delta} />);
    expect(screen.getByText("-8.3% ▼")).toBeInTheDocument();
  });

  it("dir=flat のとき ±0.0% を表示する", () => {
    const delta: Delta = { pct: 0, dir: "flat" };
    render(<DeltaBadge delta={delta} />);
    expect(screen.getByText("±0.0%")).toBeInTheDocument();
  });

  it("span に delta-up クラスが付く（dir=up）", () => {
    const delta: Delta = { pct: 5, dir: "up" };
    render(<DeltaBadge delta={delta} />);
    const span = screen.getByTitle("前の期間との比較");
    expect(span).toHaveClass("delta-up");
  });

  it("span に delta-down クラスが付く（dir=down）", () => {
    const delta: Delta = { pct: -5, dir: "down" };
    render(<DeltaBadge delta={delta} />);
    const span = screen.getByTitle("前の期間との比較");
    expect(span).toHaveClass("delta-down");
  });
});
