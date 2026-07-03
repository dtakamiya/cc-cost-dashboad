import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DataQualityBadge } from "./DataQualityBadge";
import type { Summary } from "../api";

describe("DataQualityBadge", () => {
  it("source が undefined のとき何も描画しない", () => {
    const { container } = render(<DataQualityBadge source={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("source があるとき「データ品質: 正常」バッジを表示する", () => {
    const source: NonNullable<Summary["source"]> = {
      fileCount: 3,
      parsedLines: 150,
      skippedLines: 0,
      parseErrors: 0,
      unreadableFiles: 0,
    };
    render(<DataQualityBadge source={source} />);
    expect(screen.getByText(/データ品質: 正常/)).toBeInTheDocument();
  });

  it("skippedLines > 0 のとき title 属性に「スキップ: N 行」の詳細が入る", () => {
    const source: NonNullable<Summary["source"]> = {
      fileCount: 3,
      parsedLines: 100,
      skippedLines: 10,
      parseErrors: 3,
      unreadableFiles: 0,
    };
    render(<DataQualityBadge source={source} />);
    const badge = screen.getByText(/データ品質/);
    expect(badge).toHaveAttribute("title", expect.stringContaining("スキップ: 10 行"));
    expect(badge.getAttribute("title")).toContain("パースエラー: 3");
  });

  it("問題がないとき title 属性は「完全」を示す", () => {
    const source: NonNullable<Summary["source"]> = {
      fileCount: 3,
      parsedLines: 100,
      skippedLines: 0,
      parseErrors: 0,
      unreadableFiles: 0,
    };
    render(<DataQualityBadge source={source} />);
    const badge = screen.getByText(/データ品質/);
    expect(badge).toHaveAttribute("title", expect.stringContaining("完全"));
  });
});
