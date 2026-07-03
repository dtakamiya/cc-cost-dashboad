import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ScrollToTopButton } from "./ScrollToTopButton";

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { value, writable: true, configurable: true });
}

describe("ScrollToTopButton", () => {
  beforeEach(() => {
    setScrollY(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("初期状態（scrollY = 0）ではボタンが表示されない", () => {
    render(<ScrollToTopButton />);
    expect(screen.queryByRole("button", { name: /トップへ戻る/ })).not.toBeInTheDocument();
  });

  it("scrollYが閾値を超えた状態でscrollイベントを発火するとボタンが表示される", () => {
    render(<ScrollToTopButton />);
    setScrollY(500);
    fireEvent.scroll(window);
    expect(screen.getByRole("button", { name: /トップへ戻る/ })).toBeInTheDocument();
  });

  it("ボタンクリックでwindow.scrollToが呼ばれる", () => {
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<ScrollToTopButton />);
    setScrollY(500);
    fireEvent.scroll(window);

    fireEvent.click(screen.getByRole("button", { name: /トップへ戻る/ }));

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});
