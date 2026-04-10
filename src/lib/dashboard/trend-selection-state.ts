import { RankedTrend, TrendDetailVM } from "@/types/view-models";

type ResolveSelectedTrendIdInput = {
  leaderboard: RankedTrend[];
  requestedSelectedId?: string;
  fallbackSelectedId?: string;
};

export function resolveSelectedTrendId({
  leaderboard,
  requestedSelectedId,
  fallbackSelectedId,
}: ResolveSelectedTrendIdInput) {
  if (requestedSelectedId && leaderboard.some((trend) => trend.id === requestedSelectedId)) {
    return requestedSelectedId;
  }

  if (fallbackSelectedId && leaderboard.some((trend) => trend.id === fallbackSelectedId)) {
    return fallbackSelectedId;
  }

  return leaderboard[0]?.id ?? requestedSelectedId;
}

export function findTrendById(
  leaderboard: RankedTrend[],
  selectedId: string | null | undefined,
) {
  if (!selectedId) {
    return null;
  }

  return leaderboard.find((trend) => trend.id === selectedId) ?? null;
}

export function resolveLoadedDetailForTrend(
  detail: TrendDetailVM | null | undefined,
  selectedId: string | null | undefined,
) {
  if (!detail || !selectedId) {
    return null;
  }

  return detail.trend.id === selectedId ? detail : null;
}

export function buildOptimisticTrendDetail(
  trend: RankedTrend | null | undefined,
): TrendDetailVM | null {
  if (!trend) {
    return null;
  }

  return {
    trend,
    attentionGraph: trend.attentionHistory,
    attentionWindow: null,
    platformBreakdown: trend.platformBreakdown,
    topPosts: trend.topPosts,
    relatedTrends: [],
    blueskyDetail: trend.blueskyDetail ?? null,
  };
}
