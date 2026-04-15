import "server-only";

import { PostgrestError } from "@supabase/supabase-js";
import { Pool } from "pg";
import { getServerPostgresPool, hasDatabaseUrl } from "@/lib/db/server-postgres";
import { applyTrendDashboardSelection } from "@/lib/dashboard/selection";
import {
  TREND_NAME_PLACEHOLDER,
  getTrendDisplayNameOrPlaceholder,
  toTrendNameFields,
} from "@/lib/dashboard/trend-name-state";
import { createZeroRankedTrend, createZeroTrendDashboardVM } from "@/lib/dashboard/zero-state";
import { getSupabaseServerClient, hasSupabaseServerCredentials } from "@/lib/supabase/server";
import { compareTrendsByPosts } from "@/lib/utils/trend-ranking";
import { DateRangePreset, PlatformId, TimeSeriesPoint, TrendFreshnessState, TrendLifecycleStage } from "@/types/domain";
import {
  DashboardDataStatus,
  DashboardFreshnessDiagnostics,
  RankedTrend,
  TimeSeriesWindow,
  TrendAiEnrichment,
  TrendDashboardQuery,
  TrendDashboardVM,
  TrendLeaderboardMode,
  TrendNameSource,
  TrendNameStatus,
  TrendSort,
} from "@/types/view-models";

type SupabaseTopicRow = Record<string, unknown>;

export type SupabaseTrendReadProfile = "summary" | "detail";

type ParsedTopicBucketRow = {
  bucketMinute: string;
  updatedAt: string | null;
  platform: PlatformId;
  topicText: string;
  normalizedTopic: string;
  topicType: string;
  mentionCount: number;
  postCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  tags: string[];
};

