import {
  RankedTrend,
  RelatedTrend,
  TrendDashboardVM,
  TrendDetailVM,
  TrendTopPost,
} from "@/types/view-models";
import { TimeSeriesPoint } from "@/types/domain";

function isDeepEqual<T>(previousValue: T, nextValue: T) {
  if (Object.is(previousValue, nextValue)) {
    return true;
  }

  try {
    return JSON.stringify(previousValue) === JSON.stringify(nextValue);
  } catch {
    return false;
  }
}

function reuseIfEqual<T>(previousValue: T, nextValue: T) {
  return isDeepEqual(previousValue, nextValue) ? previousValue : nextValue;
}

function reconcileArrayById<T extends { id: string }>(previousItems: T[], nextItems: T[]) {
  if (previousItems.length === 0 || nextItems.length === 0) {
    return nextItems;
  }

  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  return nextItems.map((item) => {
    const previousItem = previousById.get(item.id);
    return previousItem ? reuseIfEqual(previousItem, item) : item;
  });
}

function reconcilePoints(previousPoints: TimeSeriesPoint[], nextPoints: TimeSeriesPoint[]) {
  return reuseIfEqual(previousPoints, nextPoints);
}

function reconcileRankedTrends(previousRows: RankedTrend[], nextRows: RankedTrend[]) {
  return reconcileArrayById(previousRows, nextRows);
}

function reconcileRelatedTrends(previousItems: RelatedTrend[], nextItems: RelatedTrend[]) {
  return reconcileArrayById(previousItems, nextItems);
}

function reconcileTopPosts(previousItems: TrendTopPost[], nextItems: TrendTopPost[]) {
  return reconcileArrayById(previousItems, nextItems);
}

function reconcileTrendDetail(
  previousDetail: TrendDetailVM | null,
  nextDetail: TrendDetailVM | null,
) {
  if (!previousDetail || !nextDetail) {
    return nextDetail;
  }

  const reconciledTrend = reuseIfEqual(previousDetail.trend, nextDetail.trend);
  const reconciledAttentionGraph = reconcilePoints(
    previousDetail.attentionGraph,
    nextDetail.attentionGraph,
  );
  const reconciledPlatformBreakdown = reuseIfEqual(
    previousDetail.platformBreakdown,
    nextDetail.platformBreakdown,
  );
  const reconciledTopPosts = reconcileTopPosts(previousDetail.topPosts, nextDetail.topPosts);
  const reconciledRelatedTrends = reconcileRelatedTrends(
    previousDetail.relatedTrends,
    nextDetail.relatedTrends,
  );
  const reconciledBlueskyDetail = reuseIfEqual(
    previousDetail.blueskyDetail,
    nextDetail.blueskyDetail,
  );
  const reconciledAttentionWindow = reuseIfEqual(
    previousDetail.attentionWindow,
    nextDetail.attentionWindow,
  );

  if (
    reconciledTrend === previousDetail.trend &&
    reconciledAttentionGraph === previousDetail.attentionGraph &&
    reconciledAttentionWindow === previousDetail.attentionWindow &&
    reconciledPlatformBreakdown === previousDetail.platformBreakdown &&
    reconciledTopPosts === previousDetail.topPosts &&
    reconciledRelatedTrends === previousDetail.relatedTrends &&
    reconciledBlueskyDetail === previousDetail.blueskyDetail
  ) {
    return previousDetail;
  }

  return {
    ...nextDetail,
    trend: reconciledTrend,
    attentionGraph: reconciledAttentionGraph,
    attentionWindow: reconciledAttentionWindow,
    platformBreakdown: reconciledPlatformBreakdown,
    topPosts: reconciledTopPosts,
    relatedTrends: reconciledRelatedTrends,
    blueskyDetail: reconciledBlueskyDetail,
  };
}

function reconcileOverviewSeries(
  previousSeries: TrendDashboardVM["overviewSeries"],
  nextSeries: TrendDashboardVM["overviewSeries"],
) {
  if (previousSeries.length === 0 || nextSeries.length === 0) {
    return nextSeries;
  }

  const previousById = new Map(previousSeries.map((series) => [series.id, series]));
  return nextSeries.map((series) => {
    const previous = previousById.get(series.id);
    if (!previous) {
      return series;
    }

    const reconciledPoints = reconcilePoints(previous.points, series.points);
    if (
      previous.name === series.name &&
      previous.selected === series.selected &&
      previous.color === series.color &&
      reconciledPoints === previous.points &&
      isDeepEqual(previous.window, series.window)
    ) {
      return previous;
    }

    return {
      ...series,
      points: reconciledPoints,
      window: reuseIfEqual(previous.window, series.window),
    };
  });
}

