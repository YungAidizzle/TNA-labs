import type { QueryClient } from "@tanstack/react-query";
import type { CorrelatedMemecoinRow, TrendDashboardQuery } from "@/types/view-models";

type TrendDashboardCacheQuery = Pick<
  TrendDashboardQuery,
  "scope" | "range" | "sort" | "mode" | "selectedId"
>;

type MemecoinPreviewCacheInput = Pick<
  CorrelatedMemecoinRow,
  | "id"
  | "chainId"
  | "pairAddress"
  | "tokenAddress"
  | "symbol"
  | "quoteSymbol"
  | "tradingviewSymbol"
> & {
  resolvedDexscreenerUrl?: string | null;
};

export const DASHBOARD_STATUS_CLIENT_STALE_TIME_MS = 45_000;
export const DASHBOARD_STATUS_CLIENT_REFETCH_INTERVAL_MS =
  DASHBOARD_STATUS_CLIENT_STALE_TIME_MS;
export const DASHBOARD_SUMMARY_CLIENT_STALE_TIME_MS = 90_000;
export const DASHBOARD_SUMMARY_CLIENT_REFETCH_INTERVAL_MS =
  DASHBOARD_SUMMARY_CLIENT_STALE_TIME_MS;
export const DASHBOARD_MEMECOINS_CLIENT_STALE_TIME_MS = 90_000;
export const DASHBOARD_MEMECOINS_CLIENT_REFETCH_INTERVAL_MS =
  DASHBOARD_MEMECOINS_CLIENT_STALE_TIME_MS;
export const DASHBOARD_QUERY_GC_TIME_MS = 20 * 60_000;

export const MEMECOIN_PREVIEW_CLIENT_STALE_TIME_MS = 5 * 60_000;
export const MEMECOIN_PREVIEW_QUERY_GC_TIME_MS = 30 * 60_000;

export const DASHBOARD_SUMMARY_SERVER_REVALIDATE_SECONDS = 90;
export const DASHBOARD_MEMECOINS_SERVER_REVALIDATE_SECONDS = 45;

export const DASHBOARD_API_CACHE_CONTROL = {
  status: "private, max-age=30, stale-while-revalidate=90",
  summary: "private, max-age=60, stale-while-revalidate=180",
  memecoins: "private, max-age=45, stale-while-revalidate=120",
  preview: "private, max-age=45, stale-while-revalidate=180",
} as const;

function normalizeTrendDashboardQuery(query: TrendDashboardCacheQuery) {
  return {
    scope: query.scope,
    range: query.range,
    sort: query.sort,
    mode: query.mode ?? "established",
  };
}

export function serializeTrendDashboardCacheQuery(query: TrendDashboardCacheQuery) {
  return JSON.stringify(normalizeTrendDashboardQuery(query));
}

function normalizeMemecoinPreviewKey(input: MemecoinPreviewCacheInput) {
  return {
    id: input.id,
    chainId: input.chainId,
    pairAddress: input.pairAddress,
    tokenAddress: input.tokenAddress,
    symbol: input.symbol,
    quoteSymbol: input.quoteSymbol ?? null,
    tradingviewSymbol: input.tradingviewSymbol ?? null,
    dexscreenerUrl: input.resolvedDexscreenerUrl ?? null,
  };
}

export const trendDashboardQueryKeys = {
  all: ["trend-dashboard"] as const,
  views(query: TrendDashboardCacheQuery) {
    return [...this.all, "views", normalizeTrendDashboardQuery(query)] as const;
  },
  status(query: TrendDashboardCacheQuery) {
    return [...this.views(query), "status"] as const;
  },
  summary(query: TrendDashboardCacheQuery) {
    return [...this.views(query), "summary"] as const;
  },
  memecoins(query: TrendDashboardCacheQuery) {
    return [...this.views(query), "memecoins"] as const;
  },
  previewRoot: ["trend-dashboard", "preview"] as const,
  memecoinPreview(input: MemecoinPreviewCacheInput) {
    return [...this.previewRoot, normalizeMemecoinPreviewKey(input)] as const;
  },
};

export function isQueryDataStale(dataUpdatedAt: number, staleTimeMs: number) {
  if (!dataUpdatedAt || dataUpdatedAt <= 0) {
    return true;
  }

  return Date.now() - dataUpdatedAt >= staleTimeMs;
}

export async function invalidateTrendDashboardQueries(
  queryClient: QueryClient,
  query: TrendDashboardCacheQuery,
) {
  return queryClient.invalidateQueries({
    queryKey: trendDashboardQueryKeys.views(query),
    refetchType: "active",
  });
}
