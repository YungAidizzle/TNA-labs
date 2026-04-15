import { unstable_cache } from "next/cache";
import { fetchLatestCorrelatedMemecoinBoard } from "@/lib/dashboard/correlated-memecoins";
import { getTrendDashboardState } from "@/lib/dashboard/service";
import { buildStrictTrendsPageCorrelatedBoard } from "@/lib/dashboard/trends-page-memecoin-matcher";
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
    revalidate: DASHBOARD_SHARED_REVALIDATE_SECONDS,
  },
);

const getCachedMemecoinState = unstable_cache(
  async (serializedQuery: string): Promise<TrendDashboardVM> => {
    const baseState = await getCachedBaseState(serializedQuery);
    let marketMemecoins = null;

    try {
      marketMemecoins = await fetchLatestCorrelatedMemecoinBoard({
        validationMode: "stored",
      });
    } catch (error) {
      console.error("[dashboard-cached-state] failed to load correlated memecoin board", error);
    }

    const strictCorrelatedMemecoins = buildStrictTrendsPageCorrelatedBoard(
      baseState,
      marketMemecoins ?? null,
    );

    return {
      ...baseState,
      marketMemecoins: marketMemecoins ?? null,
      correlatedMemecoins: strictCorrelatedMemecoins ?? null,
    };
  },
  ["trend-dashboard-memecoin-state"],
  {
    revalidate: DASHBOARD_SHARED_REVALIDATE_SECONDS,
  },
);

export async function getSharedTrendDashboardSummaryState(query: TrendDashboardQuery) {
  return getCachedBaseState(serializeQuery(query));
}

export async function getSharedTrendDashboardMemecoinState(query: TrendDashboardQuery) {
  return getCachedMemecoinState(serializeQuery(query));
}
