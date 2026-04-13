import { unstable_cache } from "next/cache";
import { getTrendDashboardState } from "@/lib/dashboard/service";
import type { TrendDashboardQuery, TrendDashboardVM } from "@/types/view-models";

const DASHBOARD_SHARED_REVALIDATE_SECONDS = 15;

function serializeQuery(query: TrendDashboardQuery) {
  return JSON.stringify({
    scope: query.scope,
    range: query.range,
    sort: query.sort,
    mode: query.mode ?? "established",
  });
}

const getCachedSummaryState = unstable_cache(
  async (serializedQuery: string): Promise<TrendDashboardVM> => {
    const query = JSON.parse(serializedQuery) as TrendDashboardQuery;
    return getTrendDashboardState(query, {
      readProfile: "summary",
    });
  },
  ["trend-dashboard-summary-state"],
  {
    revalidate: DASHBOARD_SHARED_REVALIDATE_SECONDS,
  },
);

export async function getSharedTrendDashboardSummaryState(query: TrendDashboardQuery) {
  return getCachedSummaryState(serializeQuery(query));
}
