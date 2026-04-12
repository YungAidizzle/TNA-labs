import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeStoreMocks = vi.hoisted(() => ({
  bootstrapRuntimeBundleFromLegacyCache: vi.fn(),
  buildAndPersistDashboardRuntimeBundle: vi.fn(),
  getDashboardSourceManifest: vi.fn(),
  getRuntimeBaseState: vi.fn(),
  hasPersistedRuntimeRawSnapshot: vi.fn(),
  isRuntimeBundleStale: vi.fn(),
  loadDashboardRefreshState: vi.fn(),
  loadLatestDashboardRuntimeBundle: vi.fn(),
}));

const backgroundRefreshMocks = vi.hoisted(() => ({
  requestDashboardBackgroundRefresh: vi.fn(),
}));

vi.mock("@/lib/dashboard/runtime-store", () => runtimeStoreMocks);
vi.mock("@/lib/dashboard/background-refresh", () => backgroundRefreshMocks);
vi.mock("@/lib/dashboard/profiling", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dashboard/profiling")>(
    "@/lib/dashboard/profiling",
  );
  return {
    ...actual,
    writeProfileSnapshot: vi.fn(),
    formatDashboardProfileLog: vi.fn(() => "[dashboard-profile] test"),
  };
});

import { getTrendDashboardState } from "@/lib/dashboard/service";
import { createZeroTimeSeries } from "@/lib/dashboard/zero-state";
import { buildBlueskyFirstHealth } from "@/lib/reddit/local-store";
import { TrendDashboardVM } from "@/types/view-models";

