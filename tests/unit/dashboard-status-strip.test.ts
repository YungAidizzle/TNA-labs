import { describe, expect, it } from "vitest";
import {
  buildTrendDashboardStatusStripItems,
  buildTrendDashboardStatusStripSystemDetails,
} from "@/lib/dashboard/status-strip";
import type { TrendDashboardVM } from "@/types/view-models";

function createDashboardState(servingMode: "fresh" | "stale_fallback" | "empty"): TrendDashboardVM {
  return {
    query: {
      scope: "overall",
      range: "24h",
      sort: "posts",
      mode: "established",
    },
    ingestionHealth: null,
    dataStatus: {
      stateSource: "ai_native_canonical",
      bundleOrigin: null,
      servingMode,
      showing: servingMode === "empty" ? "zero_state" : "ai_native_canonical",
      serverNow: "2026-04-20T12:00:00.000Z",
      runtimeSnapshotGeneratedAt: null,
      sourceSnapshotGeneratedAt: "2026-04-20T11:00:00.000Z",
      latestFetchedAt: "2026-04-20T11:00:00.000Z",
      runtimeSnapshotAvailable: false,
      localRawDataAvailable: false,
      runtimeSnapshotStale: false,
      sourceFreshness: [
        {
          sourceId: "openai:web:memecoin-narratives",
          sourceLabel: "OpenAI web memecoin narrative discovery",
          platformId: "news",
          sourceStatus: servingMode === "stale_fallback" ? "stale" : "fresh",
          itemCount: servingMode === "empty" ? 0 : 1,
          lastFetchedAt: "2026-04-20T11:00:00.000Z",
          latestCreatedAt: "2026-04-20T11:00:00.000Z",
          ageMinutes: servingMode === "stale_fallback" ? 300 : 60,
        },
      ],
      refresh: null,
      timings: null,
    },
    blueskyOverview: null,
    trendCoverage: null,
    marketMemecoins: null,
    correlatedMemecoins: null,
    leaderboards: {
      established:
        servingMode === "empty"
          ? []
          : [
              {
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
                freshnessState: servingMode === "stale_fallback" ? "stale" : "fresh",
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
              },
            ],
      emerging: [],
    },
    leaderboard: [],
    overviewSeries: [],
    detail: null,
  };
}

describe("dashboard status strip", () => {
  it("keeps the default strip focused on product-facing metrics", () => {
    const state = createDashboardState("stale_fallback");
    state.leaderboard = state.leaderboards.established;
    state.dataStatus!.freshnessDiagnostics = {
      latestIngestionAt: null,
      latestProcessedAt: null,
      latestMentionEventAt: null,
      latestReadModelFinalizeAt: null,
      latestReadModelRollingWriteAt: null,
      latestReadModelSeriesWriteAt: null,
      latestReadModelWindowEndAt: null,
      latestSeriesNonZeroBucketAt: null,
      workerRunStartedAt: null,
      workerRunStatus: null,
      workerLastEventAt: null,
      workerRowsInserted: null,
      latestRunStatus: "failed",
      latestRunAt: "2026-04-20T11:45:00.000Z",
      latestRunTrigger: "railway-hourly-worker",
      latestRunRuntimePath: "railway_hourly_daemon",
      latestSuccessfulRunAt: "2026-04-20T11:00:00.000Z",
      schedulerLabel: "Railway hourly worker",
      pipelineHealthState: "stale",
      apiResponseAt: "2026-04-20T12:00:00.000Z",
      sourceSnapshotAt: "2026-04-20T11:00:00.000Z",
      selectedTrendLatestDataAt: null,
      selectedTrendLatestPointAt: null,
      renderedStaleReferenceAt: null,
      renderedStaleReferenceSource: null,
      chainBreakStage: "read_model_refresh",
      agesMinutes: {
        ingestion: null,
        processed: null,
        mentionEvent: null,
        readModelFinalize: null,
        readModelWrite: null,
        readModelWindowEnd: null,
        workerLastEvent: null,
        sourceSnapshot: 60,
        selectedLatestPoint: null,
        selectedLatestData: null,
        renderedStaleReference: null,
      },
    };

    const items = buildTrendDashboardStatusStripItems(state);
    expect(items).toEqual([
      { label: "Active narratives", value: "1", tone: "neutral" },
      { label: "Avg confidence", value: "86%", tone: "neutral" },
      { label: "Last update", value: "1h", tone: "amber" },
      { label: "Status", value: "Stale", tone: "red" },
    ]);
  });

  it("moves engineering diagnostics into the hidden system details payload", () => {
    const state = createDashboardState("fresh");
    state.leaderboard = state.leaderboards.established;
    state.dataStatus!.freshnessDiagnostics = {
      latestIngestionAt: null,
      latestProcessedAt: null,
      latestMentionEventAt: null,
      latestReadModelFinalizeAt: null,
      latestReadModelRollingWriteAt: null,
      latestReadModelSeriesWriteAt: null,
      latestReadModelWindowEndAt: null,
      latestSeriesNonZeroBucketAt: null,
      workerRunStartedAt: null,
      workerRunStatus: "running",
      workerLastEventAt: null,
      workerRowsInserted: null,
      latestRunStatus: null,
      latestRunAt: "2026-04-20T11:55:00.000Z",
      latestRunTrigger: "railway-hourly-worker",
      latestRunRuntimePath: "railway_hourly_daemon",
      schedulerLabel: "Railway hourly worker",
      pipelineHealthState: "live",
      apiResponseAt: "2026-04-20T12:00:00.000Z",
      sourceSnapshotAt: "2026-04-20T11:00:00.000Z",
      selectedTrendLatestDataAt: null,
      selectedTrendLatestPointAt: null,
      renderedStaleReferenceAt: null,
      renderedStaleReferenceSource: null,
      chainBreakStage: "none",
      agesMinutes: {
        ingestion: null,
        processed: null,
        mentionEvent: null,
        readModelFinalize: null,
        readModelWrite: null,
        readModelWindowEnd: null,
        workerLastEvent: null,
        sourceSnapshot: 60,
        selectedLatestPoint: null,
        selectedLatestData: null,
        renderedStaleReference: null,
      },
    };

    const details = buildTrendDashboardStatusStripSystemDetails(state);

    expect(details).toEqual([
      { label: "Source links", value: "4", tone: "neutral" },
      { label: "Evidence rows", value: "6", tone: "neutral" },
      { label: "New narratives", value: "0", tone: "amber" },
      { label: "Last attempt", value: "5m", tone: "neutral" },
      { label: "Run state", value: "Running", tone: "neutral" },
      { label: "Trigger", value: "Railway hourly worker", tone: "neutral" },
      {
        label: "Scheduler",
        value: "Railway hourly worker",
        tone: "neutral",
      },
      {
        label: "Runtime",
        value: "Railway hourly daemon",
        tone: "neutral",
      },
    ]);
  });
});
