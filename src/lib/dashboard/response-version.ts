import { TrendDashboardVM } from "@/types/view-models";

function pickTopIds(rows: TrendDashboardVM["leaderboard"], limit: number) {
  return rows.slice(0, limit).map((row) => row.id);
}

function pickTopInteractionSummary(rows: TrendDashboardVM["leaderboard"], limit: number) {
  return rows.slice(0, limit).map((row) => ({
    id: row.id,
    totalInteractions24h: row.totalInteractions24h ?? row.attentionInteractions,
    rootsCount24h: row.rootsCount24h ?? null,
    uniqueAuthors24h: row.uniqueAuthors24h ?? null,
    lastSeenAt: row.lastSeenAt ?? null,
    linkedCoinCount: row.linkedCoins?.length ?? 0,
    topLinkedCoins: (row.linkedCoins ?? []).slice(0, 3).map((coin) => ({
      id: coin.id,
      confidence: coin.confidence,
    })),
  }));
}

function summarizeSeries(series: TrendDashboardVM["overviewSeries"], limit: number) {
  return series.slice(0, limit).map((item) => ({
    id: item.id,
    selected: item.selected,
    pointCount: item.points.length,
    firstPoint: item.points[0] ?? null,
    lastPoint: item.points.at(-1) ?? null,
    window: item.window ?? null,
  }));
}

function summarizeDetail(state: TrendDashboardVM) {
  if (!state.detail) {
    return null;
  }

  return {
    trendId: state.detail.trend.id,
    attentionPointCount: state.detail.attentionGraph.length,
    attentionFirstPoint: state.detail.attentionGraph[0] ?? null,
    attentionLastPoint: state.detail.attentionGraph.at(-1) ?? null,
    attentionWindow: state.detail.attentionWindow ?? null,
    topPostIds: state.detail.topPosts.slice(0, 5).map((post) => post.id),
    relatedTrendIds: state.detail.relatedTrends.slice(0, 5).map((trend) => trend.id),
    linkedCoinCount: state.detail.trend.linkedCoins?.length ?? 0,
    linkedCoins: (state.detail.trend.linkedCoins ?? []).slice(0, 5).map((coin) => ({
      id: coin.id,
      confidence: coin.confidence,
    })),
  };
}

