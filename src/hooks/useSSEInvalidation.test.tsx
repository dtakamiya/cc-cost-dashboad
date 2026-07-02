import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSSEInvalidation } from "./useSSEInvalidation";
import { createQueryClientWrapper } from "../testUtils/queryClientWrapper";
import * as api from "../api";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    subscribeToUpdates: vi.fn(),
  };
});

const mockSubscribeToUpdates = vi.mocked(api.subscribeToUpdates);

describe("useSSEInvalidation", () => {
  beforeEach(() => {
    mockSubscribeToUpdates.mockReset();
  });

  it("イベント受信時に invalidateQueries が呼ばれる", () => {
    let capturedCallback: (() => void) | undefined;
    const unsubscribe = vi.fn();
    mockSubscribeToUpdates.mockImplementation((cb) => {
      capturedCallback = cb;
      return unsubscribe;
    });
    const { wrapper, queryClient } = createQueryClientWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useSSEInvalidation(true), { wrapper });

    expect(capturedCallback).toBeDefined();
    capturedCallback?.();

    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("unmount 時に unsubscribe が呼ばれる", () => {
    const unsubscribe = vi.fn();
    mockSubscribeToUpdates.mockReturnValue(unsubscribe);
    const { wrapper } = createQueryClientWrapper();

    const { unmount } = renderHook(() => useSSEInvalidation(true), { wrapper });

    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("enabled が false のときは subscribeToUpdates が呼ばれない", () => {
    const { wrapper } = createQueryClientWrapper();

    renderHook(() => useSSEInvalidation(false), { wrapper });

    expect(mockSubscribeToUpdates).not.toHaveBeenCalled();
  });
});