function normalizeDataStatusForComparison(dataStatus: TrendDashboardVM["dataStatus"]) {
  if (!dataStatus) {
    return null;
  }

  return {
    ...dataStatus,
    responseVersion: null,
    timings: null,
    refresh: dataStatus.refresh
      ? {
          ...dataStatus.refresh,
          requestedAt: null,
          startedAt: null,
          completedAt: null,
          latestBundleGeneratedAt: null,
        }
      : null,
  };
}

function reconcileDataStatus(
  previousDataStatus: TrendDashboardVM["dataStatus"],
  nextDataStatus: TrendDashboardVM["dataStatus"],
) {
  if (!previousDataStatus || !nextDataStatus) {
    return nextDataStatus;
  }

  return isDeepEqual(
    normalizeDataStatusForComparison(previousDataStatus),
    normalizeDataStatusForComparison(nextDataStatus),
  )
    ? previousDataStatus
    : nextDataStatus;
}

export function reconcileTrendDashboardVM(
  previousDashboard: TrendDashboardVM,
  nextDashboard: TrendDashboardVM,
  options?: {
    preserveSelectedDetailId?: string | undefined;
  },
) {
  const reconciledEstablished = reconcileRankedTrends(
    previousDashboard.leaderboards.established,
    nextDashboard.leaderboards.established,
  );
  const reconciledEmerging = reconcileRankedTrends(
    previousDashboard.leaderboards.emerging,
    nextDashboard.leaderboards.emerging,
  );
  const reconciledLeaderboard = reconcileRankedTrends(
    previousDashboard.leaderboard,
    nextDashboard.leaderboard,
  );
  const reconciledOverviewSeries = reconcileOverviewSeries(
    previousDashboard.overviewSeries,
    nextDashboard.overviewSeries,
  );
  let reconciledDetail = reconcileTrendDetail(
    previousDashboard.detail,
    nextDashboard.detail,
  );

  const preservedDetailId = options?.preserveSelectedDetailId;
  if (
    preservedDetailId &&
    previousDashboard.detail?.trend.id === preservedDetailId &&
    nextDashboard.detail?.trend.id !== preservedDetailId &&
    nextDashboard.leaderboard.some((trend) => trend.id === preservedDetailId)
  ) {
    reconciledDetail = previousDashboard.detail;
  }

  const ingestionHealth = reuseIfEqual(
    previousDashboard.ingestionHealth,
    nextDashboard.ingestionHealth,
  );
  const dataStatus = reconcileDataStatus(previousDashboard.dataStatus, nextDashboard.dataStatus);
  const blueskyOverview = reuseIfEqual(
    previousDashboard.blueskyOverview,
    nextDashboard.blueskyOverview,
  );
  const trendCoverage = reuseIfEqual(
    previousDashboard.trendCoverage,
    nextDashboard.trendCoverage,
  );
  const correlatedMemecoins = reuseIfEqual(
    previousDashboard.correlatedMemecoins,
    nextDashboard.correlatedMemecoins,
  );

  if (
    ingestionHealth === previousDashboard.ingestionHealth &&
    dataStatus === previousDashboard.dataStatus &&
    blueskyOverview === previousDashboard.blueskyOverview &&
    trendCoverage === previousDashboard.trendCoverage &&
    correlatedMemecoins === previousDashboard.correlatedMemecoins &&
    reconciledEstablished === previousDashboard.leaderboards.established &&
    reconciledEmerging === previousDashboard.leaderboards.emerging &&
    reconciledLeaderboard === previousDashboard.leaderboard &&
    reconciledOverviewSeries === previousDashboard.overviewSeries &&
    reconciledDetail === previousDashboard.detail
  ) {
    return previousDashboard;
  }

  return {
    ...nextDashboard,
    ingestionHealth,
    dataStatus,
    blueskyOverview,
    trendCoverage,
    correlatedMemecoins,
    leaderboards: {
      established: reconciledEstablished,
      emerging: reconciledEmerging,
    },
    leaderboard: reconciledLeaderboard,
    overviewSeries: reconciledOverviewSeries,
    detail: reconciledDetail,
  };
}
