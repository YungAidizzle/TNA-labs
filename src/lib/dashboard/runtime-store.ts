import "server-only";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { getTrendDashboardVM } from "@/lib/adapters/analytics";
import { DashboardProfiler, writeProfileSnapshot } from "@/lib/dashboard/profiling";
import {
  BLUESKY_FIREHOSE_STATE_FILE_PATH,
  BLUESKY_INTERACTIONS_FILE_PATH,
  BLUESKY_POST_SNAPSHOTS_FILE_PATH,
  BLUESKY_POSTS_FILE_PATH,
  BLUESKY_PROFILES_FILE_PATH,
  LEGACY_REDDIT_DATA_FILE_PATH,
  loadRedditSnapshot,
  PUBLIC_ITEMS_FILE_PATH,
  REDDIT_ENGINE_SNAPSHOT_FILE_PATH,
  YOUTUBE_COMMENTS_FILE_PATH,
  YOUTUBE_VIDEO_SNAPSHOTS_FILE_PATH,
} from "@/lib/reddit/local-store";
import { TELEGRAM_TRENDS_FILE_PATH } from "@/lib/telegram/local-store";
import {
  RUNTIME_CACHE_DIR,
  RUNTIME_BUILD_PROFILE_PATH,
  RUNTIME_LATEST_SNAPSHOT_PATH,
  RUNTIME_RAW_DIR,
  RUNTIME_RAW_SNAPSHOT_PATH,
  RUNTIME_REFRESH_LOG_PATH,
  RUNTIME_REFRESH_STATE_PATH,
  RUNTIME_ROOT,
  RUNTIME_SNAPSHOTS_DIR,
  RUNTIME_SQLITE_PATH,
} from "@/lib/runtime/paths";
import { PlatformId } from "@/types/domain";
import {
  DashboardRefreshState,
  DashboardRuntimeBundleOrigin,
  DashboardSourceFreshness,
  RankedTrend,
  TrendDashboardQuery,
  TrendDashboardVM,
} from "@/types/view-models";
import { isProcessAlive } from "@/lib/runtime/process";

const DASHBOARD_RUNTIME_SCHEMA_VERSION = 1;
const DASHBOARD_RUNTIME_BUILD_VERSION = 11;
const DEFAULT_RUNTIME_BASE_QUERIES: Array<Pick<TrendDashboardQuery, "scope" | "range">> = [
  {
    scope: "overall",
    range: "24h",
  },
];
const RUNTIME_DEBUG = process.env.NODE_ENV !== "production";
const REDDIT_ENABLED = !["0", "false", "no", "off"].includes(
  String(process.env.REDDIT_ENABLED ?? "1").trim().toLowerCase(),
);
const LEGACY_DASHBOARD_STATE_CACHE_FILE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_engine",
  "dashboard_state_cache.json",
);

type SourceFileSignature = {
  id: string;
  path: string;
  exists: boolean;
  signature: string;
  sizeBytes: number;
  updatedAt: string | null;
};

type SourceManifest = {
  generatedAt: string;
  combinedSignature: string;
  hasAnyData: boolean;
  files: SourceFileSignature[];
};

type RawSnapshotEnvelope = {
  schemaVersion: number;
  generatedAt: string;
  sourceManifest: SourceManifest;
  snapshot: Awaited<ReturnType<typeof loadRedditSnapshot>>;
};

export type DashboardRuntimeBundle = {
  schemaVersion: number;
  generatedAt: string;
  origin: DashboardRuntimeBundleOrigin;
  sourceManifest: SourceManifest;
  sourceSnapshotGeneratedAt: string | null;
  latestFetchedAt: string | null;
  rawCounts: {
    posts: number;
    comments: number;
    publicItems: number;
    blueskyPosts: number;
    blueskyInteractions: number;
    blueskyPostSnapshots: number;
    blueskyProfiles: number;
    youtubeComments: number;
    youtubeVideoSnapshots: number;
  };
  sourceFreshness: DashboardSourceFreshness[];
  baseStates: Record<string, TrendDashboardVM>;
};

type DashboardRuntimeGlobals = typeof globalThis & {
  __dashboardCurrentSessionId?: string;
};

const dashboardRuntimeGlobals = globalThis as DashboardRuntimeGlobals;

export const CURRENT_DASHBOARD_SESSION_ID =
  dashboardRuntimeGlobals.__dashboardCurrentSessionId ??
  `${process.pid}:${Date.now()}`;

dashboardRuntimeGlobals.__dashboardCurrentSessionId = CURRENT_DASHBOARD_SESSION_ID;
const DASHBOARD_ACTIVE_REFRESH_TIMEOUT_MS = 20 * 60 * 1000;

let cachedRuntimeBundle:
  | {
      signature: string;
      value: DashboardRuntimeBundle;
    }
  | null = null;

function trimRuntimeStoredTrend(trend: RankedTrend): RankedTrend {
  return {
    ...trend,
    attentionHistory: [],
    platformBreakdown: [],
    topPosts: [],
    attentionDrivers: [],
    platformMigrationPath: [],
    blueskyDetail: null,
  };
}

const PERSISTED_RUNTIME_RICH_ROW_LIMIT = 250;

function comparePersistedLeaderboardRows(left: RankedTrend, right: RankedTrend) {
  const leftPriority = getPersistedTrendDisplayPriority(left);
  const rightPriority = getPersistedTrendDisplayPriority(right);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return (
    (right.totalInteractions24h ?? right.attentionInteractions) -
      (left.totalInteractions24h ?? left.attentionInteractions) ||
    left.id.localeCompare(right.id)
  );
}

