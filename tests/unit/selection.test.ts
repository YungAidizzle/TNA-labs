import { describe, expect, it } from "vitest";
import { applyTrendDashboardSelection } from "@/lib/dashboard/selection";
import { RankedTrend, TrendDashboardVM } from "@/types/view-models";

const TIMESTAMPS = [
  "2026-03-25T08:00:00.000Z",
  "2026-03-25T12:00:00.000Z",
  "2026-03-25T16:00:00.000Z",
];

function makeTrend(id: string, values: number[]): RankedTrend {
  const interactions = values.reduce((sum, value) => sum + value, 0);

  return {
    id,
    rank: 0,
    name: id,
    displayName: id,
    nameStatus: "ready",
    nameSource: "ai_exact",
    scope: "overall",
    leaderboardMode: "established",
    attentionScore: interactions,
    attentionInteractions: interactions,
    confidenceScore: 72,
    freshnessScore: 90,
    freshnessState: "fresh",
    sampleSize: interactions,
    supportingThreadCount: 1,
    lowDataWarning: false,
    growthRate: 0,
    attentionAcceleration: 0,
    mentions: interactions,
    platforms: ["bluesky"],
    platformSpread: 1,
    confirmedPlatformSpread: 1,
    attentionHistory: TIMESTAMPS.map((timestamp, index) => ({
      timestamp,
      value: values[index] ?? 0,
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
    trendStrengthScore: interactions,
    persistenceScore: 0,
    isEarlyTrend: false,
    positionChange24h: 0,
    googleSearchInterest: null,
  } as RankedTrend;
}

describe("applyTrendDashboardSelection", () => {
  it("keeps every trend that was top-5 in any bucket across the window", () => {
    const trends = [
      makeTrend("trend-1", [10, 0, 0]),
      makeTrend("trend-2", [9, 0, 0]),
      makeTrend("trend-3", [8, 0, 10]),
      makeTrend("trend-4", [7, 10, 0]),
      makeTrend("trend-5", [6, 9, 0]),
      makeTrend("trend-6", [5, 8, 9]),
      makeTrend("trend-7", [0, 7, 8]),
      makeTrend("trend-8", [0, 6, 7]),
      makeTrend("trend-9", [0, 0, 6]),
      makeTrend("trend-10", [1, 1, 1]),
    ];

    const vm = {
      query: {
        scope: "overall",
        range: "24h",
        mode: "established",
        sort: "attention",
      },
      ingestionHealth: null,
      dataStatus: null,
      blueskyOverview: null,
      trendCoverage: null,
      leaderboards: {
        established: trends,
        emerging: [],
      },
      leaderboard: trends,
      overviewSeries: [],
      detail: null,
    } as TrendDashboardVM;

    const selected = applyTrendDashboardSelection(vm);
    const overviewTrendIds = selected.overviewSeries
      .map((series) => series.id)
      .filter((id) => id !== "all-trends-aggregate");

    expect(overviewTrendIds).toEqual(
      expect.arrayContaining([
        "trend-1",
        "trend-2",
        "trend-3",
        "trend-4",
        "trend-5",
        "trend-6",
        "trend-7",
        "trend-8",
        "trend-9",
      ]),
    );
    expect(overviewTrendIds).not.toContain("trend-10");
  });

  it("builds chart series from the active leaderboard mode only", () => {
    const established = [
      makeTrend("established-1", [10, 0, 0]),
      makeTrend("established-2", [8, 0, 0]),
      makeTrend("established-3", [7, 0, 0]),
      makeTrend("established-4", [6, 0, 0]),
      makeTrend("established-5", [5, 0, 0]),
    ];
    const emerging = [
      makeTrend("emerging-1", [0, 10, 0]),
      makeTrend("emerging-2", [0, 9, 0]),
      makeTrend("emerging-3", [0, 8, 0]),
      makeTrend("emerging-4", [0, 7, 0]),
      makeTrend("emerging-5", [0, 6, 0]),
    ];

    const vm = {
      query: {
        scope: "overall",
        range: "24h",
        mode: "established",
        sort: "attention",
      },
      ingestionHealth: null,
      dataStatus: null,
      blueskyOverview: null,
      trendCoverage: null,
      leaderboards: {
        established,
        emerging,
      },
      leaderboard: established,
      overviewSeries: [],
      detail: null,
    } as TrendDashboardVM;

    const selected = applyTrendDashboardSelection(vm);
    const chartIds = selected.overviewSeries
      .map((series) => series.id)
      .filter((id) => id !== "all-trends-aggregate");

    expect(chartIds).toEqual(expect.arrayContaining(established.map((trend) => trend.id)));
    expect(chartIds).not.toEqual(expect.arrayContaining(emerging.map((trend) => trend.id)));
  });
});
