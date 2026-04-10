import { NextRequest, NextResponse } from "next/server";
import { buildServerTimingHeader } from "@/lib/dashboard/profiling";
import { buildTrendDashboardResponseVersion } from "@/lib/dashboard/response-version";
import { summarizeVisibleTrendNaming } from "@/lib/dashboard/naming-completeness";
import { fetchLatestCorrelatedMemecoinBoard } from "@/lib/dashboard/correlated-memecoins";
import { attachTrendMemecoinLinks } from "@/lib/dashboard/trend-memecoin-links";
import { getServerPostgresPool, hasDatabaseUrl } from "@/lib/db/server-postgres";
import { getTrendDashboardState } from "@/lib/dashboard/service";
import { applyTrendDashboardSelection } from "@/lib/dashboard/selection";
import { requirePaidApiUser } from "@/lib/supabase/auth";
import { DateRangePreset, TrendScope } from "@/types/domain";
import { TrendDashboardVM, TrendLeaderboardMode, TrendSort } from "@/types/view-models";

const RANGE_OPTIONS: DateRangePreset[] = ["1h", "6h", "24h", "7d"];
const MODE_OPTIONS: TrendLeaderboardMode[] = ["established", "emerging"];
const SORT_OPTIONS: TrendSort[] = [
  "posts",
  "attention",
  "growth",
  "mentions",
  "strength",
  "breakout",
  "velocity",
  "novelty",
  "confirmation",
];
const SCOPE_OPTIONS: TrendScope[] = ["overall", "memes"];
const VIEW_OPTIONS = ["full", "summary", "detail"] as const;
const DASHBOARD_RESPONSE_CACHE_MAX = 96;
const DASHBOARD_BASE_SNAPSHOT_CACHE_MAX = 24;
const DASHBOARD_RESPONSE_CACHE_TTL_MS = (() => {
  const raw = process.env.DASHBOARD_RESPONSE_CACHE_TTL_MS;
  if (!raw) {
    return 60_000;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return 60_000;
  }

  return Math.min(120_000, Math.max(0, parsed));
})();
const DASHBOARD_SNAPSHOT_REFRESH_MS = (() => {
  const raw = process.env.DASHBOARD_SNAPSHOT_REFRESH_MS;
  if (!raw) {
    return 60_000;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return 60_000;
  }

  return Math.min(600_000, Math.max(5_000, parsed));
})();

type DashboardView = (typeof VIEW_OPTIONS)[number];

type DashboardQuery = {
  scope: TrendScope;
  range: DateRangePreset;
  mode: TrendLeaderboardMode;
  sort: TrendSort;
  selectedId?: string;
  selectedKey?: string;
};

type DashboardQueryBase = Omit<DashboardQuery, "selectedId" | "selectedKey">;

type CachedDashboardResponse = {
  payload: TrendDashboardVM;
  responseVersion: string;
  nameHealthSummary: TopicAiNameHealthSummary | null;
  expiresAt: number;
};

type CachedDashboardBaseSnapshot = {
  state?: TrendDashboardVM;
  expiresAt: number;
  refreshPromise: Promise<TrendDashboardVM> | null;
};

const dashboardResponseCache = new Map<string, CachedDashboardResponse>();
const dashboardBaseSnapshotCache = new Map<string, CachedDashboardBaseSnapshot>();
const AUTHORITATIVE_NAME_WRITER_IDENTITIES = [
  "backend.main:trend_title_generation",
  "backend.main:trend_enrichment",
] as const;
const AUTHORITATIVE_NAME_PROMPT_VERSIONS = [
  (process.env.BLUESKY_TREND_TITLE_PROMPT_VERSION ?? "visible-title-v3").trim() || "visible-title-v3",
  (process.env.BLUESKY_TREND_ENRICHMENT_PROMPT_VERSION ?? "v1").trim() || "v1",
] as const;

type TopicAiNameHealthSummary = {
  readyCount: number;
  pendingCount: number;
  failedCount: number;
  latestWriterIdentity: string | null;
  latestWriterRole: string | null;
  latestWriteAt: string | null;
  authoritativeWriteAt: string | null;
  nonAuthoritativeRecentWriteCount: number;
  nonAuthoritativeRecentWriteAt: string | null;
  activeWriterCount: number;
  unknownWriterCount: number;
  legacyPromptWriteCount: number;
  duplicateWriteTopicCount: number;
  recentUsageTotalTokens: number;
  recentUsagePromptTokens: number;
  recentUsageCompletionTokens: number;
};

