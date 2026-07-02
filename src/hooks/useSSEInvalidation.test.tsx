import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { useSSEInvalidation } from "./useSSEInvalidation";
import * as api from "../api";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    subscribeToUpdates: vi.fn(),
  };
});

const mockSubscribeToUpdates = vi.mocked(api.subscribeToUpdates);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, queryClient };
}

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
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useSSEInvalidation(true), { wrapper });

    expect(capturedCallback).toBeDefined();
    capturedCallback?.();

    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("unmount 時に unsubscribe が呼ばれる", () => {
    const unsubscribe = vi.fn();
    mockSubscribeToUpdates.mockReturnValue(unsubscribe);
    const { wrapper } = createWrapper();

    const { unmount } = renderHook(() => useSSEInvalidation(true), { wrapper });

    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("enabled が false のときは subscribeToUpdates が呼ばれない", () => {
    const { wrapper } = createWrapper();

    renderHook(() => useSSEInvalidation(false), { wrapper });

    expect(mockSubscribeToUpdates).not.toHaveBeenCalled();
  });
});