function createBaseState(
  scope: "overall" | "memes" = "overall",
  referenceTime = new Date("2026-03-19T12:00:00.000Z"),
): TrendDashboardVM {
  const zeroSeries = createZeroTimeSeries("24h", referenceTime);
  const attentionHistory = zeroSeries.map((point, index) => ({
    ...point,
    value: index === zeroSeries.length - 1 ? 12 : 0,
  }));
  const trend: TrendDashboardVM["leaderboard"][number] = {
    id: `${scope}-trend-1`,
    rank: 1,
    name: scope === "memes" ? "Meme wave" : "AI agent surge",
    displayName: scope === "memes" ? "Meme wave" : "AI agent surge",
    nameStatus: "ready",
    nameSource: "ai_exact",
    scope,
    leaderboardMode: "established" as const,
    attentionScore: 78,
    breakoutScore: 0,
    velocityScore: 0,
    noveltyScore: 0,
    confirmationScore: 0,
    attentionInteractions: 240,
    confidenceScore: 81,
    freshnessScore: 84,
    freshnessState: "fresh" as const,
    sampleSize: 240,
    supportingThreadCount: 6,
    lowDataWarning: false,
    growthRate: 12,
    attentionAcceleration: 8,
    mentions: 44,
    platforms: ["reddit"],
    platformSpread: 1,
    confirmedPlatformSpread: 1,
    attentionHistory,
    platformBreakdown: [
      {
        platformId: "reddit" as const,
        interactions: 240,
        sharePct: 100,
      },
    ],
    topPosts: [
      {
        id: "post-1",
        platformId: "reddit" as const,
        title: "AI agent surge",
        engagement: 240,
        engagementVelocity: 12,
        ageMinutes: 45,
        url: "https://example.com/post-1",
      },
    ],
    lifecycleStage: "Expanding" as const,
    originPlatform: "reddit" as const,
    platformMigrationPath: ["reddit"],
    attentionDrivers: [
      {
        platformId: "reddit" as const,
        contributionPct: 100,
        deltaPct: 12,
      },
    ],
    hasSpike: false,
    clusterId: "cluster-1",
    clusterName: "AI / Tech | Reddit",
    trendStrengthScore: 72,
    persistenceScore: 55,
    isEarlyTrend: true,
    positionChange24h: 2,
    googleSearchInterest: null,
  };
  const blueskyReplay = zeroSeries.map((point, index) => ({
    ...point,
    value: index === zeroSeries.length - 1 ? 8 : 0,
  }));

  return {
    query: {
      scope,
      range: "24h",
      mode: "established",
      sort: "attention",
    },
    ingestionHealth: null,
    dataStatus: null,
    leaderboards: {
      established: [trend],
      emerging: [],
    },
    leaderboard: [trend],
    blueskyOverview: {
      generatedAt: referenceTime.toISOString(),
      firehoseLagMinutes: 278,
      attentionSharePct: 100,
      engagementIntensity: 8,
      meaningfulAttentionScore: 8,
      narrativeCount: 1,
      accountSpread: 0,
      postsPerMinute: 1,
      likesPerMinute: 0,
      repostsPerMinute: 0,
      repliesPerMinute: 0,
      quotesPerMinute: 0,
      accelerationScore: 0,
      noiseRatioPct: 0,
      leaders: [],
      emerging: [],
      topAmplifiers: [],
      cascades: [],
      clusters: [],
      network: {
        nodes: [],
        edges: [],
      },
      replay: blueskyReplay,
      replayWindow: {
        range: "24h",
        windowStart: new Date(referenceTime.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        windowEnd: referenceTime.toISOString(),
        latestPointAt: blueskyReplay.at(-1)?.timestamp ?? null,
        latestDataAt: blueskyReplay.at(-1)?.timestamp ?? null,
        staleGapMinutes: 0,
        trailingGapBucketCount: 0,
        hasTrailingGap: false,
        bucketIntervalMinutes: 5,
      },
    },
    overviewSeries: [],
    detail: null,
  };
}

function createRuntimeBundle(
  baseState: TrendDashboardVM,
  options: {
    origin?:
      | "startup_rebuild"
      | "local_rebuild"
      | "background_refresh"
      | "manual_full_regroup"
      | "legacy_bootstrap";
    rawCounts?: Partial<{
      posts: number;
      comments: number;
      publicItems: number;
      blueskyPosts: number;
      blueskyInteractions: number;
      blueskyPostSnapshots: number;
      blueskyProfiles: number;
      youtubeComments: number;
      youtubeVideoSnapshots: number;
    }>;
    sourceManifest?: {
      generatedAt: string;
      combinedSignature: string;
      hasAnyData: boolean;
      files: Array<{
        id: string;
        path?: string;
        exists: boolean;
        signature?: string;
        sizeBytes: number;
        updatedAt?: string | null;
      }>;
    };
  } = {},
) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-03-19T12:00:00.000Z",
    origin: options.origin ?? ("local_rebuild" as const),
    sourceManifest:
      options.sourceManifest ??
      ({
        generatedAt: "2026-03-19T12:00:00.000Z",
        combinedSignature: "sig-1",
        hasAnyData: true,
        files: [],
      } as const),
    sourceSnapshotGeneratedAt: "2026-03-19T11:58:00.000Z",
    latestFetchedAt: "2026-03-19T11:58:00.000Z",
    rawCounts: {
      posts: 10,
      comments: 12,
      publicItems: 4,
      blueskyPosts: 3,
      blueskyInteractions: 6,
      blueskyPostSnapshots: 2,
      blueskyProfiles: 4,
      youtubeComments: 2,
      youtubeVideoSnapshots: 1,
      ...options.rawCounts,
    },
    sourceFreshness: [
      {
        sourceId: "reddit:technology",
        sourceLabel: "r/technology",
        platformId: "reddit" as const,
        itemCount: 22,
        lastFetchedAt: "2026-03-19T11:58:00.000Z",
        latestCreatedAt: "2026-03-19T11:55:00.000Z",
        ageMinutes: 3,
      },
      {
        sourceId: "bluesky:firehose:state",
        sourceLabel: "Bluesky firehose sync",
        platformId: "bluesky" as const,
        itemCount: 9,
        lastFetchedAt: "2026-03-18T08:00:00.000Z",
        latestCreatedAt: "2026-03-18T08:00:00.000Z",
        ageMinutes: 278,
        sourceStatus: "stale",
      },
    ],
    baseStates: {
      "overall:24h": baseState,
    },
  };
}