function getPersistedTrendDisplayPriority(trend: RankedTrend) {
  if (trend.templateSeries || (trend.spamLikelihood ?? 0) >= 0.72) {
    return 4;
  }

  if (trend.labelType === "fallback_generated") {
    return 3;
  }

  if (trend.lowQualityLabel) {
    return 2;
  }

  if (trend.isSingleton) {
    return 1;
  }

  return 0;
}

function getPersistedRichTrendIds(rows: RankedTrend[]) {
  return new Set(
    [...rows]
      .sort(comparePersistedLeaderboardRows)
      .slice(0, PERSISTED_RUNTIME_RICH_ROW_LIMIT)
      .map((trend) => trend.id),
  );
}

function trimRuntimeStoredTrendIfNeeded(trend: RankedTrend, preservedIds: Set<string>) {
  if (preservedIds.has(trend.id)) {
    return trend;
  }

  return trimRuntimeStoredTrend(trend);
}

function compactRuntimeStoredState(state: TrendDashboardVM): TrendDashboardVM {
  const leaderboards = state.leaderboards ?? {
    established: state.leaderboard,
    emerging: [],
  };
  const establishedRichIds = getPersistedRichTrendIds(leaderboards.established);
  const emergingRichIds = getPersistedRichTrendIds(leaderboards.emerging);
  const leaderboardRichIds = getPersistedRichTrendIds(state.leaderboard);

  return {
    ...state,
    leaderboards: {
      established: leaderboards.established.map((trend) =>
        trimRuntimeStoredTrendIfNeeded(trend, establishedRichIds),
      ),
      emerging: leaderboards.emerging.map((trend) =>
        trimRuntimeStoredTrendIfNeeded(trend, emergingRichIds),
      ),
    },
    leaderboard: state.leaderboard.map((trend) =>
      trimRuntimeStoredTrendIfNeeded(trend, leaderboardRichIds),
    ),
  };
}

function compactRuntimeStoredBundle(bundle: DashboardRuntimeBundle): DashboardRuntimeBundle {
  return {
    ...bundle,
    baseStates: Object.fromEntries(
      Object.entries(bundle.baseStates).map(([key, state]) => [key, compactRuntimeStoredState(state)]),
    ),
  };
}

function hasTwoModeLeaderboards(state: TrendDashboardVM | null | undefined) {
  return Boolean(state?.leaderboards?.established && state?.leaderboards?.emerging);
}

function roundMs(value: number) {
  return Math.round(value * 10) / 10;
}

function getSourceFileById(manifest: SourceManifest, id: string) {
  return manifest.files.find((file) => file.id === id) ?? null;
}

function hasMaterializedFileData(file: SourceFileSignature | null) {
  return Boolean(file?.exists && file.sizeBytes > 2);
}

function hasBlueskyRawDataInManifest(manifest: SourceManifest) {
  return (
    hasMaterializedFileData(getSourceFileById(manifest, "bluesky_posts")) ||
    hasMaterializedFileData(getSourceFileById(manifest, "bluesky_interactions")) ||
    hasMaterializedFileData(getSourceFileById(manifest, "bluesky_post_snapshots")) ||
    hasMaterializedFileData(getSourceFileById(manifest, "bluesky_profiles")) ||
    hasMaterializedFileData(getSourceFileById(manifest, "bluesky_firehose_state"))
  );
}

function isDashboardRefreshStateActive(state: DashboardRefreshState | null) {
  return state?.status === "scheduled" || state?.status === "running";
}

function getDashboardRefreshStateActivityTimestamp(state: DashboardRefreshState | null) {
  return state?.startedAt ?? state?.requestedAt ?? null;
}

function getDashboardRefreshRecoveryReason(state: DashboardRefreshState | null) {
  if (!isDashboardRefreshStateActive(state)) {
    return null;
  }

  const activityTimestamp = getDashboardRefreshStateActivityTimestamp(state);
  const activityMs = activityTimestamp ? Date.parse(activityTimestamp) : Number.NaN;
  const ageMs = Number.isFinite(activityMs) ? Date.now() - activityMs : Number.NaN;

  if (typeof state?.ownerPid === "number" && state.ownerPid > 0 && !isProcessAlive(state.ownerPid)) {
    return `owner pid ${state.ownerPid} is no longer running`;
  }

  if (
    state?.ownerSessionId &&
    state.ownerSessionId !== CURRENT_DASHBOARD_SESSION_ID &&
    typeof state.ownerPid === "number" &&
    state.ownerPid === process.pid &&
    (!Number.isFinite(ageMs) || ageMs > 30_000)
  ) {
    return `refresh belongs to prior in-process session ${state.ownerSessionId}`;
  }

  if (!activityTimestamp) {
    return "refresh has no activity timestamp";
  }

  if (Number.isFinite(ageMs) && ageMs > DASHBOARD_ACTIVE_REFRESH_TIMEOUT_MS) {
    return `refresh exceeded ${Math.round(DASHBOARD_ACTIVE_REFRESH_TIMEOUT_MS / 60_000)} minute timeout`;
  }

  return null;
}

function toBaseStateKey(query: Pick<TrendDashboardQuery, "scope" | "range">) {
  return `${query.scope}:${query.range}`;
}

function parseBaseStateKey(key: string): Pick<TrendDashboardQuery, "scope" | "range"> | null {
  const [scope, range] = key.split(":");
  if (!scope || !range) {
    return null;
  }

  return {
    scope: scope as TrendDashboardQuery["scope"],
    range: range as TrendDashboardQuery["range"],
  };
}

function normalizeRequestedBaseQueries(
  queries: TrendDashboardQuery[] | Array<Pick<TrendDashboardQuery, "scope" | "range">> | undefined,
) {
  const deduped = new Map<string, Pick<TrendDashboardQuery, "scope" | "range">>();
  for (const query of queries ?? []) {
    const normalized = {
      scope: query.scope,
      range: query.range,
    } satisfies Pick<TrendDashboardQuery, "scope" | "range">;
    deduped.set(toBaseStateKey(normalized), normalized);
  }

  return [...deduped.values()];
}

