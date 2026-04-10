import { DateRangePreset, TrendScope } from "@/types/domain";
import {
  RankedTrend,
  TrendDashboardQuery,
  TrendDashboardVM,
  TrendDetailVM,
} from "@/types/view-models";

const RANGE_POINTS: Record<DateRangePreset, number> = {
  "1h": 12,
  "6h": 72,
  "24h": 288,
  "7d": 336,
};

const RANGE_STEP_MS: Record<DateRangePreset, number> = {
  "1h": 5 * 60 * 1000,
  "6h": 5 * 60 * 1000,
  "24h": 5 * 60 * 1000,
  "7d": 30 * 60 * 1000,
};

export function createZeroTimeSeries(range: DateRangePreset, now = new Date()) {
  const count = RANGE_POINTS[range];
  const stepMs = RANGE_STEP_MS[range];

  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(now.getTime() - (count - index - 1) * stepMs).toISOString(),
    value: 0,
  }));
}

export function createZeroRankedTrend(
  scope: TrendScope,
  range: DateRangePreset,
): RankedTrend {
  return {
    id: "",
    rank: 0,
    name: "",
    displayName: null,
    nameStatus: "pending",
    nameSource: "none",
    scope,
    source: "bluesky",
    labelType: "fallback_generated",
    canonicalKeySummary: null,
    labelQualityScore: 0,
    lowQualityLabel: false,
    leaderboardMode: "established",
    attentionScore: 0,
    breakoutScore: 0,
    velocityScore: 0,
    noveltyScore: 0,
    confirmationScore: 0,
    totalInteractions24h: 0,
    attentionInteractions: 0,
    rootsCount24h: 0,
    uniqueAuthors24h: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    isSingleton: false,
    confidenceScore: 0,
    seriesExpectedBucketCount: 0,
    seriesObservedBucketCount: 0,
    seriesObservedCoverageRatio: 0,
    seriesNonZeroBucketCount: 0,
    seriesPreviousWindowObservedBucketCount: 0,
    seriesRecentWindowObservedBucketCount: 0,
    seriesPreviousWindowCoverageRatio: 0,
    seriesRecentWindowCoverageRatio: 0,
    seriesPreviousAccelerationWindowObservedBucketCount: 0,
    seriesRecentAccelerationWindowObservedBucketCount: 0,
    seriesPreviousAccelerationWindowCoverageRatio: 0,
    seriesRecentAccelerationWindowCoverageRatio: 0,
    momentumSupportQualified: false,
    momentumTrustScore: 0,
    growthTrusted: false,
    accelerationTrusted: false,
    velocityTrusted: false,
    noveltyTrusted: false,
    attentionMetricTrusted: false,
    breakoutMomentumTrusted: false,
    freshnessScore: 0,
    freshnessState: "stale",
    sampleSize: 0,
    supportingThreadCount: 0,
    lowDataWarning: false,
    growthRate: 0,
    attentionAcceleration: 0,
    mentions: 0,
    platforms: [],
    platformSpread: 0,
    confirmedPlatformSpread: 0,
    attentionHistory: createZeroTimeSeries(range),
    platformBreakdown: [],
    topPosts: [],
    lifecycleStage: "Unknown",
    originPlatform: "bluesky",
    platformMigrationPath: [],
    attentionDrivers: [],
    hasSpike: false,
    spikeMagnitude: 0,
    clusterId: "",
    clusterName: "",
    trendStrengthScore: 0,
    persistenceScore: 0,
    isEarlyTrend: false,
    positionChange24h: 0,
    googleSearchInterest: null,
    linkedCoins: [],
    trendDescription: null,
    trendContextParagraph: null,
    trendNarrativeSummary: null,
    trendRawLabel: null,
    trendFallbackLabel: null,
    trendSummaryConfidence: null,
    trendEnrichmentStatus: null,
    trendEnrichmentAbstainReason: null,
    trendKeyEntities: null,
    trendEnrichment: null,
  };
}

export function createZeroTrendDetail(
  scope: TrendScope,
  range: DateRangePreset,
): TrendDetailVM {
  return {
    trend: createZeroRankedTrend(scope, range),
    attentionGraph: createZeroTimeSeries(range),
    attentionWindow: null,
    platformBreakdown: [],
    topPosts: [],
    relatedTrends: [],
  };
}

export function createZeroTrendDashboardVM(
  query: TrendDashboardQuery,
): TrendDashboardVM {
  return {
    query: {
      ...query,
      selectedId: undefined,
    },
    ingestionHealth: null,
    dataStatus: null,
    blueskyOverview: null,
    trendCoverage: null,
    correlatedMemecoins: null,
    leaderboards: {
      established: [],
      emerging: [],
    },
    leaderboard: [],
    overviewSeries: [],
    detail: null,
  };
}
