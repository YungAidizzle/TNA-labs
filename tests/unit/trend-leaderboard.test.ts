import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrendLeaderboard } from "@/components/trends/trend-leaderboard";
import { createZeroRankedTrend } from "@/lib/dashboard/zero-state";

vi.mock("framer-motion", () => ({
  motion: {
    button: "button",
  },
}));

describe("trend leaderboard", () => {
  it("renders only the leaderboard mode buttons in the header action area", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      ...createZeroRankedTrend("overall", "24h"),
      id: `trend-${index + 1}`,
      rank: index + 1,
      name: `Trend ${index + 1}`,
      displayName: `Trend ${index + 1}`,
      nameStatus: "ready" as const,
      nameSource: "ai_exact" as const,
      source: "bluesky" as const,
      totalInteractions24h: 12 - index,
      attentionInteractions: 12 - index,
      rootsCount24h: 1,
      uniqueAuthors24h: index + 2,
      lastSeenAt: "2026-03-23T11:00:00.000Z",
      isSingleton: true,
      platforms: ["bluesky" as const],
      platformSpread: 1,
      supportingThreadCount: 1,
    }));

    const markup = renderToStaticMarkup(
      createElement(TrendLeaderboard, {
        rows,
        coverage: {
          source: "bluesky",
          rankingSource: "ai_grouped_clusters",
          windowHours: 24,
          totalInteractionsInWindow: 78,
          totalInteractionsAssignedToTrends: 78,
          unassignedInteractionsCount: 0,
          totalRootsInWindow: 12,
          eligibleRootsCount: 12,
          assignedRootsCount: 12,
          unassignedRootCount: 0,
          nonAiAssignedRootCount: 12,
          groupedRootsCount: 0,
          singletonRootsCount: 12,
          totalTrendsReturned: 12,
          groupedTrendCount: 0,
          singletonTrendCount: 12,
          urlAnchorGroupCount: 0,
          aiClusterGroupCount: 0,
          templateSeriesCount: 0,
          lowInformationTrendCount: 0,
          fallbackLabelCount: 0,
          lowQualityLabelCount: 0,
          aiLabeledCount: 0,
          aiAttempted: false,
          aiClientInitialized: false,
          aiCredentialSource: null,
          aiCredentialFingerprint: null,
          aiModel: null,
          aiProcessedRootCount: 0,
          aiProcessedFreshRootCount: 0,
          aiCacheHitCount: 0,
          aiFreshCallCount: 0,
          aiBatchCount: 0,
          aiBatchFailureCount: 0,
          aiFailedRootCount: 0,
          aiAssignmentCoveragePct: 0,
          aiIncomplete: true,
          aiIncompleteReason: "not attempted",
          groupingRunMode: "incremental_live",
          lastAiGroupingRunAt: null,
          lastSuccessfulFullRegroupAt: null,
          leaderboardSource: "ai_grouped_clusters",
          displayedRowsCount: 12,
          displayedAiGroupedRowsCount: 0,
          displayedSingletonRowsCount: 12,
          displayedFallbackRowsCount: 0,
          displayedLowInformationRowsCount: 0,
          latestInteractionAt: "2026-03-23T11:00:00.000Z",
          firehoseLagMinutes: 9,
        },
        selectedId: "",
        mode: "established",
        onSelect: () => {},
        onModeChange: () => {},
      }),
    );

    expect(markup).toContain("Trend 12");
    expect(markup).toContain("Emerging");
    expect(markup).toContain("Established");
    expect(markup).not.toContain("12 rows");
    expect(markup).not.toContain("78/78 assigned");
    expect(markup).not.toContain("fallback labels");
  });

  it("does not render row-count summary chips when the response is sliced", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      ...createZeroRankedTrend("overall", "24h"),
      id: `slice-trend-${index + 1}`,
      rank: index + 1,
      name: `Slice Trend ${index + 1}`,
      displayName: `Slice Trend ${index + 1}`,
      nameStatus: "ready" as const,
      nameSource: "ai_exact" as const,
      source: "bluesky" as const,
      totalInteractions24h: 40 - index,
      attentionInteractions: 40 - index,
      rootsCount24h: 1,
      uniqueAuthors24h: index + 1,
      lastSeenAt: "2026-03-23T11:00:00.000Z",
      isSingleton: true,
      platforms: ["bluesky" as const],
      platformSpread: 1,
      supportingThreadCount: 1,
    }));

    const markup = renderToStaticMarkup(
      createElement(TrendLeaderboard, {
        rows,
        coverage: {
          source: "bluesky",
          rankingSource: "ai_grouped_clusters",
          windowHours: 24,
          totalInteractionsInWindow: 312,
          totalInteractionsAssignedToTrends: 312,
          unassignedInteractionsCount: 0,
          totalRootsInWindow: 40,
          eligibleRootsCount: 40,
          assignedRootsCount: 40,
          unassignedRootCount: 0,
          nonAiAssignedRootCount: 40,
          groupedRootsCount: 0,
          singletonRootsCount: 40,
          totalTrendsReturned: 40,
          groupedTrendCount: 0,
          singletonTrendCount: 40,
          urlAnchorGroupCount: 0,
          aiClusterGroupCount: 0,
          templateSeriesCount: 0,
          lowInformationTrendCount: 0,
          fallbackLabelCount: 0,
          lowQualityLabelCount: 0,
          aiLabeledCount: 0,
          aiAttempted: false,
          aiClientInitialized: false,
          aiCredentialSource: null,
          aiCredentialFingerprint: null,
          aiModel: null,
          aiProcessedRootCount: 0,
          aiProcessedFreshRootCount: 0,
          aiCacheHitCount: 0,
          aiFreshCallCount: 0,
          aiBatchCount: 0,
          aiBatchFailureCount: 0,
          aiFailedRootCount: 0,
          aiAssignmentCoveragePct: 0,
          aiIncomplete: true,
          aiIncompleteReason: "not attempted",
          groupingRunMode: "incremental_live",
          lastAiGroupingRunAt: null,
          lastSuccessfulFullRegroupAt: null,
          leaderboardSource: "ai_grouped_clusters",
          displayedRowsCount: 12,
          displayedAiGroupedRowsCount: 0,
          displayedSingletonRowsCount: 12,
          displayedFallbackRowsCount: 0,
          displayedLowInformationRowsCount: 0,
          latestInteractionAt: "2026-03-23T11:00:00.000Z",
          firehoseLagMinutes: 9,
        },
        selectedId: "",
        mode: "established",
        onSelect: () => {},
        onModeChange: () => {},
      }),
    );

    expect(markup).not.toContain("12/40 rows");
    expect(markup).toContain("Emerging");
    expect(markup).toContain("Established");
  });

  it("does not render contributor handles in Bluesky summary text", () => {
    const rows = [
      {
        ...createZeroRankedTrend("overall", "24h"),
        id: "bluesky-trend-1",
        rank: 1,
        name: "Bluesky Trend 1",
        displayName: "Bluesky Trend 1",
        nameStatus: "ready" as const,
        nameSource: "ai_exact" as const,
        source: "bluesky" as const,
        totalInteractions24h: 42,
        attentionInteractions: 42,
        rootsCount24h: 3,
        uniqueAuthors24h: 12,
        lastSeenAt: "2026-03-25T08:30:00.000Z",
        isSingleton: false,
        platforms: ["bluesky" as const],
        platformSpread: 1,
        confirmedPlatformSpread: 1,
        supportingThreadCount: 3,
        originPlatform: "bluesky" as const,
        blueskySummary: {
          attentionSharePct: 94,
          postCount: 7,
          uniqueAuthorCount: 6,
          amplifierCount: 5,
          topAmplifierHandle: "did:plc:not-real",
          topAmplifier: "did:plc:not-real",
          repostVelocity: 0,
          replyVelocity: 0,
          quoteVelocity: 0,
          leadingSignalLabel: "Steady attention",
          firehoseLagMinutes: 3,
        },
      },
    ];

    const markup = renderToStaticMarkup(
      createElement(TrendLeaderboard, {
        rows,
        coverage: {
          source: "bluesky",
          rankingSource: "ai_grouped_clusters",
          windowHours: 24,
          totalInteractionsInWindow: 42,
          totalInteractionsAssignedToTrends: 42,
          unassignedInteractionsCount: 0,
          totalRootsInWindow: 3,
          eligibleRootsCount: 3,
          assignedRootsCount: 3,
          unassignedRootCount: 0,
          nonAiAssignedRootCount: 3,
          groupedRootsCount: 1,
          singletonRootsCount: 2,
          totalTrendsReturned: 1,
          groupedTrendCount: 1,
          singletonTrendCount: 0,
          urlAnchorGroupCount: 0,
          aiClusterGroupCount: 0,
          templateSeriesCount: 0,
          lowInformationTrendCount: 0,
          fallbackLabelCount: 0,
          lowQualityLabelCount: 0,
          aiLabeledCount: 0,
          aiAttempted: false,
          aiClientInitialized: false,
          aiCredentialSource: null,
          aiCredentialFingerprint: null,
          aiModel: null,
          aiProcessedRootCount: 0,
          aiProcessedFreshRootCount: 0,
          aiCacheHitCount: 0,
          aiFreshCallCount: 0,
          aiBatchCount: 0,
          aiBatchFailureCount: 0,
          aiFailedRootCount: 0,
          aiAssignmentCoveragePct: 0,
          aiIncomplete: true,
          aiIncompleteReason: "not attempted",
          groupingRunMode: "incremental_live",
          lastAiGroupingRunAt: null,
          lastSuccessfulFullRegroupAt: null,
          leaderboardSource: "ai_grouped_clusters",
          displayedRowsCount: 1,
          displayedAiGroupedRowsCount: 0,
          displayedSingletonRowsCount: 0,
          displayedFallbackRowsCount: 0,
          displayedLowInformationRowsCount: 0,
          latestInteractionAt: "2026-03-25T08:30:00.000Z",
          firehoseLagMinutes: 3,
        },
        selectedId: "",
        mode: "established",
        onSelect: () => {},
        onModeChange: () => {},
      }),
    );

    expect(markup).toContain("Bluesky Trend 1");
    expect(markup).toContain("Bluesky");
    expect(markup).not.toContain("@did:plc:not-real");
    expect(markup).not.toContain("did:plc:not-real");
  });
});