function getDefaultSort(_mode: TrendLeaderboardMode): TrendSort {
  return "posts";
}

function normalizeEntityTag(value: string | null) {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim() ?? "";
  return first.replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}

function parseDashboardView(value: string | null): DashboardView {
  if (!value) {
    return "full";
  }

  return VIEW_OPTIONS.includes(value as DashboardView) ? (value as DashboardView) : "full";
}

function buildResponseCacheKey(query: DashboardQuery, view: DashboardView) {
  return JSON.stringify({
    view,
    ...query,
  });
}

function buildBaseSnapshotCacheKey(query: DashboardQueryBase) {
  return JSON.stringify(query);
}

function writeDashboardResponseCacheEntry(
  key: string,
  entry: CachedDashboardResponse,
) {
  dashboardResponseCache.delete(key);
  dashboardResponseCache.set(key, entry);

  if (dashboardResponseCache.size <= DASHBOARD_RESPONSE_CACHE_MAX) {
    return;
  }

  const oldestKey = dashboardResponseCache.keys().next().value;
  if (oldestKey) {
    dashboardResponseCache.delete(oldestKey);
  }
}

function toIsoHeaderTimestamp(value: unknown) {
  const normalized = typeof value === "string" ? value : value instanceof Date ? value.toISOString() : null;
  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

async function fetchTopicAiNameHealthSummary(): Promise<TopicAiNameHealthSummary | null> {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const pool = getServerPostgresPool();
  const result = await pool.query<Record<string, unknown>>(
    `
      WITH latest_topic_names AS (
        SELECT DISTINCT ON (e.topic_key)
          e.topic_key,
          COALESCE(NULLIF(TRIM(e.name_status), ''), 'pending') AS name_status,
          COALESCE(e.refreshed_at, e.generated_at)::timestamptz AS written_at,
          COALESCE(NULLIF(TRIM(e.metadata_json ->> 'writer_identity'), ''), 'unknown') AS writer_identity,
          COALESCE(NULLIF(TRIM(e.metadata_json ->> 'writer_role'), ''), 'unknown') AS writer_role
        FROM public.topic_ai_enrichments e
        ORDER BY e.topic_key, e.as_of_window_end DESC, e.generated_at DESC, e.id DESC
      ),
      latest_write AS (
        SELECT
          writer_identity,
          writer_role,
          written_at
        FROM latest_topic_names
        ORDER BY written_at DESC NULLS LAST, topic_key ASC
        LIMIT 1
      ),
      latest_authoritative_write AS (
        SELECT written_at
        FROM latest_topic_names
        WHERE writer_identity = ANY($1::text[])
        ORDER BY written_at DESC NULLS LAST, topic_key ASC
        LIMIT 1
      ),
      non_authoritative_recent AS (
        SELECT
          COUNT(*)::int AS recent_count,
          MAX(COALESCE(e.refreshed_at, e.generated_at))::timestamptz AS latest_write_at
        FROM public.topic_ai_enrichments e
        WHERE COALESCE(e.refreshed_at, e.generated_at) >= NOW() - INTERVAL '6 hours'
          AND COALESCE(NULLIF(TRIM(e.metadata_json ->> 'writer_identity'), ''), '') <> ALL($1::text[])
      ),
      recent_runs AS (
        SELECT
          topic_key,
          COALESCE(NULLIF(TRIM(metadata_json ->> 'writer_identity'), ''), 'unknown') AS writer_identity,
          CASE LOWER(COALESCE(metadata_json ->> 'authoritative_writer', ''))
            WHEN 'true' THEN true
            ELSE false
          END AS authoritative_writer,
          COALESCE(NULLIF(TRIM(prompt_version), ''), 'unknown') AS prompt_version,
          CASE
            WHEN COALESCE(metadata_json ->> 'usage_prompt_tokens', '') ~ '^-?[0-9]+$'
              THEN (metadata_json ->> 'usage_prompt_tokens')::bigint
            ELSE 0::bigint
          END AS usage_prompt_tokens,
          CASE
            WHEN COALESCE(metadata_json ->> 'usage_completion_tokens', '') ~ '^-?[0-9]+$'
              THEN (metadata_json ->> 'usage_completion_tokens')::bigint
            ELSE 0::bigint
          END AS usage_completion_tokens,
          CASE
            WHEN COALESCE(metadata_json ->> 'usage_total_tokens', '') ~ '^-?[0-9]+$'
              THEN (metadata_json ->> 'usage_total_tokens')::bigint
            ELSE 0::bigint
          END AS usage_total_tokens,
          generated_at
        FROM public.topic_ai_enrichment_runs
        WHERE generated_at >= NOW() - INTERVAL '24 hours'
      ),
      duplicate_topics AS (
        SELECT topic_key
        FROM recent_runs
        GROUP BY topic_key
        HAVING COUNT(*) >= 3
      )
      SELECT
        COUNT(*) FILTER (WHERE name_status = 'ready')::int AS ready_count,
        COUNT(*) FILTER (WHERE name_status = 'pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE name_status = 'failed')::int AS failed_count,
        (SELECT writer_identity FROM latest_write) AS latest_writer_identity,
        (SELECT writer_role FROM latest_write) AS latest_writer_role,
        (SELECT written_at FROM latest_write) AS latest_write_at,
        (SELECT written_at FROM latest_authoritative_write) AS authoritative_write_at,
        COALESCE((SELECT recent_count FROM non_authoritative_recent), 0)::int AS non_authoritative_recent_count,
        (SELECT latest_write_at FROM non_authoritative_recent) AS non_authoritative_recent_write_at,
        COALESCE((SELECT COUNT(DISTINCT writer_identity)::int FROM recent_runs), 0)::int AS active_writer_count,
        COALESCE((SELECT COUNT(*)::int FROM recent_runs WHERE writer_identity = 'unknown'), 0)::int AS unknown_writer_count,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM recent_runs
            WHERE NOT authoritative_writer
          ),
          0
        )::int AS non_authoritative_run_count,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM recent_runs
            WHERE CASE
              WHEN cardinality($2::text[]) = 0 THEN false
              ELSE prompt_version <> ALL($2::text[])
            END
          ),
          0
        )::int AS legacy_prompt_write_count,
        COALESCE((SELECT COUNT(*)::int FROM duplicate_topics), 0)::int AS duplicate_write_topic_count,
        COALESCE((SELECT SUM(usage_total_tokens)::bigint FROM recent_runs), 0)::bigint AS usage_total_tokens,
        COALESCE((SELECT SUM(usage_prompt_tokens)::bigint FROM recent_runs), 0)::bigint AS usage_prompt_tokens,
        COALESCE((SELECT SUM(usage_completion_tokens)::bigint FROM recent_runs), 0)::bigint AS usage_completion_tokens
      FROM latest_topic_names
    `,
    [AUTHORITATIVE_NAME_WRITER_IDENTITIES, AUTHORITATIVE_NAME_PROMPT_VERSIONS],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    readyCount: Number(row.ready_count ?? 0),
    pendingCount: Number(row.pending_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    latestWriterIdentity:
      typeof row.latest_writer_identity === "string" && row.latest_writer_identity.trim().length > 0
        ? row.latest_writer_identity.trim()
        : null,
    latestWriterRole:
      typeof row.latest_writer_role === "string" && row.latest_writer_role.trim().length > 0
        ? row.latest_writer_role.trim()
        : null,
    latestWriteAt: toIsoHeaderTimestamp(row.latest_write_at),
    authoritativeWriteAt: toIsoHeaderTimestamp(row.authoritative_write_at),
    nonAuthoritativeRecentWriteCount: Number(row.non_authoritative_recent_count ?? 0),
    nonAuthoritativeRecentWriteAt: toIsoHeaderTimestamp(row.non_authoritative_recent_write_at),
    activeWriterCount: Number(row.active_writer_count ?? 0),
    unknownWriterCount: Number(row.unknown_writer_count ?? 0),
    legacyPromptWriteCount: Number(row.legacy_prompt_write_count ?? 0),
    duplicateWriteTopicCount: Number(row.duplicate_write_topic_count ?? 0),
    recentUsageTotalTokens: Number(row.usage_total_tokens ?? 0),
    recentUsagePromptTokens: Number(row.usage_prompt_tokens ?? 0),
    recentUsageCompletionTokens: Number(row.usage_completion_tokens ?? 0),
  };
}

function writeDashboardBaseSnapshotCacheEntry(
  key: string,
  entry: CachedDashboardBaseSnapshot,
) {
  dashboardBaseSnapshotCache.delete(key);
  dashboardBaseSnapshotCache.set(key, entry);

  if (dashboardBaseSnapshotCache.size <= DASHBOARD_BASE_SNAPSHOT_CACHE_MAX) {
    return;
  }

  const oldestKey = dashboardBaseSnapshotCache.keys().next().value;
  if (oldestKey) {
    dashboardBaseSnapshotCache.delete(oldestKey);
  }
}

async function getOrRefreshBaseSnapshot(
  baseQuery: DashboardQueryBase,
  forceRebuild: boolean,
) {
  const cacheKey = buildBaseSnapshotCacheKey(baseQuery);
  const now = Date.now();
  const cached = dashboardBaseSnapshotCache.get(cacheKey);

  if (
    !forceRebuild &&
    cached?.state &&
    cached.expiresAt > now
  ) {
    return cached.state;
  }

  if (!forceRebuild && cached?.refreshPromise) {
    return cached.refreshPromise;
  }

  const refreshPromise = getTrendDashboardState(
    {
      ...baseQuery,
      selectedId: undefined,
      selectedKey: undefined,
    },
    { forceRebuild, readProfile: "summary" },
  )
    .then((state) => {
      writeDashboardBaseSnapshotCacheEntry(cacheKey, {
        state,
        expiresAt: Date.now() + DASHBOARD_SNAPSHOT_REFRESH_MS,
        refreshPromise: null,
      });
      return state;
    })
    .catch((error) => {
      const latest = dashboardBaseSnapshotCache.get(cacheKey);
      if (!forceRebuild && latest?.state) {
        writeDashboardBaseSnapshotCacheEntry(cacheKey, {
          ...latest,
          refreshPromise: null,
        });
        return latest.state;
      }

      dashboardBaseSnapshotCache.delete(cacheKey);
      throw error;
    });

  writeDashboardBaseSnapshotCacheEntry(cacheKey, {
    state: cached?.state,
    expiresAt: cached?.expiresAt ?? 0,
    refreshPromise,
  });

  return refreshPromise;
}

function applyDashboardResponseHeaders(
  response: NextResponse,
  payload: TrendDashboardVM,
  responseVersion: string,
  nameHealthSummary: TopicAiNameHealthSummary | null,
  snapshotAgeMs: number | null,
) {
  const responseAtIso = new Date().toISOString();
  response.headers.set("ETag", `"${responseVersion}"`);
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  response.headers.set("X-Dashboard-Api-Response-At", responseAtIso);

  if (payload.dataStatus?.timings) {
    response.headers.set("Server-Timing", buildServerTimingHeader(payload.dataStatus.timings));
  }

  if (payload.correlatedMemecoins?.updatedAt) {
    response.headers.set("X-Dashboard-Memecoins-Updated-At", payload.correlatedMemecoins.updatedAt);
  }

  if (typeof snapshotAgeMs === "number" && Number.isFinite(snapshotAgeMs) && snapshotAgeMs >= 0) {
    response.headers.set("X-Dashboard-Snapshot-Age-Seconds", String(Math.round(snapshotAgeMs / 1_000)));
  }

  if (payload.dataStatus) {
    response.headers.set("X-Dashboard-State-Source", payload.dataStatus.stateSource);
    response.headers.set(
      "X-Dashboard-Showing",
      payload.dataStatus.showing,
    );
    response.headers.set(
      "X-Dashboard-Runtime-Snapshot-Generated-At",
      payload.dataStatus.runtimeSnapshotGeneratedAt ?? "",
    );
    response.headers.set(
      "X-Dashboard-Source-Snapshot-Generated-At",
      payload.dataStatus.sourceSnapshotGeneratedAt ?? "",
    );
    response.headers.set(
      "X-Dashboard-Server-Now",
      responseAtIso,
    );
    response.headers.set("X-Dashboard-Response-Version", responseVersion);
    const primarySource = payload.dataStatus.sourceFreshness[0];
    if (primarySource) {
      response.headers.set("X-Dashboard-Source-Row-Count", String(primarySource.itemCount));
    }

    const diagnostics = payload.dataStatus.freshnessDiagnostics;
    if (diagnostics) {
      response.headers.set("X-Dashboard-Freshness-Source-Snapshot-At", diagnostics.sourceSnapshotAt ?? "");
      response.headers.set("X-Dashboard-Freshness-Ingestion-At", diagnostics.latestIngestionAt ?? "");
      response.headers.set("X-Dashboard-Freshness-Processed-At", diagnostics.latestProcessedAt ?? "");
      response.headers.set("X-Dashboard-Freshness-ReadModel-Finalize-At", diagnostics.latestReadModelFinalizeAt ?? "");
      response.headers.set("X-Dashboard-Freshness-ReadModel-Write-At", diagnostics.latestReadModelRollingWriteAt ?? "");
      response.headers.set("X-Dashboard-Freshness-Worker-Run-Started-At", diagnostics.workerRunStartedAt ?? "");
      response.headers.set("X-Dashboard-Freshness-Worker-Run-Status", diagnostics.workerRunStatus ?? "");
      response.headers.set("X-Dashboard-Freshness-Worker-Last-Event-At", diagnostics.workerLastEventAt ?? "");
      response.headers.set("X-Dashboard-Freshness-Worker-Heartbeat-At", diagnostics.workerHeartbeatAt ?? "");
      response.headers.set("X-Dashboard-Freshness-Worker-Current-Stage", diagnostics.workerCurrentStage ?? "");
      response.headers.set(
        "X-Dashboard-Freshness-Worker-Last-Write-At",
        diagnostics.workerLastSuccessfulWriteAt ?? diagnostics.maxWrittenTimestamp ?? "",
      );
      response.headers.set(
        "X-Dashboard-Freshness-Pipeline-Lag-Seconds",
        diagnostics.pipelineLagSeconds !== null && diagnostics.pipelineLagSeconds !== undefined
          ? String(diagnostics.pipelineLagSeconds)
          : "",
      );
      response.headers.set(
        "X-Dashboard-Freshness-Pipeline-Health",
        diagnostics.pipelineHealthState ?? "",
      );
      response.headers.set(
        "X-Dashboard-Freshness-Worker-Rows-Inserted",
        diagnostics.workerRowsInserted !== null ? String(diagnostics.workerRowsInserted) : "",
      );
      response.headers.set(
        "X-Dashboard-Freshness-Rendered-Reference-At",
        diagnostics.renderedStaleReferenceAt ?? "",
      );
      response.headers.set(
        "X-Dashboard-Freshness-Rendered-Reference-Source",
        diagnostics.renderedStaleReferenceSource ?? "",
      );
      response.headers.set("X-Dashboard-Freshness-Chain-Break", diagnostics.chainBreakStage ?? "");
    }
  }

  if (payload.trendCoverage) {
    response.headers.set("X-Dashboard-Leaderboard-Source", payload.trendCoverage.leaderboardSource);
    response.headers.set(
      "X-Dashboard-AI-Coverage-Pct",
      String(payload.trendCoverage.aiAssignmentCoveragePct),
    );
  }

  const namingSummary = summarizeVisibleTrendNaming(payload);
  response.headers.set("X-Dashboard-Request-Path-Naming", "disabled");
  response.headers.set(
    "X-Dashboard-AI-Rename-Enabled",
    "false",
  );
  response.headers.set("X-Dashboard-Visible-Trend-Count", String(namingSummary.visibleTrendCount));
  response.headers.set("X-Dashboard-AI-Named-Trend-Count", String(namingSummary.aiNamedCount));
  response.headers.set("X-Dashboard-AI-Failed-Trend-Count", String(namingSummary.aiFailedCount));
  response.headers.set("X-Dashboard-AI-Unresolved-Trend-Count", String(namingSummary.unresolvedCount));
  response.headers.set(
    "X-Dashboard-AI-Fallback-Display-Count",
    String(namingSummary.fallbackDisplayCount),
  );
  response.headers.set(
    "X-Dashboard-AI-Missing-Display-Count",
    String(namingSummary.missingDisplayCount),
  );
  if (nameHealthSummary) {
    response.headers.set("X-Dashboard-AI-Ready-Name-Count", String(nameHealthSummary.readyCount));
    response.headers.set("X-Dashboard-AI-Pending-Name-Count", String(nameHealthSummary.pendingCount));
    response.headers.set("X-Dashboard-AI-Global-Failed-Name-Count", String(nameHealthSummary.failedCount));
    response.headers.set(
      "X-Dashboard-AI-Writer-Identity",
      nameHealthSummary.latestWriterIdentity ?? "",
    );
    response.headers.set(
      "X-Dashboard-AI-Writer-Role",
      nameHealthSummary.latestWriterRole ?? "",
    );
    response.headers.set(
      "X-Dashboard-AI-Writer-Last-Write-At",
      nameHealthSummary.latestWriteAt ?? "",
    );
    response.headers.set(
      "X-Dashboard-AI-Authoritative-Writer-Last-Write-At",
      nameHealthSummary.authoritativeWriteAt ?? "",
    );
    response.headers.set(
      "X-Dashboard-AI-Non-Authoritative-Write-Count",
      String(nameHealthSummary.nonAuthoritativeRecentWriteCount),
    );
    response.headers.set(
      "X-Dashboard-AI-Non-Authoritative-Last-Write-At",
      nameHealthSummary.nonAuthoritativeRecentWriteAt ?? "",
    );
    response.headers.set(
      "X-Dashboard-AI-Active-Writer-Count",
      String(nameHealthSummary.activeWriterCount),
    );
    response.headers.set(
      "X-Dashboard-AI-Unknown-Writer-Count",
      String(nameHealthSummary.unknownWriterCount),
    );
    response.headers.set(
      "X-Dashboard-AI-Legacy-Prompt-Write-Count",
      String(nameHealthSummary.legacyPromptWriteCount),
    );
    response.headers.set(
      "X-Dashboard-AI-Duplicate-Write-Topic-Count",
      String(nameHealthSummary.duplicateWriteTopicCount),
    );
    response.headers.set(
      "X-Dashboard-AI-Usage-Total-Tokens-24h",
      String(nameHealthSummary.recentUsageTotalTokens),
    );
    response.headers.set(
      "X-Dashboard-AI-Usage-Prompt-Tokens-24h",
      String(nameHealthSummary.recentUsagePromptTokens),
    );
    response.headers.set(
      "X-Dashboard-AI-Usage-Completion-Tokens-24h",
      String(nameHealthSummary.recentUsageCompletionTokens),
    );
  }

  if (payload.blueskyOverview?.replayWindow) {
    response.headers.set(
      "X-Dashboard-Bluesky-Replay-Window-End",
      payload.blueskyOverview.replayWindow.windowEnd,
    );
    response.headers.set(
      "X-Dashboard-Bluesky-Replay-Latest-Point-At",
      payload.blueskyOverview.replayWindow.latestPointAt ?? "",
    );
    response.headers.set(
      "X-Dashboard-Bluesky-Replay-Latest-Data-At",
      payload.blueskyOverview.replayWindow.latestDataAt ?? "",
    );
    response.headers.set(
      "X-Dashboard-Bluesky-Replay-Stale-Gap-Minutes",
      String(payload.blueskyOverview.replayWindow.staleGapMinutes ?? ""),
    );
  }

  return response;
}

function compactRankedTrendForTransport(row: TrendDashboardVM["leaderboard"][number]) {
  return {
    ...row,
    attentionHistory: [],
    topPosts: [],
    blueskyDetail: null,
  };
}

function compactDashboardStateForTransport(state: TrendDashboardVM): TrendDashboardVM {
  return {
    ...state,
    leaderboards: {
      established: state.leaderboards.established.map(compactRankedTrendForTransport),
      emerging: state.leaderboards.emerging.map(compactRankedTrendForTransport),
    },
    leaderboard: state.leaderboard.map(compactRankedTrendForTransport),
    detail: state.detail
      ? {
          ...state.detail,
          trend: compactRankedTrendForTransport(state.detail.trend),
        }
      : null,
  };
}

function buildViewState(
  baseState: TrendDashboardVM,
  query: DashboardQuery,
  view: DashboardView,
) {
  const selectedState = applyTrendDashboardSelection(baseState, query.selectedId);

  if (view === "detail") {
    return {
      ...selectedState,
      leaderboard: [],
      leaderboards: {
        established: [],
        emerging: [],
      },
      overviewSeries: [],
      trendCoverage: null,
      blueskyOverview: selectedState.blueskyOverview
        ? {
            ...selectedState.blueskyOverview,
            replay: [],
          }
        : null,
    } satisfies TrendDashboardVM;
  }

  if (view === "summary") {
    return {
      ...selectedState,
      detail: null,
      leaderboards: {
        established: [],
        emerging: [],
      },
      overviewSeries: [],
      blueskyOverview: selectedState.blueskyOverview
        ? {
            ...selectedState.blueskyOverview,
            replay: [],
          }
        : null,
    } satisfies TrendDashboardVM;
  }

  return selectedState;
}

export async function GET(request: NextRequest) {
  const authResult = await requirePaidApiUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range");
  const mode = searchParams.get("mode");
  const sort = searchParams.get("sort");
  const scope = searchParams.get("scope");
  const view = parseDashboardView(searchParams.get("view"));
  const forceRebuild = searchParams.get("rebuild") === "true";
  const resolvedMode = MODE_OPTIONS.includes(mode as TrendLeaderboardMode)
    ? (mode as TrendLeaderboardMode)
    : "established";

  const query: DashboardQuery = {
    scope: SCOPE_OPTIONS.includes(scope as TrendScope) ? (scope as TrendScope) : "overall",
    range: RANGE_OPTIONS.includes(range as DateRangePreset) ? (range as DateRangePreset) : "24h",
    mode: resolvedMode,
    sort: SORT_OPTIONS.includes(sort as TrendSort)
      ? (sort as TrendSort)
      : getDefaultSort(resolvedMode),
    selectedId: searchParams.get("selectedId") ?? undefined,
    selectedKey: searchParams.get("selectedKey") ?? undefined,
  };
  const normalizedRequestEntityTag = normalizeEntityTag(request.headers.get("if-none-match"));
  const responseCacheKey = buildResponseCacheKey(query, view);

  if (!forceRebuild && DASHBOARD_RESPONSE_CACHE_TTL_MS > 0) {
    const now = Date.now();
    const cached = dashboardResponseCache.get(responseCacheKey);
    if (cached) {
      if (cached.expiresAt > now) {
        if (normalizedRequestEntityTag && normalizedRequestEntityTag === cached.responseVersion) {
          const response = applyDashboardResponseHeaders(
            new NextResponse(null, { status: 304 }),
            cached.payload,
            cached.responseVersion,
            cached.nameHealthSummary,
            null,
          );
          response.headers.set("X-Dashboard-Response-Cache", "hit");
          return response;
        }
        const response = applyDashboardResponseHeaders(
          NextResponse.json(cached.payload),
          cached.payload,
          cached.responseVersion,
          cached.nameHealthSummary,
          null,
        );
        response.headers.set("X-Dashboard-Response-Cache", "hit");
        return response;
      }

      dashboardResponseCache.delete(responseCacheKey);
    }
  }

  const baseQuery: DashboardQueryBase = {
    scope: query.scope,
    range: query.range,
    mode: query.mode,
    sort: query.sort,
  };
  const baseSnapshotCacheKey =
    view === "detail" ? null : buildBaseSnapshotCacheKey(baseQuery);
  const memecoinBoardPromise = fetchLatestCorrelatedMemecoinBoard().catch((error) => {
    console.error("[dashboard-route] failed to load correlated memecoin board", { error });
    return null;
  });
  const nameHealthSummaryPromise = fetchTopicAiNameHealthSummary().catch((error) => {
    console.error("[dashboard-route] failed to load topic AI name health", { error });
    return null;
  });
  let baseState: TrendDashboardVM;
  try {
    if (view === "detail") {
      baseState = await getTrendDashboardState(query, { forceRebuild, readProfile: "detail" });
    } else {
      baseState = await getOrRefreshBaseSnapshot(baseQuery, forceRebuild);
    }
  } catch (error) {
    console.error("[dashboard-route] failed to resolve trend dashboard base snapshot", {
      query,
      view,
      error,
    });
    return NextResponse.json(
      {
        error: {
          code: "DASHBOARD_TRENDS_FETCH_FAILED",
          message: "Failed to load trend dashboard data",
        },
      },
      { status: 502 },
    );
  }

  const [memecoinBoard, nameHealthSummary] = await Promise.all([
    memecoinBoardPromise,
    nameHealthSummaryPromise,
  ]);
  const linkedViewState = await attachTrendMemecoinLinks(buildViewState(baseState, query, view)).catch((error) => {
    console.error("[dashboard-route] failed to attach per-trend memecoin links", { error });
    return buildViewState(baseState, query, view);
  });
  const viewState = {
    ...linkedViewState,
    correlatedMemecoins: memecoinBoard,
  } satisfies TrendDashboardVM;
  const compactState = compactDashboardStateForTransport(viewState);
  const responseVersion = buildTrendDashboardResponseVersion(compactState);
  if (normalizedRequestEntityTag && normalizedRequestEntityTag === responseVersion) {
    const response = applyDashboardResponseHeaders(
      new NextResponse(null, { status: 304 }),
      compactState,
      responseVersion,
      nameHealthSummary,
      null,
    );
    response.headers.set("X-Dashboard-Response-Cache", "etag");
    return response;
  }

  const payload = compactState.dataStatus
    ? {
        ...compactState,
        dataStatus: {
          ...compactState.dataStatus,
          responseVersion,
        },
      }
    : compactState;

  if (process.env.NODE_ENV !== "production") {
    console.info("[dashboard-route] response shape", {
      view,
      scope: query.scope,
      range: query.range,
      mode: query.mode,
      sort: query.sort,
      stateSource: payload.dataStatus?.stateSource ?? null,
      runtimeSnapshotAvailable: payload.dataStatus?.runtimeSnapshotAvailable ?? null,
      localRawDataAvailable: payload.dataStatus?.localRawDataAvailable ?? null,
      leaderboardCount: payload.leaderboard.length,
      establishedCount: payload.leaderboards.established.length,
      emergingCount: payload.leaderboards.emerging.length,
      hasDetail: Boolean(payload.detail),
    });
  }
  if (!forceRebuild && DASHBOARD_RESPONSE_CACHE_TTL_MS > 0) {
    writeDashboardResponseCacheEntry(responseCacheKey, {
      payload,
      responseVersion,
      nameHealthSummary,
      expiresAt: Date.now() + DASHBOARD_RESPONSE_CACHE_TTL_MS,
    });
  }

  const snapshotAgeMs = (() => {
    if (!baseSnapshotCacheKey) {
      return null;
    }

    const entry = dashboardBaseSnapshotCache.get(baseSnapshotCacheKey);
    if (!entry) {
      return null;
    }
    const snapshotCreatedAt = entry.expiresAt - DASHBOARD_SNAPSHOT_REFRESH_MS;
    return Math.max(0, Date.now() - snapshotCreatedAt);
  })();

  const response = applyDashboardResponseHeaders(
    NextResponse.json(payload),
    payload,
    responseVersion,
    nameHealthSummary,
    snapshotAgeMs,
  );
  response.headers.set("X-Dashboard-Response-Cache", "miss");
  if (
    nameHealthSummary?.nonAuthoritativeRecentWriteCount &&
    nameHealthSummary.nonAuthoritativeRecentWriteCount > 0
  ) {
    console.warn("[dashboard-route] detected non-authoritative topic AI writes", {
      count: nameHealthSummary.nonAuthoritativeRecentWriteCount,
      latestWriteAt: nameHealthSummary.nonAuthoritativeRecentWriteAt,
      latestWriterIdentity: nameHealthSummary.latestWriterIdentity,
    });
  }
  return response;
}