function createLeaderboardTrend(
  scope: "overall" | "memes",
  index: number,
  referenceTime = new Date("2026-03-19T12:00:00.000Z"),
): TrendDashboardVM["leaderboard"][number] {
  const template = createBaseState(scope, referenceTime).leaderboard[0]!;
  const interactionScore = 10_000 - index;

  return {
    ...template,
    id: `${scope}-trend-${index + 1}`,
    rank: index + 1,
    name: `${scope === "memes" ? "Meme" : "Trend"} ${index + 1}`,
    attentionScore: interactionScore,
    totalInteractions24h: interactionScore,
    attentionInteractions: interactionScore,
    trendStrengthScore: interactionScore,
    persistenceScore: 100 - index,
    sampleSize: interactionScore,
    supportingThreadCount: 5 + (index % 3),
    uniqueAuthors24h: 40 + (index % 10),
    rootsCount24h: 5 + (index % 4),
    mentions: 60 + (index % 20),
    attentionHistory: template.attentionHistory.map((point, bucketIndex) => ({
      ...point,
      value: bucketIndex === template.attentionHistory.length - 1 ? interactionScore : 0,
    })),
    topPosts: template.topPosts.map((post, postIndex) => ({
      ...post,
      id: `${post.id}-${index + 1}-${postIndex + 1}`,
      engagement: interactionScore - postIndex,
    })),
    clusterId: `cluster-${Math.floor(index / 10)}`,
    clusterName: `Cluster ${Math.floor(index / 10)}`,
  };
}

function createWideBaseState(
  scope: "overall" | "memes" = "overall",
  count = 251,
  referenceTime = new Date("2026-03-19T12:00:00.000Z"),
): TrendDashboardVM {
  const rows = Array.from({ length: count }, (_, index) =>
    createLeaderboardTrend(scope, index, referenceTime),
  );
  const trend = rows[0];

  return {
    ...createBaseState(scope, referenceTime),
    leaderboards: {
      established: rows,
      emerging: [],
    },
    leaderboard: rows,
    detail: trend
      ? {
          trend,
          attentionGraph: trend.attentionHistory,
          attentionWindow: null,
          platformBreakdown: trend.platformBreakdown,
          topPosts: trend.topPosts,
          relatedTrends: [],
          blueskyDetail: trend.blueskyDetail ?? null,
        }
      : null,
  };
}

