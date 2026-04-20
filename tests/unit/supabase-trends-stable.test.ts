import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateRangePreset, TrendScope } from "@/types/domain";
import { TrendDashboardQuery, TrendSort } from "@/types/view-models";

const postgresMocks = vi.hoisted(() => {
  const query = vi.fn();
  const pool = { query };
  return {
    query,
    pool,
    getServerPostgresPool: vi.fn(() => pool),
    hasDatabaseUrl: vi.fn(() => true),
  };
});

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  hasSupabaseServerCredentials: vi.fn(() => false),
}));

vi.mock("@/lib/db/server-postgres", () => postgresMocks);
vi.mock("@/lib/supabase/server", () => supabaseMocks);

type QueryScenario = {
  totalsRows: Record<string, unknown>[];
  clusterTotalsRows?: Record<string, unknown>[];
  enrichmentRows?: Record<string, unknown>[];
  seriesRows: StableSeriesRow[];
  clusterSeriesRows?: StableSeriesRow[];
  queriedSeriesDays: string[];
  queriedSeriesTopicKeys: string[][];
};

type StableSeriesRow = {
  day: string;
  bucket_5m: string;
  topic_key: string;
  topic_label: string;
  interactions: number;
  cumulative_interactions: number;
  updated_at: string;
};

const NOW_ISO = "2026-04-03T12:00:00.000Z";
const NOW = new Date(NOW_ISO);

function buildWindow(range: DateRangePreset, now = NOW) {
  const config = {
    "1h": { points: 12, bucketMinutes: 5 },
    "6h": { points: 72, bucketMinutes: 5 },
    "24h": { points: 288, bucketMinutes: 5 },
    "7d": { points: 336, bucketMinutes: 30 },
  } satisfies Record<DateRangePreset, { points: number; bucketMinutes: number }>;
  const bucketMs = config[range].bucketMinutes * 60_000;
  const windowEndMs = Math.floor(now.getTime() / bucketMs) * bucketMs;
  const windowStartMs = windowEndMs - (config[range].points - 1) * bucketMs;

  return {
    bucketMinutes: config[range].bucketMinutes,
    buckets: Array.from({ length: config[range].points }, (_, index) =>
      new Date(windowStartMs + index * bucketMs).toISOString(),
    ),
    windowStartIso: new Date(windowStartMs).toISOString(),
    windowEndIso: new Date(windowEndMs).toISOString(),
  };
}

function buildWindowDayIsos(range: DateRangePreset, now = NOW) {
  const window = buildWindow(range, now);
  const startDayMs = Date.UTC(
    new Date(window.windowStartIso).getUTCFullYear(),
    new Date(window.windowStartIso).getUTCMonth(),
    new Date(window.windowStartIso).getUTCDate(),
  );
  const endDayMs = Date.UTC(
    new Date(window.windowEndIso).getUTCFullYear(),
    new Date(window.windowEndIso).getUTCMonth(),
    new Date(window.windowEndIso).getUTCDate(),
  );

  const days: string[] = [];
  for (let cursor = startDayMs; cursor <= endDayMs; cursor += 24 * 60 * 60 * 1_000) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }

  return days;
}

function createWindowTotalRow({
  topicKey,
  topicLabel,
  totalMentions,
  uniquePosts,
  uniqueAuthors,
  firstSeenAt,
  lastSeenAt,
}: {
  topicKey: string;
  topicLabel?: string;
  totalMentions: number;
  uniquePosts?: number;
  uniqueAuthors?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
}) {
  return {
    topic_key: topicKey,
    topic_label: topicLabel ?? topicKey,
    platform_count: 1,
    total_mentions: totalMentions,
    unique_posts: uniquePosts ?? totalMentions,
    unique_authors: uniqueAuthors ?? Math.max(1, Math.floor((uniquePosts ?? totalMentions) * 0.7)),
    positive_count: Math.max(0, Math.floor(totalMentions * 0.4)),
    neutral_count: Math.max(0, Math.floor(totalMentions * 0.4)),
    negative_count: Math.max(0, totalMentions - Math.floor(totalMentions * 0.8)),
    first_seen_at: firstSeenAt ?? new Date(NOW.getTime() - 18 * 60 * 60 * 1_000).toISOString(),
    last_seen_at: lastSeenAt ?? new Date(NOW.getTime() - 3 * 60 * 60 * 1_000).toISOString(),
    window_end: NOW_ISO,
    updated_at: NOW_ISO,
  } satisfies Record<string, unknown>;
}

