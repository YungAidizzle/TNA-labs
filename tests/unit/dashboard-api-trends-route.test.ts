import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const cachedStateMocks = vi.hoisted(() => ({
  getSharedTrendDashboardSummaryState: vi.fn(),
  getSharedTrendDashboardMemecoinState: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  requirePaidApiUser: vi.fn(async () => ({ id: "user-1" })),
}));

const configMocks = vi.hoisted(() => ({
  getAiNativeNarrativeConfig: vi.fn(() => ({
    refreshIntervalSeconds: 3600,
  })),
}));

vi.mock("@/lib/dashboard/cached-state", () => cachedStateMocks);
vi.mock("@/lib/supabase/auth", () => authMocks);
vi.mock("@/lib/ai-native-narratives/config", () => configMocks);

function createRankedTrend(index: number) {
  return {
    id: `trend-${index + 1}`,
    rank: index + 1,
    name: `Trend ${index + 1}`,
    displayName: `Trend ${index + 1}`,
    nameStatus: "ready",
    nameSource: "ai_exact",
    scope: "overall",
    leaderboardMode: "established",
    attentionScore: 90 - (index % 20),
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
    clusterId: `cluster-${index + 1}`,
    clusterName: `Cluster ${index + 1}`,
    trendStrengthScore: 88,
    persistenceScore: 74,
    isEarlyTrend: index < 8,
    positionChange24h: 0,
    googleSearchInterest: null,
  };
}

describe("dashboard trends API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a 100-row narrative board with served/backfill headers", async () => {
    const leaderboard = Array.from({ length: 100 }, (_, index) => createRankedTrend(index));
    cachedStateMocks.getSharedTrendDashboardSummaryState.mockResolvedValueOnce({
      query: {
        scope: "overall",
        range: "24h",
        sort: "posts",
        mode: "established",
      },
      leaderboard,
      dataStatus: {
        stateSource: "ai_native_canonical",
        bundleOrigin: null,
        servingMode: "fresh",
        showing: "ai_native_canonical",
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
            sourceStatus: "fresh",
            itemCount: 100,
            lastFetchedAt: "2026-04-20T11:00:00.000Z",
            latestCreatedAt: "2026-04-20T11:00:00.000Z",
            ageMinutes: 60,
          },
        ],
        refresh: null,
        timings: null,
        freshnessDiagnostics: {
          latestIngestionAt: null,
          latestProcessedAt: null,
          latestMentionEventAt: null,
          latestReadModelFinalizeAt: null,
          latestReadModelRollingWriteAt: null,
          latestReadModelSeriesWriteAt: null,
          latestReadModelWindowEndAt: null,
          latestSeriesNonZeroBucketAt: null,
          workerRunStartedAt: "2026-04-20T11:00:00.000Z",
          workerRunStatus: "succeeded",
          workerLastEventAt: "2026-04-20T11:05:00.000Z",
          workerRowsInserted: 63,
          latestRunId: 12,
          latestRunAt: "2026-04-20T11:00:00.000Z",
          latestRunCompletedAt: "2026-04-20T11:05:00.000Z",
          latestRunStatus: "succeeded",
          latestRunTrigger: "railway-hourly-worker",
          latestRunErrorMessage: null,
          latestRunRuntimePath: "railway_hourly_daemon",
          latestRunExecutionEnvironment: "railway",
          latestRunCandidateCount: 140,
          latestRunEvidenceCount: 420,
          latestRunNarrativeCount: 63,
          latestSuccessfulRunId: 12,
          latestSuccessfulRunAt: "2026-04-20T11:00:00.000Z",
          latestSuccessfulRunCompletedAt: "2026-04-20T11:05:00.000Z",
          latestSuccessfulRunCandidateCount: 140,
          latestSuccessfulRunEvidenceCount: 420,
          latestSuccessfulRunNarrativeCount: 63,
          latestSuccessfulTrigger: "railway-hourly-worker",
          latestSuccessfulRuntimePath: "railway_hourly_daemon",
          latestSuccessfulExecutionEnvironment: "railway",
          latestFailureRunId: null,
          latestFailureAt: null,
          latestFailureTrigger: null,
          latestFailureErrorMessage: null,
          latestFailureRuntimePath: null,
          latestFailureExecutionEnvironment: null,
          boardTargetCount: 100,
          boardServedNarrativeCount: 100,
          boardFreshNarrativeCount: 63,
          boardBackfillNarrativeCount: 37,
          schedulerStrategy: "railway_worker_hourly_authoritative",
          schedulerLabel: "Railway hourly worker",
          schedulerExpectedIntervalSeconds: 3600,
          cronAuthorizationConfigured: true,
          cronSecretSources: ["CRON_SECRET"],
          apiResponseAt: "2026-04-20T12:00:00.000Z",
          sourceSnapshotAt: "2026-04-20T11:00:00.000Z",
          selectedTrendLatestDataAt: null,
          selectedTrendLatestPointAt: null,
          renderedStaleReferenceAt: "2026-04-20T11:00:00.000Z",
          renderedStaleReferenceSource: "source_snapshot",
          chainBreakStage: "none",
          agesMinutes: {
            ingestion: null,
            processed: null,
            mentionEvent: null,
            readModelFinalize: null,
            readModelWrite: null,
            readModelWindowEnd: null,
            workerLastEvent: 55,
            sourceSnapshot: 60,
            selectedLatestPoint: null,
            selectedLatestData: null,
            renderedStaleReference: 60,
          },
        },
      },
    });

    const { GET } = await import("@/app/api/dashboard/trends/route");
    const request = new NextRequest(
      "http://localhost/api/dashboard/trends?view=summary&scope=overall&range=24h&sort=posts",
    );
    const response = await GET(request);
    const payload = await response.json();

    expect(payload.leaderboard).toHaveLength(100);
    expect(response.headers.get("X-Attentra-Board-Target-Count")).toBe("100");
    expect(response.headers.get("X-Attentra-Board-Served-Count")).toBe("100");
    expect(response.headers.get("X-Attentra-Board-Fresh-Count")).toBe("63");
    expect(response.headers.get("X-Attentra-Board-Backfill-Count")).toBe("37");
  });
});
