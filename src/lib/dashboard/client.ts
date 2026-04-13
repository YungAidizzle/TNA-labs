import {
  buildTrendDashboardSearchParams,
  type DashboardApiView,
  type TrendDashboardMemecoinsResponse,
  type TrendDashboardStatusResponse,
  type TrendDashboardSummaryResponse,
} from "@/lib/dashboard/api";
import {
  buildTradingViewPreviewInput,
  buildTradingViewPreviewSearchParams,
  type TradingViewPreviewResponse,
} from "@/lib/dashboard/tradingview-preview";
import type { TrendDashboardQuery, CorrelatedMemecoinRow } from "@/types/view-models";

async function fetchDashboardView<T>(
  query: TrendDashboardQuery,
  view: DashboardApiView,
  options?: {
    signal?: AbortSignal;
  },
) {
  const response = await fetch(
    `/api/dashboard/trends?${buildTrendDashboardSearchParams(query, view).toString()}`,
    {
      cache: "no-store",
      signal: options?.signal,
    },
  );

  if (!response.ok) {
    throw new Error(`dashboard ${view} request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export const dashboardClient = {
  getTrendDashboardStatus(
    query: TrendDashboardQuery,
    options?: {
      signal?: AbortSignal;
    },
  ) {
    return fetchDashboardView<TrendDashboardStatusResponse>(query, "status", options);
  },

  getTrendDashboardSummaryVM(
    query: TrendDashboardQuery,
    options?: {
      signal?: AbortSignal;
    },
  ) {
    return fetchDashboardView<TrendDashboardSummaryResponse>(query, "summary", options);
  },

  getTrendDashboardMemecoins(
    query: TrendDashboardQuery,
    options?: {
      signal?: AbortSignal;
    },
  ) {
    return fetchDashboardView<TrendDashboardMemecoinsResponse>(query, "memecoins", options);
  },

  async getMemecoinPreview(
    row: CorrelatedMemecoinRow,
    options?: {
      signal?: AbortSignal;
    },
  ): Promise<TradingViewPreviewResponse> {
    const params = buildTradingViewPreviewSearchParams(buildTradingViewPreviewInput(row));
    const response = await fetch(`/api/dashboard/memecoin-preview?${params.toString()}`, {
      cache: "no-store",
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new Error(`memecoin preview request failed: ${response.status}`);
    }

    return (await response.json()) as TradingViewPreviewResponse;
  },
};