describe("dashboard service runtime loading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T16:00:00.000Z"));
    vi.clearAllMocks();
    runtimeStoreMocks.getDashboardSourceManifest.mockResolvedValue({
      generatedAt: "2026-03-19T12:00:00.000Z",
      combinedSignature: "sig-1",
      hasAnyData: true,
      files: [],
    });
    runtimeStoreMocks.bootstrapRuntimeBundleFromLegacyCache.mockResolvedValue(null);
    runtimeStoreMocks.loadDashboardRefreshState.mockResolvedValue({
      status: "idle",
      mode: "local_rebuild",
      trigger: "startup",
      requestedAt: null,
      startedAt: null,
      completedAt: null,
      lastError: null,
      latestBundleGeneratedAt: null,
      latestSourceSnapshotGeneratedAt: null,
    });
    runtimeStoreMocks.hasPersistedRuntimeRawSnapshot.mockResolvedValue(true);
    runtimeStoreMocks.isRuntimeBundleStale.mockReturnValue(false);
    backgroundRefreshMocks.requestDashboardBackgroundRefresh.mockResolvedValue({
      status: "scheduled",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves the latest runtime snapshot without rebuilding", async () => {
    const baseState = createBaseState();
    const bundle = createRuntimeBundle(baseState);
    runtimeStoreMocks.loadLatestDashboardRuntimeBundle.mockResolvedValue(bundle);
    runtimeStoreMocks.getRuntimeBaseState.mockReturnValue(baseState);

    const state = await getTrendDashboardState({
      scope: "overall",
      range: "24h",
      sort: "attention",
    });

    expect(state.dataStatus?.stateSource).toBe("runtime_snapshot");
    expect(state.dataStatus?.showing).toBe("cached_local");
    expect(state.leaderboard).toHaveLength(1);
    expect(runtimeStoreMocks.buildAndPersistDashboardRuntimeBundle).not.toHaveBeenCalled();
    expect(backgroundRefreshMocks.requestDashboardBackgroundRefresh).not.toHaveBeenCalled();
  });

  it("ranks the default established leaderboard by posts with deterministic tie-breakers", async () => {
    const postsTop = {
      ...createLeaderboardTrend("overall", 0),
      id: "posts-top",
      name: "Posts Top",
      attentionScore: 5,
      totalInteractions24h: 5,
      attentionInteractions: 5,
      supportingThreadCount: 14,
      trendStrengthScore: 20,
      velocityScore: 5,
    };
    const strengthHigh = {
      ...createLeaderboardTrend("overall", 1),
      id: "strength-high",
      name: "Strength High",
      attentionScore: 900,
      totalInteractions24h: 900,
      attentionInteractions: 900,
      supportingThreadCount: 12,
      trendStrengthScore: 90,
      velocityScore: 1,
    };
    const velocityHigh = {
      ...createLeaderboardTrend("overall", 2),
      id: "velocity-high",
      name: "Velocity High",
      attentionScore: 1_100,
      totalInteractions24h: 1_100,
      attentionInteractions: 1_100,
      supportingThreadCount: 12,
      trendStrengthScore: 70,
      velocityScore: 40,
    };
    const alpha = {
      ...createLeaderboardTrend("overall", 3),
      id: "alpha",
      name: "Alpha",
      attentionScore: 1_300,
      totalInteractions24h: 1_300,
      attentionInteractions: 1_300,
      supportingThreadCount: 12,
      trendStrengthScore: 70,
      velocityScore: 10,
    };
    const zeta = {
      ...createLeaderboardTrend("overall", 4),
      id: "zeta",
      name: "Zeta",
      attentionScore: 1_500,
      totalInteractions24h: 1_500,
      attentionInteractions: 1_500,
      supportingThreadCount: 12,
      trendStrengthScore: 70,
      velocityScore: 10,
    };
    const rows = [zeta, alpha, velocityHigh, strengthHigh, postsTop];
    const baseState = {
      ...createBaseState(),
      query: {
        scope: "overall" as const,
        range: "24h" as const,
        mode: "established" as const,
        sort: "posts" as const,
      },
      leaderboards: {
        established: rows,
        emerging: [],
      },
      leaderboard: rows,
    };
    const bundle = createRuntimeBundle(baseState);
    runtimeStoreMocks.loadLatestDashboardRuntimeBundle.mockResolvedValue(bundle);
    runtimeStoreMocks.getRuntimeBaseState.mockReturnValue(baseState);

    const state = await getTrendDashboardState({
      scope: "overall",
      range: "24h",
      sort: "posts",
    });

    expect(state.leaderboard.map((row) => row.id)).toEqual([
      "posts-top",
      "strength-high",
      "velocity-high",
      "alpha",
      "zeta",
    ]);
    expect(state.leaderboard.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(state.leaderboard.map((row) => row.supportingThreadCount)).toEqual([14, 12, 12, 12, 12]);
  });

  it("anchors chart windows to the live request time instead of the snapshot timestamp", async () => {
    const snapshotTime = new Date("2026-03-19T12:00:00.000Z");
    const requestTime = new Date("2026-03-19T16:00:00.000Z");
    const baseState = createBaseState("overall", snapshotTime);
    const bundle = createRuntimeBundle(baseState);
    runtimeStoreMocks.loadLatestDashboardRuntimeBundle.mockResolvedValue(bundle);
    runtimeStoreMocks.getRuntimeBaseState.mockReturnValue(baseState);

    const state = await getTrendDashboardState({
      scope: "overall",
      range: "24h",
      sort: "attention",
    });

    expect(state.detail?.attentionWindow).toMatchObject({
      windowEnd: requestTime.toISOString(),
      latestPointAt: snapshotTime.toISOString(),
      latestDataAt: snapshotTime.toISOString(),
      staleGapMinutes: 240,
      hasTrailingGap: true,
    });
    expect(state.detail?.attentionGraph.at(-1)?.timestamp).toBe(snapshotTime.toISOString());
    expect(state.overviewSeries[0]?.window?.windowEnd).toBe(requestTime.toISOString());
    expect(state.overviewSeries[0]?.points.at(-1)?.timestamp).toBe(snapshotTime.toISOString());
  });

  it("strips stale Bluesky replay from the dashboard payload", async () => {
    const baseState = createBaseState();
    const bundle = createRuntimeBundle(baseState);
    runtimeStoreMocks.loadLatestDashboardRuntimeBundle.mockResolvedValue(bundle);
    runtimeStoreMocks.getRuntimeBaseState.mockReturnValue(baseState);

    const state = await getTrendDashboardState({
      scope: "overall",
      range: "24h",
      sort: "attention",
    });

    expect(state.dataStatus?.sourceFreshness.find((entry) => entry.sourceId === "bluesky:firehose:state")?.sourceStatus).toBe("stale");
    expect(state.blueskyOverview?.replay).toEqual([]);
    expect(state.blueskyOverview?.replayWindow).toBeNull();
  });

  it("reports current firehose receipt and refresh timestamps even when event time lags", () => {
    const health = buildBlueskyFirstHealth({
      source: "reddit",
      fetchedAt: "2026-03-19T12:00:00.000Z",
      posts: [],
      comments: [],
      publicItems: [],
      blueskyPosts: [],
      blueskyInteractions: [],
      blueskyPostSnapshots: [],
      blueskyProfiles: [],
      blueskyFirehoseState: {
        status: "running",
        healthStatus: "healthy_live",
        connectionStatus: "connected",
        workerAlive: true,
        workerPid: process.pid,
        workerHeartbeatAt: "2026-03-19T15:58:00.000Z",
        lastReceivedAt: "2026-03-19T15:58:30.000Z",
        lastEventAt: "2026-03-18T10:00:00.000Z",
        lastPersistenceAt: "2026-03-19T15:58:31.000Z",
        lastAggregateRefreshAt: "2026-03-19T15:58:32.000Z",
        lastSyncCompletedAt: "2026-03-19T15:58:33.000Z",
        snapshotFreshnessMinutes: 0,
        backlogLagMinutes: 1798,
        eventsPerMinute: 450,
        rawPersistSuccessRate: 100,
        normalizationSuccessRate: 100,
        lastSyncEvents: 2250,
      },
      runs: [],
      sourceHealth: {},
      health: undefined,
      latestRun: null,
      error: null,
    });

    expect(health?.lastEventReceivedAt).toBe("2026-03-19T15:58:30.000Z");
    expect(health?.latestSuccessfulRunAt).toBe("2026-03-19T15:58:32.000Z");
    expect(health?.freshnessState).toBe("stale");
    expect(health?.averageSourceAgeMinutes).toBe(1798);
    expect(health?.schedule.rotation?.workerAlive).toBe(true);
  });

  it("marks the firehose disconnected once the stored worker pid is gone", () => {
    const health = buildBlueskyFirstHealth({
      source: "reddit",
      fetchedAt: "2026-03-19T12:00:00.000Z",
      posts: [],
      comments: [],
      publicItems: [],
      blueskyPosts: [],
      blueskyInteractions: [],
      blueskyPostSnapshots: [],
      blueskyProfiles: [],
      blueskyFirehoseState: {
        status: "running",
        healthStatus: "healthy_live",
        connectionStatus: "connected",
        workerAlive: true,
        workerPid: process.pid + 1_000_000,
        workerHeartbeatAt: "2026-03-19T15:58:00.000Z",
        lastReceivedAt: "2026-03-19T15:58:30.000Z",
        lastAggregateRefreshAt: "2026-03-19T15:58:32.000Z",
        snapshotFreshnessMinutes: 0,
        backlogLagMinutes: 0,
        eventsPerMinute: 450,
        rawPersistSuccessRate: 100,
        normalizationSuccessRate: 100,
        lastSyncEvents: 2250,
      },
      runs: [],
      sourceHealth: {},
      health: undefined,
      latestRun: null,
      error: null,
    });

    expect(health?.sourceStatus).toBe("disabled");
    expect(health?.freshnessState).toBe("stale");
    expect(health?.latestRunStatus).toBe("failed");
    expect(health?.schedule.rotation?.workerAlive).toBe(false);
  });

  it("rebuilds from local persisted raw data when no runtime snapshot exists", async () => {
    const baseState = createBaseState();
    const bundle = createRuntimeBundle(baseState);
    runtimeStoreMocks.loadLatestDashboardRuntimeBundle.mockResolvedValue(null);
    runtimeStoreMocks.getRuntimeBaseState.mockReturnValue(baseState);
    runtimeStoreMocks.buildAndPersistDashboardRuntimeBundle.mockResolvedValue({
      bundle,
      timings: {
        totalMs: 125,
        runtimeSnapshotReadMs: 0,
        sourceManifestReadMs: 1,
        localRawReadMs: 2,
        analyticsBuildMs: 110,
        variantBuildMs: 3,
        sqliteWriteMs: 9,
        steps: [],
        perQueryBuilds: [],
      },
    });

    const state = await getTrendDashboardState({
      scope: "overall",
      range: "24h",
      sort: "attention",
    });

    expect(state.dataStatus?.stateSource).toBe("local_raw_rebuild");
    expect(state.dataStatus?.showing).toBe("fresh_local_rebuild");
    expect(runtimeStoreMocks.buildAndPersistDashboardRuntimeBundle).toHaveBeenCalledTimes(1);
    expect(backgroundRefreshMocks.requestDashboardBackgroundRefresh).not.toHaveBeenCalled();
  });

  it("forces a rebuild from local raw data when requested", async () => {
    const baseState = createBaseState();
    const bundle = createRuntimeBundle(baseState, {
      origin: "startup_rebuild",
    });
    runtimeStoreMocks.loadLatestDashboardRuntimeBundle.mockResolvedValue(
      createRuntimeBundle(baseState),
    );
    runtimeStoreMocks.getRuntimeBaseState.mockReturnValue(baseState);
    runtimeStoreMocks.buildAndPersistDashboardRuntimeBundle.mockResolvedValue({
      bundle,
      timings: {
        totalMs: 140,
        runtimeSnapshotReadMs: 0,
        sourceManifestReadMs: 1,
        localRawReadMs: 2,
        analyticsBuildMs: 124,
        variantBuildMs: 4,
        sqliteWriteMs: 9,
        steps: [],
        perQueryBuilds: [],
      },
    });

    const state = await getTrendDashboardState(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        forceRebuild: true,
      },
    );

    expect(state.dataStatus?.stateSource).toBe("local_raw_rebuild");
    expect(state.dataStatus?.bundleOrigin).toBe("startup_rebuild");
    expect(runtimeStoreMocks.loadLatestDashboardRuntimeBundle).not.toHaveBeenCalled();
    expect(runtimeStoreMocks.buildAndPersistDashboardRuntimeBundle).toHaveBeenCalledWith(
      "startup_rebuild",
      expect.objectContaining({
        refreshState: expect.objectContaining({
          status: "idle",
        }),
      }),
    );
  });

  it("schedules a background local rebuild when the runtime snapshot is stale", async () => {
    const baseState = createBaseState();
    const bundle = createRuntimeBundle(baseState);
    runtimeStoreMocks.loadLatestDashboardRuntimeBundle.mockResolvedValue(bundle);
    runtimeStoreMocks.getRuntimeBaseState.mockReturnValue(baseState);
    runtimeStoreMocks.isRuntimeBundleStale.mockReturnValue(true);

    const state = await getTrendDashboardState({
      scope: "overall",
      range: "24h",
      sort: "attention",
    });

    expect(state.dataStatus?.stateSource).toBe("runtime_snapshot");
    expect(state.dataStatus?.runtimeSnapshotStale).toBe(true);
    expect(backgroundRefreshMocks.requestDashboardBackgroundRefresh).toHaveBeenCalledWith(
      "local_rebuild",
      "runtime-snapshot-stale",
      {
        queries: [
          {
            scope: "overall",
            range: "24h",
            sort: "attention",
          },
        ],
      },
    );
    expect(runtimeStoreMocks.buildAndPersistDashboardRuntimeBundle).not.toHaveBeenCalled();
  });

  it("rebuilds immediately when local source files are newer than the runtime bundle", async () => {
    const baseState = createBaseState();
    const staleBundle = createRuntimeBundle(baseState);
    const rebuiltBundle = createRuntimeBundle(baseState, {
      origin: "local_rebuild",
    });

    runtimeStoreMocks.loadLatestDashboardRuntimeBundle.mockResolvedValue(staleBundle);
    runtimeStoreMocks.getRuntimeBaseState.mockReturnValue(baseState);
    runtimeStoreMocks.isRuntimeBundleStale.mockReturnValue(true);
    runtimeStoreMocks.getDashboardSourceManifest.mockResolvedValue({
      generatedAt: "2026-03-19T12:05:00.000Z",
      combinedSignature: "sig-2",
      hasAnyData: true,
      files: [
        {
          id: "reddit_dashboard_snapshot",
          path: "/tmp/dashboard_snapshot.json",
          exists: true,
          signature: "200:1",
          sizeBytes: 200,
          updatedAt: "2026-03-19T12:05:00.000Z",
        },
      ],
    });
    runtimeStoreMocks.buildAndPersistDashboardRuntimeBundle.mockResolvedValue({
      bundle: rebuiltBundle,
      timings: {
        totalMs: 120,
        runtimeSnapshotReadMs: 1,
        sourceManifestReadMs: 1,
        localRawReadMs: 2,
        analyticsBuildMs: 105,
        variantBuildMs: 3,
        sqliteWriteMs: 8,
        steps: [],
        perQueryBuilds: [],
      },
    });

    const state = await getTrendDashboardState({
      scope: "overall",
      range: "24h",
      sort: "attention",
    });

    expect(state.dataStatus?.stateSource).toBe("local_raw_rebuild");
    expect(state.dataStatus?.bundleOrigin).toBe("local_rebuild");
    expect(runtimeStoreMocks.buildAndPersistDashboardRuntimeBundle).toHaveBeenCalledTimes(1);
    expect(backgroundRefreshMocks.requestDashboardBackgroundRefresh).not.toHaveBeenCalled();
  });

  it("rebuilds immediately when a runtime snapshot is missing Bluesky counts but Bluesky raw files exist", async () => {
    const baseState = createBaseState();
    const staleBundle = createRuntimeBundle(baseState, {
      origin: "legacy_bootstrap",
      rawCounts: {
        blueskyPosts: 0,
        blueskyInteractions: 0,
        blueskyPostSnapshots: 0,
        blueskyProfiles: 0,
      },
    });
    const rebuiltBundle = createRuntimeBundle(baseState, {
      origin: "local_rebuild",
    });

    runtimeStoreMocks.loadLatestDashboardRuntimeBundle.mockResolvedValue(staleBundle);
    runtimeStoreMocks.getRuntimeBaseState.mockReturnValue(baseState);
    runtimeStoreMocks.getDashboardSourceManifest.mockResolvedValue({
      generatedAt: "2026-03-19T12:00:00.000Z",
      combinedSignature: "sig-bluesky",
      hasAnyData: true,
      files: [
        {
          id: "bluesky_posts",
          path: "/tmp/bluesky_posts.json",
          exists: true,
          signature: "100:1",
          sizeBytes: 100,
          updatedAt: "2026-03-19T12:00:00.000Z",
        },
        {
          id: "bluesky_interactions",
          path: "/tmp/bluesky_interactions.json",
          exists: true,
          signature: "200:1",
          sizeBytes: 200,
          updatedAt: "2026-03-19T12:00:00.000Z",
        },
      ],
    });
    runtimeStoreMocks.buildAndPersistDashboardRuntimeBundle.mockResolvedValue({
      bundle: rebuiltBundle,
      timings: {
        totalMs: 120,
        runtimeSnapshotReadMs: 1,
        sourceManifestReadMs: 1,
        localRawReadMs: 2,
        analyticsBuildMs: 105,
        variantBuildMs: 3,
        sqliteWriteMs: 8,
        steps: [],
        perQueryBuilds: [],
      },
    });

    const state = await getTrendDashboardState({
      scope: "overall",
      range: "24h",
      sort: "attention",
    });

    expect(state.dataStatus?.stateSource).toBe("local_raw_rebuild");
    expect(state.dataStatus?.bundleOrigin).toBe("local_rebuild");
    expect(runtimeStoreMocks.buildAndPersistDashboardRuntimeBundle).toHaveBeenCalledTimes(1);
    expect(backgroundRefreshMocks.requestDashboardBackgroundRefresh).not.toHaveBeenCalled();
  });

  it("returns zero-state immediately when no local data exists", async () => {
    runtimeStoreMocks.loadLatestDashboardRuntimeBundle.mockResolvedValue(null);
    runtimeStoreMocks.hasPersistedRuntimeRawSnapshot.mockResolvedValue(false);
    runtimeStoreMocks.getDashboardSourceManifest.mockResolvedValue({
      generatedAt: "2026-03-19T12:00:00.000Z",
      combinedSignature: "sig-empty",
      hasAnyData: false,
      files: [],
    });

    const state = await getTrendDashboardState({
      scope: "overall",
      range: "24h",
      sort: "attention",
    });

    expect(state.dataStatus?.stateSource).toBe("zero_state");
    expect(state.leaderboard).toHaveLength(0);
    expect(backgroundRefreshMocks.requestDashboardBackgroundRefresh).not.toHaveBeenCalled();
    expect(runtimeStoreMocks.buildAndPersistDashboardRuntimeBundle).not.toHaveBeenCalled();
  });

  it("pins the selected trend into the compact dashboard response across refreshes", async () => {
    const firstBaseState = createWideBaseState("overall");
    const secondBaseState = createWideBaseState("overall");
    secondBaseState.leaderboards.established[0] = {
      ...secondBaseState.leaderboards.established[0],
      attentionScore: secondBaseState.leaderboards.established[0].attentionScore + 250,
      totalInteractions24h: (secondBaseState.leaderboards.established[0].totalInteractions24h ?? 0) + 250,
      attentionInteractions: secondBaseState.leaderboards.established[0].attentionInteractions + 250,
    };
    secondBaseState.leaderboard = secondBaseState.leaderboards.established;
    const selectedId = firstBaseState.leaderboard.at(-1)?.id;

    expect(selectedId).toBeTruthy();

    runtimeStoreMocks.loadLatestDashboardRuntimeBundle
      .mockResolvedValueOnce(createRuntimeBundle(firstBaseState))
      .mockResolvedValueOnce(createRuntimeBundle(secondBaseState, { origin: "background_refresh" }));
    runtimeStoreMocks.getRuntimeBaseState
      .mockReturnValueOnce(firstBaseState)
      .mockReturnValueOnce(secondBaseState);

    const firstState = await getTrendDashboardState({
      scope: "overall",
      range: "24h",
      sort: "attention",
      selectedId,
    });
    const secondState = await getTrendDashboardState({
      scope: "overall",
      range: "24h",
      sort: "attention",
      selectedId,
    });

    expect(firstState.detail?.trend.id).toBe(selectedId);
    expect(secondState.detail?.trend.id).toBe(selectedId);
    expect(firstState.leaderboard).toHaveLength(250);
    expect(secondState.leaderboard).toHaveLength(250);
    expect(firstState.leaderboard.some((trend) => trend.id === selectedId)).toBe(true);
    expect(secondState.leaderboard.some((trend) => trend.id === selectedId)).toBe(true);
    expect(firstState.leaderboard.at(-1)?.id).toBe(selectedId);
    expect(secondState.leaderboard.at(-1)?.id).toBe(selectedId);
    expect(firstState.query.selectedId).toBe(selectedId);
    expect(secondState.query.selectedId).toBe(selectedId);
  });
});
