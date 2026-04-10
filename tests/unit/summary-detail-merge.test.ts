import { describe, expect, it } from "vitest";
import { mergeTrendDashboardSummaryAndDetail } from "@/lib/dashboard/summary-detail-merge";
import { createZeroRankedTrend, createZeroTrendDashboardVM } from "@/lib/dashboard/zero-state";
import { TrendDashboardQuery } from "@/types/view-models";

function createTrend(id: string, rank: number) {
  const trend = createZeroRankedTrend("overall", "24h");
  trend.id = id;
  trend.rank = rank;
  trend.name = id;
  trend.clusterId = id;
  trend.clusterName = id;
  trend.canonicalKeySummary = id;
  trend.leaderboardMode = "established";
  trend.attentionScore = 100 - rank;
  trend.trendStrengthScore = 80 - rank;
  trend.attentionInteractions = 100 - rank;
  trend.totalInteractions24h = 100 - rank;
  trend.mentions = 100 - rank;
  trend.supportingThreadCount = 20 - rank;
  return trend;
}

describe("mergeTrendDashboardSummaryAndDetail", () => {
  it("keeps summary leaderboard order while attaching selected detail data", () => {
    const trendAlpha = createTrend("alpha", 1);
    const trendBeta = createTrend("beta", 2);
    const detailTrendBeta = {
      ...createTrend("beta", 1),
      attentionScore: 999,
    };
    const baseQuery: TrendDashboardQuery = {
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "attention",
      selectedId: "alpha",
    };

    const summary = {
      ...createZeroTrendDashboardVM(baseQuery),
      query: baseQuery,
      leaderboards: {
        established: [trendAlpha, trendBeta],
        emerging: [],
      },
      leaderboard: [trendAlpha, trendBeta],
    };

    const detail = {
      ...summary,
      query: {
        ...summary.query,
        selectedId: "beta",
      },
      leaderboards: {
        established: [detailTrendBeta, trendAlpha],
        emerging: [],
      },
      leaderboard: [detailTrendBeta, trendAlpha],
      detail: {
        trend: detailTrendBeta,
        attentionGraph: detailTrendBeta.attentionHistory,
        attentionWindow: null,
        platformBreakdown: [],
        topPosts: [],
        relatedTrends: [],
      },
    };

    const merged = mergeTrendDashboardSummaryAndDetail(summary, detail);
    expect(merged?.leaderboard.map((trend) => trend.id)).toEqual(["alpha", "beta"]);
    expect(merged?.leaderboards.established.map((trend) => trend.id)).toEqual(["alpha", "beta"]);
    expect(merged?.detail?.trend.id).toBe("beta");
    expect(merged?.query.selectedId).toBe("beta");
  });

  it("preserves the summary AI name when detail arrives with the raw name", () => {
    const summaryTrend = createTrend("atlas", 1);
    summaryTrend.name = "Atlas Chip Export Controls";
    summaryTrend.displayName = "Atlas Chip Export Controls";
    summaryTrend.nameStatus = "ready";
    summaryTrend.nameSource = "ai_exact";
    summaryTrend.clusterName = "Atlas Chip Export Controls";
    summaryTrend.trendEnrichmentStatus = "ok";
    summaryTrend.trendEnrichment = {
      rawLabel: "Atlas",
      status: "ok",
      canonicalName: "Atlas Chip Export Controls",
      fallbackLabel: "Atlas",
      nameStatus: "ready",
      nameSource: "ai_exact",
      shortDescription: "Export restriction discussion around Atlas AI chips.",
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

    const rawDetailTrend = {
      ...createTrend("atlas", 1),
      name: "Loading...",
      displayName: null,
      nameStatus: "pending" as const,
      nameSource: "raw" as const,
      clusterName: "Loading...",
      trendRawLabel: "Atlas",
      trendEnrichmentStatus: null,
      trendEnrichment: null,
    };

    const baseQuery: TrendDashboardQuery = {
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "attention",
      selectedId: "atlas",
    };

    const summary = {
      ...createZeroTrendDashboardVM(baseQuery),
      query: baseQuery,
      leaderboards: {
        established: [summaryTrend],
        emerging: [],
      },
      leaderboard: [summaryTrend],
    };

    const detail = {
      ...summary,
      detail: {
        trend: rawDetailTrend,
        attentionGraph: rawDetailTrend.attentionHistory,
        attentionWindow: null,
        platformBreakdown: [],
        topPosts: [],
        relatedTrends: [],
      },
    };

    const merged = mergeTrendDashboardSummaryAndDetail(summary, detail);
    expect(merged?.detail?.trend.name).toBe("Atlas Chip Export Controls");
    expect(merged?.detail?.trend.trendEnrichmentStatus).toBe("ok");
    expect(merged?.detail?.trend.trendEnrichment?.canonicalName).toBe("Atlas Chip Export Controls");
  });
});
