import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const originalCwd = process.cwd();
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalRedditEnabled = process.env.REDDIT_ENABLED;
const RUNTIME_STORE_TEST_TIMEOUT_MS = 20_000;

let tempDir = "";

async function seedLocalSnapshot(workspaceRoot: string) {
  const snapshotDir = path.join(workspaceRoot, "data", "reddit_engine");
  const scriptsDir = path.join(workspaceRoot, "scripts");
  await fs.mkdir(snapshotDir, { recursive: true });
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.copyFile(
    path.join(originalCwd, "scripts", "sync_runtime_sqlite.py"),
    path.join(scriptsDir, "sync_runtime_sqlite.py"),
  );
  await fs.writeFile(
    path.join(snapshotDir, "dashboard_snapshot.json"),
    JSON.stringify(
      {
        source: "reddit",
        generatedAt: "2026-03-19T10:00:00.000Z",
        fetchedAt: "2026-03-19T10:00:00.000Z",
        error: null,
        posts: [
          {
            id: "post-1",
            source: "reddit",
            subreddit: "technology",
            title: "AI agent startup profile fix",
            selftext: "Local snapshot should load fast.",
            author: "user-1",
            permalink: "/r/technology/comments/post-1",
            createdUtc: Math.floor(Date.parse("2026-03-19T09:30:00.000Z") / 1000),
            score: 120,
            numComments: 14,
            url: "https://www.reddit.com/r/technology/comments/post-1",
            fetchedAt: "2026-03-19T10:00:00.000Z",
          },
        ],
        comments: [
          {
            id: "comment-1",
            source: "reddit",
            postId: "post-1",
            parentId: "t3_post-1",
            subreddit: "technology",
            author: "commenter-1",
            body: "Ship the runtime snapshot.",
            permalink: "/r/technology/comments/post-1/_/comment-1",
            createdUtc: Math.floor(Date.parse("2026-03-19T09:40:00.000Z") / 1000),
            score: 12,
            fetchedAt: "2026-03-19T10:00:00.000Z",
          },
        ],
        runs: [],
        sourceHealth: {
          technology: {
            subreddit: "technology",
            lastAttemptedAt: "2026-03-19T10:00:00.000Z",
            lastSuccessAt: "2026-03-19T10:00:00.000Z",
            consecutiveFailures: 0,
            lastPostsFetched: 1,
            lastCommentsFetched: 1,
            healthStatus: "healthy",
            storedPostsInWindow: 1,
            storedCommentsInWindow: 1,
            lastKnownPostCreatedUtc: Math.floor(Date.parse("2026-03-19T09:30:00.000Z") / 1000),
            sourceAgeMinutes: 30,
          },
        },
        latestRun: null,
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(path.join(snapshotDir, "public_items.json"), "[]", "utf8");
  await fs.writeFile(path.join(snapshotDir, "youtube_comments.json"), "[]", "utf8");
  await fs.writeFile(path.join(snapshotDir, "youtube_video_snapshots.json"), "[]", "utf8");
}

async function seedBlueskyFirehoseData(workspaceRoot: string) {
  const snapshotDir = path.join(workspaceRoot, "data", "reddit_engine");
  const fetchedAt = "2026-03-20T12:30:00.000Z";
  const syncCompletedAt = "2026-03-20T12:31:00.000Z";
  const lastReceivedAt = "2026-03-20T12:31:20.000Z";
  const lastPersistenceAt = "2026-03-20T12:31:25.000Z";
  const lastAggregateRefreshAt = "2026-03-20T12:31:30.000Z";
  const rootUri = "at://did:plc:root/app.bsky.feed.post/root1";

  await fs.writeFile(
    path.join(snapshotDir, "bluesky_posts.json"),
    JSON.stringify(
      [
        {
          id: rootUri,
          source: "bluesky",
          sourceType: "bluesky",
          uri: rootUri,
          cid: "cid-root",
          postType: "root",
          authorDid: "did:plc:root",
          authorHandle: "root.bsky.social",
          authorDisplayName: "Root",
          title: "AI agents take over the timeline",
          summary: "AI agents take over the timeline",
          url: "https://bsky.app/profile/root.bsky.social/post/root1",
          createdUtc: Math.floor(Date.parse("2026-03-20T12:20:00.000Z") / 1000),
          score: 42,
          likeCount: 1,
          replyCount: 1,
          repostCount: 1,
          quoteCount: 0,
          interactionCounts: {
            posts: 1,
            reposts: 1,
            comments: 1,
            likes: 1,
          },
          fetchedAt,
          firstSeenAt: fetchedAt,
          lastObservedAt: fetchedAt,
          priorityScore: 12,
        },
      ],
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(snapshotDir, "bluesky_interactions.json"),
    JSON.stringify(
      [
        {
          id: "like-1",
          source: "bluesky",
          sourceType: "bluesky_interaction",
          interactionType: "like",
          postUri: rootUri,
          eventUri: "at://did:plc:liker/app.bsky.feed.like/like1",
          rootUri,
          actorDid: "did:plc:liker",
          actorHandle: "liker.bsky.social",
          actorDisplayName: "Liker",
          createdUtc: Math.floor(Date.parse("2026-03-20T12:25:00.000Z") / 1000),
          fetchedAt,
          url: "https://bsky.app/profile/root.bsky.social/post/root1",
        },
        {
          id: "reply-1",
          source: "bluesky",
          sourceType: "bluesky_interaction",
          interactionType: "reply",
          postUri: rootUri,
          eventUri: "at://did:plc:reply/app.bsky.feed.post/reply1",
          rootUri,
          parentUri: rootUri,
          actorDid: "did:plc:reply",
          actorHandle: "reply.bsky.social",
          actorDisplayName: "Reply",
          text: "This narrative is accelerating fast.",
          createdUtc: Math.floor(Date.parse("2026-03-20T12:26:00.000Z") / 1000),
          fetchedAt,
          url: "https://bsky.app/profile/reply.bsky.social/post/reply1",
        },
        {
          id: "repost-1",
          source: "bluesky",
          sourceType: "bluesky_interaction",
          interactionType: "repost",
          postUri: rootUri,
          eventUri: "at://did:plc:reposter/app.bsky.feed.repost/repost1",
          rootUri,
          actorDid: "did:plc:reposter",
          actorHandle: "reposter.bsky.social",
          actorDisplayName: "Reposter",
          createdUtc: Math.floor(Date.parse("2026-03-20T12:27:00.000Z") / 1000),
          fetchedAt,
          url: "https://bsky.app/profile/root.bsky.social/post/root1",
        },
      ],
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(snapshotDir, "bluesky_post_snapshots.json"),
    JSON.stringify(
      [
        {
          id: "snapshot-1",
          postUri: rootUri,
          fetchedAt,
          createdUtc: Math.floor(Date.parse("2026-03-20T12:20:00.000Z") / 1000),
          likeCount: 1,
          replyCount: 1,
          repostCount: 1,
          quoteCount: 0,
          deltaLikeCount: 1,
          deltaCommentCount: 1,
          deltaRepostCount: 1,
          deltaQuoteCount: 0,
          deltaWindowMinutes: 10,
        },
      ],
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(snapshotDir, "bluesky_profiles.json"),
    JSON.stringify(
      [
        {
          did: "did:plc:root",
          handle: "root.bsky.social",
          displayName: "Root",
          description: "Root account",
          fetchedAt,
          firstObservedAt: fetchedAt,
          lastObservedAt: fetchedAt,
          lastActivityAt: fetchedAt,
          observedPostCount: 1,
          amplificationScore: 5,
          sourcePostUris: [rootUri],
        },
        {
          did: "did:plc:liker",
          handle: "liker.bsky.social",
          displayName: "Liker",
          fetchedAt,
          firstObservedAt: fetchedAt,
          lastObservedAt: fetchedAt,
          lastActivityAt: fetchedAt,
          amplificationScore: 1,
        },
      ],
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(snapshotDir, "bluesky_firehose_state.json"),
    JSON.stringify(
      {
        enabled: true,
        provider: "jetstream",
        endpoint: "wss://jetstream.example",
        wantedCollections: [
          "app.bsky.feed.post",
          "app.bsky.feed.like",
          "app.bsky.feed.repost",
        ],
        cursor: 1_742_474_260_000_000,
        lastEventTimeUs: 1_742_474_260_000_000,
        lastEventAt: "2026-03-20T12:30:00.000000+00:00",
        lastReceivedAt,
        lastSyncStartedAt: fetchedAt,
        lastSyncCompletedAt: syncCompletedAt,
        lastPersistenceAt,
        lastAggregateRefreshAt,
        lastSyncDurationMs: 4200,
        lastSyncEvents: 9,
        backlogLagMinutes: 1.2,
        bootstrapCursorTimeUs: 1_742_470_000_000_000,
        bootstrapMode: "resume",
        status: "succeeded",
        healthStatus: "healthy_live",
        connectionStatus: "connected",
        workerAlive: true,
        workerHeartbeatAt: lastAggregateRefreshAt,
        lastError: null,
        stats: {
          eventsProcessed: 9,
          postsObserved: 1,
          likesObserved: 1,
          repostsObserved: 1,
          repliesObserved: 1,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    fetchedAt,
    syncCompletedAt,
    lastReceivedAt,
    lastAggregateRefreshAt,
  };
}

async function seedStaleBlueskyFirehoseData(workspaceRoot: string) {
  const snapshotDir = path.join(workspaceRoot, "data", "reddit_engine");
  const staleAt = "2026-03-18T08:00:00.000Z";
  await fs.writeFile(
    path.join(snapshotDir, "bluesky_firehose_state.json"),
    JSON.stringify(
      {
        enabled: true,
        provider: "jetstream",
        endpoint: "wss://jetstream.example",
        wantedCollections: ["app.bsky.feed.post"],
        cursor: 1_742_000_000_000_000,
        lastEventTimeUs: 1_742_000_000_000_000,
        lastEventAt: staleAt,
        lastReceivedAt: staleAt,
        workerHeartbeatAt: staleAt,
        lastSyncStartedAt: staleAt,
        lastSyncCompletedAt: staleAt,
        lastSyncDurationMs: 4200,
        lastSyncEvents: 9,
        backlogLagMinutes: 278.4,
        bootstrapCursorTimeUs: 1_742_000_000_000_000,
        bootstrapMode: "resume",
        status: "succeeded",
        healthStatus: "disconnected",
        connectionStatus: "disconnected",
        workerAlive: false,
        lastError: null,
        reconnectCount: 4,
        lastPersistenceAt: staleAt,
        lastAggregateRefreshAt: staleAt,
        wallClockLagMinutes: 278.4,
        stats: {
          eventsProcessed: 9,
          postsObserved: 1,
          likesObserved: 1,
          repostsObserved: 1,
          repliesObserved: 1,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

describe("dashboard runtime store persistence", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dashboard-runtime-store-"));
    process.chdir(tempDir);
    delete process.env.OPENAI_API_KEY;
    delete process.env.REDDIT_ENABLED;
    vi.resetModules();
    await seedLocalSnapshot(tempDir);
  });

  afterEach(async () => {
    vi.resetModules();
    process.chdir(originalCwd);
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
    if (originalRedditEnabled === undefined) {
      delete process.env.REDDIT_ENABLED;
    } else {
      process.env.REDDIT_ENABLED = originalRedditEnabled;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("persists and reloads the latest dashboard runtime snapshot from local data", async () => {
    const runtimeStore = await import("@/lib/dashboard/runtime-store");

    const { bundle } = await runtimeStore.buildAndPersistDashboardRuntimeBundle("startup_rebuild", {
      requestedQueries: [{ scope: "overall", range: "24h", sort: "attention" }],
    });
    const latestBundle = await runtimeStore.loadLatestDashboardRuntimeBundle();

    await expect(
      fs.stat(path.join(tempDir, "runtime", "snapshots", "latest.json")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(tempDir, "runtime", "raw", "latest-reddit-ingestion.json")),
    ).resolves.toBeTruthy();
    await expect(fs.stat(path.join(tempDir, "runtime", "app.sqlite3"))).resolves.toBeTruthy();

    expect(bundle.rawCounts.posts).toBe(1);
    expect(bundle.rawCounts.comments).toBe(1);
    expect(bundle.baseStates["overall:24h"]).toBeTruthy();
    expect(latestBundle?.generatedAt).toBe(bundle.generatedAt);
    expect(latestBundle?.sourceFreshness[0]?.sourceLabel).toBe("r/technology");
  }, RUNTIME_STORE_TEST_TIMEOUT_MS);

  it("recovers a stale running refresh state from a dead prior process", async () => {
    const runtimeStore = await import("@/lib/dashboard/runtime-store");
    const refreshStatePath = path.join(tempDir, "runtime", "cache", "refresh-state.json");

    await fs.mkdir(path.dirname(refreshStatePath), { recursive: true });
    await fs.writeFile(
      refreshStatePath,
      JSON.stringify(
        {
          status: "running",
          mode: "local_rebuild",
          trigger: "startup",
          requestedAt: "2026-03-20T12:00:00.000Z",
          startedAt: "2026-03-20T12:01:00.000Z",
          completedAt: null,
          lastError: null,
          latestBundleGeneratedAt: null,
          latestSourceSnapshotGeneratedAt: null,
          ownerPid: 999999,
          ownerSessionId: "999999:old-session",
        },
        null,
        2,
      ),
      "utf8",
    );

    const recovered = await runtimeStore.loadDashboardRefreshState();
    const persisted = JSON.parse(await fs.readFile(refreshStatePath, "utf8"));

    expect(recovered?.status).toBe("failed");
    expect(recovered?.lastError).toContain("stale refresh state cleared");
    expect(recovered?.staleReason).toContain("owner pid 999999 is no longer running");
    expect(recovered?.staleClearedAt).toBeTruthy();
    expect(persisted.status).toBe("failed");
    expect(persisted.staleClearedAt).toBeTruthy();
    expect(persisted.staleReason).toContain("owner pid 999999 is no longer running");
  }, RUNTIME_STORE_TEST_TIMEOUT_MS);

  it("rebuilds from existing Bluesky disk data and advances latest.json", async () => {
    const oldGeneratedAt = "2026-03-18T00:00:00.000Z";
    const { lastAggregateRefreshAt } = await seedBlueskyFirehoseData(tempDir);
    const latestPath = path.join(tempDir, "runtime", "snapshots", "latest.json");

    await fs.mkdir(path.dirname(latestPath), { recursive: true });
    await fs.writeFile(
      latestPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: oldGeneratedAt,
          origin: "legacy_bootstrap",
          sourceManifest: {
            generatedAt: oldGeneratedAt,
            combinedSignature: "legacy",
            hasAnyData: true,
            files: [],
          },
          sourceSnapshotGeneratedAt: "2026-03-18T00:00:00.000Z",
          latestFetchedAt: "2026-03-18T00:00:00.000Z",
          rawCounts: {
            posts: 1,
            comments: 1,
            publicItems: 0,
            blueskyPosts: 0,
            blueskyInteractions: 0,
            blueskyPostSnapshots: 0,
            blueskyProfiles: 0,
            youtubeComments: 0,
            youtubeVideoSnapshots: 0,
          },
          sourceFreshness: [],
          baseStates: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const runtimeStore = await import("@/lib/dashboard/runtime-store");
    const { bundle } = await runtimeStore.buildAndPersistDashboardRuntimeBundle("startup_rebuild", {
      requestedQueries: [{ scope: "overall", range: "24h", sort: "attention" }],
    });
    const latestBundle = await runtimeStore.loadLatestDashboardRuntimeBundle();

    expect(bundle.generatedAt).not.toBe(oldGeneratedAt);
    expect(bundle.rawCounts.blueskyPosts).toBeGreaterThan(0);
    expect(bundle.rawCounts.blueskyInteractions).toBeGreaterThan(0);
    expect(bundle.rawCounts.blueskyPostSnapshots).toBeGreaterThan(0);
    expect(bundle.rawCounts.blueskyProfiles).toBeGreaterThan(0);
    expect(bundle.latestFetchedAt).toBe(lastAggregateRefreshAt);
    expect(bundle.sourceSnapshotGeneratedAt).toBe(lastAggregateRefreshAt);
    expect(
      bundle.sourceFreshness.some((entry) => entry.sourceId === "bluesky:firehose:state"),
    ).toBe(true);
    expect(latestBundle?.generatedAt).toBe(bundle.generatedAt);
    expect(latestBundle?.rawCounts.blueskyPosts).toBe(bundle.rawCounts.blueskyPosts);
    expect(latestBundle?.rawCounts.blueskyInteractions).toBe(bundle.rawCounts.blueskyInteractions);
  }, RUNTIME_STORE_TEST_TIMEOUT_MS);

  it("marks a stale Bluesky firehose worker as stale in source freshness", async () => {
    await seedStaleBlueskyFirehoseData(tempDir);

    const runtimeStore = await import("@/lib/dashboard/runtime-store");
    const { bundle } = await runtimeStore.buildAndPersistDashboardRuntimeBundle("startup_rebuild", {
      requestedQueries: [{ scope: "overall", range: "24h", sort: "attention" }],
    });

    const firehoseFreshness = bundle.sourceFreshness.find(
      (entry) => entry.sourceId === "bluesky:firehose:state",
    );

    expect(firehoseFreshness?.sourceStatus).toBe("stale");
    expect(firehoseFreshness?.ageMinutes).toBeGreaterThanOrEqual(278);
    expect(firehoseFreshness?.lastFetchedAt).toBe("2026-03-18T08:00:00.000Z");
  }, RUNTIME_STORE_TEST_TIMEOUT_MS);

  it("persists rich detail for visible leaderboard rows while keeping the in-memory bundle rich", async () => {
    await seedBlueskyFirehoseData(tempDir);

    const runtimeStore = await import("@/lib/dashboard/runtime-store");
    const { bundle } = await runtimeStore.buildAndPersistDashboardRuntimeBundle("startup_rebuild", {
      requestedQueries: [{ scope: "overall", range: "24h", sort: "attention" }],
    });
    const latestBundle = await runtimeStore.loadLatestDashboardRuntimeBundle();

    const inMemoryRow = bundle.baseStates["overall:24h"]?.leaderboard[0];
    const persistedRow = latestBundle?.baseStates["overall:24h"]?.leaderboard[0];

    expect(inMemoryRow).toBeTruthy();
    expect(persistedRow).toBeTruthy();
    expect(inMemoryRow?.attentionHistory.length).toBeGreaterThan(0);
    expect(persistedRow?.attentionHistory.length).toBeGreaterThan(0);
    expect(persistedRow?.platformBreakdown.length ?? 0).toBeGreaterThan(0);
    expect(persistedRow?.topPosts.length ?? 0).toBeGreaterThan(0);
    expect(persistedRow?.blueskyDetail ?? null).not.toBeNull();
  }, RUNTIME_STORE_TEST_TIMEOUT_MS);

  it("ignores persisted reddit documents when REDDIT_ENABLED=0", async () => {
    process.env.REDDIT_ENABLED = "0";
    vi.resetModules();

    const runtimeStore = await import("@/lib/dashboard/runtime-store");
    const { bundle } = await runtimeStore.buildAndPersistDashboardRuntimeBundle("startup_rebuild", {
      requestedQueries: [{ scope: "overall", range: "24h", sort: "attention" }],
    });

    expect(bundle.rawCounts.posts).toBe(0);
    expect(bundle.rawCounts.comments).toBe(0);
    expect(
      bundle.sourceFreshness.some(
        (entry) => entry.platformId === "reddit" && entry.sourceStatus === "disabled",
      ),
    ).toBe(true);
    expect(bundle.baseStates["overall:24h"]?.ingestionHealth?.primarySource).toBe("bluesky");
    expect(bundle.baseStates["overall:24h"]?.ingestionHealth?.sourceStatuses?.reddit).toBe("disabled");
  }, RUNTIME_STORE_TEST_TIMEOUT_MS);

  it("anchors live Bluesky rebuilds to the firehose materialization time when REDDIT_ENABLED=0", async () => {
    process.env.REDDIT_ENABLED = "0";
    vi.resetModules();
    const { lastReceivedAt, lastAggregateRefreshAt } = await seedBlueskyFirehoseData(tempDir);

    const runtimeStore = await import("@/lib/dashboard/runtime-store");
    const { bundle } = await runtimeStore.buildAndPersistDashboardRuntimeBundle("startup_rebuild", {
      requestedQueries: [{ scope: "overall", range: "24h", sort: "attention" }],
    });

    const baseState = bundle.baseStates["overall:24h"];

    expect(bundle.latestFetchedAt).toBe(lastAggregateRefreshAt);
    expect(bundle.sourceSnapshotGeneratedAt).toBe(lastAggregateRefreshAt);
    expect(baseState?.leaderboards.established.length ?? 0).toBeGreaterThan(0);
    expect(baseState?.leaderboards.established[0]?.source).toBe("bluesky");
    expect(baseState?.ingestionHealth?.lastEventReceivedAt).toBe(lastReceivedAt);
    expect(baseState?.ingestionHealth?.latestSuccessfulRunAt).toBe(lastAggregateRefreshAt);
  }, RUNTIME_STORE_TEST_TIMEOUT_MS);
});