type TopicAggregate = {
  topicText: string;
  normalizedTopic: string;
  mentionCount: number;
  postCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  platforms: Map<PlatformId, number>;
  bucketCounts: Map<string, number>;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

type RangeConfig = {
  points: number;
  bucketMinutes: number;
};

type StableTopicDayTotalRow = {
  day: string;
  topicKey: string;
  topicLabel: string;
  totalMentions: number;
  uniquePosts: number;
  uniqueAuthors: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  platformCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

type StableTopicDayTotalAggregateRow = StableTopicDayTotalRow & {
  rawTopicKeys: string[];
  sourceTopicKeys: string[];
};

type StableTopicBucketRow = {
  bucketMinute: string;
  platform: PlatformId;
  topicKey: string;
  mentionCount: number;
  uniquePosts: number;
  uniqueAuthors: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  avgTopicConfidence: number;
  updatedAt: string | null;
};

type StableTopicSeriesRow = {
  day: string;
  topicKey: string;
  topicLabel: string;
  bucket5m: string;
  interactions: number;
  cumulativeInteractions: number;
  updatedAt: string | null;
};

type StableSeriesTrustAssessment = {
  expectedBucketCount: number;
  observedBucketCount: number;
  observedBucketRatio: number;
  nonZeroBucketCount: number;
  previousWindowObservedBucketCount: number;
  recentWindowObservedBucketCount: number;
  previousWindowCoverageRatio: number;
  recentWindowCoverageRatio: number;
  previousAccelerationWindowObservedBucketCount: number;
  recentAccelerationWindowObservedBucketCount: number;
  previousAccelerationWindowCoverageRatio: number;
  recentAccelerationWindowCoverageRatio: number;
  supportSignalCount: number;
  supportQualified: boolean;
  supportRatio: number;
  growthTrusted: boolean;
  accelerationTrusted: boolean;
  velocityTrusted: boolean;
  noveltyTrusted: boolean;
  attentionMetricTrusted: boolean;
  breakoutMomentumTrusted: boolean;
  growthTrustScore: number;
  accelerationTrustScore: number;
  velocityTrustScore: number;
  noveltyTrustScore: number;
  momentumTrustScore: number;
};

type TopicEnrichmentRow = {
  topicKey: string;
  rawLabel: string;
  status: "ok" | "mixed" | "insufficient_evidence" | "junk";
  canonicalName: string | null;
  aiDisplayName: string | null;
  fallbackLabel: string | null;
  nameStatus: TrendNameStatus;
  aiNameStatus: TrendNameStatus;
  nameSource: TrendNameSource;
  writerIdentity: string;
  writerRole: string;
  authoritativeWriter: boolean;
  shortDescription: string | null;
  contextParagraph: string | null;
  narrativeSummary: string | null;
  whyAttention: string | null;
  evidencePostIds: string[];
  keyEntities: string[];
  trendCategory: string | null;
  mixedSignals: string[];
  abstainReason: string | null;
  summaryConfidence: number;
  modelName: string | null;
  promptVersion: string | null;
  generatedAt: string | null;
  refreshedAt: string | null;
  aiNameGeneratedAt: string | null;
  aiNameRefreshedAt: string | null;
  aiNameSourceVersion: string | null;
  asOfWindowEnd: string | null;
};

type StableTopicClusterCandidate = {
  row: StableTopicDayTotalAggregateRow;
  enrichment: TopicEnrichmentRow | null;
  candidateLabels: string[];
  normalizedAliases: string[];
  compactAliases: string[];
  informativeTokens: string[];
  informativeTokenSet: Set<string>;
  mergeKeys: string[];
  anchorTokens: string[];
  fragmentLike: boolean;
  genericLike: boolean;
  temporalLike: boolean;
};

type StableTopicClusterMergeResult = {
  rows: StableTopicDayTotalAggregateRow[];
  enrichmentByTopicKey: Map<string, TopicEnrichmentRow>;
};

type StableClusterWindowTotalOverride = {
  topicKey: string;
  totalMentions: number;
  uniquePosts: number;
  uniqueAuthors: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  platformCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

type StableClusterTopicMapping = {
  clusterKey: string;
  rawTopicKey: string;
};

type SupabaseFreshnessProbeRow = {
  latestIngestionAt: string | null;
  latestProcessedAt: string | null;
  latestMentionEventAt: string | null;
  latestReadModelFinalizeAt: string | null;
  latestReadModelRollingWriteAt: string | null;
  latestReadModelSeriesWriteAt: string | null;
  latestReadModelWindowEndAt: string | null;
  latestSeriesNonZeroBucketAt: string | null;
  workerRunStartedAt: string | null;
  workerRunStatus: string | null;
  workerLastEventAt: string | null;
  workerRowsInserted: number | null;
  workerHeartbeatAt: string | null;
  workerCurrentStage: string | null;
  workerLastSuccessfulWriteAt: string | null;
  maxSourceTimestampSeen: string | null;
  maxWrittenTimestamp: string | null;
  maxProcessedTimestamp: string | null;
  maxAggregateTimestamp: string | null;
  pipelineLagSeconds: number | null;
  backlogSize: number | null;
  unprocessedBacklogSize: number | null;
};

const RANGE_CONFIG: Record<DateRangePreset, RangeConfig> = {
  "1h": { points: 12, bucketMinutes: 5 },
  "6h": { points: 72, bucketMinutes: 5 },
  "24h": { points: 288, bucketMinutes: 5 },
  "7d": { points: 336, bucketMinutes: 30 },
};

const TOPIC_SOURCE_VIEW = "v_topic_trends_1m";
const TOPIC_SOURCE_TABLE = "topic_buckets_1m";
const STABLE_TOPIC_BUCKETS_TABLE = "topic_buckets_1m_final";
const STABLE_TOPIC_ROLLING_TOTALS_TABLE = "topic_rolling_24h";
const STABLE_TOPIC_ROLLING_TOTALS_VIEW = "v_topic_leaderboard_rolling_24h";
const STABLE_TOPIC_DAY_SERIES_TABLE = "topic_day_series_5m";
const STABLE_TOPIC_DAY_SERIES_VIEW = "v_topic_series_day_5m";
const MAX_QUERY_ROWS = 50_000;
const PAGE_SIZE = 1_000;
const MAX_LEADERBOARD_ROWS = 250;
const STABLE_CANDIDATE_FETCH_LIMIT = readIntegerEnv(
  process.env.DASHBOARD_STABLE_CANDIDATE_LIMIT,
  750,
  MAX_LEADERBOARD_ROWS,
  2_000,
);
const STABLE_SUMMARY_SERIES_TOPIC_LIMIT = readIntegerEnv(
  process.env.DASHBOARD_STABLE_SUMMARY_SERIES_TOPIC_LIMIT ?? process.env.DASHBOARD_SERIES_TOPIC_LIMIT,
  MAX_LEADERBOARD_ROWS,
  25,
  STABLE_CANDIDATE_FETCH_LIMIT,
);
const STABLE_DETAIL_SERIES_TOPIC_LIMIT = readIntegerEnv(
  process.env.DASHBOARD_STABLE_DETAIL_SERIES_TOPIC_LIMIT ?? process.env.DASHBOARD_DETAIL_SERIES_TOPIC_LIMIT,
  300,
  25,
  STABLE_CANDIDATE_FETCH_LIMIT,
);
const FRESHNESS_PROBE_CACHE_TTL_MS = readIntegerEnv(
  process.env.DASHBOARD_FRESHNESS_PROBE_CACHE_MS,
  5_000,
  0,
  300_000,
);
const STABLE_WINDOW_TOTALS_MIN_MENTIONS = readIntegerEnv(
  process.env.DASHBOARD_STABLE_MIN_WINDOW_MENTIONS,
  1,
  1,
  25,
);
const STABLE_TOPIC_CONFIDENCE_FLOOR = 0.34;
const STABLE_FRESHNESS_SEED_MIN_MENTIONS = readIntegerEnv(
  process.env.DASHBOARD_STABLE_FRESHNESS_MIN_MENTIONS,
  8,
  1,
  100,
);
const STABLE_FRESHNESS_SEED_MIN_POSTS = readIntegerEnv(
  process.env.DASHBOARD_STABLE_FRESHNESS_MIN_POSTS,
  4,
  1,
  100,
);
const STABLE_FRESHNESS_SEED_MIN_AUTHORS = readIntegerEnv(
  process.env.DASHBOARD_STABLE_FRESHNESS_MIN_AUTHORS,
  3,
  1,
  100,
);
const STABLE_MOMENTUM_MIN_MENTIONS = readIntegerEnv(
  process.env.DASHBOARD_STABLE_MOMENTUM_MIN_MENTIONS,
  12,
  1,
  500,
);
const STABLE_MOMENTUM_MIN_POSTS = readIntegerEnv(
  process.env.DASHBOARD_STABLE_MOMENTUM_MIN_POSTS,
  5,
  1,
  500,
);
const STABLE_MOMENTUM_MIN_AUTHORS = readIntegerEnv(
  process.env.DASHBOARD_STABLE_MOMENTUM_MIN_AUTHORS,
  4,
  1,
  500,
);
const STABLE_MOMENTUM_MIN_OBSERVED_COVERAGE_PCT = readIntegerEnv(
  process.env.DASHBOARD_STABLE_MOMENTUM_MIN_OBSERVED_COVERAGE_PCT,
  50,
  1,
  100,
);
const STABLE_MOMENTUM_MIN_WINDOW_COVERAGE_PCT = readIntegerEnv(
  process.env.DASHBOARD_STABLE_MOMENTUM_MIN_WINDOW_COVERAGE_PCT,
  60,
  1,
  100,
);
const STABLE_MOMENTUM_MIN_ACCELERATION_WINDOW_COVERAGE_PCT = readIntegerEnv(
  process.env.DASHBOARD_STABLE_MOMENTUM_MIN_ACCELERATION_WINDOW_COVERAGE_PCT,
  60,
  1,
  100,
);
const STABLE_MOMENTUM_MIN_NON_ZERO_BUCKETS = readIntegerEnv(
  process.env.DASHBOARD_STABLE_MOMENTUM_MIN_NON_ZERO_BUCKETS,
  4,
  1,
  500,
);
const STABLE_WINDOW_TOTALS_LIMIT = STABLE_CANDIDATE_FETCH_LIMIT;
const STABLE_ROLLING_TOTALS_COLUMNS = [
  "topic_key",
  "topic_label",
  "platform_count",
  "total_mentions",
  "unique_posts",
  "unique_authors",
  "positive_count",
  "neutral_count",
  "negative_count",
  "first_seen_at",
  "last_seen_at",
  "window_end",
  "updated_at",
].join(",");
const STABLE_DAY_SERIES_COLUMNS = [
  "day",
  "bucket_5m",
  "topic_key",
  "topic_label",
  "interactions",
  "updated_at",
].join(",");
const TOPIC_ENRICHMENT_TABLE = "topic_ai_enrichments";
const TOPIC_ENRICHMENT_COLUMNS = [
  "topic_key",
  "as_of_window_end",
  "raw_label",
  "status",
  "canonical_name",
  "ai_display_name",
  "fallback_label",
  "name_status",
  "ai_name_status",
  "name_source",
  "short_description",
  "context_paragraph",
  "narrative_summary",
  "why_attention",
  "evidence_post_ids",
  "key_entities",
  "trend_category",
  "mixed_signals",
  "abstain_reason",
  "summary_confidence",
  "model_name",
  "prompt_version",
  "generated_at",
  "refreshed_at",
  "ai_name_generated_at",
  "ai_name_refreshed_at",
  "ai_name_source_version",
  "writer_identity",
  "writer_role",
  "authoritative_writer",
  "metadata_json",
].join(",");
const TOPIC_ENRICHMENT_LOOKBACK_HOURS = readIntegerEnv(
  process.env.TOPIC_ENRICHMENT_LOOKBACK_HOURS,
  24 * 14,
  1,
  24 * 30,
);
const TOPIC_ENRICHMENT_MAX_ROWS = readIntegerEnv(
  process.env.TOPIC_ENRICHMENT_MAX_ROWS,
  MAX_LEADERBOARD_ROWS * 8,
  MAX_LEADERBOARD_ROWS,
  MAX_LEADERBOARD_ROWS * 30,
);
const BLUESKY_WORKER_SOURCE = (() => {
  const value = (process.env.BLUESKY_WORKER_SOURCE ?? "bluesky_firehose_worker").trim();
  return value.length > 0 ? value : "bluesky_firehose_worker";
})();

let freshnessProbeCache: {
  value: SupabaseFreshnessProbeRow | null;
  expiresAt: number;
  inFlight: Promise<SupabaseFreshnessProbeRow | null> | null;
} = {
  value: null,
  expiresAt: 0,
  inFlight: null,
};

const MEME_SCOPE_TERMS = [
  "meme",
  "memecoin",
  "token",
  "coin",
  "crypto",
  "solana",
  "ethereum",
  "bitcoin",
  "doge",
  "pepe",
  "nft",
  "cashtag",
  "pump",
  "bullish",
  "bearish",
];

const STABLE_TOPIC_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const STABLE_TOPIC_GENERIC_TOKENS = new Set([
  "affairs",
  "alerts",
  "analysis",
  "article",
  "articles",
  "brief",
  "briefing",
  "briefings",
  "cluster",
  "clusters",
  "commentary",
  "content",
  "context",
  "conversation",
  "conversations",
  "coverage",
  "current",
  "daily",
  "debate",
  "debates",
  "detail",
  "details",
  "discussion",
  "discussions",
  "file",
  "files",
  "identification",
  "issue",
  "issues",
  "mixed",
  "narrative",
  "narratives",
  "news",
  "policy",
  "post",
  "posts",
  "public",
  "references",
  "related",
  "reports",
  "roundup",
  "scanner",
  "series",
  "signal",
  "signals",
  "story",
  "stories",
  "summary",
  "thread",
  "threads",
  "update",
  "updates",
]);

const STABLE_TOPIC_TEMPORAL_TOKENS = new Set([
  "apr",
  "april",
  "aug",
  "august",
  "day",
  "dec",
  "december",
  "feb",
  "february",
  "friday",
  "jan",
  "january",
  "jul",
  "july",
  "jun",
  "june",
  "mar",
  "march",
  "may",
  "monday",
  "month",
  "nov",
  "november",
  "oct",
  "october",
  "saturday",
  "sep",
  "sept",
  "september",
  "sunday",
  "thursday",
  "today",
  "tomorrow",
  "tuesday",
  "wednesday",
  "yesterday",
]);

const STABLE_TOPIC_FRAGMENT_PATTERNS = [
  /^(?:dear|hey|hi)\s+[a-z0-9]+(?:\s+[a-z0-9]+)?$/i,
  /^(?:need|needs)\s+(?:help|advice)\b/i,
  /^(?:official\s+(?:teaser|trailer))(?:\s+(?:trailer|video))?$/i,
  /^(?:only one)$/i,
  /^(?:published on)\b/i,
  /^(?:[a-z]?h?mouds|epublicans|itchen|niverse|onate|alaxy)$/i,
];

const STABLE_TOPIC_GENERIC_LABEL_PATTERNS = [
  /^(?:march|april|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i,
  /^(?:current affairs|mixed discussion cluster|public safety updates)$/i,
];

const STABLE_TOPIC_FRAGMENTARY_SUFFIX_PATTERN = /(?:apital|eneral|etting|hased|arket|tion|ment|ally|ized)$/i;
const STABLE_TOPIC_NARRATIVE_HINT_TOKENS = new Set([
  "appeals",
  "backlash",
  "campaign",
  "controversy",
  "criticism",
  "debate",
  "discourse",
  "escalation",
  "fallout",
  "holiday",
  "mentions",
  "mission",
  "policy",
  "reactions",
  "rhetoric",
  "speculation",
  "trial",
]);
const STABLE_TOPIC_LOW_SIGNAL_PROMPT_VERSIONS = new Set([
  "v1",
  "visible-title-v2",
]);

const PLATFORM_MAP: Record<string, PlatformId> = {
  bluesky: "bluesky",
  x: "x",
  twitter: "x",
  reddit: "reddit",
  telegram: "telegram",
  youtube: "youtube",
  tiktok: "tiktok",
  google: "google",
  news: "news",
};

function readBooleanEnv(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function readIntegerEnv(value: string | undefined, fallback: number, min: number, max: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function readStringValue(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value instanceof Date) {
    const timestamp = value.getTime();
    if (Number.isFinite(timestamp)) {
      return value.toISOString();
    }
    return "";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return "";
}

function pickFirstString(row: SupabaseTopicRow, keys: string[]) {
  for (const key of keys) {
    const value = readStringValue(row[key]);
    if (value.length > 0) {
      return value;
    }
  }
  return "";
}

function pickFirstNumber(row: SupabaseTopicRow, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return fallback;
}

function pickStringArray(row: SupabaseTopicRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) {
      return value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0);
    }
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(value: unknown) {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseOptionalInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return null;
}

function parseOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function normalizeTopic(topic: string) {
  const normalized = topic
    .replace(/\s+/g, " ")
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "")
    .trim();

  if (!normalized) {
    return "";
  }

  const isUppercaseAcronym = /^[A-Z0-9$#]{2,10}$/.test(normalized);
  if (isUppercaseAcronym) {
    return normalized;
  }

  return normalized
    .split(" ")
    .map((part) => {
      if (part.length <= 1) {
        return part.toUpperCase();
      }
      const lower = part.toLowerCase();
      return `${lower[0].toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

function isAllowedShortStableTopicToken(token: string) {
  return /^[A-Z0-9$#]{2,10}$/.test(token) || ["ai", "uk", "us", "eu", "ufo"].includes(token.toLowerCase());
}

function isReadableStableDisplayLabel(value: string | null | undefined) {
  const normalized = normalizeTopic(readStringValue(value));
  if (!normalized) {
    return false;
  }
  if (isFragmentLikeTopicLabel(normalized) || isGenericLikeTopicLabel(normalized) || isTemporalLikeTopicLabel(normalized)) {
    return false;
  }
  const compact = compactTopicIdentity(normalized);
  if (!compact) {
    return false;
  }
  if (STABLE_TOPIC_FRAGMENTARY_SUFFIX_PATTERN.test(compact)) {
    return false;
  }
  const tokens = getStableTopicLabelTokens(normalized);
  if (tokens.length === 0) {
    return false;
  }
  if (tokens.length === 1 && tokens[0].length <= 4 && !isAllowedShortStableTopicToken(tokens[0])) {
    return false;
  }
  return scoreStableClusterLabelCandidate(normalized) > 0;
}

function pickReadableStableDisplayLabel(...values: Array<string | null | undefined>) {
  return dedupeCaseInsensitive(values).find((value) => isReadableStableDisplayLabel(value)) ?? null;
}

function isNarrativeStableDisplayLabel(value: string | null | undefined) {
  const normalized = pickReadableStableDisplayLabel(value);
  if (!normalized) {
    return false;
  }
  const informativeTokens = getStableTopicInformativeTokens(normalized);
  const tokens = getStableTopicLabelTokens(normalized);
  if (tokens.some((token) => STABLE_TOPIC_NARRATIVE_HINT_TOKENS.has(token))) {
    return true;
  }
  const hasConnector = tokens.some((token) => STABLE_TOPIC_STOP_WORDS.has(token));
  const hasNarrativePunctuation = /[—–:-]/.test(readStringValue(value));
  return informativeTokens.length >= 3 && (hasConnector || hasNarrativePunctuation);
}

function pickNarrativeStableDisplayLabel(...values: Array<string | null | undefined>) {
  return dedupeCaseInsensitive(values).find((value) => isNarrativeStableDisplayLabel(value)) ?? null;
}

function normalizePlatform(value: unknown): PlatformId {
  const normalized = readStringValue(value).toLowerCase();
  if (normalized in PLATFORM_MAP) {
    return PLATFORM_MAP[normalized];
  }

  return "bluesky";
}

function toIsoMinute(value: unknown) {
  let timestamp = Number.NaN;
  if (value instanceof Date) {
    timestamp = value.getTime();
  } else if (typeof value === "number" && Number.isFinite(value)) {
    timestamp = value;
  } else {
    const raw = readStringValue(value);
    if (raw) {
      timestamp = Date.parse(raw);
    }
  }

  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const date = new Date(timestamp);
  date.setSeconds(0, 0);
  return date.toISOString();
}

function toIsoTimestamp(value: unknown) {
  let timestamp = Number.NaN;
  if (value instanceof Date) {
    timestamp = value.getTime();
  } else if (typeof value === "number" && Number.isFinite(value)) {
    timestamp = value;
  } else {
    const raw = readStringValue(value);
    if (raw) {
      timestamp = Date.parse(raw);
    }
  }

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function ageMinutesFromIso(isoTimestamp: string | null | undefined, nowMs: number) {
  const timestamp = isoTimestamp ? Date.parse(isoTimestamp) : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.max(0, Math.round((nowMs - timestamp) / 60_000));
}

function ageSecondsFromIso(isoTimestamp: string | null | undefined, nowMs: number) {
  const timestamp = isoTimestamp ? Date.parse(isoTimestamp) : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.max(0, Math.round((nowMs - timestamp) / 1000));
}

function resolveWorkerLastEventAt(notesValue: unknown) {
  const notes = parseJsonObject(notesValue);
  if (!notes) {
    return null;
  }

  const state = parseJsonObject(notes.state);
  const stateLastEventAt = toIsoTimestamp(state?.lastEventAt);
  if (stateLastEventAt) {
    return stateLastEventAt;
  }

  const noteLastEventAt = toIsoTimestamp(notes.lastEventAt);
  if (noteLastEventAt) {
    return noteLastEventAt;
  }

  return toIsoTimestamp(notes.updated_at);
}

function resolveWorkerIsoMetric(notesValue: unknown, key: string) {
  const notes = parseJsonObject(notesValue);
  if (!notes) {
    return null;
  }
  return toIsoTimestamp(notes[key]);
}

function resolveWorkerStringMetric(notesValue: unknown, key: string) {
  const notes = parseJsonObject(notesValue);
  if (!notes) {
    return null;
  }
  const value = readStringValue(notes[key]);
  return value || null;
}

function resolveWorkerNumberMetric(notesValue: unknown, key: string) {
  const notes = parseJsonObject(notesValue);
  if (!notes) {
    return null;
  }
  return parseOptionalNumber(notes[key]);
}

function maxIsoTimestampFrom(values: Array<string | null | undefined>) {
  let latest: string | null = null;
  let latestMs = Number.NaN;

  for (const value of values) {
    if (!value) {
      continue;
    }

    const timestampMs = Date.parse(value);
    if (!Number.isFinite(timestampMs)) {
      continue;
    }

    if (!Number.isFinite(latestMs) || timestampMs > latestMs) {
      latest = value;
      latestMs = timestampMs;
    }
  }

  return latest;
}

function resolveCanonicalSourceSnapshotAt(
  latestSourceAt: string | null,
  freshnessProbe: SupabaseFreshnessProbeRow | null,
) {
  return maxIsoTimestampFrom([
    latestSourceAt,
    freshnessProbe?.latestReadModelRollingWriteAt,
    freshnessProbe?.latestReadModelSeriesWriteAt,
    freshnessProbe?.latestReadModelFinalizeAt,
    freshnessProbe?.latestReadModelWindowEndAt,
  ]);
}

async function fetchSupabaseFreshnessProbeFromPostgres(): Promise<SupabaseFreshnessProbeRow | null> {
  const pool = getServerPostgresPool();
  const query = `
    WITH latest_run AS (
      SELECT
        started_at,
        status,
        rows_inserted,
        notes
      FROM public.ingestion_runs
      WHERE source = $1
      ORDER BY started_at DESC
      LIMIT 1
    )
    SELECT
      (SELECT MAX(ingested_at) FROM public.raw_posts)::timestamptz AS "latestIngestionAt",
      (SELECT MAX(processed_at) FROM public.processed_posts)::timestamptz AS "latestProcessedAt",
      (SELECT MAX(event_timestamp) FROM public.post_topic_mentions)::timestamptz AS "latestMentionEventAt",
      (SELECT last_finalize_before FROM public.topic_read_model_state WHERE id = 1)::timestamptz AS "latestReadModelFinalizeAt",
      (SELECT MAX(updated_at) FROM public.topic_rolling_24h)::timestamptz AS "latestReadModelRollingWriteAt",
      (SELECT MAX(updated_at) FROM public.topic_day_series_5m)::timestamptz AS "latestReadModelSeriesWriteAt",
      (SELECT MAX(window_end) FROM public.topic_rolling_24h)::timestamptz AS "latestReadModelWindowEndAt",
      (SELECT MAX(bucket_5m) FROM public.topic_day_series_5m WHERE interactions > 0)::timestamptz AS "latestSeriesNonZeroBucketAt",
      (SELECT started_at FROM latest_run)::timestamptz AS "workerRunStartedAt",
      (SELECT status FROM latest_run)::text AS "workerRunStatus",
      (SELECT rows_inserted FROM latest_run)::bigint AS "workerRowsInserted",
      (SELECT notes FROM latest_run) AS "workerRunNotes"
  `;
  const result = await pool.query<Record<string, unknown>>(query, [BLUESKY_WORKER_SOURCE]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const workerRunStatusRaw = readStringValue(row.workerRunStatus);

  return {
    latestIngestionAt: toIsoTimestamp(row.latestIngestionAt),
    latestProcessedAt: toIsoTimestamp(row.latestProcessedAt),
    latestMentionEventAt: toIsoTimestamp(row.latestMentionEventAt),
    latestReadModelFinalizeAt: toIsoTimestamp(row.latestReadModelFinalizeAt),
    latestReadModelRollingWriteAt: toIsoTimestamp(row.latestReadModelRollingWriteAt),
    latestReadModelSeriesWriteAt: toIsoTimestamp(row.latestReadModelSeriesWriteAt),
    latestReadModelWindowEndAt: toIsoTimestamp(row.latestReadModelWindowEndAt),
    latestSeriesNonZeroBucketAt: toIsoTimestamp(row.latestSeriesNonZeroBucketAt),
    workerRunStartedAt: toIsoTimestamp(row.workerRunStartedAt),
    workerRunStatus: workerRunStatusRaw || null,
    workerLastEventAt: resolveWorkerLastEventAt(row.workerRunNotes),
    workerRowsInserted: parseOptionalInteger(row.workerRowsInserted),
    workerHeartbeatAt: resolveWorkerIsoMetric(row.workerRunNotes, "last_heartbeat_at"),
    workerCurrentStage: resolveWorkerStringMetric(row.workerRunNotes, "current_stage"),
    workerLastSuccessfulWriteAt: resolveWorkerIsoMetric(
      row.workerRunNotes,
      "last_successful_write_at",
    ),
    maxSourceTimestampSeen: resolveWorkerIsoMetric(row.workerRunNotes, "max_source_timestamp_seen"),
    maxWrittenTimestamp: resolveWorkerIsoMetric(row.workerRunNotes, "max_written_timestamp"),
    maxProcessedTimestamp: resolveWorkerIsoMetric(row.workerRunNotes, "max_processed_timestamp"),
    maxAggregateTimestamp: resolveWorkerIsoMetric(row.workerRunNotes, "max_aggregate_timestamp"),
    pipelineLagSeconds: parseOptionalInteger(resolveWorkerNumberMetric(row.workerRunNotes, "pipeline_lag_seconds")),
    backlogSize: parseOptionalInteger(resolveWorkerNumberMetric(row.workerRunNotes, "backlog_size")),
    unprocessedBacklogSize: parseOptionalInteger(
      resolveWorkerNumberMetric(row.workerRunNotes, "unprocessed_backlog_size"),
    ),
  };
}

async function fetchSupabaseFreshnessProbeFromSupabase(): Promise<SupabaseFreshnessProbeRow | null> {
  const client = getSupabaseServerClient();
  const safeHead = async (fn: () => Promise<string | null>) => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };
  const latestIngestionAt = await safeHead(async () => {
    const { data, error } = await client
      .from("raw_posts")
      .select("ingested_at")
      .order("ingested_at", { ascending: false })
      .limit(1);
    if (error) {
      throw error;
    }
    return toIsoTimestamp(data?.[0]?.ingested_at ?? null);
  });
  const latestProcessedAt = await safeHead(async () => {
    const { data, error } = await client
      .from("processed_posts")
      .select("processed_at")
      .order("processed_at", { ascending: false })
      .limit(1);
    if (error) {
      throw error;
    }
    return toIsoTimestamp(data?.[0]?.processed_at ?? null);
  });
  const latestMentionEventAt = await safeHead(async () => {
    const { data, error } = await client
      .from("post_topic_mentions")
      .select("event_timestamp")
      .order("event_timestamp", { ascending: false })
      .limit(1);
    if (error) {
      throw error;
    }
    return toIsoTimestamp(data?.[0]?.event_timestamp ?? null);
  });
  const latestReadModelFinalizeAt = await safeHead(async () => {
    const { data, error } = await client
      .from("topic_read_model_state")
      .select("last_finalize_before")
      .eq("id", 1)
      .limit(1);
    if (error) {
      throw error;
    }
    return toIsoTimestamp(data?.[0]?.last_finalize_before ?? null);
  });
  const latestReadModelRollingWriteAt = await safeHead(async () => {
    const { data, error } = await client
      .from("topic_rolling_24h")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) {
      throw error;
    }
    return toIsoTimestamp(data?.[0]?.updated_at ?? null);
  });
  const latestReadModelSeriesWriteAt = await safeHead(async () => {
    const { data, error } = await client
      .from("topic_day_series_5m")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) {
      throw error;
    }
    return toIsoTimestamp(data?.[0]?.updated_at ?? null);
  });
  const latestReadModelWindowEndAt = await safeHead(async () => {
    const { data, error } = await client
      .from("topic_rolling_24h")
      .select("window_end")
      .order("window_end", { ascending: false })
      .limit(1);
    if (error) {
      throw error;
    }
    return toIsoTimestamp(data?.[0]?.window_end ?? null);
  });
  const latestSeriesNonZeroBucketAt = await safeHead(async () => {
    const { data, error } = await client
      .from("topic_day_series_5m")
      .select("bucket_5m")
      .gt("interactions", 0)
      .order("bucket_5m", { ascending: false })
      .limit(1);
    if (error) {
      throw error;
    }
    return toIsoTimestamp(data?.[0]?.bucket_5m ?? null);
  });
  const latestWorkerRun = await (async () => {
    try {
      const { data, error } = await client
        .from("ingestion_runs")
        .select("started_at,status,rows_inserted,notes")
        .eq("source", BLUESKY_WORKER_SOURCE)
        .order("started_at", { ascending: false })
        .limit(1);

      if (error) {
        throw error;
      }

      return data?.[0] ?? null;
    } catch {
      return null;
    }
  })();
  const workerRunStatusRaw = readStringValue(latestWorkerRun?.status);

  return {
    latestIngestionAt,
    latestProcessedAt,
    latestMentionEventAt,
    latestReadModelFinalizeAt,
    latestReadModelRollingWriteAt,
    latestReadModelSeriesWriteAt,
    latestReadModelWindowEndAt,
    latestSeriesNonZeroBucketAt,
    workerRunStartedAt: toIsoTimestamp(latestWorkerRun?.started_at ?? null),
    workerRunStatus: workerRunStatusRaw || null,
    workerLastEventAt: resolveWorkerLastEventAt(latestWorkerRun?.notes ?? null),
    workerRowsInserted: parseOptionalInteger(latestWorkerRun?.rows_inserted ?? null),
    workerHeartbeatAt: resolveWorkerIsoMetric(latestWorkerRun?.notes ?? null, "last_heartbeat_at"),
    workerCurrentStage: resolveWorkerStringMetric(latestWorkerRun?.notes ?? null, "current_stage"),
    workerLastSuccessfulWriteAt: resolveWorkerIsoMetric(
      latestWorkerRun?.notes ?? null,
      "last_successful_write_at",
    ),
    maxSourceTimestampSeen: resolveWorkerIsoMetric(
      latestWorkerRun?.notes ?? null,
      "max_source_timestamp_seen",
    ),
    maxWrittenTimestamp: resolveWorkerIsoMetric(latestWorkerRun?.notes ?? null, "max_written_timestamp"),
    maxProcessedTimestamp: resolveWorkerIsoMetric(
      latestWorkerRun?.notes ?? null,
      "max_processed_timestamp",
    ),
    maxAggregateTimestamp: resolveWorkerIsoMetric(
      latestWorkerRun?.notes ?? null,
      "max_aggregate_timestamp",
    ),
    pipelineLagSeconds: parseOptionalInteger(
      resolveWorkerNumberMetric(latestWorkerRun?.notes ?? null, "pipeline_lag_seconds"),
    ),
    backlogSize: parseOptionalInteger(
      resolveWorkerNumberMetric(latestWorkerRun?.notes ?? null, "backlog_size"),
    ),
    unprocessedBacklogSize: parseOptionalInteger(
      resolveWorkerNumberMetric(latestWorkerRun?.notes ?? null, "unprocessed_backlog_size"),
    ),
  };
}

async function fetchSupabaseFreshnessProbe() {
  const now = Date.now();
  if (FRESHNESS_PROBE_CACHE_TTL_MS > 0 && freshnessProbeCache.expiresAt > now) {
    return freshnessProbeCache.value;
  }

  if (FRESHNESS_PROBE_CACHE_TTL_MS > 0 && freshnessProbeCache.inFlight) {
    return freshnessProbeCache.inFlight;
  }

  const probePromise = (async () => {
    try {
      if (hasDatabaseUrl()) {
        return await fetchSupabaseFreshnessProbeFromPostgres();
      }
      if (hasSupabaseServerCredentials()) {
        return await fetchSupabaseFreshnessProbeFromSupabase();
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[supabase-trends] freshness probe failed", { error });
      }
    }

    return null;
  })();

  if (FRESHNESS_PROBE_CACHE_TTL_MS <= 0) {
    return probePromise;
  }

  freshnessProbeCache = {
    ...freshnessProbeCache,
    inFlight: probePromise,
  };

  const value = await probePromise;
  freshnessProbeCache = {
    value,
    expiresAt: Date.now() + FRESHNESS_PROBE_CACHE_TTL_MS,
    inFlight: null,
  };

  return value;
}

function floorToBucket(date: Date, bucketMinutes: number) {
  const ms = date.getTime();
  const bucketMs = bucketMinutes * 60_000;
  return new Date(Math.floor(ms / bucketMs) * bucketMs);
}

function bucketKeyForIso(isoTimestamp: string, bucketMinutes: number) {
  const timestamp = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const bucketMs = bucketMinutes * 60_000;
  return new Date(Math.floor(timestamp / bucketMs) * bucketMs).toISOString();
}

function buildWindowBuckets(range: DateRangePreset, now = new Date()) {
  const config = RANGE_CONFIG[range];
  const bucketMs = config.bucketMinutes * 60_000;
  const windowEnd = floorToBucket(now, config.bucketMinutes);
  const windowStart = new Date(windowEnd.getTime() - (config.points - 1) * bucketMs);

  const buckets = Array.from({ length: config.points }, (_, index) => {
    return new Date(windowStart.getTime() + index * bucketMs).toISOString();
  });

  return {
    bucketMinutes: config.bucketMinutes,
    bucketMs,
    windowStart,
    windowEnd,
    buckets,
  };
}

function buildWindowDayIsos(windowStart: Date, windowEnd: Date) {
  const startDayMs = Date.UTC(
    windowStart.getUTCFullYear(),
    windowStart.getUTCMonth(),
    windowStart.getUTCDate(),
  );
  const endDayMs = Date.UTC(
    windowEnd.getUTCFullYear(),
    windowEnd.getUTCMonth(),
    windowEnd.getUTCDate(),
  );
  const dayMs = 24 * 60 * 60 * 1_000;
  const days: string[] = [];

  for (let cursor = startDayMs; cursor <= endDayMs; cursor += dayMs) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }

  return days;
}

function isSupabaseMissingRelation(error: PostgrestError | null) {
  if (!error) {
    return false;
  }

  const message = `${error.message} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("relation") ||
    error.code === "42P01"
  );
}

function isPostgresMissingRelation(error: unknown) {
  const databaseError = error as { code?: string; message?: string };
  const message = String(databaseError?.message ?? "").toLowerCase();
  return databaseError?.code === "42P01" || message.includes("does not exist");
}

function isSupabaseMissingStructure(error: PostgrestError | null) {
  if (!error) {
    return false;
  }

  const message = `${error.message} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return (
    isSupabaseMissingRelation(error) ||
    error.code === "42703" ||
    message.includes("column") ||
    message.includes("schema cache")
  );
}

function isPostgresMissingStructure(error: unknown) {
  const databaseError = error as { code?: string; message?: string };
  const message = String(databaseError?.message ?? "").toLowerCase();
  return (
    isPostgresMissingRelation(error) ||
    databaseError?.code === "42703" ||
    message.includes("column")
  );
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length === 0) {
    return items.length > 0 ? [items] : [];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchRowsWithBucketColumn(params: {
  source: string;
  bucketColumn: string;
  windowStartIso: string;
  windowEndIso: string;
}) {
  const client = getSupabaseServerClient();
  const rows: SupabaseTopicRow[] = [];

  for (let offset = 0; offset < MAX_QUERY_ROWS; offset += PAGE_SIZE) {
    const end = offset + PAGE_SIZE - 1;
    const { data, error } = await client
      .from(params.source)
      .select("*")
      .gte(params.bucketColumn, params.windowStartIso)
      .lte(params.bucketColumn, params.windowEndIso)
      .order(params.bucketColumn, { ascending: true })
      .range(offset, end);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(...data);

    if (data.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

async function fetchTopicRowsFromSupabaseSource(
  source: string,
  windowStartIso: string,
  windowEndIso: string,
) {
  const bucketColumns = ["bucket_minute", "bucket_start", "minute_bucket"];
  const attemptErrors: PostgrestError[] = [];

  for (const bucketColumn of bucketColumns) {
    try {
      return await fetchRowsWithBucketColumn({
        source,
        bucketColumn,
        windowStartIso,
        windowEndIso,
      });
    } catch (error) {
      const pgError = error as PostgrestError;
      attemptErrors.push(pgError);
      if (!isSupabaseMissingRelation(pgError)) {
        throw error;
      }
    }
  }

  throw attemptErrors.at(-1) ?? new Error(`Unable to query ${source}`);
}

async function resolveBucketColumnFromPostgres(pool: Pool, source: string) {
  const columnQuery = await pool.query<{
    column_name: string;
  }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
    `,
    [source],
  );

  if (columnQuery.rows.length === 0) {
    const error = new Error(`Relation public.${source} not found`);
    (error as Error & { code?: string }).code = "42P01";
    throw error;
  }

  const columns = new Set(columnQuery.rows.map((row) => row.column_name));
  const candidates = ["bucket_minute", "bucket_start", "minute_bucket", "created_at"];
  const resolved = candidates.find((name) => columns.has(name));
  if (!resolved) {
    throw new Error(`No supported bucket column found on public.${source}`);
  }

  return resolved;
}

async function fetchTopicRowsFromPostgresSource(
  source: string,
  windowStartIso: string,
  windowEndIso: string,
) {
  const pool = getServerPostgresPool();
  const bucketColumn = await resolveBucketColumnFromPostgres(pool, source);
  const query = `
    SELECT *
    FROM public.${source}
    WHERE ${bucketColumn} >= $1::timestamptz
      AND ${bucketColumn} <= $2::timestamptz
    ORDER BY ${bucketColumn} ASC
    LIMIT $3
  `;
  const result = await pool.query<Record<string, unknown>>(query, [
    windowStartIso,
    windowEndIso,
    MAX_QUERY_ROWS,
  ]);
  return result.rows as SupabaseTopicRow[];
}

async function fetchTopicRows(windowStartIso: string, windowEndIso: string) {
  if (hasDatabaseUrl()) {
    try {
      const rows = await fetchTopicRowsFromPostgresSource(
        TOPIC_SOURCE_TABLE,
        windowStartIso,
        windowEndIso,
      );
      return {
        rows,
        source: TOPIC_SOURCE_TABLE,
      };
    } catch (error) {
      if (!isPostgresMissingRelation(error)) {
        throw error;
      }
    }

    const rows = await fetchTopicRowsFromPostgresSource(
      TOPIC_SOURCE_VIEW,
      windowStartIso,
      windowEndIso,
    );
    return {
      rows,
      source: TOPIC_SOURCE_VIEW,
    };
  }

  if (hasSupabaseServerCredentials()) {
    try {
      const rows = await fetchTopicRowsFromSupabaseSource(
        TOPIC_SOURCE_TABLE,
        windowStartIso,
        windowEndIso,
      );
      return {
        rows,
        source: TOPIC_SOURCE_TABLE,
      };
    } catch (error) {
      const pgError = error as PostgrestError;
      if (!isSupabaseMissingRelation(pgError)) {
        throw error;
      }
    }

    const rows = await fetchTopicRowsFromSupabaseSource(
      TOPIC_SOURCE_VIEW,
      windowStartIso,
      windowEndIso,
    );
    return {
      rows,
      source: TOPIC_SOURCE_VIEW,
    };
  }

  throw new Error(
    "No Supabase trend query credentials available. Set SUPABASE_SERVICE_ROLE_KEY (+ SUPABASE_URL) or DATABASE_URL.",
  );
}

async function fetchStableRollingTotalsFromSupabaseSource(source: string) {
  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from(source)
    .select(STABLE_ROLLING_TOTALS_COLUMNS)
    .order("total_mentions", { ascending: false })
    .order("topic_key", { ascending: true })
    .limit(STABLE_WINDOW_TOTALS_LIMIT);

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as SupabaseTopicRow[];
}

async function fetchStableRollingTotalsFromPostgresSource(source: string) {
  const pool = getServerPostgresPool();
  const query = `
    SELECT
      topic_key,
      topic_label,
      platform_count,
      total_mentions,
      unique_posts,
      unique_authors,
      positive_count,
      neutral_count,
      negative_count,
      first_seen_at,
      last_seen_at,
      window_end,
      updated_at
    FROM public.${source}
    ORDER BY total_mentions DESC, topic_key ASC
    LIMIT $1
  `;
  const result = await pool.query<Record<string, unknown>>(query, [STABLE_WINDOW_TOTALS_LIMIT]);
  return result.rows as SupabaseTopicRow[];
}

async function fetchStableRollingTotals() {
  if (hasDatabaseUrl()) {
    let lastError: unknown = null;
    for (const source of [STABLE_TOPIC_ROLLING_TOTALS_TABLE, STABLE_TOPIC_ROLLING_TOTALS_VIEW]) {
      try {
        return {
          rows: await fetchStableRollingTotalsFromPostgresSource(source),
          source,
        };
      } catch (error) {
        if (!isPostgresMissingStructure(error)) {
          throw error;
        }
        lastError = error;
      }
    }
    if (lastError) {
      throw lastError;
    }
  }

  if (hasSupabaseServerCredentials()) {
    let lastError: PostgrestError | null = null;
    for (const source of [STABLE_TOPIC_ROLLING_TOTALS_TABLE, STABLE_TOPIC_ROLLING_TOTALS_VIEW]) {
      try {
        return {
          rows: await fetchStableRollingTotalsFromSupabaseSource(source),
          source,
        };
      } catch (error) {
        const pgError = error as PostgrestError;
        if (!isSupabaseMissingStructure(pgError)) {
          throw error;
        }
        lastError = pgError;
      }
    }
    if (lastError) {
      throw lastError;
    }
  }

  throw new Error(
    "Stable rolling 24h source not found. Create topic_rolling_24h or v_topic_leaderboard_rolling_24h.",
  );
}

function parseStableBucketRow(row: SupabaseTopicRow): StableTopicBucketRow | null {
  const bucketMinute = toIsoMinute(row.bucket_minute ?? row.bucket_start ?? row.minute_bucket);
  const topicKey = readStringValue(row.topic_key ?? row.normalized_topic ?? row.topic);
  if (!bucketMinute || !topicKey) {
    return null;
  }

  return {
    bucketMinute,
    platform: normalizePlatform(row.platform),
    topicKey,
    mentionCount: Math.max(0, pickFirstNumber(row, ["mention_count", "total_mentions", "interactions"], 0)),
    uniquePosts: Math.max(0, pickFirstNumber(row, ["unique_posts", "post_count"], 0)),
    uniqueAuthors: Math.max(0, pickFirstNumber(row, ["unique_authors", "author_count"], 0)),
    positiveCount: Math.max(0, pickFirstNumber(row, ["positive_count"], 0)),
    neutralCount: Math.max(0, pickFirstNumber(row, ["neutral_count"], 0)),
    negativeCount: Math.max(0, pickFirstNumber(row, ["negative_count"], 0)),
    avgTopicConfidence: Math.max(0, pickFirstNumber(row, ["avg_topic_confidence"], 0)),
    updatedAt: toIsoTimestamp(row.finalized_at ?? row.updated_at ?? row.bucket_minute ?? row.bucket_start),
  };
}

function aggregateStableWindowTotalsFromBucketRows(
  rows: SupabaseTopicRow[],
  windowEndIso: string,
  limit: number,
) {
  const aggregates = new Map<
    string,
    {
      topicKey: string;
      totalMentions: number;
      uniquePosts: number;
      uniqueAuthors: number;
      positiveCount: number;
      neutralCount: number;
      negativeCount: number;
      platforms: Set<PlatformId>;
      confidenceWeightedTotal: number;
      confidenceWeight: number;
      firstSeenAt: string | null;
      lastSeenAt: string | null;
      updatedAt: string | null;
    }
  >();

  for (const row of rows) {
    const parsed = parseStableBucketRow(row);
    if (!parsed || parsed.mentionCount <= 0) {
      continue;
    }

    const current = aggregates.get(parsed.topicKey);
    if (current) {
      current.totalMentions += parsed.mentionCount;
      current.uniquePosts += parsed.uniquePosts;
      current.uniqueAuthors += parsed.uniqueAuthors;
      current.positiveCount += parsed.positiveCount;
      current.neutralCount += parsed.neutralCount;
      current.negativeCount += parsed.negativeCount;
      current.platforms.add(parsed.platform);
      current.confidenceWeightedTotal += parsed.avgTopicConfidence * parsed.mentionCount;
      current.confidenceWeight += parsed.mentionCount;
      current.firstSeenAt = minIsoTimestamp(current.firstSeenAt, parsed.bucketMinute);
      current.lastSeenAt = maxIsoTimestamp(current.lastSeenAt, parsed.bucketMinute);
      current.updatedAt = maxIsoTimestamp(current.updatedAt, parsed.updatedAt);
      continue;
    }

    aggregates.set(parsed.topicKey, {
      topicKey: parsed.topicKey,
      totalMentions: parsed.mentionCount,
      uniquePosts: parsed.uniquePosts,
      uniqueAuthors: parsed.uniqueAuthors,
      positiveCount: parsed.positiveCount,
      neutralCount: parsed.neutralCount,
      negativeCount: parsed.negativeCount,
      platforms: new Set([parsed.platform]),
      confidenceWeightedTotal: parsed.avgTopicConfidence * parsed.mentionCount,
      confidenceWeight: parsed.mentionCount,
      firstSeenAt: parsed.bucketMinute,
      lastSeenAt: parsed.bucketMinute,
      updatedAt: parsed.updatedAt,
    });
  }

  return [...aggregates.values()]
    .filter((row) => row.totalMentions >= STABLE_WINDOW_TOTALS_MIN_MENTIONS)
    .sort((left, right) => {
      if (right.totalMentions !== left.totalMentions) {
        return right.totalMentions - left.totalMentions;
      }
      if (right.uniquePosts !== left.uniquePosts) {
        return right.uniquePosts - left.uniquePosts;
      }
      if (right.uniqueAuthors !== left.uniqueAuthors) {
        return right.uniqueAuthors - left.uniqueAuthors;
      }
      return left.topicKey.localeCompare(right.topicKey);
    })
    .slice(0, limit)
    .map((row) => ({
      topic_key: row.topicKey,
      topic_label: normalizeTopic(row.topicKey) || row.topicKey,
      platform_count: row.platforms.size,
      total_mentions: row.totalMentions,
      unique_posts: row.uniquePosts,
      unique_authors: row.uniqueAuthors,
      positive_count: row.positiveCount,
      neutral_count: row.neutralCount,
      negative_count: row.negativeCount,
      avg_topic_confidence:
        row.confidenceWeight > 0 ? row.confidenceWeightedTotal / row.confidenceWeight : 0,
      first_seen_at: row.firstSeenAt,
      last_seen_at: row.lastSeenAt,
      window_end: windowEndIso,
      updated_at: row.updatedAt ?? row.lastSeenAt ?? windowEndIso,
    } satisfies SupabaseTopicRow));
}

async function fetchStableWindowTotalsFromSupabaseSource(
  windowStartIso: string,
  windowEndIso: string,
  limit: number,
) {
  const rows = await fetchRowsWithBucketColumn({
    source: STABLE_TOPIC_BUCKETS_TABLE,
    bucketColumn: "bucket_minute",
    windowStartIso,
    windowEndIso,
  });
  return aggregateStableWindowTotalsFromBucketRows(rows, windowEndIso, limit);
}

async function fetchStableWindowTotalsFromPostgresSource(
  windowStartIso: string,
  windowEndIso: string,
  limit: number,
) {
  const pool = getServerPostgresPool();
  const query = `
    WITH mention_labels AS (
      SELECT topic_key, topic_label
      FROM (
        SELECT
          m.topic_key,
          NULLIF(BTRIM(m.topic_label), '') AS topic_label,
          ROW_NUMBER() OVER (
            PARTITION BY m.topic_key
            ORDER BY COUNT(*) DESC, LENGTH(NULLIF(BTRIM(m.topic_label), '')) DESC, NULLIF(BTRIM(m.topic_label), '') ASC
          ) AS label_rank
        FROM public.post_topic_mentions m
        WHERE m.event_timestamp >= $1::timestamptz
          AND m.event_timestamp <= $2::timestamptz
          AND COALESCE(m.topic_confidence, 0) >= $3::double precision
          AND NULLIF(BTRIM(m.topic_label), '') IS NOT NULL
        GROUP BY m.topic_key, NULLIF(BTRIM(m.topic_label), '')
      ) ranked
      WHERE label_rank = 1
    )
    SELECT
      b.topic_key,
      COALESCE(t.canonical_label, ml.topic_label, INITCAP(b.topic_key)) AS topic_label,
      COUNT(DISTINCT b.platform)::int AS platform_count,
      SUM(b.mention_count)::int AS total_mentions,
      SUM(b.unique_posts)::int AS unique_posts,
      SUM(b.unique_authors)::int AS unique_authors,
      SUM(b.positive_count)::int AS positive_count,
      SUM(b.neutral_count)::int AS neutral_count,
      SUM(b.negative_count)::int AS negative_count,
      MIN(b.bucket_minute)::timestamptz AS first_seen_at,
      MAX(b.bucket_minute)::timestamptz AS last_seen_at,
      $2::timestamptz AS window_end,
      MAX(b.finalized_at)::timestamptz AS updated_at
    FROM public.${STABLE_TOPIC_BUCKETS_TABLE} b
    LEFT JOIN public.topics t
      ON t.topic_key = b.topic_key
    LEFT JOIN mention_labels ml
      ON ml.topic_key = b.topic_key
    WHERE b.bucket_minute >= $1::timestamptz
      AND b.bucket_minute <= $2::timestamptz
    GROUP BY b.topic_key, COALESCE(t.canonical_label, ml.topic_label, INITCAP(b.topic_key))
    HAVING SUM(b.mention_count) >= $4::int
    ORDER BY total_mentions DESC, unique_posts DESC, unique_authors DESC, b.topic_key ASC
    LIMIT $5::int
  `;
  const result = await pool.query<Record<string, unknown>>(query, [
    windowStartIso,
    windowEndIso,
    STABLE_TOPIC_CONFIDENCE_FLOOR,
    STABLE_WINDOW_TOTALS_MIN_MENTIONS,
    limit,
  ]);
  return result.rows as SupabaseTopicRow[];
}

async function fetchStableWindowTotals(windowStartIso: string, windowEndIso: string) {
  if (hasDatabaseUrl()) {
    try {
      return {
        rows: await fetchStableWindowTotalsFromPostgresSource(
          windowStartIso,
          windowEndIso,
          STABLE_WINDOW_TOTALS_LIMIT,
        ),
        source: `${STABLE_TOPIC_BUCKETS_TABLE}:postgres_window`,
      };
    } catch (error) {
      if (!isPostgresMissingStructure(error)) {
        throw error;
      }
    }
  }

  if (hasSupabaseServerCredentials()) {
    try {
      return {
        rows: await fetchStableWindowTotalsFromSupabaseSource(
          windowStartIso,
          windowEndIso,
          STABLE_WINDOW_TOTALS_LIMIT,
        ),
        source: `${STABLE_TOPIC_BUCKETS_TABLE}:supabase_window`,
      };
    } catch (error) {
      const pgError = error as PostgrestError;
      if (!isSupabaseMissingStructure(pgError)) {
        throw error;
      }
    }
  }

  return fetchStableRollingTotals();
}

async function fetchStableDaySeriesFromSupabaseSource(
  source: string,
  dayIso: string,
  windowStartIso: string,
  windowEndIso: string,
  topicKeys: string[],
) {
  if (topicKeys.length === 0) {
    return [] as SupabaseTopicRow[];
  }

  const client = getSupabaseServerClient();
  const rows: SupabaseTopicRow[] = [];
  const keyChunks = chunkArray(topicKeys, 75);

  for (const topicKeyChunk of keyChunks) {
    const { data, error } = await client
      .from(source)
      .select(STABLE_DAY_SERIES_COLUMNS)
      .eq("day", dayIso)
      .gte("bucket_5m", windowStartIso)
      .lte("bucket_5m", windowEndIso)
      .in("topic_key", topicKeyChunk)
      .order("bucket_5m", { ascending: true })
      .range(0, MAX_QUERY_ROWS - 1);

    if (error) {
      throw error;
    }

    if (data && data.length > 0) {
      rows.push(...(data as unknown as SupabaseTopicRow[]));
    }
  }

  return rows;
}

async function fetchStableDaySeriesFromPostgresSource(
  source: string,
  dayIso: string,
  windowStartIso: string,
  windowEndIso: string,
  topicKeys: string[],
) {
  if (topicKeys.length === 0) {
    return [] as SupabaseTopicRow[];
  }

  const pool = getServerPostgresPool();
  const rows: SupabaseTopicRow[] = [];
  const keyChunks = chunkArray(topicKeys, 75);

  for (const topicKeyChunk of keyChunks) {
    const query = `
      SELECT
        day,
        bucket_5m,
        topic_key,
        topic_label,
        interactions,
        updated_at
      FROM public.${source}
      WHERE day = $1::date
        AND bucket_5m >= $2::timestamptz
        AND bucket_5m <= $3::timestamptz
        AND topic_key = ANY($4::text[])
      ORDER BY bucket_5m ASC
    `;
    const result = await pool.query<Record<string, unknown>>(query, [
      dayIso,
      windowStartIso,
      windowEndIso,
      topicKeyChunk,
    ]);
    if (result.rows.length > 0) {
      rows.push(...(result.rows as SupabaseTopicRow[]));
    }
  }

  return rows;
}

async function fetchStableDaySeries(
  dayIso: string,
  windowStartIso: string,
  windowEndIso: string,
  topicKeys: string[],
) {
  const sources = [STABLE_TOPIC_DAY_SERIES_TABLE, STABLE_TOPIC_DAY_SERIES_VIEW];
  if (hasDatabaseUrl()) {
    let lastError: unknown = null;
    for (const source of sources) {
      try {
        return {
          rows: await fetchStableDaySeriesFromPostgresSource(
            source,
            dayIso,
            windowStartIso,
            windowEndIso,
            topicKeys,
          ),
          source,
        };
      } catch (error) {
        if (!isPostgresMissingStructure(error)) {
          throw error;
        }
        lastError = error;
      }
    }
    if (lastError) {
      throw lastError;
    }
  }

  if (hasSupabaseServerCredentials()) {
    let lastError: PostgrestError | null = null;
    for (const source of sources) {
      try {
        return {
          rows: await fetchStableDaySeriesFromSupabaseSource(
            source,
            dayIso,
            windowStartIso,
            windowEndIso,
            topicKeys,
          ),
          source,
        };
      } catch (error) {
        const pgError = error as PostgrestError;
        if (!isSupabaseMissingStructure(pgError)) {
          throw error;
        }
        lastError = pgError;
      }
    }
    if (lastError) {
      throw lastError;
    }
  }

  throw new Error(
    "Stable topic day series source not found. Create topic_day_series_5m or v_topic_series_day_5m.",
  );
}

function buildStableClusterTopicMappings(rows: StableTopicDayTotalAggregateRow[]) {
  const seen = new Set<string>();
  const mappings: StableClusterTopicMapping[] = [];

  for (const row of rows) {
    const clusterKey = readStringValue(row.topicKey);
    if (!clusterKey) {
      continue;
    }

    for (const rawTopicKey of row.sourceTopicKeys) {
      const normalizedRawTopicKey = readStringValue(rawTopicKey);
      if (!normalizedRawTopicKey) {
        continue;
      }

      const dedupeKey = `${clusterKey}::${normalizedRawTopicKey}`;
      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      mappings.push({
        clusterKey,
        rawTopicKey: normalizedRawTopicKey,
      });
    }
  }

  return mappings;
}

function parseStableClusterWindowTotalOverride(row: SupabaseTopicRow): StableClusterWindowTotalOverride | null {
  const topicKey = readStringValue(row.topic_key ?? row.cluster_key);
  if (!topicKey) {
    return null;
  }

  return {
    topicKey,
    totalMentions: Math.max(
      0,
      pickFirstNumber(row, ["total_mentions", "mention_count", "mentions", "unique_posts"], 0),
    ),
    uniquePosts: Math.max(0, pickFirstNumber(row, ["unique_posts", "post_count", "roots_count"], 0)),
    uniqueAuthors: Math.max(0, pickFirstNumber(row, ["unique_authors", "author_count"], 0)),
    positiveCount: Math.max(0, pickFirstNumber(row, ["positive_count"], 0)),
    neutralCount: Math.max(0, pickFirstNumber(row, ["neutral_count"], 0)),
    negativeCount: Math.max(0, pickFirstNumber(row, ["negative_count"], 0)),
    platformCount: Math.max(1, pickFirstNumber(row, ["platform_count"], 1)),
    firstSeenAt: toIsoTimestamp(row.first_seen_at),
    lastSeenAt: toIsoTimestamp(row.last_seen_at ?? row.updated_at),
  };
}

function applyStableClusterWindowTotalOverrides(
  rows: StableTopicDayTotalAggregateRow[],
  overrides: StableClusterWindowTotalOverride[],
) {
  if (overrides.length === 0) {
    return rows;
  }

  const overridesByTopicKey = new Map(overrides.map((row) => [row.topicKey, row]));

  return rows
    .map((row) => {
      const override = overridesByTopicKey.get(row.topicKey);
      if (!override) {
        return row;
      }

      return {
        ...row,
        totalMentions: override.totalMentions,
        uniquePosts: override.uniquePosts,
        uniqueAuthors: override.uniqueAuthors,
        positiveCount: override.positiveCount,
        neutralCount: override.neutralCount,
        negativeCount: override.negativeCount,
        platformCount: override.platformCount,
        firstSeenAt: override.firstSeenAt ?? row.firstSeenAt,
        lastSeenAt: override.lastSeenAt ?? row.lastSeenAt,
      };
    })
    .filter((row) => row.totalMentions >= STABLE_WINDOW_TOTALS_MIN_MENTIONS);
}

async function fetchStableClusterWindowTotalsFromPostgresSource(
  rows: StableTopicDayTotalAggregateRow[],
  windowStartIso: string,
  windowEndIso: string,
) {
  const mappings = buildStableClusterTopicMappings(rows);
  if (mappings.length === 0) {
    return [] as StableClusterWindowTotalOverride[];
  }

  const pool = getServerPostgresPool();
  const query = `
    /* stable_cluster_window_totals */
    WITH mapping AS (
      SELECT
        mapping.cluster_key,
        mapping.raw_topic_key
      FROM jsonb_to_recordset($1::jsonb) AS mapping(cluster_key text, raw_topic_key text)
    ),
    deduped_cluster_posts AS (
      SELECT DISTINCT ON (mapping.cluster_key, m.platform, m.raw_post_id)
        mapping.cluster_key,
        m.platform,
        m.raw_post_id,
        NULLIF(BTRIM(m.author_id), '') AS author_id,
        COALESCE(NULLIF(BTRIM(m.sentiment_label), ''), 'neutral') AS sentiment_label,
        COALESCE(m.topic_confidence, 0) AS topic_confidence,
        m.event_timestamp
      FROM public.post_topic_mentions m
      INNER JOIN mapping
        ON mapping.raw_topic_key = m.topic_key
      WHERE m.event_timestamp >= $2::timestamptz
        AND m.event_timestamp <= $3::timestamptz
        AND COALESCE(m.topic_confidence, 0) >= $4::double precision
      ORDER BY
        mapping.cluster_key,
        m.platform,
        m.raw_post_id,
        COALESCE(m.topic_confidence, 0) DESC,
        m.event_timestamp DESC,
        m.topic_key ASC
    )
    SELECT
      cluster_key AS topic_key,
      COUNT(*)::int AS total_mentions,
      COUNT(*)::int AS unique_posts,
      COUNT(DISTINCT author_id)::int AS unique_authors,
      SUM(CASE WHEN sentiment_label = 'positive' THEN 1 ELSE 0 END)::int AS positive_count,
      SUM(CASE WHEN sentiment_label = 'neutral' THEN 1 ELSE 0 END)::int AS neutral_count,
      SUM(CASE WHEN sentiment_label = 'negative' THEN 1 ELSE 0 END)::int AS negative_count,
      COUNT(DISTINCT platform)::int AS platform_count,
      MIN(event_timestamp)::timestamptz AS first_seen_at,
      MAX(event_timestamp)::timestamptz AS last_seen_at
    FROM deduped_cluster_posts
    GROUP BY cluster_key
  `;
  const result = await pool.query<Record<string, unknown>>(query, [
    JSON.stringify(mappings),
    windowStartIso,
    windowEndIso,
    STABLE_TOPIC_CONFIDENCE_FLOOR,
  ]);

  return result.rows
    .map((row) => parseStableClusterWindowTotalOverride(row))
    .filter((row): row is StableClusterWindowTotalOverride => Boolean(row));
}

async function fetchStableClusterDaySeriesFromPostgresSource(
  dayIso: string,
  windowStartIso: string,
  windowEndIso: string,
  rows: StableTopicDayTotalAggregateRow[],
) {
  const mappings = buildStableClusterTopicMappings(rows);
  if (mappings.length === 0) {
    return [] as SupabaseTopicRow[];
  }

  const dayStartIso = `${dayIso}T00:00:00.000Z`;
  const dayEndIso = new Date(Date.parse(dayStartIso) + 24 * 60 * 60 * 1_000).toISOString();
  const pool = getServerPostgresPool();
  const query = `
    /* stable_cluster_day_series */
    WITH mapping AS (
      SELECT
        mapping.cluster_key,
        mapping.raw_topic_key
      FROM jsonb_to_recordset($6::jsonb) AS mapping(cluster_key text, raw_topic_key text)
    ),
    cluster_posts AS (
      SELECT DISTINCT
        mapping.cluster_key,
        m.platform,
        m.raw_post_id,
        (
          date_trunc('hour', m.event_timestamp) +
          FLOOR(date_part('minute', m.event_timestamp) / 5)::int * INTERVAL '5 minute'
        )::timestamptz AS bucket_5m
      FROM public.post_topic_mentions m
      INNER JOIN mapping
        ON mapping.raw_topic_key = m.topic_key
      WHERE m.event_timestamp >= $2::timestamptz
        AND m.event_timestamp < $3::timestamptz
        AND m.event_timestamp >= $4::timestamptz
        AND m.event_timestamp <= $5::timestamptz
        AND COALESCE(m.topic_confidence, 0) >= $7::double precision
    )
    SELECT
      $1::text AS day,
      bucket_5m,
      cluster_key AS topic_key,
      cluster_key AS topic_label,
      COUNT(*)::int AS interactions,
      COUNT(*)::int AS cumulative_interactions,
      MAX(bucket_5m)::timestamptz AS updated_at
    FROM cluster_posts
    GROUP BY cluster_key, bucket_5m
    ORDER BY bucket_5m ASC, topic_key ASC
  `;
  const result = await pool.query<Record<string, unknown>>(query, [
    dayIso,
    dayStartIso,
    dayEndIso,
    windowStartIso,
    windowEndIso,
    JSON.stringify(mappings),
    STABLE_TOPIC_CONFIDENCE_FLOOR,
  ]);

  return result.rows as SupabaseTopicRow[];
}

function parseTopicEnrichmentRow(row: SupabaseTopicRow): TopicEnrichmentRow | null {
  const topicKey = readStringValue(row.topic_key);
  if (!topicKey) {
    return null;
  }

  const rawLabel = normalizeTopic(
    pickFirstString(row, ["raw_label", "canonical_name", "topic_key"]) || topicKey,
  );
  const canonicalNameValue = pickFirstString(row, ["canonical_name"]);
  const canonicalName = canonicalNameValue ? normalizeTopic(canonicalNameValue) : null;
  const aiDisplayNameValue = pickFirstString(row, ["ai_display_name", "canonical_name"]);
  const aiDisplayName = aiDisplayNameValue ? normalizeTopic(aiDisplayNameValue) : null;
  const fallbackLabelValue = pickFirstString(row, ["fallback_label"]);
  const metadata = parseJsonObject(row.metadata_json);
  const writerIdentity = pickFirstString(row, ["writer_identity"]) || readStringValue(metadata?.writer_identity) || "unknown";
  const writerRole = pickFirstString(row, ["writer_role"]) || readStringValue(metadata?.writer_role) || "unknown";
  const authoritativeWriter = Boolean(row.authoritative_writer === true || metadata?.authoritative_writer === true);
  const fallbackLabel = pickReadableStableDisplayLabel(
    fallbackLabelValue,
    rawLabel,
    topicKey,
  );
  const statusValue = pickFirstString(row, ["status"])?.toLowerCase();
  const status: TopicEnrichmentRow["status"] =
    statusValue === "ok" ||
    statusValue === "mixed" ||
    statusValue === "insufficient_evidence" ||
    statusValue === "junk"
      ? statusValue
      : canonicalName
        ? "mixed"
        : "insufficient_evidence";
  const explicitNameStatus = pickFirstString(row, ["name_status"]).toLowerCase();
  const explicitAiNameStatus = pickFirstString(row, ["ai_name_status"]).toLowerCase();
  const explicitNameSource = pickFirstString(row, ["name_source"]).toLowerCase();
  const narrativeText = [
    pickFirstString(row, ["narrative_summary"]),
    pickFirstString(row, ["context_paragraph"]),
    pickFirstString(row, ["abstain_reason"]),
  ]
    .join(" ")
    .toLowerCase();
  const hasFallbackNarrative =
    narrativeText.includes("safe fallback because ai enrichment was unavailable") ||
    narrativeText.includes("using the cleaned fallback label") ||
    narrativeText.includes("visible runtime ai naming failed");
  const mixedSignals = pickStringArray(row, ["mixed_signals"]);
  const hasRuntimeFailureSignal = mixedSignals.some(
    (value) => value.toLowerCase() === "visible_runtime_openai_failure",
  );
  const canonicalBackup =
    canonicalName &&
    status !== "insufficient_evidence" &&
    status !== "junk" &&
    canonicalName.toLowerCase() !== (rawLabel || topicKey).toLowerCase() &&
    !hasFallbackNarrative &&
    !hasRuntimeFailureSignal &&
    isReadableStableDisplayLabel(canonicalName)
      ? canonicalName
      : null;
  const explicitTrustedCanonical =
    Boolean(aiDisplayName ?? canonicalBackup) &&
    (explicitAiNameStatus === "ready" || explicitNameStatus === "ready") &&
    (explicitNameSource === "ai_exact" ||
      explicitNameSource === "historical_exact" ||
      explicitNameSource === "historical_alias");
  const shouldPromoteLegacyCanonical =
    Boolean(aiDisplayName ?? canonicalBackup) &&
    !explicitTrustedCanonical;
  const nameSource: TrendNameSource =
    explicitTrustedCanonical
      ? explicitNameSource
      : shouldPromoteLegacyCanonical
        ? explicitNameSource === "historical_exact" || explicitNameSource === "historical_alias"
          ? explicitNameSource
          : "historical_alias"
        : explicitNameSource === "fallback_cleaned" ||
            explicitNameSource === "raw" ||
            explicitNameSource === "none"
          ? explicitNameSource
          : fallbackLabel
            ? "fallback_cleaned"
            : rawLabel
              ? "raw"
              : "none";
  const nameStatus: TrendNameStatus =
    explicitTrustedCanonical || shouldPromoteLegacyCanonical
      ? "ready"
      : explicitNameStatus === "pending" || explicitNameStatus === "failed"
        ? explicitNameStatus
        : status === "insufficient_evidence" || status === "junk"
          ? hasRuntimeFailureSignal
            ? "pending"
            : "failed"
          : "pending";

  return {
    topicKey,
    status,
    rawLabel: rawLabel || topicKey,
    canonicalName: canonicalBackup,
    aiDisplayName: aiDisplayName ?? canonicalBackup,
    fallbackLabel: fallbackLabel || null,
    nameStatus,
    aiNameStatus:
      explicitAiNameStatus === "ready" || explicitAiNameStatus === "pending" || explicitAiNameStatus === "failed"
        ? explicitAiNameStatus
        : nameStatus,
    nameSource,
    writerIdentity,
    writerRole,
    authoritativeWriter,
    shortDescription: pickFirstString(row, ["short_description"]) || null,
    contextParagraph: pickFirstString(row, ["context_paragraph"]) || null,
    narrativeSummary: pickFirstString(row, ["narrative_summary"]) || null,
    whyAttention: pickFirstString(row, ["why_attention"]) || null,
    evidencePostIds: pickStringArray(row, ["evidence_post_ids"]),
    keyEntities: pickStringArray(row, ["key_entities"]),
    trendCategory: pickFirstString(row, ["trend_category"]) || null,
    mixedSignals,
    abstainReason: pickFirstString(row, ["abstain_reason"]) || null,
    summaryConfidence: clamp(pickFirstNumber(row, ["summary_confidence"], 0), 0, 1),
    modelName: pickFirstString(row, ["model_name"]) || null,
    promptVersion: pickFirstString(row, ["prompt_version"]) || null,
    generatedAt: toIsoTimestamp(row.generated_at),
    refreshedAt: toIsoTimestamp(row.refreshed_at),
    aiNameGeneratedAt: toIsoTimestamp(row.ai_name_generated_at),
    aiNameRefreshedAt: toIsoTimestamp(row.ai_name_refreshed_at),
    aiNameSourceVersion: pickFirstString(row, ["ai_name_source_version"]) || null,
    asOfWindowEnd: toIsoTimestamp(row.as_of_window_end),
  };
}

function scoreTopicEnrichmentSelection(row: TopicEnrichmentRow) {
  let score = 0;
  const trustedAiDisplayName = row.aiDisplayName ?? row.canonicalName;
  if (shouldUseEnrichmentCanonicalName(row) && trustedAiDisplayName && isNarrativeStableDisplayLabel(trustedAiDisplayName)) {
    score += 400 + Math.max(0, scoreStableClusterLabelCandidate(trustedAiDisplayName));
  } else if (isNarrativeStableDisplayLabel(row.fallbackLabel)) {
    score += 150 + Math.max(0, scoreStableClusterLabelCandidate(row.fallbackLabel ?? ""));
  } else if (isNarrativeStableDisplayLabel(row.rawLabel)) {
    score += 90 + Math.max(0, scoreStableClusterLabelCandidate(row.rawLabel));
  }

  if (row.authoritativeWriter) {
    score += 120;
  } else if (row.writerIdentity !== "unknown") {
    score += 30;
  }

  if (row.nameStatus === "ready") {
    score += 60;
  } else if (row.nameStatus === "failed") {
    score -= 30;
  }

  if (row.nameSource === "ai_exact") {
    score += 50;
  } else if (row.nameSource === "historical_exact" || row.nameSource === "historical_alias") {
    score += 35;
  } else if (row.nameSource === "fallback_cleaned") {
    score -= 10;
  }

  if (STABLE_TOPIC_LOW_SIGNAL_PROMPT_VERSIONS.has((row.promptVersion ?? "").toLowerCase())) {
    score -= 25;
  }
  if (row.mixedSignals.some((value) => value.toLowerCase() === "visible_runtime_openai_failure")) {
    score -= 80;
  }
  return score;
}

function selectLatestTopicEnrichment(rows: TopicEnrichmentRow[]) {
  const byTopicKey = new Map<string, TopicEnrichmentRow>();
  for (const row of rows) {
    const existing = byTopicKey.get(row.topicKey);
    if (!existing) {
      byTopicKey.set(row.topicKey, row);
      continue;
    }

    const rowSelectionScore = scoreTopicEnrichmentSelection(row);
    const existingSelectionScore = scoreTopicEnrichmentSelection(existing);
    if (rowSelectionScore > existingSelectionScore) {
      byTopicKey.set(row.topicKey, row);
      continue;
    }
    if (rowSelectionScore < existingSelectionScore) {
      continue;
    }

    const rowWindowMs = parseIsoTimestamp(row.asOfWindowEnd);
    const existingWindowMs = parseIsoTimestamp(existing.asOfWindowEnd);
    if (Number.isFinite(rowWindowMs) && (!Number.isFinite(existingWindowMs) || rowWindowMs > existingWindowMs)) {
      byTopicKey.set(row.topicKey, row);
      continue;
    }
    if (Number.isFinite(rowWindowMs) && Number.isFinite(existingWindowMs) && rowWindowMs < existingWindowMs) {
      continue;
    }

    const rowRefreshMs = parseIsoTimestamp(row.refreshedAt ?? row.generatedAt);
    const existingRefreshMs = parseIsoTimestamp(existing.refreshedAt ?? existing.generatedAt);
    if (
      Number.isFinite(rowRefreshMs) &&
      (!Number.isFinite(existingRefreshMs) || rowRefreshMs > existingRefreshMs)
    ) {
      byTopicKey.set(row.topicKey, row);
    }
  }

  return byTopicKey;
}

function shouldUseEnrichmentCanonicalName(enrichment: TopicEnrichmentRow | null | undefined) {
  const trustedDisplayName = enrichment ? (enrichment.aiDisplayName ?? enrichment.canonicalName) : null;
  return Boolean(
    enrichment &&
      enrichment.nameStatus === "ready" &&
      (enrichment.nameSource === "ai_exact" ||
        enrichment.nameSource === "historical_exact" ||
        enrichment.nameSource === "historical_alias") &&
      trustedDisplayName &&
      trustedDisplayName.trim().length > 0,
  );
}

function toTrendEnrichment(enrichment: TopicEnrichmentRow | null | undefined): TrendAiEnrichment | null {
  if (!enrichment) {
    return null;
  }

  return {
    rawLabel: enrichment.rawLabel,
    status: enrichment.status,
    canonicalName: enrichment.canonicalName,
    aiDisplayName: enrichment.aiDisplayName,
    fallbackLabel: enrichment.fallbackLabel,
    nameStatus: enrichment.nameStatus,
    aiNameStatus: enrichment.aiNameStatus,
    nameSource: enrichment.nameSource,
    shortDescription: enrichment.shortDescription,
    contextParagraph: enrichment.contextParagraph,
    narrativeSummary: enrichment.narrativeSummary,
    whyAttention: enrichment.whyAttention,
    evidencePostIds: enrichment.evidencePostIds,
    keyEntities: enrichment.keyEntities,
    trendCategory: enrichment.trendCategory,
    mixedSignals: enrichment.mixedSignals,
    abstainReason: enrichment.abstainReason,
    summaryConfidence: enrichment.summaryConfidence,
    modelName: enrichment.modelName,
    promptVersion: enrichment.promptVersion,
    generatedAt: enrichment.generatedAt,
    refreshedAt: enrichment.refreshedAt,
    aiNameGeneratedAt: enrichment.aiNameGeneratedAt,
    aiNameRefreshedAt: enrichment.aiNameRefreshedAt,
    aiNameSourceVersion: enrichment.aiNameSourceVersion,
  };
}

function applyTopicEnrichmentToRankedTrend(
  row: RankedTrend,
  rawLabel: string,
  enrichment: TopicEnrichmentRow | null | undefined,
) {
  const normalizedRawLabel = normalizeTopic(rawLabel) || rawLabel;
  const canonicalBackup =
    enrichment?.aiDisplayName
      ? normalizeTopic(enrichment.aiDisplayName) || null
      : enrichment?.canonicalName
        ? normalizeTopic(enrichment.canonicalName) || null
        : null;
  const trustedDisplayLabel =
    shouldUseEnrichmentCanonicalName(enrichment) && canonicalBackup && isNarrativeStableDisplayLabel(canonicalBackup)
      ? canonicalBackup
      : null;
  const narrativeFallbackLabel =
    pickNarrativeStableDisplayLabel(
      enrichment?.fallbackLabel,
      canonicalBackup,
      normalizedRawLabel,
    ) ??
    pickReadableStableDisplayLabel(
      enrichment?.fallbackLabel,
      canonicalBackup,
      normalizedRawLabel,
    );
  const resolvedDisplayLabel = trustedDisplayLabel ?? narrativeFallbackLabel;
  const nameStatus = enrichment?.nameStatus ?? "pending";
  const nameSource = enrichment?.nameSource ?? (normalizedRawLabel ? "raw" : "none");
  const trendEnrichment = toTrendEnrichment(enrichment);

  Object.assign(
    row,
    toTrendNameFields({
      displayName: resolvedDisplayLabel,
      trustedDisplayName: trustedDisplayLabel,
      nameStatus,
      nameSource,
      fallbackLabel: narrativeFallbackLabel,
      rawLabel: narrativeFallbackLabel ? normalizedRawLabel : null,
      enrichment: trendEnrichment,
    }),
    );
  const visibleLabel = getTrendDisplayNameOrPlaceholder(row);
  row.clusterName = visibleLabel;
  row.aiAssisted = Boolean(trustedDisplayLabel);
  row.trendCategory = enrichment?.trendCategory ?? null;
  row.trendDescription = enrichment?.shortDescription || null;
  row.trendContextParagraph = enrichment?.contextParagraph || null;
  row.trendNarrativeSummary = enrichment?.narrativeSummary || null;
  row.trendRawLabel = enrichment?.rawLabel ?? normalizedRawLabel;
  row.trendFallbackLabel = enrichment?.fallbackLabel ?? row.trendFallbackLabel ?? null;
  row.trendSummaryConfidence = enrichment ? enrichment.summaryConfidence : null;
  row.trendEnrichmentStatus = enrichment?.status ?? null;
  row.trendEnrichmentAbstainReason = enrichment?.abstainReason ?? null;
  row.trendKeyEntities = enrichment?.keyEntities ?? null;
  row.trendEnrichment = trendEnrichment;
  if (row.blueskySummary) {
    row.blueskySummary = {
      ...row.blueskySummary,
      leadingSignalLabel: visibleLabel,
    };
  }
}

async function fetchTopicEnrichmentRowsFromSupabase(
  topicKeys: string[],
  minAsOfWindowEndIso: string,
) {
  const client = getSupabaseServerClient();
  let cursor = 0;
  const rows: SupabaseTopicRow[] = [];
  while (cursor < TOPIC_ENRICHMENT_MAX_ROWS) {
    const upper = Math.min(cursor + PAGE_SIZE - 1, TOPIC_ENRICHMENT_MAX_ROWS - 1);
    const { data, error } = await client
      .from(TOPIC_ENRICHMENT_TABLE)
      .select(TOPIC_ENRICHMENT_COLUMNS)
      .in("topic_key", topicKeys)
      .gte("as_of_window_end", minAsOfWindowEndIso)
      .order("as_of_window_end", { ascending: false })
      .order("generated_at", { ascending: false })
      .range(cursor, upper);

    if (error) {
      throw error;
    }

    const pageRows = (data ?? []) as unknown as SupabaseTopicRow[];
    if (pageRows.length === 0) {
      break;
    }
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) {
      break;
    }
    cursor += PAGE_SIZE;
  }

  return rows;
}

async function fetchTopicEnrichmentRowsFromPostgres(
  topicKeys: string[],
  minAsOfWindowEndIso: string,
) {
  const pool = getServerPostgresPool();
  const result = await pool.query<Record<string, unknown>>(
    `
      SELECT
        topic_key,
        as_of_window_end,
        raw_label,
        status,
        canonical_name,
        ai_display_name,
        fallback_label,
        name_status,
        ai_name_status,
        name_source,
        short_description,
        context_paragraph,
        narrative_summary,
        why_attention,
        evidence_post_ids,
        key_entities,
        trend_category,
        mixed_signals,
        abstain_reason,
        summary_confidence,
        model_name,
        prompt_version,
        generated_at,
        refreshed_at,
        ai_name_generated_at,
        ai_name_refreshed_at,
        ai_name_source_version,
        writer_identity,
        writer_role,
        authoritative_writer,
        metadata_json
      FROM public.${TOPIC_ENRICHMENT_TABLE}
      WHERE topic_key = ANY($1::text[])
        AND as_of_window_end >= $2::timestamptz
      ORDER BY topic_key ASC, as_of_window_end DESC, generated_at DESC
      LIMIT $3::int
    `,
    [topicKeys, minAsOfWindowEndIso, TOPIC_ENRICHMENT_MAX_ROWS],
  );
  return result.rows as SupabaseTopicRow[];
}

async function fetchTopicEnrichmentByTopicKeys(
  topicKeys: string[],
  windowEndIso: string,
) {
  const normalizedTopicKeys = [...new Set(topicKeys.map((value) => value.trim()).filter((value) => value.length > 0))];
  if (normalizedTopicKeys.length === 0) {
    return new Map<string, TopicEnrichmentRow>();
  }

  const minWindowEndIso = new Date(
    Date.parse(windowEndIso) - TOPIC_ENRICHMENT_LOOKBACK_HOURS * 60 * 60 * 1_000,
  ).toISOString();

  const parsedRows: TopicEnrichmentRow[] = [];

  if (hasDatabaseUrl()) {
    try {
      const rows = await fetchTopicEnrichmentRowsFromPostgres(normalizedTopicKeys, minWindowEndIso);
      parsedRows.push(...rows.map((row) => parseTopicEnrichmentRow(row)).filter((row): row is TopicEnrichmentRow => Boolean(row)));
      return selectLatestTopicEnrichment(parsedRows);
    } catch (error) {
      if (!isPostgresMissingStructure(error)) {
        throw error;
      }
    }
  }

  if (hasSupabaseServerCredentials()) {
    try {
      const rows = await fetchTopicEnrichmentRowsFromSupabase(normalizedTopicKeys, minWindowEndIso);
      parsedRows.push(...rows.map((row) => parseTopicEnrichmentRow(row)).filter((row): row is TopicEnrichmentRow => Boolean(row)));
      return selectLatestTopicEnrichment(parsedRows);
    } catch (error) {
      const pgError = error as PostgrestError;
      if (!isSupabaseMissingStructure(pgError)) {
        throw error;
      }
    }
  }

  return new Map<string, TopicEnrichmentRow>();
}

function parseStableDayTotalRow(row: SupabaseTopicRow): StableTopicDayTotalRow | null {
  const topicKey = readStringValue(row.topic_key ?? row.normalized_topic ?? row.topic);
  const topicLabel = normalizeTopic(
    pickFirstString(row, ["topic_label", "topic_display", "topic", "normalized_topic", "topic_key"]) || topicKey,
  );
  const dayTimestampIso =
    toIsoTimestamp(row.day) ??
    toIsoTimestamp(row.window_end) ??
    toIsoTimestamp(row.updated_at);
  const day = dayTimestampIso ? dayTimestampIso.slice(0, 10) : "";

  if (!topicKey || !topicLabel || !day) {
    return null;
  }

  return {
    day,
    topicKey,
    topicLabel,
    totalMentions: Math.max(
      0,
      pickFirstNumber(row, ["total_mentions", "mention_count", "mentions", "interactions"], 0),
    ),
    uniquePosts: Math.max(0, pickFirstNumber(row, ["unique_posts", "post_count", "roots_count"], 0)),
    uniqueAuthors: Math.max(0, pickFirstNumber(row, ["unique_authors", "author_count"], 0)),
    positiveCount: Math.max(0, pickFirstNumber(row, ["positive_count"], 0)),
    neutralCount: Math.max(0, pickFirstNumber(row, ["neutral_count"], 0)),
    negativeCount: Math.max(0, pickFirstNumber(row, ["negative_count"], 0)),
    platformCount: Math.max(1, pickFirstNumber(row, ["platform_count"], 1)),
    firstSeenAt: toIsoTimestamp(row.first_seen_at ?? row.day),
    lastSeenAt: toIsoTimestamp(row.last_seen_at ?? row.updated_at ?? row.day),
  };
}

function parseStableDaySeriesRow(row: SupabaseTopicRow): StableTopicSeriesRow | null {
  const topicKey = readStringValue(row.topic_key ?? row.normalized_topic ?? row.topic);
  const bucket5m = toIsoMinute(row.bucket_5m ?? row.bucket_start ?? row.bucket_minute);
  const day = readStringValue(row.day || (bucket5m ? bucket5m.slice(0, 10) : ""));
  if (!topicKey || !bucket5m || !day) {
    return null;
  }

  const topicLabel = normalizeTopic(
    pickFirstString(row, ["topic_label", "topic_display", "topic", "normalized_topic", "topic_key"]) || topicKey,
  );
  const interactions = Math.max(0, pickFirstNumber(row, ["interactions", "mention_count", "value"], 0));
  const cumulativeInteractions = Math.max(
    interactions,
    pickFirstNumber(row, ["cumulative_interactions", "running_total"], interactions),
  );

  return {
    day,
    topicKey,
    topicLabel,
    bucket5m,
    interactions,
    cumulativeInteractions,
    updatedAt: toIsoTimestamp(row.updated_at ?? row.bucket_5m ?? row.bucket_start),
  };
}

function normalizeTopicIdentity(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9$#\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTopicSigils(value: string) {
  return value.replace(/^[$#]+/, "");
}

function resolveStableTopicIdentity(topicKey: string, topicLabel: string) {
  const keyIdentity = normalizeTopicIdentity(topicKey);
  const labelIdentity = normalizeTopicIdentity(topicLabel);
  const labelBase = stripTopicSigils(labelIdentity);

  if (!keyIdentity) {
    return labelBase || labelIdentity;
  }

  if (!labelBase) {
    return stripTopicSigils(keyIdentity);
  }

  const strippedKey = stripTopicSigils(keyIdentity);
  if (strippedKey === labelBase) {
    return labelBase;
  }

  // Guard against known malformed key drift like `Trump -> rump`.
  if (
    strippedKey.length >= 2 &&
    strippedKey.length <= 4 &&
    labelBase.length === strippedKey.length + 1 &&
    strippedKey === labelBase.slice(1)
  ) {
    return labelBase;
  }

  return strippedKey;
}

function buildStableTopicLookupKeys(...values: Array<string | null | undefined>) {
  const keys = new Set<string>();
  for (const value of values) {
    const normalized = resolveStableTopicIdentity(value ?? "", value ?? "");
    if (normalized) {
      keys.add(normalized);
    }
  }
  return [...keys];
}

function dedupeCaseInsensitive(values: Array<string | null | undefined>) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeTopic(readStringValue(value));
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function compactTopicIdentity(value: string) {
  return stripTopicSigils(normalizeTopicIdentity(value)).replace(/[\s-]+/g, "");
}

function singularizeTopicToken(token: string) {
  if (token.length <= 4) {
    return token;
  }
  if (token.endsWith("ies") && token.length > 5) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("es") && !token.endsWith("ses") && !token.endsWith("xes")) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss") && !token.endsWith("us") && !token.endsWith("is")) {
    return token.slice(0, -1);
  }
  return token;
}

function getStableTopicLabelTokens(value: string) {
  return stripTopicSigils(normalizeTopicIdentity(value))
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function isStableInformativeToken(token: string) {
  return token.length >= 2 &&
    !STABLE_TOPIC_STOP_WORDS.has(token) &&
    !STABLE_TOPIC_GENERIC_TOKENS.has(token) &&
    !STABLE_TOPIC_TEMPORAL_TOKENS.has(token);
}

function getStableTopicInformativeTokens(value: string) {
  const tokens = getStableTopicLabelTokens(value)
    .map((token) => singularizeTopicToken(token))
    .filter((token) => token.length > 0);
  const deduped = new Set<string>();
  for (const token of tokens) {
    if (isStableInformativeToken(token)) {
      deduped.add(token);
    }
  }
  return [...deduped];
}

function buildStableTopicMergeKey(value: string) {
  const tokens = getStableTopicInformativeTokens(value);
  if (tokens.length === 0) {
    return "";
  }
  return [...tokens].sort().slice(0, 4).join(" ");
}

function isFragmentLikeTopicLabel(value: string) {
  const normalized = stripTopicSigils(normalizeTopicIdentity(value));
  if (!normalized) {
    return true;
  }
  if (STABLE_TOPIC_FRAGMENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  if (STABLE_TOPIC_GENERIC_LABEL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  const tokens = getStableTopicLabelTokens(normalized);
  if (tokens.length === 1 && (STABLE_TOPIC_GENERIC_TOKENS.has(tokens[0]) || STABLE_TOPIC_TEMPORAL_TOKENS.has(tokens[0]))) {
    return true;
  }
  return getStableTopicInformativeTokens(normalized).length === 0 && compactTopicIdentity(normalized).length <= 12;
}

function isGenericLikeTopicLabel(value: string) {
  const normalized = stripTopicSigils(normalizeTopicIdentity(value));
  if (!normalized) {
    return true;
  }
  if (STABLE_TOPIC_GENERIC_LABEL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  const informativeTokens = getStableTopicInformativeTokens(normalized);
  if (informativeTokens.length === 0) {
    return true;
  }
  return informativeTokens.every((token) => STABLE_TOPIC_GENERIC_TOKENS.has(token));
}

function isTemporalLikeTopicLabel(value: string) {
  const tokens = getStableTopicLabelTokens(value);
  return tokens.length > 0 && tokens.every((token) => STABLE_TOPIC_TEMPORAL_TOKENS.has(token));
}

function hasFragmentVariantMatch(left: string, right: string) {
  if (!left || !right || left === right) {
    return left === right;
  }
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (shorter.length < 4 || longer.length < 5) {
    return false;
  }
  if (shorter === longer.slice(1) || shorter === longer.slice(0, -1)) {
    return true;
  }
  if (longer.includes(shorter) && longer.length - shorter.length <= 2) {
    return true;
  }
  if (Math.abs(left.length - right.length) > 1) {
    return false;
  }
  let edits = 0;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) {
      return false;
    }
    if (left.length > right.length) {
      leftIndex += 1;
      continue;
    }
    if (right.length > left.length) {
      rightIndex += 1;
      continue;
    }
    leftIndex += 1;
    rightIndex += 1;
  }
  edits += (left.length - leftIndex) + (right.length - rightIndex);
  return edits <= 1;
}

function isFragmentAliasOfLongerCandidate(label: string, candidates: string[]) {
  const compactLabel = compactTopicIdentity(label);
  if (!compactLabel) {
    return false;
  }
  return candidates.some((candidate) => {
    const compactCandidate = compactTopicIdentity(candidate);
    return compactCandidate.length > compactLabel.length && hasFragmentVariantMatch(compactLabel, compactCandidate);
  });
}

function intersectArrays(left: string[], right: Iterable<string>) {
  const rightSet = right instanceof Set ? right : new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function scoreStableClusterLabelCandidate(label: string) {
  const normalized = normalizeTopic(label) || readStringValue(label);
  if (!normalized) {
    return Number.NEGATIVE_INFINITY;
  }
  const informativeTokens = getStableTopicInformativeTokens(normalized);
  let score = informativeTokens.length * 18;
  if (normalized.includes(" ")) {
    score += 8;
  }
  if (!isFragmentLikeTopicLabel(normalized)) {
    score += 14;
  }
  if (!isGenericLikeTopicLabel(normalized)) {
    score += 10;
  }
  if (!isTemporalLikeTopicLabel(normalized)) {
    score += 6;
  }
  if (informativeTokens.length === 1) {
    score += 6;
  }
  if (isFragmentLikeTopicLabel(normalized)) {
    score -= 20;
  }
  if (isGenericLikeTopicLabel(normalized)) {
    score -= 18;
  }
  if (isTemporalLikeTopicLabel(normalized)) {
    score -= 24;
  }
  return score;
}

function buildStableClusterCandidateLabels(
  row: StableTopicDayTotalAggregateRow,
  enrichment: TopicEnrichmentRow | null,
) {
  return dedupeCaseInsensitive([
    enrichment?.aiDisplayName,
    enrichment?.canonicalName,
    row.topicLabel,
    enrichment?.fallbackLabel,
    enrichment?.rawLabel,
    ...(enrichment?.keyEntities ?? []).filter((value) => isReadableStableDisplayLabel(value)),
    normalizeTopic(row.topicKey),
    ...row.rawTopicKeys.map((value) => normalizeTopic(value)).filter((value) => isReadableStableDisplayLabel(value)),
  ]);
}

function buildStableTopicClusterCandidate(
  row: StableTopicDayTotalAggregateRow,
  enrichment: TopicEnrichmentRow | null,
): StableTopicClusterCandidate {
  const candidateLabels = buildStableClusterCandidateLabels(row, enrichment);
  const normalizedAliases = dedupeCaseInsensitive(candidateLabels.map((label) =>
    stripTopicSigils(normalizeTopicIdentity(label))
  ));
  const compactAliases = [...new Set(normalizedAliases.map((label) => compactTopicIdentity(label)).filter((value) => value.length > 0))];
  const informativeTokens = [
    ...new Set(candidateLabels.flatMap((label) => getStableTopicInformativeTokens(label))),
  ];
  const informativeTokenSet = new Set(informativeTokens);
  const mergeKeys = dedupeCaseInsensitive(candidateLabels.map((label) => buildStableTopicMergeKey(label)).filter(Boolean));
  const anchorTokens = [...new Set(
    candidateLabels
      .flatMap((label) => getStableTopicInformativeTokens(label).slice(0, 3)),
  )].slice(0, 4);
  const primaryLabels = [
    enrichment?.aiDisplayName,
    enrichment?.canonicalName,
    enrichment?.fallbackLabel,
    enrichment?.rawLabel,
    row.topicLabel,
    row.topicKey,
  ].filter(Boolean) as string[];
  const fragmentLike = primaryLabels.some((label) => isFragmentLikeTopicLabel(label));
  const genericLike = primaryLabels.every((label) => isGenericLikeTopicLabel(label));
  const temporalLike = primaryLabels.every((label) => isTemporalLikeTopicLabel(label));

  return {
    row,
    enrichment,
    candidateLabels,
    normalizedAliases,
    compactAliases,
    informativeTokens,
    informativeTokenSet,
    mergeKeys,
    anchorTokens,
    fragmentLike,
    genericLike,
    temporalLike,
  };
}

function shouldMergeStableTopicCandidates(
  left: StableTopicClusterCandidate,
  right: StableTopicClusterCandidate,
) {
  if (intersectArrays(left.normalizedAliases, right.normalizedAliases).length > 0) {
    return true;
  }
  if (intersectArrays(left.compactAliases, right.compactAliases).length > 0) {
    return true;
  }
  if (intersectArrays(left.mergeKeys, right.mergeKeys).length > 0) {
    return true;
  }

  const sharedInformativeTokens = intersectArrays(left.informativeTokens, right.informativeTokenSet);
  if (sharedInformativeTokens.length >= 2) {
    return true;
  }

  const sharedAnchorTokens = intersectArrays(left.anchorTokens, right.anchorTokens);
  const allowLooseMerge =
    left.fragmentLike ||
    right.fragmentLike ||
    left.genericLike ||
    right.genericLike ||
    left.informativeTokens.length <= 1 ||
    right.informativeTokens.length <= 1;

  if (sharedAnchorTokens.length > 0 && allowLooseMerge) {
    return true;
  }

  for (const leftAlias of left.compactAliases) {
    for (const rightAlias of right.compactAliases) {
      if (hasFragmentVariantMatch(leftAlias, rightAlias)) {
        return true;
      }
    }
  }

  return false;
}

function chooseStableClusterDisplayLabel(members: StableTopicClusterCandidate[]) {
  const candidateScores = new Map<string, number>();
  const allLabels = dedupeCaseInsensitive(members.flatMap((member) => member.candidateLabels));
  const addCandidate = (label: string | null | undefined, weight: number) => {
    const normalized = normalizeTopic(readStringValue(label));
    if (!normalized) {
      return;
    }
    const readable = isReadableStableDisplayLabel(normalized);
    if (!readable) {
      return;
    }
    const score = scoreStableClusterLabelCandidate(normalized);
    if (!Number.isFinite(score)) {
      return;
    }
    const fragmentPenalty = isFragmentAliasOfLongerCandidate(normalized, allLabels) ? 56 : 0;
    candidateScores.set(
      normalized,
      (candidateScores.get(normalized) ?? 0) + weight + score - fragmentPenalty + (readable ? 14 : -35),
    );
  };

  for (const member of members) {
    const supportWeight = Math.max(8, Math.log2(member.row.totalMentions + 1) * 10);
    addCandidate(member.enrichment?.aiDisplayName, supportWeight + 32);
    addCandidate(member.enrichment?.canonicalName, supportWeight + 28);
    addCandidate(member.row.topicLabel, supportWeight + 24);
    addCandidate(member.enrichment?.fallbackLabel, supportWeight + 18);
    addCandidate(member.enrichment?.rawLabel, supportWeight + 10);
    for (const entity of member.enrichment?.keyEntities ?? []) {
      addCandidate(entity, supportWeight + 4);
    }
    addCandidate(normalizeTopic(member.row.topicKey), supportWeight - 2);
  }

  const ranked = [...candidateScores.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return scoreStableClusterLabelCandidate(right[0]) - scoreStableClusterLabelCandidate(left[0]);
    })
    .map(([label]) => label);
  const preferredCanonical = dedupeCaseInsensitive(
    members
      .map((member) => member.enrichment?.aiDisplayName ?? member.enrichment?.canonicalName)
      .filter((label) => isReadableStableDisplayLabel(label)),
  ).sort((left, right) => scoreStableClusterLabelCandidate(right) - scoreStableClusterLabelCandidate(left))[0];
  return pickReadableStableDisplayLabel(
    preferredCanonical,
    ranked[0],
    members[0]?.row.topicLabel,
    members[0]?.enrichment?.fallbackLabel,
    members[0]?.enrichment?.rawLabel,
  ) ?? null;
}

function synthesizeStableClusterEnrichment(
  topicKey: string,
  displayLabel: string,
  members: StableTopicClusterCandidate[],
) {
  const rankedMembers = [...members].sort((left, right) => right.row.totalMentions - left.row.totalMentions);
  const bestEnrichment = rankedMembers.find((member) => member.enrichment)?.enrichment ?? null;
  const dominantTrustedEnrichment =
    rankedMembers.find((member) => shouldUseEnrichmentCanonicalName(member.enrichment))?.enrichment ?? null;
  const keyEntities = dedupeCaseInsensitive(
    members.flatMap((member) => [
      ...(member.enrichment?.keyEntities ?? []),
      member.enrichment?.rawLabel,
      member.row.topicLabel,
    ]),
  )
    .filter((label) => !isGenericLikeTopicLabel(label) && !isTemporalLikeTopicLabel(label))
    .slice(0, 6);
  const aiSupported = members.some((member) => shouldUseEnrichmentCanonicalName(member.enrichment));
  const normalizedDisplayLabel = pickReadableStableDisplayLabel(displayLabel);
  const hasConsensusTrustedCanonical =
    Boolean(normalizedDisplayLabel) &&
    ((dominantTrustedEnrichment?.aiDisplayName ?? dominantTrustedEnrichment?.canonicalName)?.toLowerCase() ?? null) ===
    (normalizedDisplayLabel?.toLowerCase() ?? null);
  if (!bestEnrichment && !aiSupported && keyEntities.length === 0) {
    return null;
  }

  return {
    topicKey,
    rawLabel: pickReadableStableDisplayLabel(
      keyEntities[0],
      bestEnrichment?.fallbackLabel,
      bestEnrichment?.rawLabel,
      displayLabel,
    ) ?? displayLabel,
    status: aiSupported ? "mixed" : (bestEnrichment?.status ?? "insufficient_evidence"),
    canonicalName: hasConsensusTrustedCanonical ? normalizedDisplayLabel : null,
    aiDisplayName: hasConsensusTrustedCanonical ? normalizedDisplayLabel : null,
    fallbackLabel: normalizedDisplayLabel,
    nameStatus: hasConsensusTrustedCanonical ? "ready" : normalizedDisplayLabel ? "pending" : "failed",
    aiNameStatus: hasConsensusTrustedCanonical ? "ready" : normalizedDisplayLabel ? "pending" : "failed",
    nameSource: hasConsensusTrustedCanonical ? "ai_exact" : normalizedDisplayLabel ? "fallback_cleaned" : "none",
    writerIdentity: bestEnrichment?.writerIdentity ?? "synthetic_cluster_merge",
    writerRole: bestEnrichment?.writerRole ?? "stable_cluster_read_model",
    authoritativeWriter: Boolean(bestEnrichment?.authoritativeWriter),
    shortDescription: bestEnrichment?.shortDescription ?? null,
    contextParagraph: bestEnrichment?.contextParagraph ?? null,
    narrativeSummary: bestEnrichment?.narrativeSummary ?? null,
    whyAttention: bestEnrichment?.whyAttention ?? null,
    evidencePostIds: bestEnrichment?.evidencePostIds ?? [],
    keyEntities,
    trendCategory: bestEnrichment?.trendCategory ?? null,
    mixedSignals: bestEnrichment?.mixedSignals ?? [],
    abstainReason: bestEnrichment?.abstainReason ?? null,
    summaryConfidence: bestEnrichment?.summaryConfidence ?? 0,
    modelName: bestEnrichment?.modelName ?? null,
    promptVersion: bestEnrichment?.promptVersion ?? null,
    generatedAt: bestEnrichment?.generatedAt ?? null,
    refreshedAt: bestEnrichment?.refreshedAt ?? null,
    aiNameGeneratedAt: bestEnrichment?.aiNameGeneratedAt ?? null,
    aiNameRefreshedAt: bestEnrichment?.aiNameRefreshedAt ?? null,
    aiNameSourceVersion: bestEnrichment?.aiNameSourceVersion ?? bestEnrichment?.promptVersion ?? null,
    asOfWindowEnd: bestEnrichment?.asOfWindowEnd ?? null,
  } satisfies TopicEnrichmentRow;
}

function isUnresolvedGenericStableCluster(
  row: StableTopicDayTotalAggregateRow,
  enrichment: TopicEnrichmentRow | null | undefined,
) {
  const label = row.topicLabel || row.topicKey;
  return !shouldUseEnrichmentCanonicalName(enrichment) &&
    getStableTopicInformativeTokens(label).length === 0 &&
    (isGenericLikeTopicLabel(label) || isTemporalLikeTopicLabel(label) || isFragmentLikeTopicLabel(label));
}

function mergeStableTopicClusters(
  rows: StableTopicDayTotalAggregateRow[],
  enrichmentByTopicKey: Map<string, TopicEnrichmentRow>,
  options: {
    requestedStableTopicKey: string | null;
    selectedId?: string;
  } = { requestedStableTopicKey: null },
): StableTopicClusterMergeResult {
  if (rows.length <= 1) {
    return {
      rows,
      enrichmentByTopicKey,
    };
  }

  const candidates = rows.map((row) => buildStableTopicClusterCandidate(row, enrichmentByTopicKey.get(row.topicKey) ?? null));
  const parents = candidates.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parents[cursor] !== cursor) {
      parents[cursor] = parents[parents[cursor]];
      cursor = parents[cursor];
    }
    return cursor;
  };
  const union = (leftIndex: number, rightIndex: number) => {
    const leftRoot = find(leftIndex);
    const rightRoot = find(rightIndex);
    if (leftRoot === rightRoot) {
      return;
    }
    const leftCandidate = candidates[leftRoot];
    const rightCandidate = candidates[rightRoot];
    const leftWeight = leftCandidate.row.totalMentions;
    const rightWeight = rightCandidate.row.totalMentions;
    if (leftWeight > rightWeight || (leftWeight === rightWeight && leftRoot < rightRoot)) {
      parents[rightRoot] = leftRoot;
      return;
    }
    parents[leftRoot] = rightRoot;
  };

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      if (shouldMergeStableTopicCandidates(candidates[leftIndex], candidates[rightIndex])) {
        union(leftIndex, rightIndex);
      }
    }
  }

  const grouped = new Map<number, StableTopicClusterCandidate[]>();
  for (let index = 0; index < candidates.length; index += 1) {
    const root = find(index);
    const existing = grouped.get(root);
    if (existing) {
      existing.push(candidates[index]);
      continue;
    }
    grouped.set(root, [candidates[index]]);
  }

  const selectedIdentifiers = new Set<string>();
  if (options.requestedStableTopicKey) {
    selectedIdentifiers.add(options.requestedStableTopicKey);
  }
  if (options.selectedId) {
    selectedIdentifiers.add(options.selectedId);
  }

  const mergedRows: StableTopicDayTotalAggregateRow[] = [];
  const mergedEnrichment = new Map<string, TopicEnrichmentRow>();

  for (const members of grouped.values()) {
    const rankedMembers = [...members].sort((left, right) => {
      if (right.row.totalMentions !== left.row.totalMentions) {
        return right.row.totalMentions - left.row.totalMentions;
      }
      return right.row.uniquePosts - left.row.uniquePosts;
    });
    const chosenDisplayLabel = chooseStableClusterDisplayLabel(rankedMembers);
    const displayLabel = chosenDisplayLabel ?? TREND_NAME_PLACEHOLDER;
    const preferredClusterKey =
      rankedMembers.length <= 1
        ? rankedMembers[0]?.row.topicKey
        : resolveStableTopicIdentity(
            chosenDisplayLabel || rankedMembers[0]?.row.topicKey || "",
            chosenDisplayLabel || rankedMembers[0]?.row.topicLabel || rankedMembers[0]?.row.topicKey || "",
          );
    const clusterKey = preferredClusterKey || rankedMembers[0]?.row.topicKey || "";
    if (!clusterKey) {
      continue;
    }
    const mergedRow: StableTopicDayTotalAggregateRow = {
      ...rankedMembers[0].row,
      topicKey: clusterKey,
      topicLabel: displayLabel,
      rawTopicKeys: buildStableTopicLookupKeys(
        chosenDisplayLabel,
        clusterKey,
        ...rankedMembers.flatMap((member) => member.row.rawTopicKeys),
        ...rankedMembers.flatMap((member) => [member.row.topicKey, member.row.topicLabel]),
      ),
      sourceTopicKeys: dedupeCaseInsensitive(
        rankedMembers.flatMap((member) => member.row.sourceTopicKeys),
      ),
    };

    for (const member of rankedMembers.slice(1)) {
      mergedRow.totalMentions += member.row.totalMentions;
      mergedRow.uniquePosts += member.row.uniquePosts;
      mergedRow.uniqueAuthors += member.row.uniqueAuthors;
      mergedRow.positiveCount += member.row.positiveCount;
      mergedRow.neutralCount += member.row.neutralCount;
      mergedRow.negativeCount += member.row.negativeCount;
      mergedRow.platformCount = Math.max(mergedRow.platformCount, member.row.platformCount);
      mergedRow.firstSeenAt = minIsoTimestamp(mergedRow.firstSeenAt, member.row.firstSeenAt);
      mergedRow.lastSeenAt = maxIsoTimestamp(mergedRow.lastSeenAt, member.row.lastSeenAt);
      for (const rawTopicKey of member.row.rawTopicKeys) {
        if (!mergedRow.rawTopicKeys.includes(rawTopicKey)) {
          mergedRow.rawTopicKeys.push(rawTopicKey);
        }
      }
      for (const sourceTopicKey of member.row.sourceTopicKeys) {
        if (!mergedRow.sourceTopicKeys.includes(sourceTopicKey)) {
          mergedRow.sourceTopicKeys.push(sourceTopicKey);
        }
      }
    }

    const synthesizedEnrichment = synthesizeStableClusterEnrichment(clusterKey, displayLabel, rankedMembers);
    if (synthesizedEnrichment) {
      mergedEnrichment.set(clusterKey, synthesizedEnrichment);
    }

    const weakOnlyCluster = rankedMembers.every((member) =>
      member.fragmentLike || member.genericLike || member.temporalLike || member.informativeTokens.length === 0
    );
    const keepCluster = (!weakOnlyCluster && !isUnresolvedGenericStableCluster(mergedRow, synthesizedEnrichment)) ||
      mergedRow.rawTopicKeys.some((rawKey) => selectedIdentifiers.has(rawKey)) ||
      selectedIdentifiers.has(clusterKey) ||
      selectedIdentifiers.has(buildTrendId(clusterKey));
    if (keepCluster) {
      mergedRows.push(mergedRow);
    }
  }

  return {
    rows: mergedRows,
    enrichmentByTopicKey: mergedEnrichment,
  };
}

function normalizeRequestedStableTopicKey(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = resolveStableTopicIdentity(value, value);
  return normalized.length > 0 ? normalized : null;
}

function parseIsoTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.NaN;
  }
  return Date.parse(value);
}

function minIsoTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftMs = parseIsoTimestamp(left);
  const rightMs = parseIsoTimestamp(right);
  if (!Number.isFinite(leftMs)) {
    return Number.isFinite(rightMs) ? right ?? null : null;
  }
  if (!Number.isFinite(rightMs)) {
    return left ?? null;
  }
  return leftMs <= rightMs ? left ?? null : right ?? null;
}

function maxIsoTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftMs = parseIsoTimestamp(left);
  const rightMs = parseIsoTimestamp(right);
  if (!Number.isFinite(leftMs)) {
    return Number.isFinite(rightMs) ? right ?? null : null;
  }
  if (!Number.isFinite(rightMs)) {
    return left ?? null;
  }
  return leftMs >= rightMs ? left ?? null : right ?? null;
}

function sortStableTopicAggregateRowsByVolume(rows: StableTopicDayTotalAggregateRow[]) {
  return [...rows].sort((left, right) => {
    if (right.totalMentions !== left.totalMentions) {
      return right.totalMentions - left.totalMentions;
    }
    if (right.uniquePosts !== left.uniquePosts) {
      return right.uniquePosts - left.uniquePosts;
    }
    if (right.uniqueAuthors !== left.uniqueAuthors) {
      return right.uniqueAuthors - left.uniqueAuthors;
    }
    return left.topicKey.localeCompare(right.topicKey);
  });
}

