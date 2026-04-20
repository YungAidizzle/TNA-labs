import "server-only";

import { getAiNativeNarrativeConfig } from "@/lib/ai-native-narratives/config";
import { getLatestSuccessfulAiNativeNarrativeRunView } from "@/lib/ai-native-narratives/repository";
import {
  AI_NATIVE_NARRATIVE_SCHEDULER_LABEL,
  AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY,
} from "@/lib/ai-native-narratives/scheduler";
import type {
  AiNativeNarrativeRunView,
  StoredAiNativeNarrative,
  StoredAiNativeNarrativeRun,
} from "@/lib/ai-native-narratives/types";
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

function ageMinutesFromIso(value: string | null | undefined) {
  const timestamp = Date.parse(value ?? "");
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
}

function getRunNoteString(
  run: StoredAiNativeNarrativeRun | null | undefined,
  key: string,
) {
  const value = run?.notesJson?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildNarrativeScores(row: StoredAiNativeNarrative) {
  const memeScore = Math.max(0, Math.min(100, row.memeScore));
  const visualScore = Math.max(0, Math.min(100, row.visualScore));
  const drynessScore = Math.max(0, Math.min(100, row.drynessScore));
  const confidenceScore = Math.max(0, Math.min(100, row.confidence * 100));
  const evidenceSupport = Math.max(
    0,
    Math.min(100, row.evidenceCount * 10 + row.sourceCount * 5),
  );
  const archetypeBoost =
    row.memeArchetype === "mascot"
      ? 10
      : row.memeArchetype === "visual_absurdity"
        ? 8
        : row.memeArchetype === "catchphrase"
          ? 6
          : row.memeArchetype === "personality"
            ? 4
            : row.memeArchetype === "community_joke"
              ? 3
              : row.memeArchetype === "political_meme"
                ? -4
                : row.memeArchetype === "tech_drama"
                  ? -2
                  : 0;
  const memecoinStrength = clampPercent(
    memeScore * 0.42 +
      visualScore * 0.18 +
      confidenceScore * 0.2 +
      evidenceSupport * 0.12 +
      archetypeBoost -
      drynessScore * 0.18,
  );
  const attentionScore = clampPercent(memecoinStrength * 0.78 + evidenceSupport * 0.22);

  return {
    memeScore,
    visualScore,
    drynessScore,
    confidenceScore,
    evidenceSupport,
    memecoinStrength,
    attentionScore,
    breakoutScore: clampPercent(memecoinStrength * 0.72 + visualScore * 0.18 + memeScore * 0.1),
    noveltyScore: clampPercent(memeScore * 0.42 + visualScore * 0.24 + confidenceScore * 0.22 - drynessScore * 0.12),
    velocityScore: clampPercent(memecoinStrength * 0.6 + evidenceSupport * 0.28 + visualScore * 0.12),
  };
}

function buildNarrativeEnrichment(
  row: StoredAiNativeNarrative,
  generatedAt: string | null,
  modelName: string | null,
  promptVersion: string | null,
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
    trendCategory:
      row.status === "watch" ? `memecoin_watch:${row.memeArchetype}` : `memecoin_candidate:${row.memeArchetype}`,
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
  fallbackGeneratedAt: string | null,
  fallbackModelName: string | null,
  fallbackPromptVersion: string | null,
): RankedTrend {
  const generatedAt = row.runGeneratedAt ?? fallbackGeneratedAt;
  const modelName = row.runModelName ?? fallbackModelName;
  const promptVersion = row.runPromptVersion ?? fallbackPromptVersion;
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
    trendCategory:
      row.status === "watch" ? `memecoin_watch:${row.memeArchetype}` : `memecoin_candidate:${row.memeArchetype}`,
    contentType: `open_web_memecoin:${row.memeArchetype}`,
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
  view: AiNativeNarrativeRunView,
  itemCount: number,
): DashboardDataStatus {
  const config = getAiNativeNarrativeConfig();
  const latestSuccessfulRun = view.run;
  const latestRun = view.latestRun;
  const latestFailureRun = view.latestFailureRun;
  const runGeneratedAt = latestSuccessfulRun?.generatedAt ?? null;
  const latestFetchedAt =
    latestSuccessfulRun?.completedAt ?? latestSuccessfulRun?.generatedAt ?? null;
  const freshnessMinutes = view.freshnessMinutes;
  const sourceStatus =
    freshnessMinutes !== null && freshnessMinutes > config.freshnessWindowMinutes ? "stale" : "fresh";
  const latestRunCompletedAt = latestRun?.completedAt ?? latestRun?.generatedAt ?? null;
  const schedulerStrategy =
    getRunNoteString(latestRun, "schedulerStrategy") ?? AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY;
  const schedulerLabel =
    getRunNoteString(latestRun, "schedulerLabel") ?? AI_NATIVE_NARRATIVE_SCHEDULER_LABEL;
  const servingMode = sourceStatus === "stale" ? "stale_fallback" : "fresh";
  const pipelineHealthState = !latestSuccessfulRun
    ? latestRun?.status === "failed"
      ? "disconnected"
      : "stale"
    : latestRun?.status === "failed" && sourceStatus === "stale"
      ? "stale"
      : latestRun?.status === "failed"
        ? "degraded"
        : sourceStatus === "stale"
          ? "stale"
          : "live";
  const chainBreakStage =
    latestRun?.status === "failed" && sourceStatus === "stale" ? "read_model_refresh" : "none";
  const boardServedNarrativeCount = itemCount;

  return {
    stateSource: "ai_native_canonical",
    bundleOrigin: null,
    servingMode,
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
      workerRunStartedAt: latestRun?.generatedAt ?? null,
      workerRunStatus: latestRun?.status ?? null,
      workerLastEventAt: latestRunCompletedAt,
      workerRowsInserted:
        latestRun?.status === "succeeded" ? latestRun.narrativeCount : latestSuccessfulRun?.narrativeCount ?? null,
      workerHeartbeatAt: null,
      workerCurrentStage: null,
      workerLastSuccessfulWriteAt:
        latestSuccessfulRun?.completedAt ?? latestSuccessfulRun?.generatedAt ?? null,
      maxSourceTimestampSeen: null,
      maxWrittenTimestamp: null,
      maxProcessedTimestamp: null,
      maxAggregateTimestamp: null,
      pipelineLagSeconds: null,
      backlogSize: null,
      unprocessedBacklogSize: null,
      pipelineHealthState,
      latestRunId: latestRun?.id ?? null,
      latestRunAt: latestRun?.generatedAt ?? null,
      latestRunCompletedAt,
      latestRunStatus: latestRun?.status ?? null,
      latestRunTrigger: latestRun?.trigger ?? null,
      latestRunErrorMessage: latestRun?.errorMessage ?? null,
      latestRunRuntimePath: getRunNoteString(latestRun, "runtimePath"),
      latestRunExecutionEnvironment: getRunNoteString(latestRun, "executionEnvironment"),
      latestRunCandidateCount: latestRun?.candidateCount ?? null,
      latestRunEvidenceCount: latestRun?.evidenceCount ?? null,
      latestRunNarrativeCount: latestRun?.narrativeCount ?? null,
      latestSuccessfulRunId: latestSuccessfulRun?.id ?? null,
      latestSuccessfulRunAt: latestSuccessfulRun?.generatedAt ?? null,
      latestSuccessfulRunCompletedAt:
        latestSuccessfulRun?.completedAt ?? latestSuccessfulRun?.generatedAt ?? null,
      latestSuccessfulRunCandidateCount: latestSuccessfulRun?.candidateCount ?? null,
      latestSuccessfulRunEvidenceCount: latestSuccessfulRun?.evidenceCount ?? null,
      latestSuccessfulRunNarrativeCount: latestSuccessfulRun?.narrativeCount ?? null,
      latestSuccessfulTrigger: latestSuccessfulRun?.trigger ?? null,
      latestSuccessfulRuntimePath: getRunNoteString(latestSuccessfulRun, "runtimePath"),
      latestSuccessfulExecutionEnvironment: getRunNoteString(
        latestSuccessfulRun,
        "executionEnvironment",
      ),
      latestFailureRunId: latestFailureRun?.id ?? null,
      latestFailureAt: latestFailureRun?.generatedAt ?? null,
      latestFailureTrigger: latestFailureRun?.trigger ?? null,
      latestFailureErrorMessage: latestFailureRun?.errorMessage ?? null,
      latestFailureRuntimePath: getRunNoteString(latestFailureRun, "runtimePath"),
      latestFailureExecutionEnvironment: getRunNoteString(
        latestFailureRun,
        "executionEnvironment",
      ),
      boardTargetCount: view.boardTargetCount,
      boardServedNarrativeCount,
      boardFreshNarrativeCount: view.boardFreshCount,
      boardBackfillNarrativeCount: view.boardBackfillCount,
      schedulerStrategy,
      schedulerLabel,
      schedulerExpectedIntervalSeconds: config.refreshIntervalSeconds,
      cronAuthorizationConfigured: config.cronSecrets.length > 0,
      cronSecretSources: config.cronSecretNames,
      apiResponseAt: new Date().toISOString(),
      sourceSnapshotAt: runGeneratedAt,
      selectedTrendLatestDataAt: null,
      selectedTrendLatestPointAt: null,
      renderedStaleReferenceAt: runGeneratedAt,
      renderedStaleReferenceSource: "source_snapshot",
      chainBreakStage,
      agesMinutes: {
        ingestion: null,
        processed: null,
        mentionEvent: null,
        readModelFinalize: null,
        readModelWrite: null,
        readModelWindowEnd: null,
        workerLastEvent: ageMinutesFromIso(latestRunCompletedAt),
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
      servingMode: "empty",
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
      freshnessDiagnostics: buildDataStatus(view, 0).freshnessDiagnostics,
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
        view.run?.generatedAt ?? null,
        view.run?.modelName ?? null,
        view.run?.promptVersion ?? null,
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
    dataStatus: buildDataStatus(view, leaderboard.length),
    leaderboards: {
      established,
      emerging,
    },
    leaderboard,
  };
}
