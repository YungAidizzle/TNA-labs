import "server-only";

import { rerankAiTrendsForNarrativeRelevance } from "@/lib/ai-trends/narrative-relevance";
import { getLatestSuccessfulAiTrendSnapshotView } from "@/lib/ai-trends/repository";
import type {
  GeneratedAiTrendCandidate,
  SharedAiTrendSnapshotItem,
} from "@/lib/ai-trends/types";
import { applyTrendDashboardSelection } from "@/lib/dashboard/selection";
import { createZeroRankedTrend, createZeroTimeSeries } from "@/lib/dashboard/zero-state";
import type {
  DashboardDataStatus,
  RankedTrend,
  TrendDashboardQuery,
  TrendDashboardVM,
} from "@/types/view-models";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function shouldUseSharedAiTrendSource() {
  return readBooleanEnv("USE_SHARED_AI_TREND_SOURCE", true);
}

function getFreshnessState(freshnessMinutes: number | null) {
  if (freshnessMinutes === null) {
    return "mixed" as const;
  }
  if (freshnessMinutes <= 90) {
    return "fresh" as const;
  }
  if (freshnessMinutes <= 240) {
    return "mixed" as const;
  }
  if (freshnessMinutes <= 720) {
    return "delayed" as const;
  }
  return "stale" as const;
}

type SharedAiNarrativeSourceItem = Pick<
  SharedAiTrendSnapshotItem,
  | "rank"
  | "trendKey"
  | "title"
  | "summary"
  | "confidenceScore"
  | "aiRankScore"
  | "importanceNote"
  | "category"
  | "sourceScope"
  | "sourceCount"
  | "generatedAt"
>;

function getLifecycleStage(rank: number) {
  if (rank <= 20) {
    return "Established" as const;
  }
  if (rank <= 60) {
    return "Expanding" as const;
  }
  return "Emerging" as const;
}

function estimateActivityCount(item: SharedAiNarrativeSourceItem) {
  const sourceCount = Math.max(1, item.sourceCount ?? 1);
  return Math.max(
    sourceCount,
    Math.round((101 - item.rank) * 18 + sourceCount * 12 + clamp(item.aiRankScore, 0, 100) * 4),
  );
}

function buildAttentionHistory(
  query: TrendDashboardQuery,
  item: SharedAiNarrativeSourceItem,
  generatedAt: string,
) {
  const total = estimateActivityCount(item);
  const base = createZeroTimeSeries(query.range, new Date(generatedAt));
  const floor = Math.max(1, Math.round(total * 0.45));

  return base.map((point, index) => {
    const progress = base.length <= 1 ? 1 : index / (base.length - 1);
    const curve = 0.6 + progress * 0.4;
    return {
      ...point,
      value: Math.max(1, Math.round(floor + (total - floor) * curve)),
    };
  });
}

function buildAiRankedTrend(
  item: SharedAiNarrativeSourceItem,
  query: TrendDashboardQuery,
  freshnessMinutes: number | null,
): RankedTrend {
  const estimatedActivity = estimateActivityCount(item);
  const confidenceScore = clamp(item.confidenceScore, 0, 100);
  const aiRankScore = clamp(item.aiRankScore || confidenceScore, 0, 100);
  const freshnessScore =
    freshnessMinutes === null ? 80 : clamp(100 - freshnessMinutes / 1.2, 25, 100);
  const platforms = item.sourceScope?.toLowerCase().includes("niche")
    ? (["news"] as const)
    : (["news", "google"] as const);
  const sourceCount = Math.max(1, item.sourceCount ?? 1);
  const row = createZeroRankedTrend(query.scope, query.range);

  return {
    ...row,
    id: `shared-ai:${item.trendKey}`,
    rank: item.rank,
    name: item.title,
    displayName: item.title,
    nameStatus: "ready",
    nameSource: "ai_exact",
    scope: query.scope,
    source: "mixed",
    labelType: "ai_generated",
    canonicalKeySummary: item.trendKey,
    labelQualityScore: aiRankScore,
    lowQualityLabel: false,
    leaderboardMode: "established",
    attentionScore: aiRankScore,
    breakoutScore: clamp(aiRankScore * 0.9 + freshnessScore * 0.1, 0, 100),
    velocityScore: clamp(aiRankScore * 0.7 + freshnessScore * 0.3, 0, 100),
    noveltyScore: clamp((101 - item.rank) * 0.7 + freshnessScore * 0.3, 0, 100),
    confirmationScore: clamp(confidenceScore * 0.75 + sourceCount * 0.9, 0, 100),
    totalInteractions24h: estimatedActivity,
    attentionInteractions: estimatedActivity,
    rootsCount24h: estimatedActivity,
    uniqueAuthors24h: Math.max(10, Math.round(estimatedActivity * 0.18)),
    firstSeenAt: item.generatedAt,
    lastSeenAt: item.generatedAt,
    isSingleton: false,
    trendCategory: item.category,
    confidenceScore,
    freshnessScore,
    freshnessState: getFreshnessState(freshnessMinutes),
    sampleSize: sourceCount,
    supportingThreadCount: estimatedActivity,
    lowDataWarning: sourceCount < 4,
    growthRate: clamp(65 + aiRankScore * 0.25 - item.rank * 0.2, 0, 100),
    attentionAcceleration: clamp(55 + aiRankScore * 0.2 - item.rank * 0.15, 0, 100),
    mentions: estimatedActivity,
    platforms: [...platforms],
    platformSpread: platforms.length,
    confirmedPlatformSpread: platforms.length,
    attentionHistory: buildAttentionHistory(query, item, item.generatedAt),
    platformBreakdown: platforms.map((platformId, index) => ({
      platformId,
      interactions:
        index === 0 ? Math.round(estimatedActivity * 0.7) : Math.round(estimatedActivity * 0.3),
      sharePct: index === 0 ? 70 : 30,
    })),
    topPosts: [],
    lifecycleStage: getLifecycleStage(item.rank),
    originPlatform: "news",
    platformMigrationPath: [],
    attentionDrivers: platforms.map((platformId, index) => ({
      platformId,
      contributionPct: index === 0 ? 70 : 30,
      deltaPct: index === 0 ? clamp(Math.round(aiRankScore * 0.2), 0, 100) : 0,
    })),
    hasSpike: item.rank <= 10,
    spikeMagnitude: item.rank <= 10 ? clamp(100 - item.rank * 4, 0, 100) : 0,
    clusterId: item.trendKey,
    clusterName: item.title,
    trendStrengthScore: aiRankScore,
    persistenceScore: clamp(confidenceScore * 0.65 + sourceCount * 1.1, 0, 100),
    isEarlyTrend: item.rank > 50,
    positionChange24h: 0,
    googleSearchInterest: {
      score: clamp(aiRankScore, 0, 100),
      approxTrafficLabel: item.sourceScope ?? null,
      matchedQueries: [item.title],
      queryCount: 1,
    },
    trendDescription: item.summary,
    trendContextParagraph: item.importanceNote ?? item.summary,
    trendNarrativeSummary: item.summary,
    trendRawLabel: item.title,
    trendFallbackLabel: item.title,
    trendSummaryConfidence: confidenceScore,
    trendEnrichmentStatus: "ok",
    trendEnrichmentAbstainReason: null,
    trendKeyEntities: null,
    trendEnrichment: null,
  };
}

