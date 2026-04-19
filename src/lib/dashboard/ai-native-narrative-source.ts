import "server-only";

import { getAiNativeNarrativeConfig } from "@/lib/ai-native-narratives/config";
import { getLatestSuccessfulAiNativeNarrativeRunView } from "@/lib/ai-native-narratives/repository";
import type { StoredAiNativeNarrative } from "@/lib/ai-native-narratives/types";
import { createZeroTrendDashboardVM } from "@/lib/dashboard/zero-state";
import type {
  DashboardDataStatus,
  RankedTrend,
  TrendAiEnrichment,
  TrendDashboardQuery,
  TrendDashboardVM,
} from "@/types/view-models";

function sortRows(rows: RankedTrend[], query: TrendDashboardQuery) {
  const compare = (() => {
    switch (query.sort) {
      case "mentions":
      case "posts":
        return (left: RankedTrend, right: RankedTrend) =>
          right.trendStrengthScore - left.trendStrengthScore ||
          right.attentionScore - left.attentionScore ||
          (right.supportingThreadCount ?? 0) - (left.supportingThreadCount ?? 0) ||
          right.rank - left.rank;
      case "attention":
      case "strength":
        return (left: RankedTrend, right: RankedTrend) =>
          right.trendStrengthScore - left.trendStrengthScore ||
          right.attentionScore - left.attentionScore ||
          right.confidenceScore - left.confidenceScore ||
          left.rank - right.rank;
      case "growth":
      case "breakout":
      case "velocity":
      case "novelty":
      case "confirmation":
      default:
        return (left: RankedTrend, right: RankedTrend) =>
          right.velocityScore! - left.velocityScore! ||
          right.trendStrengthScore - left.trendStrengthScore ||
          right.confidenceScore - left.confidenceScore ||
          left.rank - right.rank;
    }
  })();

  return [...rows]
    .sort(compare)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildNarrativeScores(row: StoredAiNativeNarrative) {
  const memeScore = Math.max(0, Math.min(100, row.memeScore));
  const confidenceScore = Math.max(0, Math.min(100, row.confidence * 100));
  const evidenceSupport = Math.max(
    0,
    Math.min(100, row.evidenceCount * 10 + row.sourceCount * 5),
  );
  const memecoinStrength = clampPercent(memeScore * Math.max(row.confidence, 0.1));
  const attentionScore = clampPercent(memecoinStrength * 0.8 + evidenceSupport * 0.2);

  return {
    memeScore,
    confidenceScore,
    evidenceSupport,
    memecoinStrength,
    attentionScore,
    breakoutScore: clampPercent(memecoinStrength * 0.75 + memeScore * 0.25),
    noveltyScore: clampPercent(memeScore * 0.7 + confidenceScore * 0.3),
    velocityScore: clampPercent(memecoinStrength * 0.65 + evidenceSupport * 0.35),
  };
}

function buildNarrativeEnrichment(
  row: StoredAiNativeNarrative,
  generatedAt: string,
  modelName: string,
  promptVersion: string,
): TrendAiEnrichment {
  return {
    rawLabel: row.canonicalName,
    status: "ok",
    canonicalName: row.canonicalName,
    aiDisplayName: row.canonicalName,
    fallbackLabel: row.canonicalName,
    nameStatus: "ready",
    aiNameStatus: "ready",
    nameSource: "ai_exact",
    shortDescription: row.summary,
    contextParagraph: row.researchSummary,
    narrativeSummary: row.summary,
    whyAttention: row.memeReason,
    evidencePostIds: row.evidenceKeys,
    keyEntities: row.keyEntities,
    trendCategory: row.status === "watch" ? "memecoin_watch" : "memecoin_candidate",
    mixedSignals: [],
    abstainReason: null,
    summaryConfidence: row.confidence,
    modelName,
    promptVersion,
    generatedAt,
    refreshedAt: row.updatedAt,
    aiNameGeneratedAt: generatedAt,
    aiNameRefreshedAt: row.updatedAt,
    aiNameSourceVersion: promptVersion,
  };
}

function mapNarrativeToRankedTrend(
  row: StoredAiNativeNarrative,
  scope: TrendDashboardQuery["scope"],
  generatedAt: string,
  modelName: string,
  promptVersion: string,
): RankedTrend {
  const enrichment = buildNarrativeEnrichment(row, generatedAt, modelName, promptVersion);
  const scores = buildNarrativeScores(row);
  const ageHours = (() => {
    const firstSeen = Date.parse(row.firstSeenAt ?? "");
    if (!Number.isFinite(firstSeen)) {
      return null;
    }

    return Math.max(0, (Date.now() - firstSeen) / 3_600_000);
  })();

  return {
    id: row.canonicalId,
    rank: row.rank,
    name: row.canonicalName,
    displayName: row.canonicalName,
    nameStatus: "ready",
    nameSource: "ai_exact",
    trendDescription: row.summary,
    trendContextParagraph: row.researchSummary,
    trendNarrativeSummary: row.summary,
    trendRawLabel: row.canonicalName,
    trendFallbackLabel: row.canonicalName,
    trendSummaryConfidence: row.confidence,
    trendEnrichmentStatus: "ok",
    trendEnrichmentAbstainReason: null,
    trendKeyEntities: row.keyEntities,
    trendEnrichment: enrichment,
    scope,
    source: "mixed",
    labelType: "ai_generated",
    groupingSource: "ai_semantic_cluster",
    leaderboardTier: "primary_grouped",
    canonicalKeySummary: row.canonicalId,
    labelQualityScore: 1,
    lowQualityLabel: false,
    aiAssisted: true,
    leaderboardMode: "established",
    attentionScore: scores.attentionScore,
    emergingScore: scores.breakoutScore,
    breakoutScore: scores.breakoutScore,
    velocityScore: scores.velocityScore,
    noveltyScore: scores.noveltyScore,
    confirmationScore: scores.memecoinStrength,
    totalInteractions24h: row.evidenceCount,
    qualityAdjustedScore: scores.attentionScore,
    attentionInteractions: row.evidenceCount,
    rootsCount24h: row.evidenceCount,
    uniqueAuthors24h: 0,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    isSingleton: false,
    trendCategory: row.status === "watch" ? "memecoin_watch" : "memecoin_candidate",
    contentType: "open_web_memecoin",
    spamLikelihood: 0,
    templateLikelihood: 0,
    contextualCoherence: row.confidence,
    lowInformation: false,
    templateSeries: false,
    seriesExpectedBucketCount: 1,
    seriesObservedBucketCount: 1,
    seriesObservedCoverageRatio: 1,
    seriesNonZeroBucketCount: 1,
    seriesPreviousWindowObservedBucketCount: 0,
    seriesRecentWindowObservedBucketCount: 1,
    seriesPreviousWindowCoverageRatio: 0,
    seriesRecentWindowCoverageRatio: 1,
    seriesPreviousAccelerationWindowObservedBucketCount: 0,
    seriesRecentAccelerationWindowObservedBucketCount: 1,
    seriesPreviousAccelerationWindowCoverageRatio: 0,
    seriesRecentAccelerationWindowCoverageRatio: 1,
    momentumSupportQualified: true,
    momentumTrustScore: row.confidence,
    growthTrusted: true,
    accelerationTrusted: true,
    velocityTrusted: true,
    noveltyTrusted: true,
    attentionMetricTrusted: true,
    breakoutMomentumTrusted: true,
    confidenceScore: scores.confidenceScore,
    freshnessScore: 100,
    freshnessState: "fresh",
    sampleSize: row.sourceCount,
    supportingThreadCount: row.evidenceCount,
    lowDataWarning: row.evidenceCount < 3,
    growthRate: scores.breakoutScore,
    attentionAcceleration: scores.velocityScore,
    mentions: row.evidenceCount,
    platforms: ["news", "google"],
    platformSpread: 2,
    confirmedPlatformSpread: 2,
    attentionHistory: [],
    platformBreakdown: [
      { platformId: "news", interactions: row.evidenceCount, sharePct: 70 },
      { platformId: "google", interactions: row.sourceCount, sharePct: 30 },
    ],
    topPosts: [],
    lifecycleStage:
      ageHours !== null && ageHours <= 24
        ? "Emerging"
        : ageHours !== null && ageHours <= 72
          ? "Expanding"
          : "Established",
    originPlatform: "news",
    platformMigrationPath: ["news", "google"],
    attentionDrivers: [
      { platformId: "news", contributionPct: 55, deltaPct: 0 },
      { platformId: "google", contributionPct: 45, deltaPct: 0 },
    ],
    hasSpike: scores.memecoinStrength >= 75,
    spikeMagnitude: scores.memecoinStrength,
    clusterId: row.canonicalId,
    clusterName: row.canonicalName,
    clusterTopicKeys: row.candidateKeys,
    trendStrengthScore: scores.memecoinStrength,
    persistenceScore: scores.attentionScore,
    isEarlyTrend: ageHours !== null ? ageHours <= 24 : false,
    positionChange24h: 0,
    googleSearchInterest: {
      score: clampPercent(row.memeScore),
      approxTrafficLabel: `${row.sourceCount} sources • meme ${clampPercent(row.memeScore)}`,
      matchedQueries: row.keyEntities.slice(0, 3),
      queryCount: row.keyEntities.length,
    },
    linkedCoins: [],
    blueskySummary: null,
    blueskyDetail: null,
  };
}

function buildDataStatus(
  runGeneratedAt: string,
  latestFetchedAt: string | null,
  freshnessMinutes: number | null,
  itemCount: number,
): DashboardDataStatus {
  const config = getAiNativeNarrativeConfig();
  const sourceStatus =
    freshnessMinutes !== null && freshnessMinutes > config.freshnessWindowMinutes ? "stale" : "fresh";

  return {
    stateSource: "ai_native_canonical",
    bundleOrigin: null,
    showing: "ai_native_canonical",
    serverNow: new Date().toISOString(),
    runtimeSnapshotGeneratedAt: null,
    sourceSnapshotGeneratedAt: runGeneratedAt,
    latestFetchedAt,
    runtimeSnapshotAvailable: false,
    localRawDataAvailable: false,
    runtimeSnapshotStale: false,
    sourceFreshness: [
      {
        sourceId: "openai:web:memecoin-narratives",
        sourceLabel: "OpenAI web memecoin narrative discovery",
        platformId: "news",
        sourceStatus,
        itemCount,
        lastFetchedAt: latestFetchedAt,
        latestCreatedAt: runGeneratedAt,
        ageMinutes: freshnessMinutes,
      },
    ],
    refresh: null,
    timings: null,
    freshnessDiagnostics: {
      latestIngestionAt: null,
      latestProcessedAt: null,
      latestMentionEventAt: null,
      latestReadModelFinalizeAt: null,
      latestReadModelRollingWriteAt: null,
      latestReadModelSeriesWriteAt: null,
      latestReadModelWindowEndAt: null,
      latestSeriesNonZeroBucketAt: null,
      workerRunStartedAt: null,
      workerRunStatus: null,
      workerLastEventAt: null,
      workerRowsInserted: null,
      workerHeartbeatAt: null,
      workerCurrentStage: null,
      workerLastSuccessfulWriteAt: null,
      maxSourceTimestampSeen: null,
      maxWrittenTimestamp: null,
      maxProcessedTimestamp: null,
      maxAggregateTimestamp: null,
      pipelineLagSeconds: null,
      backlogSize: null,
      unprocessedBacklogSize: null,
      pipelineHealthState: sourceStatus === "stale" ? "stale" : "live",
      apiResponseAt: new Date().toISOString(),
      sourceSnapshotAt: runGeneratedAt,
      selectedTrendLatestDataAt: null,
      selectedTrendLatestPointAt: null,
      renderedStaleReferenceAt: runGeneratedAt,
      renderedStaleReferenceSource: "source_snapshot",
      chainBreakStage: "none",
      agesMinutes: {
        ingestion: null,
        processed: null,
        mentionEvent: null,
        readModelFinalize: null,
        readModelWrite: null,
        readModelWindowEnd: null,
        workerLastEvent: null,
        sourceSnapshot: freshnessMinutes,
        selectedLatestPoint: null,
        selectedLatestData: null,
        renderedStaleReference: freshnessMinutes,
      },
    },
  };
}

export async function getAiNativeNarrativeDashboardState(
  query: TrendDashboardQuery,
): Promise<TrendDashboardVM> {
  const zero = createZeroTrendDashboardVM(query);
  const view = await getLatestSuccessfulAiNativeNarrativeRunView();
  if (!view.run) {
    const dataStatus: DashboardDataStatus = {
      stateSource: "zero_state",
      bundleOrigin: null,
      showing: "zero_state",
      serverNow: new Date().toISOString(),
      runtimeSnapshotGeneratedAt: null,
      sourceSnapshotGeneratedAt: null,
      latestFetchedAt: null,
      runtimeSnapshotAvailable: false,
      localRawDataAvailable: false,
      runtimeSnapshotStale: false,
      sourceFreshness: [],
      refresh: null,
      timings: null,
    };

    return {
      ...zero,
      dataStatus,
    };
  }

  const established = sortRows(
    view.narratives.map((row) =>
      mapNarrativeToRankedTrend(
        row,
        query.scope,
        view.run!.generatedAt,
        view.run!.modelName,
        view.run!.promptVersion,
      ),
    ),
    query,
  );
  const emerging = established.filter((row) => row.isEarlyTrend);
  const leaderboard = (query.mode ?? "established") === "emerging" ? emerging : established;

  return {
    ...zero,
    query: {
      ...query,
      mode: query.mode ?? "established",
    },
    dataStatus: buildDataStatus(
      view.run.generatedAt,
      view.run.completedAt ?? view.run.generatedAt,
      view.freshnessMinutes,
      leaderboard.length,
    ),
    leaderboards: {
      established,
      emerging,
    },
    leaderboard,
  };
}
