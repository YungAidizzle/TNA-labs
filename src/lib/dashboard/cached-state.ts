import { unstable_cache } from "next/cache";
import { fetchLatestCorrelatedMemecoinBoard } from "@/lib/dashboard/correlated-memecoins";
import { getTrendDashboardState } from "@/lib/dashboard/service";
import { attachTrendMemecoinLinks } from "@/lib/dashboard/trend-memecoin-links";
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

async function decorateTrendDashboardMemecoins(
  state: TrendDashboardVM,
): Promise<TrendDashboardVM> {
  let marketMemecoins = null;

  try {
    marketMemecoins = await fetchLatestCorrelatedMemecoinBoard();
  } catch (error) {
    console.error("[dashboard-cached-state] failed to load correlated memecoin board", error);
  }

  const strictCorrelatedMemecoins = buildStrictTrendsPageCorrelatedBoard(
    state,
    marketMemecoins ?? null,
  );

  const stateWithBoard: TrendDashboardVM = {
    ...state,
    marketMemecoins: marketMemecoins ?? null,
    correlatedMemecoins: strictCorrelatedMemecoins ?? null,
  };

  try {
    return await attachTrendMemecoinLinks(stateWithBoard, strictCorrelatedMemecoins);
  } catch (error) {
    console.error("[dashboard-cached-state] failed to attach trend memecoin links", error);
    return stateWithBoard;
  }
}

const getCachedSummaryState = unstable_cache(
  async (serializedQuery: string): Promise<TrendDashboardVM> => {
    const query = JSON.parse(serializedQuery) as TrendDashboardQuery;
    const state = await getTrendDashboardState(query, {
      readProfile: "summary",
    });
    return decorateTrendDashboardMemecoins(state);
  },
  ["trend-dashboard-summary-state"],
  {
    revalidate: DASHBOARD_SHARED_REVALIDATE_SECONDS,
  },
);

export async function getSharedTrendDashboardSummaryState(query: TrendDashboardQuery) {
  return getCachedSummaryState(serializeQuery(query));
}