function rerankSharedAiSnapshotItems(
  items: SharedAiTrendSnapshotItem[],
): {
  items: SharedAiNarrativeSourceItem[];
  rejectedReason: string | null;
} {
  const generatedItems: GeneratedAiTrendCandidate[] = items.map((item) => ({
    rank: item.rank,
    trendKey: item.trendKey,
    title: item.title,
    summary: item.summary,
    confidenceScore: item.confidenceScore,
    aiRankScore: item.aiRankScore,
    importanceNote: item.importanceNote,
    category: item.category,
    sourceScope: item.sourceScope,
    sourceCount: item.sourceCount,
  }));
  const reranked = rerankAiTrendsForNarrativeRelevance(generatedItems);

  return {
    rejectedReason: reranked.rejectedReason,
    items: reranked.trends.map((trend, index) => ({
      rank: index + 1,
      trendKey: trend.trendKey,
      title: trend.title,
      summary: trend.summary,
      confidenceScore: trend.confidenceScore,
      aiRankScore: trend.aiRankScore,
      importanceNote: trend.importanceNote,
      category: trend.category,
      sourceScope: trend.sourceScope,
      sourceCount: trend.sourceCount,
      generatedAt: items[0]?.generatedAt ?? new Date().toISOString(),
    })),
  };
}

function mergeDataStatus(
  baseStatus: DashboardDataStatus | null | undefined,
  generatedAt: string,
): DashboardDataStatus {
  if (!baseStatus) {
    return {
      stateSource: "supabase_live",
      bundleOrigin: null,
      showing: "supabase_live",
      serverNow: new Date().toISOString(),
      responseVersion: null,
      runtimeSnapshotGeneratedAt: null,
      sourceSnapshotGeneratedAt: generatedAt,
      latestFetchedAt: generatedAt,
      runtimeSnapshotAvailable: false,
      localRawDataAvailable: false,
      runtimeSnapshotStale: false,
      sourceFreshness: [],
      refresh: null,
      timings: null,
    };
  }

  return {
    ...baseStatus,
    serverNow: new Date().toISOString(),
    sourceSnapshotGeneratedAt: generatedAt,
    latestFetchedAt: generatedAt,
    refresh: null,
  };
}

export async function getSharedAiTrendDashboardState(
  query: TrendDashboardQuery,
  baseState: TrendDashboardVM,
): Promise<TrendDashboardVM | null> {
  if (!shouldUseSharedAiTrendSource()) {
    return null;
  }

  const view = await getLatestSuccessfulAiTrendSnapshotView();
  if (!view.snapshot || view.trends.length === 0) {
    return null;
  }

  const rerankedSnapshot = rerankSharedAiSnapshotItems(view.trends);
  if (rerankedSnapshot.rejectedReason) {
    console.warn("[ai-trend-source] shared AI snapshot rejected by narrative relevance gate", {
      snapshotId: view.snapshot.id,
      reason: rerankedSnapshot.rejectedReason,
    });
    return null;
  }

  const established = rerankedSnapshot.items.map((item) =>
    buildAiRankedTrend(item, query, view.freshnessMinutes),
  );
  const emerging = established.slice(0, 40).map((row) => ({
    ...row,
    leaderboardMode: "emerging" as const,
    isEarlyTrend: true,
  }));

  return applyTrendDashboardSelection(
    {
      ...baseState,
      query: {
        ...query,
        mode: query.mode ?? "established",
      },
      blueskyOverview: null,
      trendCoverage: null,
      dataStatus: mergeDataStatus(baseState.dataStatus, view.snapshot.generatedAt),
      leaderboards: {
        established,
        emerging,
      },
      leaderboard: established,
    },
    query.selectedId,
  );
}
