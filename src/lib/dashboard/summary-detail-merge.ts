import { hasTrustedTrendDisplayName } from "@/lib/dashboard/trend-name-state";
import { TrendDashboardVM } from "@/types/view-models";

function mergeTrendPresentation(
  summaryTrend: TrendDashboardVM["leaderboard"][number] | null | undefined,
  detailTrend: TrendDashboardVM["leaderboard"][number],
) {
  if (!summaryTrend) {
    return detailTrend;
  }

  if (!hasTrustedTrendDisplayName(summaryTrend) || hasTrustedTrendDisplayName(detailTrend)) {
    return detailTrend;
  }

  return {
    ...detailTrend,
    name: summaryTrend.name,
    displayName: summaryTrend.displayName,
    nameStatus: summaryTrend.nameStatus,
    nameSource: summaryTrend.nameSource,
    clusterName: summaryTrend.clusterName,
    trendDescription: detailTrend.trendDescription ?? summaryTrend.trendDescription,
    trendContextParagraph: detailTrend.trendContextParagraph ?? summaryTrend.trendContextParagraph,
    trendNarrativeSummary: detailTrend.trendNarrativeSummary ?? summaryTrend.trendNarrativeSummary,
    trendRawLabel: detailTrend.trendRawLabel ?? summaryTrend.trendRawLabel,
    trendFallbackLabel: detailTrend.trendFallbackLabel ?? summaryTrend.trendFallbackLabel,
    trendSummaryConfidence: detailTrend.trendSummaryConfidence ?? summaryTrend.trendSummaryConfidence,
    trendEnrichmentStatus: detailTrend.trendEnrichmentStatus ?? summaryTrend.trendEnrichmentStatus,
    trendEnrichmentAbstainReason:
      detailTrend.trendEnrichmentAbstainReason ?? summaryTrend.trendEnrichmentAbstainReason,
    trendKeyEntities: detailTrend.trendKeyEntities ?? summaryTrend.trendKeyEntities,
    trendEnrichment: detailTrend.trendEnrichment ?? summaryTrend.trendEnrichment,
    aiAssisted: detailTrend.aiAssisted || summaryTrend.aiAssisted,
  };
}

export function mergeTrendDashboardSummaryAndDetail(
  summary: TrendDashboardVM | null | undefined,
  detail: TrendDashboardVM | null | undefined,
) {
  if (!summary && !detail) {
    return null;
  }

  if (!summary) {
    return detail ?? null;
  }

  if (!detail?.detail) {
    return summary;
  }

  const summarySelectedTrend =
    summary.leaderboard.find((trend) => trend.id === detail.detail?.trend.id) ?? null;

  return {
    ...summary,
    query: {
      ...summary.query,
      selectedId: detail.query.selectedId ?? summary.query.selectedId,
    },
    dataStatus: detail.dataStatus ?? summary.dataStatus,
    blueskyOverview: detail.blueskyOverview ?? summary.blueskyOverview,
    correlatedMemecoins: detail.correlatedMemecoins ?? summary.correlatedMemecoins ?? null,
    detail: {
      ...detail.detail,
      trend: mergeTrendPresentation(summarySelectedTrend, detail.detail.trend),
    },
  } satisfies TrendDashboardVM;
}