function parseTopicRow(row: SupabaseTopicRow): ParsedTopicBucketRow | null {
  const topicText = pickFirstString(row, [
    "topic_text",
    "topic",
    "normalized_topic",
    "topic_key_candidate",
    "trend_name",
    "name",
  ]);
  const normalizedTopic = normalizeTopic(
    pickFirstString(row, ["normalized_topic", "topic", "topic_key_candidate"]) || topicText,
  );
  const bucketMinute = toIsoMinute(
    row.bucket_minute ?? row.bucket_start ?? row.minute_bucket ?? row.created_at,
  );
  const platform = normalizePlatform(row.platform);
  const topicType = pickFirstString(row, ["topic_type"]) || "entity";

  if (!topicText || !normalizedTopic || !bucketMinute) {
    return null;
  }

  const mentionCount = Math.max(
    0,
    pickFirstNumber(row, [
      "mention_count",
      "mentions",
      "topic_mentions",
      "topic_count",
      "count",
      "total_mentions",
      "count_mentions",
    ], 0),
  );
  const postCount = Math.max(
    0,
    pickFirstNumber(row, ["post_count", "posts", "root_count", "unique_posts", "count_posts"], 0),
  );

  let positiveCount = Math.max(
    0,
    pickFirstNumber(row, [
      "positive_count",
      "sentiment_positive_count",
      "positive_mentions",
      "sentiment_positive",
    ], 0),
  );
  let neutralCount = Math.max(
    0,
    pickFirstNumber(row, [
      "neutral_count",
      "sentiment_neutral_count",
      "neutral_mentions",
      "sentiment_neutral",
    ], 0),
  );
  let negativeCount = Math.max(
    0,
    pickFirstNumber(row, [
      "negative_count",
      "sentiment_negative_count",
      "negative_mentions",
      "sentiment_negative",
    ], 0),
  );

  const rowSentimentLabel = pickFirstString(row, ["sentiment_label"]).toLowerCase();
  const effectiveMentions = mentionCount > 0 ? mentionCount : Math.max(1, postCount);
  if (positiveCount + neutralCount + negativeCount === 0 && rowSentimentLabel) {
    if (rowSentimentLabel === "positive") {
      positiveCount = effectiveMentions;
    } else if (rowSentimentLabel === "negative") {
      negativeCount = effectiveMentions;
    } else {
      neutralCount = effectiveMentions;
    }
  }

  return {
    bucketMinute,
    updatedAt: toIsoTimestamp(row.updated_at ?? row.created_at ?? row.bucket_minute),
    platform,
    topicText,
    normalizedTopic,
    topicType,
    mentionCount: effectiveMentions,
    postCount: Math.max(postCount, effectiveMentions > 0 ? 1 : 0),
    positiveCount,
    neutralCount,
    negativeCount,
    tags: pickStringArray(row, ["tags", "topic_tags"]),
  };
}

