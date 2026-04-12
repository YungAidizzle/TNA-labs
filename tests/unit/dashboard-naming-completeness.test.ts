import { dashboardStateHasUnresolvedTrendNaming, summarizeVisibleTrendNaming } from "@/lib/dashboard/naming-completeness";
import { createZeroRankedTrend, createZeroTrendDashboardVM } from "@/lib/dashboard/zero-state";
import { TrendDashboardQuery } from "@/types/view-models";

function buildTrend(id: string) {
  const trend = createZeroRankedTrend("overall", "24h");
  trend.id = id;
  trend.name = id;
  trend.clusterId = id;
  trend.clusterName = id;
  trend.canonicalKeySummary = id;
  trend.attentionScore = 10;
  trend.trendStrengthScore = 10;
  trend.attentionInteractions = 10;
  trend.totalInteractions24h = 10;
  trend.mentions = 10;
  trend.supportingThreadCount = 4;
  trend.leaderboardMode = "established";
  return trend;
}

describe("dashboard naming completeness", () => {
  it("treats rows with missing enrichment state as unresolved", () => {
    const query: TrendDashboardQuery = {
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "attention",
    };
    const unresolvedTrend = buildTrend("raw");
    const vm = {
      ...createZeroTrendDashboardVM(query),
      leaderboard: [unresolvedTrend],
      leaderboards: {
        established: [unresolvedTrend],
        emerging: [],
      },
    };

    expect(dashboardStateHasUnresolvedTrendNaming(vm)).toBe(true);
    expect(summarizeVisibleTrendNaming(vm)).toEqual({
      visibleTrendCount: 1,
      aiNamedCount: 0,
      aiFailedCount: 0,
      unresolvedCount: 1,
      fallbackDisplayCount: 0,
      missingDisplayCount: 1,
    });
  });

  it("treats AI-named rows and true AI failures as resolved", () => {
    const query: TrendDashboardQuery = {
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "attention",
    };
    const aiNamedTrend = buildTrend("ai");
    aiNamedTrend.name = "Atlas Chip Export Controls";
    aiNamedTrend.displayName = "Atlas Chip Export Controls";
    aiNamedTrend.nameStatus = "ready";
    aiNamedTrend.nameSource = "ai_exact";
    aiNamedTrend.trendEnrichmentStatus = "ok";
    aiNamedTrend.trendEnrichment = {
      rawLabel: "Atlas",
      status: "ok",
      canonicalName: "Atlas Chip Export Controls",
      fallbackLabel: "Atlas",
      nameStatus: "ready",
      nameSource: "ai_exact",
      shortDescription: null,
      contextParagraph: null,
      narrativeSummary: null,
      whyAttention: null,
      evidencePostIds: [],
      keyEntities: [],
      trendCategory: null,
      mixedSignals: [],
      abstainReason: null,
      summaryConfidence: 0.8,
      modelName: "gpt-5-mini",
      promptVersion: "visible-v1",
      generatedAt: null,
      refreshedAt: null,
    };

    const failedTrend = buildTrend("failed");
    failedTrend.displayName = null;
    failedTrend.nameStatus = "failed";
    failedTrend.nameSource = "fallback_cleaned";
    failedTrend.trendEnrichmentStatus = "insufficient_evidence";
    failedTrend.trendEnrichmentAbstainReason = "Visible runtime AI naming failed: timeout";

    const vm = {
      ...createZeroTrendDashboardVM(query),
      leaderboard: [aiNamedTrend, failedTrend],
      leaderboards: {
        established: [aiNamedTrend, failedTrend],
        emerging: [],
      },
      detail: {
        trend: aiNamedTrend,
        attentionGraph: [],
        attentionWindow: null,
        platformBreakdown: [],
        topPosts: [],
        relatedTrends: [],
      },
    };

    expect(dashboardStateHasUnresolvedTrendNaming(vm)).toBe(false);
    expect(summarizeVisibleTrendNaming(vm)).toEqual({
      visibleTrendCount: 2,
      aiNamedCount: 1,
      aiFailedCount: 1,
      unresolvedCount: 0,
      fallbackDisplayCount: 0,
      missingDisplayCount: 1,
    });
  });
});