function createSeriesRows(
  topicKey: string,
  bucketIsos: string[],
  valuesByBucketIso: Map<string, number>,
): StableSeriesRow[] {
  let cumulative = 0;
  const rows: StableSeriesRow[] = [];
  for (const bucketIso of bucketIsos) {
    const interactions = valuesByBucketIso.get(bucketIso) ?? 0;
    if (interactions <= 0) {
      continue;
    }
    cumulative += interactions;
    rows.push({
      day: bucketIso.slice(0, 10),
      bucket_5m: bucketIso,
      topic_key: topicKey,
      topic_label: topicKey,
      interactions,
      cumulative_interactions: cumulative,
      updated_at: bucketIso,
    });
  }
  return rows;
}

function createEnrichmentRow({
  topicKey,
  rawLabel,
  canonicalName,
  fallbackLabel,
  status = "ok",
  nameStatus = "ready",
  nameSource = "historical_alias",
  promptVersion = "v1",
  writerIdentity = "legacy.topic_aggregator",
  authoritativeWriter = false,
  keyEntities = [],
}: {
  topicKey: string;
  rawLabel?: string;
  canonicalName?: string;
  fallbackLabel?: string;
  status?: "ok" | "mixed" | "insufficient_evidence" | "junk";
  nameStatus?: string;
  nameSource?: string;
  promptVersion?: string;
  writerIdentity?: string;
  authoritativeWriter?: boolean;
  keyEntities?: string[];
}) {
  return {
    topic_key: topicKey,
    as_of_window_end: NOW_ISO,
    raw_label: rawLabel ?? topicKey,
    status,
    canonical_name: canonicalName ?? rawLabel ?? topicKey,
    ai_display_name: canonicalName ?? rawLabel ?? topicKey,
    fallback_label: fallbackLabel ?? rawLabel ?? canonicalName ?? topicKey,
    name_status: nameStatus,
    ai_name_status: nameStatus,
    name_source: nameSource,
    short_description: null,
    context_paragraph: null,
    narrative_summary: null,
    why_attention: null,
    evidence_post_ids: [],
    key_entities: keyEntities,
    trend_category: null,
    mixed_signals: [],
    abstain_reason: null,
    summary_confidence: 0.82,
    model_name: "test-model",
    prompt_version: promptVersion,
    generated_at: NOW_ISO,
    refreshed_at: NOW_ISO,
    ai_name_generated_at: NOW_ISO,
    ai_name_refreshed_at: NOW_ISO,
    ai_name_source_version: promptVersion,
    writer_identity: writerIdentity,
    writer_role: authoritativeWriter ? "authoritative_title_worker" : "legacy",
    authoritative_writer: authoritativeWriter,
    metadata_json: {
      writer_identity: writerIdentity,
      writer_role: authoritativeWriter ? "authoritative_title_worker" : "legacy",
      authoritative_writer: authoritativeWriter,
    },
  } satisfies Record<string, unknown>;
}

function setScenario(scenario: QueryScenario) {
  postgresMocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
    const text = String(sql);
    const parameters = params ?? [];

    if (text.includes("WITH latest_run AS")) {
      return {
        rows: [
          {
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
            workerRowsInserted: null,
            workerRunNotes: null,
          },
        ],
      };
    }

    if (text.includes("FROM public.topic_buckets_1m_final b")) {
      return {
        rows: scenario.totalsRows,
      };
    }

    if (text.includes("FROM public.topic_rolling_24h")) {
      return {
        rows: scenario.totalsRows,
      };
    }

    if (text.includes("/* stable_cluster_window_totals */")) {
      return {
        rows: scenario.clusterTotalsRows ?? scenario.totalsRows,
      };
    }

    if (text.includes("/* stable_cluster_day_series */")) {
      const [dayIso, , , windowStartIso, windowEndIso, mappingJson] = parameters as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      const mappings = JSON.parse(mappingJson) as Array<{ cluster_key?: string; clusterKey?: string }>;
      const clusterKeys = [...new Set(mappings
        .map((mapping) => String(mapping.cluster_key ?? mapping.clusterKey ?? ""))
        .filter((value) => value.length > 0))];
      scenario.queriedSeriesDays.push(dayIso);
      scenario.queriedSeriesTopicKeys.push(clusterKeys);
      return {
        rows: (scenario.clusterSeriesRows ?? scenario.seriesRows).filter((row) => {
          const rowDay = String(row.day ?? "");
          const rowBucket = String(row.bucket_5m ?? "");
          const rowTopicKey = String(row.topic_key ?? "");
          return (
            rowDay === dayIso &&
            rowBucket >= windowStartIso &&
            rowBucket <= windowEndIso &&
            clusterKeys.includes(rowTopicKey)
          );
        }),
      };
    }

    if (text.includes("FROM public.topic_day_series_5m")) {
      const [dayIso, windowStartIso, windowEndIso, topicKeys] = parameters as [
        string,
        string,
        string,
        string[],
      ];
      scenario.queriedSeriesDays.push(dayIso);
      scenario.queriedSeriesTopicKeys.push([...topicKeys]);
      return {
        rows: scenario.seriesRows.filter((row) => {
          const rowDay = String(row.day ?? "");
          const rowBucket = String(row.bucket_5m ?? "");
          const rowTopicKey = String(row.topic_key ?? "");
          return (
            rowDay === dayIso &&
            rowBucket >= windowStartIso &&
            rowBucket <= windowEndIso &&
            topicKeys.includes(rowTopicKey)
          );
        }),
      };
    }

    if (text.includes("FROM public.topic_ai_enrichments")) {
      return {
        rows: scenario.enrichmentRows ?? [],
      };
    }

    throw new Error(`Unhandled Postgres query in test: ${text}`);
  });
}