function matchesScope(row: ParsedTopicBucketRow, scope: TrendDashboardQuery["scope"]) {
  if (scope !== "memes") {
    return true;
  }

  const haystack = `${row.topicText} ${row.normalizedTopic} ${row.tags.join(" ")}`.toLowerCase();
  return MEME_SCOPE_TERMS.some((term) => haystack.includes(term));
}

function buildSlug(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length > 0) {
    return slug;
  }

  const fallback = Array.from(value)
    .map((char) => char.charCodeAt(0).toString(16))
    .join("")
    .slice(0, 16);
  return `topic-${fallback || "unknown"}`;
}

function hashTopicKey(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function buildTrendId(topic: string) {
  const slug = buildSlug(topic).slice(0, 64);
  const hash = hashTopicKey(topic.toLowerCase());
  return `trend-${slug}-${hash}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function percentDelta(current: number, previous: number) {
  if (previous <= 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}

function getFreshnessState(ageMinutes: number): TrendFreshnessState {
  if (ageMinutes <= 12) {
    return "fresh";
  }
  if (ageMinutes <= 30) {
    return "mixed";
  }
  if (ageMinutes <= 90) {
    return "delayed";
  }
  return "stale";
}

function getLifecycleStage(growthRate: number, freshnessState: TrendFreshnessState): TrendLifecycleStage {
  if (freshnessState === "stale" && growthRate < -20) {
    return "Declining";
  }
  if (growthRate >= 60) {
    return "Emerging";
  }
  if (growthRate >= 20) {
    return "Expanding";
  }
  if (growthRate <= -35) {
    return "Fading";
  }
  return "Established";
}

function ratioOrZero(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

function countThresholdSignals(signals: boolean[]) {
  return signals.reduce((count, signal) => count + (signal ? 1 : 0), 0);
}

function countObservedBuckets(bucketKeys: string[], observedBucketKeys: Set<string>) {
  let count = 0;
  for (const bucketKey of bucketKeys) {
    if (observedBucketKeys.has(bucketKey)) {
      count += 1;
    }
  }
  return count;
}

function meetsStableFreshnessSeedSupport(row: StableTopicDayTotalAggregateRow) {
  const supportSignalCount = countThresholdSignals([
    row.totalMentions >= STABLE_FRESHNESS_SEED_MIN_MENTIONS,
    row.uniquePosts >= STABLE_FRESHNESS_SEED_MIN_POSTS,
    row.uniqueAuthors >= STABLE_FRESHNESS_SEED_MIN_AUTHORS,
  ]);

  return supportSignalCount >= 2 && row.totalMentions >= Math.max(2, Math.floor(STABLE_FRESHNESS_SEED_MIN_MENTIONS / 2));
}

function assessStableSeriesTrust(params: {
  bucketKeys: string[];
  observedBucketKeys: Set<string>;
  values: number[];
  midpoint: number;
  quarter: number;
  mentionCount: number;
  postCount: number;
  uniqueAuthors: number;
}): StableSeriesTrustAssessment {
  const {
    bucketKeys,
    observedBucketKeys,
    values,
    midpoint,
    quarter,
    mentionCount,
    postCount,
    uniqueAuthors,
  } = params;
  const expectedBucketCount = bucketKeys.length;
  const observedBucketCount = observedBucketKeys.size;
  const observedBucketRatio = ratioOrZero(observedBucketCount, expectedBucketCount);
  const nonZeroBucketCount = values.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
  const previousWindowBucketKeys = bucketKeys.slice(0, midpoint);
  const recentWindowBucketKeys = bucketKeys.slice(midpoint);
  const previousWindowObservedBucketCount = countObservedBuckets(previousWindowBucketKeys, observedBucketKeys);
  const recentWindowObservedBucketCount = countObservedBuckets(recentWindowBucketKeys, observedBucketKeys);
  const previousWindowCoverageRatio = ratioOrZero(
    previousWindowObservedBucketCount,
    previousWindowBucketKeys.length,
  );
  const recentWindowCoverageRatio = ratioOrZero(
    recentWindowObservedBucketCount,
    recentWindowBucketKeys.length,
  );
  const previousAccelerationWindowBucketKeys = bucketKeys.slice(
    Math.max(0, bucketKeys.length - quarter * 2),
    bucketKeys.length - quarter,
  );
  const recentAccelerationWindowBucketKeys = bucketKeys.slice(bucketKeys.length - quarter);
  const previousAccelerationWindowObservedBucketCount = countObservedBuckets(
    previousAccelerationWindowBucketKeys,
    observedBucketKeys,
  );
  const recentAccelerationWindowObservedBucketCount = countObservedBuckets(
    recentAccelerationWindowBucketKeys,
    observedBucketKeys,
  );
  const previousAccelerationWindowCoverageRatio = ratioOrZero(
    previousAccelerationWindowObservedBucketCount,
    previousAccelerationWindowBucketKeys.length,
  );
  const recentAccelerationWindowCoverageRatio = ratioOrZero(
    recentAccelerationWindowObservedBucketCount,
    recentAccelerationWindowBucketKeys.length,
  );
  const supportSignalCount = countThresholdSignals([
    mentionCount >= STABLE_MOMENTUM_MIN_MENTIONS,
    postCount >= STABLE_MOMENTUM_MIN_POSTS,
    uniqueAuthors >= STABLE_MOMENTUM_MIN_AUTHORS,
  ]);
  const supportQualified =
    supportSignalCount >= 2 &&
    mentionCount >= Math.max(4, Math.floor(STABLE_MOMENTUM_MIN_MENTIONS / 2));
  const supportRatio = (
    Math.min(1, mentionCount / Math.max(1, STABLE_MOMENTUM_MIN_MENTIONS)) +
    Math.min(1, postCount / Math.max(1, STABLE_MOMENTUM_MIN_POSTS)) +
    Math.min(1, uniqueAuthors / Math.max(1, STABLE_MOMENTUM_MIN_AUTHORS))
  ) / 3;
  const minObservedCoverage = STABLE_MOMENTUM_MIN_OBSERVED_COVERAGE_PCT / 100;
  const minWindowCoverage = STABLE_MOMENTUM_MIN_WINDOW_COVERAGE_PCT / 100;
  const minAccelerationCoverage = STABLE_MOMENTUM_MIN_ACCELERATION_WINDOW_COVERAGE_PCT / 100;
  const growthTrusted =
    supportQualified &&
    observedBucketRatio >= minObservedCoverage &&
    previousWindowCoverageRatio >= minWindowCoverage &&
    recentWindowCoverageRatio >= minWindowCoverage &&
    nonZeroBucketCount >= STABLE_MOMENTUM_MIN_NON_ZERO_BUCKETS;
  const accelerationTrusted =
    supportQualified &&
    observedBucketRatio >= minObservedCoverage &&
    previousAccelerationWindowCoverageRatio >= minAccelerationCoverage &&
    recentAccelerationWindowCoverageRatio >= minAccelerationCoverage &&
    nonZeroBucketCount >= STABLE_MOMENTUM_MIN_NON_ZERO_BUCKETS;
  const velocityTrusted =
    supportQualified &&
    observedBucketRatio >= minObservedCoverage &&
    recentAccelerationWindowCoverageRatio >= minAccelerationCoverage &&
    nonZeroBucketCount >= STABLE_MOMENTUM_MIN_NON_ZERO_BUCKETS;
  const noveltyTrusted = growthTrusted;
  const growthTrustScore = growthTrusted
    ? Math.min(supportRatio, observedBucketRatio, previousWindowCoverageRatio, recentWindowCoverageRatio)
    : 0;
  const accelerationTrustScore = accelerationTrusted
    ? Math.min(
      supportRatio,
      observedBucketRatio,
      previousAccelerationWindowCoverageRatio,
      recentAccelerationWindowCoverageRatio,
    )
    : 0;
  const velocityTrustScore = velocityTrusted
    ? Math.min(supportRatio, observedBucketRatio, recentAccelerationWindowCoverageRatio)
    : 0;
  const noveltyTrustScore = noveltyTrusted ? growthTrustScore : 0;
  const attentionMetricTrusted = supportQualified;
  const breakoutMomentumTrusted = velocityTrusted || noveltyTrusted || growthTrusted || accelerationTrusted;

  return {
    expectedBucketCount,
    observedBucketCount,
    observedBucketRatio,
    nonZeroBucketCount,
    previousWindowObservedBucketCount,
    recentWindowObservedBucketCount,
    previousWindowCoverageRatio,
    recentWindowCoverageRatio,
    previousAccelerationWindowObservedBucketCount,
    recentAccelerationWindowObservedBucketCount,
    previousAccelerationWindowCoverageRatio,
    recentAccelerationWindowCoverageRatio,
    supportSignalCount,
    supportQualified,
    supportRatio,
    growthTrusted,
    accelerationTrusted,
    velocityTrusted,
    noveltyTrusted,
    attentionMetricTrusted,
    breakoutMomentumTrusted,
    growthTrustScore,
    accelerationTrustScore,
    velocityTrustScore,
    noveltyTrustScore,
    momentumTrustScore: Math.max(growthTrustScore, accelerationTrustScore, velocityTrustScore, noveltyTrustScore),
  };
}

function selectStableSeriesSeedRows(
  rows: StableTopicDayTotalAggregateRow[],
  limit: number,
) {
  if (limit <= 0 || rows.length === 0) {
    return [] as StableTopicDayTotalAggregateRow[];
  }

  const mentionSlots = Math.min(rows.length, Math.max(1, Math.ceil(limit * 0.7)));
  const selected: StableTopicDayTotalAggregateRow[] = [];
  const selectedKeys = new Set<string>();

  for (const row of rows.slice(0, mentionSlots)) {
    selected.push(row);
    selectedKeys.add(row.topicKey);
  }

  const freshestRows = [...rows]
    .filter((row) => !selectedKeys.has(row.topicKey))
    .filter((row) => meetsStableFreshnessSeedSupport(row))
    .sort((left, right) => {
      const lastSeenDelta = parseIsoTimestamp(right.lastSeenAt) - parseIsoTimestamp(left.lastSeenAt);
      if (Number.isFinite(lastSeenDelta) && lastSeenDelta !== 0) {
        return lastSeenDelta;
      }
      if (right.uniquePosts !== left.uniquePosts) {
        return right.uniquePosts - left.uniquePosts;
      }
      if (right.totalMentions !== left.totalMentions) {
        return right.totalMentions - left.totalMentions;
      }
      return left.topicKey.localeCompare(right.topicKey);
    });

  for (const row of freshestRows) {
    if (selected.length >= limit) {
      break;
    }
    selected.push(row);
    selectedKeys.add(row.topicKey);
  }

  return selected;
}

function sortRowsByMode(rows: RankedTrend[], mode: TrendLeaderboardMode, sort: TrendSort) {
  const sorted = [...rows];
  const interactionCount = (row: RankedTrend) => row.totalInteractions24h ?? row.mentions ?? row.attentionInteractions ?? 0;
  const compareNumber = (
    left: RankedTrend,
    right: RankedTrend,
    select: (row: RankedTrend) => number | null | undefined,
  ) => (select(right) ?? 0) - (select(left) ?? 0);
  const stableSupportComparator = (left: RankedTrend, right: RankedTrend) =>
    compareNumber(left, right, (row) => interactionCount(row)) ||
    compareNumber(left, right, (row) => row.supportingThreadCount ?? row.rootsCount24h) ||
    compareNumber(left, right, (row) => row.trendStrengthScore) ||
    compareNumber(left, right, (row) => row.confirmationScore) ||
    compareNumber(left, right, (row) => row.uniqueAuthors24h) ||
    left.id.localeCompare(right.id);
  const byInteractionTiebreak = (left: RankedTrend, right: RankedTrend) =>
    compareNumber(left, right, (row) => interactionCount(row)) ||
    compareNumber(left, right, (row) => row.attentionInteractions) ||
    compareNumber(left, right, (row) => row.supportingThreadCount ?? row.rootsCount24h) ||
    compareNumber(left, right, (row) => row.uniqueAuthors24h) ||
    left.id.localeCompare(right.id);

  sorted.sort((left, right) => {
    if (sort === "posts") {
      return compareTrendsByPosts(left, right);
    }

    if (mode === "emerging") {
      if (sort === "velocity") {
        return compareNumber(left, right, (row) => row.velocityScore) ||
          compareNumber(left, right, (row) => row.breakoutScore ?? row.emergingScore) ||
          compareNumber(left, right, (row) => row.freshnessScore) ||
          stableSupportComparator(left, right);
      }
      if (sort === "novelty") {
        return compareNumber(left, right, (row) => row.noveltyScore) ||
          compareNumber(left, right, (row) => row.growthRate) ||
          compareNumber(left, right, (row) => row.breakoutScore ?? row.emergingScore) ||
          stableSupportComparator(left, right);
      }
      if (sort === "confirmation") {
        return compareNumber(left, right, (row) => row.confirmationScore) ||
          compareNumber(left, right, (row) => row.breakoutScore ?? row.emergingScore) ||
          compareNumber(left, right, (row) => row.velocityScore) ||
          stableSupportComparator(left, right);
      }

      return compareNumber(left, right, (row) => row.breakoutScore ?? row.emergingScore) ||
        compareNumber(left, right, (row) => row.velocityScore) ||
        compareNumber(left, right, (row) => row.noveltyScore) ||
        compareNumber(left, right, (row) => row.confirmationScore) ||
        stableSupportComparator(left, right);
    }

    if (sort === "growth") {
      return compareNumber(left, right, (row) => row.growthRate) ||
        compareNumber(left, right, (row) => row.attentionAcceleration) ||
        compareNumber(left, right, (row) => row.freshnessScore) ||
        stableSupportComparator(left, right);
    }

    if (sort === "mentions") {
      return compareNumber(left, right, (row) => row.mentions) ||
        compareNumber(left, right, (row) => row.attentionScore) ||
        stableSupportComparator(left, right);
    }

    if (sort === "strength") {
      return compareNumber(left, right, (row) => row.trendStrengthScore) ||
        compareNumber(left, right, (row) => row.attentionScore) ||
        stableSupportComparator(left, right);
    }

    return compareNumber(left, right, (row) => row.attentionScore) ||
      compareNumber(left, right, (row) => row.trendStrengthScore) ||
      stableSupportComparator(left, right) ||
      byInteractionTiebreak(left, right);
  });

  return sorted;
}

function hasUsableAiDisplayName(row: RankedTrend) {
  const status = row.trendEnrichment?.status ?? row.trendEnrichmentStatus ?? null;
  return row.aiAssisted && (status === "ok" || status === "mixed");
}

function prioritizeAiNamedRows(rows: RankedTrend[], limit: number) {
  return rows.slice(0, limit);
}

function buildWindow(points: TimeSeriesPoint[], range: DateRangePreset, bucketMinutes: number): TimeSeriesWindow | null {
  if (points.length === 0) {
    return null;
  }

  const windowStart = points[0]?.timestamp;
  const windowEnd = points.at(-1)?.timestamp;
  if (!windowStart || !windowEnd) {
    return null;
  }

  const latestPoint = [...points]
    .reverse()
    .find((point) => Number.isFinite(Date.parse(point.timestamp))) ?? null;
  const latestDataPoint = [...points].reverse().find((point) => point.value > 0) ?? null;
  const endMs = Date.parse(windowEnd);
  const latestPointMs = latestPoint ? Date.parse(latestPoint.timestamp) : Number.NaN;
  const staleGapMinutes =
    Number.isFinite(endMs) && Number.isFinite(latestPointMs)
      ? Math.max(0, Math.round((endMs - latestPointMs) / 60_000))
      : null;
  const trailingGapBucketCount =
    staleGapMinutes !== null ? Math.max(0, Math.floor(staleGapMinutes / bucketMinutes)) : 0;

  return {
    range,
    windowStart,
    windowEnd,
    latestPointAt: latestPoint?.timestamp ?? null,
    latestDataAt: latestDataPoint?.timestamp ?? null,
    staleGapMinutes,
    trailingGapBucketCount,
    hasTrailingGap: trailingGapBucketCount > 0,
    bucketIntervalMinutes: bucketMinutes,
  };
}

function toSupabaseDataStatus(params: {
  rowCount: number;
  source: string;
  latestSourceAt: string | null;
  freshnessProbe: SupabaseFreshnessProbeRow | null;
}): DashboardDataStatus {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const sourceSnapshotAt = resolveCanonicalSourceSnapshotAt(
    params.latestSourceAt,
    params.freshnessProbe,
  );
  const latestBucketMs = sourceSnapshotAt ? Date.parse(sourceSnapshotAt) : Number.NaN;
  const ageMinutes =
    Number.isFinite(latestBucketMs)
      ? Math.max(0, Math.round((nowMs - latestBucketMs) / 60_000))
      : null;
  const freshnessDiagnostics: DashboardFreshnessDiagnostics = {
    latestIngestionAt: params.freshnessProbe?.latestIngestionAt ?? null,
    latestProcessedAt: params.freshnessProbe?.latestProcessedAt ?? null,
    latestMentionEventAt: params.freshnessProbe?.latestMentionEventAt ?? null,
    latestReadModelFinalizeAt: params.freshnessProbe?.latestReadModelFinalizeAt ?? null,
    latestReadModelRollingWriteAt: params.freshnessProbe?.latestReadModelRollingWriteAt ?? null,
    latestReadModelSeriesWriteAt: params.freshnessProbe?.latestReadModelSeriesWriteAt ?? null,
    latestReadModelWindowEndAt: params.freshnessProbe?.latestReadModelWindowEndAt ?? null,
    latestSeriesNonZeroBucketAt: params.freshnessProbe?.latestSeriesNonZeroBucketAt ?? null,
    workerRunStartedAt: params.freshnessProbe?.workerRunStartedAt ?? null,
    workerRunStatus: params.freshnessProbe?.workerRunStatus ?? null,
    workerLastEventAt: params.freshnessProbe?.workerLastEventAt ?? null,
    workerRowsInserted: params.freshnessProbe?.workerRowsInserted ?? null,
    workerHeartbeatAt: params.freshnessProbe?.workerHeartbeatAt ?? null,
    workerCurrentStage: params.freshnessProbe?.workerCurrentStage ?? null,
    workerLastSuccessfulWriteAt: params.freshnessProbe?.workerLastSuccessfulWriteAt ?? null,
    maxSourceTimestampSeen: params.freshnessProbe?.maxSourceTimestampSeen ?? null,
    maxWrittenTimestamp: params.freshnessProbe?.maxWrittenTimestamp ?? null,
    maxProcessedTimestamp: params.freshnessProbe?.maxProcessedTimestamp ?? null,
    maxAggregateTimestamp: params.freshnessProbe?.maxAggregateTimestamp ?? null,
    pipelineLagSeconds: params.freshnessProbe?.pipelineLagSeconds ?? null,
    backlogSize: params.freshnessProbe?.backlogSize ?? null,
    unprocessedBacklogSize: params.freshnessProbe?.unprocessedBacklogSize ?? null,
    pipelineHealthState: null,
    apiResponseAt: nowIso,
    sourceSnapshotAt,
    selectedTrendLatestDataAt: null,
    selectedTrendLatestPointAt: null,
    renderedStaleReferenceAt: null,
    renderedStaleReferenceSource: null,
    chainBreakStage: null,
    agesMinutes: {
      ingestion: ageMinutesFromIso(params.freshnessProbe?.latestIngestionAt, nowMs),
      processed: ageMinutesFromIso(params.freshnessProbe?.latestProcessedAt, nowMs),
      mentionEvent: ageMinutesFromIso(params.freshnessProbe?.latestMentionEventAt, nowMs),
      readModelFinalize: ageMinutesFromIso(params.freshnessProbe?.latestReadModelFinalizeAt, nowMs),
      readModelWrite: ageMinutesFromIso(
        params.freshnessProbe?.latestReadModelRollingWriteAt ??
          params.freshnessProbe?.latestReadModelSeriesWriteAt,
        nowMs,
      ),
      readModelWindowEnd: ageMinutesFromIso(params.freshnessProbe?.latestReadModelWindowEndAt, nowMs),
      workerLastEvent: ageMinutesFromIso(params.freshnessProbe?.workerLastEventAt, nowMs),
      sourceSnapshot: ageMinutesFromIso(sourceSnapshotAt, nowMs),
      selectedLatestPoint: null,
      selectedLatestData: null,
      renderedStaleReference: null,
    },
  };
  if (
    (freshnessDiagnostics.pipelineLagSeconds === null ||
      freshnessDiagnostics.pipelineLagSeconds === undefined) &&
    freshnessDiagnostics.latestIngestionAt
  ) {
    freshnessDiagnostics.pipelineLagSeconds = ageSecondsFromIso(
      freshnessDiagnostics.latestIngestionAt,
      nowMs,
    );
  }

  const workerStatus = String(freshnessDiagnostics.workerRunStatus ?? "").trim().toLowerCase();
  const workerHeartbeatAgeSeconds = ageSecondsFromIso(
    freshnessDiagnostics.workerHeartbeatAt ?? null,
    nowMs,
  );
  const heartbeatStale =
    workerStatus === "running" &&
    (workerHeartbeatAgeSeconds === null || workerHeartbeatAgeSeconds > 60);
  const workerStatusLooksHealthy =
    workerStatus.length === 0 ||
    workerStatus === "running" ||
    workerStatus === "active" ||
    workerStatus === "healthy" ||
    workerStatus === "success";
  const processingAge = freshnessDiagnostics.agesMinutes.processed;
  const ingestionAge = freshnessDiagnostics.agesMinutes.ingestion;
  const finalizeAge = freshnessDiagnostics.agesMinutes.readModelFinalize;
  const sourceAge = freshnessDiagnostics.agesMinutes.sourceSnapshot;
  if (ingestionAge !== null && ingestionAge > 15) {
    freshnessDiagnostics.chainBreakStage = "ingestion";
  } else if ((!workerStatusLooksHealthy || heartbeatStale) && ingestionAge === null) {
    freshnessDiagnostics.chainBreakStage = "ingestion";
  } else if (processingAge !== null && processingAge > 15) {
    freshnessDiagnostics.chainBreakStage = "processing";
  } else if (finalizeAge !== null && finalizeAge > 15) {
    freshnessDiagnostics.chainBreakStage = "read_model_refresh";
  } else if (sourceAge !== null && sourceAge > 15) {
    freshnessDiagnostics.chainBreakStage = "api_cache";
  } else {
    freshnessDiagnostics.chainBreakStage = "none";
  }

  if (!workerStatusLooksHealthy || heartbeatStale) {
    freshnessDiagnostics.pipelineHealthState = "disconnected";
  } else if (ingestionAge !== null && ingestionAge > 15) {
    freshnessDiagnostics.pipelineHealthState = "stale";
  } else if (
    typeof freshnessDiagnostics.pipelineLagSeconds === "number" &&
    freshnessDiagnostics.pipelineLagSeconds > 5 * 60
  ) {
    freshnessDiagnostics.pipelineHealthState = "degraded";
  } else if (
    (ingestionAge !== null && ingestionAge > 5) ||
    (processingAge !== null && processingAge > 5) ||
    (sourceAge !== null && sourceAge > 5)
  ) {
    freshnessDiagnostics.pipelineHealthState = "delayed";
  } else {
    freshnessDiagnostics.pipelineHealthState = "live";
  }

  return {
    stateSource: "supabase_live",
    bundleOrigin: null,
    showing: "supabase_live",
    serverNow: nowIso,
    runtimeSnapshotGeneratedAt: null,
    sourceSnapshotGeneratedAt: sourceSnapshotAt,
    latestFetchedAt: nowIso,
    runtimeSnapshotAvailable: false,
    localRawDataAvailable: params.rowCount > 0,
    runtimeSnapshotStale: false,
    sourceFreshness: [
      {
        sourceId: `supabase:${params.source}`,
        sourceLabel: params.source,
        platformId: "bluesky",
        sourceStatus:
          params.rowCount <= 0
            ? "empty"
            : ageMinutes === null
              ? "unknown"
              : ageMinutes <= 5
                ? "fresh"
                : ageMinutes <= 15
                  ? "delayed"
                  : "stale",
        itemCount: params.rowCount,
        lastFetchedAt: nowIso,
        latestCreatedAt: sourceSnapshotAt,
        ageMinutes,
      },
    ],
    freshnessDiagnostics,
    refresh: null,
    timings: null,
  };
}

function attachSeriesWindows(vm: TrendDashboardVM, range: DateRangePreset, bucketMinutes: number) {
  const withOverviewWindows = vm.overviewSeries.map((series) => ({
    ...series,
    window: buildWindow(series.points, range, bucketMinutes),
  }));

  const detail = vm.detail
    ? {
        ...vm.detail,
        attentionWindow: buildWindow(vm.detail.attentionGraph, range, bucketMinutes),
      }
    : null;

  return {
    ...vm,
    overviewSeries: withOverviewWindows,
    detail,
  };
}

function annotateSelectedFreshnessDiagnostics(vm: TrendDashboardVM): TrendDashboardVM {
  const diagnostics = vm.dataStatus?.freshnessDiagnostics;
  const detailWindow = vm.detail?.attentionWindow;
  if (!vm.dataStatus || !diagnostics || !detailWindow) {
    return vm;
  }

  const nowMs = Date.now();
  const selectedLatestPointAge = ageMinutesFromIso(detailWindow.latestPointAt, nowMs);
  const selectedLatestDataAge = ageMinutesFromIso(detailWindow.latestDataAt, nowMs);
  const sourceSnapshotAge = diagnostics.agesMinutes.sourceSnapshot;
  const renderedReferenceAt = diagnostics.sourceSnapshotAt ?? detailWindow.latestPointAt ?? null;
  const renderedReferenceSource = diagnostics.sourceSnapshotAt ? "source_snapshot" : "latest_point";
  const renderedReferenceAge = diagnostics.sourceSnapshotAt ? sourceSnapshotAge : selectedLatestPointAge;
  const renderMismatch =
    renderedReferenceSource !== "source_snapshot" &&
    sourceSnapshotAge !== null &&
    sourceSnapshotAge <= 6 &&
    selectedLatestDataAge !== null &&
    selectedLatestDataAge >= sourceSnapshotAge + 10;

  return {
    ...vm,
    dataStatus: {
      ...vm.dataStatus,
      freshnessDiagnostics: {
        ...diagnostics,
        selectedTrendLatestPointAt: detailWindow.latestPointAt ?? null,
        selectedTrendLatestDataAt: detailWindow.latestDataAt ?? null,
        renderedStaleReferenceAt: renderedReferenceAt,
        renderedStaleReferenceSource: renderedReferenceSource,
        chainBreakStage: renderMismatch ? "render_stale_field" : diagnostics.chainBreakStage,
        agesMinutes: {
          ...diagnostics.agesMinutes,
          selectedLatestPoint: selectedLatestPointAge,
          selectedLatestData: selectedLatestDataAge,
          renderedStaleReference: renderedReferenceAge,
        },
      },
    },
  };
}

function buildBlueskyOverview(
  rows: RankedTrend[],
  allPoints: TimeSeriesPoint[],
  range: DateRangePreset,
  bucketMinutes: number,
  sourceLagMinutes: number | null,
): TrendDashboardVM["blueskyOverview"] {
  const totalInteractions = rows.reduce(
    (sum, row) => sum + Math.max(0, row.attentionInteractions),
    0,
  );
  const replayWindow = buildWindow(allPoints, range, bucketMinutes);

  return {
    generatedAt: new Date().toISOString(),
    firehoseLagMinutes: sourceLagMinutes,
    attentionSharePct: 100,
    engagementIntensity: totalInteractions,
    meaningfulAttentionScore: totalInteractions,
    narrativeCount: rows.length,
    accountSpread: rows.reduce((sum, row) => sum + (row.uniqueAuthors24h ?? 0), 0),
    postsPerMinute: bucketMinutes > 0 ? totalInteractions / (bucketMinutes * Math.max(1, allPoints.length)) : 0,
    likesPerMinute: 0,
    repostsPerMinute: 0,
    repliesPerMinute: 0,
    quotesPerMinute: 0,
    accelerationScore: rows.length > 0
      ? rows.reduce((sum, row) => sum + row.attentionAcceleration, 0) / rows.length
      : 0,
    noiseRatioPct: 0,
    leaders: rows.slice(0, 8).map((row) => ({
      id: row.id,
      label: row.name,
      trendId: row.id,
      attentionScore: row.attentionScore,
      velocity: row.velocityScore ?? 0,
      accelerationScore: row.attentionAcceleration,
      attentionSharePct: totalInteractions > 0
        ? (row.attentionInteractions / totalInteractions) * 100
        : 0,
      uniqueAuthors: row.uniqueAuthors24h ?? 0,
      amplificationScore: row.breakoutScore ?? row.emergingScore ?? 0,
      topAmplifierHandle: null,
    })),
    emerging: rows
      .filter((row) => (row.breakoutScore ?? 0) > 0 || row.growthRate > 0)
      .slice(0, 8)
      .map((row) => ({
        id: row.id,
        label: row.name,
        trendId: row.id,
        attentionScore: row.attentionScore,
        velocity: row.velocityScore ?? 0,
        accelerationScore: row.attentionAcceleration,
        attentionSharePct: totalInteractions > 0
          ? (row.attentionInteractions / totalInteractions) * 100
          : 0,
        uniqueAuthors: row.uniqueAuthors24h ?? 0,
        amplificationScore: row.breakoutScore ?? row.emergingScore ?? 0,
        topAmplifierHandle: null,
      })),
    topAmplifiers: [],
    cascades: [],
    clusters: [],
    network: {
      nodes: [],
      edges: [],
    },
    replay: allPoints,
    replayWindow,
  };
}

async function getSupabaseTrendDashboardStateLegacy(
  query: TrendDashboardQuery,
  options: SupabaseTrendDashboardStateOptions = {},
): Promise<TrendDashboardVM> {
  const window = buildWindowBuckets(query.range);
  const freshnessProbePromise =
    options.includeFreshnessProbe === false
      ? Promise.resolve(null)
      : fetchSupabaseFreshnessProbe();
  const [{ rows, source }, freshnessProbe] = await Promise.all([
    fetchTopicRows(
      window.windowStart.toISOString(),
      window.windowEnd.toISOString(),
    ),
    freshnessProbePromise,
  ]);

  const parsedRows = rows
    .map((row) => parseTopicRow(row))
    .filter((row): row is ParsedTopicBucketRow => Boolean(row))
    .filter((row) => matchesScope(row, query.scope));

  if (parsedRows.length === 0) {
    const zero = createZeroTrendDashboardVM(query);
    return {
      ...zero,
      dataStatus: toSupabaseDataStatus({
        rowCount: rows.length,
        source,
        latestSourceAt: null,
        freshnessProbe,
      }),
    };
  }

  const bucketSet = new Set(window.buckets);
  const aggregateMap = new Map<string, TopicAggregate>();
  let latestSourceTimestampMs = Number.NaN;

  for (const row of parsedRows) {
    const bucketKey = bucketKeyForIso(row.bucketMinute, window.bucketMinutes);
    if (!bucketSet.has(bucketKey)) {
      continue;
    }
    const bucketMs = Date.parse(bucketKey);
    const sourceMs = Number.isFinite(bucketMs)
      ? bucketMs
      : row.updatedAt
        ? Date.parse(row.updatedAt)
        : Number.NaN;
    if (Number.isFinite(sourceMs)) {
      latestSourceTimestampMs = Number.isFinite(latestSourceTimestampMs)
        ? Math.max(latestSourceTimestampMs, sourceMs)
        : sourceMs;
    }

    const topicKey = row.normalizedTopic.toLowerCase();
    const existing = aggregateMap.get(topicKey);
    if (!existing) {
      aggregateMap.set(topicKey, {
        topicText: row.topicText,
        normalizedTopic: row.normalizedTopic,
        mentionCount: row.mentionCount,
        postCount: row.postCount,
        positiveCount: row.positiveCount,
        neutralCount: row.neutralCount,
        negativeCount: row.negativeCount,
        platforms: new Map([[row.platform, row.mentionCount]]),
        bucketCounts: new Map([[bucketKey, row.mentionCount]]),
        firstSeenAt: row.bucketMinute,
        lastSeenAt: row.bucketMinute,
      });
      continue;
    }

    existing.mentionCount += row.mentionCount;
    existing.postCount += row.postCount;
    existing.positiveCount += row.positiveCount;
    existing.neutralCount += row.neutralCount;
    existing.negativeCount += row.negativeCount;
    existing.platforms.set(row.platform, (existing.platforms.get(row.platform) ?? 0) + row.mentionCount);
    existing.bucketCounts.set(bucketKey, (existing.bucketCounts.get(bucketKey) ?? 0) + row.mentionCount);

    if (!existing.firstSeenAt || Date.parse(row.bucketMinute) < Date.parse(existing.firstSeenAt)) {
      existing.firstSeenAt = row.bucketMinute;
    }
    if (!existing.lastSeenAt || Date.parse(row.bucketMinute) > Date.parse(existing.lastSeenAt)) {
      existing.lastSeenAt = row.bucketMinute;
    }
  }

  const rankedBaseRows: RankedTrend[] = [];
  const allTrendTotalsByBucket = new Map<string, number>();
  const nowMs = Date.now();
  const legacyEnrichmentByTopicKey = await fetchTopicEnrichmentByTopicKeys(
    [...aggregateMap.keys()],
    window.windowEnd.toISOString(),
  );

  for (const topic of aggregateMap.values()) {
    const enrichment =
      legacyEnrichmentByTopicKey.get(topic.normalizedTopic) ??
      legacyEnrichmentByTopicKey.get(topic.normalizedTopic.toLowerCase()) ??
      null;
    const points: TimeSeriesPoint[] = window.buckets.map((bucketIso) => {
      const value = topic.bucketCounts.get(bucketIso) ?? 0;
      allTrendTotalsByBucket.set(bucketIso, (allTrendTotalsByBucket.get(bucketIso) ?? 0) + value);
      return {
        timestamp: bucketIso,
        value,
      };
    });

    const values = points.map((point) => point.value);
    const midpoint = Math.max(1, Math.floor(values.length / 2));
    const quarter = Math.max(1, Math.floor(values.length / 4));
    const previousHalf = values.slice(0, midpoint).reduce((sum, value) => sum + value, 0);
    const recentHalf = values.slice(midpoint).reduce((sum, value) => sum + value, 0);
    const previousQuarter = values.slice(Math.max(0, values.length - quarter * 2), values.length - quarter)
      .reduce((sum, value) => sum + value, 0);
    const recentQuarter = values.slice(values.length - quarter).reduce((sum, value) => sum + value, 0);
    const growthRate = clamp(percentDelta(recentHalf, previousHalf), -100, 400);
    const acceleration = clamp(percentDelta(recentQuarter, previousQuarter), -100, 400);

    const latestDataPoint = [...points].reverse().find((point) => point.value > 0);
    const latestDataMs = latestDataPoint ? Date.parse(latestDataPoint.timestamp) : Number.NaN;
    const ageMinutes = Number.isFinite(latestDataMs)
      ? Math.max(0, Math.round((nowMs - latestDataMs) / 60_000))
      : 10_000;
    const freshnessState = getFreshnessState(ageMinutes);
    const freshnessScore = clamp(100 - ageMinutes * 1.6, 0, 100);

    const platforms = [...topic.platforms.keys()];
    const platformTotal = Math.max(1, topic.mentionCount);
    const platformBreakdown = [...topic.platforms.entries()].map(([platform, interactions]) => ({
      platformId: platform,
      interactions,
      sharePct: (interactions / platformTotal) * 100,
    }));
    platformBreakdown.sort((left, right) => right.interactions - left.interactions);

    const lowDataWarning = topic.mentionCount < 8;
    const confidenceScore = clamp(
      25 +
        Math.log2(Math.max(1, topic.mentionCount + topic.postCount)) * 16 +
        Math.min(20, platforms.length * 6) +
        Math.max(-10, Math.min(10, growthRate / 8)),
      0,
      100,
    );
    const velocityScore = clamp(recentQuarter * (60 / window.bucketMinutes), 0, 1000);
    const noveltyScore = clamp(
      growthRate > 0 ? growthRate * 0.65 + (lowDataWarning ? 12 : 0) : growthRate * 0.35,
      0,
      100,
    );
    const sentimentTotal = topic.positiveCount + topic.neutralCount + topic.negativeCount;
    const sentimentBalance = sentimentTotal > 0
      ? (topic.positiveCount - topic.negativeCount) / sentimentTotal
      : 0;
    const confirmationScore = clamp(
      Math.min(100, topic.postCount * 2.4 + platforms.length * 7 + confidenceScore * 0.25),
      0,
      100,
    );
    const breakoutScore = clamp(
      velocityScore * 0.38 +
        noveltyScore * 0.36 +
        confirmationScore * 0.26 +
        sentimentBalance * 12,
      0,
      100,
    );
    const trendStrengthScore = clamp(
      topic.mentionCount * 0.14 +
        confidenceScore * 0.35 +
        Math.max(0, growthRate) * 0.12 +
        freshnessScore * 0.28,
      0,
      100,
    );

    const row = createZeroRankedTrend(query.scope, query.range);
    const id = buildTrendId(topic.normalizedTopic);
    const defaultDisplayLabel = pickNarrativeStableDisplayLabel(topic.normalizedTopic);
    row.id = id;
    row.name = defaultDisplayLabel || TREND_NAME_PLACEHOLDER;
    row.displayName = defaultDisplayLabel || null;
    row.nameStatus = "pending";
    row.nameSource = "raw";
    row.clusterId = id;
    row.clusterName = defaultDisplayLabel || TREND_NAME_PLACEHOLDER;
    row.scope = query.scope;
    row.source = "bluesky";
    row.labelType = "entity_label";
    row.groupingSource = "fallback_singleton";
    row.leaderboardTier = lowDataWarning ? "secondary_singleton" : "primary_grouped";
    row.canonicalKeySummary = topic.normalizedTopic;
    row.labelQualityScore = clamp(0.55 + (topic.mentionCount > 20 ? 0.3 : 0.15), 0, 1);
    row.lowQualityLabel = lowDataWarning;
    row.aiAssisted = false;
    row.attentionInteractions = topic.mentionCount;
    row.totalInteractions24h = topic.mentionCount;
    row.qualityAdjustedScore = trendStrengthScore;
    row.attentionScore = clamp(
      topic.mentionCount * 0.2 + trendStrengthScore * 0.35 + Math.max(0, growthRate) * 0.2,
      0,
      1000,
    );
    row.emergingScore = breakoutScore;
    row.breakoutScore = breakoutScore;
    row.velocityScore = velocityScore;
    row.noveltyScore = noveltyScore;
    row.confirmationScore = confirmationScore;
    row.rootsCount24h = topic.postCount;
    row.uniqueAuthors24h = 0;
    row.positiveMentions24h = topic.positiveCount;
    row.neutralMentions24h = topic.neutralCount;
    row.negativeMentions24h = topic.negativeCount;
    row.sentimentBalance = sentimentBalance;
    row.singleAuthorShare = 0;
    row.firstSeenAt = topic.firstSeenAt;
    row.lastSeenAt = topic.lastSeenAt;
    row.isSingleton = topic.postCount <= 1;
    row.trendCategory = null;
    row.trendDescription = null;
    row.trendContextParagraph = null;
    row.trendNarrativeSummary = null;
    row.trendRawLabel = topic.normalizedTopic;
    row.trendFallbackLabel = normalizeTopic(topic.normalizedTopic) || topic.normalizedTopic;
    row.trendSummaryConfidence = null;
    row.trendEnrichmentStatus = null;
    row.trendEnrichmentAbstainReason = null;
    row.trendKeyEntities = null;
    row.trendEnrichment = null;
    row.contentType = null;
    row.spamLikelihood = 0;
    row.templateLikelihood = 0;
    row.contextualCoherence = undefined;
    row.lowInformation = lowDataWarning;
    row.templateSeries = false;
    row.confidenceScore = confidenceScore;
    row.freshnessScore = freshnessScore;
    row.freshnessState = freshnessState;
    row.sampleSize = topic.mentionCount;
    row.supportingThreadCount = topic.postCount;
    row.lowDataWarning = lowDataWarning;
    row.growthRate = growthRate;
    row.attentionAcceleration = acceleration;
    row.mentions = topic.mentionCount;
    row.platforms = platforms.length > 0 ? platforms : ["bluesky"];
    row.platformSpread = row.platforms.length;
    row.confirmedPlatformSpread = row.platforms.length;
    row.attentionHistory = points;
    row.platformBreakdown = platformBreakdown;
    row.topPosts = [];
    row.lifecycleStage = getLifecycleStage(growthRate, freshnessState);
    row.originPlatform = row.platforms[0] ?? "bluesky";
    row.platformMigrationPath = [...row.platforms];
    row.attentionDrivers = platformBreakdown.map((entry) => ({
      platformId: entry.platformId,
      contributionPct: entry.sharePct,
      deltaPct: 0,
    }));
    row.hasSpike = acceleration >= 60;
    row.spikeMagnitude = row.hasSpike ? clamp(acceleration / 100, 0, 4) : 0;
    row.trendStrengthScore = trendStrengthScore;
    row.persistenceScore = clamp(confidenceScore * 0.6 + topic.postCount * 0.9, 0, 100);
    row.isEarlyTrend = topic.postCount <= 5 && growthRate >= 20;
    row.positionChange24h = 0;
    row.googleSearchInterest = null;
    row.blueskySummary = {
      attentionSharePct: 100,
      postCount: topic.postCount,
      uniqueAuthorCount: 0,
      amplifierCount: 0,
      topAmplifierHandle: null,
      leadingSignalLabel: TREND_NAME_PLACEHOLDER,
      firehoseLagMinutes: ageMinutes,
      repostVelocity: 0,
      replyVelocity: 0,
      quoteVelocity: 0,
    };
    row.blueskyDetail = null;
    row.trendRawLabel = topic.normalizedTopic;
    row.trendFallbackLabel = defaultDisplayLabel || null;
    applyTopicEnrichmentToRankedTrend(row, topic.normalizedTopic, enrichment);

    rankedBaseRows.push(row);
  }

  const emergingCandidates = rankedBaseRows
    .filter((row) => row.isEarlyTrend || row.growthRate > 10 || (row.breakoutScore ?? 0) > 18);
  const emergingSeedRows = emergingCandidates.length > 0 ? emergingCandidates : rankedBaseRows;
  const selectedMode = query.mode ?? "established";

  const establishedRows = prioritizeAiNamedRows(
    sortRowsByMode(
    rankedBaseRows.map((row) => ({
      ...row,
      leaderboardMode: "established",
    })),
    "established",
    query.sort,
    ),
    MAX_LEADERBOARD_ROWS,
  )
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));

  const emergingRows = prioritizeAiNamedRows(
    sortRowsByMode(
    emergingSeedRows.map((row) => {
      const current = rankedBaseRows.find((candidate) => candidate.id === row.id) ?? row;
      return {
        ...current,
        leaderboardMode: "emerging",
      };
    }),
    "emerging",
    query.sort,
    ),
    MAX_LEADERBOARD_ROWS,
  )
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));

  const selectedLeaderboard = selectedMode === "emerging" ? emergingRows : establishedRows;
  const aggregatePoints = window.buckets.map((bucket) => ({
    timestamp: bucket,
    value: allTrendTotalsByBucket.get(bucket) ?? 0,
  }));
  const latestBucketAt = aggregatePoints
    .slice()
    .reverse()
    .find((point) => point.value > 0)?.timestamp ?? null;
  const latestSourceAt = Number.isFinite(latestSourceTimestampMs)
    ? new Date(latestSourceTimestampMs).toISOString()
    : latestBucketAt;
  const sourceLagMinutes = ageMinutesFromIso(latestSourceAt, Date.now());

  const resolvedSelectedId = query.selectedId;
  const vm: TrendDashboardVM = {
    query: {
      ...query,
      mode: selectedMode,
      selectedId: resolvedSelectedId,
    },
    ingestionHealth: null,
    dataStatus: toSupabaseDataStatus({
      rowCount: parsedRows.length,
      source,
      latestSourceAt,
      freshnessProbe,
    }),
    blueskyOverview: buildBlueskyOverview(
      selectedLeaderboard,
      aggregatePoints,
      query.range,
      window.bucketMinutes,
      sourceLagMinutes,
    ),
    trendCoverage: null,
    leaderboards: {
      established: establishedRows,
      emerging: emergingRows,
    },
    leaderboard: selectedLeaderboard,
    overviewSeries: [],
    detail: null,
  };

  const selectedVm = applyTrendDashboardSelection(vm, resolvedSelectedId);
  return annotateSelectedFreshnessDiagnostics(
    attachSeriesWindows(selectedVm, query.range, window.bucketMinutes),
  );
}

function matchesStableScope(row: StableTopicDayTotalRow, scope: TrendDashboardQuery["scope"]) {
  if (scope !== "memes") {
    return true;
  }

  const haystack = `${row.topicLabel} ${row.topicKey}`.toLowerCase();
  return MEME_SCOPE_TERMS.some((term) => haystack.includes(term));
}

type SupabaseTrendDashboardStateOptions = {
  readProfile?: SupabaseTrendReadProfile;
  includeFreshnessProbe?: boolean;
};

async function getSupabaseTrendDashboardStateStable(
  query: TrendDashboardQuery,
  options: SupabaseTrendDashboardStateOptions = {},
): Promise<TrendDashboardVM> {
  const readProfile = options.readProfile ?? "summary";
  const window = buildWindowBuckets(query.range);
  const dayIsos = buildWindowDayIsos(window.windowStart, window.windowEnd);
  const requestedStableTopicKey = normalizeRequestedStableTopicKey(query.selectedKey);
  const freshnessProbePromise =
    options.includeFreshnessProbe === false
      ? Promise.resolve(null)
      : fetchSupabaseFreshnessProbe();
  const windowTotalsPromise =
    query.range === "24h"
      ? fetchStableRollingTotals()
      : fetchStableWindowTotals(
          window.windowStart.toISOString(),
          window.windowEnd.toISOString(),
        );
  const [freshnessProbe, windowTotalsResult] = await Promise.all([
    freshnessProbePromise,
    windowTotalsPromise,
  ]);
  const rawTotalsRows = windowTotalsResult.rows;
  const totalsSource = windowTotalsResult.source;

  const parsedTotalsRows = rawTotalsRows
    .map((row) => parseStableDayTotalRow(row))
    .filter((row): row is StableTopicDayTotalRow => Boolean(row))
    .filter((row) => matchesStableScope(row, query.scope));
  const aggregatedTotalsByStableKey = new Map<string, StableTopicDayTotalAggregateRow>();
  for (const row of parsedTotalsRows) {
    const resolvedStableTopicKey = resolveStableTopicIdentity(row.topicKey, row.topicLabel);
    const stableTopicKey =
      readProfile === "detail" &&
      requestedStableTopicKey &&
      row.topicKey === requestedStableTopicKey
        ? requestedStableTopicKey
        : resolvedStableTopicKey;
    if (!stableTopicKey) {
      continue;
    }

    const stableTopicLabel = normalizeTopic(row.topicLabel || stableTopicKey) || stableTopicKey;
    const existing = aggregatedTotalsByStableKey.get(stableTopicKey);
    if (!existing) {
      aggregatedTotalsByStableKey.set(stableTopicKey, {
        ...row,
        topicKey: stableTopicKey,
        topicLabel: stableTopicLabel,
        rawTopicKeys: buildStableTopicLookupKeys(row.topicKey, row.topicLabel, stableTopicKey),
        sourceTopicKeys: [row.topicKey],
      });
      continue;
    }

    existing.totalMentions += row.totalMentions;
    existing.uniquePosts += row.uniquePosts;
    existing.uniqueAuthors += row.uniqueAuthors;
    existing.positiveCount += row.positiveCount;
    existing.neutralCount += row.neutralCount;
    existing.negativeCount += row.negativeCount;
    existing.platformCount = Math.max(existing.platformCount, row.platformCount);
    existing.firstSeenAt = minIsoTimestamp(existing.firstSeenAt, row.firstSeenAt);
    existing.lastSeenAt = maxIsoTimestamp(existing.lastSeenAt, row.lastSeenAt);
    for (const lookupKey of buildStableTopicLookupKeys(row.topicKey, row.topicLabel, stableTopicKey)) {
      if (!existing.rawTopicKeys.includes(lookupKey)) {
        existing.rawTopicKeys.push(lookupKey);
      }
    }
    if (!existing.sourceTopicKeys.includes(row.topicKey)) {
      existing.sourceTopicKeys.push(row.topicKey);
    }
  }

  const matchesRequestedStableTopic = (row: StableTopicDayTotalAggregateRow) => {
    if (requestedStableTopicKey && row.topicKey === requestedStableTopicKey) {
      return true;
    }
    if (requestedStableTopicKey && row.rawTopicKeys.includes(requestedStableTopicKey)) {
      return true;
    }
    if (query.selectedId && buildTrendId(row.topicKey) === query.selectedId) {
      return true;
    }
    if (query.selectedId && row.rawTopicKeys.some((rawKey) => buildTrendId(rawKey) === query.selectedId)) {
      return true;
    }
    return false;
  };

  let totalsRows = sortStableTopicAggregateRowsByVolume([...aggregatedTotalsByStableKey.values()])
    .slice(0, STABLE_CANDIDATE_FETCH_LIMIT);
  const enrichmentTopicLimit =
    readProfile === "detail"
      ? STABLE_DETAIL_SERIES_TOPIC_LIMIT
      : MAX_LEADERBOARD_ROWS;
  const enrichmentTopicKeys = new Set(
    totalsRows.slice(0, enrichmentTopicLimit).map((row) => row.topicKey),
  );
  const requestedTopicRow = totalsRows.find((row) => matchesRequestedStableTopic(row)) ?? null;
  if (requestedTopicRow) {
    enrichmentTopicKeys.add(requestedTopicRow.topicKey);
  }
  let enrichmentByTopicKey = await fetchTopicEnrichmentByTopicKeys(
    [...enrichmentTopicKeys],
    window.windowEnd.toISOString(),
  );
  const mergedClusterResult = mergeStableTopicClusters(
    totalsRows,
    enrichmentByTopicKey,
    {
      requestedStableTopicKey,
      selectedId: query.selectedId,
    },
  );
  totalsRows = mergedClusterResult.rows;
  enrichmentByTopicKey = mergedClusterResult.enrichmentByTopicKey;
  let clusterTotalsSource = totalsSource;

  if (hasDatabaseUrl() && totalsRows.length > 0) {
    try {
      const dedupedClusterTotals = await fetchStableClusterWindowTotalsFromPostgresSource(
        totalsRows,
        window.windowStart.toISOString(),
        window.windowEnd.toISOString(),
      );
      totalsRows = applyStableClusterWindowTotalOverrides(totalsRows, dedupedClusterTotals);
      clusterTotalsSource = `${totalsSource}+post_topic_mentions:postgres_cluster_window`;
    } catch (error) {
      if (!isPostgresMissingStructure(error)) {
        throw error;
      }
    }
  }

  totalsRows = sortStableTopicAggregateRowsByVolume(totalsRows)
    .slice(0, STABLE_CANDIDATE_FETCH_LIMIT);

  if (totalsRows.length === 0) {
    const zero = createZeroTrendDashboardVM(query);
    return {
      ...zero,
      dataStatus: toSupabaseDataStatus({
        rowCount: rawTotalsRows.length,
        source: clusterTotalsSource,
        latestSourceAt: null,
        freshnessProbe,
      }),
    };
  }

  const selectedStableTopic = totalsRows.find((row) => matchesRequestedStableTopic(row)) ?? null;
  const seededSeriesTopicLimit = readProfile === "detail"
    ? STABLE_DETAIL_SERIES_TOPIC_LIMIT
    : STABLE_SUMMARY_SERIES_TOPIC_LIMIT;
  const seriesSeedRows =
    seededSeriesTopicLimit > 0
      ? selectStableSeriesSeedRows(totalsRows, seededSeriesTopicLimit)
      : [];
  const seriesTargetRowsByTopicKey = new Map<string, StableTopicDayTotalAggregateRow>();
  for (const row of [...seriesSeedRows, ...(selectedStableTopic ? [selectedStableTopic] : [])]) {
    if (!seriesTargetRowsByTopicKey.has(row.topicKey)) {
      seriesTargetRowsByTopicKey.set(row.topicKey, row);
    }
  }
  const seriesTargetRows = [...seriesTargetRowsByTopicKey.values()];
  const topicKeys = [...new Set(seriesTargetRows.flatMap((row) => row.rawTopicKeys))];
  const topicKeyToStableIdentity = new Map<string, string>();
  for (const row of totalsRows) {
    topicKeyToStableIdentity.set(row.topicKey, row.topicKey);
    for (const rawTopicKey of row.rawTopicKeys) {
      topicKeyToStableIdentity.set(rawTopicKey, row.topicKey);
    }
  }
  let rawSeriesRows: SupabaseTopicRow[] = [];
  let seriesSource = "";
  let allowedTopicKeys = new Set<string>();
  let usedClusterSeries = false;

  if (hasDatabaseUrl() && seriesTargetRows.length > 0) {
    try {
      const seriesFetchResults = await Promise.all(
        dayIsos.map((dayIso) => fetchStableClusterDaySeriesFromPostgresSource(
          dayIso,
          window.windowStart.toISOString(),
          window.windowEnd.toISOString(),
          seriesTargetRows,
        )),
      );
      rawSeriesRows = seriesFetchResults.flat();
      seriesSource = "post_topic_mentions:postgres_cluster_day_series";
      allowedTopicKeys = new Set(seriesTargetRows.map((row) => row.topicKey));
      usedClusterSeries = true;
    } catch (error) {
      if (!isPostgresMissingStructure(error)) {
        throw error;
      }
    }
  }

  if (!usedClusterSeries && topicKeys.length > 0) {
    const seriesFetchResults = await Promise.all(
      dayIsos.map((dayIso) => fetchStableDaySeries(
        dayIso,
        window.windowStart.toISOString(),
        window.windowEnd.toISOString(),
        topicKeys,
      )),
    );
    rawSeriesRows = seriesFetchResults.flatMap((result) => result.rows);
    seriesSource = [...new Set(seriesFetchResults.map((result) => result.source))]
      .filter((source) => source.length > 0)
      .join("+");
    allowedTopicKeys = new Set(topicKeys);
  }

  const seriesRows = rawSeriesRows
    .map((row) => parseStableDaySeriesRow(row))
    .filter((row): row is StableTopicSeriesRow => Boolean(row))
    .filter((row) => allowedTopicKeys.has(row.topicKey));

  const bucketSet = new Set(window.buckets);
  const seriesByTopic = new Map<string, Map<string, number>>();
  const observedBucketKeysByTopic = new Map<string, Set<string>>();
  let latestSourceTimestampMs = Number.NaN;

  for (const row of totalsRows) {
    const lastSeenMs = row.lastSeenAt ? Date.parse(row.lastSeenAt) : Number.NaN;
    if (Number.isFinite(lastSeenMs)) {
      latestSourceTimestampMs = Number.isFinite(latestSourceTimestampMs)
        ? Math.max(latestSourceTimestampMs, lastSeenMs)
        : lastSeenMs;
    }
  }

  for (const row of seriesRows) {
    const bucketKey = bucketKeyForIso(row.bucket5m, window.bucketMinutes);
    if (!bucketSet.has(bucketKey)) {
      continue;
    }

    const stableTopicKey =
      topicKeyToStableIdentity.get(row.topicKey) ??
      resolveStableTopicIdentity(row.topicKey, row.topicLabel);
    if (!stableTopicKey) {
      continue;
    }

    const topicSeries = seriesByTopic.get(stableTopicKey) ?? new Map<string, number>();
    topicSeries.set(bucketKey, (topicSeries.get(bucketKey) ?? 0) + row.interactions);
    seriesByTopic.set(stableTopicKey, topicSeries);
    const observedBucketKeys = observedBucketKeysByTopic.get(stableTopicKey) ?? new Set<string>();
    observedBucketKeys.add(bucketKey);
    observedBucketKeysByTopic.set(stableTopicKey, observedBucketKeys);

    const bucketMs = Date.parse(bucketKey);
    const updatedMs = row.updatedAt ? Date.parse(row.updatedAt) : Number.NaN;
    const sourceMs = Number.isFinite(bucketMs) ? bucketMs : updatedMs;
    if (Number.isFinite(sourceMs)) {
      latestSourceTimestampMs = Number.isFinite(latestSourceTimestampMs)
        ? Math.max(latestSourceTimestampMs, sourceMs)
        : sourceMs;
    }
  }

  const rankedBaseRows: RankedTrend[] = [];
  const allTrendTotalsByBucket = new Map<string, number>();
  const nowMs = Date.now();

  for (const topic of totalsRows) {
    const enrichment = enrichmentByTopicKey.get(topic.topicKey) ?? null;
    const topicSeries = seriesByTopic.get(topic.topicKey) ?? new Map<string, number>();
    const observedBucketKeys = observedBucketKeysByTopic.get(topic.topicKey) ?? new Set<string>();
    const points: TimeSeriesPoint[] = window.buckets.map((bucketIso) => {
      const value = topicSeries.get(bucketIso) ?? 0;
      allTrendTotalsByBucket.set(bucketIso, (allTrendTotalsByBucket.get(bucketIso) ?? 0) + value);
      return {
        timestamp: bucketIso,
        value,
      };
    });

    const values = points.map((point) => point.value);
    const midpoint = Math.max(1, Math.floor(values.length / 2));
    const quarter = Math.max(1, Math.floor(values.length / 4));
    const previousHalf = values.slice(0, midpoint).reduce((sum, value) => sum + value, 0);
    const recentHalf = values.slice(midpoint).reduce((sum, value) => sum + value, 0);
    const previousQuarter = values.slice(Math.max(0, values.length - quarter * 2), values.length - quarter)
      .reduce((sum, value) => sum + value, 0);
    const recentQuarter = values.slice(values.length - quarter).reduce((sum, value) => sum + value, 0);
    const recentQuarterHours = Math.max((quarter * window.bucketMinutes) / 60, window.bucketMinutes / 60, 1 / 60);
    const fullWindowHours = Math.max((window.buckets.length * window.bucketMinutes) / 60, window.bucketMinutes / 60, 1 / 60);
    const mentionCount = Math.max(0, topic.totalMentions);
    const postCount = Math.max(topic.uniquePosts, mentionCount > 0 ? 1 : 0);
    const uniqueAuthors = Math.max(0, topic.uniqueAuthors);
    const trust = assessStableSeriesTrust({
      bucketKeys: window.buckets,
      observedBucketKeys,
      values,
      midpoint,
      quarter,
      mentionCount,
      postCount,
      uniqueAuthors,
    });
    const rawGrowthRate = clamp(percentDelta(recentHalf, previousHalf), -100, 400);
    const rawAcceleration = clamp(percentDelta(recentQuarter, previousQuarter), -100, 400);
    const fallbackVelocityScore = clamp(mentionCount / fullWindowHours, 0, 1000);
    const rawVelocityScore = observedBucketKeys.size > 0
      ? clamp(recentQuarter / recentQuarterHours, 0, 1000)
      : fallbackVelocityScore;
    const growthRate = trust.growthTrusted
      ? clamp(rawGrowthRate * trust.growthTrustScore, -100, 400)
      : 0;
    const acceleration = trust.accelerationTrusted
      ? clamp(rawAcceleration * trust.accelerationTrustScore, -100, 400)
      : 0;
    const velocityScore = trust.velocityTrusted
      ? clamp(rawVelocityScore * Math.max(0.45, trust.velocityTrustScore), 0, 1000)
      : fallbackVelocityScore;
    const latestDataPoint = [...points].reverse().find((point) => point.value > 0);
    const latestDataMs = latestDataPoint
      ? Date.parse(latestDataPoint.timestamp)
      : Date.parse(topic.lastSeenAt ?? topic.firstSeenAt ?? "");
    const ageMinutes = Number.isFinite(latestDataMs)
      ? Math.max(0, Math.round((nowMs - latestDataMs) / 60_000))
      : 10_000;
    const freshnessState = getFreshnessState(ageMinutes);
    const freshnessScore = clamp(100 - ageMinutes * 1.6, 0, 100);
    const lowDataWarning = mentionCount < 4 || postCount < 3;
    const clusteredVolumeScore = clamp(
      Math.log2(Math.max(1, mentionCount) + 1) * 12 +
        Math.log2(Math.max(1, postCount) + 1) * 16,
      0,
      100,
    );
    const confidenceScore = clamp(clusteredVolumeScore * 0.85 + freshnessScore * 0.15, 0, 100);
    const noveltyScore = clamp(
      Math.max(0, growthRate) * 0.55 + Math.min(24, velocityScore * 0.35),
      0,
      100,
    );
    const sentimentTotal = topic.positiveCount + topic.neutralCount + topic.negativeCount;
    const sentimentBalance = sentimentTotal > 0
      ? (topic.positiveCount - topic.negativeCount) / sentimentTotal
      : 0;
    const confirmationScore = clamp(
      clusteredVolumeScore * 0.72 + freshnessScore * 0.08 + Math.min(20, postCount * 0.45),
      0,
      100,
    );
    const breakoutScore = clamp(
      velocityScore * 0.34 +
        Math.max(0, growthRate) * 0.28 +
        clusteredVolumeScore * 0.28 +
        freshnessScore * 0.10 +
        Math.max(0, sentimentBalance) * 4,
      0,
      100,
    );
    const trendStrengthScore = clamp(
      clusteredVolumeScore * 0.68 +
        Math.max(0, growthRate) * 0.10 +
        freshnessScore * 0.12 +
        Math.min(10, velocityScore * 0.10),
      0,
      100,
    );

    const row = createZeroRankedTrend(query.scope, query.range);
    const id = buildTrendId(topic.topicKey);
    const defaultDisplayLabel = pickNarrativeStableDisplayLabel(topic.topicLabel);
    row.id = id;
    row.name = defaultDisplayLabel || TREND_NAME_PLACEHOLDER;
    row.displayName = defaultDisplayLabel || null;
    row.nameStatus = "pending";
    row.nameSource = "raw";
    row.clusterId = id;
    row.clusterName = defaultDisplayLabel || TREND_NAME_PLACEHOLDER;
    row.scope = query.scope;
    row.source = "bluesky";
    row.labelType = "entity_label";
    row.groupingSource = topic.rawTopicKeys.length > 1 ? "ai_semantic_cluster" : "fallback_singleton";
    row.leaderboardTier = lowDataWarning ? "secondary_singleton" : "primary_grouped";
    row.canonicalKeySummary = topic.topicKey;
    row.labelQualityScore = clamp(0.55 + (mentionCount > 20 ? 0.3 : 0.15), 0, 1);
    row.lowQualityLabel = lowDataWarning;
    row.aiAssisted = false;
    row.attentionInteractions = mentionCount;
    row.totalInteractions24h = mentionCount;
    row.qualityAdjustedScore = trendStrengthScore;
    row.attentionScore = clamp(
      mentionCount +
        postCount * 0.35 +
        Math.max(0, growthRate) * 0.4 +
        freshnessScore * 0.08,
      0,
      1000,
    );
    row.emergingScore = breakoutScore;
    row.breakoutScore = breakoutScore;
    row.velocityScore = velocityScore;
    row.noveltyScore = noveltyScore;
    row.confirmationScore = confirmationScore;
    row.rootsCount24h = postCount;
    row.uniqueAuthors24h = uniqueAuthors;
    row.positiveMentions24h = topic.positiveCount;
    row.neutralMentions24h = topic.neutralCount;
    row.negativeMentions24h = topic.negativeCount;
    row.sentimentBalance = sentimentBalance;
    row.singleAuthorShare = 0;
    row.firstSeenAt = topic.firstSeenAt;
    row.lastSeenAt = topic.lastSeenAt;
    row.isSingleton = postCount <= 1;
    row.trendCategory = null;
    row.trendDescription = null;
    row.trendContextParagraph = null;
    row.trendNarrativeSummary = null;
    row.trendRawLabel = topic.topicLabel;
    row.trendFallbackLabel = normalizeTopic(topic.topicLabel) || topic.topicLabel;
    row.trendSummaryConfidence = null;
    row.trendEnrichmentStatus = null;
    row.trendEnrichmentAbstainReason = null;
    row.trendKeyEntities = null;
    row.trendEnrichment = null;
    row.contentType = null;
    row.spamLikelihood = 0;
    row.templateLikelihood = 0;
    row.contextualCoherence = undefined;
    row.lowInformation = lowDataWarning;
    row.templateSeries = false;
    row.seriesExpectedBucketCount = trust.expectedBucketCount;
    row.seriesObservedBucketCount = trust.observedBucketCount;
    row.seriesObservedCoverageRatio = trust.observedBucketRatio;
    row.seriesNonZeroBucketCount = trust.nonZeroBucketCount;
    row.seriesPreviousWindowObservedBucketCount = trust.previousWindowObservedBucketCount;
    row.seriesRecentWindowObservedBucketCount = trust.recentWindowObservedBucketCount;
    row.seriesPreviousWindowCoverageRatio = trust.previousWindowCoverageRatio;
    row.seriesRecentWindowCoverageRatio = trust.recentWindowCoverageRatio;
    row.seriesPreviousAccelerationWindowObservedBucketCount = trust.previousAccelerationWindowObservedBucketCount;
    row.seriesRecentAccelerationWindowObservedBucketCount = trust.recentAccelerationWindowObservedBucketCount;
    row.seriesPreviousAccelerationWindowCoverageRatio = trust.previousAccelerationWindowCoverageRatio;
    row.seriesRecentAccelerationWindowCoverageRatio = trust.recentAccelerationWindowCoverageRatio;
    row.momentumSupportQualified = trust.supportQualified;
    row.momentumTrustScore = trust.momentumTrustScore;
    row.growthTrusted = trust.growthTrusted;
    row.accelerationTrusted = trust.accelerationTrusted;
    row.velocityTrusted = trust.velocityTrusted;
    row.noveltyTrusted = trust.noveltyTrusted;
    row.attentionMetricTrusted = trust.attentionMetricTrusted;
    row.breakoutMomentumTrusted = trust.breakoutMomentumTrusted;
    row.confidenceScore = confidenceScore;
    row.freshnessScore = freshnessScore;
    row.freshnessState = freshnessState;
    row.sampleSize = mentionCount;
    row.supportingThreadCount = postCount;
    row.lowDataWarning = lowDataWarning;
    row.growthRate = growthRate;
    row.attentionAcceleration = acceleration;
    row.mentions = mentionCount;
    row.platforms = ["bluesky"];
    row.platformSpread = Math.max(1, topic.platformCount);
    row.confirmedPlatformSpread = Math.max(1, topic.platformCount);
    row.attentionHistory = points;
    row.platformBreakdown = [
      {
        platformId: "bluesky",
        interactions: mentionCount,
        sharePct: 100,
      },
    ];
    row.topPosts = [];
    row.lifecycleStage = getLifecycleStage(growthRate, freshnessState);
    row.originPlatform = "bluesky";
    row.platformMigrationPath = ["bluesky"];
    row.attentionDrivers = [
      {
        platformId: "bluesky",
        contributionPct: 100,
        deltaPct: 0,
      },
    ];
    row.hasSpike = trust.accelerationTrusted && acceleration >= 60;
    row.spikeMagnitude = row.hasSpike ? clamp(acceleration / 100, 0, 4) : 0;
    row.trendStrengthScore = trendStrengthScore;
    row.persistenceScore = clamp(confidenceScore * 0.6 + postCount * 0.9, 0, 100);
    row.isEarlyTrend = trust.growthTrusted && postCount <= 5 && growthRate >= 20;
    row.positionChange24h = 0;
    row.googleSearchInterest = null;
    row.blueskySummary = {
      attentionSharePct: 100,
      postCount,
      uniqueAuthorCount: uniqueAuthors,
      amplifierCount: 0,
      topAmplifierHandle: null,
      leadingSignalLabel: TREND_NAME_PLACEHOLDER,
      firehoseLagMinutes: ageMinutes,
      repostVelocity: 0,
      replyVelocity: 0,
      quoteVelocity: 0,
    };
    row.blueskyDetail = null;
    row.trendRawLabel = topic.topicLabel;
    row.trendFallbackLabel = defaultDisplayLabel || null;
    applyTopicEnrichmentToRankedTrend(row, topic.topicLabel, enrichment);

    rankedBaseRows.push(row);
  }

  const emergingCandidates = rankedBaseRows
    .filter((row) => row.isEarlyTrend || row.growthRate > 10 || (row.breakoutScore ?? 0) > 18);
  const emergingSeedRows = emergingCandidates.length > 0 ? emergingCandidates : rankedBaseRows;
  const selectedMode = query.mode ?? "established";

  const establishedRows = prioritizeAiNamedRows(
    sortRowsByMode(
    rankedBaseRows.map((row) => ({
      ...row,
      leaderboardMode: "established",
    })),
    "established",
    query.sort,
    ),
    MAX_LEADERBOARD_ROWS,
  )
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));

  const emergingRows = prioritizeAiNamedRows(
    sortRowsByMode(
    emergingSeedRows.map((row) => {
      const current = rankedBaseRows.find((candidate) => candidate.id === row.id) ?? row;
      return {
        ...current,
        leaderboardMode: "emerging",
      };
    }),
    "emerging",
    query.sort,
    ),
    MAX_LEADERBOARD_ROWS,
  )
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));

  const selectedLeaderboard = selectedMode === "emerging" ? emergingRows : establishedRows;
  const aggregatePoints = window.buckets.map((bucket) => ({
    timestamp: bucket,
    value: allTrendTotalsByBucket.get(bucket) ?? 0,
  }));
  const latestBucketAt = aggregatePoints
    .slice()
    .reverse()
    .find((point) => point.value > 0)?.timestamp ?? null;
  const latestSourceAt = Number.isFinite(latestSourceTimestampMs)
    ? new Date(latestSourceTimestampMs).toISOString()
    : latestBucketAt;
  const sourceLagMinutes = ageMinutesFromIso(latestSourceAt, Date.now());
  const sourceLabel = seriesSource ? `${clusterTotalsSource}+${seriesSource}` : clusterTotalsSource;

  const resolvedSelectedId =
    query.selectedId ??
    (selectedStableTopic ? buildTrendId(selectedStableTopic.topicKey) : undefined);
  const vm: TrendDashboardVM = {
    query: {
      ...query,
      mode: selectedMode,
      selectedId: resolvedSelectedId,
    },
    ingestionHealth: null,
    dataStatus: toSupabaseDataStatus({
      rowCount: totalsRows.length + seriesRows.length,
      source: sourceLabel,
      latestSourceAt,
      freshnessProbe,
    }),
    blueskyOverview: buildBlueskyOverview(
      selectedLeaderboard,
      aggregatePoints,
      query.range,
      window.bucketMinutes,
      sourceLagMinutes,
    ),
    trendCoverage: null,
    leaderboards: {
      established: establishedRows,
      emerging: emergingRows,
    },
    leaderboard: selectedLeaderboard,
    overviewSeries: [],
    detail: null,
  };

  const selectedVm = applyTrendDashboardSelection(vm, resolvedSelectedId);
  return annotateSelectedFreshnessDiagnostics(
    attachSeriesWindows(selectedVm, query.range, window.bucketMinutes),
  );
}

function shouldUseStableTrendReadModel() {
  return readBooleanEnv(process.env.USE_STABLE_TOPIC_READ_MODEL, true);
}

export async function getSupabaseTrendDashboardState(
  query: TrendDashboardQuery,
  options: SupabaseTrendDashboardStateOptions = {},
): Promise<TrendDashboardVM> {
  if (shouldUseStableTrendReadModel()) {
    try {
      return await getSupabaseTrendDashboardStateStable(query, options);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[supabase-trends] stable read model unavailable, falling back to legacy path", {
          error,
        });
      }
    }
  }

  return getSupabaseTrendDashboardStateLegacy(query, options);
}

export function shouldUseSupabaseTrendSource() {
  const explicit = process.env.USE_SUPABASE_TRENDS;
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return readBooleanEnv(explicit, false);
  }

  // Auto-enable DB-backed trend reads when credentials are available so
  // deployed environments don't fall back to empty runtime snapshots by default.
  return hasSupabaseServerCredentials() || hasDatabaseUrl();
}
