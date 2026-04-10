import { describe, expect, it } from "vitest";
import {
  buildOptimisticTrendDetail,
  resolveLoadedDetailForTrend,
  resolveSelectedTrendId,
} from "@/lib/dashboard/trend-selection-state";
import { RankedTrend, TrendDetailVM } from "@/types/view-models";

const TIMESTAMPS = [
  "2026-03-25T08:00:00.000Z",
  "2026-03-25T12:00:00.000Z",
  "2026-03-25T16:00:00.000Z",
];

function makeTrend(id: string): RankedTrend {
  return {
    id,
    rank: 1,
    name: id,
    displayName: id,
    nameStatus: "ready",
    nameSource: "ai_exact",
    scope: "overall",
    leaderboardMode: "established",
    attentionScore: 100,
    attentionInteractions: 100,
    confidenceScore: 72,
    freshnessScore: 90,
    freshnessState: "fresh",
    sampleSize: 100,
    supportingThreadCount: 1,
    lowDataWarning: false,
    growthRate: 12,
    attentionAcceleration: 4,
    mentions: 100,
    platforms: ["bluesky"],
    platformSpread: 1,
    confirmedPlatformSpread: 1,
    attentionHistory: TIMESTAMPS.map((timestamp, index) => ({
      timestamp,
      value: 10 + index,
    })),
    platformBreakdown: [],
    topPosts: [],
    lifecycleStage: "Emerging",
    originPlatform: "bluesky",
    platformMigrationPath: ["bluesky"],
    attentionDrivers: [],
    hasSpike: false,
    clusterId: id,
    clusterName: id,
    trendStrengthScore: 100,
    persistenceScore: 60,
    isEarlyTrend: false,
    positionChange24h: 1,
    googleSearchInterest: null,
  } as RankedTrend;
}

function makeDetail(id: string): TrendDetailVM {
  const trend = makeTrend(id);

  return {
    trend,
    attentionGraph: trend.attentionHistory,
    attentionWindow: null,
    platformBreakdown: [],
    topPosts: [],
    relatedTrends: [],
    blueskyDetail: null,
  };
}

describe("trend selection state helpers", () => {
  it("keeps the latest requested trend selected when it is visible", () => {
    const leaderboard = [makeTrend("trend-a"), makeTrend("trend-b")];

    expect(
      resolveSelectedTrendId({
        leaderboard,
        requestedSelectedId: "trend-b",
        fallbackSelectedId: "trend-a",
      }),
    ).toBe("trend-b");
  });

  it("falls back to the server-selected or first visible trend when the request is invalid", () => {
    const leaderboard = [makeTrend("trend-a"), makeTrend("trend-b")];

    expect(
      resolveSelectedTrendId({
        leaderboard,
        requestedSelectedId: "missing-trend",
        fallbackSelectedId: "trend-b",
      }),
    ).toBe("trend-b");

    expect(
      resolveSelectedTrendId({
        leaderboard,
        requestedSelectedId: "missing-trend",
        fallbackSelectedId: "also-missing",
      }),
    ).toBe("trend-a");
  });

  it("ignores stale detail responses that do not match the active selection", () => {
    expect(resolveLoadedDetailForTrend(makeDetail("trend-a"), "trend-b")).toBeNull();
    expect(resolveLoadedDetailForTrend(makeDetail("trend-b"), "trend-b")?.trend.id).toBe("trend-b");
  });

  it("builds an optimistic detail snapshot from the clicked leaderboard row", () => {
    const optimisticDetail = buildOptimisticTrendDetail(makeTrend("trend-a"));

    expect(optimisticDetail?.trend.id).toBe("trend-a");
    expect(optimisticDetail?.attentionGraph).toHaveLength(TIMESTAMPS.length);
    expect(optimisticDetail?.relatedTrends).toEqual([]);
  });
});
