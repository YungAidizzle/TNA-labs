import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  BlueskyFirehoseState,
  BlueskyInteraction,
  BlueskyNormalizedPost,
  BlueskyPostSnapshot,
  BlueskyProfile,
  PublicSourceItem,
  RedditIngestionHealth,
  RedditIngestionSnapshot,
  YouTubeNormalizedComment,
  YouTubeVideoSnapshot,
} from "@/lib/reddit/types";
import { isProcessAlive } from "@/lib/runtime/process";
import { loadTelegramTrendItemsFromDisk, TELEGRAM_TRENDS_FILE_PATH } from "@/lib/telegram/local-store";

export const REDDIT_ENGINE_SNAPSHOT_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_engine",
  "dashboard_snapshot.json",
);

export const LEGACY_REDDIT_DATA_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_posts.json",
);

export const PUBLIC_ITEMS_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_engine",
  "public_items.json",
);

export const YOUTUBE_COMMENTS_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_engine",
  "youtube_comments.json",
);

export const YOUTUBE_VIDEO_SNAPSHOTS_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_engine",
  "youtube_video_snapshots.json",
);

export const BLUESKY_POSTS_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_engine",
  "bluesky_posts.json",
);

export const BLUESKY_INTERACTIONS_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_engine",
  "bluesky_interactions.json",
);

export const BLUESKY_POST_SNAPSHOTS_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_engine",
  "bluesky_post_snapshots.json",
);

export const BLUESKY_PROFILES_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_engine",
  "bluesky_profiles.json",
);

export const BLUESKY_FIREHOSE_STATE_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_engine",
  "bluesky_firehose_state.json",
);

type FileSignature = {
  exists: boolean;
  signature: string;
};

type CachedSnapshot = {
  sourceSignature: string;
  publicItemsSignature: string;
  blueskyPostsSignature: string;
  blueskyInteractionsSignature: string;
  blueskySnapshotsSignature: string;
  blueskyProfilesSignature: string;
  blueskyFirehoseStateSignature: string;
  youtubeCommentsSignature: string;
  youtubeSnapshotsSignature: string;
  redditEnabled: boolean;
  value: RedditIngestionSnapshot;
};

let cachedSnapshot: CachedSnapshot | null = null;
const LOCAL_STORE_DEBUG = process.env.NODE_ENV !== "production";
const REDDIT_ENABLED = !["0", "false", "no", "off"].includes(
  String(process.env.REDDIT_ENABLED ?? "1").trim().toLowerCase(),
);

function applySourceFlags(snapshot: RedditIngestionSnapshot): RedditIngestionSnapshot {
  if (REDDIT_ENABLED) {
    return snapshot;
  }

  return {
    ...snapshot,
    posts: [],
    comments: [],
    runs: [],
    sourceHealth: {},
    health: buildBlueskyFirstHealth(snapshot),
    latestRun: null,
  };
}

