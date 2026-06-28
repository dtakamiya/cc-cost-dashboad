import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PeriodSelector } from "./PeriodSelector";

const noop = vi.fn();

describe("PeriodSelector", () => {
  describe("期間ボタンのARIA属性", () => {
    it("選択中の期間ボタンに aria-pressed=true が付与される", () => {
      render(
        <PeriodSelector
          period="7d"
          onChange={noop}
          compareMode={false}
          onCompareChange={noop}
          canCompare={true}
        />
      );
      expect(screen.getByRole("button", { name: "直近7日" })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    });

    it("非選択の期間ボタンに aria-pressed=false が付与される", () => {
      render(
        <PeriodSelector
          period="7d"
          onChange={noop}
          compareMode={false}
          onCompareChange={noop}
          canCompare={true}
        />
      );
      expect(screen.getByRole("button", { name: "直近30日" })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
      expect(screen.getByRole("button", { name: "直近90日" })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
      expect(screen.getByRole("button", { name: "全期間" })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });

    it("period が変わると対応ボタンの aria-pressed が true になる", () => {
      render(
        <PeriodSelector
          period="30d"
          onChange={noop}
          compareMode={false}
          onCompareChange={noop}
          canCompare={true}
        />
      );
      expect(screen.getByRole("button", { name: "直近30日" })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
      expect(screen.getByRole("button", { name: "直近7日" })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });
  });

  describe("期間ボタングループのARIAロール", () => {
    it("コンテナに role=group と aria-label が付与される", () => {
      render(
        <PeriodSelector
          period="7d"
          onChange={noop}
          compareMode={false}
          onCompareChange={noop}
          canCompare={true}
        />
      );
      const group = screen.getByRole("group", { name: /期間/i });
      expect(group).toBeInTheDocument();
    });
  });

  describe("前期比較ボタンのARIA属性（既存動作の維持）", () => {
    it("compareMode=true のとき aria-pressed=true を持つ", () => {
      render(
        <PeriodSelector
          period="7d"
          onChange={noop}
          compareMode={true}
          onCompareChange={noop}
          canCompare={true}
        />
      );
      expect(screen.getByRole("button", { name: /前期比較/i })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    });

    it("compareMode=false のとき aria-pressed=false を持つ", () => {
      render(
        <PeriodSelector
          period="7d"
          onChange={noop}
          compareMode={false}
          onCompareChange={noop}
          canCompare={true}
        />
      );
      expect(screen.getByRole("button", { name: /前期比較/i })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });
  });
});