export function buildTrendDashboardResponseVersion(state: TrendDashboardVM) {
  const dataStatus = state.dataStatus;
  const payload = JSON.stringify({
    scope: state.query.scope,
    range: state.query.range,
    mode: state.query.mode ?? "established",
    sort: state.query.sort,
    selectedId: state.query.selectedId ?? null,
    stateSource: dataStatus?.stateSource ?? null,
    bundleOrigin: dataStatus?.bundleOrigin ?? null,
    showing: dataStatus?.showing ?? null,
    sourceSnapshotGeneratedAt: dataStatus?.sourceSnapshotGeneratedAt ?? null,
    leaderboardCount: state.leaderboard.length,
    establishedCount: state.leaderboards.established.length,
    emergingCount: state.leaderboards.emerging.length,
    topIds: pickTopIds(state.leaderboard, 8),
    topInteractions: pickTopInteractionSummary(state.leaderboard, 8),
    establishedTopIds: pickTopIds(state.leaderboards.established, 8),
    emergingTopIds: pickTopIds(state.leaderboards.emerging, 8),
    correlatedMemecoins: state.correlatedMemecoins
      ? {
          runId: state.correlatedMemecoins.runId,
          updatedAt: state.correlatedMemecoins.updatedAt,
          rowCount: state.correlatedMemecoins.rows.length,
          topRows: state.correlatedMemecoins.rows.slice(0, 5).map((row) => ({
            id: row.id,
            rank: row.rank,
            symbol: row.symbol,
            strongestTrendKey: row.strongestTrendKey,
            correlationScore: row.correlationScore,
            supportPostCount: row.links?.[0]?.supportPostCount ?? 0,
            linkCount: row.links?.length ?? 0,
          })),
        }
      : null,
    trendCoverage: state.trendCoverage
        ? {
          totalInteractionsInWindow: state.trendCoverage.totalInteractionsInWindow,
          eligibleRootsCount: state.trendCoverage.eligibleRootsCount,
          totalInteractionsAssignedToTrends:
            state.trendCoverage.totalInteractionsAssignedToTrends,
          unassignedInteractionsCount: state.trendCoverage.unassignedInteractionsCount,
          nonAiAssignedRootCount: state.trendCoverage.nonAiAssignedRootCount,
          groupedRootsCount: state.trendCoverage.groupedRootsCount,
          singletonRootsCount: state.trendCoverage.singletonRootsCount,
          totalTrendsReturned: state.trendCoverage.totalTrendsReturned,
          groupedTrendCount: state.trendCoverage.groupedTrendCount,
          singletonTrendCount: state.trendCoverage.singletonTrendCount,
          urlAnchorGroupCount: state.trendCoverage.urlAnchorGroupCount,
          aiClusterGroupCount: state.trendCoverage.aiClusterGroupCount,
          templateSeriesCount: state.trendCoverage.templateSeriesCount,
          lowInformationTrendCount: state.trendCoverage.lowInformationTrendCount,
          fallbackLabelCount: state.trendCoverage.fallbackLabelCount,
          lowQualityLabelCount: state.trendCoverage.lowQualityLabelCount,
          aiLabeledCount: state.trendCoverage.aiLabeledCount,
          aiAttempted: state.trendCoverage.aiAttempted,
          aiClientInitialized: state.trendCoverage.aiClientInitialized,
          aiCredentialSource: state.trendCoverage.aiCredentialSource,
          aiCredentialFingerprint: state.trendCoverage.aiCredentialFingerprint,
          aiModel: state.trendCoverage.aiModel,
          aiProcessedRootCount: state.trendCoverage.aiProcessedRootCount,
          aiProcessedFreshRootCount: state.trendCoverage.aiProcessedFreshRootCount,
          aiCacheHitCount: state.trendCoverage.aiCacheHitCount,
          aiFreshCallCount: state.trendCoverage.aiFreshCallCount,
          aiBatchCount: state.trendCoverage.aiBatchCount,
          aiBatchFailureCount: state.trendCoverage.aiBatchFailureCount,
          aiFailedRootCount: state.trendCoverage.aiFailedRootCount,
          aiAssignmentCoveragePct: state.trendCoverage.aiAssignmentCoveragePct,
          aiIncomplete: state.trendCoverage.aiIncomplete,
          aiIncompleteReason: state.trendCoverage.aiIncompleteReason,
          groupingRunMode: state.trendCoverage.groupingRunMode,
          lastAiGroupingRunAt: state.trendCoverage.lastAiGroupingRunAt,
          lastSuccessfulFullRegroupAt: state.trendCoverage.lastSuccessfulFullRegroupAt,
          leaderboardSource: state.trendCoverage.leaderboardSource,
          displayedRowsCount: state.trendCoverage.displayedRowsCount,
          displayedAiGroupedRowsCount: state.trendCoverage.displayedAiGroupedRowsCount,
          displayedSingletonRowsCount: state.trendCoverage.displayedSingletonRowsCount,
          displayedFallbackRowsCount: state.trendCoverage.displayedFallbackRowsCount,
          displayedLowInformationRowsCount: state.trendCoverage.displayedLowInformationRowsCount,
          latestInteractionAt: state.trendCoverage.latestInteractionAt,
          firehoseLagMinutes: state.trendCoverage.firehoseLagMinutes,
        }
      : null,
    overviewSeries: summarizeSeries(state.overviewSeries, 3),
    blueskyReplay: state.blueskyOverview
        ? {
          pointCount: state.blueskyOverview.replay.length,
          firstPoint: state.blueskyOverview.replay[0] ?? null,
          lastPoint: state.blueskyOverview.replay.at(-1) ?? null,
          replayWindow: state.blueskyOverview.replayWindow ?? null,
          attentionSharePct: state.blueskyOverview.attentionSharePct,
          meaningfulAttentionScore: state.blueskyOverview.meaningfulAttentionScore,
          accountSpread: state.blueskyOverview.accountSpread,
          firehoseLagMinutes: state.blueskyOverview.firehoseLagMinutes,
        }
      : null,
    detail: summarizeDetail(state),
  });

  return Buffer.from(payload).toString("base64url");
}