function toBaseStateBuildQuery(query: Pick<TrendDashboardQuery, "scope" | "range">): TrendDashboardQuery {
  return {
    scope: query.scope,
    range: query.range,
    mode: "established",
    sort: "posts",
    selectedId: undefined,
  };
}

function getPlatformIdForPublicSource(sourceType: string): PlatformId {
  if (sourceType === "bluesky") {
    return "bluesky";
  }

  if (sourceType === "youtube") {
    return "youtube";
  }

  if (sourceType === "telegram") {
    return "telegram";
  }

  if (sourceType === "googletrends") {
    return "google";
  }

  return "news";
}

function toIsoFromUtc(createdUtc: number | null | undefined) {
  if (!createdUtc || createdUtc <= 0) {
    return null;
  }

  return new Date(createdUtc * 1000).toISOString();
}

function getAgeMinutes(isoValue: string | null) {
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

function createSourceManifestSignature(files: SourceFileSignature[]) {
  return `build:${DASHBOARD_RUNTIME_BUILD_VERSION}|${files.map((file) => `${file.id}:${file.signature}`).join("|")}`;
}

async function ensureRuntimeDirectories() {
  await Promise.all([
    fs.mkdir(RUNTIME_ROOT, { recursive: true }),
    fs.mkdir(RUNTIME_RAW_DIR, { recursive: true }),
    fs.mkdir(RUNTIME_CACHE_DIR, { recursive: true }),
    fs.mkdir(RUNTIME_SNAPSHOTS_DIR, { recursive: true }),
  ]);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

type LegacyDashboardCacheKey = {
  scope?: string;
  range?: string;
  generatedAt?: string | null;
  posts?: number;
  comments?: number;
};

async function writeJsonFile(filePath: string, payload: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`;
  const serialized = JSON.stringify(payload, null, 2);
  await fs.writeFile(tempPath, serialized, "utf8");

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : null;
      const retryable =
        code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "ENOENT";

      if (!retryable) {
        throw error;
      }

      try {
        await fs.rm(filePath, { force: true });
      } catch {
        // Another reader may still hold the file open; retry below.
      }

      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }

  try {
    await fs.writeFile(filePath, serialized, "utf8");
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function isOversizedJsonWriteError(error: unknown) {
  return (
    error instanceof RangeError ||
    (error instanceof Error && /invalid string length/i.test(error.message))
  );
}

async function getFileSignature(id: string, filePath: string): Promise<SourceFileSignature> {
  try {
    const stat = await fs.stat(filePath);
    return {
      id,
      path: filePath,
      exists: true,
      signature: `${stat.size}:${stat.mtimeMs}`,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return {
      id,
      path: filePath,
      exists: false,
      signature: "missing",
      sizeBytes: 0,
      updatedAt: null,
    };
  }
}

async function syncRuntimeSqlite() {
  const pythonCommand = process.env.PYTHON_BIN || "python";

  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      pythonCommand,
      [
        "scripts/sync_runtime_sqlite.py",
        "--db",
        RUNTIME_SQLITE_PATH,
        "--bundle",
        RUNTIME_LATEST_SNAPSHOT_PATH,
        "--refresh-state",
        RUNTIME_REFRESH_STATE_PATH,
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `runtime sqlite sync failed with exit code ${code ?? "unknown"}${
            stderr.trim() ? `: ${stderr.trim()}` : ""
          }`,
        ),
      );
    });
  });
}

function buildSourceFreshness(snapshot: Awaited<ReturnType<typeof loadRedditSnapshot>>) {
  const rows: DashboardSourceFreshness[] = [];

  if (!REDDIT_ENABLED) {
    rows.push({
      sourceId: "reddit:disabled",
      sourceLabel: "Reddit",
      platformId: "reddit",
      sourceStatus: "disabled",
      itemCount: 0,
      lastFetchedAt: null,
      latestCreatedAt: null,
      ageMinutes: null,
    });
  } else {
    Object.entries(snapshot.sourceHealth ?? {}).forEach(([sourceKey, health]) => {
      rows.push({
        sourceId: `reddit:${sourceKey}`,
        sourceLabel: `r/${health.subreddit ?? sourceKey}`,
        platformId: "reddit",
        sourceStatus: "active",
        itemCount:
          Math.max(0, Math.round(health.storedPostsInWindow ?? 0)) +
          Math.max(0, Math.round(health.storedCommentsInWindow ?? 0)),
        lastFetchedAt: health.lastSuccessAt ?? health.lastAttemptedAt ?? null,
        latestCreatedAt: toIsoFromUtc(health.lastKnownPostCreatedUtc ?? null),
        ageMinutes:
          typeof health.sourceAgeMinutes === "number"
            ? Math.max(0, Math.round(health.sourceAgeMinutes))
            : getAgeMinutes(health.lastSuccessAt ?? health.lastAttemptedAt ?? null),
      });
    });
  }

  const publicAggregates = new Map<
    string,
    {
      sourceId: string;
      sourceLabel: string;
      platformId: PlatformId;
      itemCount: number;
      lastFetchedAt: string | null;
      latestCreatedAt: string | null;
    }
  >();

  (snapshot.publicItems ?? []).forEach((item) => {
    const platformId = getPlatformIdForPublicSource(item.sourceType);
    const sourceId = `${platformId}:${item.sourceType}:${item.sourceName}`;
    const latestCreatedAt = toIsoFromUtc(item.createdUtc);
    const current = publicAggregates.get(sourceId);

    if (current) {
      current.itemCount += 1;
      if (item.fetchedAt && (!current.lastFetchedAt || item.fetchedAt > current.lastFetchedAt)) {
        current.lastFetchedAt = item.fetchedAt;
      }
      if (latestCreatedAt && (!current.latestCreatedAt || latestCreatedAt > current.latestCreatedAt)) {
        current.latestCreatedAt = latestCreatedAt;
      }
      return;
    }

    publicAggregates.set(sourceId, {
      sourceId,
      sourceLabel: item.sourceName,
      platformId,
      itemCount: 1,
      lastFetchedAt: item.fetchedAt ?? null,
      latestCreatedAt,
    });
  });

  (snapshot.youtubeComments ?? []).forEach((comment) => {
    const sourceId = `youtube:comments:${comment.sourceName}`;
    const latestCreatedAt = toIsoFromUtc(comment.createdUtc);
    const current = publicAggregates.get(sourceId);

    if (current) {
      current.itemCount += 1;
      if (comment.fetchedAt && (!current.lastFetchedAt || comment.fetchedAt > current.lastFetchedAt)) {
        current.lastFetchedAt = comment.fetchedAt;
      }
      if (latestCreatedAt && (!current.latestCreatedAt || latestCreatedAt > current.latestCreatedAt)) {
        current.latestCreatedAt = latestCreatedAt;
      }
      return;
    }

    publicAggregates.set(sourceId, {
      sourceId,
      sourceLabel: `${comment.sourceName} comments`,
      platformId: "youtube",
      itemCount: 1,
      lastFetchedAt: comment.fetchedAt ?? null,
      latestCreatedAt,
    });
  });

  (snapshot.blueskyPosts ?? []).forEach((post) => {
    const sourceId = `bluesky:posts`;
    const latestCreatedAt = toIsoFromUtc(post.createdUtc);
    const current = publicAggregates.get(sourceId);

    if (current) {
      current.itemCount += 1;
      if (post.fetchedAt && (!current.lastFetchedAt || post.fetchedAt > current.lastFetchedAt)) {
        current.lastFetchedAt = post.fetchedAt;
      }
      if (latestCreatedAt && (!current.latestCreatedAt || latestCreatedAt > current.latestCreatedAt)) {
        current.latestCreatedAt = latestCreatedAt;
      }
      return;
    }

    publicAggregates.set(sourceId, {
      sourceId,
      sourceLabel: "Bluesky firehose",
      platformId: "bluesky",
      itemCount: 1,
      lastFetchedAt: post.fetchedAt ?? null,
      latestCreatedAt,
    });
  });

  (snapshot.blueskyInteractions ?? []).forEach((interaction) => {
    const sourceId = `bluesky:interactions`;
    const latestCreatedAt = toIsoFromUtc(interaction.createdUtc);
    const current = publicAggregates.get(sourceId);

    if (current) {
      current.itemCount += 1;
      if (
        interaction.fetchedAt &&
        (!current.lastFetchedAt || interaction.fetchedAt > current.lastFetchedAt)
      ) {
        current.lastFetchedAt = interaction.fetchedAt;
      }
      if (latestCreatedAt && (!current.latestCreatedAt || latestCreatedAt > current.latestCreatedAt)) {
        current.latestCreatedAt = latestCreatedAt;
      }
      return;
    }

    publicAggregates.set(sourceId, {
      sourceId,
      sourceLabel: "Bluesky posts",
      platformId: "bluesky",
      itemCount: 1,
      lastFetchedAt: interaction.fetchedAt ?? null,
      latestCreatedAt,
    });
  });

  if (snapshot.blueskyFirehoseState) {
    const workerPid =
      typeof snapshot.blueskyFirehoseState.workerPid === "number"
        ? snapshot.blueskyFirehoseState.workerPid
        : null;
    const workerHeartbeatAgeMinutes = getAgeMinutes(
      snapshot.blueskyFirehoseState.workerHeartbeatAt ?? null,
    );
    const lastEventAgeMinutes = getAgeMinutes(
      snapshot.blueskyFirehoseState.lastReceivedAt ??
        snapshot.blueskyFirehoseState.lastEventAt ??
        null,
    );
    const workerIsStale =
      snapshot.blueskyFirehoseState.status === "failed" ||
      snapshot.blueskyFirehoseState.healthStatus === "disconnected" ||
      snapshot.blueskyFirehoseState.connectionStatus === "disconnected" ||
      (workerHeartbeatAgeMinutes !== null &&
        workerHeartbeatAgeMinutes > 10 &&
        (lastEventAgeMinutes === null || lastEventAgeMinutes > 30));
    const workerAlive =
      workerPid === null
        ? null
        : typeof snapshot.blueskyFirehoseState.workerAlive === "boolean"
          ? snapshot.blueskyFirehoseState.workerAlive && isProcessAlive(workerPid) && !workerIsStale
          : isProcessAlive(workerPid);
    rows.push({
      sourceId: "bluesky:firehose:state",
      sourceLabel: "Bluesky firehose sync",
      platformId: "bluesky",
      sourceStatus:
        workerAlive === false
          ? "disconnected"
          : workerIsStale
            ? "stale"
            : snapshot.blueskyFirehoseState.healthStatus ??
              snapshot.blueskyFirehoseState.sourceStatus ??
              "active",
      itemCount: Math.max(0, snapshot.blueskyFirehoseState.lastSyncEvents ?? 0),
      lastFetchedAt: getLatestIsoTimestamp(
        snapshot.blueskyFirehoseState.lastAggregateRefreshAt ?? null,
        snapshot.blueskyFirehoseState.lastPersistenceAt ?? null,
        snapshot.blueskyFirehoseState.lastReceivedAt ?? null,
        snapshot.blueskyFirehoseState.workerHeartbeatAt ?? null,
        snapshot.blueskyFirehoseState.lastSyncCompletedAt ?? null,
        snapshot.blueskyFirehoseState.lastSyncStartedAt ?? null,
      ),
      latestCreatedAt: snapshot.blueskyFirehoseState.lastEventAt ?? null,
      ageMinutes:
        workerIsStale && lastEventAgeMinutes !== null
          ? Math.max(0, Math.round(lastEventAgeMinutes))
          : typeof snapshot.blueskyFirehoseState.backlogLagMinutes === "number"
            ? Math.max(0, Math.round(snapshot.blueskyFirehoseState.backlogLagMinutes))
            : getAgeMinutes(
                getLatestIsoTimestamp(
                  snapshot.blueskyFirehoseState.lastAggregateRefreshAt ?? null,
                  snapshot.blueskyFirehoseState.lastPersistenceAt ?? null,
                  snapshot.blueskyFirehoseState.lastReceivedAt ?? null,
                  snapshot.blueskyFirehoseState.workerHeartbeatAt ?? null,
                  snapshot.blueskyFirehoseState.lastSyncCompletedAt ?? null,
                  snapshot.blueskyFirehoseState.lastSyncStartedAt ?? null,
                ),
              ),
    });
  }

  publicAggregates.forEach((entry) => {
    rows.push({
      ...entry,
      ageMinutes: getAgeMinutes(entry.lastFetchedAt),
    });
  });

  return rows.sort((left, right) => {
    const leftAge = left.ageMinutes ?? -1;
    const rightAge = right.ageMinutes ?? -1;
    if (leftAge !== rightAge) {
      return rightAge - leftAge;
    }

    return left.sourceLabel.localeCompare(right.sourceLabel);
  });
}

function getLatestFetchedAt(sourceFreshness: DashboardSourceFreshness[]) {
  return (
    sourceFreshness
      .map((entry) => entry.lastFetchedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
  );
}

export async function getDashboardSourceManifest() {
  const files = await Promise.all([
    getFileSignature("reddit_dashboard_snapshot", REDDIT_ENGINE_SNAPSHOT_FILE_PATH),
    getFileSignature("legacy_reddit_posts", LEGACY_REDDIT_DATA_FILE_PATH),
    getFileSignature("public_items", PUBLIC_ITEMS_FILE_PATH),
    getFileSignature("bluesky_posts", BLUESKY_POSTS_FILE_PATH),
    getFileSignature("bluesky_interactions", BLUESKY_INTERACTIONS_FILE_PATH),
    getFileSignature("bluesky_post_snapshots", BLUESKY_POST_SNAPSHOTS_FILE_PATH),
    getFileSignature("bluesky_profiles", BLUESKY_PROFILES_FILE_PATH),
    getFileSignature("bluesky_firehose_state", BLUESKY_FIREHOSE_STATE_FILE_PATH),
    getFileSignature("youtube_comments", YOUTUBE_COMMENTS_FILE_PATH),
    getFileSignature("youtube_video_snapshots", YOUTUBE_VIDEO_SNAPSHOTS_FILE_PATH),
    getFileSignature("telegram_trends", TELEGRAM_TRENDS_FILE_PATH),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    combinedSignature: createSourceManifestSignature(files),
    hasAnyData: files.some((file) => file.exists && file.sizeBytes > 0),
    files,
  } satisfies SourceManifest;
}

async function loadRuntimeRawSnapshotEnvelope() {
  return readJsonFile<RawSnapshotEnvelope>(RUNTIME_RAW_SNAPSHOT_PATH);
}

async function writeRuntimeRawSnapshotEnvelope(envelope: RawSnapshotEnvelope) {
  await writeJsonFile(RUNTIME_RAW_SNAPSHOT_PATH, envelope);
}

export async function loadLatestDashboardRuntimeBundle() {
  const signature = await getFileSignature("runtime_latest_snapshot", RUNTIME_LATEST_SNAPSHOT_PATH);
  if (!signature.exists) {
    cachedRuntimeBundle = null;
    return null;
  }

  if (cachedRuntimeBundle && cachedRuntimeBundle.signature === signature.signature) {
    return cachedRuntimeBundle.value;
  }

  const parsed = await readJsonFile<DashboardRuntimeBundle>(RUNTIME_LATEST_SNAPSHOT_PATH);
  if (!parsed) {
    cachedRuntimeBundle = null;
    return null;
  }

  cachedRuntimeBundle = {
    signature: signature.signature,
    value: parsed,
  };
  return parsed;
}

export async function hasPersistedRuntimeRawSnapshot() {
  const signature = await getFileSignature("runtime_raw_snapshot", RUNTIME_RAW_SNAPSHOT_PATH);
  return signature.exists && signature.sizeBytes > 0;
}

export async function bootstrapRuntimeBundleFromLegacyCache() {
  const persisted = await readJsonFile<Record<string, TrendDashboardVM>>(
    LEGACY_DASHBOARD_STATE_CACHE_FILE_PATH,
  );
  if (!persisted) {
    return null;
  }

  const selectedStates = new Map<
    string,
    {
      generatedAt: string | null;
      state: TrendDashboardVM;
      posts: number;
      comments: number;
    }
  >();

  Object.entries(persisted).forEach(([key, value]) => {
    let parsedKey: LegacyDashboardCacheKey | null = null;
    try {
      parsedKey = JSON.parse(key) as LegacyDashboardCacheKey;
    } catch {
      parsedKey = null;
    }

    const scope = parsedKey?.scope;
    const range = parsedKey?.range;
    if (!scope || !range) {
      return;
    }

    const stateKey = `${scope}:${range}`;
    const existing = selectedStates.get(stateKey);
    const generatedAt = parsedKey?.generatedAt ?? null;
    if (existing && (existing.generatedAt ?? "") >= (generatedAt ?? "")) {
      return;
    }

    selectedStates.set(stateKey, {
      generatedAt,
      state: {
        ...value,
        dataStatus: null,
      },
      posts: Math.max(0, parsedKey?.posts ?? 0),
      comments: Math.max(0, parsedKey?.comments ?? 0),
    });
  });

  if (selectedStates.size === 0) {
    return null;
  }

  await ensureRuntimeDirectories();
  const sourceManifest = await getDashboardSourceManifest();
  if (hasBlueskyRawDataInManifest(sourceManifest)) {
    console.info("[runtime-store] skipping legacy bootstrap because Bluesky raw data exists on disk");
    return null;
  }
  const allStates = Object.fromEntries(
    [...selectedStates.entries()].map(([key, row]) => [key, row.state]),
  );
  const bundle: DashboardRuntimeBundle = {
    schemaVersion: DASHBOARD_RUNTIME_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    origin: "legacy_bootstrap",
    sourceManifest: {
      ...sourceManifest,
      combinedSignature: `legacy-bootstrap:${sourceManifest.combinedSignature}`,
    },
    sourceSnapshotGeneratedAt:
      [...selectedStates.values()]
        .map((row) => row.generatedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
    latestFetchedAt:
      [...selectedStates.values()]
        .map((row) => row.generatedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
    rawCounts: {
      posts: [...selectedStates.values()].reduce((sum, row) => Math.max(sum, row.posts), 0),
      comments: [...selectedStates.values()].reduce((sum, row) => Math.max(sum, row.comments), 0),
      publicItems: 0,
      blueskyPosts: 0,
      blueskyInteractions: 0,
      blueskyPostSnapshots: 0,
      blueskyProfiles: 0,
      youtubeComments: 0,
      youtubeVideoSnapshots: 0,
    },
    sourceFreshness: [],
    baseStates: allStates,
  };

  try {
    await writeJsonFile(RUNTIME_LATEST_SNAPSHOT_PATH, compactRuntimeStoredBundle(bundle));
  } catch (error) {
    if (!isOversizedJsonWriteError(error)) {
      throw error;
    }

    console.warn("[runtime-store] skipping legacy runtime snapshot persistence because payload is too large", {
      generatedAt: bundle.generatedAt,
      posts: bundle.rawCounts.posts,
      comments: bundle.rawCounts.comments,
      blueskyPosts: bundle.rawCounts.blueskyPosts,
      blueskyInteractions: bundle.rawCounts.blueskyInteractions,
      blueskyPostSnapshots: bundle.rawCounts.blueskyPostSnapshots,
      blueskyProfiles: bundle.rawCounts.blueskyProfiles,
    });
  }
  const sqliteStartedAt = performance.now();
  try {
    await syncRuntimeSqlite();
  } catch (error) {
    console.error("[runtime-store] failed to sync legacy bootstrap bundle to sqlite", error);
  }
  const sqliteWriteMs = roundMs(performance.now() - sqliteStartedAt);
  await writeProfileSnapshot(RUNTIME_BUILD_PROFILE_PATH, {
    generatedAt: new Date().toISOString(),
    label: "dashboard-legacy-bootstrap",
    timings: {
      totalMs: sqliteWriteMs,
      runtimeSnapshotReadMs: 0,
      sourceManifestReadMs: 0,
      localRawReadMs: 0,
      analyticsBuildMs: 0,
      variantBuildMs: 0,
      sqliteWriteMs,
      steps: [],
      perQueryBuilds: [],
    },
    metadata: {
      origin: "legacy_bootstrap",
      runtimeSnapshotPath: RUNTIME_LATEST_SNAPSHOT_PATH,
      legacyCachePath: LEGACY_DASHBOARD_STATE_CACHE_FILE_PATH,
      stateCount: Object.keys(allStates).length,
    },
  });
  cachedRuntimeBundle = {
    signature: `legacy:${bundle.generatedAt}`,
    value: bundle,
  };
  return bundle;
}

export function getRuntimeBaseQueries(bundle: DashboardRuntimeBundle) {
  return Object.keys(bundle.baseStates)
    .map((key) => parseBaseStateKey(key))
    .filter(
      (query): query is Pick<TrendDashboardQuery, "scope" | "range"> => query !== null,
    );
}

export async function loadDashboardRefreshState() {
  const state = await readJsonFile<DashboardRefreshState>(RUNTIME_REFRESH_STATE_PATH);
  const recoveryReason = getDashboardRefreshRecoveryReason(state);
  if (!state || !recoveryReason) {
    return state;
  }

  const recoveredAt = new Date().toISOString();
  const recoveredState: DashboardRefreshState = {
    ...state,
    status: "failed",
    completedAt: recoveredAt,
    lastError: `stale refresh state cleared: ${recoveryReason}`,
    ownerPid: process.pid,
    ownerSessionId: CURRENT_DASHBOARD_SESSION_ID,
    staleClearedAt: recoveredAt,
    staleReason: recoveryReason,
  };

  console.warn("[dashboard-refresh] cleared stale refresh state", {
    previousStatus: state.status,
    trigger: state.trigger,
    mode: state.mode,
    ownerPid: state.ownerPid ?? null,
    ownerSessionId: state.ownerSessionId ?? null,
    reason: recoveryReason,
  });

  await saveDashboardRefreshState(recoveredState);
  await appendDashboardRefreshLog({
    completedAt: recoveredAt,
    mode: state.mode,
    trigger: state.trigger,
    error: recoveredState.lastError,
    staleReason: recoveryReason,
    ownerPid: state.ownerPid ?? null,
    ownerSessionId: state.ownerSessionId ?? null,
  });
  return recoveredState;
}

export async function saveDashboardRefreshState(state: DashboardRefreshState) {
  await ensureRuntimeDirectories();
  await writeJsonFile(RUNTIME_REFRESH_STATE_PATH, state);
  try {
    await syncRuntimeSqlite();
  } catch (error) {
    console.error("[runtime-store] failed to sync refresh state to sqlite", error);
  }
}

export async function appendDashboardRefreshLog(entry: Record<string, unknown>) {
  const current = (await readJsonFile<Record<string, unknown>[]>(RUNTIME_REFRESH_LOG_PATH)) ?? [];
  current.unshift(entry);
  await writeJsonFile(RUNTIME_REFRESH_LOG_PATH, current.slice(0, 20));
}

async function loadLocalSnapshotForRuntimeBuild(
  profiler?: DashboardProfiler,
): Promise<{
  snapshot: Awaited<ReturnType<typeof loadRedditSnapshot>>;
  sourceManifest: SourceManifest;
}> {
  const sourceManifest = profiler
    ? await profiler.measure("source_manifest_read", () => getDashboardSourceManifest())
    : await getDashboardSourceManifest();

  if (sourceManifest.hasAnyData) {
    const snapshot = profiler
      ? await profiler.measure("local_raw_read", () => loadRedditSnapshot())
      : await loadRedditSnapshot();
    if (RUNTIME_DEBUG) {
      console.info("[runtime-store] local snapshot for build", {
        hasAnyData: sourceManifest.hasAnyData,
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
    return { snapshot, sourceManifest };
  }

  const runtimeEnvelope = profiler
    ? await profiler.measure("local_raw_read", () => loadRuntimeRawSnapshotEnvelope())
    : await loadRuntimeRawSnapshotEnvelope();
  if (runtimeEnvelope?.snapshot) {
    return {
      snapshot: runtimeEnvelope.snapshot,
      sourceManifest: runtimeEnvelope.sourceManifest,
    };
  }

  return {
    snapshot: {
      source: "reddit",
      generatedAt: null,
      fetchedAt: null,
      posts: [],
      comments: [],
      publicItems: [],
      blueskyPosts: [],
      blueskyInteractions: [],
      blueskyPostSnapshots: [],
      blueskyProfiles: [],
      blueskyFirehoseState: null,
      youtubeComments: [],
      youtubeVideoSnapshots: [],
      runs: [],
      sourceHealth: {},
      latestRun: null,
      error: null,
    },
    sourceManifest,
  };
}

function buildRawCounts(snapshot: Awaited<ReturnType<typeof loadRedditSnapshot>>) {
  return {
    posts: snapshot.posts.length,
    comments: snapshot.comments.length,
    publicItems: snapshot.publicItems?.length ?? 0,
    blueskyPosts: snapshot.blueskyPosts?.length ?? 0,
    blueskyInteractions: snapshot.blueskyInteractions?.length ?? 0,
    blueskyPostSnapshots: snapshot.blueskyPostSnapshots?.length ?? 0,
    blueskyProfiles: snapshot.blueskyProfiles?.length ?? 0,
    youtubeComments: snapshot.youtubeComments?.length ?? 0,
    youtubeVideoSnapshots: snapshot.youtubeVideoSnapshots?.length ?? 0,
  };
}

export async function buildAndPersistDashboardRuntimeBundle(
  origin: DashboardRuntimeBundleOrigin,
  options: {
    profiler?: DashboardProfiler;
    refreshState?: DashboardRefreshState | null;
    requestedQueries?: TrendDashboardQuery[] | Array<Pick<TrendDashboardQuery, "scope" | "range">>;
    existingBundle?: DashboardRuntimeBundle | null;
  } = {},
) {
  const profiler = options.profiler ?? new DashboardProfiler();
  await ensureRuntimeDirectories();
  const { snapshot, sourceManifest } = await loadLocalSnapshotForRuntimeBuild(profiler);
  console.info("[runtime-store] rebuild start", {
    origin,
    refreshMode: options.refreshState?.mode ?? null,
    refreshTrigger: options.refreshState?.trigger ?? null,
    sourceManifestGeneratedAt: sourceManifest.generatedAt,
    sourceManifestSignature: sourceManifest.combinedSignature,
    hasBlueskyRawData: hasBlueskyRawDataInManifest(sourceManifest),
  });
  const envelope: RawSnapshotEnvelope = {
    schemaVersion: DASHBOARD_RUNTIME_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceManifest,
    snapshot,
  };
  try {
    await writeRuntimeRawSnapshotEnvelope(envelope);
  } catch (error) {
    if (!isOversizedJsonWriteError(error)) {
      throw error;
    }

    console.warn("[runtime-store] skipping raw snapshot persistence because payload is too large", {
      origin,
      generatedAt: envelope.generatedAt,
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

  const requestedBaseQueries = normalizeRequestedBaseQueries(options.requestedQueries);
  const canReuseExistingBaseStates =
    origin !== "startup_rebuild" &&
    origin !== "manual_full_regroup" &&
    Boolean(options.existingBundle) &&
    options.existingBundle?.sourceManifest.combinedSignature === sourceManifest.combinedSignature;
  const baseStates: Record<string, TrendDashboardVM> = canReuseExistingBaseStates
    ? { ...(options.existingBundle?.baseStates ?? {}) }
    : {};
  const incompatibleExistingQueries = canReuseExistingBaseStates
    ? Object.entries(baseStates)
        .flatMap(([key, state]) => (hasTwoModeLeaderboards(state) ? [] : [parseBaseStateKey(key)]))
        .filter((query): query is Pick<TrendDashboardQuery, "scope" | "range"> => Boolean(query))
    : [];
  const baseQueries =
    requestedBaseQueries.length > 0
      ? requestedBaseQueries
      : normalizeRequestedBaseQueries(
          incompatibleExistingQueries.length > 0
            ? incompatibleExistingQueries
            : DEFAULT_RUNTIME_BASE_QUERIES,
        );

  for (const query of baseQueries) {
    const key = toBaseStateKey(query);
    if (hasTwoModeLeaderboards(baseStates[key])) {
      continue;
    }

    if (baseStates[key] && RUNTIME_DEBUG) {
      console.warn("[runtime-store] rebuilding incompatible base state", {
        key,
        hasLeaderboards: Boolean(baseStates[key].leaderboards),
        existingKeys: Object.keys(baseStates[key] ?? {}),
      });
    }

    baseStates[key] = await profiler.measure(
      `analytics_build:${key}`,
      () =>
        getTrendDashboardVM(
          toBaseStateBuildQuery(query),
          snapshot,
          {
            bundleOrigin: origin,
          },
        ),
      {
        count:
          snapshot.posts.length +
          snapshot.comments.length +
          (snapshot.publicItems?.length ?? 0) +
          (snapshot.blueskyPosts?.length ?? 0) +
          (snapshot.blueskyInteractions?.length ?? 0),
      },
    );

    if (RUNTIME_DEBUG) {
      console.info("[runtime-store] base state built", {
        key,
        mode: baseStates[key].query.mode ?? "established",
        leaderboardCount: baseStates[key].leaderboard.length,
        establishedCount: baseStates[key].leaderboards?.established.length ?? 0,
        emergingCount: baseStates[key].leaderboards?.emerging.length ?? 0,
      });
    }
  }

  const sourceFreshness = buildSourceFreshness(snapshot);
  const latestFetchedAt = getLatestFetchedAt(sourceFreshness);
  const sourceSnapshotGeneratedAt =
    latestFetchedAt ?? snapshot.generatedAt ?? snapshot.fetchedAt ?? null;
  const bundle: DashboardRuntimeBundle = {
    schemaVersion: DASHBOARD_RUNTIME_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    origin,
    sourceManifest,
    sourceSnapshotGeneratedAt,
    latestFetchedAt,
    rawCounts: buildRawCounts(snapshot),
    sourceFreshness,
    baseStates,
  };

  try {
    await writeJsonFile(RUNTIME_LATEST_SNAPSHOT_PATH, compactRuntimeStoredBundle(bundle));
  } catch (error) {
    if (!isOversizedJsonWriteError(error)) {
      throw error;
    }

    console.warn("[runtime-store] skipping runtime snapshot persistence because payload is too large", {
      origin,
      generatedAt: bundle.generatedAt,
      posts: bundle.rawCounts.posts,
      comments: bundle.rawCounts.comments,
      blueskyPosts: bundle.rawCounts.blueskyPosts,
      blueskyInteractions: bundle.rawCounts.blueskyInteractions,
      blueskyPostSnapshots: bundle.rawCounts.blueskyPostSnapshots,
      blueskyProfiles: bundle.rawCounts.blueskyProfiles,
    });
  }
  cachedRuntimeBundle = {
    signature: `${bundle.generatedAt}:${sourceManifest.combinedSignature}`,
    value: bundle,
  };

  const sqliteStartedAt = performance.now();
  try {
    await syncRuntimeSqlite();
  } catch (error) {
    console.error("[runtime-store] failed to sync runtime bundle to sqlite", error);
  }
  profiler.record("sqlite_write", performance.now() - sqliteStartedAt);

  const timings = profiler.buildSummary();
  await writeProfileSnapshot(RUNTIME_BUILD_PROFILE_PATH, {
    generatedAt: new Date().toISOString(),
    label: "dashboard-runtime-build",
    timings,
    metadata: {
      origin,
      runtimeSnapshotPath: RUNTIME_LATEST_SNAPSHOT_PATH,
      rawSnapshotPath: RUNTIME_RAW_SNAPSHOT_PATH,
      sourceSnapshotGeneratedAt: bundle.sourceSnapshotGeneratedAt,
      baseQueryKeys: Object.keys(bundle.baseStates),
    },
  });

  console.info("[runtime-store] rebuild complete", {
    origin,
    generatedAt: bundle.generatedAt,
    sourceSnapshotGeneratedAt: bundle.sourceSnapshotGeneratedAt,
    latestFetchedAt: bundle.latestFetchedAt,
    rawCounts: bundle.rawCounts,
    blueskyFreshness: sourceFreshness.find((entry) => entry.sourceId === "bluesky:firehose:state")
      ? {
          lastFetchedAt:
            sourceFreshness.find((entry) => entry.sourceId === "bluesky:firehose:state")
              ?.lastFetchedAt ?? null,
          ageMinutes:
            sourceFreshness.find((entry) => entry.sourceId === "bluesky:firehose:state")
              ?.ageMinutes ?? null,
        }
      : null,
    baseStateShapes: Object.fromEntries(
      Object.entries(bundle.baseStates).map(([key, state]) => [
        key,
        {
          leaderboardCount: state.leaderboard.length,
          establishedCount: state.leaderboards?.established.length ?? 0,
          emergingCount: state.leaderboards?.emerging.length ?? 0,
          hasLeaderboards: Boolean(state.leaderboards),
        },
      ]),
    ),
  });

  return { bundle, timings };
}

export function getRuntimeBaseState(
  bundle: DashboardRuntimeBundle,
  query: Pick<TrendDashboardQuery, "scope" | "range">,
) {
  return bundle.baseStates[toBaseStateKey(query)] ?? null;
}

export function isRuntimeBundleStale(bundle: DashboardRuntimeBundle, manifest: SourceManifest) {
  return bundle.sourceManifest.combinedSignature !== manifest.combinedSignature;
}

export function hasMeaningfulLocalData(bundle: DashboardRuntimeBundle | null) {
  if (!bundle) {
    return false;
  }

  return (
    bundle.rawCounts.posts > 0 ||
    bundle.rawCounts.comments > 0 ||
    bundle.rawCounts.publicItems > 0 ||
    bundle.rawCounts.blueskyPosts > 0 ||
    bundle.rawCounts.blueskyInteractions > 0 ||
    bundle.rawCounts.youtubeComments > 0
  );
}
