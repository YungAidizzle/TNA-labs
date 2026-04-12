import { getTrendDisplayNameOrPlaceholder } from "@/lib/dashboard/trend-name-state";
import { RankedTrend, RelatedTrend, TrendDashboardVM } from "@/types/view-models";

const TREND_COLORS = ["#5ee7ff", "#64f0a9", "#ffbe64", "#8ea2ff", "#ff7ca6", "#c6d4e7"];
const OVERVIEW_SERIES_LIMIT = 12;
const TOP_TRENDS_PER_BUCKET = 5;
const ALL_TRENDS_SERIES_ID = "all-trends-aggregate";
const ALL_TRENDS_SERIES_NAME = "All Trends Activity";
const ALL_TRENDS_SERIES_COLOR = "#8ea2ff";

export function pinTrendIntoRows(
  rows: RankedTrend[],
  pinnedTrend: RankedTrend | null | undefined,
  limit = rows.length,
) {
  if (limit <= 0) {
    return [];
  }

  const pinnedRows = rows.slice(0, limit);
  if (!pinnedTrend || pinnedRows.some((trend) => trend.id === pinnedTrend.id)) {
    return pinnedRows;
  }

  if (pinnedRows.length < limit) {
    pinnedRows.push(pinnedTrend);
    return pinnedRows;
  }

  pinnedRows.splice(pinnedRows.length - 1, 1, pinnedTrend);
  return pinnedRows;
}

function currentTopSeries(leaderboard: RankedTrend[], selectedId?: string) {
  const selected = selectedId ? leaderboard.find((trend) => trend.id === selectedId) : undefined;
  return pinTrendIntoRows(leaderboard, selected, OVERVIEW_SERIES_LIMIT);
}

function buildHistoricalOverviewSeries(leaderboard: RankedTrend[], selectedId?: string) {
  if (leaderboard.length === 0) {
    return [];
  }

  const candidates = leaderboard.filter((trend) =>
    trend.attentionHistory.some((point) => point.value > 0),
  );

  if (candidates.length === 0) {
    return currentTopSeries(leaderboard, selectedId);
  }

  const pointCount = candidates[0]?.attentionHistory.length ?? 0;
  if (pointCount === 0) {
    return currentTopSeries(leaderboard, selectedId);
  }

  const leaderCount = Math.min(TOP_TRENDS_PER_BUCKET, candidates.length);
  const leadershipScores = new Map<
    string,
    {
      trend: RankedTrend;
      score: number;
      bucketsLed: number;
      peak: number;
    }
  >();

  for (let bucketIndex = 0; bucketIndex < pointCount; bucketIndex += 1) {
    const leaders = candidates
      .map((trend) => ({
        trend,
        bucketValue: trend.attentionHistory[bucketIndex]?.value ?? 0,
      }))
      .filter((entry) => entry.bucketValue > 0)
      .sort((left, right) => {
        if (right.bucketValue !== left.bucketValue) {
          return right.bucketValue - left.bucketValue;
        }

        if (right.trend.attentionScore !== left.trend.attentionScore) {
          return right.trend.attentionScore - left.trend.attentionScore;
        }

        return left.trend.id.localeCompare(right.trend.id);
      })
      .slice(0, leaderCount);

    leaders.forEach((entry, rank) => {
      const rankWeight = leaderCount - rank;
      const existing = leadershipScores.get(entry.trend.id);
      const weightedScore = entry.bucketValue * rankWeight;

      if (existing) {
        existing.score += weightedScore;
        existing.bucketsLed += 1;
        existing.peak = Math.max(existing.peak, entry.bucketValue);
        return;
      }

      leadershipScores.set(entry.trend.id, {
        trend: entry.trend,
        score: weightedScore,
        bucketsLed: 1,
        peak: entry.bucketValue,
      });
    });
  }

  if (leadershipScores.size === 0) {
    return currentTopSeries(leaderboard, selectedId);
  }

  const selected = selectedId ? leaderboard.find((trend) => trend.id === selectedId) : undefined;
  const historicalTop = [...leadershipScores.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.bucketsLed !== left.bucketsLed) {
        return right.bucketsLed - left.bucketsLed;
      }

      if (right.peak !== left.peak) {
        return right.peak - left.peak;
      }

      if (right.trend.attentionScore !== left.trend.attentionScore) {
        return right.trend.attentionScore - left.trend.attentionScore;
      }

      return left.trend.id.localeCompare(right.trend.id);
    })
    .map((entry) => entry.trend);
  if (selected && !historicalTop.some((trend) => trend.id === selected.id)) {
    return [...historicalTop, selected];
  }

  return historicalTop;
}