async function loadSupabaseTrendsModule() {
  vi.resetModules();
  return import("@/lib/dashboard/supabase-trends");
}

async function fetchStableVm(
  query: Partial<TrendDashboardQuery> & Pick<TrendDashboardQuery, "range" | "mode" | "sort">,
) {
  const supabaseTrendsModule = await loadSupabaseTrendsModule();
  return supabaseTrendsModule.getSupabaseTrendDashboardState({
    scope: (query.scope ?? "overall") as TrendScope,
    range: query.range,
    mode: query.mode,
    sort: query.sort as TrendSort,
    selectedId: query.selectedId,
    selectedKey: query.selectedKey,
  });
}

describe("stable Supabase trend ranking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.USE_STABLE_TOPIC_READ_MODEL = "true";
    postgresMocks.query.mockReset();
    postgresMocks.hasDatabaseUrl.mockReturnValue(true);
    supabaseMocks.hasSupabaseServerCredentials.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.USE_STABLE_TOPIC_READ_MODEL;
    vi.clearAllMocks();
  });

  it("hydrates summary ranking with real series for a fresh breakout beyond the old top-250 volume cut", async () => {
    const window = buildWindow("24h");
    const breakoutBuckets = new Map<string, number>();
    for (const bucketIso of window.buckets) {
      breakoutBuckets.set(bucketIso, 1);
    }
    for (const bucketIso of window.buckets.slice(-72)) {
      breakoutBuckets.set(bucketIso, 8);
    }

    const queriedSeriesDays: string[] = [];
    const totalsRows = Array.from({ length: 259 }, (_, index) =>
      createWindowTotalRow({
        topicKey: `filler-${String(index + 1).padStart(3, "0")}`,
        totalMentions: 500 - index,
        uniquePosts: 40,
        uniqueAuthors: 24,
        lastSeenAt: new Date(NOW.getTime() - 6 * 60 * 60 * 1_000).toISOString(),
      }),
    );
    totalsRows.push(
      createWindowTotalRow({
        topicKey: "fresh-breakout",
        topicLabel: "Fresh Breakout",
        totalMentions: 180,
        uniquePosts: 18,
        uniqueAuthors: 14,
        firstSeenAt: new Date(NOW.getTime() - 90 * 60 * 1_000).toISOString(),
        lastSeenAt: new Date(NOW.getTime() - 5 * 60 * 1_000).toISOString(),
      }),
    );

    setScenario({
      totalsRows,
      seriesRows: createSeriesRows("fresh-breakout", window.buckets, breakoutBuckets),
      queriedSeriesDays,
      queriedSeriesTopicKeys: [],
    });

    const vm = await fetchStableVm({
      scope: "overall",
      range: "24h",
      mode: "emerging",
      sort: "velocity",
    });

    const breakoutRow = vm.leaderboard.find((row) => row.canonicalKeySummary === "fresh-breakout");
    expect(breakoutRow).toBeTruthy();
    expect(breakoutRow?.growthRate).toBeGreaterThan(0);
    expect(breakoutRow?.attentionAcceleration).toBeGreaterThan(0);
    expect(breakoutRow?.velocityScore ?? 0).toBeGreaterThan(0);
    expect(queriedSeriesDays.length).toBeGreaterThan(0);
  });

  it("uses the requested ranking metric as the primary sort driver on the stable path", async () => {
    const window = buildWindow("24h");
    const flatBuckets = new Map<string, number>();
    for (const bucketIso of window.buckets) {
      flatBuckets.set(bucketIso, 1);
    }
    const breakoutBuckets = new Map<string, number>();
    for (const bucketIso of window.buckets) {
      breakoutBuckets.set(bucketIso, 1);
    }
    for (const bucketIso of window.buckets.slice(-96)) {
      breakoutBuckets.set(bucketIso, 4);
    }

    setScenario({
      totalsRows: [
        createWindowTotalRow({
          topicKey: "slow-giant",
          topicLabel: "Slow Giant",
          totalMentions: 220,
          uniquePosts: 90,
          uniqueAuthors: 70,
          lastSeenAt: new Date(NOW.getTime() - 30 * 60 * 1_000).toISOString(),
        }),
        createWindowTotalRow({
          topicKey: "fresh-breakout",
          topicLabel: "Fresh Breakout",
          totalMentions: 60,
          uniquePosts: 5,
          uniqueAuthors: 4,
          firstSeenAt: new Date(NOW.getTime() - 90 * 60 * 1_000).toISOString(),
          lastSeenAt: new Date(NOW.getTime() - 5 * 60 * 1_000).toISOString(),
        }),
      ],
      seriesRows: [
        ...createSeriesRows("slow-giant", window.buckets, flatBuckets),
        ...createSeriesRows("fresh-breakout", window.buckets, breakoutBuckets),
      ],
      queriedSeriesDays: [],
      queriedSeriesTopicKeys: [],
    });

    const vm = await fetchStableVm({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "growth",
    });

    expect(vm.leaderboard[0]?.canonicalKeySummary).toBe("fresh-breakout");
    expect(vm.leaderboard[0]?.growthRate).toBeGreaterThan(vm.leaderboard[1]?.growthRate ?? 0);
    expect(vm.leaderboard[0]?.mentions).toBeLessThan(vm.leaderboard[1]?.mentions ?? Number.POSITIVE_INFINITY);
  });

  it("sorts posts mode by unique post volume before strength and velocity", async () => {
    const window = buildWindow("24h");
    const flatBuckets = new Map<string, number>();
    for (const bucketIso of window.buckets) {
      flatBuckets.set(bucketIso, 1);
    }

    setScenario({
      totalsRows: [
        createWindowTotalRow({
          topicKey: "high-mentions-low-posts",
          topicLabel: "High Mentions Low Posts",
          totalMentions: 240,
          uniquePosts: 6,
          uniqueAuthors: 5,
          lastSeenAt: new Date(NOW.getTime() - 20 * 60 * 1_000).toISOString(),
        }),
        createWindowTotalRow({
          topicKey: "high-posts",
          topicLabel: "High Posts",
          totalMentions: 180,
          uniquePosts: 18,
          uniqueAuthors: 14,
          lastSeenAt: new Date(NOW.getTime() - 20 * 60 * 1_000).toISOString(),
        }),
      ],
      seriesRows: [
        ...createSeriesRows("high-mentions-low-posts", window.buckets, flatBuckets),
        ...createSeriesRows("high-posts", window.buckets, flatBuckets),
      ],
      queriedSeriesDays: [],
      queriedSeriesTopicKeys: [],
    });

    const vm = await fetchStableVm({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "posts",
    });

    expect(vm.leaderboard.map((row) => row.canonicalKeySummary).slice(0, 2)).toEqual([
      "high-posts",
      "high-mentions-low-posts",
    ]);
    expect(vm.leaderboard[0]?.supportingThreadCount).toBeGreaterThan(
      vm.leaderboard[1]?.supportingThreadCount ?? 0,
    );
  });

  it("collapses near-duplicate aliases into a single merged cluster before ranking", async () => {
    setScenario({
      totalsRows: [
        createWindowTotalRow({
          topicKey: "transdayofvisibility",
          topicLabel: "Transdayofvisibility",
          totalMentions: 90,
          uniquePosts: 42,
          uniqueAuthors: 31,
        }),
        createWindowTotalRow({
          topicKey: "trans day of visibility",
          topicLabel: "Trans Day Of Visibility",
          totalMentions: 75,
          uniquePosts: 35,
          uniqueAuthors: 28,
        }),
        createWindowTotalRow({
          topicKey: "other-story",
          topicLabel: "Other Story",
          totalMentions: 60,
          uniquePosts: 26,
          uniqueAuthors: 20,
        }),
      ],
      clusterTotalsRows: [
        createWindowTotalRow({
          topicKey: "trans day of visibility",
          topicLabel: "Trans Day Of Visibility",
          totalMentions: 165,
          uniquePosts: 77,
          uniqueAuthors: 59,
        }),
        createWindowTotalRow({
          topicKey: "other-story",
          topicLabel: "Other Story",
          totalMentions: 60,
          uniquePosts: 26,
          uniqueAuthors: 20,
        }),
      ],
      enrichmentRows: [],
      seriesRows: [],
      queriedSeriesDays: [],
      queriedSeriesTopicKeys: [],
    });

    const vm = await fetchStableVm({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "posts",
    });

    const mergedVisibilityRows = vm.leaderboard.filter((row) =>
      String(row.name ?? "").toLowerCase().includes("visibility") ||
      String(row.canonicalKeySummary ?? "").includes("visibility")
    );
    expect(mergedVisibilityRows).toHaveLength(1);
    expect(mergedVisibilityRows[0]?.mentions).toBe(165);
    expect(vm.leaderboard.some((row) => row.canonicalKeySummary === "transdayofvisibility")).toBe(false);
  });

  it("repairs fragment shards into the dominant narrative cluster and ranks by merged volume", async () => {
    setScenario({
      totalsRows: [
        createWindowTotalRow({
          topicKey: "trump",
          topicLabel: "Trump",
          totalMentions: 120,
          uniquePosts: 52,
          uniqueAuthors: 44,
        }),
        createWindowTotalRow({
          topicKey: "resident",
          topicLabel: "Resident",
          totalMentions: 70,
          uniquePosts: 30,
          uniqueAuthors: 24,
        }),
        createWindowTotalRow({
          topicKey: "rump",
          topicLabel: "Rump",
          totalMentions: 60,
          uniquePosts: 28,
          uniqueAuthors: 23,
        }),
        createWindowTotalRow({
          topicKey: "biden",
          topicLabel: "Biden",
          totalMentions: 95,
          uniquePosts: 40,
          uniqueAuthors: 33,
        }),
      ],
      enrichmentRows: [
        createEnrichmentRow({
          topicKey: "trump",
          rawLabel: "Trump",
          canonicalName: "Donald Trump",
          keyEntities: ["Donald Trump"],
        }),
        createEnrichmentRow({
          topicKey: "resident",
          rawLabel: "President",
          canonicalName: "Trump And U.S. Policy Discussion",
          keyEntities: ["Donald Trump", "USA"],
        }),
        createEnrichmentRow({
          topicKey: "rump",
          rawLabel: "Trump",
          canonicalName: "Trump Discussion Cluster",
          keyEntities: ["Donald Trump"],
        }),
        createEnrichmentRow({
          topicKey: "biden",
          rawLabel: "Biden",
          canonicalName: "Joe Biden",
          keyEntities: ["Joe Biden"],
        }),
      ],
      seriesRows: [],
      queriedSeriesDays: [],
      queriedSeriesTopicKeys: [],
    });

    const vm = await fetchStableVm({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "posts",
    });

    expect(vm.leaderboard[0]?.name).toBe("Donald Trump");
    expect(vm.leaderboard[0]?.canonicalKeySummary).toBe("donald trump");
    expect(vm.leaderboard[0]?.mentions).toBe(250);
    expect(vm.leaderboard.some((row) => row.canonicalKeySummary === "resident")).toBe(false);
    expect(vm.leaderboard.some((row) => row.canonicalKeySummary === "rump")).toBe(false);
    expect(vm.leaderboard[0]?.mentions).toBeGreaterThan(vm.leaderboard[1]?.mentions ?? 0);
  });

  it("deduplicates merged cluster volume and series by unique contributing posts", async () => {
    const window = buildWindow("24h");
    const trumpBuckets = new Map<string, number>();
    const otherStoryBuckets = new Map<string, number>();
    for (const bucketIso of window.buckets.slice(-12)) {
      trumpBuckets.set(bucketIso, 7);
      otherStoryBuckets.set(bucketIso, 6);
    }

    setScenario({
      totalsRows: [
        createWindowTotalRow({
          topicKey: "trump",
          topicLabel: "Trump",
          totalMentions: 90,
          uniquePosts: 90,
          uniqueAuthors: 62,
        }),
        createWindowTotalRow({
          topicKey: "resident",
          topicLabel: "Resident",
          totalMentions: 70,
          uniquePosts: 70,
          uniqueAuthors: 48,
        }),
        createWindowTotalRow({
          topicKey: "other-story",
          topicLabel: "Other Story",
          totalMentions: 120,
          uniquePosts: 120,
          uniqueAuthors: 86,
        }),
      ],
      clusterTotalsRows: [
        createWindowTotalRow({
          topicKey: "donald trump",
          topicLabel: "Donald Trump",
          totalMentions: 95,
          uniquePosts: 95,
          uniqueAuthors: 68,
        }),
        createWindowTotalRow({
          topicKey: "other-story",
          topicLabel: "Other Story",
          totalMentions: 120,
          uniquePosts: 120,
          uniqueAuthors: 86,
        }),
      ],
      enrichmentRows: [
        createEnrichmentRow({
          topicKey: "trump",
          rawLabel: "Trump",
          canonicalName: "Donald Trump",
          keyEntities: ["Donald Trump"],
        }),
        createEnrichmentRow({
          topicKey: "resident",
          rawLabel: "President",
          canonicalName: "Trump And U.S. Policy Discussion",
          keyEntities: ["Donald Trump", "USA"],
        }),
      ],
      seriesRows: [],
      clusterSeriesRows: [
        ...createSeriesRows("donald trump", window.buckets, trumpBuckets),
        ...createSeriesRows("other-story", window.buckets, otherStoryBuckets),
      ],
      queriedSeriesDays: [],
      queriedSeriesTopicKeys: [],
    });

    const vm = await fetchStableVm({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "posts",
    });

    const trumpRow = vm.leaderboard.find((row) => row.canonicalKeySummary === "donald trump");
    expect(trumpRow).toBeTruthy();
    expect(trumpRow?.mentions).toBe(95);
    expect(trumpRow?.supportingThreadCount).toBe(95);
    expect(trumpRow?.attentionHistory.slice(-1)[0]?.value).toBe(7);
    expect(vm.leaderboard[0]?.canonicalKeySummary).toBe("other-story");
    expect(trumpRow?.mentions).toBeLessThan(vm.leaderboard[0]?.mentions ?? Number.POSITIVE_INFINITY);
  });

  it("keeps unresolved temporal shards off the main leaderboard when they cannot be merged", async () => {
    setScenario({
      totalsRows: [
        createWindowTotalRow({
          topicKey: "march",
          topicLabel: "March",
          totalMentions: 140,
          uniquePosts: 65,
          uniqueAuthors: 54,
        }),
        createWindowTotalRow({
          topicKey: "uesday",
          topicLabel: "Tuesday",
          totalMentions: 110,
          uniquePosts: 52,
          uniqueAuthors: 41,
        }),
        createWindowTotalRow({
          topicKey: "donald trump",
          topicLabel: "Donald Trump",
          totalMentions: 90,
          uniquePosts: 38,
          uniqueAuthors: 33,
        }),
      ],
      enrichmentRows: [
        createEnrichmentRow({
          topicKey: "donald trump",
          rawLabel: "Trump",
          canonicalName: "Donald Trump",
          keyEntities: ["Donald Trump"],
        }),
      ],
      seriesRows: [],
      queriedSeriesDays: [],
      queriedSeriesTopicKeys: [],
    });

    const vm = await fetchStableVm({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "posts",
    });

    expect(vm.leaderboard[0]?.canonicalKeySummary).toBe("donald trump");
    expect(vm.leaderboard.some((row) => row.canonicalKeySummary === "march")).toBe(false);
    expect(vm.leaderboard.some((row) => row.canonicalKeySummary === "uesday")).toBe(false);
  });

  it("drops stale single-entity enrichment rows when no current narrative label survives", async () => {
    setScenario({
      totalsRows: [
        createWindowTotalRow({
          topicKey: "rump",
          topicLabel: "Trump",
          totalMentions: 160,
          uniquePosts: 70,
          uniqueAuthors: 58,
        }),
        createWindowTotalRow({
          topicKey: "creator-clip-backlash",
          topicLabel: "Creator Clip Backlash",
          totalMentions: 90,
          uniquePosts: 42,
          uniqueAuthors: 35,
        }),
      ],
      enrichmentRows: [
        {
          ...createEnrichmentRow({
            topicKey: "rump",
            rawLabel: "Trump",
            canonicalName: "Donald Trump",
            keyEntities: ["Donald Trump"],
          }),
          as_of_window_end: "2026-03-28T12:00:00.000Z",
          generated_at: "2026-03-28T12:05:00.000Z",
          refreshed_at: "2026-03-28T12:05:00.000Z",
          ai_name_generated_at: "2026-03-28T12:05:00.000Z",
          ai_name_refreshed_at: "2026-03-28T12:05:00.000Z",
        },
      ],
      seriesRows: [],
      queriedSeriesDays: [],
      queriedSeriesTopicKeys: [],
    });

    const vm = await fetchStableVm({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "posts",
    });

    expect(vm.leaderboard.map((row) => row.canonicalKeySummary)).toEqual([
      "creator-clip-backlash",
    ]);
    expect(vm.leaderboard[0]?.displayName).toBe("Creator Clip Backlash");
    expect(vm.leaderboard.some((row) => row.canonicalKeySummary === "rump")).toBe(false);
  });

  it("hydrates stable series across every calendar day touched by a 7d window", async () => {
    const expectedDays = buildWindowDayIsos("7d");
    const window = buildWindow("7d");
    const breakoutBuckets = new Map<string, number>();
    for (const bucketIso of window.buckets) {
      breakoutBuckets.set(bucketIso, 1);
    }

    const queriedSeriesDays: string[] = [];
    setScenario({
      totalsRows: [
        createWindowTotalRow({
          topicKey: "week-long-story",
          topicLabel: "Week Long Story",
          totalMentions: 90,
          uniquePosts: 30,
          uniqueAuthors: 22,
          firstSeenAt: window.windowStartIso,
          lastSeenAt: window.windowEndIso,
        }),
      ],
      seriesRows: createSeriesRows("week-long-story", window.buckets, breakoutBuckets),
      queriedSeriesDays,
      queriedSeriesTopicKeys: [],
    });

    const vm = await fetchStableVm({
      scope: "overall",
      range: "7d",
      mode: "emerging",
      sort: "velocity",
    });

    expect([...new Set(queriedSeriesDays)]).toEqual(expectedDays);
    expect(vm.leaderboard[0]?.canonicalKeySummary).toBe("week-long-story");
    expect(vm.leaderboard[0]?.velocityScore ?? 0).toBeGreaterThan(0);
  });

  it("does not treat partial series coverage as trusted breakout growth", async () => {
    const window = buildWindow("24h");
    const partialBurstBuckets = new Map<string, number>();
    for (const bucketIso of window.buckets.slice(-12)) {
      partialBurstBuckets.set(bucketIso, 6);
    }

    setScenario({
      totalsRows: [
        createWindowTotalRow({
          topicKey: "steady-anchor",
          topicLabel: "Steady Anchor",
          totalMentions: 240,
          uniquePosts: 110,
          uniqueAuthors: 90,
          lastSeenAt: new Date(NOW.getTime() - 15 * 60 * 1_000).toISOString(),
        }),
        createWindowTotalRow({
          topicKey: "partial-burst",
          topicLabel: "Partial Burst",
          totalMentions: 60,
          uniquePosts: 20,
          uniqueAuthors: 15,
          firstSeenAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1_000).toISOString(),
          lastSeenAt: new Date(NOW.getTime() - 5 * 60 * 1_000).toISOString(),
        }),
      ],
      seriesRows: createSeriesRows("partial-burst", window.buckets, partialBurstBuckets),
      queriedSeriesDays: [],
      queriedSeriesTopicKeys: [],
    });

    const vm = await fetchStableVm({
      scope: "overall",
      range: "24h",
      mode: "emerging",
      sort: "velocity",
    });

    const partialBurst = vm.leaderboard.find((row) => row.canonicalKeySummary === "partial-burst");
    expect(partialBurst).toBeTruthy();
    expect(partialBurst?.growthTrusted).toBe(false);
    expect(partialBurst?.velocityTrusted).toBe(false);
    expect(partialBurst?.growthRate).toBe(0);
    expect(partialBurst?.attentionAcceleration).toBe(0);
    expect(partialBurst?.breakoutMomentumTrusted).toBe(false);
  });

  it("prevents sparse low-support bursts from outranking strong established narratives on attention", async () => {
    const window = buildWindow("24h");
    const weakBurstBuckets = new Map<string, number>();
    for (const bucketIso of window.buckets.slice(-12)) {
      weakBurstBuckets.set(bucketIso, 4);
    }

    setScenario({
      totalsRows: [
        createWindowTotalRow({
          topicKey: "strong-established",
          topicLabel: "Strong Established",
          totalMentions: 260,
          uniquePosts: 120,
          uniqueAuthors: 95,
          lastSeenAt: new Date(NOW.getTime() - 10 * 60 * 1_000).toISOString(),
        }),
        createWindowTotalRow({
          topicKey: "tiny-burst",
          topicLabel: "Tiny Burst",
          totalMentions: 18,
          uniquePosts: 4,
          uniqueAuthors: 3,
          firstSeenAt: new Date(NOW.getTime() - 80 * 60 * 1_000).toISOString(),
          lastSeenAt: new Date(NOW.getTime() - 5 * 60 * 1_000).toISOString(),
        }),
      ],
      seriesRows: createSeriesRows("tiny-burst", window.buckets, weakBurstBuckets),
      queriedSeriesDays: [],
      queriedSeriesTopicKeys: [],
    });

    const vm = await fetchStableVm({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "attention",
    });

    expect(vm.leaderboard[0]?.canonicalKeySummary).toBe("strong-established");
    const tinyBurst = vm.leaderboard.find((row) => row.canonicalKeySummary === "tiny-burst");
    expect(tinyBurst?.attentionMetricTrusted).toBe(false);
    expect(tinyBurst?.growthRate).toBe(0);
  });

  it("filters tiny freshness-only candidates out of the seeded series hydration pool", async () => {
    const queriedSeriesDays: string[] = [];
    const queriedSeriesTopicKeys: string[][] = [];
    const totalsRows = Array.from({ length: 220 }, (_, index) =>
      createWindowTotalRow({
        topicKey: `filler-${String(index + 1).padStart(3, "0")}`,
        totalMentions: 500 - index,
        uniquePosts: 40,
        uniqueAuthors: 30,
        lastSeenAt: new Date(NOW.getTime() - 4 * 60 * 60 * 1_000).toISOString(),
      }),
    );
    totalsRows.push(
      createWindowTotalRow({
        topicKey: "fresh-credible",
        topicLabel: "Fresh Credible",
        totalMentions: 24,
        uniquePosts: 9,
        uniqueAuthors: 7,
        firstSeenAt: new Date(NOW.getTime() - 70 * 60 * 1_000).toISOString(),
        lastSeenAt: new Date(NOW.getTime() - 3 * 60 * 1_000).toISOString(),
      }),
    );
    totalsRows.push(
      createWindowTotalRow({
        topicKey: "tiny-fresh",
        topicLabel: "Tiny Fresh",
        totalMentions: 3,
        uniquePosts: 2,
        uniqueAuthors: 1,
        firstSeenAt: new Date(NOW.getTime() - 40 * 60 * 1_000).toISOString(),
        lastSeenAt: new Date(NOW.getTime() - 1 * 60 * 1_000).toISOString(),
      }),
    );

    setScenario({
      totalsRows,
      seriesRows: [],
      queriedSeriesDays,
      queriedSeriesTopicKeys,
    });

    await fetchStableVm({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "attention",
    });

    const requestedTopicKeys = new Set(queriedSeriesTopicKeys.flat());
    expect(requestedTopicKeys.has("fresh-credible")).toBe(true);
    expect(queriedSeriesDays.length).toBeGreaterThan(0);
  });

  it("keeps ordering deterministic when primary scores tie", async () => {
    setScenario({
      totalsRows: [
        createWindowTotalRow({
          topicKey: "alpha",
          totalMentions: 20,
          uniquePosts: 10,
          uniqueAuthors: 8,
        }),
        createWindowTotalRow({
          topicKey: "beta",
          totalMentions: 20,
          uniquePosts: 10,
          uniqueAuthors: 8,
        }),
      ],
      seriesRows: [],
      queriedSeriesDays: [],
      queriedSeriesTopicKeys: [],
    });

    const vm = await fetchStableVm({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "attention",
    });

    expect(vm.leaderboard.map((row) => row.canonicalKeySummary)).toEqual(["alpha", "beta"]);
  });

  it("prefers readable stable labels over fragmentary fallback junk on the live board", async () => {
    setScenario({
      totalsRows: [
        createWindowTotalRow({
          topicKey: "epublicans",
          topicLabel: "Republicans",
          totalMentions: 80,
          uniquePosts: 30,
          uniqueAuthors: 22,
        }),
      ],
      enrichmentRows: [
        createEnrichmentRow({
          topicKey: "epublicans",
          rawLabel: "Epublicans",
          canonicalName: "Republicans",
          fallbackLabel: "Epublicans",
          status: "mixed",
          nameStatus: "pending",
          nameSource: "fallback_cleaned",
          promptVersion: "visible-title-v2",
          writerIdentity: "unknown",
          authoritativeWriter: false,
        }),
        createEnrichmentRow({
          topicKey: "epublicans",
          rawLabel: "Republicans",
          canonicalName: "Republican tariff backlash",
          fallbackLabel: "Republicans",
          status: "ok",
          nameStatus: "ready",
          nameSource: "ai_exact",
          promptVersion: "visible-title-v3",
          writerIdentity: "backend.main:trend_title_generation",
          authoritativeWriter: true,
        }),
      ],
      seriesRows: [],
      queriedSeriesDays: [],
      queriedSeriesTopicKeys: [],
    });

    const vm = await fetchStableVm({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "posts",
    });

    expect(vm.leaderboard[0]?.displayName).toBe("Republican Tariff Backlash");
    expect(vm.leaderboard[0]?.trendFallbackLabel).toBe("Republicans");
    expect(vm.leaderboard[0]?.trendRawLabel).toBe("Republicans");
  });
});