function toIsoFromUtcSeconds(value: number | null | undefined) {
  if (!value || value <= 0) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function getAgeMinutesFromIso(isoValue: string | null | undefined) {
  if (!isoValue) {
    return null;
  }

  const timestamp = Date.parse(isoValue);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
}

function getLatestIsoTimestamp(...values: Array<string | null | undefined>) {
  const normalized = values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort();
  return normalized.at(-1) ?? null;
}

function getBlueskyFirehoseSnapshotTimestamp(state: BlueskyFirehoseState | null | undefined) {
  if (!state) {
    return null;
  }

  return getLatestIsoTimestamp(
    state.lastAggregateRefreshAt,
    state.lastPersistenceAt,
    state.lastReceivedAt,
    state.workerHeartbeatAt,
    state.lastSyncCompletedAt,
    state.lastSyncStartedAt,
    state.lastEventAt,
  );
}

export function buildBlueskyFirstHealth(
  snapshot: RedditIngestionSnapshot,
): RedditIngestionHealth | undefined {
  const state = snapshot.blueskyFirehoseState;
  const workerPid = typeof state?.workerPid === "number" ? state.workerPid : null;
  const workerAlive =
    workerPid !== null ? isProcessAlive(workerPid) && state?.workerAlive !== false : false;
  const latestSuccessfulRunAt =
    state?.lastAggregateRefreshAt ??
    state?.lastPersistenceAt ??
    state?.lastSyncCompletedAt ??
    state?.lastSyncStartedAt ??
    state?.lastReceivedAt ??
    state?.lastEventAt ??
    snapshot.fetchedAt ??
    null;
  const latestEventReceivedAt = state?.lastReceivedAt ?? state?.lastEventAt ?? null;
  const latestEventObservedAt = state?.lastEventAt ?? null;
  const latestWorkerHeartbeatAt = state?.workerHeartbeatAt ?? null;
  const latestAggregateRefreshAt = state?.lastAggregateRefreshAt ?? null;
  const heartbeatAgeMinutes = getAgeMinutesFromIso(latestWorkerHeartbeatAt);
  const eventAgeMinutes = getAgeMinutesFromIso(latestEventReceivedAt);
  const aggregateRefreshAgeMinutes = getAgeMinutesFromIso(latestAggregateRefreshAt);
  const snapshotFreshnessMinutes =
    state?.snapshotFreshnessMinutes ??
    getAgeMinutesFromIso(latestSuccessfulRunAt ?? latestEventReceivedAt);
  const lagMinutes =
    typeof state?.backlogLagMinutes === "number" ? Math.max(0, Math.round(state.backlogLagMinutes)) : null;
  const streamLagSeconds =
    typeof state?.backlogLagMinutes === "number" && Number.isFinite(state.backlogLagMinutes)
      ? Math.max(0, Math.round(state.backlogLagMinutes * 60))
      : eventAgeMinutes !== null
        ? Math.max(0, Math.round(eventAgeMinutes * 60))
        : null;
  const effectiveFreshnessAge =
    lagMinutes ?? aggregateRefreshAgeMinutes ?? snapshotFreshnessMinutes ?? eventAgeMinutes ?? null;
  const heartbeatTooOld = heartbeatAgeMinutes !== null && heartbeatAgeMinutes > 10;
  const eventTooOld = eventAgeMinutes !== null && eventAgeMinutes > 30;
  const workerDisconnected =
    state?.status === "failed" ||
    state?.healthStatus === "disconnected" ||
    state?.connectionStatus === "disconnected" ||
    (workerPid !== null && !workerAlive) ||
    (workerAlive && heartbeatTooOld && eventTooOld);

  let freshnessState: RedditIngestionHealth["freshnessState"] = "empty";
  if ((snapshot.blueskyPosts?.length ?? 0) > 0 || (snapshot.blueskyInteractions?.length ?? 0) > 0 || state) {
    if (workerDisconnected) {
      freshnessState = "stale";
    } else if (state?.healthStatus === "persistence_failed" || state?.healthStatus === "normalization_failed") {
      freshnessState = "degraded";
    } else if (effectiveFreshnessAge !== null && effectiveFreshnessAge <= 15) {
      freshnessState = "fresh";
    } else if (effectiveFreshnessAge !== null && effectiveFreshnessAge <= 60) {
      freshnessState = "delayed";
    } else if (effectiveFreshnessAge !== null && effectiveFreshnessAge <= 180) {
      freshnessState = "degraded";
    } else {
      freshnessState = "stale";
    }
  }

  const freshnessScore =
    freshnessState === "fresh"
      ? 96
      : freshnessState === "delayed"
        ? 78
        : freshnessState === "degraded"
          ? 52
          : freshnessState === "stale"
            ? 18
            : 0;

  const oldestStoredPostAt =
    [...(snapshot.blueskyPosts ?? [])]
      .map((post) => toIsoFromUtcSeconds(post.createdUtc))
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(0) ?? null;

  return {
    primarySource: "bluesky",
    sourceStatus: workerDisconnected ? "disabled" : "active",
    sourceStatuses: {
      bluesky: workerDisconnected ? "disabled" : "active",
      reddit: "disabled",
    },
    freshnessState,
    coverageScore:
      typeof state?.rawPersistSuccessRate === "number"
        ? Math.max(0, Math.min(100, Math.round(state.rawPersistSuccessRate)))
        : freshnessState === "empty"
          ? 0
          : 100,
    freshnessScore,
    fetchSuccessRate:
      typeof state?.rawPersistSuccessRate === "number"
        ? Math.max(0, Math.min(100, Math.round(state.rawPersistSuccessRate)))
        : state?.status === "failed"
          ? 0
          : 100,
    activeSubredditCount: 0,
    refreshed1hPct: freshnessState === "fresh" ? 100 : freshnessState === "empty" ? 0 : 50,
    refreshed6hPct: freshnessState === "stale" || freshnessState === "empty" ? 0 : 100,
    refreshed24hPct: freshnessState === "empty" ? 0 : 100,
    averageSourceAgeMinutes: effectiveFreshnessAge,
    latestSuccessfulRunAt,
    latestRunId: state?.cursor ? `bluesky-firehose:${state.cursor}` : null,
    latestRunMode: null,
    latestRunStatus: workerDisconnected ? "failed" : state ? "success" : "empty",
    latestRunBucketId: null,
    latestRunAttempted: state?.lastSyncEvents ?? 0,
    latestRunSucceeded:
      typeof state?.normalizationAttempts === "number"
        ? Math.max(0, state.normalizationAttempts - (state.normalizationFailures ?? 0))
        : state?.lastSyncEvents ?? 0,
    latestRunFailed: state?.normalizationFailures ?? 0,
    sourcesCovered7dPct: freshnessState === "empty" ? 0 : 100,
    backfillCompletedSources: 0,
    backfillCoveragePct: 0,
    backfillCompletenessPct: 0,
    postsInWindow: snapshot.blueskyPosts?.length ?? 0,
    commentsInWindow: snapshot.blueskyInteractions?.length ?? 0,
    oldestStoredPostAt,
    totalTrackedSources: 1,
    eventsPerMinute: state?.eventsPerMinute ?? null,
    rawPersistSuccessRate: state?.rawPersistSuccessRate ?? null,
    normalizationSuccessRate: state?.normalizationSuccessRate ?? null,
    snapshotFreshnessMinutes,
    lastEventReceivedAt: latestEventReceivedAt,
    lastEventObservedAt: latestEventObservedAt,
    latestWorkerHeartbeatAt,
    streamLagSeconds,
    categoryCount: 1,
    categoriesTracked: { bluesky: 1 },
    tiersTracked: { primary: 1 },
    schedule: {
      live: {
        currentBucketId: null,
        currentBucketIndex: 0,
        lastCompletedBucketId: null,
      },
      backfill: {
        currentBucketId: null,
        currentBucketIndex: 0,
        lastCompletedBucketId: null,
      },
      totalBuckets: 0,
      liveTotalBuckets: 0,
      backfillTotalBuckets: 0,
      trackedSubreddits: 0,
      rotation: {
        runtimeVersion: state?.provider ?? "jetstream",
        workerPid,
        workerStatus: state?.healthStatus ?? state?.status ?? null,
        workerAlive,
        workerHeartbeatAt: state?.workerHeartbeatAt ?? null,
      },
    },
  };
}

async function getFileSignature(filePath: string): Promise<FileSignature> {
  try {
    const stat = await fs.stat(filePath);
    return {
      exists: true,
      signature: `${stat.size}:${stat.mtimeMs}`,
    };
  } catch {
    return {
      exists: false,
      signature: "missing",
    };
  }
}

async function loadPublicItemsFromDisk(): Promise<PublicSourceItem[]> {
  try {
    const [publicItems, telegramItems] = await Promise.all([
      (async () => {
        try {
          const raw = await fs.readFile(PUBLIC_ITEMS_FILE_PATH, "utf8");
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? (parsed as PublicSourceItem[]) : [];
        } catch {
          return [];
        }
      })(),
      loadTelegramTrendItemsFromDisk(),
    ]);

    if (LOCAL_STORE_DEBUG) {
      console.info("[local-store] public source load", {
        publicItems: publicItems.length,
        telegramItems: telegramItems.length,
        combinedItems: publicItems.length + telegramItems.length,
      });
    }

    return [...publicItems, ...telegramItems];
  } catch {
    return [];
  }
}

async function loadYouTubeCommentsFromDisk(): Promise<YouTubeNormalizedComment[]> {
  try {
    const raw = await fs.readFile(YOUTUBE_COMMENTS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as YouTubeNormalizedComment[]) : [];
  } catch {
    return [];
  }
}

async function loadBlueskyPostsFromDisk(): Promise<BlueskyNormalizedPost[]> {
  try {
    const raw = await fs.readFile(BLUESKY_POSTS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BlueskyNormalizedPost[]) : [];
  } catch {
    return [];
  }
}

async function loadBlueskyInteractionsFromDisk(): Promise<BlueskyInteraction[]> {
  try {
    const raw = await fs.readFile(BLUESKY_INTERACTIONS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BlueskyInteraction[]) : [];
  } catch {
    return [];
  }
}

async function loadBlueskyPostSnapshotsFromDisk(): Promise<BlueskyPostSnapshot[]> {
  try {
    const raw = await fs.readFile(BLUESKY_POST_SNAPSHOTS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BlueskyPostSnapshot[]) : [];
  } catch {
    return [];
  }
}

async function loadBlueskyProfilesFromDisk(): Promise<BlueskyProfile[]> {
  try {
    const raw = await fs.readFile(BLUESKY_PROFILES_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BlueskyProfile[]) : [];
  } catch {
    return [];
  }
}

async function loadBlueskyFirehoseStateFromDisk(): Promise<BlueskyFirehoseState | null> {
  try {
    const raw = await fs.readFile(BLUESKY_FIREHOSE_STATE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as BlueskyFirehoseState) : null;
  } catch {
    return null;
  }
}

async function loadYouTubeVideoSnapshotsFromDisk(): Promise<YouTubeVideoSnapshot[]> {
  try {
    const raw = await fs.readFile(YOUTUBE_VIDEO_SNAPSHOTS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as YouTubeVideoSnapshot[]) : [];
  } catch {
    return [];
  }
}

export async function loadRedditSnapshot(): Promise<RedditIngestionSnapshot> {
  const [
    snapshotSignature,
    legacySignature,
    publicItemsSignature,
    telegramSignature,
    blueskyPostsSignature,
    blueskyInteractionsSignature,
    blueskySnapshotsSignature,
    blueskyProfilesSignature,
    blueskyFirehoseStateSignature,
    youtubeCommentsSignature,
    youtubeSnapshotsSignature,
  ] = await Promise.all([
    getFileSignature(REDDIT_ENGINE_SNAPSHOT_FILE_PATH),
    getFileSignature(LEGACY_REDDIT_DATA_FILE_PATH),
    getFileSignature(PUBLIC_ITEMS_FILE_PATH),
    getFileSignature(TELEGRAM_TRENDS_FILE_PATH),
    getFileSignature(BLUESKY_POSTS_FILE_PATH),
    getFileSignature(BLUESKY_INTERACTIONS_FILE_PATH),
    getFileSignature(BLUESKY_POST_SNAPSHOTS_FILE_PATH),
    getFileSignature(BLUESKY_PROFILES_FILE_PATH),
    getFileSignature(BLUESKY_FIREHOSE_STATE_FILE_PATH),
    getFileSignature(YOUTUBE_COMMENTS_FILE_PATH),
    getFileSignature(YOUTUBE_VIDEO_SNAPSHOTS_FILE_PATH),
  ]);
  const sourceSignature = snapshotSignature.exists
    ? `current:${snapshotSignature.signature}`
    : `legacy:${legacySignature.signature}`;
  const mergedPublicItemsSignature = `${publicItemsSignature.signature}|telegram:${telegramSignature.signature}`;

  if (
    cachedSnapshot &&
    cachedSnapshot.sourceSignature === sourceSignature &&
    cachedSnapshot.publicItemsSignature === mergedPublicItemsSignature &&
    cachedSnapshot.blueskyPostsSignature === blueskyPostsSignature.signature &&
    cachedSnapshot.blueskyInteractionsSignature === blueskyInteractionsSignature.signature &&
    cachedSnapshot.blueskySnapshotsSignature === blueskySnapshotsSignature.signature &&
    cachedSnapshot.blueskyProfilesSignature === blueskyProfilesSignature.signature &&
    cachedSnapshot.blueskyFirehoseStateSignature === blueskyFirehoseStateSignature.signature &&
    cachedSnapshot.youtubeCommentsSignature === youtubeCommentsSignature.signature &&
    cachedSnapshot.youtubeSnapshotsSignature === youtubeSnapshotsSignature.signature &&
    cachedSnapshot.redditEnabled === REDDIT_ENABLED
  ) {
    if (LOCAL_STORE_DEBUG) {
      console.info("[local-store] using cached reddit snapshot", {
        redditEnabled: REDDIT_ENABLED,
        posts: cachedSnapshot.value.posts.length,
        comments: cachedSnapshot.value.comments.length,
        publicItems: cachedSnapshot.value.publicItems?.length ?? 0,
        blueskyPosts: cachedSnapshot.value.blueskyPosts?.length ?? 0,
        blueskyInteractions: cachedSnapshot.value.blueskyInteractions?.length ?? 0,
        blueskyPostSnapshots: cachedSnapshot.value.blueskyPostSnapshots?.length ?? 0,
        blueskyProfiles: cachedSnapshot.value.blueskyProfiles?.length ?? 0,
        youtubeComments: cachedSnapshot.value.youtubeComments?.length ?? 0,
        youtubeVideoSnapshots: cachedSnapshot.value.youtubeVideoSnapshots?.length ?? 0,
      });
    }
    return cachedSnapshot.value;
  }

  const [
    publicItems,
    blueskyPosts,
    blueskyInteractions,
    blueskyPostSnapshots,
    blueskyProfiles,
    blueskyFirehoseState,
    youtubeComments,
    youtubeVideoSnapshots,
  ] = await Promise.all([
    loadPublicItemsFromDisk(),
    loadBlueskyPostsFromDisk(),
    loadBlueskyInteractionsFromDisk(),
    loadBlueskyPostSnapshotsFromDisk(),
    loadBlueskyProfilesFromDisk(),
    loadBlueskyFirehoseStateFromDisk(),
    loadYouTubeCommentsFromDisk(),
    loadYouTubeVideoSnapshotsFromDisk(),
  ]);
  const liveBlueskySnapshotAt = getBlueskyFirehoseSnapshotTimestamp(blueskyFirehoseState);

  try {
    const raw = await fs.readFile(REDDIT_ENGINE_SNAPSHOT_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<RedditIngestionSnapshot>;

    const snapshot = applySourceFlags({
      source: "reddit",
      generatedAt: getLatestIsoTimestamp(parsed.generatedAt ?? null, liveBlueskySnapshotAt),
      fetchedAt: getLatestIsoTimestamp(parsed.fetchedAt ?? null, liveBlueskySnapshotAt),
      posts: Array.isArray(parsed.posts) ? parsed.posts : [],
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      publicItems,
      blueskyPosts,
      blueskyInteractions,
      blueskyPostSnapshots,
      blueskyProfiles,
      blueskyFirehoseState,
      youtubeComments,
      youtubeVideoSnapshots,
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      sourceHealth:
        parsed.sourceHealth && typeof parsed.sourceHealth === "object"
          ? parsed.sourceHealth
          : {},
      health: parsed.health ?? undefined,
      latestRun: parsed.latestRun ?? null,
      error: typeof parsed.error === "string" ? parsed.error : null,
    });
    cachedSnapshot = {
      sourceSignature,
      publicItemsSignature: mergedPublicItemsSignature,
      blueskyPostsSignature: blueskyPostsSignature.signature,
      blueskyInteractionsSignature: blueskyInteractionsSignature.signature,
      blueskySnapshotsSignature: blueskySnapshotsSignature.signature,
      blueskyProfilesSignature: blueskyProfilesSignature.signature,
      blueskyFirehoseStateSignature: blueskyFirehoseStateSignature.signature,
      youtubeCommentsSignature: youtubeCommentsSignature.signature,
      youtubeSnapshotsSignature: youtubeSnapshotsSignature.signature,
      redditEnabled: REDDIT_ENABLED,
      value: snapshot,
    };

    if (LOCAL_STORE_DEBUG) {
      console.info("[local-store] loaded reddit snapshot", {
        source: "dashboard_snapshot",
        redditEnabled: REDDIT_ENABLED,
        posts: snapshot.posts.length,
        comments: snapshot.comments.length,
        publicItems: snapshot.publicItems?.length ?? 0,
        blueskyPosts: snapshot.blueskyPosts?.length ?? 0,
        blueskyInteractions: snapshot.blueskyInteractions?.length ?? 0,
        blueskyPostSnapshots: snapshot.blueskyPostSnapshots?.length ?? 0,
        blueskyProfiles: snapshot.blueskyProfiles?.length ?? 0,
        youtubeComments: snapshot.youtubeComments?.length ?? 0,
        youtubeVideoSnapshots: snapshot.youtubeVideoSnapshots?.length ?? 0,
      });
    }

    return snapshot;
  } catch {
    try {
      const raw = await fs.readFile(LEGACY_REDDIT_DATA_FILE_PATH, "utf8");
      const parsed = JSON.parse(raw) as Partial<RedditIngestionSnapshot>;

      const snapshot = applySourceFlags({
        source: "reddit",
        generatedAt: getLatestIsoTimestamp(parsed.fetchedAt ?? null, liveBlueskySnapshotAt),
        fetchedAt: getLatestIsoTimestamp(parsed.fetchedAt ?? null, liveBlueskySnapshotAt),
        posts: Array.isArray(parsed.posts) ? parsed.posts : [],
        comments: Array.isArray(parsed.comments) ? parsed.comments : [],
        publicItems,
        blueskyPosts,
        blueskyInteractions,
        blueskyPostSnapshots,
        blueskyProfiles,
        blueskyFirehoseState,
        youtubeComments,
        youtubeVideoSnapshots,
        runs: [],
        sourceHealth: {},
        latestRun: null,
        error: typeof parsed.error === "string" ? parsed.error : null,
      });
      cachedSnapshot = {
        sourceSignature,
        publicItemsSignature: mergedPublicItemsSignature,
        blueskyPostsSignature: blueskyPostsSignature.signature,
        blueskyInteractionsSignature: blueskyInteractionsSignature.signature,
        blueskySnapshotsSignature: blueskySnapshotsSignature.signature,
        blueskyProfilesSignature: blueskyProfilesSignature.signature,
        blueskyFirehoseStateSignature: blueskyFirehoseStateSignature.signature,
        youtubeCommentsSignature: youtubeCommentsSignature.signature,
        youtubeSnapshotsSignature: youtubeSnapshotsSignature.signature,
        redditEnabled: REDDIT_ENABLED,
        value: snapshot,
      };

      if (LOCAL_STORE_DEBUG) {
        console.info("[local-store] loaded reddit snapshot", {
          source: "legacy_reddit_posts",
          redditEnabled: REDDIT_ENABLED,
          posts: snapshot.posts.length,
          comments: snapshot.comments.length,
          publicItems: snapshot.publicItems?.length ?? 0,
          blueskyPosts: snapshot.blueskyPosts?.length ?? 0,
          blueskyInteractions: snapshot.blueskyInteractions?.length ?? 0,
          blueskyPostSnapshots: snapshot.blueskyPostSnapshots?.length ?? 0,
          blueskyProfiles: snapshot.blueskyProfiles?.length ?? 0,
          youtubeComments: snapshot.youtubeComments?.length ?? 0,
          youtubeVideoSnapshots: snapshot.youtubeVideoSnapshots?.length ?? 0,
        });
      }

      return snapshot;
    } catch {
      const snapshot = applySourceFlags({
        source: "reddit",
        generatedAt: liveBlueskySnapshotAt,
        fetchedAt: liveBlueskySnapshotAt,
        posts: [],
        comments: [],
        publicItems,
        blueskyPosts,
        blueskyInteractions,
        blueskyPostSnapshots,
        blueskyProfiles,
        blueskyFirehoseState,
        youtubeComments,
        youtubeVideoSnapshots,
        runs: [],
        sourceHealth: {},
        latestRun: null,
        error: null,
      });
      cachedSnapshot = {
        sourceSignature,
        publicItemsSignature: mergedPublicItemsSignature,
        blueskyPostsSignature: blueskyPostsSignature.signature,
        blueskyInteractionsSignature: blueskyInteractionsSignature.signature,
        blueskySnapshotsSignature: blueskySnapshotsSignature.signature,
        blueskyProfilesSignature: blueskyProfilesSignature.signature,
        blueskyFirehoseStateSignature: blueskyFirehoseStateSignature.signature,
        youtubeCommentsSignature: youtubeCommentsSignature.signature,
        youtubeSnapshotsSignature: youtubeSnapshotsSignature.signature,
        redditEnabled: REDDIT_ENABLED,
        value: snapshot,
      };

      return snapshot;
    }
  }
}
