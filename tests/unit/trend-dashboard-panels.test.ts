import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrendMemecoinsPanel, TrendNarrativesPanel } from "@/features/trends/trend-dashboard-panels";
import type { RankedTrend } from "@/types/view-models";

const NARRATIVE_ROW: RankedTrend = {
  id: "clip-remix-cycle",
  rank: 1,
  name: "Clip Remix Cycle",
  displayName: "Clip Remix Cycle",
  nameStatus: "ready",
  nameSource: "ai_exact",
  scope: "overall",
  leaderboardMode: "established",
  attentionScore: 88,
  attentionInteractions: 24,
  confidenceScore: 86,
  freshnessScore: 100,
  freshnessState: "fresh",
  sampleSize: 4,
  supportingThreadCount: 6,
  lowDataWarning: false,
  growthRate: 12,
  attentionAcceleration: 9,
  mentions: 24,
  platforms: ["news"],
  platformSpread: 1,
  confirmedPlatformSpread: 1,
  attentionHistory: [],
  platformBreakdown: [],
  topPosts: [],
  lifecycleStage: "Expanding",
  originPlatform: "news",
  platformMigrationPath: ["news"],
  attentionDrivers: [],
  hasSpike: true,
  clusterId: "clip-remix-cycle",
  clusterName: "Clip Remix Cycle",
  trendStrengthScore: 88,
  persistenceScore: 74,
  isEarlyTrend: true,
  positionChange24h: 0,
  googleSearchInterest: null,
};

describe("trend dashboard panels", () => {
  it("keeps the tab bar visible for an empty trend selection prompt", () => {
    const markup = renderToStaticMarkup(
      createElement(TrendMemecoinsPanel, {
        rows: [],
        selectedCoinId: null,
        selectedTrendLabel: null,
        mode: "trend",
        onModeChange: () => {},
        onSelectCoin: () => {},
      }),
    );

    expect(markup).toContain("Trend");
    expect(markup).toContain("All");
    expect(markup).toContain("Momentum");
    expect(markup).toContain("Select a trend to load correlated memecoins.");
  });

  it("keeps retained narrative rows visible without rendering stale diagnostics", () => {
    const markup = renderToStaticMarkup(
      createElement(TrendNarrativesPanel, {
        rows: [NARRATIVE_ROW],
        selectedId: NARRATIVE_ROW.id,
        searchTerm: "",
        onSearchTermChange: () => {},
        onSelect: () => {},
        errorMessage: "scheduler timeout: refresh failed",
      }),
    );

    expect(markup).toContain("Clip Remix Cycle");
    expect(markup).not.toContain("STALE");
    expect(markup).not.toContain("scheduler timeout: refresh failed");
    expect(markup).not.toContain("Showing last synced narratives");
    expect(markup).not.toContain("Refreshing live narratives");
  });
});
