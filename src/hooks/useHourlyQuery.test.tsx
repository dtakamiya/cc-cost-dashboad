import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useHourlyQuery } from "./useHourlyQuery";
import { createQueryClientWrapper } from "../testUtils/queryClientWrapper";
import * as api from "../api";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    fetchHourly: vi.fn(),
  };
});

const mockFetchHourly = vi.mocked(api.fetchHourly);

const hourlyFixture: api.HourlyData[] = [
  {
    hour: 9,
    tokens: 1000,
    cost: 1.5,
    models: [{ model: "claude-sonnet-5", cost: 1.5, tokens: 1000 }],
  },
];

describe("useHourlyQuery", () => {
  beforeEach(() => {
    mockFetchHourly.mockReset();
  });

  it("成功時に toHourly() で変換されたデータが data に入る", async () => {
    mockFetchHourly.mockResolvedValue(hourlyFixture);
    const { wrapper } = createQueryClientWrapper();

    const { result } = renderHook(() => useHourlyQuery(), { wrapper });

    await waitFor(() =>
      expect(result.current.data).toEqual([
        {
          hour: 9,
          tokens: 1000,
          cost: 1.5,
          breakdown: [{ model: "claude-sonnet-5", cost: 1.5, tokens: 1000 }],
        },
      ])
    );
  });

  it("失敗時は isError が true になり、呼び出し側で空配列にフォールバックできる", async () => {
    mockFetchHourly.mockRejectedValue(new Error("hourly fetch failed"));
    const { wrapper } = createQueryClientWrapper();

    const { result } = renderHook(() => useHourlyQuery(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
