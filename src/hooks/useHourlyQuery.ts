import { useQuery } from "@tanstack/react-query";
import { fetchHourly } from "../api";
import { toHourly, type HourlyDisplay } from "../weekly";

export const hourlyQueryKey = ["hourly"] as const;

export interface UseHourlyQueryResult {
  data: HourlyDisplay[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

/** /api/hourly をフェッチし、表示用の HourlyDisplay[] に変換する。 */
export function useHourlyQuery(): UseHourlyQueryResult {
  const query = useQuery({
    queryKey: hourlyQueryKey,
    queryFn: async () => toHourly(await fetchHourly()),
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
