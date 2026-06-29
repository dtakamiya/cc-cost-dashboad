import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  describe("カスタム日付範囲", () => {
    it("「カスタム」ボタンが表示される", () => {
      render(
        <PeriodSelector
          period="7d"
          onChange={noop}
          compareMode={false}
          onCompareChange={noop}
          canCompare={true}
        />
      );
      expect(screen.getByRole("button", { name: "カスタム" })).toBeInTheDocument();
    });

    it("カスタムボタンクリック前は日付入力が非表示", () => {
      render(
        <PeriodSelector
          period="7d"
          onChange={noop}
          compareMode={false}
          onCompareChange={noop}
          canCompare={true}
        />
      );
      expect(screen.queryByLabelText("開始日")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("終了日")).not.toBeInTheDocument();
    });

    it("カスタムボタンクリック後に日付入力が表示される", () => {
      render(
        <PeriodSelector
          period="7d"
          onChange={noop}
          compareMode={false}
          onCompareChange={noop}
          canCompare={true}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "カスタム" }));
      expect(screen.getByLabelText("開始日")).toBeInTheDocument();
      expect(screen.getByLabelText("終了日")).toBeInTheDocument();
    });

    it("開始日のみ入力しても onChange は呼ばれない", () => {
      const onChange = vi.fn();
      render(
        <PeriodSelector
          period="7d"
          onChange={onChange}
          compareMode={false}
          onCompareChange={noop}
          canCompare={true}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "カスタム" }));
      fireEvent.change(screen.getByLabelText("開始日"), { target: { value: "2025-06-01" } });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("開始日と終了日を入力すると onChange({ from, to }) が呼ばれる", () => {
      const onChange = vi.fn();
      render(
        <PeriodSelector
          period="7d"
          onChange={onChange}
          compareMode={false}
          onCompareChange={noop}
          canCompare={true}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "カスタム" }));
      fireEvent.change(screen.getByLabelText("開始日"), { target: { value: "2025-06-01" } });
      fireEvent.change(screen.getByLabelText("終了日"), { target: { value: "2025-06-14" } });
      expect(onChange).toHaveBeenCalledWith({ from: "2025-06-01", to: "2025-06-14" });
    });

    it("カスタム範囲が選択中のとき「カスタム」ボタンに aria-pressed=true が付く", () => {
      render(
        <PeriodSelector
          period={{ from: "2025-06-01", to: "2025-06-14" }}
          onChange={noop}
          compareMode={false}
          onCompareChange={noop}
          canCompare={false}
        />
      );
      expect(screen.getByRole("button", { name: "カスタム" })).toHaveAttribute("aria-pressed", "true");
    });

    it("カスタム範囲選択中は固定期間ボタンが aria-pressed=false", () => {
      render(
        <PeriodSelector
          period={{ from: "2025-06-01", to: "2025-06-14" }}
          onChange={noop}
          compareMode={false}
          onCompareChange={noop}
          canCompare={false}
        />
      );
      expect(screen.getByRole("button", { name: "直近7日" })).toHaveAttribute("aria-pressed", "false");
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