function buildOverviewCandidates(vm: TrendDashboardVM) {
  return vm.leaderboard;
}

function buildAllTrendsAggregateHistory(rows: RankedTrend[]) {
  const totalsByTimestamp = new Map<string, number>();

  rows.forEach((trend) => {
    trend.attentionHistory.forEach((point) => {
      if (!point.timestamp || !Number.isFinite(point.value)) {
        return;
      }

      totalsByTimestamp.set(
        point.timestamp,
        (totalsByTimestamp.get(point.timestamp) ?? 0) + point.value,
      );
    });
  });

  return [...totalsByTimestamp.entries()]
    .sort((left, right) => Date.parse(left[0]) - Date.parse(right[0]))
    .map(([timestamp, value]) => ({
      timestamp,
      value,
    }));
}

function buildRelatedTrends(trend: RankedTrend, rows: RankedTrend[]): RelatedTrend[] {
  return rows
    .filter((row) => row.id !== trend.id && row.clusterId === trend.clusterId)
    .sort((left, right) => right.trendStrengthScore - left.trendStrengthScore)
    .slice(0, 4)
    .map((row) => ({
      id: row.id,
      name: getTrendDisplayNameOrPlaceholder(row),
      attentionScore: row.attentionScore,
      attentionInteractions: row.attentionInteractions,
      growthRate: row.growthRate,
      lifecycleStage: row.lifecycleStage,
    }));
}

export function applyTrendDashboardSelection(
  vm: TrendDashboardVM,
  selectedId?: string,
): TrendDashboardVM {
  const leaderboard = vm.leaderboard;
  if (leaderboard.length === 0) {
    return {
      ...vm,
      query: {
        ...vm.query,
        selectedId: undefined,
      },
      detail: null,
    };
  }

  const detailTrend = leaderboard.find((trend) => trend.id === selectedId) ?? leaderboard[0];
  const overviewCandidates = buildOverviewCandidates(vm);
  const overview = buildHistoricalOverviewSeries(overviewCandidates, detailTrend.id);
  const allTrendsAggregateHistory = buildAllTrendsAggregateHistory(overviewCandidates);
  const overviewSeries = [
    ...(allTrendsAggregateHistory.length > 0
      ? [
          {
            id: ALL_TRENDS_SERIES_ID,
            name: ALL_TRENDS_SERIES_NAME,
            selected: false,
            color: ALL_TRENDS_SERIES_COLOR,
            points: allTrendsAggregateHistory,
            window: null,
          },
        ]
      : []),
    ...overview.map((trend, index) => ({
      id: trend.id,
      name: getTrendDisplayNameOrPlaceholder(trend),
      selected: trend.id === detailTrend.id,
      color: TREND_COLORS[index % TREND_COLORS.length],
      points: trend.attentionHistory,
      window: null,
    })),
  ];

  return {
    ...vm,
    query: {
      ...vm.query,
      selectedId: detailTrend.id,
    },
    overviewSeries,
    detail: {
      trend: detailTrend,
      attentionGraph: detailTrend.attentionHistory,
      attentionWindow: null,
      platformBreakdown: detailTrend.platformBreakdown,
      topPosts: detailTrend.topPosts,
      relatedTrends: buildRelatedTrends(detailTrend, leaderboard),
      blueskyDetail: detailTrend.blueskyDetail ?? null,
    },
  };
}
