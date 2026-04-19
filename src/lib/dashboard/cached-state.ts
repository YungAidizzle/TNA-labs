import { unstable_cache } from "next/cache";
import {
  DASHBOARD_MEMECOINS_SERVER_REVALIDATE_SECONDS,
  DASHBOARD_SUMMARY_SERVER_REVALIDATE_SECONDS,
  serializeTrendDashboardCacheQuery,
} from "@/lib/dashboard/cache";
import { getTrendDashboardState } from "@/lib/dashboard/service";
import type { TrendDashboardQuery, TrendDashboardVM } from "@/types/view-models";

const getCachedBaseState = unstable_cache(
  async (serializedQuery: string): Promise<TrendDashboardVM> => {
    const query = JSON.parse(serializedQuery) as TrendDashboardQuery;
    return getTrendDashboardState(query, {
      readProfile: "summary",
      includeFreshnessProbe: false,
    });
  },
  ["trend-dashboard-summary-state"],
  {
    revalidate: DASHBOARD_SUMMARY_SERVER_REVALIDATE_SECONDS,
  },
);

const getCachedMemecoinState = unstable_cache(
  async (serializedQuery: string): Promise<TrendDashboardVM> => {
    const baseState = await getCachedBaseState(serializedQuery);
    return {
      ...baseState,
      marketMemecoins: null,
      correlatedMemecoins: null,
    };
  },
  ["trend-dashboard-memecoin-state"],
  {
    revalidate: DASHBOARD_MEMECOINS_SERVER_REVALIDATE_SECONDS,
  },
);

export async function getSharedTrendDashboardSummaryState(query: TrendDashboardQuery) {
  return getCachedBaseState(serializeTrendDashboardCacheQuery(query));
}

export async function getSharedTrendDashboardMemecoinState(query: TrendDashboardQuery) {
  return getCachedMemecoinState(serializeTrendDashboardCacheQuery(query));
}
