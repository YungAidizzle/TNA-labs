import "server-only";

import {
  buildBlueskyAmplifiers,
  buildBlueskyCascadeLeaders,
  buildBlueskyFirehoseOverview,
  buildBlueskyPropagationNetwork,
} from "@/lib/bluesky/firehose-overview";
import { timeSeriesCoversWindow } from "@/lib/dashboard/time-window";
import { createZeroTrendDashboardVM } from "@/lib/dashboard/zero-state";
import { applyTrendDashboardSelection } from "@/lib/dashboard/selection";
import {
  BlueskyInteraction,
  BlueskyNormalizedPost,
  BlueskyPostSnapshot,
  BlueskyProfile,
  NormalizedInteractionCounts,
  PublicSourceItem,
  RedditIngestionSnapshot,
  RedditIngestionHealth,
  RedditNormalizedComment,
  RedditNormalizedPost,
  RedditSourceHealth,
  YouTubeNormalizedComment,
  YouTubeVideoSnapshot,
} from "@/lib/reddit/types";
import {
  getAttentionAcceleration,
  getGrowthRateFromHistory,
  getPersistenceScore,
  getSpikeSignal,
  getTrendLifecycleStage,
} from "@/lib/utils/trend-signals";
import { compareTrendsByPosts } from "@/lib/utils/trend-ranking";
import {
  DashboardRuntimeBundleOrigin,
  RankedTrend,
  TrendCoverageDebug,
  TrendDashboardQuery,
  TrendDashboardVM,
  TrendGroupingSource,
  TrendLabelType,
  TrendLeaderboardTier,
  TrendLeaderboardMode,
  TrendSort,
} from "@/types/view-models";
import {
  DateRangePreset,
  PlatformId,
  TimeSeriesPoint,
  TrendFreshnessState,
} from "@/types/domain";
import {
  getEmergingBreakoutScore,
  getFreshnessRankFactor,
  getIsEarlyTrend,
  getTrendStrengthScore,
} from "@/lib/utils/trend-scoring";
import type {
  BlueskyAiGroupingDiagnostics,
  BlueskyAiGroupingOptions,
  BlueskyAiGroupingRunMode,
  BlueskyAiRootInput,
  BlueskyAiRootInterpretation,
} from "@/lib/bluesky/ai-trend-assignment";

const RANGE_POINTS: Record<DateRangePreset, number> = {
  "1h": 12,
  "6h": 72,
  "24h": 288,
  "7d": 336,
};

const RANGE_MS: Record<DateRangePreset, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const INTERACTION_WEIGHTS = {
  posts: 14,
  reposts: 7,
  comments: 3,
  likes: 1,
} as const;

const INTERACTION_CAPS = {
  reposts: 18,
  comments: 12,
  likes: 6,
} as const;
const AI_NARRATIVE_TIMEOUT_MS = 2_500;
const AI_EXHAUSTIVE_BLUESKY_NARRATIVE_TIMEOUT_MS = 10_000;
const ANALYTICS_DEBUG = process.env.NODE_ENV !== "production";
const BLUESKY_ANALYTICS_LIMITS: Record<
  DateRangePreset,
  {
    posts: number;
    interactions: number;
    snapshots: number;
  }
> = {
  "1h": { posts: 220, interactions: 280, snapshots: 280 },
  "6h": { posts: 360, interactions: 460, snapshots: 460 },
  "24h": { posts: 520, interactions: 700, snapshots: 700 },
  "7d": { posts: 760, interactions: 980, snapshots: 980 },
};
const EXHAUSTIVE_BLUESKY_MAX_WINDOW_POSTS = 280;
const EXHAUSTIVE_BLUESKY_MAX_WINDOW_INTERACTIONS = 420;
const EXHAUSTIVE_BLUESKY_MAX_WINDOW_SNAPSHOTS = 420;

const MEME_KEYWORDS = [
  "meme",
  "memecoin",
  "token",
  "coin",
  "crypto",
  "shitpost",
  "viral",
  "dank",
  "doge",
  "solana",
  "pepe",
  "wallstreetbets",
  "wsb",
];

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "into",
  "your",
  "their",
  "about",
  "after",
  "before",
  "there",
  "where",
  "which",
  "what",
  "when",
  "while",
  "just",
  "more",
  "some",
  "over",
  "under",
  "than",
  "then",
  "they",
  "them",
  "have",
  "will",
  "would",
  "could",
  "should",
  "news",
  "reddit",
  "thread",
  "post",
  "today",
  "yesterday",
  "people",
  "because",
  "through",
  "still",
  "being",
  "about",
  "new",
  "best",
  "good",
  "like",
  "just",
  "show",
  "shows",
  "says",
  "said",
  "more",
  "most",
  "very",
  "here",
  "look",
  "into",
  "gets",
  "getting",
  "take",
  "takes",
  "using",
  "used",
  "first",
  "across",
  "discussion",
  "discussing",
  "company",
  "companies",
  "update",
  "updates",
  "breaking",
  "latest",
  "reaction",
  "reactions",
  "general",
  "internet",
  "online",
  "community",
  "communities",
  "communitys",
  "question",
  "questions",
  "thought",
  "thoughts",
  "opinion",
  "opinions",
  "story",
  "stories",
  "video",
  "videos",
  "photo",
  "photos",
  "image",
  "images",
  "article",
  "articles",
  "comment",
  "comments",
  "threads",
  "companys",
  "thing",
  "things",
  "anyone",
  "everyone",
  "something",
  "anything",
  "many",
  "much",
  "across",
  "around",
  "another",
  "others",
  "going",
  "went",
  "come",
  "comes",
  "came",
  "made",
  "make",
  "makes",
  "may",
  "might",
  "also",
  "really",
  "maybe",
  "seems",
  "seem",
  "down",
  "via",
]);

const ACRONYMS = new Set(["ai", "api", "gpu", "cpu", "wsb", "usa", "uk", "eu", "btc", "eth"]);
const DISPLAY_TOKENS: Record<string, string> = {
  airpods: "AirPods",
  ai: "AI",
  api: "API",
  btc: "BTC",
  cpu: "CPU",
  dlc: "DLC",
  dlss: "DLSS",
  eth: "ETH",
  eu: "EU",
  gpu: "GPU",
  gta: "GTA",
  jit: "JIT",
  nato: "NATO",
  pokemon: "Pokemon",
  uk: "UK",
  usa: "USA",
  wsb: "WSB",
};
const IMPORTANT_NAME_TOKENS = new Set(["first"]);

const WEAK_LABEL_TOKENS = new Set([
  "access",
  "advice",
  "against",
  "any",
  "are",
  "back",
  "been",
  "begin",
  "begins",
  "behind",
  "being",
  "but",
  "build",
  "building",
  "can",
  "change",
  "coming",
  "day",
  "daily",
  "das",
  "don",
  "did",
  "do",
  "does",
  "done",
  "dozen",
  "dozens",
  "dont",
  "even",
  "eles",
  "ever",
  "else",
  "explain",
  "explainer",
  "every",
  "everything",
  "full",
  "game",
  "get",
  "guys",
  "hey",
  "going",
  "hard",
  "happening",
  "has",
  "help",
  "her",
  "hello",
  "hi",
  "how",
  "his",
  "ive",
  "know",
  "last",
  "let",
  "move",
  "need",
  "needs",
  "note",
  "now",
  "not",
  "objective",
  "official",
  "one",
  "only",
  "once",
  "own",
  "part",
  "por",
  "play",
  "please",
  "product",
  "read",
  "right",
  "rolling",
  "seek",
  "seeks",
  "set",
  "sets",
  "should",
  "somebody",
  "someone",
  "sao",
  "share",
  "thank",
  "thanks",
  "taking",
  "there",
  "these",
  "theyre",
  "teaser",
  "though",
  "three",
  "think",
  "those",
  "time",
  "today",
  "tomorrow",
  "track",
  "tool",
  "tools",
  "trailer",
  "trying",
  "try",
  "uncover",
  "urge",
  "user",
  "watching",
  "want",
  "welcome",
  "were",
  "whats",
  "who",
  "why",
  "wrong",
  "year",
  "you",
  "away",
  "again",
  "auf",
  "bom",
  "dia",
  "important",
]);

const WEAK_LABEL_PHRASES = new Set([
  "are not",
  "are you",
  "been building",
  "can explain",
  "can you explain",
  "casual off topic",
  "everything coming",
  "daily welcome",
  "don get",
  "don know",
  "did you",
  "done all",
  "early access",
  "even though",
  "estado unido",
  "every day",
  "finished watching",
  "full time",
  "has else",
  "his own",
  "last year",
  "long term",
  "middle east",
  "need advice",
  "need help",
  "now but",
  "off topic",
  "play game",
  "official teaser",
  "official teaser trailer",
  "official trailer",
  "only one",
  "part three",
  "real time",
  "read share",
  "right now",
  "shut down",
  "trying get",
  "thank you",
  "those who",
  "united state",
  "user uncover who",
  "was hard",
  "what is going on",
  "what going on",
  "you can",
  "you ever",
  "you guy",
  "you guys",
  "you think",
]);

const GENERIC_PLATFORM_LABEL_TOKENS = new Set([
  "account",
  "accounts",
  "app",
  "bsky",
  "channel",
  "channels",
  "com",
  "comment",
  "comments",
  "did",
  "feed",
  "feeds",
  "follow",
  "follows",
  "following",
  "ingest",
  "interaction",
  "interactions",
  "live",
  "network",
  "plc",
  "post",
  "posts",
  "profile",
  "profiles",
  "reddit",
  "reply",
  "replies",
  "repost",
  "reposts",
  "social",
  "stream",
  "telegram",
  "thread",
  "threads",
  "user",
  "users",
  "video",
  "videos",
  "watch",
  "www",
  "youtube",
  "bluesky",
]);

const GENERIC_PLATFORM_LABEL_PHRASES = new Set([
  "app bsky profile",
  "bsky social",
  "bluesky live ingest",
  "bluesky post",
  "bluesky posts",
  "bluesky social",
  "com www youtube",
  "social live",
]);

const TEMPORAL_LABEL_TOKENS = new Set([
  "aedt",
  "aest",
  "jan",
  "january",
  "feb",
  "february",
  "mar",
  "march",
  "apr",
  "april",
  "may",
  "jun",
  "june",
  "jul",
  "july",
  "aug",
  "august",
  "sep",
  "sept",
  "september",
  "oct",
  "october",
  "nov",
  "november",
  "dec",
  "december",
  "monday",
  "mst",
  "tuesday",
  "pdt",
  "pst",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "utc",
  "gmt",
  "est",
  "edt",
  "cst",
  "cdt",
  "cet",
  "cest",
  "ist",
  "jst",
  "kst",
]);

const GENERIC_FRAGMENT_LEAD_TOKENS = new Set([
  "dear",
  "done",
  "even",
  "hard",
  "hey",
  "help",
  "her",
  "his",
  "hi",
  "need",
  "needs",
  "official",
  "only",
  "own",
  "though",
  "was",
  "were",
]);

const GENERIC_FRAGMENT_TAIL_TOKENS = new Set([
  "advice",
  "again",
  "all",
  "done",
  "hard",
  "help",
  "here",
  "one",
  "own",
  "teaser",
  "there",
  "though",
  "today",
  "tomorrow",
  "trailer",
]);

const GENERIC_FRAGMENT_LABEL_PATTERNS = [
  /^(?:dear|hey|hi)\s+[a-z0-9]+(?:\s+[a-z0-9]+)?$/i,
  /^(?:need|needs)\s+(?:help|advice)\b/i,
  /^(?:even though)\b/i,
  /^(?:his|her|their|our|my)\s+own\b/i,
  /^(?:done all)\b/i,
  /^(?:early access)$/i,
  /^(?:official\s+(?:teaser|trailer))(?:\s+(?:trailer|video))?$/i,
  /^(?:only one)$/i,
  /^(?:the only one)$/i,
  /^(?:was|were)\s+hard\b/i,
];

const URLISH_HOST_SUFFIXES = [
  "app",
  "co",
  "com",
  "dev",
  "fm",
  "gg",
  "info",
  "io",
  "ly",
  "me",
  "net",
  "news",
  "org",
  "tv",
  "xyz",
] as const;
const URLISH_LABEL_TOKENS = new Set([
  "app",
  "bsky",
  "com",
  "gg",
  "http",
  "https",
  "net",
  "org",
  "profile",
  "status",
  "tv",
  "watch",
  "www",
]);
const BARE_DOMAIN_PATTERN = new RegExp(
  `\\b(?:[a-z0-9-]+\\.)+(?:${URLISH_HOST_SUFFIXES.join("|")})(?:\\/\\S*)?\\b`,
  "gi",
);

const CONVERSATIONAL_SUBREDDITS = new Set([
  "askreddit",
  "nostupidquestions",
  "tooafraidtoask",
  "explainlikeimfive",
  "ask",
  "questions",
  "advice",
  "amiwrong",
  "askmen",
  "askwomen",
  "dae",
  "doesanybodyelse",
  "overwatch",
]);

const QUESTION_OPENERS = /^(what|why|how|when|where|who|are|is|can|could|would|should|do|does|did|have|has|will|anyone|someone|does anyone|can anyone)\b/i;
const GENERIC_THREAD_PATTERNS = [
  /\bdaily discussion\b/i,
  /\bdiscussion thread\b/i,
  /\bmegathread\b/i,
  /\bopen thread\b/i,
  /\boff[ -]?topic\b/i,
  /\bcasual conversation\b/i,
  /\bpromote your business\b/i,
  /\bwhat are your moves tomorrow\b/i,
  /\bwhat are you working on\b/i,
];

const TOKEN_ALIASES: Record<string, string> = {
  agents: "agent",
  airpod: "airpods",
  models: "model",
  chips: "chip",
  tariffs: "tariff",
  elections: "election",
  memes: "meme",
  memecoins: "memecoin",
  tokens: "token",
  videos: "video",
  politics: "politic",
  markets: "market",
  companies: "company",
  companiess: "company",
  conflict: "conflict",
  conflicts: "conflict",
  wars: "war",
  trumps: "trump",
  irans: "iran",
  israels: "israel",
  chats: "chat",
  chatgpt: "chatgpt",
  openai: "openai",
  llms: "llm",
  usa: "us",
  "u.s": "us",
  america: "us",
};

const LOW_DATA_COMMENT_THRESHOLD = 20;
const LOW_DATA_THREAD_THRESHOLD = 2;

const SUBREDDIT_THEMES: Record<string, { id: string; label: string }> = {
  technology: { id: "ai-tech", label: "AI / Tech" },
  artificial: { id: "ai-tech", label: "AI / Tech" },
  machinelearning: { id: "ai-tech", label: "AI / Tech" },
  singularity: { id: "ai-tech", label: "AI / Tech" },
  worldnews: { id: "news-politics", label: "News / Politics" },
  news: { id: "news-politics", label: "News / Politics" },
  politics: { id: "news-politics", label: "News / Politics" },
  economics: { id: "markets-macro", label: "Markets / Macro" },
  cryptocurrency: { id: "crypto-memes", label: "Crypto / Memes" },
  wallstreetbets: { id: "crypto-memes", label: "Crypto / Memes" },
  stocks: { id: "markets-macro", label: "Markets / Macro" },
  investing: { id: "markets-macro", label: "Markets / Macro" },
  memes: { id: "internet-culture", label: "Internet Culture" },
  dankmemes: { id: "internet-culture", label: "Internet Culture" },
  outoftheloop: { id: "internet-culture", label: "Internet Culture" },
  gaming: { id: "gaming-culture", label: "Gaming / Culture" },
};

type PhraseStat = {
  key: string;
  label: string;
  score: number;
  documentIds: Set<string>;
  rootDocumentIds: Set<string>;
  authorIds: Set<string>;
  sourceCounts: Map<string, number>;
  labelScores: Map<string, number>;
  namedPhraseSupport: number;
};

type NarrativeLabelSource = "named_phrase" | "phrase" | "fallback" | "ai";

type TopicGroup = {
  key: string;
  label: string;
  documents: TrendDocument[];
  comments: RedditNormalizedComment[];
  topPhrase: string;
  themeId: string;
  themeLabel: string;
  isMeme: boolean;
  summary?: string;
  aliases?: string[];
  labelSource: NarrativeLabelSource;
  labelQualityScore: number;
  sourceDiversity: number;
  namedPhraseSupport: number;
};

type TopicGroupMetadata = {
  labelSource?: NarrativeLabelSource;
  labelQualityScore?: number;
  namedPhraseSupport?: number;
};

type PhraseEvidence = {
  label: string;
  support: number;
  totalWeight: number;
  qualityScore: number;
};

type TopicGroupCoherenceContext = {
  dominantPhrase?: PhraseEvidence;
  dominantNamedPhrase?: PhraseEvidence;
  genericThreadCount: number;
};

type ResolvedNarratives = {
  narratives: Array<{
    id: string;
    label: string;
    summary: string;
    aliases: string[];
    candidateIds: string[];
    documentIds: string[];
  }>;
  ignoredCandidateIds: string[];
} | null;

type TrendDocument = {
  id: string;
  platformId: PlatformId;
  documentKind?: "primary" | "comment" | "delta" | "reply" | "quote" | "amplification";
  rootDocumentId?: string | null;
  parentDocumentId?: string | null;
  sourceKey: string;
  sourceLabel: string;
  sourceType?: PublicSourceItem["sourceType"];
  clusterKey?: string;
  clusterLabel?: string;
  title: string;
  body: string;
  author: string;
  authorId?: string | null;
  authorHandle?: string | null;
  authorFollowersCount?: number | null;
  postType?: string | null;
  url: string;
  createdUtc: number;
  fetchedAt?: string | null;
  score: number;
  interactionCounts: NormalizedInteractionCounts;
  interactionCount: number;
  narrativeInteractionCount: number;
  trafficLabel?: string | null;
};

type RankedTrendSeed = {
  trend: RankedTrend;
  totalInteractionScore: number;
  currentWindowInteractionScore: number;
  priorWindowInteractionScore: number;
  totalNarrativeScore: number;
  currentWindowNarrativeScore: number;
  priorWindowNarrativeScore: number;
};

type EmergingTrendSeed = RankedTrendSeed & {
  rawVelocityScore: number;
  rawNoveltyScore: number;
  rawConfirmationScore: number;
  rawBreakoutScore: number;
};

type TrendFreshnessSummary = {
  score: number;
  state: TrendFreshnessState;
  confirmedPlatformSpread: number;
  platformStates: Array<{
    platformId: PlatformId;
    score: number;
    state: TrendFreshnessState;
  }>;
};

type ScopedAnalyticsSnapshot = {
  cutoffUtc: number;
  windowCutoffUtc: number;
  scopedPosts: RedditNormalizedPost[];
  scopedComments: RedditNormalizedComment[];
  scopedPublicItems: PublicSourceItem[];
  scopedBlueskyPosts: BlueskyNormalizedPost[];
  scopedBlueskyInteractions: BlueskyInteraction[];
  scopedBlueskyPostSnapshots: BlueskyPostSnapshot[];
  scopedBlueskyProfiles: BlueskyProfile[];
  windowBlueskyPosts: BlueskyNormalizedPost[];
  windowBlueskyInteractions: BlueskyInteraction[];
  windowBlueskyPostSnapshots: BlueskyPostSnapshot[];
  scopedYouTubeComments: YouTubeNormalizedComment[];
  scopedYouTubeVideoSnapshots: YouTubeVideoSnapshot[];
  blueskyPostsByRoot: Map<string, BlueskyNormalizedPost[]>;
  blueskyInteractionsByRoot: Map<string, BlueskyInteraction[]>;
  blueskySnapshotsByRoot: Map<string, BlueskyPostSnapshot[]>;
  blueskyWindowPostsByRoot: Map<string, BlueskyNormalizedPost[]>;
  blueskyWindowInteractionsByRoot: Map<string, BlueskyInteraction[]>;
  blueskyWindowSnapshotsByRoot: Map<string, BlueskyPostSnapshot[]>;
  blueskyProfileByDid: Map<string, BlueskyProfile>;
  blueskyWindowInteractionCountByRoot: Map<string, number>;
  blueskyWindowDeltaCountByRoot: Map<string, number>;
};

type ExhaustiveBlueskyTrendAssignment = {
  rootId: string;
  group: TopicGroup;
  posts: BlueskyNormalizedPost[];
  interactions: BlueskyInteraction[];
  snapshots: BlueskyPostSnapshot[];
  totalInteractions24h: number;
  totalSnapshotDelta24h: number;
  uniqueAuthors24h: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

type ExhaustiveBlueskyTrendGroup = {
  group: TopicGroup;
  rootIds: string[];
  posts: BlueskyNormalizedPost[];
  interactions: BlueskyInteraction[];
  snapshots: BlueskyPostSnapshot[];
  groupingSource: TrendGroupingSource;
  leaderboardTier: TrendLeaderboardTier;
  labelType: TrendLabelType;
  canonicalKeySummary: string | null;
  fallbackGenerated: boolean;
  lowQualityLabel: boolean;
  totalInteractions24h: number;
  totalSnapshotDelta24h: number;
  uniqueAuthors24h: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  aiAssisted: boolean;
  aiLabel: string | null;
  trendDescription: string | null;
  qualityAdjustedScore: number;
  singleAuthorShare: number;
  trendCategory: string | null;
  contentType: string | null;
  spamLikelihood: number;
  templateLikelihood: number;
  contextualCoherence: number;
  lowInformation: boolean;
  templateSeries: boolean;
};

type ExhaustiveBlueskySeedBuild = {
  seeds: RankedTrendSeed[];
  coverage: TrendCoverageDebug;
};

type AnalyticsBuildOptions = {
  bundleOrigin?: DashboardRuntimeBundleOrigin;
};

type BlueskyRootSignalStat = {
  key: string;
  label: string;
  support: number;
  weight: number;
  qualityScore: number;
};

type BlueskyTrendCandidateType =
  | "url"
  | "hybrid"
  | "entity"
  | "phrase"
  | "hashtag"
  | "ai_semantic"
  | "author_template";

type BlueskyRootTopicCandidate = {
  key: string;
  candidateType: BlueskyTrendCandidateType;
  label: string;
  labelType: TrendLabelType;
  qualityScore: number;
  priority: number;
  support: number;
};

type BlueskyRootAssignment = {
  root: CanonicalBlueskyRoot;
  assignedKey: string;
  assignedLabel: string;
  assignedLabelType: TrendLabelType;
  assignedLabelQualityScore: number;
  groupingSource: TrendGroupingSource;
  groupingBasis: "ai" | "heuristic" | "template" | "url" | "singleton";
  groupingReason: string;
};

type CanonicalBlueskyRoot = {
  rootId: string;
  groupDocuments: TrendDocument[];
  posts: BlueskyNormalizedPost[];
  interactions: BlueskyInteraction[];
  snapshots: BlueskyPostSnapshot[];
  totalInteractions24h: number;
  totalSnapshotDelta24h: number;
  uniqueAuthors24h: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  primaryAuthorId: string | null;
  primaryAuthorHandle: string | null;
  rootText: string;
  evidenceText: string;
  urlSignals: BlueskyRootSignalStat[];
  entitySignals: BlueskyRootSignalStat[];
  phraseSignals: BlueskyRootSignalStat[];
  hashtagSignals: BlueskyRootSignalStat[];
  singletonLabel: string;
  singletonLabelType: TrendLabelType;
  singletonLabelQualityScore: number;
  candidateTopicKeys: BlueskyRootTopicCandidate[];
  aiInterpretation?: BlueskyAiRootInterpretation | null;
  primaryAiGroupingKey?: string | null;
  secondaryAiGroupingKeys?: string[];
};

function isPublicNarrativePlatform(platformId: PlatformId) {
  return platformId === "news" || platformId === "telegram";
}

function isPublicNewsThemePlatform(platformId: PlatformId) {
  return (
    platformId === "news" ||
    platformId === "google" ||
    platformId === "youtube" ||
    platformId === "telegram"
  );
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function summarizePlatformDocumentCounts(documents: TrendDocument[]) {
  return documents.reduce<Record<string, number>>((acc, document) => {
    acc[document.platformId] = (acc[document.platformId] ?? 0) + 1;
    return acc;
  }, {});
}

function sanitizeInteractionCounts(
  counts: Partial<NormalizedInteractionCounts> | undefined,
): NormalizedInteractionCounts {
  return {
    posts: Math.max(0, counts?.posts ?? 0),
    reposts: Math.max(0, counts?.reposts ?? 0),
    comments: Math.max(0, counts?.comments ?? 0),
    likes: Math.max(0, counts?.likes ?? 0),
  };
}

function getRawInteractionCount(counts: Partial<NormalizedInteractionCounts> | undefined) {
  const normalized = sanitizeInteractionCounts(counts);
  return normalized.posts + normalized.reposts + normalized.comments + normalized.likes;
}

function incrementNumberMap(map: Map<string, number>, key: string | null | undefined, amount: number) {
  if (!key || amount <= 0) {
    return;
  }

  map.set(key, (map.get(key) ?? 0) + amount);
}

function parseCompactCount(value: string) {
  const normalized = value.trim().replace(/,/g, "").toUpperCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)([KMB])?$/);
  if (!match) {
    return null;
  }

  const magnitude = Number.parseFloat(match[1]);
  if (!Number.isFinite(magnitude)) {
    return null;
  }

  const multiplier = {
    K: 1_000,
    M: 1_000_000,
    B: 1_000_000_000,
  }[match[2] ?? ""] ?? 1;

  return Math.round(magnitude * multiplier);
}

function parseSummaryMetric(summary: string, label: string) {
  const match = summary.match(new RegExp(`${label}\\s+([\\d.,]+(?:[KMB])?)`, "i"));
  return match ? parseCompactCount(match[1]) : null;
}

function buildInteractionContributions(counts: NormalizedInteractionCounts) {
  const posts = counts.posts * INTERACTION_WEIGHTS.posts;
  const reposts = Math.min(
    INTERACTION_CAPS.reposts,
    Math.log2(counts.reposts + 1) * INTERACTION_WEIGHTS.reposts,
  );
  const comments = Math.min(
    INTERACTION_CAPS.comments,
    Math.log2(counts.comments + 1) * INTERACTION_WEIGHTS.comments,
  );
  const likes = Math.min(
    INTERACTION_CAPS.likes,
    Math.log10(counts.likes + 1) * INTERACTION_WEIGHTS.likes,
  );

  return {
    posts: round1(posts),
    reposts: round1(reposts),
    comments: round1(comments),
    likes: round1(likes),
  };
}

function getWeightedInteractionScore(counts: NormalizedInteractionCounts) {
  const contributions = buildInteractionContributions(counts);
  return round1(
    contributions.posts +
      contributions.reposts +
      contributions.comments +
      contributions.likes,
  );
}

function getYouTubeInteractionScore(
  item: PublicSourceItem,
  counts: NormalizedInteractionCounts,
) {
  const likes = Math.max(item.initialLikeCount ?? item.likeCount ?? counts.likes, 0);
  const comments = Math.max(item.initialCommentCount ?? item.commentCount ?? counts.comments, 0);
  const views = Math.max(item.initialViewCount ?? item.viewCount ?? 0, 0);

  return round1(
    6 +
      Math.min(20, Math.log10(likes + 1) * 4.5) +
      Math.min(22, Math.log10(comments + 1) * 6) +
      Math.min(9, Math.log10(views + 1) * 1.5),
  );
}

function getYouTubeDeltaInteractionScore(snapshot: YouTubeVideoSnapshot) {
  const windowHours = Math.max((snapshot.deltaWindowMinutes ?? 0) / 60, 0.25);
  const viewsPerHour = Math.max((snapshot.deltaViewCount ?? 0) / windowHours, 0);
  const likesPerHour = Math.max((snapshot.deltaLikeCount ?? 0) / windowHours, 0);
  const commentsPerHour = Math.max((snapshot.deltaCommentCount ?? 0) / windowHours, 0);

  return round1(
    Math.min(18, Math.log10(viewsPerHour + 1) * 4) +
      Math.min(20, Math.log10(likesPerHour + 1) * 5.5) +
      Math.min(24, Math.log10(commentsPerHour + 1) * 8),
  );
}

function getYouTubeCommentInteractionCounts(comment: YouTubeNormalizedComment): NormalizedInteractionCounts {
  return sanitizeInteractionCounts({
    comments: 1,
    likes: Math.max(comment.likeCount ?? comment.score, 0),
  });
}

function getYouTubeCommentInteractionScore(comment: YouTubeNormalizedComment) {
  const counts = getYouTubeCommentInteractionCounts(comment);
  const replyBoost = Math.min(8, Math.log2((comment.replyCount ?? 0) + 1) * 2.4);
  return round1(getWeightedInteractionScore(counts) + replyBoost);
}

function getBlueskyInteractionCounts(post: BlueskyNormalizedPost): NormalizedInteractionCounts {
  if (post.interactionCounts) {
    return sanitizeInteractionCounts(post.interactionCounts);
  }

  return sanitizeInteractionCounts({
    posts: 1,
    reposts: Math.max((post.repostCount ?? 0) + (post.quoteCount ?? 0), 0),
    comments: Math.max(post.replyCount ?? 0, 0),
    likes: Math.max(post.likeCount ?? 0, 0),
  });
}

function getBlueskyPostText(post: BlueskyNormalizedPost) {
  return post.summary ?? "";
}

function getBlueskyPostRootId(post: BlueskyNormalizedPost) {
  return post.rootUri ?? post.id;
}

function getBlueskyPostParentId(post: BlueskyNormalizedPost) {
  return post.parentUri ?? null;
}

function getBlueskyInteractionRootId(interaction: BlueskyInteraction) {
  return interaction.rootUri ?? interaction.postUri;
}

function getBlueskyInteractionPostId(interaction: BlueskyInteraction) {
  return interaction.postUri;
}

function getBlueskyInteractionText(interaction: BlueskyInteraction) {
  return interaction.text ?? "";
}

function getBlueskyInteractionScore(post: BlueskyNormalizedPost, profile?: BlueskyProfile) {
  const counts = getBlueskyInteractionCounts(post);
  const followerCount = Math.max(
    post.authorFollowersCount ?? profile?.followersCount ?? 0,
    0,
  );
  const followerBoost = Math.min(10, Math.log10(followerCount + 1) * 2.1);
  const quoteBoost = post.postType === "quote" ? 4.2 : 0;
  const replyBoost = post.postType === "reply" ? 2.4 : 0;

  return round1(getWeightedInteractionScore(counts) + followerBoost + quoteBoost + replyBoost);
}

function getBlueskyNarrativeInteractionScore(post: BlueskyNormalizedPost) {
  const counts = getBlueskyInteractionCounts(post);
  const quoteBoost = post.postType === "quote" ? 3 : 0;
  const replyBoost = post.postType === "reply" ? 1.5 : 0;
  return round1(getNarrativeInteractionScore(counts) + quoteBoost + replyBoost);
}

function getBlueskySnapshotInteractionScore(snapshot: BlueskyPostSnapshot) {
  const windowHours = Math.max((snapshot.deltaWindowMinutes ?? 0) / 60, 0.25);
  const repostsPerHour = Math.max(
    ((snapshot.deltaRepostCount ?? 0) + (snapshot.deltaQuoteCount ?? 0)) / windowHours,
    0,
  );
  const repliesPerHour = Math.max((snapshot.deltaCommentCount ?? 0) / windowHours, 0);
  const likesPerHour = Math.max((snapshot.deltaLikeCount ?? 0) / windowHours, 0);

  return round1(
    Math.min(24, Math.log10(repostsPerHour + 1) * 11) +
      Math.min(18, Math.log10(repliesPerHour + 1) * 9) +
      Math.min(12, Math.log10(likesPerHour + 1) * 5),
  );
}

function getBlueskyInteractionEventScore(interaction: BlueskyInteraction, profile?: BlueskyProfile) {
  const counts = sanitizeInteractionCounts({
    reposts: interaction.interactionType === "repost" ? 1 : 0,
    comments:
      interaction.interactionType === "reply" || interaction.interactionType === "quote" ? 1 : 0,
    likes: interaction.interactionType === "like" ? 1 : 0,
  });
  const eventCountBoost =
    Math.max(interaction.repostCount ?? 0, 0) +
    Math.max(interaction.replyCount ?? 0, 0) +
    Math.max(interaction.quoteCount ?? 0, 0) +
    Math.max(interaction.likeCount ?? 0, 0);
  const followerBoost = Math.min(
    7,
    Math.log10(Math.max(interaction.actorFollowersCount ?? profile?.followersCount ?? 0, 0) + 1) *
      1.8,
  );
  const quoteBoost = interaction.interactionType === "quote" ? 2.5 : 0;
  return round1(
    getWeightedInteractionScore(counts) +
      followerBoost +
      quoteBoost +
      Math.min(8, Math.log10(eventCountBoost + 1) * 2.5),
  );
}

function getPublicItemWeightedInteractionScore(
  item: PublicSourceItem,
  counts: NormalizedInteractionCounts,
) {
  if (item.sourceType === "bluesky") {
    const followerBoost = Math.min(9, Math.log10(Math.max(item.followerCount ?? 0, 0) + 1) * 2);
    const typeBoost = item.postType === "quote" ? 4 : item.postType === "reply" ? 2 : 0;
    return round1(getWeightedInteractionScore(counts) + followerBoost + typeBoost);
  }

  if (item.sourceType === "youtube") {
    return getYouTubeInteractionScore(item, counts);
  }

  return getWeightedInteractionScore(counts);
}

function getNarrativeInteractionScore(counts: NormalizedInteractionCounts) {
  const contributions = buildInteractionContributions(counts);
  return round1(contributions.posts + contributions.reposts);
}

function getCommentInteractionCounts(comment: RedditNormalizedComment): NormalizedInteractionCounts {
  return sanitizeInteractionCounts({
    comments: 1,
    likes: Math.max(comment.score, 0),
  });
}

function getRedditPostInteractionCounts(
  post: RedditNormalizedPost,
  observedCommentCount: number,
): NormalizedInteractionCounts {
  return sanitizeInteractionCounts({
    posts: 1,
    // Keep directly ingested Reddit comments as their own lower-level events.
    comments: Math.max(post.numComments - observedCommentCount, 0),
    likes: Math.max(post.score, 0),
  });
}

function getPublicItemInteractionCounts(item: PublicSourceItem): NormalizedInteractionCounts {
  if (item.interactionCounts) {
    return sanitizeInteractionCounts(item.interactionCounts);
  }

  if (item.sourceType === "bluesky") {
    return sanitizeInteractionCounts({
      posts: 1,
      reposts: Math.max((item.repostCount ?? 0) + (item.quoteCount ?? 0), 0),
      comments: Math.max(item.commentCount ?? item.numComments, 0),
      likes: Math.max(item.likeCount ?? item.score, 0),
    });
  }

  if (item.sourceType === "telegram") {
    return sanitizeInteractionCounts({
      posts: 1,
      reposts: Math.max(item.numComments, 0),
      likes: Math.max(item.score, 0),
    });
  }

  if (item.sourceType === "youtube") {
    return sanitizeInteractionCounts({
      posts: 1,
      comments:
        item.initialCommentCount ??
        item.commentCount ??
        parseSummaryMetric(item.summary, "Comments") ??
        Math.max(item.numComments, 0),
      likes:
        item.initialLikeCount ??
        item.likeCount ??
        parseSummaryMetric(item.summary, "Likes") ??
        0,
    });
  }

  if (item.sourceType === "hackernews" || item.sourceType === "lobsters") {
    return sanitizeInteractionCounts({
      posts: 1,
      comments: Math.max(item.numComments, 0),
      likes: Math.max(item.score, 0),
    });
  }

  if (item.sourceType === "googletrends") {
    return sanitizeInteractionCounts({
      posts: 1,
      reposts: Math.max(item.numComments, 0),
    });
  }

  return sanitizeInteractionCounts({
    posts: 1,
    comments: Math.max(item.numComments, 0),
  });
}

function getCommentInteractionScore(comment: RedditNormalizedComment) {
  return getWeightedInteractionScore(getCommentInteractionCounts(comment));
}

function isConversationalSource(document: TrendDocument) {
  return document.platformId === "reddit" && CONVERSATIONAL_SUBREDDITS.has(document.sourceKey);
}

function isQuestionLikeTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized.endsWith("?") || QUESTION_OPENERS.test(normalized);
}

function isGenericThreadTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  return GENERIC_THREAD_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isGenericThreadDocument(document: TrendDocument) {
  return isGenericThreadTitle(document.title);
}

function documentDiscoveryWeight(document: TrendDocument) {
  let weight =
    1 +
    Math.min(8, document.interactionCount / 20) +
    Math.min(4, Math.max(document.score, 0) / 60);

  if (document.documentKind === "comment") {
    weight *= 0.6;
  }

  if (document.documentKind === "delta") {
    weight *= 0.35;
  }

  if (isGenericThreadDocument(document) && extractNamedPhrases(document).length === 0) {
    weight *= 0.18;
  }

  if (isConversationalSource(document)) {
    weight *= 0.42;
  }

  if (isQuestionLikeTitle(document.title) && extractNamedPhrases(document).length === 0) {
    weight *= 0.58;
  }

  if (document.platformId === "bluesky") {
    const followerBoost = Math.min(
      2.5,
      Math.log10(Math.max(document.authorFollowersCount ?? 0, 0) + 1) * 0.7,
    );
    if (document.documentKind === "quote" || document.postType === "quote") {
      weight *= 1.18;
    }
    if (document.documentKind === "reply" || document.postType === "reply") {
      weight *= 0.96;
    }
    if (document.documentKind === "amplification") {
      weight *= 0.52;
    }
    if (document.rootDocumentId && document.rootDocumentId !== document.id) {
      weight *= 0.92;
    }
    weight += followerBoost;
  }

  return round1(weight);
}

function normalizeComponent(value: number, maxValue: number) {
  if (value <= 0 || maxValue <= 0) {
    return 0;
  }

  return round1((value / maxValue) * 100);
}

function extractApproxTrafficLabel(summary: string) {
  const match = summary.match(/Approx traffic\s+([^.]+)\./i);
  return match?.[1]?.trim() || null;
}

function buildGoogleSearchInterest(documents: TrendDocument[]) {
  const googleDocuments = documents
    .filter((document) => document.platformId === "google")
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.interactionCount - left.interactionCount;
    });

  if (googleDocuments.length === 0) {
    return null;
  }

  const strongest = googleDocuments[0];
  const matchedQueries = [
    ...new Set(googleDocuments.map((document) => document.title.trim()).filter(Boolean)),
  ];

  return {
    score: strongest.score,
    approxTrafficLabel:
      strongest.trafficLabel || extractApproxTrafficLabel(strongest.body) || null,
    matchedQueries: matchedQueries.slice(0, 3),
    queryCount: googleDocuments.length,
  };
}

function normalizeClusterToken(token: string) {
  const normalized = normalizeWord(token);
  if (!normalized) {
    return "";
  }

  const singular =
    normalized.endsWith("s") &&
    normalized.length > 4 &&
    !/(ss|us|is|as)$/.test(normalized)
      ? normalized.slice(0, -1)
      : normalized;

  return TOKEN_ALIASES[singular] ?? singular;
}

function isInformativeToken(token: string) {
  return (
    (token.length >= 3 || ACRONYMS.has(token)) &&
    !STOP_WORDS.has(token) &&
    !WEAK_LABEL_TOKENS.has(token)
  );
}

function canonicalPhraseKey(phrase: string) {
  const tokens = phrase
    .split(/\s+/)
    .map((token) => normalizeClusterToken(token))
    .filter(isInformativeToken);

  if (tokens.length === 1) {
    const token = tokens[0];
    if (
      !token ||
      STOP_WORDS.has(token) ||
      WEAK_LABEL_TOKENS.has(token) ||
      GENERIC_PLATFORM_LABEL_TOKENS.has(token) ||
      URLISH_LABEL_TOKENS.has(token)
    ) {
      return "";
    }

    return ACRONYMS.has(token) || IMPORTANT_NAME_TOKENS.has(token) || token.length >= 4 || /\d/.test(token)
      ? token
      : "";
  }

  if (tokens.length < 2) {
    return "";
  }

  return [...new Set(tokens)].sort().slice(0, 4).join(" ");
}

function isNamedPhraseToken(token: string) {
  return (
    Boolean(token) &&
    !WEAK_LABEL_TOKENS.has(token) &&
    (isInformativeToken(token) || IMPORTANT_NAME_TOKENS.has(token) || /^\d+(?:\.\d+)*$/.test(token))
  );
}

function extractNamedPhrases(document: TrendDocument) {
  const text = stripUrlArtifacts(getNarrativeEvidenceText(document))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .slice(0, 280);
  const matches =
    text.match(
      /\b(?:[A-Z][a-z]+(?:[A-Z][a-z]+)*|[A-Z]{2,}|[A-Z]|[A-Za-z]+GPT|[A-Z][a-z]+\d+|\d+[A-Za-z]+|\d+(?:\.\d+)*)(?:\s+(?:[A-Z][a-z]+(?:[A-Z][a-z]+)*|[A-Z]{2,}|[A-Z]|[A-Za-z]+GPT|[A-Z][a-z]+\d+|\d+[A-Za-z]+|\d+(?:\.\d+)*)){0,4}\b/g,
    ) ?? [];

  return [...new Set(matches)]
    .flatMap((phrase) => {
      const tokens = phrase
        .split(/\s+/)
        .map((part) => normalizeClusterToken(part))
        .filter(isNamedPhraseToken);

      if (tokens.length === 0) {
        return [];
      }

      const variants = new Set<string>([tokens.join(" ")]);
      if (tokens.length >= 2) {
        variants.add(tokens.slice(0, 2).join(" "));
        variants.add(tokens.slice(-2).join(" "));
      }
      if (tokens.length >= 3) {
        variants.add(tokens.slice(0, 3).join(" "));
      }

      return [...variants];
    })
    .filter((phrase) => {
      const label = phraseToLabel(phrase);
      return phrase.split(" ").length >= 2 || hasStandaloneNarrativeAnchor(label);
    });
}

function buildConfidenceScore({
  commentCount,
  threadCount,
  subredditCount,
  currentWindowComments,
  uniqueAuthorCount = 0,
  rootDocumentCount = 0,
  concentrationRisk = 0,
}: {
  commentCount: number;
  threadCount: number;
  subredditCount: number;
  currentWindowComments: number;
  uniqueAuthorCount?: number;
  rootDocumentCount?: number;
  concentrationRisk?: number;
}) {
  const commentDepth = Math.min(commentCount / 250, 1) * 44;
  const threadSupport = Math.min(threadCount / 8, 1) * 18;
  const sourceBreadth = Math.min(Math.max(subredditCount, uniqueAuthorCount) / 6, 1) * 18;
  const rootBreadth = Math.min(rootDocumentCount / 5, 1) * 12;
  const recentDepth = Math.min(currentWindowComments / 40, 1) * 10;
  const concentrationPenalty = Math.min(12, Math.max(0, concentrationRisk) * 18);

  return round1(commentDepth + threadSupport + sourceBreadth + rootBreadth + recentDepth - concentrationPenalty);
}

function getFreshnessAdjustedConfidence(rawConfidence: number, freshness: TrendFreshnessSummary) {
  const freshnessFactor = getFreshnessRankFactor(freshness.score);
  const stabilityFactor =
    freshness.state === "fresh"
      ? 1
      : freshness.state === "delayed"
        ? 0.96
        : freshness.state === "mixed"
          ? 0.9
          : 0.78;

  return round1(rawConfidence * freshnessFactor * stabilityFactor);
}

function normalizeWord(word: string) {
  return stripUrlArtifacts(word)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function stripUrlArtifacts(text: string) {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(BARE_DOMAIN_PATTERN, " ");
}

function tokenizeText(text: string) {
  return stripUrlArtifacts(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
}

function getNarrativeEvidenceText(document: TrendDocument) {
  if (document.documentKind === "comment") {
    return `${document.title} ${document.body}`.trim();
  }

  if (document.platformId === "youtube") {
    return `${document.title} ${document.body}`.trim();
  }

  if (isPublicNarrativePlatform(document.platformId)) {
    return `${document.title} ${document.body}`.trim();
  }

  return `${document.title} ${document.body.slice(0, 180)}`.trim();
}

function getNarrativeTokenText(document: TrendDocument) {
  if (document.documentKind === "comment") {
    return `${document.title} ${document.body}`.trim();
  }

  if (document.platformId === "youtube") {
    return `${document.title} ${document.body}`.trim();
  }

  if (isPublicNarrativePlatform(document.platformId)) {
    return `${document.title} ${document.body}`.trim();
  }

  return document.title;
}

function tokenize(document: TrendDocument) {
  const text = tokenizeText(getNarrativeTokenText(document));

  return text
    .split(/\s+/)
    .map((token) => normalizeWord(token))
    .filter(
      (token) =>
        (token.length >= 3 || ACRONYMS.has(token)) &&
      !STOP_WORDS.has(token) &&
      !/^\d+$/.test(token),
    );
}

function buildNarrativeTokenSet(document: TrendDocument) {
  return new Set(
    tokenizeText(getNarrativeTokenText(document))
      .split(/\s+/)
      .map((token) => normalizeClusterToken(token))
      .filter(isInformativeToken),
  );
}

function phraseToLabel(phrase: string) {
  return phrase
    .split(" ")
    .map((part) => {
      if (DISPLAY_TOKENS[part]) {
        return DISPLAY_TOKENS[part];
      }

      if (ACRONYMS.has(part)) {
        return part.toUpperCase();
      }

      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function normalizeNarrativeLabel(label: string) {
  return label.replace(/\s+/g, " ").trim();
}

function getNarrativeLabelTokens(label: string) {
  return normalizeNarrativeLabel(label)
    .split(/\s+/)
    .map((token) => normalizeClusterToken(token))
    .filter(Boolean);
}

function getNarrativeInformativeTokens(label: string) {
  return getNarrativeLabelTokens(label).filter(
    (token) => !STOP_WORDS.has(token) && !WEAK_LABEL_TOKENS.has(token),
  );
}

function hasStandaloneNarrativeAnchor(label: string) {
  const informativeTokens = getNarrativeInformativeTokens(label);
  return (
    informativeTokens.length >= 2 ||
    informativeTokens.some((token) => token.length >= 4 || ACRONYMS.has(token) || /\d/.test(token))
  );
}

function isFragmentLikeNarrativeLabel(label: string) {
  const normalizedLabel = normalizeNarrativeLabel(label);
  if (!normalizedLabel) {
    return true;
  }

  const normalizedPhrase = normalizedLabel
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedPhrase) {
    return true;
  }

  if (GENERIC_FRAGMENT_LABEL_PATTERNS.some((pattern) => pattern.test(normalizedPhrase))) {
    return true;
  }

  const tokens = getNarrativeLabelTokens(normalizedLabel);
  if (tokens.length === 0) {
    return true;
  }

  const informativeTokens = getNarrativeInformativeTokens(normalizedLabel);
  const uniqueInformativeTokenCount = new Set(informativeTokens).size;
  const leadToken = tokens[0];
  const tailToken = tokens[tokens.length - 1];
  const shortNarrative = tokens.length <= 3;

  if (shortNarrative && informativeTokens.length === 0) {
    return true;
  }

  if (
    shortNarrative &&
    (GENERIC_FRAGMENT_LEAD_TOKENS.has(leadToken) || GENERIC_FRAGMENT_TAIL_TOKENS.has(tailToken)) &&
    informativeTokens.length < 2
  ) {
    return true;
  }

  if (
    shortNarrative &&
    GENERIC_FRAGMENT_LEAD_TOKENS.has(leadToken) &&
    GENERIC_FRAGMENT_TAIL_TOKENS.has(tailToken)
  ) {
    return true;
  }

  if (
    tokens.length >= 3 &&
    uniqueInformativeTokenCount <= 1 &&
    informativeTokens.length > 0 &&
    tokens.some((token) => WEAK_LABEL_TOKENS.has(token) || STOP_WORDS.has(token))
  ) {
    return true;
  }

  return false;
}

function isWeakNarrativeLabel(label: string) {
  const normalizedLabel = normalizeNarrativeLabel(label);
  if (!normalizedLabel) {
    return true;
  }

  const normalizedPhrase = normalizedLabel
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedPhrase) {
    return true;
  }

  if (
    /^(how|why|what|when|where|who|can|should|would|could)\b/i.test(normalizedLabel) ||
    WEAK_LABEL_PHRASES.has(normalizedPhrase)
  ) {
    return true;
  }

  if (isGenericPlatformNarrativeLabel(normalizedLabel)) {
    return true;
  }

  if (isUrlLikeNarrativeLabel(normalizedLabel)) {
    return true;
  }

  if (isTemporalNarrativeLabel(normalizedLabel)) {
    return true;
  }

  const tokens = getNarrativeLabelTokens(normalizedLabel);
  if (tokens.length === 0) {
    return true;
  }

  const weakTokenCount = tokens.filter(
    (token) => STOP_WORDS.has(token) || WEAK_LABEL_TOKENS.has(token),
  ).length;
  const informativeTokens = getNarrativeInformativeTokens(normalizedLabel);
  const uniqueInformativeTokenCount = new Set(informativeTokens).size;
  const hasLongInformativeToken = informativeTokens.some(
    (token) => token.length >= 4 || /\d/.test(token),
  );
  const allInformativeTokensAreAcronyms =
    informativeTokens.length > 0 && informativeTokens.every((token) => ACRONYMS.has(token));

  if (informativeTokens.length === 0) {
    return true;
  }

  if (uniqueInformativeTokenCount <= 1 && informativeTokens.length >= 2) {
    return true;
  }

  if (informativeTokens.length <= 2 && !hasLongInformativeToken && !allInformativeTokensAreAcronyms) {
    return true;
  }

  if (isFragmentLikeNarrativeLabel(normalizedLabel) && informativeTokens.length < 2) {
    return true;
  }

  if (tokens.length <= 3 && weakTokenCount >= tokens.length - 1 && informativeTokens.length < 2) {
    return true;
  }

  if (
    (WEAK_LABEL_TOKENS.has(tokens[0]) ||
      WEAK_LABEL_TOKENS.has(tokens[tokens.length - 1]) ||
      STOP_WORDS.has(tokens[0]) ||
      STOP_WORDS.has(tokens[tokens.length - 1])) &&
    !hasStandaloneNarrativeAnchor(normalizedLabel)
  ) {
    return true;
  }

  if (tokens.length === 1 && !hasStandaloneNarrativeAnchor(normalizedLabel)) {
    return true;
  }

  return false;
}

function isUrlLikeNarrativeLabel(label: string) {
  const tokens = getNarrativeLabelTokens(label);
  if (tokens.length === 0) {
    return true;
  }

  const informativeTokens = getNarrativeInformativeTokens(label);
  const urlishTokenCount = tokens.filter((token) => URLISH_LABEL_TOKENS.has(token)).length;
  if (urlishTokenCount === 0) {
    return false;
  }

  if (tokens.some((token) => token === "com" || token === "www" || token === "http" || token === "https")) {
    return true;
  }

  return (
    informativeTokens.length <= 3 &&
    urlishTokenCount >= Math.max(1, informativeTokens.length - 1)
  );
}

function isGenericPlatformNarrativeLabel(label: string) {
  const normalizedLabel = normalizeNarrativeLabel(label);
  if (!normalizedLabel) {
    return true;
  }

  const normalizedPhrase = normalizedLabel
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedPhrase) {
    return true;
  }

  if (GENERIC_PLATFORM_LABEL_PHRASES.has(normalizedPhrase)) {
    return true;
  }

  const informativeTokens = getNarrativeInformativeTokens(normalizedLabel);
  if (informativeTokens.length === 0) {
    return true;
  }

  return informativeTokens.every((token) => GENERIC_PLATFORM_LABEL_TOKENS.has(token));
}

function isTemporalNarrativeLabel(label: string) {
  const normalizedLabel = normalizeNarrativeLabel(label)
    .toLowerCase()
    .replace(/[^a-z0-9:\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedLabel) {
    return true;
  }

  if (
    /^(?:\d{1,2}(?::\d{2})?|\d{1,2}\d{2})(?:am|pm)\s+[a-z]{2,5}$/i.test(normalizedLabel) ||
    /^(?:[a-z]{2,5}\s+)?(?:\d{1,2}(?::\d{2})?|\d{1,2}\d{2})(?:am|pm)$/i.test(normalizedLabel)
  ) {
    return true;
  }

  const informativeTokens = getNarrativeInformativeTokens(label);
  return (
    informativeTokens.length > 0 &&
    informativeTokens.length <= 3 &&
    informativeTokens.every(
      (token) =>
        TEMPORAL_LABEL_TOKENS.has(token) || /^(?:\d{1,2}(?::\d{2})?|\d{1,2}\d{2})(?:am|pm)$/i.test(token),
    )
  );
}

function countNarrativeLabelMatches(label: string, documents: TrendDocument[]) {
  const tokens = getNarrativeInformativeTokens(label);
  if (tokens.length === 0) {
    return 0;
  }

  return documents.reduce((count, document) => {
    const haystackTokens = buildNarrativeTokenSet(document);
    return tokens.every((token) => haystackTokens.has(token)) ? count + 1 : count;
  }, 0);
}

function countNarrativePartialMatches(label: string, documents: TrendDocument[]) {
  const tokens = getNarrativeInformativeTokens(label);
  if (tokens.length === 0) {
    return 0;
  }

  const minimumMatches = Math.max(1, Math.ceil(tokens.length * 0.6));
  return documents.reduce((count, document) => {
    const haystackTokens = buildNarrativeTokenSet(document);
    const tokenMatches = tokens.filter((token) => haystackTokens.has(token)).length;
    return tokenMatches >= minimumMatches ? count + 1 : count;
  }, 0);
}

function getDominantPhraseEvidence(
  documents: TrendDocument[],
  phraseBuilder: (document: TrendDocument) => string[],
): PhraseEvidence | undefined {
  const stats = new Map<
    string,
    {
      label: string;
      documentIds: Set<string>;
      totalWeight: number;
    }
  >();

  documents.forEach((document) => {
    const phrases = new Set(phraseBuilder(document));
    phrases.forEach((phrase) => {
      const key = canonicalPhraseKey(phrase);
      if (!key) {
        return;
      }

      const label = phraseToLabel(phrase);
      const existing = stats.get(key);
      if (existing) {
        existing.documentIds.add(document.id);
        existing.totalWeight += documentDiscoveryWeight(document);
        return;
      }

      stats.set(key, {
        label,
        documentIds: new Set([document.id]),
        totalWeight: documentDiscoveryWeight(document),
      });
    });
  });

  return [...stats.values()]
    .map((entry) => ({
      label: entry.label,
      support: entry.documentIds.size,
      totalWeight: round1(entry.totalWeight),
      qualityScore: getNarrativeLabelQualityScore(
        entry.label,
        documents,
        "named_phrase",
        entry.documentIds.size,
      ),
    }))
    .filter((entry) => entry.support >= 2 && !isWeakNarrativeLabel(entry.label))
    .sort((left, right) => {
      if (right.support !== left.support) {
        return right.support - left.support;
      }

      if (right.qualityScore !== left.qualityScore) {
        return right.qualityScore - left.qualityScore;
      }

      return right.totalWeight - left.totalWeight;
    })[0];
}

function buildTopicGroupCoherenceContext(documents: TrendDocument[]): TopicGroupCoherenceContext {
  return {
    dominantPhrase: getDominantPhraseEvidence(documents, buildCandidatePhrases),
    dominantNamedPhrase: getDominantPhraseEvidence(documents, extractNamedPhrases),
    genericThreadCount: documents.filter((document) => isGenericThreadDocument(document)).length,
  };
}

function getTopicGroupCoherenceScore(
  label: string,
  documents: TrendDocument[],
  context: TopicGroupCoherenceContext = buildTopicGroupCoherenceContext(documents),
) {
  if (documents.length === 0) {
    return 0;
  }

  const fullMatches = countNarrativeLabelMatches(label, documents);
  const partialMatches = countNarrativePartialMatches(label, documents);
  const dominantPhrase = context.dominantPhrase;
  const dominantNamedPhrase = context.dominantNamedPhrase;
  const genericThreadCount = context.genericThreadCount;
  let score = 0;

  score += (fullMatches / documents.length) * 46;
  score += (partialMatches / documents.length) * 18;
  score += Math.min(16, (dominantPhrase?.support ?? 0) * 5);
  score += Math.min(24, (dominantNamedPhrase?.support ?? 0) * 8);

  if (genericThreadCount / documents.length >= 0.5 && (dominantNamedPhrase?.support ?? 0) === 0) {
    score -= 20;
  }

  return round1(Math.max(0, score));
}

function getNarrativeLabelQualityScore(
  label: string,
  documents: TrendDocument[],
  labelSource: NarrativeLabelSource,
  namedPhraseSupport = 0,
) {
  if (isWeakNarrativeLabel(label)) {
    return 0;
  }

  const tokens = getNarrativeLabelTokens(label);
  const informativeTokens = getNarrativeInformativeTokens(label);
  const weakTokenCount = tokens.length - informativeTokens.length;
  const sourceDiversity = new Set(documents.map((document) => document.sourceKey)).size;
  const documentMatches = countNarrativeLabelMatches(label, documents);
  const conversationalDocumentCount = documents.filter((document) => isConversationalSource(document)).length;
  const questionLikeDocumentCount = documents.filter((document) => isQuestionLikeTitle(document.title)).length;
  const fragmentLikeLabel = isFragmentLikeNarrativeLabel(label);
  let score = 38;

  score += Math.min(24, informativeTokens.length * 8);
  score -= weakTokenCount * 14;
  score += tokens.length >= 2 && tokens.length <= 5 ? 12 : 0;
  score += hasStandaloneNarrativeAnchor(label) ? 12 : 0;
  score += Math.min(18, documentMatches * 6);
  score += Math.min(12, sourceDiversity * 4);
  score += Math.min(14, namedPhraseSupport * 4);

  if (labelSource === "ai") {
    score += 22;
  } else if (labelSource === "named_phrase") {
    score += 14;
  } else if (labelSource === "phrase") {
    score += 6;
  } else {
    score -= 10;
  }

  if (
    conversationalDocumentCount > 0 &&
    conversationalDocumentCount / Math.max(documents.length, 1) >= 0.5 &&
    namedPhraseSupport === 0
  ) {
    score -= 18;
  }

  if (
    questionLikeDocumentCount > 0 &&
    questionLikeDocumentCount / Math.max(documents.length, 1) >= 0.6 &&
    namedPhraseSupport === 0
  ) {
    score -= 12;
  }

  if (
    documents.filter((document) => isGenericThreadDocument(document)).length / Math.max(documents.length, 1) >=
      0.5 &&
    namedPhraseSupport === 0
  ) {
    score -= 20;
  }

  if (fragmentLikeLabel) {
    score -= 28;
  }

  return Math.max(0, round1(score));
}

function isMemeDocument(document: TrendDocument) {
  const haystack = `${document.sourceKey} ${document.title} ${document.body}`.toLowerCase();
  return MEME_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function isMemeTrend(documents: TrendDocument[]) {
  if (documents.length === 0) {
    return false;
  }

  const matches = documents.filter((document) => isMemeDocument(document)).length;
  return matches / documents.length >= 0.34;
}

function scopeMatchesPosts(documents: TrendDocument[], scope: TrendDashboardQuery["scope"]) {
  if (scope === "overall") {
    return true;
  }

  return isMemeTrend(documents);
}

function bucketSeries<T extends { createdUtc: number }>(
  items: T[],
  range: DateRangePreset,
  referenceTime: Date,
  valueSelector: (item: T) => number = () => 1,
): TimeSeriesPoint[] {
  const count = RANGE_POINTS[range];
  const totalMs = RANGE_MS[range];
  const bucketMs = totalMs / Math.max(count, 1);
  const startMs = referenceTime.getTime() - totalMs;
  const buckets = Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(Math.min(referenceTime.getTime(), startMs + (index + 1) * bucketMs)).toISOString(),
    value: 0,
  }));

  items.forEach((item) => {
    const itemMs = item.createdUtc * 1000;
    if (itemMs < startMs || itemMs > referenceTime.getTime()) {
      return;
    }

    const index = Math.min(
      buckets.length - 1,
      Math.max(0, Math.floor((itemMs - startMs) / bucketMs)),
    );

    buckets[index].value = round1(buckets[index].value + valueSelector(item));
  });

  return buckets;
}

function currentWindowTotal(points: TimeSeriesPoint[]) {
  const window = Math.max(1, Math.min(12, Math.floor(points.length * 0.08)));
  return points.slice(-window).reduce((sum, point) => sum + point.value, 0);
}

function previousWindowTotal(points: TimeSeriesPoint[]) {
  const window = Math.max(1, Math.min(12, Math.floor(points.length * 0.08)));
  const endIndex = Math.max(0, points.length - window);
  const startIndex = Math.max(0, endIndex - window);
  return points.slice(startIndex, endIndex).reduce((sum, point) => sum + point.value, 0);
}

function getNarrativeLookbackSeconds(range: DateRangePreset) {
  return Math.floor(Math.min(RANGE_MS["7d"], RANGE_MS[range] * 2) / 1000);
}

function previousDayCount<T extends { createdUtc: number }>(
  items: T[],
  referenceTime: Date,
  valueSelector: (item: T) => number = () => 1,
) {
  const endMs = referenceTime.getTime() - 24 * 60 * 60 * 1000;
  const startMs = endMs - 24 * 60 * 60 * 1000;

  return items.reduce((sum, item) => {
    const itemMs = item.createdUtc * 1000;
    if (itemMs < startMs || itemMs >= endMs) {
      return sum;
    }

    return sum + valueSelector(item);
  }, 0);
}

function getAgeMinutes(referenceTime: Date, timestamp: string | null | undefined) {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.round((referenceTime.getTime() - parsed) / 60_000));
}

function getTrendFreshnessState(score: number): TrendFreshnessState {
  if (score >= 78) {
    return "fresh";
  }

  if (score >= 58) {
    return "delayed";
  }

  if (score >= 38) {
    return "mixed";
  }

  return "stale";
}

function getPlatformFreshnessScore(platformId: PlatformId, ageMinutes: number | null) {
  if (ageMinutes === null) {
    return 30;
  }

  if (platformId === "bluesky") {
    if (ageMinutes <= 20) {
      return 100;
    }
    if (ageMinutes <= 60) {
      return 86;
    }
    if (ageMinutes <= 180) {
      return 66;
    }
    if (ageMinutes <= 720) {
      return 40;
    }
    return 16;
  }

  if (platformId === "youtube") {
    if (ageMinutes <= 120) {
      return 100;
    }
    if (ageMinutes <= 360) {
      return 84;
    }
    if (ageMinutes <= 1_440) {
      return 58;
    }
    if (ageMinutes <= 2_880) {
      return 34;
    }
    return 16;
  }

  if (platformId === "telegram" || platformId === "google" || platformId === "news") {
    if (ageMinutes <= 60) {
      return 100;
    }
    if (ageMinutes <= 240) {
      return 82;
    }
    if (ageMinutes <= 720) {
      return 58;
    }
    if (ageMinutes <= 1_440) {
      return 34;
    }
    return 14;
  }

  if (ageMinutes <= 60) {
    return 100;
  }
  if (ageMinutes <= 360) {
    return 80;
  }
  if (ageMinutes <= 1_440) {
    return 56;
  }
  if (ageMinutes <= 2_880) {
    return 34;
  }
  return 14;
}

function getDocumentFreshnessScore(
  document: TrendDocument,
  referenceTime: Date,
  sourceHealth?: Record<string, RedditSourceHealth>,
  overallHealth?: RedditIngestionHealth,
) {
  if (document.platformId === "reddit") {
    const source = sourceHealth?.[document.sourceKey];
    const sourceAgeMinutes =
      typeof source?.sourceAgeMinutes === "number"
        ? Math.max(0, Math.round(source.sourceAgeMinutes))
        : getAgeMinutes(referenceTime, source?.lastSuccessAt ?? source?.lastAttemptedAt ?? document.fetchedAt);
    const sourceScore = source?.freshnessScore ?? getPlatformFreshnessScore("reddit", sourceAgeMinutes);
    const coverageBonus = Math.min(12, (overallHealth?.coverageScore ?? 0) * 0.08);
    const backfillBonus = Math.min(8, (overallHealth?.backfillCompletenessPct ?? 0) * 0.05);
    const score = round1(Math.min(100, sourceScore * 0.8 + coverageBonus + backfillBonus));
    return {
      score,
      state: getTrendFreshnessState(score),
    };
  }

  const signalAgeMinutes = Math.max(
    0,
    Math.round((referenceTime.getTime() - document.createdUtc * 1000) / 60_000),
  );
  const fetchAgeMinutes = getAgeMinutes(referenceTime, document.fetchedAt);
  const effectiveAgeMinutes =
    fetchAgeMinutes === null
      ? signalAgeMinutes
      : Math.round((signalAgeMinutes + fetchAgeMinutes) / 2);
  const score = getPlatformFreshnessScore(document.platformId, effectiveAgeMinutes);

  return {
    score,
    state: getTrendFreshnessState(score),
  };
}

function buildTrendFreshness(
  documents: TrendDocument[],
  referenceTime: Date,
  sourceHealth?: Record<string, RedditSourceHealth>,
  overallHealth?: RedditIngestionHealth,
): TrendFreshnessSummary {
  if (documents.length === 0) {
    return {
      score: 0,
      state: "stale",
      confirmedPlatformSpread: 0,
      platformStates: [],
    };
  }

  const platformScores = new Map<
    PlatformId,
    {
      weightedScore: number;
      weight: number;
    }
  >();

  documents.forEach((document) => {
    const freshness = getDocumentFreshnessScore(document, referenceTime, sourceHealth, overallHealth);
    const weight =
      1 +
      Math.min(2.8, Math.log10(Math.max(document.interactionCount, 0) + 1)) +
      (document.documentKind === "delta" ? 0.3 : 0);
    const current = platformScores.get(document.platformId);
    if (current) {
      current.weightedScore += freshness.score * weight;
      current.weight += weight;
      return;
    }

    platformScores.set(document.platformId, {
      weightedScore: freshness.score * weight,
      weight,
    });
  });

  const platformStates = [...platformScores.entries()].map(([platformId, values]) => {
    const score = round1(values.weightedScore / Math.max(values.weight, 1));
    return {
      platformId,
      score,
      state: getTrendFreshnessState(score),
    };
  });
  const score = round1(
    platformStates.reduce((sum, entry) => sum + entry.score, 0) / Math.max(platformStates.length, 1),
  );
  const mixedPlatformAges =
    platformStates.some((entry) => entry.score < 42) &&
    platformStates.some((entry) => entry.score >= 68);

  return {
    score,
    state: mixedPlatformAges ? "mixed" : getTrendFreshnessState(score),
    confirmedPlatformSpread: platformStates.filter((entry) => entry.score >= 55).length,
    platformStates,
  };
}

function getTrendUnique24hInteractionCount(
  group: Pick<TopicGroup, "documents" | "comments">,
  scoped: Pick<
    ScopedAnalyticsSnapshot,
    "blueskyWindowInteractionCountByRoot" | "blueskyWindowDeltaCountByRoot"
  >,
) {
  const countedBlueskyRoots = new Set<string>();
  const countedDocumentIds = new Set<string>();
  let total = 0;

  group.documents.forEach((document) => {
    if (document.platformId === "bluesky") {
      const rootId = document.rootDocumentId ?? document.id;
      if (!rootId || countedBlueskyRoots.has(rootId)) {
        return;
      }

      countedBlueskyRoots.add(rootId);
      total += scoped.blueskyWindowInteractionCountByRoot.get(rootId) ?? 0;
      return;
    }

    if (document.documentKind === "delta" || countedDocumentIds.has(document.id)) {
      return;
    }

    countedDocumentIds.add(document.id);
    total += getRawInteractionCount(document.interactionCounts);
  });

  total += group.comments.reduce(
    (sum, comment) => sum + getRawInteractionCount(getCommentInteractionCounts(comment)),
    0,
  );

  return total;
}

function buildScopedAnalyticsSnapshot(
  posts: RedditNormalizedPost[],
  comments: RedditNormalizedComment[],
  publicItems: PublicSourceItem[],
  blueskyPosts: BlueskyNormalizedPost[],
  blueskyInteractions: BlueskyInteraction[],
  blueskyPostSnapshots: BlueskyPostSnapshot[],
  blueskyProfiles: BlueskyProfile[],
  youtubeComments: YouTubeNormalizedComment[],
  youtubeVideoSnapshots: YouTubeVideoSnapshot[],
  query: TrendDashboardQuery,
  referenceTime: Date,
): ScopedAnalyticsSnapshot {
  const lookbackSeconds = getNarrativeLookbackSeconds(query.range);
  const cutoffUtc = Math.floor(referenceTime.getTime() / 1000) - lookbackSeconds;
  const windowCutoffUtc = Math.floor(
    (referenceTime.getTime() - RANGE_MS[query.range]) / 1000,
  );
  const scopedComments = comments.filter((comment) => comment.createdUtc >= cutoffUtc);
  const activeCommentPostIds = new Set(scopedComments.map((comment) => comment.postId));
  const scopedPosts = posts.filter(
    (post) => post.createdUtc >= cutoffUtc || activeCommentPostIds.has(post.id),
  );
  const scopedPublicItems = publicItems.filter((item) => item.createdUtc >= cutoffUtc);
  const lookbackBlueskyInteractionsAll = blueskyInteractions.filter(
    (interaction) => interaction.createdUtc >= cutoffUtc,
  );
  const lookbackBlueskyPostSnapshotsAll = blueskyPostSnapshots.filter(
    (snapshot) => snapshot.createdUtc >= cutoffUtc,
  );
  const scopedBlueskyInteractions = lookbackBlueskyInteractionsAll;
  const scopedBlueskyPostSnapshots = lookbackBlueskyPostSnapshotsAll;
  const activeLookbackBlueskyRootIds = new Set(
    scopedBlueskyInteractions.map((interaction) => getBlueskyInteractionRootId(interaction)),
  );
  scopedBlueskyPostSnapshots.forEach((snapshot) =>
    activeLookbackBlueskyRootIds.add(snapshot.postUri),
  );
  const scopedBlueskyPostsUnbounded = blueskyPosts.filter((post) => {
    const rootId = getBlueskyPostRootId(post);
    return (
      post.createdUtc >= cutoffUtc ||
      activeLookbackBlueskyRootIds.has(rootId) ||
      activeLookbackBlueskyRootIds.has(post.id)
    );
  });
  const scopedBlueskyPosts = limitBlueskyPostsForAnalytics(
    scopedBlueskyPostsUnbounded,
    query.range,
  );
  const windowBlueskyInteractions = scopedBlueskyInteractions.filter(
    (interaction) => interaction.createdUtc >= windowCutoffUtc,
  );
  const windowBlueskyPostSnapshots = scopedBlueskyPostSnapshots.filter(
    (snapshot) => snapshot.createdUtc >= windowCutoffUtc,
  );
  const activeWindowBlueskyRootIds = new Set(
    windowBlueskyInteractions.map((interaction) => getBlueskyInteractionRootId(interaction)),
  );
  windowBlueskyPostSnapshots.forEach((snapshot) =>
    activeWindowBlueskyRootIds.add(snapshot.postUri),
  );
  const windowBlueskyPosts = scopedBlueskyPosts.filter((post) => {
    const rootId = getBlueskyPostRootId(post);
    return (
      post.createdUtc >= windowCutoffUtc ||
      activeWindowBlueskyRootIds.has(rootId) ||
      activeWindowBlueskyRootIds.has(post.id)
    );
  });
  const scopedBlueskyAuthorIds = new Set(
    scopedBlueskyPosts.map((post) => post.authorDid).concat(
      scopedBlueskyInteractions
        .map((interaction) => interaction.actorDid)
        .filter((did): did is string => Boolean(did)),
    ),
  );
  const scopedBlueskyProfiles = blueskyProfiles.filter((profile) =>
    scopedBlueskyAuthorIds.has(profile.did),
  );
  const scopedYouTubeComments = youtubeComments.filter((comment) => comment.createdUtc >= cutoffUtc);
  const scopedYouTubeVideoSnapshots = youtubeVideoSnapshots.filter(
    (snapshot) => snapshot.createdUtc >= cutoffUtc,
  );

  if (
    ANALYTICS_DEBUG &&
    (scopedBlueskyPosts.length !== scopedBlueskyPostsUnbounded.length ||
      scopedBlueskyInteractions.length !== lookbackBlueskyInteractionsAll.length ||
      scopedBlueskyPostSnapshots.length !== lookbackBlueskyPostSnapshotsAll.length)
  ) {
    console.info("[analytics] applied bluesky scoped limits", {
      range: query.range,
      posts: {
        input: scopedBlueskyPostsUnbounded.length,
        scoped: scopedBlueskyPosts.length,
      },
      interactions: {
        input: lookbackBlueskyInteractionsAll.length,
        scoped: scopedBlueskyInteractions.length,
      },
      snapshots: {
        input: lookbackBlueskyPostSnapshotsAll.length,
        scoped: scopedBlueskyPostSnapshots.length,
      },
    });
  }

  const blueskyProfileByDid = new Map(
    scopedBlueskyProfiles.map((profile) => [profile.did, profile] as const),
  );
  const blueskyPostById = new Map(scopedBlueskyPosts.map((post) => [post.id, post] as const));
  const windowBlueskyPostById = new Map(windowBlueskyPosts.map((post) => [post.id, post] as const));
  const blueskyPostsByRoot = new Map<string, BlueskyNormalizedPost[]>();
  scopedBlueskyPosts.forEach((post) => {
    const rootId = getBlueskyPostRootId(post);
    const existing = blueskyPostsByRoot.get(rootId);
    if (existing) {
      existing.push(post);
      return;
    }
    blueskyPostsByRoot.set(rootId, [post]);
  });
  const blueskyInteractionsByRoot = new Map<string, BlueskyInteraction[]>();
  scopedBlueskyInteractions.forEach((interaction) => {
    const rootId = getBlueskyInteractionRootId(interaction);
    const existing = blueskyInteractionsByRoot.get(rootId);
    if (existing) {
      existing.push(interaction);
      return;
    }
    blueskyInteractionsByRoot.set(rootId, [interaction]);
  });
  const blueskySnapshotsByRoot = new Map<string, BlueskyPostSnapshot[]>();
  scopedBlueskyPostSnapshots.forEach((snapshot) => {
    const parent = blueskyPostById.get(snapshot.postUri);
    const rootId = parent ? getBlueskyPostRootId(parent) : snapshot.postUri;
    const existing = blueskySnapshotsByRoot.get(rootId);
    if (existing) {
      existing.push(snapshot);
      return;
    }
    blueskySnapshotsByRoot.set(rootId, [snapshot]);
  });
  const blueskyWindowPostsByRoot = new Map<string, BlueskyNormalizedPost[]>();
  windowBlueskyPosts.forEach((post) => {
    const rootId = getBlueskyPostRootId(post);
    const existing = blueskyWindowPostsByRoot.get(rootId);
    if (existing) {
      existing.push(post);
      return;
    }
    blueskyWindowPostsByRoot.set(rootId, [post]);
  });
  const blueskyWindowInteractionsByRoot = new Map<string, BlueskyInteraction[]>();
  windowBlueskyInteractions.forEach((interaction) => {
    const rootId = getBlueskyInteractionRootId(interaction);
    const existing = blueskyWindowInteractionsByRoot.get(rootId);
    if (existing) {
      existing.push(interaction);
      return;
    }
    blueskyWindowInteractionsByRoot.set(rootId, [interaction]);
  });
  const blueskyWindowSnapshotsByRoot = new Map<string, BlueskyPostSnapshot[]>();
  windowBlueskyPostSnapshots.forEach((snapshot) => {
    const parent = windowBlueskyPostById.get(snapshot.postUri) ?? blueskyPostById.get(snapshot.postUri);
    const rootId = parent ? getBlueskyPostRootId(parent) : snapshot.postUri;
    const existing = blueskyWindowSnapshotsByRoot.get(rootId);
    if (existing) {
      existing.push(snapshot);
      return;
    }
    blueskyWindowSnapshotsByRoot.set(rootId, [snapshot]);
  });
  const blueskyWindowInteractionCountByRoot = new Map<string, number>();
  windowBlueskyInteractions.forEach((interaction) => {
    incrementNumberMap(
      blueskyWindowInteractionCountByRoot,
      getBlueskyInteractionRootId(interaction),
      1,
    );
  });
  const blueskyWindowDeltaCountByRoot = new Map<string, number>();
  windowBlueskyPostSnapshots.forEach((snapshot) => {
    const parent = windowBlueskyPostById.get(snapshot.postUri) ?? blueskyPostById.get(snapshot.postUri);
    const rootId = parent ? getBlueskyPostRootId(parent) : snapshot.postUri;
    incrementNumberMap(
      blueskyWindowDeltaCountByRoot,
      rootId,
      getRawInteractionCount({
        reposts: Math.max((snapshot.deltaRepostCount ?? 0) + (snapshot.deltaQuoteCount ?? 0), 0),
        comments: Math.max(snapshot.deltaCommentCount ?? 0, 0),
        likes: Math.max(snapshot.deltaLikeCount ?? 0, 0),
      }),
    );
  });

  return {
    cutoffUtc,
    windowCutoffUtc,
    scopedPosts,
    scopedComments,
    scopedPublicItems,
    scopedBlueskyPosts,
    scopedBlueskyInteractions,
    scopedBlueskyPostSnapshots,
    scopedBlueskyProfiles,
    windowBlueskyPosts,
    windowBlueskyInteractions,
    windowBlueskyPostSnapshots,
    scopedYouTubeComments,
    scopedYouTubeVideoSnapshots,
    blueskyPostsByRoot,
    blueskyInteractionsByRoot,
    blueskySnapshotsByRoot,
    blueskyWindowPostsByRoot,
    blueskyWindowInteractionsByRoot,
    blueskyWindowSnapshotsByRoot,
    blueskyProfileByDid,
    blueskyWindowInteractionCountByRoot,
    blueskyWindowDeltaCountByRoot,
  };
}

function getBlueskyActivityTimestampBounds(
  posts: BlueskyNormalizedPost[],
  interactions: BlueskyInteraction[],
  snapshots: BlueskyPostSnapshot[],
) {
  const timestamps = [
    ...posts.map((post) => post.createdUtc),
    ...interactions.map((interaction) => interaction.createdUtc),
    ...snapshots.map((snapshot) => snapshot.createdUtc),
  ].filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return {
      firstSeenAt: null,
      lastSeenAt: null,
    };
  }

  return {
    firstSeenAt: new Date(Math.min(...timestamps) * 1000).toISOString(),
    lastSeenAt: new Date(Math.max(...timestamps) * 1000).toISOString(),
  };
}

function getBlueskyRootShortId(rootId: string) {
  return rootId.split("/").at(-1)?.slice(-8) ?? rootId.slice(-8);
}

function buildBlueskyRootFallbackLabel(
  rootId: string,
  posts: BlueskyNormalizedPost[],
  documents: TrendDocument[],
  interactions: BlueskyInteraction[],
) {
  const candidateTexts = [
    ...posts.flatMap((post) => [post.title ?? "", getBlueskyPostText(post)]),
    ...documents.flatMap((document) => [document.title, document.body]),
    ...interactions.map((interaction) => getBlueskyInteractionText(interaction)),
  ];

  for (const candidate of candidateTexts) {
    const informativeTokens = getNarrativeInformativeTokens(candidate);
    if (informativeTokens.length >= 2) {
      const label = phraseToLabel(informativeTokens.slice(0, 6).join(" "));
      if (
        label &&
        !isGenericPlatformNarrativeLabel(label) &&
        !isTemporalNarrativeLabel(label) &&
        !isUrlLikeNarrativeLabel(label)
      ) {
        return label;
      }
    }

    const normalized = normalizeNarrativeLabel(candidate)
      .split(/\s+/)
      .slice(0, 8)
      .join(" ")
      .trim();
    if (
      normalized &&
      !isGenericPlatformNarrativeLabel(normalized) &&
      !isTemporalNarrativeLabel(normalized) &&
      !isUrlLikeNarrativeLabel(normalized)
    ) {
      return normalized;
    }
  }

  return `Bluesky topic ${getBlueskyRootShortId(rootId)}`;
}

function buildBlueskyRootPlaceholderDocument(
  rootId: string,
  fallbackLabel: string,
  posts: BlueskyNormalizedPost[],
  interactions: BlueskyInteraction[],
  snapshots: BlueskyPostSnapshot[],
): TrendDocument {
  const representativePost = posts[0];
  const representativeInteraction =
    interactions.find((interaction) => Boolean(getBlueskyInteractionText(interaction))) ??
    interactions[0];
  const firstSeenUtc =
    representativePost?.createdUtc ??
    representativeInteraction?.createdUtc ??
    snapshots[0]?.createdUtc ??
    0;
  const authorHandle =
    representativePost?.authorHandle ??
    representativeInteraction?.actorHandle ??
    null;
  const authorId =
    representativePost?.authorDid ??
    representativeInteraction?.actorDid ??
    null;

  return {
    id: `synthetic:${rootId}`,
    platformId: "bluesky",
    documentKind: "primary",
    rootDocumentId: rootId,
    parentDocumentId: null,
    sourceKey: (authorHandle ?? authorId ?? rootId).toLowerCase(),
    sourceLabel: "Bluesky",
    sourceType: "bluesky",
    title: fallbackLabel,
    body: "",
    author:
      representativePost?.authorDisplayName ??
      representativeInteraction?.actorDisplayName ??
      authorHandle ??
      "Bluesky account",
    authorId,
    authorHandle,
    authorFollowersCount:
      representativePost?.authorFollowersCount ??
      representativeInteraction?.actorFollowersCount ??
      null,
    postType: representativePost?.postType ?? "root",
    url:
      representativePost?.url ??
      representativeInteraction?.url ??
      "https://bsky.app",
    createdUtc: firstSeenUtc,
    fetchedAt: representativePost?.fetchedAt ?? representativeInteraction?.fetchedAt ?? null,
    score: 0,
    interactionCounts: sanitizeInteractionCounts({}),
    interactionCount: 0,
    narrativeInteractionCount: 0,
  };
}

const BLUESKY_INTERNAL_TOPIC_HOSTS = new Set(["bsky.app", "staging.bsky.app", "bsky.social"]);
const TOPIC_URL_QUERY_DROP_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "si",
  "ref",
  "ref_src",
]);

function extractUrlsFromText(text: string) {
  return text.match(/https?:\/\/[^\s)]+/gi) ?? [];
}

function canonicalizeTrendUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (BLUESKY_INTERNAL_TOPIC_HOSTS.has(parsed.hostname.toLowerCase())) {
      return null;
    }

    parsed.hash = "";
    [...parsed.searchParams.keys()].forEach((key) => {
      if (TOPIC_URL_QUERY_DROP_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    });

    const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
    const search = parsed.searchParams.toString();
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${normalizedPath}${search ? `?${search}` : ""}`;
  } catch {
    return null;
  }
}

function extractHashtagsFromText(text: string) {
  return [...new Set((text.match(/#([A-Za-z0-9_]{2,40})/g) ?? []).map((tag) => tag.slice(1)))];
}

function toReadableHashtagLabel(tag: string) {
  const normalized = normalizeClusterToken(tag.replace(/^#/, ""));
  if (!normalized) {
    return "";
  }

  return `#${phraseToLabel(normalized)}`;
}

function buildBlueskyRootSignalStats(
  documents: TrendDocument[],
  values: string[],
  labelType: Exclude<TrendLabelType, "canonical_url_title" | "cleaned_singleton_text" | "fallback_generated">,
) {
  const stats = new Map<string, BlueskyRootSignalStat>();

  values.forEach((value) => {
    const normalizedValue = value.replace(/^#/, "").trim();
    const key =
      labelType === "hashtag_label"
        ? normalizeClusterToken(normalizedValue)
        : canonicalPhraseKey(normalizedValue);
    if (!key) {
      return;
    }

    const label =
      labelType === "hashtag_label" ? toReadableHashtagLabel(normalizedValue) : phraseToLabel(normalizedValue);
    if (
      !label ||
      isWeakNarrativeLabel(label) ||
      isGenericPlatformNarrativeLabel(label) ||
      isTemporalNarrativeLabel(label) ||
      isUrlLikeNarrativeLabel(label)
    ) {
      return;
    }

    const existing = stats.get(key);
    if (existing) {
      existing.support += 1;
      existing.weight += 1;
      existing.qualityScore = Math.max(
        existing.qualityScore,
        getNarrativeLabelQualityScore(
          label,
          documents,
          labelType === "entity_label" ? "named_phrase" : "phrase",
          labelType === "entity_label" ? 1 : 0,
        ),
      );
      return;
    }

    stats.set(key, {
      key,
      label,
      support: 1,
      weight: 1,
      qualityScore: getNarrativeLabelQualityScore(
        label,
        documents,
        labelType === "entity_label" ? "named_phrase" : "phrase",
        labelType === "entity_label" ? 1 : 0,
      ),
    });
  });

  return [...stats.values()].sort((left, right) => {
    if (right.support !== left.support) {
      return right.support - left.support;
    }
    if (right.qualityScore !== left.qualityScore) {
      return right.qualityScore - left.qualityScore;
    }

    return right.label.length - left.label.length;
  });
}

function buildBlueskyUrlSignals(documents: TrendDocument[]) {
  const stats = new Map<string, BlueskyRootSignalStat>();

  documents.forEach((document) => {
    const urls = new Set<string>();
    const directUrl = canonicalizeTrendUrl(document.url);
    if (directUrl) {
      urls.add(directUrl);
    }
    extractUrlsFromText(getNarrativeEvidenceText(document)).forEach((url) => {
      const normalized = canonicalizeTrendUrl(url);
      if (normalized) {
        urls.add(normalized);
      }
    });

    urls.forEach((url) => {
      const labelCandidate = normalizeNarrativeLabel(document.title).trim();
      const label =
        labelCandidate &&
        !isWeakNarrativeLabel(labelCandidate) &&
        !isUrlLikeNarrativeLabel(labelCandidate) &&
        !isGenericPlatformNarrativeLabel(labelCandidate)
          ? labelCandidate
          : buildBlueskyRootFallbackLabel(document.rootDocumentId ?? document.id, [], [document], []);
      const qualityScore = getNarrativeLabelQualityScore(label, documents, "phrase", 0);
      const existing = stats.get(url);
      if (existing) {
        existing.support += 1;
        existing.weight += documentDiscoveryWeight(document);
        if (qualityScore > existing.qualityScore) {
          existing.qualityScore = qualityScore;
          existing.label = label;
        }
        return;
      }

      stats.set(url, {
        key: url,
        label,
        support: 1,
        weight: documentDiscoveryWeight(document),
        qualityScore,
      });
    });
  });

  return [...stats.values()].sort((left, right) => {
    if (right.support !== left.support) {
      return right.support - left.support;
    }
    if (right.weight !== left.weight) {
      return right.weight - left.weight;
    }

    return right.qualityScore - left.qualityScore;
  });
}

function buildBlueskyCleanSingletonTextLabel(documents: TrendDocument[]) {
  const bestDocument =
    documents.find((document) => document.documentKind === "primary") ??
    documents.find((document) => document.documentKind !== "delta") ??
    documents[0];

  if (!bestDocument) {
    return null;
  }

  const namedPhrase = extractNamedPhrases(bestDocument)
    .map((phrase) => phraseToLabel(phrase))
    .find(
      (label) =>
        label &&
        !isWeakNarrativeLabel(label) &&
        !isGenericPlatformNarrativeLabel(label) &&
        !isTemporalNarrativeLabel(label) &&
        !isUrlLikeNarrativeLabel(label),
    );
  if (namedPhrase) {
    return namedPhrase;
  }

  const phrase = buildCandidatePhrases(bestDocument)
    .map((candidate) => phraseToLabel(candidate))
    .find(
      (label) =>
        label &&
        !isWeakNarrativeLabel(label) &&
        !isFragmentLikeNarrativeLabel(label) &&
        !isUrlLikeNarrativeLabel(label),
    );
  if (phrase) {
    return phrase;
  }

  const informativeTokens = tokenize(bestDocument)
    .map((token) => normalizeClusterToken(token))
    .filter(isInformativeToken)
    .slice(0, 6);
  if (informativeTokens.length >= 2) {
    const label = phraseToLabel(informativeTokens.join(" "));
    if (
      label &&
      !isWeakNarrativeLabel(label) &&
      !isFragmentLikeNarrativeLabel(label) &&
      !isUrlLikeNarrativeLabel(label)
    ) {
      return label;
    }
  }

  return null;
}

function getBlueskySingletonLabel(
  rootId: string,
  documents: TrendDocument[],
  urlSignals: BlueskyRootSignalStat[],
  entitySignals: BlueskyRootSignalStat[],
  phraseSignals: BlueskyRootSignalStat[],
  hashtagSignals: BlueskyRootSignalStat[],
) {
  const bestUrlLabel = urlSignals.find((signal) => signal.qualityScore >= 54)?.label;
  if (bestUrlLabel) {
    return {
      label: bestUrlLabel,
      labelType: "canonical_url_title" as const,
      qualityScore: urlSignals[0]?.qualityScore ?? 0,
    };
  }

  const bestEntity = entitySignals.find((signal) => signal.qualityScore >= 48);
  if (bestEntity) {
    return {
      label: bestEntity.label,
      labelType: "entity_label" as const,
      qualityScore: bestEntity.qualityScore,
    };
  }

  const bestPhrase = phraseSignals.find((signal) => signal.qualityScore >= 42);
  if (bestPhrase) {
    return {
      label: bestPhrase.label,
      labelType: "repeated_phrase" as const,
      qualityScore: bestPhrase.qualityScore,
    };
  }

  const bestHashtag = hashtagSignals[0];
  if (bestHashtag) {
    return {
      label: bestHashtag.label,
      labelType: "hashtag_label" as const,
      qualityScore: bestHashtag.qualityScore,
    };
  }

  const cleanedTextLabel = buildBlueskyCleanSingletonTextLabel(documents);
  if (cleanedTextLabel) {
    return {
      label: cleanedTextLabel,
      labelType: "cleaned_singleton_text" as const,
      qualityScore: getNarrativeLabelQualityScore(cleanedTextLabel, documents, "phrase", 0),
    };
  }

  return {
    label: `Bluesky topic ${getBlueskyRootShortId(rootId)}`,
    labelType: "fallback_generated" as const,
    qualityScore: 0,
  };
}

function getBlueskyLabelSource(labelType: TrendLabelType): NarrativeLabelSource {
  if (labelType === "ai_generated") {
    return "ai";
  }

  if (labelType === "entity_label") {
    return "named_phrase";
  }

  if (labelType === "fallback_generated") {
    return "fallback";
  }

  return "phrase";
}

function normalizeAiGroupingKey(value: string | null | undefined) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9#@]+/i)
    .map((token) => normalizeClusterToken(token))
    .filter((token) => token && !STOP_WORDS.has(token))
    .slice(0, 8)
    .join("-");

  return normalized || null;
}

function buildBlueskyAiSingletonLabel(
  root: CanonicalBlueskyRoot,
  interpretation: BlueskyAiRootInterpretation,
) {
  const preferred =
    phraseToLabel(interpretation.candidateLabel) ??
    phraseToLabel(interpretation.summaryTopic) ??
    root.singletonLabel;

  return preferred || root.singletonLabel;
}

function scoreBlueskyGroupingCandidate(candidate: BlueskyRootTopicCandidate) {
  const typeWeight =
    candidate.candidateType === "ai_semantic"
      ? 600
      : candidate.candidateType === "author_template"
        ? 520
        : candidate.candidateType === "hybrid"
          ? 440
          : candidate.candidateType === "entity"
            ? 360
            : candidate.candidateType === "phrase"
              ? 300
              : candidate.candidateType === "hashtag"
                ? 240
                : 120;

  return typeWeight + candidate.priority + candidate.support * 22 + candidate.qualityScore;
}

function getBestBlueskySemanticCandidate(root: CanonicalBlueskyRoot) {
  return [...root.candidateTopicKeys]
    .filter((candidate) => candidate.candidateType !== "url" && candidate.candidateType !== "author_template")
    .sort((left, right) => {
      const scoreDelta = scoreBlueskyGroupingCandidate(right) - scoreBlueskyGroupingCandidate(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return right.label.length - left.label.length;
    })[0] ?? null;
}

function getBestBlueskyUrlCandidate(root: CanonicalBlueskyRoot) {
  return [...root.candidateTopicKeys]
    .filter((candidate) => candidate.candidateType === "url")
    .sort((left, right) => {
      const scoreDelta = scoreBlueskyGroupingCandidate(right) - scoreBlueskyGroupingCandidate(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return right.label.length - left.label.length;
    })[0] ?? null;
}

function getBlueskyUrlAnchorRootCounts(roots: CanonicalBlueskyRoot[]) {
  return roots.reduce((counts, root) => {
    const seenKeys = new Set(
      root.candidateTopicKeys
        .filter((candidate) => candidate.candidateType === "url")
        .map((candidate) => candidate.key),
    );

    seenKeys.forEach((key) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    return counts;
  }, new Map<string, number>());
}

function selectBlueskyRootAssignment(
  root: CanonicalBlueskyRoot,
  canonicalAiKeys: Map<string, string>,
  options: {
    urlAnchorRootCounts: Map<string, number>;
    allowUniqueUrlAnchors: boolean;
  },
): BlueskyRootAssignment {
  const aiCandidateKey = root.primaryAiGroupingKey
    ? `ai:${canonicalAiKeys.get(root.primaryAiGroupingKey) ?? root.primaryAiGroupingKey}`
    : null;
  const aiInterpretation = root.aiInterpretation;
  const aiLabel = aiInterpretation
    ? buildBlueskyAiSingletonLabel(root, aiInterpretation)
    : root.singletonLabel;
  const aiQualityScore = aiInterpretation ? getBlueskyAiLabelQualityScore(root, aiInterpretation, aiLabel) : 0;
  const bestSemanticCandidate = getBestBlueskySemanticCandidate(root);
  const bestUrlCandidate = getBestBlueskyUrlCandidate(root);
  const urlAnchorRootCount = bestUrlCandidate
    ? options.urlAnchorRootCounts.get(bestUrlCandidate.key) ?? 0
    : 0;
  const templateCandidate = root.candidateTopicKeys.find(
    (candidate) => candidate.candidateType === "author_template",
  );

  if (
    templateCandidate &&
    aiInterpretation &&
    (aiInterpretation.isTemplateLike ||
      aiInterpretation.templateLikelihood >= 0.72 ||
      aiInterpretation.spamLikelihood >= 0.72 ||
      aiInterpretation.contentType === "promotion" ||
      aiInterpretation.contentType === "spam" ||
      aiInterpretation.trendCategory === "spam_promo")
  ) {
    return {
      root,
      assignedKey: templateCandidate.key,
      assignedLabel: templateCandidate.label,
      assignedLabelType: templateCandidate.labelType,
      assignedLabelQualityScore: templateCandidate.qualityScore,
      groupingSource: "template_anchor",
      groupingBasis: "template",
      groupingReason: `AI marked root as template-like or promo (${aiInterpretation.contentType}/${aiInterpretation.trendCategory})`,
    };
  }

  if (aiCandidateKey && aiInterpretation) {
    return {
      root,
      assignedKey: aiCandidateKey,
      assignedLabel: aiLabel,
      assignedLabelType: "ai_generated",
      assignedLabelQualityScore: aiQualityScore,
      groupingSource: "ai_semantic_cluster",
      groupingBasis: "ai",
      groupingReason: `ai semantic key ${root.primaryAiGroupingKey}`,
    };
  }

  if (
    bestUrlCandidate &&
    bestUrlCandidate.qualityScore >= 54 &&
    (urlAnchorRootCount > 1 || options.allowUniqueUrlAnchors || !bestSemanticCandidate)
  ) {
    return {
      root,
      assignedKey: bestUrlCandidate.key,
      assignedLabel: bestUrlCandidate.label,
      assignedLabelType: bestUrlCandidate.labelType,
      assignedLabelQualityScore: bestUrlCandidate.qualityScore,
      groupingSource: "canonical_url_anchor",
      groupingBasis: "url",
      groupingReason: `canonical URL anchor (${bestUrlCandidate.key}, roots=${urlAnchorRootCount})`,
    };
  }

  if (bestSemanticCandidate) {
    const semanticBasis = bestSemanticCandidate.candidateType === "ai_semantic" ? "ai" : "heuristic";
    return {
      root,
      assignedKey: bestSemanticCandidate.key,
      assignedLabel: bestSemanticCandidate.label,
      assignedLabelType: bestSemanticCandidate.labelType,
      assignedLabelQualityScore: bestSemanticCandidate.qualityScore,
      groupingSource: "ai_semantic_cluster",
      groupingBasis: semanticBasis,
      groupingReason: `${bestSemanticCandidate.candidateType} semantic anchor (${bestSemanticCandidate.key})`,
    };
  }

  if (templateCandidate) {
    return {
      root,
      assignedKey: templateCandidate.key,
      assignedLabel: templateCandidate.label,
      assignedLabelType: templateCandidate.labelType,
      assignedLabelQualityScore: templateCandidate.qualityScore,
      groupingSource: "template_anchor",
      groupingBasis: "template",
      groupingReason: `template anchor selected without stronger semantic evidence (${templateCandidate.key})`,
    };
  }

  if (aiInterpretation) {
    return {
      root,
      assignedKey: `singleton:${root.rootId}`,
      assignedLabel: aiLabel,
      assignedLabelType: "ai_generated",
      assignedLabelQualityScore: root.singletonLabelQualityScore,
      groupingSource: "singleton_ai",
      groupingBasis: "singleton",
      groupingReason: "AI interpretation available but no grouping anchor met quality thresholds",
    };
  }

  return {
    root,
    assignedKey: `singleton:${root.rootId}`,
    assignedLabel: root.singletonLabel,
    assignedLabelType: root.singletonLabelType,
    assignedLabelQualityScore: root.singletonLabelQualityScore,
    groupingSource: "fallback_singleton",
    groupingBasis: "singleton",
    groupingReason: "No AI or semantic grouping anchor was available",
  };
}

function getBlueskyAiLabelQualityScore(
  root: CanonicalBlueskyRoot,
  interpretation: BlueskyAiRootInterpretation,
  label: string,
) {
  return clampScore(
    round1(
      getNarrativeLabelQualityScore(
        label,
        root.groupDocuments,
        "ai",
        interpretation.entities.length > 0 ? 1 : 0,
      ) +
        interpretation.contextualCoherence * 18 -
        interpretation.spamLikelihood * 10 -
        interpretation.templateLikelihood * 6 -
        (interpretation.isLowInformation ? 16 : 0),
    ),
  );
}

function buildBlueskyAuthorTemplateLabel(interpretation: BlueskyAiRootInterpretation) {
  if (
    interpretation.contentType === "greeting_status" ||
    interpretation.trendCategory === "greeting_status"
  ) {
    return "Greeting / status series";
  }

  if (
    interpretation.contentType === "promotion" ||
    interpretation.contentType === "spam" ||
    interpretation.trendCategory === "spam_promo"
  ) {
    return "Promotional template series";
  }

  if (interpretation.contentType === "bot_like") {
    return "Bot-like template series";
  }

  const baseLabel =
    phraseToLabel(interpretation.candidateLabel) ??
    phraseToLabel(interpretation.summaryTopic) ??
    "Template";
  return `${baseLabel} series`;
}

function buildBlueskyAiRootInputs(roots: CanonicalBlueskyRoot[]): BlueskyAiRootInput[] {
  return roots.map((root) => ({
    rootId: root.rootId,
    authorId: root.primaryAuthorId,
    authorHandle: root.primaryAuthorHandle,
    createdAt: root.firstSeenAt,
    lastSeenAt: root.lastSeenAt,
    totalInteractions24h: root.totalInteractions24h,
    rootText: root.rootText,
    evidenceText: root.evidenceText,
    urlLabels: root.urlSignals.map((signal) => signal.label).slice(0, 3),
    entityLabels: root.entitySignals.map((signal) => signal.label).slice(0, 4),
    phraseLabels: root.phraseSignals.map((signal) => signal.label).slice(0, 4),
    hashtagLabels: root.hashtagSignals.map((signal) => signal.label).slice(0, 4),
  }));
}

function applyAiInterpretationsToBlueskyRoots(
  roots: CanonicalBlueskyRoot[],
  interpretations: Map<string, BlueskyAiRootInterpretation> | null,
) {
  return roots.map((root) => {
    const interpretation = interpretations?.get(root.rootId) ?? null;
    if (!interpretation) {
      return root;
    }

    const aiLabel = buildBlueskyAiSingletonLabel(root, interpretation);
    const aiQualityScore = getBlueskyAiLabelQualityScore(root, interpretation, aiLabel);
    const semanticKey = normalizeAiGroupingKey(interpretation.semanticKey ?? aiLabel);
    const secondaryGroupingKeys = dedupeStrings(
      interpretation.secondaryKeys
        .map((key) => normalizeAiGroupingKey(key))
        .filter((key): key is string => Boolean(key)),
    ).filter((key) => key !== semanticKey);
    const aiCandidates: BlueskyRootTopicCandidate[] = [];

    if (semanticKey) {
      aiCandidates.push({
        key: `ai:${semanticKey}`,
        candidateType: "ai_semantic",
        label: aiLabel,
        labelType: "ai_generated",
        qualityScore: aiQualityScore,
        priority: 580,
        support: 1,
      });
    }

    secondaryGroupingKeys.slice(0, 3).forEach((key, index) => {
        aiCandidates.push({
          key: `ai:${key}`,
          candidateType: "ai_semantic",
          label: aiLabel,
          labelType: "ai_generated",
          qualityScore: Math.max(0, aiQualityScore - (index + 1) * 4),
          priority: 520 - index * 12,
          support: 1,
        });
      });

    const templateKey =
      root.primaryAuthorId &&
      (interpretation.isTemplateLike ||
        interpretation.templateLikelihood >= 0.72 ||
        interpretation.spamLikelihood >= 0.72)
        ? normalizeAiGroupingKey(
            `${root.primaryAuthorId} ${interpretation.semanticKey || aiLabel || interpretation.summaryTopic}`,
          )
        : null;

    if (templateKey) {
      aiCandidates.push({
        key: `template:${templateKey}`,
        candidateType: "author_template",
        label: buildBlueskyAuthorTemplateLabel(interpretation),
        labelType: "ai_generated",
        qualityScore: clampScore(aiQualityScore - 8),
        priority: 560,
        support: 1,
      });
    }

    const hasUrlAnchor = root.candidateTopicKeys.some((candidate) => candidate.candidateType === "url");
    const shouldPreferAiSingleton =
      !hasUrlAnchor &&
      !isWeakNarrativeLabel(aiLabel) &&
      !isUrlLikeNarrativeLabel(aiLabel);
    const nextSingletonLabel = shouldPreferAiSingleton ? aiLabel : root.singletonLabel;
    const nextSingletonLabelType = shouldPreferAiSingleton
      ? ("ai_generated" as const)
      : root.singletonLabelType;
    const nextSingletonQualityScore = shouldPreferAiSingleton
      ? aiQualityScore
      : root.singletonLabelQualityScore;
    return {
      ...root,
      aiInterpretation: interpretation,
      primaryAiGroupingKey: semanticKey,
      secondaryAiGroupingKeys: secondaryGroupingKeys,
      singletonLabel: nextSingletonLabel,
      singletonLabelType: nextSingletonLabelType,
      singletonLabelQualityScore: nextSingletonQualityScore,
      candidateTopicKeys: dedupeById(
        [...aiCandidates, ...root.candidateTopicKeys].map((candidate) => ({
          ...candidate,
          id: candidate.key,
        })),
      ).map(({ id: _id, ...candidate }) => candidate),
    } satisfies CanonicalBlueskyRoot;
  });
}

function buildCanonicalBlueskyRoots(
  scoped: ScopedAnalyticsSnapshot,
  rootDocumentsByRoot: Map<string, TrendDocument[]>,
) {
  const rootIds = [
    ...new Set([
      ...scoped.blueskyWindowPostsByRoot.keys(),
      ...scoped.blueskyWindowInteractionsByRoot.keys(),
      ...scoped.blueskyWindowSnapshotsByRoot.keys(),
    ]),
  ];

  return rootIds.map((rootId) => {
    const posts = scoped.blueskyWindowPostsByRoot.get(rootId) ?? [];
    const interactions = scoped.blueskyWindowInteractionsByRoot.get(rootId) ?? [];
    const snapshots = scoped.blueskyWindowSnapshotsByRoot.get(rootId) ?? [];
    const rootDocuments = rootDocumentsByRoot.get(rootId) ?? [];
    const primaryDocument =
      rootDocuments.find((document) => document.documentKind === "primary") ??
      rootDocuments.find((document) => document.documentKind !== "delta") ??
      rootDocuments[0] ??
      null;
    const primaryPost = posts[0] ?? null;
    const primaryInteraction = interactions[0] ?? null;
    const urlSignals = buildBlueskyUrlSignals(rootDocuments);
    const entitySignals = buildBlueskyRootSignalStats(
      rootDocuments,
      rootDocuments.flatMap((document) => extractNamedPhrases(document)),
      "entity_label",
    );
    const phraseSignals = buildBlueskyRootSignalStats(
      rootDocuments,
      [
        ...rootDocuments.flatMap((document) => buildCandidatePhrases(document)),
        ...posts.flatMap((post) => [
          ...(post.topicHints ?? []),
          ...(post.discoveredQueries ?? []),
          ...(post.labels ?? []),
        ]),
      ],
      "repeated_phrase",
    );
    const hashtagSignals = buildBlueskyRootSignalStats(
      rootDocuments,
      rootDocuments.flatMap((document) => extractHashtagsFromText(getNarrativeEvidenceText(document))),
      "hashtag_label",
    );
    const singletonLabel = getBlueskySingletonLabel(
      rootId,
      rootDocuments,
      urlSignals,
      entitySignals,
      phraseSignals,
      hashtagSignals,
    );
    const groupDocuments =
      rootDocuments.length > 0
        ? rootDocuments
        : [
            buildBlueskyRootPlaceholderDocument(
              rootId,
              singletonLabel.label,
              posts,
              interactions,
              snapshots,
            ),
          ];
    const rootText = dedupeStrings(
      [
        primaryDocument?.title ?? null,
        primaryDocument?.body ?? null,
        primaryPost?.title ?? null,
        primaryPost?.summary ?? null,
        ...interactions
          .map((interaction) => interaction.text ?? null)
          .filter((value): value is string => Boolean(value))
          .slice(0, 3),
      ].filter((value): value is string => Boolean(value && value.trim())),
    )
      .join(" | ")
      .slice(0, 420);
    const evidenceText = dedupeStrings(
      groupDocuments
        .map((document) => getNarrativeEvidenceText(document))
        .filter((value): value is string => Boolean(value && value.trim())),
    )
      .join(" | ")
      .slice(0, 680);

    const hybridCandidate =
      entitySignals[0] && phraseSignals[0] && entitySignals[0].key !== phraseSignals[0].key
        ? [
            {
              key: `hybrid:${entitySignals[0].key}__${phraseSignals[0].key}`,
              candidateType: "hybrid" as const,
              label: entitySignals[0].label,
              labelType: "entity_label" as const,
              qualityScore: Math.max(entitySignals[0].qualityScore, phraseSignals[0].qualityScore),
              priority: 460,
              support: Math.min(entitySignals[0].support, phraseSignals[0].support),
            },
          ]
        : [];
    const candidateTopicKeys: BlueskyRootTopicCandidate[] = [
      ...urlSignals.slice(0, 2).map((signal) => ({
        key: `url:${signal.key}`,
        candidateType: "url" as const,
        label: signal.label,
        labelType: "canonical_url_title" as const,
        qualityScore: signal.qualityScore,
        priority: 140,
        support: signal.support,
      })),
      ...hybridCandidate,
      ...entitySignals.slice(0, 3).map((signal) => ({
        key: `entity:${signal.key}`,
        candidateType: "entity" as const,
        label: signal.label,
        labelType: "entity_label" as const,
        qualityScore: signal.qualityScore,
        priority: 360,
        support: signal.support,
      })),
      ...phraseSignals.slice(0, 3).map((signal) => ({
        key: `phrase:${signal.key}`,
        candidateType: "phrase" as const,
        label: signal.label,
        labelType: "repeated_phrase" as const,
        qualityScore: signal.qualityScore,
        priority: 300,
        support: signal.support,
      })),
      ...hashtagSignals.slice(0, 2).map((signal) => ({
        key: `hashtag:${signal.key}`,
        candidateType: "hashtag" as const,
        label: signal.label,
        labelType: "hashtag_label" as const,
        qualityScore: signal.qualityScore,
        priority: 240,
        support: signal.support,
      })),
    ];
    const totalSnapshotDelta24h = snapshots.reduce(
      (sum, snapshot) =>
        sum +
        getRawInteractionCount({
          reposts: Math.max((snapshot.deltaRepostCount ?? 0) + (snapshot.deltaQuoteCount ?? 0), 0),
          comments: Math.max(snapshot.deltaCommentCount ?? 0, 0),
          likes: Math.max(snapshot.deltaLikeCount ?? 0, 0),
        }),
      0,
    );
    const uniqueAuthors24h = new Set(
      [
        ...posts.map((post) => post.authorDid ?? post.authorHandle ?? ""),
        ...interactions.map((interaction) => interaction.actorDid ?? interaction.actorHandle ?? ""),
      ].filter(Boolean),
    ).size;
    const { firstSeenAt, lastSeenAt } = getBlueskyActivityTimestampBounds(posts, interactions, snapshots);

    return {
      rootId,
      groupDocuments,
      posts,
      interactions,
      snapshots,
      totalInteractions24h: interactions.length,
      totalSnapshotDelta24h,
      uniqueAuthors24h,
      firstSeenAt,
      lastSeenAt,
      primaryAuthorId:
        primaryPost?.authorDid ??
        primaryPost?.authorHandle ??
        primaryDocument?.authorId ??
        primaryInteraction?.actorDid ??
        primaryInteraction?.actorHandle ??
        null,
      primaryAuthorHandle:
        primaryPost?.authorHandle ??
        primaryDocument?.authorHandle ??
        primaryInteraction?.actorHandle ??
        null,
      rootText,
      evidenceText: evidenceText || rootText || singletonLabel.label,
      urlSignals,
      entitySignals,
      phraseSignals,
      hashtagSignals,
      singletonLabel: singletonLabel.label,
      singletonLabelType: singletonLabel.labelType,
      singletonLabelQualityScore: singletonLabel.qualityScore,
      candidateTopicKeys,
    } satisfies CanonicalBlueskyRoot;
  });
}

function buildBlueskyTrendAttentionHistory(
  posts: BlueskyNormalizedPost[],
  interactions: BlueskyInteraction[],
  range: DateRangePreset,
  referenceTime: Date,
) {
  const interactionHistory = bucketSeries(interactions, range, referenceTime, () => 1);
  if (interactionHistory.some((point) => point.value > 0)) {
    return interactionHistory;
  }

  return bucketSeries(posts, range, referenceTime, () => 1);
}

function getBlueskyAiGroupingRunMode(
  bundleOrigin?: DashboardRuntimeBundleOrigin,
): BlueskyAiGroupingRunMode {
  return bundleOrigin === "manual_full_regroup" ? "manual_full_regroup" : "incremental_live";
}

function findUnionParent(parent: Map<string, string>, key: string): string {
  const existing = parent.get(key);
  if (!existing || existing === key) {
    parent.set(key, key);
    return key;
  }

  const resolved = findUnionParent(parent, existing);
  if (resolved !== existing) {
    parent.set(key, resolved);
  }
  return resolved;
}

function unionParents(parent: Map<string, string>, left: string, right: string) {
  const leftParent = findUnionParent(parent, left);
  const rightParent = findUnionParent(parent, right);
  if (leftParent === rightParent) {
    return;
  }

  if (leftParent.localeCompare(rightParent) <= 0) {
    parent.set(rightParent, leftParent);
    return;
  }

  parent.set(leftParent, rightParent);
}

function resolveAiGroupingCanonicalKeys(roots: CanonicalBlueskyRoot[]) {
  const parent = new Map<string, string>();
  const primaryWeights = new Map<string, number>();

  roots.forEach((root) => {
    const primaryKey = root.primaryAiGroupingKey;
    if (!primaryKey) {
      return;
    }

    findUnionParent(parent, primaryKey);
    primaryWeights.set(primaryKey, (primaryWeights.get(primaryKey) ?? 0) + root.totalInteractions24h + 1);

    (root.secondaryAiGroupingKeys ?? []).forEach((secondaryKey) => {
      findUnionParent(parent, secondaryKey);
      unionParents(parent, primaryKey, secondaryKey);
    });
  });

  const keysByComponent = new Map<string, string[]>();
  [...parent.keys()].forEach((key) => {
    const component = findUnionParent(parent, key);
    const existing = keysByComponent.get(component);
    if (existing) {
      existing.push(key);
      return;
    }

    keysByComponent.set(component, [key]);
  });

  const canonicalKeyByPrimary = new Map<string, string>();
  keysByComponent.forEach((keys) => {
    const canonical = [...keys].sort((left, right) => {
      const leftWeight = primaryWeights.get(left) ?? 0;
      const rightWeight = primaryWeights.get(right) ?? 0;
      if (rightWeight !== leftWeight) {
        return rightWeight - leftWeight;
      }

      return left.localeCompare(right);
    })[0];

    keys.forEach((key) => {
      canonicalKeyByPrimary.set(key, canonical);
    });
  });

  return canonicalKeyByPrimary;
}

function getBlueskyLeaderboardTier(params: {
  rootCount: number;
  lowInformation: boolean;
  templateSeries: boolean;
  spamLikelihood: number;
  fallbackGenerated: boolean;
  lowQualityLabel: boolean;
  groupingSource: TrendGroupingSource;
  totalInteractions24h: number;
  qualityAdjustedScore: number;
  uniqueAuthors24h: number;
  singleAuthorShare: number;
}) {
  if (params.lowInformation) {
    return "audit_low_information" as const;
  }

  if (params.templateSeries || params.spamLikelihood >= 0.72) {
    return "audit_template" as const;
  }

  if (params.fallbackGenerated || params.lowQualityLabel) {
    return "audit_fallback" as const;
  }

  const weakGroupedEvidence =
    params.rootCount > 1 &&
    params.rootCount <= 2 &&
    params.uniqueAuthors24h <= 2 &&
    params.singleAuthorShare >= 0.5 &&
    (params.totalInteractions24h < 6 || params.qualityAdjustedScore < 6);
  if (weakGroupedEvidence) {
    return "audit_low_information" as const;
  }

  if (params.rootCount <= 1) {
    if (params.groupingSource === "canonical_url_anchor") {
      return "audit_low_information" as const;
    }

    return "secondary_singleton" as const;
  }

  return "primary_grouped" as const;
}

async function buildExhaustiveBlueskyTrendGroups(
  scoped: ScopedAnalyticsSnapshot,
  query: TrendDashboardQuery,
  referenceTime: Date,
  options: AnalyticsBuildOptions = {},
): Promise<{
  groups: ExhaustiveBlueskyTrendGroup[];
  aiDiagnostics: BlueskyAiGroupingDiagnostics;
}> {
  const blueskyDocuments = buildTrendDocuments(
    [],
    [],
    [],
    scoped.windowBlueskyPosts,
    scoped.windowBlueskyInteractions,
    scoped.windowBlueskyPostSnapshots,
    scoped.scopedBlueskyProfiles,
    [],
    [],
  ).filter((document) => document.platformId === "bluesky");

  const documentsByRoot = new Map<string, TrendDocument[]>();
  blueskyDocuments.forEach((document) => {
    const rootId = document.rootDocumentId ?? document.id;
    const existing = documentsByRoot.get(rootId);
    if (existing) {
      existing.push(document);
      return;
    }
    documentsByRoot.set(rootId, [document]);
  });

  const roots = buildCanonicalBlueskyRoots(scoped, documentsByRoot);
  let aiInterpretations: Map<string, BlueskyAiRootInterpretation> | null = null;
  const groupingRunMode = getBlueskyAiGroupingRunMode(options.bundleOrigin);
  const shouldAttemptAiGrouping =
    groupingRunMode === "manual_full_regroup" ||
    isAiBlueskyGroupingEnabled() ||
    Boolean(process.env.OPENAI_API_KEY);
  let aiDiagnostics: BlueskyAiGroupingDiagnostics = {
    mode: groupingRunMode,
    requestedRootCount: roots.length,
    eligibleRootCount: roots.length,
    processedRootCount: 0,
    processedFreshRootCount: 0,
    cacheHitCount: 0,
    freshCallCount: 0,
    batchCount: 0,
    batchFailureCount: 0,
    failedRootCount: roots.length,
    attempted: false,
    clientInitialized: false,
    incomplete: roots.length > 0,
    incompleteReason: "AI grouping was not attempted",
    model: null,
    credentialSource: process.env.OPENAI_API_KEY ? "process.env.OPENAI_API_KEY" : null,
    credentialFingerprint: null,
    ignoreCache: false,
    requestTimeoutMs: 0,
    totalBudgetMs: null,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    lastSuccessfulFullRegroupAt: null,
  };

  if (shouldAttemptAiGrouping) {
    try {
      const aiModule = (await import("@/lib/bluesky/ai-trend-assignment")) as {
        interpretBlueskyRootsDetailed?: (
          roots: BlueskyAiRootInput[],
          options?: BlueskyAiGroupingOptions,
        ) => Promise<{
          interpretations: Map<string, BlueskyAiRootInterpretation>;
          diagnostics: BlueskyAiGroupingDiagnostics;
        }>;
        interpretBlueskyRoots?: (
          roots: BlueskyAiRootInput[],
          options?: BlueskyAiGroupingOptions,
        ) => Promise<Map<string, BlueskyAiRootInterpretation> | null>;
      };
      if (typeof aiModule.interpretBlueskyRootsDetailed === "function") {
        const result = await aiModule.interpretBlueskyRootsDetailed(buildBlueskyAiRootInputs(roots), {
          mode: groupingRunMode,
          requireFullCoverage: groupingRunMode === "manual_full_regroup",
        });
        aiInterpretations = result.interpretations;
        aiDiagnostics = result.diagnostics;
      } else if (typeof aiModule.interpretBlueskyRoots === "function") {
        aiInterpretations = await aiModule.interpretBlueskyRoots(buildBlueskyAiRootInputs(roots), {
          mode: groupingRunMode,
        });
        aiDiagnostics = {
          ...aiDiagnostics,
          attempted: true,
          clientInitialized: Boolean(process.env.OPENAI_API_KEY),
          processedRootCount: aiInterpretations?.size ?? 0,
          processedFreshRootCount: aiInterpretations?.size ?? 0,
          freshCallCount: aiInterpretations ? 1 : 0,
          batchCount: aiInterpretations ? 1 : 0,
          failedRootCount: Math.max(0, roots.length - (aiInterpretations?.size ?? 0)),
          incomplete: (aiInterpretations?.size ?? 0) < roots.length,
          incompleteReason:
            (aiInterpretations?.size ?? 0) < roots.length
              ? "AI grouping did not cover every eligible root"
              : null,
          completedAt: new Date().toISOString(),
        };
      } else {
        throw new Error("Bluesky AI grouping module does not export an interpreter");
      }
    } catch (error) {
      aiDiagnostics = {
        ...aiDiagnostics,
        attempted: true,
        incomplete: true,
        incompleteReason: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      };
      if (ANALYTICS_DEBUG) {
        console.warn("[analytics] Bluesky AI grouping failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } else if (ANALYTICS_DEBUG) {
    console.info("[analytics] Bluesky AI grouping skipped", {
      enabled: shouldAttemptAiGrouping,
      hasApiKey: Boolean(process.env.OPENAI_API_KEY),
      rootCount: roots.length,
    });
  }

  if (groupingRunMode === "manual_full_regroup" && aiDiagnostics.incomplete) {
    throw new Error(
      `[analytics] manual full regroup failed because AI coverage is incomplete: ${
        aiDiagnostics.incompleteReason ?? "unknown reason"
      }`,
    );
  }

  const interpretedRoots = applyAiInterpretationsToBlueskyRoots(roots, aiInterpretations);
  const canonicalAiKeys = resolveAiGroupingCanonicalKeys(interpretedRoots);
  const urlAnchorRootCounts = getBlueskyUrlAnchorRootCounts(interpretedRoots);
  const allowUniqueUrlAnchors = (aiDiagnostics.processedRootCount ?? 0) > 0;

  const rootAssignments = interpretedRoots.map((root) =>
    selectBlueskyRootAssignment(root, canonicalAiKeys, {
      urlAnchorRootCounts,
      allowUniqueUrlAnchors,
    }),
  );
  const groupsByKey = new Map<typeof rootAssignments[number]["assignedKey"], typeof rootAssignments>();
  rootAssignments.forEach((assignment) => {
    const existing = groupsByKey.get(assignment.assignedKey);
    if (existing) {
      existing.push(assignment);
      return;
    }

    groupsByKey.set(assignment.assignedKey, [assignment]);
  });

  const preliminaryGroups = [...groupsByKey.entries()].map(([assignedKey, assignments]) => {
    const documents = dedupeById(assignments.flatMap((assignment) => assignment.root.groupDocuments));
    const posts = dedupeById(assignments.flatMap((assignment) => assignment.root.posts));
    const interactions = dedupeById(assignments.flatMap((assignment) => assignment.root.interactions));
    const snapshots = dedupeById(assignments.flatMap((assignment) => assignment.root.snapshots));
    const groupingSource = assignments[0]?.groupingSource ?? "fallback_singleton";
    const effectiveGroupingSource =
      assignments.length === 1
        ? groupingSource === "ai_semantic_cluster"
          ? assignments.some((assignment) => Boolean(assignment.root.aiInterpretation))
            ? ("singleton_ai" as const)
            : ("fallback_singleton" as const)
          : groupingSource
        : groupingSource;
    const labelVotes = assignments.reduce((map, assignment) => {
      const weight = Math.max(1, assignment.root.totalInteractions24h);
      map.set(assignment.assignedLabel, (map.get(assignment.assignedLabel) ?? 0) + weight);
      return map;
    }, new Map<string, number>());
    const topAssignment = [...assignments].sort(
      (left, right) =>
        right.assignedLabelQualityScore - left.assignedLabelQualityScore ||
        right.root.totalInteractions24h - left.root.totalInteractions24h,
    )[0];
    const votedAssignmentLabel =
      [...labelVotes.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
      topAssignment?.assignedLabel ??
      `Bluesky topic ${getBlueskyRootShortId(assignedKey)}`;
    const aiLabels = assignments
      .map((assignment) => assignment.root.aiInterpretation)
      .filter((value): value is BlueskyAiRootInterpretation => Boolean(value))
      .map((interpretation) => ({
        label:
          phraseToLabel(interpretation.candidateLabel) ??
          phraseToLabel(interpretation.summaryTopic) ??
          interpretation.candidateLabel,
        weight:
          1 +
          clampScore(interpretation.contextualCoherence * 100) / 20 +
          (interpretation.isLowInformation ? -0.5 : 0),
        interpretation,
      }))
      .filter((entry) => Boolean(entry.label));
    const aiLabelWinner =
      aiLabels.length > 0
        ? [...aiLabels.reduce((map, entry) => {
            map.set(entry.label, (map.get(entry.label) ?? 0) + entry.weight);
            return map;
          }, new Map<string, number>()).entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
        : null;
    const aiWeighted = assignments.reduce(
      (acc, assignment) => {
        const interpretation = assignment.root.aiInterpretation;
        const weight = Math.max(1, assignment.root.totalInteractions24h);
        if (!interpretation) {
          return acc;
        }

        acc.weight += weight;
        acc.spam += interpretation.spamLikelihood * weight;
        acc.template += interpretation.templateLikelihood * weight;
        acc.coherence += interpretation.contextualCoherence * weight;
        acc.lowInformationCount += interpretation.isLowInformation ? weight : 0;
        acc.categoryVotes.set(
          interpretation.trendCategory,
          (acc.categoryVotes.get(interpretation.trendCategory) ?? 0) + weight,
        );
        acc.contentVotes.set(
          interpretation.contentType,
          (acc.contentVotes.get(interpretation.contentType) ?? 0) + weight,
        );
        acc.descriptionVotes.set(
          interpretation.shortDescription,
          (acc.descriptionVotes.get(interpretation.shortDescription) ?? 0) + weight,
        );
        return acc;
      },
      {
        weight: 0,
        spam: 0,
        template: 0,
        coherence: 0,
        lowInformationCount: 0,
        categoryVotes: new Map<string, number>(),
        contentVotes: new Map<string, number>(),
        descriptionVotes: new Map<string, number>(),
      },
    );
    const spamLikelihood = aiWeighted.weight > 0 ? aiWeighted.spam / aiWeighted.weight : 0;
    const templateLikelihood = aiWeighted.weight > 0 ? aiWeighted.template / aiWeighted.weight : 0;
    const contextualCoherence = aiWeighted.weight > 0 ? aiWeighted.coherence / aiWeighted.weight : 0;
    const lowInformation = aiWeighted.weight > 0 && aiWeighted.lowInformationCount / aiWeighted.weight >= 0.5;
    const nextLabelType =
      effectiveGroupingSource === "canonical_url_anchor"
        ? (topAssignment?.assignedLabelType ?? "canonical_url_title")
        : aiLabelWinner
          ? ("ai_generated" as const)
          : (topAssignment?.assignedLabelType ?? "fallback_generated");
    const resolvedLabel =
      effectiveGroupingSource === "canonical_url_anchor"
        ? votedAssignmentLabel
        : effectiveGroupingSource === "template_anchor"
          ? (topAssignment?.assignedLabel ?? aiLabelWinner ?? votedAssignmentLabel)
          : (aiLabelWinner ?? votedAssignmentLabel);
    const labelQualityScore =
      nextLabelType === "ai_generated"
        ? Math.max(
            topAssignment?.assignedLabelQualityScore ?? 0,
            clampScore(58 + contextualCoherence * 26 - spamLikelihood * 10 - templateLikelihood * 6),
          )
        : (topAssignment?.assignedLabelQualityScore ?? 0);
    const aliases = dedupeStrings(
      assignments.flatMap((assignment) => [
        assignment.assignedLabel,
        assignment.root.singletonLabel,
        ...assignment.root.entitySignals.map((signal) => signal.label),
        ...assignment.root.phraseSignals.map((signal) => signal.label),
        ...assignment.root.hashtagSignals.map((signal) => signal.label),
      ]),
    ).filter((alias) => alias.toLowerCase() !== resolvedLabel.toLowerCase());
    const group = createTopicGroup(
      assignedKey,
      resolvedLabel,
      documents,
      [],
      undefined,
      aliases,
      resolvedLabel,
      {
        labelSource: getBlueskyLabelSource(nextLabelType),
        labelQualityScore,
        namedPhraseSupport: nextLabelType === "entity_label" ? 1 : 0,
      },
    );
    const timestamps = assignments
      .flatMap((assignment) => [assignment.root.firstSeenAt, assignment.root.lastSeenAt])
      .filter((value): value is string => Boolean(value))
      .map((value) => Date.parse(value))
      .filter((value) => Number.isFinite(value));
    const authorWeights = assignments.reduce((map, assignment) => {
      const key =
        assignment.root.primaryAuthorId ?? assignment.root.primaryAuthorHandle ?? assignment.root.rootId;
      map.set(key, (map.get(key) ?? 0) + assignment.root.totalInteractions24h + 1);
      return map;
    }, new Map<string, number>());
    const dominantAuthorWeight = [...authorWeights.values()].sort((left, right) => right - left)[0] ?? 0;
    const authorWeightTotal = [...authorWeights.values()].reduce((sum, value) => sum + value, 0);
    const singleAuthorShare = authorWeightTotal > 0 ? dominantAuthorWeight / authorWeightTotal : 0;
    const totalInteractions24h = assignments.reduce(
      (sum, assignment) => sum + assignment.root.totalInteractions24h,
      0,
    );
    const uniqueAuthors24h = new Set(
      assignments
        .flatMap((assignment) => [
          ...assignment.root.posts.map((post) => post.authorDid ?? post.authorHandle ?? ""),
          ...assignment.root.interactions.map(
            (interaction) => interaction.actorDid ?? interaction.actorHandle ?? "",
          ),
        ])
        .filter(Boolean),
    ).size;
    const rankingProfile = buildExhaustiveBlueskyGroupRankingProfile({
      label: group.label,
      labelQualityScore,
      labelType: nextLabelType,
      groupingSource: effectiveGroupingSource,
      rootCount: assignments.length,
      lowInformation,
      spamLikelihood,
      templateLikelihood,
      contextualCoherence,
      totalInteractions24h,
      uniqueAuthors24h,
      singleAuthorShare,
    });

    return {
      group,
      rootIds: assignments.map((assignment) => assignment.root.rootId),
      posts,
      interactions,
      snapshots,
      groupingSource: effectiveGroupingSource,
      leaderboardTier: rankingProfile.leaderboardTier,
      labelType: nextLabelType,
      canonicalKeySummary: assignedKey.replace(/^(url|ai|template|singleton):/, ""),
      fallbackGenerated: rankingProfile.fallbackGenerated,
      lowQualityLabel: rankingProfile.lowQualityLabel,
      totalInteractions24h,
      totalSnapshotDelta24h: assignments.reduce(
        (sum, assignment) => sum + assignment.root.totalSnapshotDelta24h,
        0,
      ),
      uniqueAuthors24h,
      firstSeenAt: timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null,
      lastSeenAt: timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null,
      aiAssisted: assignments.some((assignment) => Boolean(assignment.root.aiInterpretation)),
      aiLabel: aiLabelWinner,
      trendDescription:
        [...aiWeighted.descriptionVotes.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
        null,
      qualityAdjustedScore: rankingProfile.qualityAdjustedScore,
      singleAuthorShare,
      trendCategory:
        [...aiWeighted.categoryVotes.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
        null,
      contentType:
        [...aiWeighted.contentVotes.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
        null,
      spamLikelihood: round1(spamLikelihood * 100) / 100,
      templateLikelihood: round1(templateLikelihood * 100) / 100,
      contextualCoherence: round1(contextualCoherence * 100) / 100,
      lowInformation,
      templateSeries: rankingProfile.templateSeries,
    };
  });

  const resolvedNarratives = await resolveExhaustiveBlueskyNarrativesWithAi(
    preliminaryGroups,
    referenceTime,
  );
  const groups = mergeExhaustiveBlueskyGroupsWithAi(preliminaryGroups, resolvedNarratives);
  const groupedRootsCount = groups
    .filter((group) => group.rootIds.length > 1)
    .reduce((sum, group) => sum + group.rootIds.length, 0);
  const singletonRootsCount = groups
    .filter((group) => group.rootIds.length === 1)
    .reduce((sum, group) => sum + group.rootIds.length, 0);
  const groupedTrendCount = groups.filter((group) => group.rootIds.length > 1).length;
  const singletonTrendCount = groups.filter((group) => group.rootIds.length === 1).length;
  const urlAnchorGroupCount = groups.filter(
    (group) => group.groupingSource === "canonical_url_anchor",
  ).length;
  const aiClusterGroupCount = groups.filter(
    (group) => group.groupingSource === "ai_semantic_cluster",
  ).length;
  const templateSeriesCount = groups.filter((group) => group.templateSeries).length;
  const lowInformationTrendCount = groups.filter((group) => group.lowInformation).length;
  const fallbackLabelCount = groups.filter((group) => group.fallbackGenerated).length;
  const lowQualityLabelCount = groups.filter((group) => group.lowQualityLabel).length;
  const aiLabeledCount = groups.filter((group) => group.aiAssisted && group.labelType === "ai_generated").length;
  const assignedRootsCount = groups.reduce((sum, group) => sum + group.rootIds.length, 0);
  const assignmentSourceCounts = rootAssignments.reduce(
    (counts, assignment) => {
      counts[assignment.groupingSource] += 1;
      counts[assignment.groupingBasis] += 1;
      return counts;
    },
    {
      canonical_url_anchor: 0,
      ai_semantic_cluster: 0,
      template_anchor: 0,
      singleton_ai: 0,
      fallback_singleton: 0,
      ai: 0,
      heuristic: 0,
      template: 0,
      url: 0,
      singleton: 0,
    } as Record<string, number>,
  );
  const topAssignmentReasons = rootAssignments.slice(0, 10).map((assignment) => ({
    rootId: assignment.root.rootId,
    groupingSource: assignment.groupingSource,
    groupingBasis: assignment.groupingBasis,
    reason: assignment.groupingReason,
    rootCount: assignment.root.groupDocuments.length,
    singletonLabel: assignment.root.singletonLabel,
    aiInterpreted: Boolean(assignment.root.aiInterpretation),
  }));

  if (ANALYTICS_DEBUG) {
    console.info("[analytics] bluesky grouping assignment summary", {
      rootCount: roots.length,
      assignmentSourceCounts,
      groupedRootsCount,
      singletonRootsCount,
      urlAnchorGroupCount,
      aiClusterGroupCount,
      templateSeriesCount,
      lowInformationTrendCount,
      fallbackLabelCount,
      lowQualityLabelCount,
      aiLabeledCount,
      aiAttempted: aiDiagnostics.attempted,
      aiProcessedRootCount: aiDiagnostics.processedRootCount,
      aiProcessedFreshRootCount: aiDiagnostics.processedFreshRootCount,
      aiCacheHitCount: aiDiagnostics.cacheHitCount,
      aiFreshCallCount: aiDiagnostics.freshCallCount,
      aiBatchCount: aiDiagnostics.batchCount,
      aiBatchFailureCount: aiDiagnostics.batchFailureCount,
      aiIncomplete: aiDiagnostics.incomplete,
      aiIncompleteReason: aiDiagnostics.incompleteReason,
      resolvedNarrativeCount: resolvedNarratives?.narratives.length ?? 0,
      ignoredCandidateCount: resolvedNarratives?.ignoredCandidateIds.length ?? 0,
      topAssignmentReasons,
    });
  }

  return {
    groups,
    aiDiagnostics,
  };
}

async function buildExhaustiveBlueskyTrendSeeds(
  scoped: ScopedAnalyticsSnapshot,
  query: TrendDashboardQuery,
  referenceTime: Date,
  sourceHealth?: Record<string, RedditSourceHealth>,
  overallHealth?: RedditIngestionHealth,
  options: AnalyticsBuildOptions = {},
): Promise<ExhaustiveBlueskySeedBuild> {
  const { groups: allGroups, aiDiagnostics } = await buildExhaustiveBlueskyTrendGroups(
    scoped,
    query,
    referenceTime,
    options,
  );
  const groups = allGroups.filter((group) =>
    scopeMatchesPosts(group.group.documents, query.scope),
  );
  const seeds = groups.map((group) => {
    const supportingThreadCount = group.rootIds.length;
    const attentionHistory = buildBlueskyTrendAttentionHistory(
      group.posts,
      group.interactions,
      query.range,
      referenceTime,
    );
    const narrativeHistory = bucketSeries(
      group.group.documents.filter((document) => document.documentKind !== "delta"),
      query.range,
      referenceTime,
      () => 1,
    );
    const totalInteractionScore = group.totalInteractions24h;
    const totalNarrativeScore = Math.max(
      group.rootIds.length,
      group.group.documents.filter((document) => document.documentKind !== "delta").length,
    );
    const currentWindowInteractionScore = currentWindowTotal(attentionHistory);
    const priorWindowInteractionScore = previousWindowTotal(attentionHistory);
    const currentWindowNarrativeScore = currentWindowTotal(narrativeHistory);
    const priorWindowNarrativeScore = previousWindowTotal(narrativeHistory);
    const growthRate = attentionHistory.some((point) => point.value > 0)
      ? getGrowthRateFromHistory(attentionHistory)
      : 0;
    const attentionAcceleration = attentionHistory.some((point) => point.value > 0)
      ? getAttentionAcceleration(attentionHistory)
      : 0;
    const persistenceScore = attentionHistory.some((point) => point.value > 0)
      ? getPersistenceScore(attentionHistory)
      : 0;
    const lifecycleStage = attentionHistory.some((point) => point.value > 0)
      ? getTrendLifecycleStage(attentionHistory, growthRate, attentionAcceleration)
      : "Unknown";
    const spikeSignal = attentionHistory.some((point) => point.value > 0)
      ? getSpikeSignal(attentionHistory)
      : { hasSpike: false, spikeMagnitude: 0 };
    const platformBreakdown = buildPlatformBreakdown(group.group);
    const platforms = [...new Set(group.group.documents.map((document) => document.platformId))];
    const platformMigrationPath = buildPlatformMigrationPath(group.group);
    const sourceLabels = [...new Set(group.group.documents.map((document) => document.sourceLabel))];
    const uniqueAuthorCount = Math.max(
      group.uniqueAuthors24h,
      countUniqueDocumentAuthors(group.group.documents),
    );
    const sourceCount = Math.max(1, supportingThreadCount);
    const concentrationRisk =
      totalInteractionScore > 0
        ? Math.max(
            ...group.rootIds.map(
              (rootId) => scoped.blueskyWindowInteractionCountByRoot.get(rootId) ?? 0,
            ),
            0,
          ) / Math.max(totalInteractionScore, 1)
        : getTopRootConcentrationRatio(group.group.documents, "bluesky");
    const freshness = buildTrendFreshness(
      group.group.documents,
      referenceTime,
      sourceHealth,
      overallHealth,
    );
    const rawConfidenceScore = buildConfidenceScore({
      commentCount: totalInteractionScore,
      threadCount: supportingThreadCount,
      subredditCount: sourceCount,
      currentWindowComments: currentWindowInteractionScore,
      uniqueAuthorCount,
      rootDocumentCount: supportingThreadCount,
      concentrationRisk,
    });
    const confidenceScore = getFreshnessAdjustedConfidence(rawConfidenceScore, freshness);
    const interactionLiftScore = getEmergingRatioScore(
      currentWindowInteractionScore,
      priorWindowInteractionScore,
    );
    const narrativeLiftScore = getEmergingRatioScore(
      currentWindowNarrativeScore,
      priorWindowNarrativeScore,
    );
    const engagementIntensityScore = clampScore(
      Math.min(56, Math.max(totalInteractionScore / Math.max(supportingThreadCount, 1), 0) * 3) +
        Math.min(24, Math.log10(currentWindowInteractionScore + 1) * 16),
    );
    const velocityScore = round1(
      clampScore(
        normalizeEmergingMomentum(growthRate, 1.9) * 0.26 +
          normalizeEmergingMomentum(attentionAcceleration, 8.4) * 0.28 +
          interactionLiftScore * 0.24 +
          narrativeLiftScore * 0.14 +
          engagementIntensityScore * 0.12 +
          (spikeSignal.hasSpike ? 6 : 0),
      ),
    );
    const firstSeenMinutes = group.firstSeenAt
      ? Math.max(
          1,
          Math.round(
            (referenceTime.getTime() - Date.parse(group.firstSeenAt)) / 60_000,
          ),
        )
      : RANGE_MS[query.range] / 60_000;
    const recencyScore =
      firstSeenMinutes <= 60
        ? 100
        : firstSeenMinutes <= 360
          ? 88
          : firstSeenMinutes <= 720
            ? 72
            : firstSeenMinutes <= 1_440
              ? 54
              : firstSeenMinutes <= 2_880
                ? 34
                : 16;
    const lowBaseBonus =
      priorWindowInteractionScore <= currentWindowInteractionScore
        ? Math.max(0, 30 - Math.min(30, priorWindowInteractionScore * 2.2))
        : 0;
    const nicheConcentrationBonus =
      concentrationRisk <= 0.55 ? 14 : concentrationRisk <= 0.72 ? 8 : 0;
    const repeatedNarrativePenalty =
      concentrationRisk > 0.88 ? 18 : concentrationRisk > 0.76 ? 10 : 0;
    const noveltyScore = round1(
      clampScore(
        recencyScore * 0.56 +
          interactionLiftScore * 0.18 +
          lowBaseBonus +
          nicheConcentrationBonus -
          repeatedNarrativePenalty,
      ),
    );
    const confirmationScore = round1(
      clampScore(
        14 +
          Math.min(30, freshness.confirmedPlatformSpread * 16) +
          Math.min(24, sourceCount * 6) +
          Math.min(20, Math.log2(uniqueAuthorCount + 1) * 7) +
          Math.min(14, supportingThreadCount * 4) -
          (freshness.state === "mixed" ? 6 : freshness.state === "stale" ? 16 : 0),
      ),
    );
    const breakoutScore = getEmergingBreakoutScore({
      velocityScore,
      noveltyScore,
      confirmationScore,
      freshnessScore: freshness.score,
      confidenceScore,
      growthRate,
      attentionAcceleration,
      mainstreamPenalty: 0,
      spamPenalty:
        (group.group.labelQualityScore < 42 ? 10 : group.group.labelQualityScore < 50 ? 4 : 0) +
        repeatedNarrativePenalty,
      spikeBonus: spikeSignal.hasSpike ? 4 : 0,
    });
    const blueskyInsights = buildBlueskyTrendInsights(
      group.group.documents,
      platformBreakdown,
      scoped.blueskyWindowPostsByRoot,
      scoped.blueskyWindowInteractionsByRoot,
      scoped.blueskyWindowSnapshotsByRoot,
      scoped.blueskyProfileByDid,
      referenceTime,
    );
    const lowDataWarning =
      totalInteractionScore < LOW_DATA_COMMENT_THRESHOLD ||
      confidenceScore < 34;
    const trend: RankedTrend = {
      id: `trend-${group.group.key.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase()}`,
      rank: 0,
      name: group.group.label,
      displayName: group.group.label,
      nameStatus: "ready",
      nameSource: "ai_exact",
      scope: group.group.isMeme ? "memes" : "overall",
      source: "bluesky",
      labelType: group.labelType,
      groupingSource: group.groupingSource,
      leaderboardTier: group.leaderboardTier,
      canonicalKeySummary: group.canonicalKeySummary,
      labelQualityScore: group.group.labelQualityScore,
      lowQualityLabel: group.lowQualityLabel,
      aiAssisted: group.aiAssisted,
      leaderboardMode: "established",
      attentionScore: 0,
      emergingScore: breakoutScore,
      breakoutScore,
      velocityScore,
      noveltyScore,
      confirmationScore,
      totalInteractions24h: totalInteractionScore,
      qualityAdjustedScore: group.qualityAdjustedScore,
      attentionInteractions: totalInteractionScore,
      rootsCount24h: group.rootIds.length,
      uniqueAuthors24h: uniqueAuthorCount,
      singleAuthorShare: round1(group.singleAuthorShare * 100) / 100,
      firstSeenAt: group.firstSeenAt,
      lastSeenAt: group.lastSeenAt,
      isSingleton: group.rootIds.length === 1,
      trendDescription: group.trendDescription,
      trendCategory: group.trendCategory,
      contentType: group.contentType,
      spamLikelihood: round1(group.spamLikelihood * 100) / 100,
      templateLikelihood: round1(group.templateLikelihood * 100) / 100,
      contextualCoherence: round1(group.contextualCoherence * 100) / 100,
      lowInformation: group.lowInformation,
      templateSeries: group.templateSeries,
      confidenceScore,
      freshnessScore: freshness.score,
      freshnessState: freshness.state,
      sampleSize: totalInteractionScore,
      supportingThreadCount,
      lowDataWarning,
      growthRate: round1(growthRate),
      attentionAcceleration: round1(attentionAcceleration),
      mentions: totalNarrativeScore,
      platforms,
      platformSpread: platforms.length,
      confirmedPlatformSpread: freshness.confirmedPlatformSpread,
      attentionHistory,
      platformBreakdown,
      topPosts: buildTopPosts(group.group.documents, referenceTime),
      lifecycleStage,
      originPlatform:
        platformBreakdown[0]?.platformId ?? platformMigrationPath[0] ?? ("bluesky" as const),
      platformMigrationPath,
      attentionDrivers: platformBreakdown.slice(0, 3).map((item) => ({
        platformId: item.platformId,
        contributionPct: item.sharePct,
        deltaPct: round1(attentionAcceleration),
      })),
      hasSpike: spikeSignal.hasSpike,
      spikeMagnitude: spikeSignal.hasSpike ? spikeSignal.spikeMagnitude : undefined,
      clusterId: group.group.themeId,
      clusterName:
        sourceLabels.length > 1
          ? `${group.group.themeLabel} | ${sourceLabels.slice(0, 2).join(", ")}${sourceLabels.length > 2 ? " +" : ""}`
          : `${group.group.themeLabel} | ${sourceLabels[0] ?? "Bluesky"}`,
      trendStrengthScore: 0,
      persistenceScore: round1(persistenceScore),
      isEarlyTrend: false,
      positionChange24h: 0,
      googleSearchInterest: buildGoogleSearchInterest(group.group.documents),
      blueskySummary: blueskyInsights?.summary ?? null,
      blueskyDetail: blueskyInsights?.detail ?? null,
    };

    return {
      trend,
      totalInteractionScore,
      currentWindowInteractionScore,
      priorWindowInteractionScore,
      totalNarrativeScore,
      currentWindowNarrativeScore,
      priorWindowNarrativeScore,
    } satisfies RankedTrendSeed;
  });

  const totalInteractionsInWindow = scoped.windowBlueskyInteractions.length;
  const totalInteractionsAssignedToTrends = seeds.reduce(
    (sum, seed) => sum + seed.trend.attentionInteractions,
    0,
  );
  const totalRootsInWindow = new Set([
    ...scoped.blueskyWindowPostsByRoot.keys(),
    ...scoped.blueskyWindowInteractionsByRoot.keys(),
    ...scoped.blueskyWindowSnapshotsByRoot.keys(),
  ]).size;
  const latestInteractionAt =
    scoped.windowBlueskyInteractions
      .map((interaction) => interaction.createdUtc)
      .sort((left, right) => right - left)
      .at(0) ?? null;
  const groupedRootsCount = groups
    .filter((group) => group.rootIds.length > 1)
    .reduce((sum, group) => sum + group.rootIds.length, 0);
  const singletonRootsCount = groups
    .filter((group) => group.rootIds.length === 1)
    .reduce((sum, group) => sum + group.rootIds.length, 0);
  const groupedTrendCount = groups.filter((group) => group.rootIds.length > 1).length;
  const singletonTrendCount = groups.filter((group) => group.rootIds.length === 1).length;
  const urlAnchorGroupCount = groups.filter(
    (group) => group.groupingSource === "canonical_url_anchor",
  ).length;
  const aiClusterGroupCount = groups.filter(
    (group) => group.groupingSource === "ai_semantic_cluster",
  ).length;
  const templateSeriesCount = groups.filter((group) => group.templateSeries).length;
  const lowInformationTrendCount = groups.filter((group) => group.lowInformation).length;
  const fallbackLabelCount = groups.filter((group) => group.fallbackGenerated).length;
  const lowQualityLabelCount = groups.filter((group) => group.lowQualityLabel).length;
  const aiLabeledCount = groups.filter((group) => group.aiAssisted && group.labelType === "ai_generated").length;
  const assignedRootsCount = groups.reduce((sum, group) => sum + group.rootIds.length, 0);
  return {
    seeds,
    coverage: {
      source: "bluesky",
      rankingSource: "ai_grouped_clusters",
      windowHours: round1(RANGE_MS[query.range] / (60 * 60 * 1000)),
      totalInteractionsInWindow,
      totalInteractionsAssignedToTrends,
      unassignedInteractionsCount: Math.max(
        0,
        totalInteractionsInWindow - totalInteractionsAssignedToTrends,
      ),
      totalRootsInWindow,
      eligibleRootsCount: aiDiagnostics.eligibleRootCount,
      assignedRootsCount,
      unassignedRootCount: Math.max(
        0,
        totalRootsInWindow - assignedRootsCount,
      ),
      nonAiAssignedRootCount: Math.max(0, assignedRootsCount - aiDiagnostics.processedRootCount),
      groupedRootsCount,
      singletonRootsCount,
      totalTrendsReturned: seeds.length,
      groupedTrendCount,
      singletonTrendCount,
      urlAnchorGroupCount,
      aiClusterGroupCount,
      templateSeriesCount,
      lowInformationTrendCount,
      fallbackLabelCount,
      lowQualityLabelCount,
      aiLabeledCount,
      aiAttempted: aiDiagnostics.attempted,
      aiClientInitialized: aiDiagnostics.clientInitialized,
      aiCredentialSource: aiDiagnostics.credentialSource,
      aiCredentialFingerprint: aiDiagnostics.credentialFingerprint,
      aiModel: aiDiagnostics.model,
      aiProcessedRootCount: aiDiagnostics.processedRootCount,
      aiProcessedFreshRootCount: aiDiagnostics.processedFreshRootCount,
      aiCacheHitCount: aiDiagnostics.cacheHitCount,
      aiFreshCallCount: aiDiagnostics.freshCallCount,
      aiBatchCount: aiDiagnostics.batchCount,
      aiBatchFailureCount: aiDiagnostics.batchFailureCount,
      aiFailedRootCount: aiDiagnostics.failedRootCount,
      aiAssignmentCoveragePct:
        aiDiagnostics.eligibleRootCount > 0
          ? round1((aiDiagnostics.processedRootCount / aiDiagnostics.eligibleRootCount) * 100)
          : 0,
      aiIncomplete: aiDiagnostics.incomplete,
      aiIncompleteReason: aiDiagnostics.incompleteReason,
      groupingRunMode: aiDiagnostics.mode,
      lastAiGroupingRunAt: aiDiagnostics.completedAt,
      lastSuccessfulFullRegroupAt: aiDiagnostics.lastSuccessfulFullRegroupAt,
      leaderboardSource: "ai_grouped_clusters",
      displayedRowsCount: 0,
      displayedAiGroupedRowsCount: 0,
      displayedSingletonRowsCount: 0,
      displayedFallbackRowsCount: 0,
      displayedLowInformationRowsCount: 0,
      latestInteractionAt:
        latestInteractionAt !== null
          ? new Date(latestInteractionAt * 1000).toISOString()
          : null,
      firehoseLagMinutes:
        typeof overallHealth?.backfillCoveragePct === "number"
          ? null
          : null,
    },
  };
}

function buildTopPosts(documents: TrendDocument[], referenceTime: Date) {
  const referenceMs = referenceTime.getTime();
  const primaryDocuments = documents.filter(
    (document) => document.documentKind !== "comment" && document.documentKind !== "delta",
  );
  const rankedDocuments =
    primaryDocuments.length > 0
      ? primaryDocuments
      : documents.filter((document) => document.documentKind !== "delta");

  return [...rankedDocuments]
    .map((document) => {
      const engagement = Math.max(0, document.interactionCount);
      const ageMinutes = Math.max(
        1,
        Math.round((referenceMs - document.createdUtc * 1000) / 60_000),
      );
      const engagementVelocity = round1(engagement / Math.max(ageMinutes / 60, 0.25));

      return {
        id: document.id,
        platformId: document.platformId,
        title: `${document.sourceLabel} | ${document.title}`,
        subtitle:
          document.platformId === "bluesky"
            ? document.postType
              ? `${document.postType} by @${document.authorHandle ?? document.author}`
              : `by @${document.authorHandle ?? document.author}`
            : document.author,
        author: document.author,
        authorHandle: document.authorHandle ?? null,
        postType: document.postType ?? null,
        documentKind: document.documentKind ?? null,
        rootDocumentId: document.rootDocumentId ?? null,
        interactionBreakdown: `${document.interactionCounts.reposts} reposts | ${document.interactionCounts.comments} replies/comments | ${document.interactionCounts.likes} likes`,
        engagement,
        engagementVelocity,
        ageMinutes,
        url: document.url,
      };
    })
    .sort((left, right) => {
      if (right.engagementVelocity !== left.engagementVelocity) {
        return right.engagementVelocity - left.engagementVelocity;
      }

      return right.engagement - left.engagement;
    })
    .slice(0, 5);
}

function compareBySort(mode: TrendLeaderboardMode, sort: TrendSort) {
  const tierWeight = (row: RankedTrend) => {
    switch (row.leaderboardTier) {
      case "primary_grouped":
        return 4;
      case "secondary_singleton":
        return 3;
      case "audit_low_information":
        return 2;
      case "audit_template":
        return 1;
      case "audit_fallback":
      default:
        return 0;
    }
  };
  const byTierAndQuality = (left: RankedTrend, right: RankedTrend) =>
    tierWeight(right) - tierWeight(left) ||
    (right.qualityAdjustedScore ?? right.totalInteractions24h ?? right.attentionInteractions) -
      (left.qualityAdjustedScore ?? left.totalInteractions24h ?? left.attentionInteractions) ||
    (right.totalInteractions24h ?? right.attentionInteractions) -
      (left.totalInteractions24h ?? left.attentionInteractions) ||
    left.id.localeCompare(right.id);

  if (sort === "posts") {
    return compareTrendsByPosts;
  }

  if (mode === "emerging") {
    if (sort === "velocity") {
      return (left: RankedTrend, right: RankedTrend) =>
        byTierAndQuality(left, right) ||
        (right.velocityScore ?? 0) - (left.velocityScore ?? 0) ||
        (right.breakoutScore ?? right.emergingScore ?? 0) -
          (left.breakoutScore ?? left.emergingScore ?? 0) ||
        left.id.localeCompare(right.id);
    }

    if (sort === "novelty") {
      return (left: RankedTrend, right: RankedTrend) =>
        byTierAndQuality(left, right) ||
        (right.noveltyScore ?? 0) - (left.noveltyScore ?? 0) ||
        (right.breakoutScore ?? right.emergingScore ?? 0) -
          (left.breakoutScore ?? left.emergingScore ?? 0) ||
        left.id.localeCompare(right.id);
    }

    if (sort === "confirmation") {
      return (left: RankedTrend, right: RankedTrend) =>
        byTierAndQuality(left, right) ||
        (right.confirmationScore ?? 0) - (left.confirmationScore ?? 0) ||
        (right.breakoutScore ?? right.emergingScore ?? 0) -
          (left.breakoutScore ?? left.emergingScore ?? 0) ||
        left.id.localeCompare(right.id);
    }

    return (left: RankedTrend, right: RankedTrend) =>
      byTierAndQuality(left, right) ||
      (right.breakoutScore ?? right.emergingScore ?? 0) -
        (left.breakoutScore ?? left.emergingScore ?? 0) ||
      left.id.localeCompare(right.id);
  }

  if (sort === "growth") {
    return (left: RankedTrend, right: RankedTrend) =>
      byTierAndQuality(left, right) ||
      right.growthRate - left.growthRate ||
      right.trendStrengthScore - left.trendStrengthScore ||
      left.id.localeCompare(right.id);
  }

  if (sort === "mentions") {
    return (left: RankedTrend, right: RankedTrend) =>
      byTierAndQuality(left, right) ||
      right.mentions - left.mentions ||
      right.trendStrengthScore - left.trendStrengthScore ||
      left.id.localeCompare(right.id);
  }

  if (sort === "strength") {
    return (left: RankedTrend, right: RankedTrend) =>
      byTierAndQuality(left, right) ||
      right.trendStrengthScore - left.trendStrengthScore ||
      right.attentionScore - left.attentionScore ||
      left.id.localeCompare(right.id);
  }

  return byTierAndQuality;
}

function clampScore(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeEmergingMomentum(value: number, scale: number) {
  return round1(clampScore(50 + value * scale));
}

function getEmergingRatioScore(current: number, previous: number) {
  const safeCurrent = Math.max(current, 0);
  const safePrevious = Math.max(previous, 0);
  const ratio = (safeCurrent + 2) / (safePrevious + 2);
  const ratioScore = (Math.log2(ratio) + 0.2) * 32;
  const supportScore = Math.min(14, Math.log10(safeCurrent + 1) * 10);
  return round1(clampScore(ratioScore + supportScore));
}

function getEmergingLifecycleScore(lifecycleStage: RankedTrend["lifecycleStage"]) {
  switch (lifecycleStage) {
    case "Emerging":
      return 100;
    case "Expanding":
      return 92;
    case "Established":
      return 36;
    case "Fading":
      return 22;
    case "Declining":
      return 8;
    default:
      return 28;
  }
}

function getEmergingSpreadScore(trend: RankedTrend) {
  const platformScore = Math.min(44, trend.platformSpread * 15);
  const sourceScore = Math.min(36, trend.supportingThreadCount * 7);
  const blueskySpreadScore = Math.min(
    16,
    Math.log2((trend.blueskySummary?.uniqueAuthorCount ?? 0) + 1) * 4,
  );

  return round1(clampScore(16 + platformScore + sourceScore + blueskySpreadScore));
}

function getEmergingMainstreamPenalty(trend: RankedTrend, attentionRank: number) {
  const sizePenalty =
    trend.attentionScore > 58 ? Math.min(30, (trend.attentionScore - 58) * 0.85) : 0;
  const rankPenalty =
    attentionRank <= 3 ? 18 : attentionRank <= 6 ? 10 : attentionRank <= 10 ? 4 : 0;
  const lifecyclePenalty =
    trend.lifecycleStage === "Established"
      ? 8
      : trend.lifecycleStage === "Fading"
        ? 12
        : trend.lifecycleStage === "Declining"
          ? 18
          : 0;

  return round1(sizePenalty + rankPenalty + lifecyclePenalty);
}

function getEmergingTrendScore(
  seed: RankedTrendSeed,
  trend: RankedTrend,
  attentionRank: number,
) {
  const growthSignal = normalizeEmergingMomentum(trend.growthRate, 1.7);
  const accelerationSignal = normalizeEmergingMomentum(trend.attentionAcceleration, 8);
  const interactionLiftScore = getEmergingRatioScore(
    seed.currentWindowInteractionScore,
    seed.priorWindowInteractionScore,
  );
  const narrativeLiftScore = getEmergingRatioScore(
    seed.currentWindowNarrativeScore,
    seed.priorWindowNarrativeScore,
  );
  const abnormalityScore = round1(
    growthSignal * 0.22 +
      accelerationSignal * 0.28 +
      interactionLiftScore * 0.28 +
      narrativeLiftScore * 0.22,
  );
  const spreadScore = getEmergingSpreadScore(trend);
  const lifecycleScore = getEmergingLifecycleScore(trend.lifecycleStage);
  const confidenceScore = round1(
    clampScore(
      trend.confidenceScore +
        (trend.lowDataWarning && trend.confidenceScore >= 34 ? 6 : 0) -
        (trend.confidenceScore < 28 ? 12 : trend.confidenceScore < 36 ? 5 : 0),
    ),
  );
  const smallNarrativeBonus =
    trend.attentionScore <= 52 ? Math.min(18, (52 - trend.attentionScore) * 0.45) : 0;
  const spikeBonus = trend.hasSpike ? 4 : 0;
  const mainstreamPenalty = getEmergingMainstreamPenalty(trend, attentionRank);

  return round1(
    clampScore(
      abnormalityScore * 0.42 +
        spreadScore * 0.18 +
        lifecycleScore * 0.15 +
        confidenceScore * 0.15 +
        smallNarrativeBonus +
        spikeBonus -
        mainstreamPenalty,
    ),
  );
}

function buildRankChanges(rows: RankedTrendSeed[]) {
  const useInteractions = rows.some(
    (row) => row.currentWindowInteractionScore > 0 || row.priorWindowInteractionScore > 0,
  );

  const currentRanking = [...rows]
    .sort((left, right) =>
      useInteractions
        ? right.currentWindowInteractionScore - left.currentWindowInteractionScore
        : right.currentWindowNarrativeScore - left.currentWindowNarrativeScore,
    )
    .map((row, index) => [row.trend.id, index + 1] as const);
  const priorRanking = [...rows]
    .sort((left, right) =>
      useInteractions
        ? right.priorWindowInteractionScore - left.priorWindowInteractionScore
        : right.priorWindowNarrativeScore - left.priorWindowNarrativeScore,
    )
    .map((row, index) => [row.trend.id, index + 1] as const);

  const currentMap = new Map(currentRanking);
  const priorMap = new Map(priorRanking);

  return new Map(
    rows.map((row) => {
      const currentRank = currentMap.get(row.trend.id) ?? 0;
      const priorRank = priorMap.get(row.trend.id) ?? currentRank;
      return [row.trend.id, priorRank - currentRank] as const;
    }),
  );
}

function buildTrendDocuments(
  posts: RedditNormalizedPost[],
  comments: RedditNormalizedComment[],
  publicItems: PublicSourceItem[],
  blueskyPosts: BlueskyNormalizedPost[],
  blueskyInteractions: BlueskyInteraction[],
  blueskyPostSnapshots: BlueskyPostSnapshot[],
  blueskyProfiles: BlueskyProfile[],
  youtubeComments: YouTubeNormalizedComment[],
  youtubeVideoSnapshots: YouTubeVideoSnapshot[],
) {
  const commentsByPost = new Map<string, RedditNormalizedComment[]>();
  comments.forEach((comment) => {
    const existing = commentsByPost.get(comment.postId);
    if (existing) {
      existing.push(comment);
      return;
    }
    commentsByPost.set(comment.postId, [comment]);
  });
  const blueskyProfileByDid = new Map(blueskyProfiles.map((profile) => [profile.did, profile] as const));
  const explicitBlueskyIds = new Set(blueskyPosts.map((post) => post.id));

  const redditDocuments: TrendDocument[] = posts.map((post) => {
    const interactionCounts = getRedditPostInteractionCounts(
      post,
      (commentsByPost.get(post.id) ?? []).length,
    );

    return {
      id: post.id,
      platformId: "reddit",
      sourceKey: post.subreddit.toLowerCase(),
      sourceLabel: `r/${post.subreddit}`,
      title: post.title,
      body: post.selftext.trim(),
      author: post.author,
      url: post.url,
      createdUtc: post.createdUtc,
      fetchedAt: post.fetchedAt,
      score: post.score,
      interactionCounts,
      interactionCount: getWeightedInteractionScore(interactionCounts),
      narrativeInteractionCount: getNarrativeInteractionScore(interactionCounts),
    };
  });
  const newsDocuments: TrendDocument[] = publicItems.flatMap((item) => {
    if (item.sourceType === "bluesky" && explicitBlueskyIds.has(item.id)) {
      return [];
    }

    const interactionCounts = getPublicItemInteractionCounts(item);
    const platformId =
      item.sourceType === "googletrends"
        ? "google"
        : item.sourceType === "telegram"
          ? "telegram"
          : item.sourceType === "youtube"
            ? "youtube"
            : item.sourceType === "bluesky"
              ? "bluesky"
              : "news";
    const authorHandle = item.authorHandle ?? item.authorDid ?? null;
    const sourceKey =
      item.sourceType === "bluesky"
        ? (authorHandle ?? item.sourceName).toLowerCase()
        : item.sourceName.toLowerCase();
    const sourceLabel = item.sourceType === "bluesky" ? "Bluesky" : item.sourceName;
    const documentKind =
      item.sourceType === "bluesky"
        ? item.postType === "quote"
          ? "quote"
          : item.postType === "reply"
            ? "reply"
            : "primary"
        : "primary";

    return [
      {
        id: item.id,
        platformId,
        sourceKey,
        sourceLabel,
        sourceType: item.sourceType,
        clusterKey: item.clusterKey,
        clusterLabel: item.clusterLabel,
        title: item.title,
        body:
          item.sourceType === "youtube"
            ? item.description ?? item.summary
            : item.summary,
        author: item.author,
        authorId: item.authorDid ?? null,
        authorHandle,
        authorFollowersCount: item.followerCount ?? null,
        postType: item.postType ?? null,
         url: item.url,
         createdUtc: item.createdUtc,
         fetchedAt: item.fetchedAt,
         score: item.score,
        interactionCounts,
        interactionCount: getPublicItemWeightedInteractionScore(item, interactionCounts),
        narrativeInteractionCount:
          item.sourceType === "bluesky"
            ? round1(getNarrativeInteractionScore(interactionCounts) + (item.postType === "quote" ? 3 : 0))
            : getNarrativeInteractionScore(interactionCounts),
        trafficLabel: item.trafficLabel ?? null,
        documentKind,
        rootDocumentId: item.rootPostId ?? item.id,
        parentDocumentId: item.parentPostId ?? null,
      } satisfies TrendDocument,
    ];
  });

  const publicItemById = new Map(publicItems.map((item) => [item.id, item] as const));
  const blueskyPostById = new Map(blueskyPosts.map((post) => [post.id, post] as const));
  const blueskyDocuments: TrendDocument[] = blueskyPosts.map((post) => {
    const profile = blueskyProfileByDid.get(post.authorDid);
    const interactionCounts = getBlueskyInteractionCounts(post);
    return {
      id: post.id,
      platformId: "bluesky",
      documentKind:
        post.postType === "quote"
          ? "quote"
          : post.postType === "reply"
            ? "reply"
            : "primary",
      rootDocumentId: getBlueskyPostRootId(post),
      parentDocumentId: getBlueskyPostParentId(post),
      sourceKey: (post.authorHandle || post.authorDid).toLowerCase(),
      sourceLabel: "Bluesky",
      sourceType: "bluesky",
      title: post.title ?? (getBlueskyPostText(post).slice(0, 180) || "Bluesky post"),
      body: getBlueskyPostText(post),
      author: post.authorDisplayName ?? post.authorHandle,
      authorId: post.authorDid,
      authorHandle: post.authorHandle,
      authorFollowersCount: post.authorFollowersCount ?? profile?.followersCount ?? null,
       postType: post.postType,
       url: post.url,
       createdUtc: post.createdUtc,
       fetchedAt: post.fetchedAt,
       score: post.score,
      interactionCounts,
      interactionCount: getBlueskyInteractionScore(post, profile),
      narrativeInteractionCount: getBlueskyNarrativeInteractionScore(post),
    } satisfies TrendDocument;
  });
  const blueskyInteractionDocuments: TrendDocument[] = blueskyInteractions
    .filter(
      (interaction) =>
        interaction.interactionType === "quote" ||
        (interaction.interactionType === "reply" && Boolean(getBlueskyInteractionText(interaction))),
    )
    .map((interaction) => {
      const profile =
        interaction.actorDid ? blueskyProfileByDid.get(interaction.actorDid) : undefined;
      const rootPost =
        blueskyPostById.get(getBlueskyInteractionRootId(interaction)) ??
        blueskyPostById.get(getBlueskyInteractionPostId(interaction));
      return {
        id: interaction.id,
        platformId: "bluesky",
        documentKind: interaction.interactionType === "quote" ? "quote" : "reply",
        rootDocumentId: getBlueskyInteractionRootId(interaction),
        parentDocumentId: interaction.parentUri ?? getBlueskyInteractionPostId(interaction),
        sourceKey: (interaction.actorHandle ?? interaction.actorDid ?? "bluesky").toLowerCase(),
        sourceLabel: "Bluesky",
        sourceType: "bluesky",
        title:
          rootPost?.title ??
          (rootPost ? getBlueskyPostText(rootPost).slice(0, 180) : "Bluesky discussion"),
        body: getBlueskyInteractionText(interaction) || (rootPost ? getBlueskyPostText(rootPost) : ""),
        author: interaction.actorDisplayName ?? interaction.actorHandle ?? "Bluesky account",
        authorId: interaction.actorDid ?? null,
        authorHandle: interaction.actorHandle ?? null,
        authorFollowersCount:
          interaction.actorFollowersCount ?? profile?.followersCount ?? null,
        postType: interaction.interactionType,
        url: interaction.url ?? rootPost?.url ?? "https://bsky.app",
        createdUtc: interaction.createdUtc,
        fetchedAt: interaction.fetchedAt,
        score:
          Math.max(interaction.likeCount ?? 0, 0) +
          Math.max(interaction.repostCount ?? 0, 0) +
          Math.max(interaction.replyCount ?? 0, 0) +
          Math.max(interaction.quoteCount ?? 0, 0),
        interactionCounts: sanitizeInteractionCounts({
          posts: interaction.interactionType === "quote" ? 1 : 0,
          comments: interaction.interactionType === "reply" ? 1 : 0,
          reposts: interaction.interactionType === "quote" ? 1 : 0,
          likes: 0,
        }),
        interactionCount: getBlueskyInteractionEventScore(interaction, profile),
        narrativeInteractionCount:
          interaction.interactionType === "quote" ? 10 : 6,
      } satisfies TrendDocument;
    });
  const youtubeCommentDocuments: TrendDocument[] = youtubeComments
    .map((comment) => {
      const parent = publicItemById.get(comment.postId);
      const interactionCounts = getYouTubeCommentInteractionCounts(comment);

      return {
        id: comment.id,
        platformId: "youtube",
        documentKind: "comment",
        rootDocumentId: comment.postId,
        sourceKey: (parent?.sourceName ?? comment.sourceName ?? "youtube").toLowerCase(),
        sourceLabel: parent?.sourceName ?? comment.sourceName ?? "YouTube",
        sourceType: "youtube",
        title: parent?.title ?? comment.videoTitle ?? "YouTube discussion",
        body: comment.body,
        author: comment.author,
        url: comment.url,
        createdUtc: comment.createdUtc,
        fetchedAt: comment.fetchedAt,
        score: comment.score,
        interactionCounts,
        interactionCount: getYouTubeCommentInteractionScore(comment),
        narrativeInteractionCount: getYouTubeCommentInteractionScore(comment),
      } satisfies TrendDocument;
    });

  const blueskyDeltaDocuments = blueskyPostSnapshots
    .map<TrendDocument | null>((snapshot) => {
      const parent = blueskyPostById.get(snapshot.postUri);
      if (!parent) {
        return null;
      }
      const interactionCount = getBlueskySnapshotInteractionScore(snapshot);
      if (interactionCount <= 0) {
        return null;
      }
      const profile = blueskyProfileByDid.get(parent.authorDid);
      return {
        id: snapshot.id,
        platformId: "bluesky",
        documentKind: "delta",
        rootDocumentId: getBlueskyPostRootId(parent),
        parentDocumentId: getBlueskyPostParentId(parent),
        sourceKey: (parent.authorHandle || parent.authorDid).toLowerCase(),
        sourceLabel: "Bluesky",
        sourceType: "bluesky",
        title:
          parent.title ??
          (getBlueskyPostText(parent).slice(0, 180) || "Bluesky post"),
        body: getBlueskyPostText(parent),
        author: parent.authorDisplayName ?? parent.authorHandle,
        authorId: parent.authorDid,
        authorHandle: parent.authorHandle,
        authorFollowersCount: parent.authorFollowersCount ?? profile?.followersCount ?? null,
        postType: parent.postType,
        url: parent.url,
        createdUtc: snapshot.createdUtc,
        fetchedAt: snapshot.fetchedAt,
        score: parent.score,
        interactionCounts: sanitizeInteractionCounts({
          reposts: Math.max((snapshot.deltaRepostCount ?? 0) + (snapshot.deltaQuoteCount ?? 0), 0),
          comments: Math.max(snapshot.deltaCommentCount ?? 0, 0),
          likes: Math.max(snapshot.deltaLikeCount ?? 0, 0),
        }),
        interactionCount,
        narrativeInteractionCount: round1(interactionCount * 0.85),
      } satisfies TrendDocument;
    })
    .filter((document): document is TrendDocument => document !== null);

  const youtubeDeltaDocuments = youtubeVideoSnapshots
    .map<TrendDocument | null>((snapshot) => {
      const parentId = `youtube:${snapshot.videoId}`;
      const parent = publicItemById.get(parentId);
      if (!parent) {
        return null;
      }
      const deltaInteractionCounts = sanitizeInteractionCounts({
        comments: snapshot.deltaCommentCount ?? 0,
        likes: snapshot.deltaLikeCount ?? 0,
      });
      const interactionCount = getYouTubeDeltaInteractionScore(snapshot);
      if (interactionCount <= 0) {
        return null;
      }

      return {
        id: snapshot.id,
        platformId: "youtube",
        documentKind: "delta",
        rootDocumentId: parentId,
        sourceKey: parent.sourceName.toLowerCase(),
        sourceLabel: parent.sourceName,
        sourceType: "youtube",
        title: parent.title,
        body: parent.description ?? parent.summary,
        author: parent.author,
        url: parent.url,
        createdUtc: snapshot.createdUtc,
        fetchedAt: snapshot.fetchedAt,
        score: parent.score,
        interactionCounts: deltaInteractionCounts,
        interactionCount,
        narrativeInteractionCount: round1(interactionCount * 0.8),
      } satisfies TrendDocument;
    })
    .filter((document): document is TrendDocument => document !== null);

  return [
    ...redditDocuments,
    ...newsDocuments,
    ...blueskyDocuments,
    ...blueskyInteractionDocuments,
    ...youtubeCommentDocuments,
    ...blueskyDeltaDocuments,
    ...youtubeDeltaDocuments,
  ];
}

function buildCandidatePhrases(document: TrendDocument) {
  const namedPhrases = extractNamedPhrases(document);
  if (isGenericThreadDocument(document) && namedPhrases.length === 0) {
    return [];
  }

  const trimmed = tokenize(document)
    .map((token) => normalizeClusterToken(token))
    .filter(isInformativeToken)
    .slice(0, 18);
  const candidates = new Set<string>();

  namedPhrases.forEach((phrase) => candidates.add(phrase));

  for (let index = 0; index < trimmed.length - 1; index += 1) {
    candidates.add(`${trimmed[index]} ${trimmed[index + 1]}`);

    if (index < trimmed.length - 2) {
      candidates.add(`${trimmed[index]} ${trimmed[index + 1]} ${trimmed[index + 2]}`);
    }

    if (index < trimmed.length - 3) {
      candidates.add(
        `${trimmed[index]} ${trimmed[index + 1]} ${trimmed[index + 2]} ${trimmed[index + 3]}`,
      );
    }
  }

  return [...candidates]
    .map((phrase) => phrase.replace(/\s+/g, " ").trim())
    .filter((phrase) => {
      const parts = phrase.split(" ").filter(Boolean);
      const label = phraseToLabel(phrase);
      return (
        parts.length >= 2 &&
        parts.every((part) => isInformativeToken(part)) &&
        !isWeakNarrativeLabel(label) &&
        !isFragmentLikeNarrativeLabel(label)
      );
    });
}

function buildPhraseStats(documents: TrendDocument[]) {
  const stats = new Map<string, PhraseStat>();

  documents.forEach((document) => {
    const phrases = new Set(buildCandidatePhrases(document));
    const namedPhraseKeys = new Set(
      extractNamedPhrases(document)
        .map((phrase) => canonicalPhraseKey(phrase))
        .filter(Boolean),
    );
    const discoveryWeight = documentDiscoveryWeight(document);

    phrases.forEach((phrase) => {
      const key = canonicalPhraseKey(phrase);
      if (!key) {
        return;
      }

      const label = phraseToLabel(phrase);
      const existing = stats.get(key);
      if (existing) {
        existing.score += discoveryWeight;
        existing.documentIds.add(document.id);
        existing.rootDocumentIds.add(document.rootDocumentId ?? document.id);
        existing.authorIds.add(document.authorId ?? document.authorHandle ?? document.author);
        existing.sourceCounts.set(
          document.sourceKey,
          (existing.sourceCounts.get(document.sourceKey) ?? 0) + 1,
        );
        existing.labelScores.set(label, (existing.labelScores.get(label) ?? 0) + discoveryWeight);
        if (namedPhraseKeys.has(key)) {
          existing.namedPhraseSupport += 1;
        }
        return;
      }

      stats.set(key, {
        key,
        label,
        score: discoveryWeight,
        documentIds: new Set([document.id]),
        rootDocumentIds: new Set([document.rootDocumentId ?? document.id]),
        authorIds: new Set([document.authorId ?? document.authorHandle ?? document.author]),
        sourceCounts: new Map([[document.sourceKey, 1]]),
        labelScores: new Map([[label, discoveryWeight]]),
        namedPhraseSupport: namedPhraseKeys.has(key) ? 1 : 0,
      });
    });
  });

  return [...stats.values()]
    .filter(
      (stat) =>
        stat.documentIds.size >= 2 &&
        !isWeakNarrativeLabel(stat.label) &&
        !isFragmentLikeNarrativeLabel(stat.label),
    )
    .map((stat) => ({
      ...stat,
      label:
        [...stat.labelScores.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
        stat.label,
      score:
        stat.score +
        stat.documentIds.size * 28 +
        stat.rootDocumentIds.size * 10 +
        stat.authorIds.size * 12 +
        stat.sourceCounts.size * 16 +
        stat.namedPhraseSupport * 18 +
        Math.min(72, stat.label.split(" ").length * 12),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 80);
}

function dominantTheme(documents: TrendDocument[]) {
  const counts = new Map<string, number>();

  documents.forEach((document) => {
    const theme =
      document.platformId === "bluesky"
        ? { id: "social-live", label: "Social / Live" }
        : isPublicNewsThemePlatform(document.platformId)
        ? { id: "public-narratives", label: "Public / News" }
        : SUBREDDIT_THEMES[document.sourceKey] ?? {
            id: "cross-platform-general",
            label: "Cross-platform / General",
          };
    counts.set(theme.id, (counts.get(theme.id) ?? 0) + 1);
  });

  const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  if (!top) {
    return { id: "social-live", label: "Social / Live" };
  }

  if (top[0] === "public-narratives") {
    return { id: "public-narratives", label: "Public / News" };
  }

  if (top[0] === "social-live") {
    return { id: "social-live", label: "Social / Live" };
  }

  return Object.values(SUBREDDIT_THEMES).find((theme) => theme.id === top[0]) ?? {
    id: "cross-platform-general",
    label: "Cross-platform / General",
  };
}

function createTopicGroup(
  key: string,
  label: string,
  documents: TrendDocument[],
  comments: RedditNormalizedComment[],
  summary?: string,
  aliases?: string[],
  topPhrase?: string,
  metadata: TopicGroupMetadata = {},
): TopicGroup {
  const isMeme = isMemeTrend(documents);
  const theme = dominantTheme(documents);
  const labelSource = metadata.labelSource ?? "phrase";
  const namedPhraseSupport = metadata.namedPhraseSupport ?? 0;
  const sourceDiversity = new Set(documents.map((document) => document.sourceKey)).size;
  const normalizedLabel = normalizeNarrativeLabel(label);

  return {
    key,
    label: normalizedLabel,
    documents,
    comments,
    topPhrase: topPhrase ?? normalizedLabel,
    themeId: isMeme ? "reddit-memes" : theme.id,
    themeLabel: isMeme ? "Internet / Meme culture" : theme.label,
    isMeme,
    summary,
    aliases,
    labelSource,
    labelQualityScore:
      metadata.labelQualityScore && metadata.labelQualityScore > 0
        ? metadata.labelQualityScore
        :
      getNarrativeLabelQualityScore(normalizedLabel, documents, labelSource, namedPhraseSupport),
    sourceDiversity,
    namedPhraseSupport,
  };
}

function getTelegramDocumentCount(documents: TrendDocument[]) {
  return documents.filter((document) => document.platformId === "telegram").length;
}

function getYouTubeDocumentCount(documents: TrendDocument[]) {
  return documents.filter((document) => document.platformId === "youtube").length;
}

function getBlueskyDocumentCount(documents: TrendDocument[]) {
  return documents.filter((document) => document.platformId === "bluesky").length;
}

function hasTelegramDocuments(documents: TrendDocument[]) {
  return getTelegramDocumentCount(documents) > 0;
}

function hasBlueskyDocuments(documents: TrendDocument[]) {
  return getBlueskyDocumentCount(documents) > 0;
}

function isTelegramOnlyDocumentSet(documents: TrendDocument[]) {
  return documents.length > 0 && documents.every((document) => document.platformId === "telegram");
}

function isYouTubeOnlyDocumentSet(documents: TrendDocument[]) {
  return documents.length > 0 && documents.every((document) => document.platformId === "youtube");
}

function isBlueskyOnlyDocumentSet(documents: TrendDocument[]) {
  return documents.length > 0 && documents.every((document) => document.platformId === "bluesky");
}

function hasNonTelegramPublicNarrativeDocuments(documents: TrendDocument[]) {
  return documents.some(
    (document) =>
      isPublicNarrativePlatform(document.platformId) && document.platformId !== "telegram",
  );
}

function hasYouTubeTopicSupport(group: Pick<TopicGroup, "documents" | "sourceDiversity">) {
  const youtubeDocumentCount = getYouTubeDocumentCount(group.documents);
  if (youtubeDocumentCount === 0) {
    return false;
  }

  if (group.documents.some((document) => document.platformId !== "youtube")) {
    return true;
  }

  return (
    (getPrimaryDocumentCount(group.documents) >= 2 && group.sourceDiversity >= 2) ||
    (getPrimaryDocumentCount(group.documents) >= 1 && getCommentDocumentCount(group.documents) >= 2)
  );
}

function hasTelegramTopicSupport(group: Pick<TopicGroup, "documents" | "sourceDiversity" | "comments">) {
  const telegramDocumentCount = getTelegramDocumentCount(group.documents);
  if (telegramDocumentCount === 0) {
    return false;
  }

  if (group.documents.some((document) => document.platformId !== "telegram")) {
    return true;
  }

  return (
    telegramDocumentCount >= 2 ||
    group.sourceDiversity >= 2 ||
    group.comments.length >= 8
  );
}

function getBlueskyUniqueAuthorCount(documents: TrendDocument[]) {
  return new Set(
    documents
      .filter((document) => document.platformId === "bluesky")
      .map((document) => document.authorId ?? document.authorHandle ?? document.author),
  ).size;
}

function getBlueskyUniqueRootCount(documents: TrendDocument[]) {
  return new Set(
    documents
      .filter((document) => document.platformId === "bluesky")
      .map((document) => document.rootDocumentId ?? document.id),
  ).size;
}

function getBlueskyAmplificationCount(documents: TrendDocument[]) {
  return documents.filter(
    (document) =>
      document.platformId === "bluesky" &&
      (document.documentKind === "quote" ||
        document.documentKind === "amplification" ||
        document.documentKind === "delta"),
  ).length;
}

function hasBlueskyTopicSupport(group: Pick<TopicGroup, "documents" | "sourceDiversity" | "comments">) {
  const blueskyDocumentCount = getBlueskyDocumentCount(group.documents);
  if (blueskyDocumentCount === 0) {
    return false;
  }

  if (group.documents.some((document) => document.platformId !== "bluesky")) {
    return true;
  }

  const uniqueAuthors = getBlueskyUniqueAuthorCount(group.documents);
  const uniqueRoots = getBlueskyUniqueRootCount(group.documents);
  const amplificationCount = getBlueskyAmplificationCount(group.documents);

  return (
    (uniqueAuthors >= 2 && uniqueRoots >= 2) ||
    (uniqueAuthors >= 2 && amplificationCount >= 1) ||
    blueskyDocumentCount >= 3 ||
    group.comments.length >= 8
  );
}

function hasTopicGroupSupport(group: Pick<TopicGroup, "documents" | "comments" | "sourceDiversity">) {
  if (isBlueskyOnlyDocumentSet(group.documents)) {
    return hasBlueskyTopicSupport(group);
  }

  if (isYouTubeOnlyDocumentSet(group.documents)) {
    return hasYouTubeTopicSupport(group);
  }

  return (
    group.documents.length >= 2 ||
    group.comments.length >= 8 ||
    hasNonTelegramPublicNarrativeDocuments(group.documents) ||
    hasBlueskyTopicSupport(group) ||
    hasTelegramTopicSupport(group)
  );
}

function passesNarrativeQualityGate(
  group: Pick<TopicGroup, "documents" | "label" | "labelQualityScore" | "namedPhraseSupport">,
  options: { emerging?: boolean } = {},
) {
  if (!hasBlueskyDocuments(group.documents)) {
    return true;
  }

  const emerging = options.emerging ?? false;
  const uniqueAuthors = countUniqueDocumentAuthors(group.documents);
  const primaryDocumentCount = getPrimaryDocumentCount(group.documents);
  const blueskyDocumentCount = getBlueskyDocumentCount(group.documents);
  const blueskyUniqueRoots = getBlueskyUniqueRootCount(group.documents);
  const blueskyAmplificationCount = getBlueskyAmplificationCount(group.documents);
  const informativeTokenCount = getNarrativeInformativeTokens(group.label).length;

  if (isGenericPlatformNarrativeLabel(group.label)) {
    return false;
  }

  if (group.labelQualityScore < (emerging ? 52 : 46)) {
    return false;
  }

  if (isFragmentLikeNarrativeLabel(group.label) && group.namedPhraseSupport < 2) {
    return false;
  }

  if (informativeTokenCount < 2 && group.namedPhraseSupport < 2) {
    return false;
  }

  if (isBlueskyOnlyDocumentSet(group.documents)) {
    const hasAmplifiedLiveSupport = blueskyAmplificationCount >= 1;
    const hasDurableSingleRootSignal =
      blueskyDocumentCount >= (emerging ? 5 : 7) && informativeTokenCount >= 2;
    const hasRepeatedNamedSignal = group.namedPhraseSupport >= (emerging ? 2 : 3);
    if (
      uniqueAuthors < (emerging ? 3 : 2) &&
      blueskyUniqueRoots < 2 &&
      !hasAmplifiedLiveSupport &&
      !hasDurableSingleRootSignal &&
      !hasRepeatedNamedSignal
    ) {
      return false;
    }

    if (blueskyUniqueRoots < 2 && primaryDocumentCount < 3) {
      return false;
    }

    if (group.namedPhraseSupport === 0 && (uniqueAuthors < 2 || blueskyUniqueRoots < 2)) {
      return false;
    }
  }

  if (emerging && blueskyDocumentCount < 2 && uniqueAuthors < 3) {
    return false;
  }

  return true;
}

function getTopicGroupMinimumLabelScore(group: Pick<TopicGroup, "documents" | "labelSource">) {
  if (hasBlueskyDocuments(group.documents)) {
    return group.labelSource === "fallback" ? 56 : 42;
  }

  if (!hasTelegramDocuments(group.documents)) {
    return group.labelSource === "fallback" ? 60 : 46;
  }

  return group.labelSource === "fallback" ? 50 : 40;
}

function getFinalizedTopicGroupMinimumLabelScore(group: Pick<TopicGroup, "documents">) {
  if (hasBlueskyDocuments(group.documents)) {
    return 40;
  }

  return hasTelegramDocuments(group.documents) ? 42 : 54;
}

function buildTopicGroups(
  documents: TrendDocument[],
  comments: RedditNormalizedComment[],
) {
  const phraseStats = buildPhraseStats(documents);
  const phraseStatsMap = new Map(phraseStats.map((stat) => [stat.key, stat]));
  const phraseScoreMap = new Map(phraseStats.map((stat) => [stat.key, stat.score]));
  const phraseLabelMap = new Map(phraseStats.map((stat) => [stat.key, stat.label]));
  const grouped = new Map<string, TopicGroup>();
  const fallbackGroups = new Map<string, TopicGroup>();

  documents.forEach((document) => {
    if (document.clusterKey && document.clusterLabel) {
      const existingCluster = grouped.get(document.clusterKey);
      if (existingCluster) {
        existingCluster.documents.push(document);
        return;
      }

      grouped.set(document.clusterKey, {
        key: document.clusterKey,
        label: document.clusterLabel,
        documents: [document],
        comments: [],
        topPhrase: document.clusterLabel,
        themeId: "",
        themeLabel: "",
        isMeme: false,
        labelSource: "ai",
        labelQualityScore: 0,
        sourceDiversity: 1,
        namedPhraseSupport: 0,
      });
      return;
    }

    const phrases = buildCandidatePhrases(document);
    const winningPhrase = phrases
      .map((phrase) => ({
        phrase,
        key: canonicalPhraseKey(phrase),
      }))
      .filter((entry) => entry.key && phraseScoreMap.has(entry.key))
      .sort(
        (left, right) => (phraseScoreMap.get(right.key) ?? 0) - (phraseScoreMap.get(left.key) ?? 0),
      )[0];

    if (winningPhrase) {
      const stat = phraseStatsMap.get(winningPhrase.key);
      const label = phraseLabelMap.get(winningPhrase.key) ?? phraseToLabel(winningPhrase.phrase);
      const existing = grouped.get(winningPhrase.key);
      if (existing) {
        existing.documents.push(document);
        return;
      }

      grouped.set(winningPhrase.key, {
        key: winningPhrase.key,
        label,
        documents: [document],
        comments: [],
        topPhrase: winningPhrase.phrase,
        themeId: "",
        themeLabel: "",
        isMeme: false,
        labelSource: (stat?.namedPhraseSupport ?? 0) > 0 ? "named_phrase" : "phrase",
        labelQualityScore: 0,
        sourceDiversity: 1,
        namedPhraseSupport: stat?.namedPhraseSupport ?? 0,
      });
      return;
    }

    const fallbackTokens = tokenize(document)
      .map((token) => normalizeClusterToken(token))
      .filter(isInformativeToken)
      .slice(0, 3);
    const fallbackKey = [...new Set(fallbackTokens)].sort().join(" ");
    const fallbackLabel = phraseToLabel(fallbackKey.replace(/\s+/g, " "));
    if (!fallbackKey || isWeakNarrativeLabel(fallbackLabel)) {
      return;
    }

    const existingFallback = fallbackGroups.get(fallbackKey);
    if (existingFallback) {
      existingFallback.documents.push(document);
      return;
    }

    fallbackGroups.set(fallbackKey, {
      key: fallbackKey,
      label: fallbackLabel,
      documents: [document],
      comments: [],
      topPhrase: fallbackKey,
      themeId: "",
      themeLabel: "",
      isMeme: false,
      labelSource: "fallback",
      labelQualityScore: 0,
      sourceDiversity: 1,
      namedPhraseSupport: 0,
    });
  });

  const merged = [
    ...grouped.values(),
    ...[...fallbackGroups.values()].filter((group) => group.documents.length >= 2),
  ];

  const documentToGroup = new Map<string, TopicGroup>();
  merged.forEach((group) => {
    group.documents.forEach((document) => {
      documentToGroup.set(document.id, group);
    });
  });

  comments.forEach((comment) => {
    const group = documentToGroup.get(comment.postId);
    if (group) {
      group.comments.push(comment);
    }
  });

  const rankedGroups = merged
    .map((group) =>
      createTopicGroup(
        group.key,
        group.label,
        group.documents,
        group.comments,
        group.summary,
        group.aliases,
        group.topPhrase,
        {
          labelSource: group.labelSource,
          labelQualityScore: group.labelQualityScore,
          namedPhraseSupport: group.namedPhraseSupport,
        },
      ),
    )
    .filter(
      (group) =>
        hasTopicGroupSupport(group) &&
        passesNarrativeQualityGate(group) &&
        group.labelQualityScore >= getTopicGroupMinimumLabelScore(group) &&
        (
          group.labelSource !== "fallback" ||
          group.documents.length >= 3 ||
          group.sourceDiversity >= 2 ||
          hasNonTelegramPublicNarrativeDocuments(group.documents) ||
          hasTelegramTopicSupport(group)
        ),
    )
    .sort((left, right) => {
      if (right.comments.length !== left.comments.length) {
        return right.comments.length - left.comments.length;
      }

      return right.documents.length - left.documents.length;
    });

  const telegramGroups = rankedGroups.filter((group) => hasTelegramDocuments(group.documents));
  const nonTelegramGroups = rankedGroups
    .filter((group) => !hasTelegramDocuments(group.documents))
    .slice(0, 60);

  return [...nonTelegramGroups, ...telegramGroups];
}

function dedupeById<T extends { id: string }>(items: T[]) {
  return [...new Map(items.map((item) => [item.id, item] as const)).values()];
}

function getPrimaryDocumentCount(documents: TrendDocument[]) {
  return documents.filter((document) => document.documentKind !== "comment" && document.documentKind !== "delta").length;
}

function getCommentDocumentCount(documents: TrendDocument[]) {
  return documents.filter((document) => document.documentKind === "comment").length;
}

function dedupeStrings(values: Array<string | undefined>) {
  const seen = new Set<string>();

  return values.reduce<string[]>((list, value) => {
    const normalized = normalizeNarrativeLabel(value ?? "");
    if (!normalized) {
      return list;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return list;
    }

    seen.add(key);
    list.push(normalized);
    return list;
  }, []);
}

function canonicalNarrativeMergeKey(label: string, aliases: string[] = []) {
  const candidates = [label, ...aliases]
    .map((entry) => getNarrativeInformativeTokens(entry))
    .filter((tokens) => tokens.length > 0)
    .map((tokens) => [...new Set(tokens)].sort().slice(0, 4).join(" "));

  return candidates.sort((left, right) => right.length - left.length)[0] ?? "";
}

type ResolvedTopicLabel = {
  label: string;
  aliases: string[];
  labelSource: NarrativeLabelSource;
  labelQualityScore: number;
  namedPhraseSupport: number;
};

function resolveTopicGroupLabel(group: TopicGroup): ResolvedTopicLabel | null {
  const coherenceContext = buildTopicGroupCoherenceContext(group.documents);
  const candidateMap = new Map<
    string,
    {
      label: string;
      labelSource: NarrativeLabelSource;
      weight: number;
      namedPhraseSupport: number;
      supportingDocumentIds: Set<string>;
    }
  >();

  const addCandidate = (
    label: string,
    labelSource: NarrativeLabelSource,
    weight: number,
    documentId?: string,
    namedSupport = 0,
  ) => {
    const normalizedLabel = normalizeNarrativeLabel(label);
    const key = canonicalNarrativeMergeKey(normalizedLabel);
    if (!key || isWeakNarrativeLabel(normalizedLabel)) {
      return;
    }

    const existing = candidateMap.get(key);
    if (existing) {
      existing.weight += weight;
      existing.namedPhraseSupport += namedSupport;
      if (documentId) {
        existing.supportingDocumentIds.add(documentId);
      }
      if (
        getNarrativeLabelQualityScore(
          normalizedLabel,
          group.documents,
          labelSource,
          existing.namedPhraseSupport,
        ) >
        getNarrativeLabelQualityScore(
          existing.label,
          group.documents,
          existing.labelSource,
          existing.namedPhraseSupport,
        )
      ) {
        existing.label = normalizedLabel;
        existing.labelSource = labelSource;
      }
      return;
    }

    candidateMap.set(key, {
      label: normalizedLabel,
      labelSource,
      weight,
      namedPhraseSupport: namedSupport,
      supportingDocumentIds: new Set(documentId ? [documentId] : []),
    });
  };

  addCandidate(group.label, group.labelSource, 28, undefined, group.namedPhraseSupport);
  addCandidate(
    phraseToLabel(group.topPhrase),
    group.labelSource,
    group.labelSource === "ai" ? 32 : 18,
    undefined,
    group.namedPhraseSupport,
  );
  (group.aliases ?? []).forEach((alias) => {
    addCandidate(
      alias,
      group.labelSource,
      group.labelSource === "ai" ? 28 : 12,
      undefined,
      group.namedPhraseSupport,
    );
  });

  group.documents.forEach((document) => {
    const discoveryWeight = documentDiscoveryWeight(document);
    extractNamedPhrases(document).forEach((phrase) => {
      addCandidate(phraseToLabel(phrase), "named_phrase", discoveryWeight * 2.2, document.id, 1);
    });
    buildCandidatePhrases(document)
      .slice(0, 6)
      .forEach((phrase) => {
        addCandidate(phraseToLabel(phrase), "phrase", discoveryWeight, document.id);
      });
  });

  const dominantNamedPhrase = coherenceContext.dominantNamedPhrase;
  if (dominantNamedPhrase) {
    addCandidate(
      dominantNamedPhrase.label,
      "named_phrase",
      dominantNamedPhrase.totalWeight + dominantNamedPhrase.support * 24,
      undefined,
      dominantNamedPhrase.support,
    );
  }

  const resolvedCandidates = [...candidateMap.values()]
    .map((candidate) => ({
      ...candidate,
      coherenceScore: getTopicGroupCoherenceScore(candidate.label, group.documents, coherenceContext),
      labelQualityScore:
        getNarrativeLabelQualityScore(
          candidate.label,
          group.documents,
          candidate.labelSource,
          candidate.namedPhraseSupport,
        ) +
        round1(candidate.weight) +
        candidate.supportingDocumentIds.size * 8,
    }))
    .sort((left, right) => {
      if (right.coherenceScore !== left.coherenceScore) {
        return right.coherenceScore - left.coherenceScore;
      }

      if (right.labelQualityScore !== left.labelQualityScore) {
        return right.labelQualityScore - left.labelQualityScore;
      }

      return right.supportingDocumentIds.size - left.supportingDocumentIds.size;
    });
  const best = resolvedCandidates[0];

  if (!best) {
    return null;
  }

  const expandedBest =
    resolvedCandidates.find((candidate) => {
      if (candidate.label === best.label) {
        return false;
      }

      return (
        candidate.label.toLowerCase().includes(best.label.toLowerCase()) &&
        getNarrativeInformativeTokens(candidate.label).length >
          getNarrativeInformativeTokens(best.label).length &&
        candidate.coherenceScore >= best.coherenceScore - 8 &&
        candidate.labelQualityScore >= best.labelQualityScore - 6
      );
    }) ?? best;

  const descriptiveAlternative =
    isFragmentLikeNarrativeLabel(expandedBest.label)
      ? resolvedCandidates.find((candidate) => {
          if (candidate.label === expandedBest.label) {
            return false;
          }

          return (
            !isFragmentLikeNarrativeLabel(candidate.label) &&
            getNarrativeInformativeTokens(candidate.label).length >=
              getNarrativeInformativeTokens(expandedBest.label).length &&
            candidate.coherenceScore >= expandedBest.coherenceScore - 10 &&
            candidate.labelQualityScore >= expandedBest.labelQualityScore - 18
          );
        }) ?? null
      : null;
  const strengthenedBest = descriptiveAlternative ?? expandedBest;

  const bestHasWeakTokens = getNarrativeLabelTokens(strengthenedBest.label).some(
    (token) => WEAK_LABEL_TOKENS.has(token) || STOP_WORDS.has(token),
  );
  const strengthenedBestFullMatches = countNarrativeLabelMatches(strengthenedBest.label, group.documents);
  const strengthenedBestPartialMatches = countNarrativePartialMatches(
    strengthenedBest.label,
    group.documents,
  );
  const preferredBest =
    dominantNamedPhrase &&
    dominantNamedPhrase.support >= 2 &&
    (
      dominantNamedPhrase.support >= Math.max(2, Math.ceil(group.documents.length * 0.5)) ||
      strengthenedBest.labelSource !== "named_phrase" ||
      bestHasWeakTokens ||
      isUrlLikeNarrativeLabel(strengthenedBest.label) ||
      strengthenedBestFullMatches === 0 ||
      strengthenedBestPartialMatches < Math.max(2, Math.ceil(group.documents.length * 0.5))
    ) &&
    dominantNamedPhrase.qualityScore >= strengthenedBest.labelQualityScore - 18
      ? {
          ...strengthenedBest,
          label: dominantNamedPhrase.label,
          labelSource: "named_phrase" as const,
          labelQualityScore: Math.max(
            strengthenedBest.labelQualityScore,
            dominantNamedPhrase.qualityScore + dominantNamedPhrase.totalWeight,
          ),
          namedPhraseSupport: dominantNamedPhrase.support,
          coherenceScore: getTopicGroupCoherenceScore(
            dominantNamedPhrase.label,
            group.documents,
            coherenceContext,
          ),
        }
      : strengthenedBest;

  const isTelegramOnlyGroup = isTelegramOnlyDocumentSet(group.documents);
  const minimumScore =
    preferredBest.labelSource === "fallback"
      ? isTelegramOnlyGroup
        ? 60
        : 76
      : isTelegramOnlyGroup
        ? 42
        : 48;
  const minimumCoherence = isTelegramOnlyGroup
    ? group.documents.length <= 2
      ? 22
      : group.documents.length <= 4
        ? 18
        : 14
    : group.documents.length <= 2
      ? 34
      : group.documents.length <= 4
        ? 28
        : 24;
  if (
    preferredBest.labelQualityScore < minimumScore ||
    preferredBest.coherenceScore < minimumCoherence
  ) {
    return null;
  }

  const aliases = dedupeStrings(
    resolvedCandidates
      .filter((candidate) => candidate.labelQualityScore >= preferredBest.labelQualityScore - 10)
      .slice(0, 5)
      .map((candidate) => candidate.label),
  ).filter(
    (alias) =>
      alias.toLowerCase() !== preferredBest.label.toLowerCase() &&
      !isGenericPlatformNarrativeLabel(alias),
  );

  return {
    label: preferredBest.label,
    aliases,
    labelSource: preferredBest.labelSource,
    labelQualityScore: round1(preferredBest.labelQualityScore),
    namedPhraseSupport: preferredBest.namedPhraseSupport,
  };
}

function finalizeTopicGroups(topicGroups: TopicGroup[]) {
  const groupedByNarrative = new Map<
    string,
    Array<{
      group: TopicGroup;
      resolved: ResolvedTopicLabel;
    }>
  >();

  topicGroups.forEach((group) => {
    const resolved = resolveTopicGroupLabel(group);
    if (!resolved) {
      return;
    }

    const mergeKey =
      isTelegramOnlyDocumentSet(group.documents) && group.key.startsWith("telegram-trend:")
        ? group.key
        : canonicalNarrativeMergeKey(resolved.label, resolved.aliases);
    if (!mergeKey) {
      return;
    }

    const existing = groupedByNarrative.get(mergeKey);
    if (existing) {
      existing.push({ group, resolved });
      return;
    }

    groupedByNarrative.set(mergeKey, [{ group, resolved }]);
  });

  const finalizedGroups = [...groupedByNarrative.entries()]
    .map(([mergeKey, entries]) => {
      const best = [...entries].sort(
        (left, right) => right.resolved.labelQualityScore - left.resolved.labelQualityScore,
      )[0];
      const documents = dedupeById(entries.flatMap((entry) => entry.group.documents));
      const comments = dedupeById(entries.flatMap((entry) => entry.group.comments));
      const aliases = dedupeStrings(
        entries.flatMap((entry) => [
          entry.group.label,
          entry.group.topPhrase,
          ...(entry.group.aliases ?? []),
          entry.resolved.label,
          ...entry.resolved.aliases,
        ]),
      ).filter(
        (alias) =>
          alias.toLowerCase() !== best.resolved.label.toLowerCase() &&
          !isGenericPlatformNarrativeLabel(alias),
      );
      const summary =
        entries
          .map((entry) => entry.group.summary?.trim())
          .filter((value): value is string => Boolean(value))
          .sort((left, right) => right.length - left.length)[0] ?? undefined;

      return createTopicGroup(
        mergeKey,
        best.resolved.label,
        documents,
        comments,
        summary,
        aliases,
        best.resolved.label,
        {
          labelSource: best.resolved.labelSource,
          labelQualityScore: best.resolved.labelQualityScore,
          namedPhraseSupport: Math.max(
            ...entries.map((entry) => entry.resolved.namedPhraseSupport),
            0,
          ),
        },
      );
    })
    .filter((group) => {
      return (
        hasTopicGroupSupport(group) &&
        group.labelQualityScore >= getFinalizedTopicGroupMinimumLabelScore(group)
      );
    })
    .sort((left, right) => {
      if (right.comments.length !== left.comments.length) {
        return right.comments.length - left.comments.length;
      }

      return right.documents.length - left.documents.length;
    });

  if (finalizedGroups.length > 0) {
    return finalizedGroups;
  }

  return topicGroups
    .filter((group) => {
      if (group.labelSource !== "ai") {
        return false;
      }

      if (!hasTopicGroupSupport(group) || isWeakNarrativeLabel(group.label)) {
        return false;
      }

      return getNarrativeLabelQualityScore(
        group.label,
        group.documents,
        "ai",
        group.namedPhraseSupport,
      ) >= 36;
    })
    .map((group) =>
      createTopicGroup(
        group.key,
        group.label,
        group.documents,
        group.comments,
        group.summary,
        (group.aliases ?? []).filter((alias) => !isWeakNarrativeLabel(alias)),
        group.label,
        {
          labelSource: "ai",
          labelQualityScore: getNarrativeLabelQualityScore(
            group.label,
            group.documents,
            "ai",
            group.namedPhraseSupport,
          ),
          namedPhraseSupport: group.namedPhraseSupport,
        },
      ),
    )
    .sort((left, right) => {
      if (right.comments.length !== left.comments.length) {
        return right.comments.length - left.comments.length;
      }

      return right.documents.length - left.documents.length;
    });
}

function buildRedditCommentDocuments(
  comments: RedditNormalizedComment[],
  posts: RedditNormalizedPost[],
): TrendDocument[] {
  const postById = new Map(posts.map((post) => [post.id, post] as const));

  return comments.map((comment) => {
    const parent = postById.get(comment.postId);
    const interactionCounts = getCommentInteractionCounts(comment);
    const title =
      parent?.title ??
      (comment.body
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180) ||
        "Reddit comment");

    return {
      id: `reddit-comment:${comment.id}`,
      platformId: "reddit",
      documentKind: "comment",
      rootDocumentId: comment.postId,
      parentDocumentId: comment.parentId || comment.postId,
      sourceKey: comment.subreddit.toLowerCase(),
      sourceLabel: `r/${comment.subreddit}`,
      title,
      body: `${parent?.title ?? ""} ${comment.body}`.trim(),
      author: comment.author,
      url: parent?.url || `https://reddit.com${comment.permalink}`,
      createdUtc: comment.createdUtc,
      fetchedAt: comment.fetchedAt,
      score: comment.score,
      interactionCounts,
      interactionCount: getCommentInteractionScore(comment),
      narrativeInteractionCount: round1(getCommentInteractionScore(comment) * 0.9),
    } satisfies TrendDocument;
  });
}

function getEmergingCandidatePhrases(document: TrendDocument) {
  if (document.clusterLabel?.trim()) {
    return [document.clusterLabel.trim()];
  }

  const phrases = buildCandidatePhrases(document);
  if (phrases.length > 0) {
    return phrases.slice(0, 6);
  }

  const fallbackTokens = tokenize(document)
    .map((token) => normalizeClusterToken(token))
    .filter(isInformativeToken)
    .slice(0, 4);

  return fallbackTokens.length >= 2 ? [fallbackTokens.join(" ")] : [];
}

function getEmergingTopicGroupMinimumLabelScore(group: Pick<TopicGroup, "documents" | "labelSource">) {
  const singleDocument = group.documents.length <= 1;
  if (group.labelSource === "fallback") {
    return singleDocument ? 54 : 46;
  }

  return singleDocument ? 36 : 30;
}

function buildEmergingPhraseStats(documents: TrendDocument[]) {
  const stats = new Map<string, PhraseStat>();

  documents.forEach((document) => {
    const phrases = new Set(getEmergingCandidatePhrases(document));
    const namedPhraseKeys = new Set(
      extractNamedPhrases(document)
        .map((phrase) => canonicalPhraseKey(phrase))
        .filter(Boolean),
    );
    const discoveryWeight =
      documentDiscoveryWeight(document) *
      (document.documentKind === "comment" ? 1.2 : 1) *
      (document.documentKind === "delta" ? 1.08 : 1);

    phrases.forEach((phrase) => {
      const phraseKey = canonicalPhraseKey(phrase);
      if (!phraseKey) {
        return;
      }

      const key = `${document.platformId}:${phraseKey}`;
      const label = phraseToLabel(phrase);
      const existing = stats.get(key);
      if (existing) {
        existing.score += discoveryWeight;
        existing.documentIds.add(document.id);
        existing.rootDocumentIds.add(document.rootDocumentId ?? document.id);
        existing.authorIds.add(document.authorId ?? document.authorHandle ?? document.author);
        existing.sourceCounts.set(
          document.sourceKey,
          (existing.sourceCounts.get(document.sourceKey) ?? 0) + 1,
        );
        existing.labelScores.set(label, (existing.labelScores.get(label) ?? 0) + discoveryWeight);
        if (namedPhraseKeys.has(phraseKey)) {
          existing.namedPhraseSupport += 1;
        }
        return;
      }

      stats.set(key, {
        key,
        label,
        score: discoveryWeight,
        documentIds: new Set([document.id]),
        rootDocumentIds: new Set([document.rootDocumentId ?? document.id]),
        authorIds: new Set([document.authorId ?? document.authorHandle ?? document.author]),
        sourceCounts: new Map([[document.sourceKey, 1]]),
        labelScores: new Map([[label, discoveryWeight]]),
        namedPhraseSupport: namedPhraseKeys.has(phraseKey) ? 1 : 0,
      });
    });
  });

  return [...stats.values()].map((stat) => ({
    ...stat,
    label:
      [...stat.labelScores.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
      stat.label,
    score:
      stat.score +
      stat.documentIds.size * 24 +
      stat.rootDocumentIds.size * 14 +
      stat.authorIds.size * 14 +
      stat.sourceCounts.size * 10 +
      stat.namedPhraseSupport * 18 +
      Math.min(60, stat.label.split(" ").length * 10),
  }));
}

function buildEmergingTopicGroups(documents: TrendDocument[]) {
  const phraseStats = buildEmergingPhraseStats(documents);
  const phraseStatsMap = new Map(phraseStats.map((stat) => [stat.key, stat]));
  const grouped = new Map<string, TopicGroup>();

  documents.forEach((document) => {
    if (document.clusterKey && document.clusterLabel) {
      const key = `${document.platformId}:${document.clusterKey}`;
      const existingCluster = grouped.get(key);
      if (existingCluster) {
        existingCluster.documents.push(document);
        return;
      }

      grouped.set(key, {
        key,
        label: document.clusterLabel,
        documents: [document],
        comments: [],
        topPhrase: document.clusterLabel,
        themeId: "",
        themeLabel: "",
        isMeme: false,
        labelSource: "ai",
        labelQualityScore: 0,
        sourceDiversity: 1,
        namedPhraseSupport: 0,
      });
      return;
    }

    const winningPhrase = getEmergingCandidatePhrases(document)
      .map((phrase) => ({
        phrase,
        key: `${document.platformId}:${canonicalPhraseKey(phrase)}`,
      }))
      .filter((entry) => entry.key && phraseStatsMap.has(entry.key))
      .sort(
        (left, right) =>
          (phraseStatsMap.get(right.key)?.score ?? 0) - (phraseStatsMap.get(left.key)?.score ?? 0),
      )[0];

    if (!winningPhrase) {
      return;
    }

    const stat = phraseStatsMap.get(winningPhrase.key);
    const label = stat?.label ?? phraseToLabel(winningPhrase.phrase);
    const existing = grouped.get(winningPhrase.key);
    if (existing) {
      existing.documents.push(document);
      return;
    }

    grouped.set(winningPhrase.key, {
      key: winningPhrase.key,
      label,
      documents: [document],
      comments: [],
      topPhrase: winningPhrase.phrase,
      themeId: "",
      themeLabel: "",
      isMeme: false,
      labelSource: (stat?.namedPhraseSupport ?? 0) > 0 ? "named_phrase" : "phrase",
      labelQualityScore: 0,
      sourceDiversity: 1,
      namedPhraseSupport: stat?.namedPhraseSupport ?? 0,
    });
  });

  return [...grouped.values()]
    .map((group) =>
      createTopicGroup(
        group.key,
        group.label,
        group.documents,
        [],
        group.summary,
        group.aliases,
        group.topPhrase,
        {
          labelSource: group.labelSource,
          labelQualityScore: group.labelQualityScore,
          namedPhraseSupport: group.namedPhraseSupport,
        },
      ),
    )
    .filter((group) => {
      const maxInteraction = Math.max(...group.documents.map((document) => document.interactionCount), 0);
      const uniqueAuthors = countUniqueDocumentAuthors(group.documents);
      return (
        passesNarrativeQualityGate(group, { emerging: true }) &&
        group.labelQualityScore >= getEmergingTopicGroupMinimumLabelScore(group) &&
        (group.documents.length >= 2 || uniqueAuthors >= 2 || maxInteraction >= 18)
      );
    })
    .sort((left, right) => {
      const leftMax = Math.max(...left.documents.map((document) => document.interactionCount), 0);
      const rightMax = Math.max(...right.documents.map((document) => document.interactionCount), 0);
      if (rightMax !== leftMax) {
        return rightMax - leftMax;
      }

      return right.documents.length - left.documents.length;
    });
}

function mergeEmergingTopicGroups(topicGroups: TopicGroup[]) {
  const groupedByNarrative = new Map<string, TopicGroup[]>();

  topicGroups.forEach((group) => {
    const mergeKey =
      isTelegramOnlyDocumentSet(group.documents) && group.key.startsWith("telegram-trend:")
        ? group.key
        : canonicalNarrativeMergeKey(group.label, group.aliases);
    if (!mergeKey) {
      return;
    }

    const existing = groupedByNarrative.get(mergeKey);
    if (existing) {
      existing.push(group);
      return;
    }

    groupedByNarrative.set(mergeKey, [group]);
  });

  return [...groupedByNarrative.entries()]
    .map(([mergeKey, groups]) => {
      const best = [...groups].sort((left, right) => right.labelQualityScore - left.labelQualityScore)[0];
      const documents = dedupeById(groups.flatMap((group) => group.documents));
      const aliases = dedupeStrings(groups.flatMap((group) => [group.label, ...(group.aliases ?? [])]));

      return createTopicGroup(
        mergeKey,
        best.label,
        documents,
        [],
        groups
          .map((group) => group.summary?.trim())
          .filter((value): value is string => Boolean(value))
          .sort((left, right) => right.length - left.length)[0],
        aliases.filter((alias) => alias.toLowerCase() !== best.label.toLowerCase()),
        best.topPhrase,
        {
          labelSource: best.labelSource,
          labelQualityScore: best.labelQualityScore,
          namedPhraseSupport: Math.max(...groups.map((group) => group.namedPhraseSupport), 0),
        },
      );
    })
    .filter((group) => group.labelQualityScore >= getEmergingTopicGroupMinimumLabelScore(group));
}

function buildAiMergeCandidates(topicGroups: TopicGroup[], referenceTime: Date) {
  return topicGroups
    .filter((group) => !isTelegramOnlyDocumentSet(group.documents))
    .map((group) => {
    const firstSeenUtc = Math.min(...group.documents.map((document) => document.createdUtc));
    const lastSeenUtc = Math.max(...group.documents.map((document) => document.createdUtc));

    return {
      id: group.key,
      label: group.label,
      labelSource: group.labelSource,
      labelQualityScore: group.labelQualityScore,
      keywords: [...new Set(group.topPhrase.split(" ").filter(Boolean))],
      topAliases: (group.aliases ?? []).slice(0, 5),
      sampleTitles: group.documents.slice(0, 4).map((document) => document.title),
      supportingSignalCount: getPrimaryDocumentCount(group.documents),
      commentCount: group.comments.length + getCommentDocumentCount(group.documents),
      sourceDiversity: group.sourceDiversity,
      namedPhraseSupport: group.namedPhraseSupport,
      firstSeenAt: new Date(firstSeenUtc * 1000).toISOString(),
      lastSeenAt: new Date(lastSeenUtc * 1000).toISOString(),
      platforms: [...new Set(group.documents.map((document) => document.platformId))],
      sourceLabels: [...new Set(group.documents.map((document) => document.sourceLabel))],
      referenceWindowEnd: referenceTime.toISOString(),
      documents: group.documents.map((document) => ({
        id: document.id,
        candidateId: group.key,
        title: document.title,
        excerpt: document.body.replace(/\s+/g, " ").trim().slice(0, 220),
        platformId: document.platformId,
        sourceLabel: document.sourceLabel,
        interactionCount: document.interactionCount,
        createdAt: new Date(document.createdUtc * 1000).toISOString(),
      })),
    };
    });
}

function getExhaustiveBlueskyNarrativeGroupWeight(group: ExhaustiveBlueskyTrendGroup) {
  return Math.max(1, group.totalInteractions24h + group.rootIds.length * 2);
}

function getDominantExhaustiveBlueskyNarrativeValue(
  groups: ExhaustiveBlueskyTrendGroup[],
  selector: (group: ExhaustiveBlueskyTrendGroup) => string | null,
) {
  const votes = new Map<string, number>();
  groups.forEach((group) => {
    const value = selector(group);
    if (!value) {
      return;
    }
    votes.set(value, (votes.get(value) ?? 0) + getExhaustiveBlueskyNarrativeGroupWeight(group));
  });

  return [...votes.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function getExhaustiveBlueskySingleAuthorShare(
  documents: TrendDocument[],
  posts: BlueskyNormalizedPost[],
  interactions: BlueskyInteraction[],
) {
  const authorWeights = new Map<string, number>();
  const addWeight = (authorId: string | null | undefined, weight: number) => {
    if (!authorId || weight <= 0) {
      return;
    }
    authorWeights.set(authorId, (authorWeights.get(authorId) ?? 0) + weight);
  };

  posts.forEach((post) => {
    addWeight(
      post.authorDid ?? post.authorHandle ?? null,
      1 + getRawInteractionCount(post.interactionCounts),
    );
  });
  interactions.forEach((interaction) => {
    addWeight(interaction.actorDid ?? interaction.actorHandle ?? null, 1);
  });
  documents
    .filter((document) => document.documentKind !== "delta")
    .forEach((document) => {
      addWeight(
        document.authorId ?? document.authorHandle ?? document.author ?? null,
        Math.max(1, document.interactionCount),
      );
    });

  const totalWeight = [...authorWeights.values()].reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) {
    return 0;
  }

  const dominantAuthorWeight = [...authorWeights.values()].sort((left, right) => right - left)[0] ?? 0;
  return dominantAuthorWeight / totalWeight;
}

function buildExhaustiveBlueskyGroupRankingProfile(params: {
  label: string;
  labelQualityScore: number;
  labelType: TrendLabelType;
  groupingSource: TrendGroupingSource;
  rootCount: number;
  totalInteractions24h: number;
  spamLikelihood: number;
  templateLikelihood: number;
  contextualCoherence: number;
  lowInformation: boolean;
  uniqueAuthors24h: number;
  singleAuthorShare: number;
  templateSeriesHint?: boolean;
}) {
  const labelTokens = getNarrativeInformativeTokens(params.label);
  const alphabeticTokenCount = labelTokens.filter((token) => /[a-z]/i.test(token)).length;
  const numericishTokenCount = labelTokens.filter((token) => /\d/.test(token)).length;
  const lowQualityLabel =
    params.labelQualityScore < 44 ||
    isFragmentLikeNarrativeLabel(params.label) ||
    alphabeticTokenCount === 0 ||
    (numericishTokenCount > 0 && alphabeticTokenCount <= 1);
  const fallbackGenerated =
    params.labelType === "fallback_generated" || params.groupingSource === "fallback_singleton";
  const templateSeries =
    Boolean(params.templateSeriesHint) ||
    params.groupingSource === "template_anchor" ||
    params.templateLikelihood >= 0.68 ||
    (params.singleAuthorShare >= 0.82 && params.rootCount >= 2);
  const groupedBoost =
    params.rootCount > 1
      ? 1.12 + Math.min(0.58, Math.log2(params.rootCount + 1) * 0.22 + params.contextualCoherence * 0.12)
      : params.lowInformation
        ? 0.26
        : params.groupingSource === "canonical_url_anchor"
          ? 0.24
          : params.groupingSource === "singleton_ai"
            ? 0.42
            : fallbackGenerated || lowQualityLabel
              ? 0.38
              : 0.58;
  const qualityAdjustedScore = round1(
    Math.max(
      0,
      params.totalInteractions24h *
        (1 -
          Math.min(
            0.74,
            params.spamLikelihood * 0.45 +
              params.templateLikelihood * 0.28 +
              (params.lowInformation ? 0.26 : 0) +
              (params.singleAuthorShare >= 0.88 ? 0.2 : params.singleAuthorShare >= 0.72 ? 0.08 : 0),
          )) *
        groupedBoost,
    ),
  );
  const leaderboardTier = getBlueskyLeaderboardTier({
    rootCount: params.rootCount,
    lowInformation: params.lowInformation,
    templateSeries,
    spamLikelihood: params.spamLikelihood,
    fallbackGenerated,
    lowQualityLabel,
    groupingSource: params.groupingSource,
    totalInteractions24h: params.totalInteractions24h,
    qualityAdjustedScore,
    uniqueAuthors24h: params.uniqueAuthors24h,
    singleAuthorShare: params.singleAuthorShare,
  });

  return {
    fallbackGenerated,
    lowQualityLabel,
    templateSeries,
    qualityAdjustedScore,
    leaderboardTier,
  };
}

async function resolveExhaustiveBlueskyNarrativesWithAi(
  groups: ExhaustiveBlueskyTrendGroup[],
  referenceTime: Date,
): Promise<ResolvedNarratives> {
  const candidateGroups = groups.filter((group) => group.rootIds.length > 1);
  if (
    candidateGroups.length === 0 ||
    !process.env.OPENAI_API_KEY ||
    (!isAiBlueskyGroupingEnabled() && !isAiTrendMergeEnabled())
  ) {
    return null;
  }

  const candidates = buildAiMergeCandidates(candidateGroups.map((group) => group.group), referenceTime);
  if (candidates.length === 0) {
    return null;
  }

  try {
    const { resolveNarrativeClusters } = await import("@/lib/narratives/ai-clustering");
    return await Promise.race([
      resolveNarrativeClusters(candidates, referenceTime.toISOString(), {
        blocking: true,
      }),
      new Promise<ResolvedNarratives>((resolve) => {
        setTimeout(() => resolve(null), AI_EXHAUSTIVE_BLUESKY_NARRATIVE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.warn("[analytics] exhaustive Bluesky narrative resolution failed", {
      error: error instanceof Error ? error.message : String(error),
      candidateCount: candidates.length,
    });
    return null;
  }
}

function mergeExhaustiveBlueskyGroupsWithAi(
  groups: ExhaustiveBlueskyTrendGroup[],
  narratives: ResolvedNarratives,
) {
  if (!narratives) {
    return groups;
  }

  const groupById = new Map(
    groups
      .filter((group) => group.rootIds.length > 1)
      .map((group) => [group.group.key, group] as const),
  );
  const claimedGroupIds = new Set<string>();
  const ignoredGroupIds = new Set(narratives.ignoredCandidateIds);
  const mergedGroups: ExhaustiveBlueskyTrendGroup[] = [];

  narratives.narratives.forEach((narrative) => {
    const candidateGroups = [...new Set(narrative.candidateIds)]
      .map((candidateId) => groupById.get(candidateId))
      .filter((group): group is ExhaustiveBlueskyTrendGroup => Boolean(group))
      .filter((group) => !claimedGroupIds.has(group.group.key));
    if (candidateGroups.length === 0) {
      return;
    }

    candidateGroups.forEach((group) => claimedGroupIds.add(group.group.key));
    const documents = dedupeById(candidateGroups.flatMap((group) => group.group.documents));
    const posts = dedupeById(candidateGroups.flatMap((group) => group.posts));
    const interactions = dedupeById(candidateGroups.flatMap((group) => group.interactions));
    const snapshots = dedupeById(candidateGroups.flatMap((group) => group.snapshots));
    const rootIds = [...new Set(candidateGroups.flatMap((group) => group.rootIds))];
    const uniqueAuthors24h = new Set(
      [
        ...posts.map((post) => post.authorDid ?? post.authorHandle ?? ""),
        ...interactions.map((interaction) => interaction.actorDid ?? interaction.actorHandle ?? ""),
        ...documents.map((document) => document.authorId ?? document.authorHandle ?? document.author ?? ""),
      ].filter(Boolean),
    ).size;
    const totalInteractions24h = candidateGroups.reduce(
      (sum, group) => sum + group.totalInteractions24h,
      0,
    );
    const totalSnapshotDelta24h = candidateGroups.reduce(
      (sum, group) => sum + group.totalSnapshotDelta24h,
      0,
    );
    const firstSeenAt =
      candidateGroups
        .map((group) => group.firstSeenAt)
        .filter((value): value is string => Boolean(value))
        .sort()[0] ?? null;
    const lastSeenAt =
      candidateGroups
        .map((group) => group.lastSeenAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
    const namedPhraseSupport = Math.max(...candidateGroups.map((group) => group.group.namedPhraseSupport), 0);
    const narrativeAliases = dedupeStrings(
      [
        ...(narrative.aliases ?? []),
        ...candidateGroups.flatMap((group) => [group.group.label, ...(group.group.aliases ?? [])]),
      ].filter((alias) => !isGenericPlatformNarrativeLabel(alias)),
    ).filter((alias) => alias.toLowerCase() !== narrative.label.toLowerCase());
    const labelQualityScore = getNarrativeLabelQualityScore(
      narrative.label,
      documents,
      "ai",
      namedPhraseSupport,
    );
    const singleAuthorShare = getExhaustiveBlueskySingleAuthorShare(documents, posts, interactions);
    const weightTotal = candidateGroups.reduce(
      (sum, group) => sum + getExhaustiveBlueskyNarrativeGroupWeight(group),
      0,
    );
    const weightedAverage = (selector: (group: ExhaustiveBlueskyTrendGroup) => number) =>
      weightTotal > 0
        ? candidateGroups.reduce(
            (sum, group) => sum + selector(group) * getExhaustiveBlueskyNarrativeGroupWeight(group),
            0,
          ) / weightTotal
        : 0;
    const lowInformation =
      weightTotal > 0 &&
      candidateGroups.reduce(
        (sum, group) =>
          sum + (group.lowInformation ? getExhaustiveBlueskyNarrativeGroupWeight(group) : 0),
        0,
      ) /
        weightTotal >=
        0.5;
    const spamLikelihood = weightedAverage((group) => group.spamLikelihood);
    const templateLikelihood = weightedAverage((group) => group.templateLikelihood);
    const contextualCoherence = weightedAverage((group) => group.contextualCoherence);
    const templateSeries = candidateGroups.some((group) => group.templateSeries);
    const rankingProfile = buildExhaustiveBlueskyGroupRankingProfile({
      label: narrative.label,
      labelQualityScore,
      labelType: "ai_generated",
      groupingSource: "ai_semantic_cluster",
      rootCount: rootIds.length,
      totalInteractions24h,
      spamLikelihood,
      templateLikelihood,
      contextualCoherence,
      lowInformation,
      uniqueAuthors24h,
      singleAuthorShare,
      templateSeriesHint: templateSeries,
    });

    mergedGroups.push({
      group: createTopicGroup(
        narrative.id,
        narrative.label,
        documents,
        [],
        narrative.summary,
        narrativeAliases,
        narrative.label,
        {
          labelSource: "ai",
          labelQualityScore,
          namedPhraseSupport,
        },
      ),
      rootIds,
      posts,
      interactions,
      snapshots,
      groupingSource: "ai_semantic_cluster",
      leaderboardTier: rankingProfile.leaderboardTier,
      labelType: "ai_generated",
      canonicalKeySummary: narrative.id,
      fallbackGenerated: rankingProfile.fallbackGenerated,
      lowQualityLabel: rankingProfile.lowQualityLabel,
      totalInteractions24h,
      totalSnapshotDelta24h,
      uniqueAuthors24h,
      firstSeenAt,
      lastSeenAt,
      aiAssisted: true,
      aiLabel: narrative.label,
      trendDescription: narrative.summary,
      qualityAdjustedScore: rankingProfile.qualityAdjustedScore,
      singleAuthorShare,
      trendCategory: getDominantExhaustiveBlueskyNarrativeValue(
        candidateGroups,
        (group) => group.trendCategory,
      ),
      contentType: getDominantExhaustiveBlueskyNarrativeValue(
        candidateGroups,
        (group) => group.contentType,
      ),
      spamLikelihood: round1(spamLikelihood * 100) / 100,
      templateLikelihood: round1(templateLikelihood * 100) / 100,
      contextualCoherence: round1(contextualCoherence * 100) / 100,
      lowInformation,
      templateSeries: rankingProfile.templateSeries,
    });
  });

  groups.forEach((group) => {
    if (
      group.rootIds.length > 1 &&
      (claimedGroupIds.has(group.group.key) || ignoredGroupIds.has(group.group.key))
    ) {
      return;
    }

    mergedGroups.push(group);
  });

  return mergedGroups;
}

function mergeTopicGroupsWithAi(
  topicGroups: TopicGroup[],
  comments: RedditNormalizedComment[],
  narratives: ResolvedNarratives,
) {
  if (!narratives) {
    return topicGroups;
  }

  const groupById = new Map(topicGroups.map((group) => [group.key, group]));
  const documentById = new Map(
    topicGroups.flatMap((group) => group.documents.map((document) => [document.id, document] as const)),
  );
  const commentsByPost = new Map<string, RedditNormalizedComment[]>();
  comments.forEach((comment) => {
    const existing = commentsByPost.get(comment.postId);
    if (existing) {
      existing.push(comment);
      return;
    }

    commentsByPost.set(comment.postId, [comment]);
  });
  const claimedDocumentIds = new Set<string>();
  const ignoredCandidateIds = new Set(narratives.ignoredCandidateIds);
  const mergedGroups: TopicGroup[] = [];

  narratives.narratives.forEach((narrative) => {
    const narrativeAliases = dedupeStrings(
      (narrative.aliases ?? []).filter((alias) => !isGenericPlatformNarrativeLabel(alias)),
    );
    const directDocuments = [...new Set(narrative.documentIds)]
      .map((documentId) => documentById.get(documentId))
      .filter((document): document is TrendDocument => Boolean(document))
      .filter((document) => !claimedDocumentIds.has(document.id));
    const candidateDocuments =
      directDocuments.length > 0
        ? directDocuments
        : [...new Set(narrative.candidateIds)]
            .map((candidateId) => groupById.get(candidateId))
            .filter((group): group is TopicGroup => Boolean(group))
            .flatMap((group) => group.documents)
            .filter((document) => !claimedDocumentIds.has(document.id));

    if (candidateDocuments.length === 0) {
      return;
    }

    candidateDocuments.forEach((document) => claimedDocumentIds.add(document.id));
    mergedGroups.push(
      createTopicGroup(
        narrative.id,
        narrative.label,
        candidateDocuments,
        candidateDocuments.flatMap((document) => commentsByPost.get(document.id) ?? []),
        narrative.summary,
        narrativeAliases,
        narrative.label,
        {
          labelSource: "ai",
        },
      ),
    );
  });

  topicGroups.forEach((group) => {
    if (ignoredCandidateIds.has(group.key)) {
      return;
    }

    const remainingDocuments = group.documents.filter((document) => !claimedDocumentIds.has(document.id));
    if (remainingDocuments.length === 0) {
      return;
    }

    mergedGroups.push(
      createTopicGroup(
        group.key,
        group.label,
        remainingDocuments,
        remainingDocuments.flatMap((document) => commentsByPost.get(document.id) ?? []),
        group.summary,
        group.aliases,
        group.topPhrase,
        {
          labelSource: group.labelSource,
          labelQualityScore: group.labelQualityScore,
          namedPhraseSupport: group.namedPhraseSupport,
        },
      ),
    );
  });

  return mergedGroups.sort((left, right) => {
    if (right.comments.length !== left.comments.length) {
      return right.comments.length - left.comments.length;
    }

    return right.documents.length - left.documents.length;
  });
}

function mergeSeries(base: TimeSeriesPoint[], overlay: TimeSeriesPoint[]) {
  return base.map((point, index) => ({
    timestamp: point.timestamp,
    value: round1(point.value + (overlay[index]?.value ?? 0)),
  }));
}

function isAiTrendMergeEnabled() {
  const value = (process.env.OPENAI_TREND_MERGE_ENABLED ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function isAiBlueskyGroupingEnabled() {
  const value = (process.env.OPENAI_TREND_GROUPING_ENABLED ?? "").trim().toLowerCase();
  if (!value) {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function documentBucketWeight(document: TrendDocument) {
  return Math.max(0, document.interactionCount);
}

function buildPlatformBreakdown(group: TopicGroup) {
  const counts = new Map<PlatformId, number>();

  group.documents.forEach((document) => {
    counts.set(
      document.platformId,
      (counts.get(document.platformId) ?? 0) + documentBucketWeight(document),
    );
  });
  if (group.comments.length > 0) {
    counts.set(
      "reddit",
      (counts.get("reddit") ?? 0) +
        group.comments.reduce((sum, comment) => sum + getCommentInteractionScore(comment), 0),
    );
  }

  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return [];
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([platformId, interactions]) => ({
      platformId,
      interactions,
      sharePct: round1((interactions / total) * 100),
    }));
}

function buildPlatformMigrationPath(group: TopicGroup) {
  const byPlatform = new Map<
    PlatformId,
    {
      firstSeenUtc: number;
      weight: number;
    }
  >();

  group.documents.forEach((document) => {
    const existing = byPlatform.get(document.platformId);
    if (existing) {
      existing.firstSeenUtc = Math.min(existing.firstSeenUtc, document.createdUtc);
      existing.weight += documentBucketWeight(document);
      return;
    }

    byPlatform.set(document.platformId, {
      firstSeenUtc: document.createdUtc,
      weight: documentBucketWeight(document),
    });
  });

  return [...byPlatform.entries()]
    .sort((left, right) => {
      if (left[1].firstSeenUtc !== right[1].firstSeenUtc) {
        return left[1].firstSeenUtc - right[1].firstSeenUtc;
      }

      return right[1].weight - left[1].weight;
    })
    .map(([platformId]) => platformId);
}

function countUniqueDocumentAuthors(documents: TrendDocument[], platformId?: PlatformId) {
  return new Set(
    documents
      .filter((document) => !platformId || document.platformId === platformId)
      .map((document) => document.authorId ?? document.authorHandle ?? document.author),
  ).size;
}

function countUniqueDocumentRoots(documents: TrendDocument[], platformId?: PlatformId) {
  return new Set(
    documents
      .filter((document) => !platformId || document.platformId === platformId)
      .map((document) => document.rootDocumentId ?? document.id),
  ).size;
}

function getTopRootConcentrationRatio(documents: TrendDocument[], platformId?: PlatformId) {
  const counts = new Map<string, number>();
  let total = 0;
  documents
    .filter((document) => !platformId || document.platformId === platformId)
    .forEach((document) => {
      const rootId = document.rootDocumentId ?? document.id;
      counts.set(rootId, (counts.get(rootId) ?? 0) + 1);
      total += 1;
    });

  if (total <= 0) {
    return 0;
  }

  const topRootCount = [...counts.values()].sort((left, right) => right - left)[0] ?? 0;
  return topRootCount / total;
}

function buildBlueskyTrendInsights(
  documents: TrendDocument[],
  platformBreakdown: Array<{
    platformId: PlatformId;
    interactions: number;
    sharePct: number;
  }>,
  postsByRoot: Map<string, BlueskyNormalizedPost[]>,
  interactionsByRoot: Map<string, BlueskyInteraction[]>,
  snapshotsByRoot: Map<string, BlueskyPostSnapshot[]>,
  profileByDid: Map<string, BlueskyProfile>,
  referenceTime: Date,
) {
  const blueskyDocuments = documents.filter((document) => document.platformId === "bluesky");
  if (blueskyDocuments.length === 0) {
    return null;
  }

  const rootIds = [
    ...new Set(blueskyDocuments.map((document) => document.rootDocumentId ?? document.id)),
  ];
  const relevantPosts = rootIds.flatMap((rootId) => postsByRoot.get(rootId) ?? []);
  const relevantInteractions = rootIds.flatMap((rootId) => interactionsByRoot.get(rootId) ?? []);
  const relevantSnapshots = rootIds.flatMap((rootId) => snapshotsByRoot.get(rootId) ?? []);
  const uniqueAuthorCount = countUniqueDocumentAuthors(blueskyDocuments, "bluesky");
  const uniqueRootCount = countUniqueDocumentRoots(blueskyDocuments, "bluesky");
  const topRootConcentrationPct = round1(getTopRootConcentrationRatio(blueskyDocuments, "bluesky") * 100);
  const postsOnlyCount = blueskyDocuments.filter(
    (document) => document.documentKind !== "delta" && document.documentKind !== "amplification",
  ).length;
  const normalizedAmplifiers = buildBlueskyAmplifiers({
    interactions: relevantInteractions,
    posts: relevantPosts,
  }).slice(0, 5);
  const cascadeLeaders = buildBlueskyCascadeLeaders({
    posts: relevantPosts,
    interactions: relevantInteractions,
    windowHours: Math.max(RANGE_MS["1h"] / (60 * 60 * 1000), 0.25),
  }).slice(0, 5);
  const propagationNetwork = buildBlueskyPropagationNetwork({
    interactions: relevantInteractions,
    cascades: cascadeLeaders,
    amplifiers: normalizedAmplifiers.slice(0, 4),
  });
  const totalCascadeInteractions =
    cascadeLeaders.reduce((sum, cascade) => sum + cascade.interactions, 0) || 1;
  const noiseRatioPct = round1(
    (cascadeLeaders
      .filter((cascade) => cascade.uniqueParticipants < 3 && cascade.interactions < 12)
      .reduce((sum, cascade) => sum + cascade.interactions, 0) /
      totalCascadeInteractions) *
      100,
  );

  const totalSnapshotHours = Math.max(
    relevantSnapshots.reduce((sum, snapshot) => sum + Math.max((snapshot.deltaWindowMinutes ?? 0) / 60, 0.25), 0),
    0.25,
  );
  const repostVelocity = round1(
    relevantSnapshots.reduce((sum, snapshot) => sum + (snapshot.deltaRepostCount ?? 0), 0) /
      totalSnapshotHours,
  );
  const replyVelocity = round1(
    relevantSnapshots.reduce((sum, snapshot) => sum + (snapshot.deltaCommentCount ?? 0), 0) /
      totalSnapshotHours,
  );
  const quoteVelocity = round1(
    relevantSnapshots.reduce((sum, snapshot) => sum + (snapshot.deltaQuoteCount ?? 0), 0) /
      totalSnapshotHours,
  );
  const likeVelocity = round1(
    relevantSnapshots.reduce((sum, snapshot) => sum + (snapshot.deltaLikeCount ?? 0), 0) /
      totalSnapshotHours,
  );

  const latestFetchedAt = [...relevantPosts, ...relevantInteractions]
    .map((row) => row.fetchedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const firehoseLagMinutes = latestFetchedAt
    ? Math.max(0, Math.round((referenceTime.getTime() - Date.parse(latestFetchedAt)) / 60_000))
    : null;

  let leadingSignalLabel = "Steady attention";
  if (quoteVelocity >= repostVelocity && quoteVelocity >= replyVelocity && quoteVelocity > 0) {
    leadingSignalLabel = "Quote burst";
  } else if (repostVelocity >= replyVelocity && repostVelocity > 0) {
    leadingSignalLabel = "Repost cascade";
  } else if (replyVelocity > 0) {
    leadingSignalLabel = "Reply surge";
  } else if (uniqueAuthorCount >= 6) {
    leadingSignalLabel = "Cross-account spread";
  }

  const earliestOrigin = [...relevantPosts]
    .sort((left, right) => left.createdUtc - right.createdUtc)[0];
  const sharePct = platformBreakdown.find((item) => item.platformId === "bluesky")?.sharePct ?? 0;
  const postTypeCounts = new Map<string, number>();
  relevantPosts.forEach((post) => {
    postTypeCounts.set(post.postType, (postTypeCounts.get(post.postType) ?? 0) + 1);
  });
  relevantInteractions.forEach((interaction) => {
    if (interaction.interactionType !== "repost") {
      return;
    }
    postTypeCounts.set("repost", (postTypeCounts.get("repost") ?? 0) + 1);
  });
  const postTypeTotal = [...postTypeCounts.values()].reduce((sum, count) => sum + count, 0) || 1;
  const postTypeMix = [...postTypeCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => ({
      type,
      count,
      sharePct: round1((count / postTypeTotal) * 100),
    }));

  const summary = {
    attentionSharePct: round1(sharePct),
    postCount: postsOnlyCount,
    uniqueAuthorCount,
    amplifierCount: normalizedAmplifiers.length,
    topAmplifierHandle: normalizedAmplifiers[0]?.handle ?? null,
    topAmplifier: normalizedAmplifiers[0]?.handle ?? null,
    repostVelocity,
    replyVelocity,
    quoteVelocity,
    likeVelocity,
    amplificationScore: normalizedAmplifiers.reduce(
      (sum, amplifier) => sum + amplifier.interactions,
      0,
    ),
    engagementIntensity: round1(
      postsOnlyCount * 4 + repostVelocity * 8 + replyVelocity * 9 + quoteVelocity * 10 + likeVelocity * 2,
    ),
    accountSpread: uniqueAuthorCount,
    cascadeCount: cascadeLeaders.length,
    accelerationScore: round1(repostVelocity + replyVelocity + quoteVelocity - likeVelocity * 0.2),
    narrativeCount: uniqueRootCount,
    postsPerMinute: round1(postsOnlyCount / Math.max(60, RANGE_MS["1h"] / 60_000)),
    repostsPerMinute: round1(repostVelocity / 60),
    repliesPerMinute: round1(replyVelocity / 60),
    quotesPerMinute: round1(quoteVelocity / 60),
    likesPerMinute: round1(likeVelocity / 60),
    meaningfulAttentionScore: round1(
      (repostVelocity + replyVelocity + quoteVelocity + Math.max(postsOnlyCount, 1)) *
        Math.max(1, Math.log2(uniqueAuthorCount + 1)) *
        Math.max(0.25, 1 - noiseRatioPct / 100),
    ),
    noiseRatioPct,
    leadingSignalLabel,
    firehoseLagMinutes,
  };

  return {
    summary,
    detail: {
      summary,
      topAmplifiers: normalizedAmplifiers,
      cascadeLeaders,
      engagementBreakdown: [
        { label: "Likes", count: relevantSnapshots.reduce((sum, snapshot) => sum + snapshot.likeCount, 0), velocityPerHour: likeVelocity },
        { label: "Reposts", count: relevantSnapshots.reduce((sum, snapshot) => sum + snapshot.repostCount, 0), velocityPerHour: repostVelocity },
        { label: "Replies", count: relevantSnapshots.reduce((sum, snapshot) => sum + snapshot.replyCount, 0), velocityPerHour: replyVelocity },
        { label: "Quotes", count: relevantSnapshots.reduce((sum, snapshot) => sum + snapshot.quoteCount, 0), velocityPerHour: quoteVelocity },
      ],
      postTypeMix,
      accountSpreadLabel: `${uniqueAuthorCount} authors across ${uniqueRootCount} root posts`,
      propagationSummary:
        topRootConcentrationPct >= 65
          ? `Bluesky is moving, but ${topRootConcentrationPct.toFixed(0)}% of sampled activity is still concentrated on a single root post.`
          : `Bluesky carries ${summary.attentionSharePct.toFixed(0)}% of current attention with ${uniqueAuthorCount} authors and ${normalizedAmplifiers.length} active amplifiers.`,
      noiseSummary:
        noiseRatioPct >= 45
          ? `${noiseRatioPct.toFixed(0)}% of sampled activity is still low-spread noise.`
          : `Low-spread noise is constrained to ${noiseRatioPct.toFixed(0)}% of sampled activity.`,
      meaningfulAttentionScore: summary.meaningfulAttentionScore,
      network: propagationNetwork,
      earliestOriginAt: earliestOrigin ? new Date(earliestOrigin.createdUtc * 1000).toISOString() : null,
      earliestOriginHandle: earliestOrigin?.authorHandle ?? null,
    },
  };
}

function limitBlueskyPostsForAnalytics(
  rows: BlueskyNormalizedPost[],
  queryRange: DateRangePreset,
) {
  const limit = BLUESKY_ANALYTICS_LIMITS[queryRange].posts;
  const sortedRows = [...rows]
    .sort((left, right) => {
      const leftPriority = left.priorityScore ?? 0;
      const rightPriority = right.priorityScore ?? 0;
      if (rightPriority !== leftPriority) {
        return rightPriority - leftPriority;
      }
      return right.createdUtc - left.createdUtc;
    })
    .slice(0, limit * 4);
  const rootCounts = new Map<string, number>();
  const authorCounts = new Map<string, number>();
  const selected: BlueskyNormalizedPost[] = [];

  for (const row of sortedRows) {
    const rootId = getBlueskyPostRootId(row) || row.id;
    const authorId = row.authorDid || row.authorHandle || row.id;
    if ((rootCounts.get(rootId) ?? 0) >= 2 || (authorCounts.get(authorId) ?? 0) >= 6) {
      continue;
    }

    selected.push(row);
    rootCounts.set(rootId, (rootCounts.get(rootId) ?? 0) + 1);
    authorCounts.set(authorId, (authorCounts.get(authorId) ?? 0) + 1);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function limitBlueskyInteractionsForAnalytics(
  rows: BlueskyInteraction[],
  queryRange: DateRangePreset,
) {
  const limit = BLUESKY_ANALYTICS_LIMITS[queryRange].interactions;
  const interactionWeight = (row: BlueskyInteraction) =>
    row.interactionType === "quote" ? 3 : row.interactionType === "reply" ? 2 : 1;
  const sortedRows = [...rows]
    .sort((left, right) => {
      const rightWeight = interactionWeight(right);
      const leftWeight = interactionWeight(left);
      if (rightWeight !== leftWeight) {
        return rightWeight - leftWeight;
      }
      return right.createdUtc - left.createdUtc;
    })
    .slice(0, limit * 4);
  const rootCounts = new Map<string, number>();
  const actorCounts = new Map<string, number>();
  const selected: BlueskyInteraction[] = [];

  for (const row of sortedRows) {
    const rootId = getBlueskyInteractionRootId(row) || row.id;
    const actorId = row.actorDid || row.actorHandle || row.id;
    if ((rootCounts.get(rootId) ?? 0) >= 3 || (actorCounts.get(actorId) ?? 0) >= 4) {
      continue;
    }

    selected.push(row);
    rootCounts.set(rootId, (rootCounts.get(rootId) ?? 0) + 1);
    actorCounts.set(actorId, (actorCounts.get(actorId) ?? 0) + 1);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function limitBlueskySnapshotsForAnalytics(
  rows: BlueskyPostSnapshot[],
  queryRange: DateRangePreset,
) {
  const limit = BLUESKY_ANALYTICS_LIMITS[queryRange].snapshots;
  const sortedRows = [...rows]
    .sort((left, right) => {
      const leftDelta =
        (left.deltaRepostCount ?? 0) +
        (left.deltaCommentCount ?? 0) +
        (left.deltaQuoteCount ?? 0) +
        (left.deltaLikeCount ?? 0);
      const rightDelta =
        (right.deltaRepostCount ?? 0) +
        (right.deltaCommentCount ?? 0) +
        (right.deltaQuoteCount ?? 0) +
        (right.deltaLikeCount ?? 0);
      if (rightDelta !== leftDelta) {
        return rightDelta - leftDelta;
      }
      return right.createdUtc - left.createdUtc;
    })
    .slice(0, limit * 4);
  const rootCounts = new Map<string, number>();
  const selected: BlueskyPostSnapshot[] = [];

  for (const row of sortedRows) {
    const rootId = row.postUri || row.id;
    if ((rootCounts.get(rootId) ?? 0) >= 2) {
      continue;
    }

    selected.push(row);
    rootCounts.set(rootId, (rootCounts.get(rootId) ?? 0) + 1);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

async function buildSeeds(
  posts: RedditNormalizedPost[],
  comments: RedditNormalizedComment[],
  publicItems: PublicSourceItem[],
  blueskyPosts: BlueskyNormalizedPost[],
  blueskyInteractions: BlueskyInteraction[],
  blueskyPostSnapshots: BlueskyPostSnapshot[],
  blueskyProfiles: BlueskyProfile[],
  youtubeComments: YouTubeNormalizedComment[],
  youtubeVideoSnapshots: YouTubeVideoSnapshot[],
  query: TrendDashboardQuery,
  referenceTime: Date,
  snapshotGeneratedAt?: string | null,
  sourceHealth?: Record<string, RedditSourceHealth>,
  overallHealth?: RedditIngestionHealth,
) {
  const scoped = buildScopedAnalyticsSnapshot(
    posts,
    comments,
    publicItems,
    blueskyPosts,
    blueskyInteractions,
    blueskyPostSnapshots,
    blueskyProfiles,
    youtubeComments,
    youtubeVideoSnapshots,
    query,
    referenceTime,
  );

  const documents = buildTrendDocuments(
    scoped.scopedPosts,
    scoped.scopedComments,
    scoped.scopedPublicItems,
    scoped.scopedBlueskyPosts,
    scoped.scopedBlueskyInteractions,
    scoped.scopedBlueskyPostSnapshots,
    scoped.scopedBlueskyProfiles,
    scoped.scopedYouTubeComments,
    scoped.scopedYouTubeVideoSnapshots,
  );
  const heuristicGroups = buildTopicGroups(documents, scoped.scopedComments);
  let resolvedNarratives: ResolvedNarratives = null;

  if (isAiTrendMergeEnabled() && process.env.OPENAI_API_KEY) {
    try {
      const { resolveNarrativeClusters } = await import("@/lib/narratives/ai-clustering");
      resolvedNarratives = await Promise.race([
        resolveNarrativeClusters(buildAiMergeCandidates(heuristicGroups, referenceTime), snapshotGeneratedAt),
        new Promise<ResolvedNarratives>((resolve) => {
          setTimeout(() => resolve(null), AI_NARRATIVE_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      console.error("[analytics] failed to resolve AI narrative clusters", error);
    }
  }

  const topicGroups = finalizeTopicGroups(
    mergeTopicGroupsWithAi(
      heuristicGroups,
      scoped.scopedComments,
      resolvedNarratives,
    ),
  ).filter((group) => scopeMatchesPosts(group.documents, query.scope));

  if (ANALYTICS_DEBUG) {
    console.info("[analytics] established pipeline counts", {
      scope: query.scope,
      range: query.range,
      scopedPosts: scoped.scopedPosts.length,
      scopedComments: scoped.scopedComments.length,
      scopedPublicItems: scoped.scopedPublicItems.length,
      scopedBlueskyPosts: scoped.scopedBlueskyPosts.length,
      scopedBlueskyInteractions: scoped.scopedBlueskyInteractions.length,
      scopedBlueskyPostSnapshots: scoped.scopedBlueskyPostSnapshots.length,
      scopedYouTubeComments: scoped.scopedYouTubeComments.length,
      scopedYouTubeVideoSnapshots: scoped.scopedYouTubeVideoSnapshots.length,
      documentCount: documents.length,
      perPlatformDocumentCounts: summarizePlatformDocumentCounts(documents),
      heuristicTopicGroupCount: heuristicGroups.length,
      finalTopicGroupCount: topicGroups.length,
    });
  }

  return topicGroups.map((group) => {
    const supportingThreadCount = getPrimaryDocumentCount(group.documents);
    const commentHistory = bucketSeries(
      group.comments,
      query.range,
      referenceTime,
      getCommentInteractionScore,
    );
    const documentHistory = bucketSeries(
      group.documents,
      query.range,
      referenceTime,
      (document) => documentBucketWeight(document),
    );
    const narrativeHistory = bucketSeries(
      group.documents,
      query.range,
      referenceTime,
      (document) => document.narrativeInteractionCount,
    );
    const activeHistory = mergeSeries(commentHistory, documentHistory);
    const unique24hInteractionCount = getTrendUnique24hInteractionCount(group, scoped);
    const totalInteractionScore =
      group.documents.reduce((sum, document) => sum + document.interactionCount, 0) +
      group.comments.reduce((sum, comment) => sum + getCommentInteractionScore(comment), 0);
    const totalNarrativeScore = group.documents.reduce(
      (sum, document) => sum + document.narrativeInteractionCount,
      0,
    );
    const growthRate = activeHistory.some((point) => point.value > 0)
      ? getGrowthRateFromHistory(activeHistory)
      : 0;
    const attentionAcceleration = activeHistory.some((point) => point.value > 0)
      ? getAttentionAcceleration(activeHistory)
      : 0;
    const persistenceScore = activeHistory.some((point) => point.value > 0)
      ? getPersistenceScore(activeHistory)
      : 0;
    const lifecycleStage = activeHistory.some((point) => point.value > 0)
      ? getTrendLifecycleStage(activeHistory, growthRate, attentionAcceleration)
      : "Unknown";
    const spikeSignal = activeHistory.some((point) => point.value > 0)
      ? getSpikeSignal(activeHistory)
      : { hasSpike: false, spikeMagnitude: 0 };
    const platformBreakdown = buildPlatformBreakdown(group);
    const blueskyInsights = buildBlueskyTrendInsights(
      group.documents,
      platformBreakdown,
      scoped.blueskyPostsByRoot,
      scoped.blueskyInteractionsByRoot,
      scoped.blueskySnapshotsByRoot,
      scoped.blueskyProfileByDid,
      referenceTime,
    );
    const platforms = [...new Set(group.documents.map((document) => document.platformId))];
    const platformMigrationPath = buildPlatformMigrationPath(group);
    const sourceLabels = [...new Set(group.documents.map((document) => document.sourceLabel))];
    const uniqueAuthorCount = countUniqueDocumentAuthors(group.documents);
    const rootDocumentCount = countUniqueDocumentRoots(group.documents);
    const sourceCount = new Set(group.documents.map((document) => document.sourceKey)).size;
    const concentrationRisk = hasBlueskyDocuments(group.documents)
      ? getTopRootConcentrationRatio(group.documents, "bluesky")
      : getTopRootConcentrationRatio(group.documents);
    const freshness = buildTrendFreshness(
      group.documents,
      referenceTime,
      sourceHealth,
      overallHealth,
    );

    const rawConfidenceScore = buildConfidenceScore({
      commentCount: totalInteractionScore,
      threadCount: supportingThreadCount,
      subredditCount: sourceCount,
      currentWindowComments: currentWindowTotal(activeHistory),
      uniqueAuthorCount,
      rootDocumentCount,
      concentrationRisk,
    });
    const confidenceScore = getFreshnessAdjustedConfidence(rawConfidenceScore, freshness);
    const lowDataWarning =
      totalInteractionScore < LOW_DATA_COMMENT_THRESHOLD ||
      supportingThreadCount < LOW_DATA_THREAD_THRESHOLD ||
      confidenceScore < 42;
    const trend: RankedTrend = {
      id: `trend-${group.key.replace(/\s+/g, "-")}`,
      rank: 0,
      name: group.label,
      displayName: group.label,
      nameStatus: "ready",
      nameSource: "ai_exact",
      scope: group.isMeme ? "memes" : "overall",
      leaderboardMode: "established",
      attentionScore: 0,
      breakoutScore: 0,
      velocityScore: 0,
      noveltyScore: 0,
      confirmationScore: 0,
      attentionInteractions: round1(unique24hInteractionCount),
      confidenceScore,
      freshnessScore: freshness.score,
      freshnessState: freshness.state,
      sampleSize: round1(unique24hInteractionCount),
      supportingThreadCount,
      lowDataWarning,
      growthRate: round1(growthRate),
      attentionAcceleration: round1(attentionAcceleration),
      mentions: round1(totalNarrativeScore),
      platforms,
      platformSpread: platforms.length,
      confirmedPlatformSpread: freshness.confirmedPlatformSpread,
      attentionHistory: activeHistory,
      platformBreakdown,
      topPosts: buildTopPosts(group.documents, referenceTime),
      lifecycleStage,
      originPlatform:
        platformBreakdown[0]?.platformId ?? platformMigrationPath[0] ?? ("bluesky" as const),
      platformMigrationPath,
      attentionDrivers: platformBreakdown.slice(0, 3).map((item) => ({
        platformId: item.platformId,
        contributionPct: item.sharePct,
        deltaPct: round1(growthRate),
      })),
      hasSpike: spikeSignal.hasSpike,
      spikeMagnitude: spikeSignal.hasSpike ? spikeSignal.spikeMagnitude : undefined,
      clusterId: group.themeId,
      clusterName:
        sourceLabels.length > 1
          ? `${group.themeLabel} | ${sourceLabels.slice(0, 2).join(", ")}${sourceLabels.length > 2 ? " +" : ""}`
          : `${group.themeLabel} | ${sourceLabels[0] ?? "Internet"}`,
      trendStrengthScore: 0,
      persistenceScore: round1(persistenceScore),
      isEarlyTrend: false,
      positionChange24h: 0,
      googleSearchInterest: buildGoogleSearchInterest(group.documents),
      blueskySummary: blueskyInsights?.summary ?? null,
      blueskyDetail: blueskyInsights?.detail ?? null,
    };

    return {
      trend,
      totalInteractionScore: round1(totalInteractionScore),
      currentWindowInteractionScore: currentWindowTotal(activeHistory),
      priorWindowInteractionScore:
        previousDayCount(group.comments, referenceTime, getCommentInteractionScore) +
        previousDayCount(group.documents, referenceTime, documentBucketWeight),
      totalNarrativeScore: round1(totalNarrativeScore),
      currentWindowNarrativeScore: currentWindowTotal(narrativeHistory),
      priorWindowNarrativeScore: previousDayCount(
        group.documents,
        referenceTime,
        (document) => document.narrativeInteractionCount,
      ),
    };
  });
}

async function buildEmergingLeaderboard(
  scoped: ScopedAnalyticsSnapshot,
  query: TrendDashboardQuery,
  referenceTime: Date,
  sourceHealth?: Record<string, RedditSourceHealth>,
  overallHealth?: RedditIngestionHealth,
  establishedNarrativeKeys: Set<string> = new Set(),
) {
  const baseDocuments = buildTrendDocuments(
    scoped.scopedPosts,
    scoped.scopedComments,
    scoped.scopedPublicItems,
    scoped.scopedBlueskyPosts,
    scoped.scopedBlueskyInteractions,
    scoped.scopedBlueskyPostSnapshots,
    scoped.scopedBlueskyProfiles,
    scoped.scopedYouTubeComments,
    scoped.scopedYouTubeVideoSnapshots,
  );
  const commentDocuments = buildRedditCommentDocuments(scoped.scopedComments, scoped.scopedPosts);
  const topicGroups = mergeEmergingTopicGroups(
    buildEmergingTopicGroups([...commentDocuments, ...baseDocuments]),
  ).filter((group) => scopeMatchesPosts(group.documents, query.scope));

  if (ANALYTICS_DEBUG) {
    console.info("[analytics] emerging pipeline inputs", {
      scope: query.scope,
      range: query.range,
      baseDocumentCount: baseDocuments.length,
      commentDocumentCount: commentDocuments.length,
      totalEmergingDocuments: baseDocuments.length + commentDocuments.length,
      perPlatformDocumentCounts: summarizePlatformDocumentCounts([
        ...commentDocuments,
        ...baseDocuments,
      ]),
      earlySignalCandidateCount: topicGroups.length,
    });
  }

  const seeds: EmergingTrendSeed[] = topicGroups
    .map((group) => {
      const supportingThreadCount = Math.max(1, countUniqueDocumentRoots(group.documents));
      const interactionHistory = bucketSeries(
        group.documents,
        query.range,
        referenceTime,
        (document) => documentBucketWeight(document),
      );
      const narrativeHistory = bucketSeries(
        group.documents,
        query.range,
        referenceTime,
        (document) => document.narrativeInteractionCount,
      );
      const totalInteractionScore = group.documents.reduce(
        (sum, document) => sum + document.interactionCount,
        0,
      );
      const unique24hInteractionCount = getTrendUnique24hInteractionCount(group, scoped);
      const totalNarrativeScore = group.documents.reduce(
        (sum, document) => sum + document.narrativeInteractionCount,
        0,
      );
      const currentWindowInteractionScore = currentWindowTotal(interactionHistory);
      const priorWindowInteractionScore = previousWindowTotal(interactionHistory);
      const currentWindowNarrativeScore = currentWindowTotal(narrativeHistory);
      const priorWindowNarrativeScore = previousWindowTotal(narrativeHistory);
      const growthRate = interactionHistory.some((point) => point.value > 0)
        ? getGrowthRateFromHistory(interactionHistory)
        : 0;
      const attentionAcceleration = interactionHistory.some((point) => point.value > 0)
        ? getAttentionAcceleration(interactionHistory)
        : 0;
      const persistenceScore = interactionHistory.some((point) => point.value > 0)
        ? getPersistenceScore(interactionHistory)
        : 0;
      const lifecycleStage = interactionHistory.some((point) => point.value > 0)
        ? getTrendLifecycleStage(interactionHistory, growthRate, attentionAcceleration)
        : "Unknown";
      const spikeSignal = interactionHistory.some((point) => point.value > 0)
        ? getSpikeSignal(interactionHistory)
        : { hasSpike: false, spikeMagnitude: 0 };
      const platformBreakdown = buildPlatformBreakdown(group);
      const platforms = [...new Set(group.documents.map((document) => document.platformId))];
      const platformMigrationPath = buildPlatformMigrationPath(group);
      const sourceLabels = [...new Set(group.documents.map((document) => document.sourceLabel))];
      const uniqueAuthorCount = countUniqueDocumentAuthors(group.documents);
      const rootDocumentCount = countUniqueDocumentRoots(group.documents);
      const sourceCount = new Set(group.documents.map((document) => document.sourceKey)).size;
      const concentrationRisk = hasBlueskyDocuments(group.documents)
        ? getTopRootConcentrationRatio(group.documents, "bluesky")
        : getTopRootConcentrationRatio(group.documents);
      const freshness = buildTrendFreshness(
        group.documents,
        referenceTime,
        sourceHealth,
        overallHealth,
      );
      const rawConfidenceScore = buildConfidenceScore({
        commentCount: totalInteractionScore,
        threadCount: supportingThreadCount,
        subredditCount: sourceCount,
        currentWindowComments: currentWindowInteractionScore,
        uniqueAuthorCount,
        rootDocumentCount,
        concentrationRisk,
      });
      const confidenceScore = getFreshnessAdjustedConfidence(rawConfidenceScore, freshness);
      const interactionLiftScore = getEmergingRatioScore(
        currentWindowInteractionScore,
        priorWindowInteractionScore,
      );
      const narrativeLiftScore = getEmergingRatioScore(
        currentWindowNarrativeScore,
        priorWindowNarrativeScore,
      );
      const engagementIntensityScore = clampScore(
        Math.min(56, Math.max(totalInteractionScore / Math.max(group.documents.length, 1), 0) * 3) +
          Math.min(24, Math.log10(currentWindowInteractionScore + 1) * 16),
      );
      const velocityScore = round1(
        clampScore(
          normalizeEmergingMomentum(growthRate, 1.9) * 0.26 +
            normalizeEmergingMomentum(attentionAcceleration, 8.4) * 0.28 +
            interactionLiftScore * 0.24 +
            narrativeLiftScore * 0.14 +
            engagementIntensityScore * 0.12 +
            (spikeSignal.hasSpike ? 6 : 0),
        ),
      );
      const firstSeenMinutes = Math.max(
        1,
        Math.round(
          (referenceTime.getTime() -
            Math.min(...group.documents.map((document) => document.createdUtc * 1000))) /
            60_000,
        ),
      );
      const recencyScore =
        firstSeenMinutes <= 60
          ? 100
          : firstSeenMinutes <= 360
            ? 88
            : firstSeenMinutes <= 720
              ? 72
              : firstSeenMinutes <= 1_440
                ? 54
                : firstSeenMinutes <= 2_880
                  ? 34
                  : 16;
      const lowBaseBonus =
        priorWindowInteractionScore <= currentWindowInteractionScore
          ? Math.max(0, 30 - Math.min(30, priorWindowInteractionScore * 2.2))
          : 0;
      const nicheConcentrationBonus =
        concentrationRisk <= 0.55 ? 14 : concentrationRisk <= 0.72 ? 8 : 0;
      const repeatedNarrativePenalty =
        concentrationRisk > 0.88 ? 18 : concentrationRisk > 0.76 ? 10 : 0;
      const narrativeKey = canonicalNarrativeMergeKey(group.label, group.aliases) ?? group.key;
      const mainstreamPenalty =
        (establishedNarrativeKeys.has(narrativeKey) ? 24 : 0) +
        (lifecycleStage === "Established"
          ? 10
          : lifecycleStage === "Fading"
            ? 14
            : lifecycleStage === "Declining"
              ? 18
              : 0) +
        (totalInteractionScore >= 160 ? 10 : totalInteractionScore >= 90 ? 4 : 0);
      const noveltyScore = round1(
        clampScore(
          recencyScore * 0.56 +
            interactionLiftScore * 0.18 +
            lowBaseBonus +
            nicheConcentrationBonus -
            repeatedNarrativePenalty -
            (establishedNarrativeKeys.has(narrativeKey) ? 12 : 0),
        ),
      );
      const confirmationScore = round1(
        clampScore(
          14 +
            Math.min(30, freshness.confirmedPlatformSpread * 16) +
            Math.min(24, sourceCount * 6) +
            Math.min(20, Math.log2(uniqueAuthorCount + 1) * 7) +
            Math.min(14, rootDocumentCount * 4) -
            (freshness.state === "mixed" ? 6 : freshness.state === "stale" ? 16 : 0),
        ),
      );
      const breakoutScore = getEmergingBreakoutScore({
        velocityScore,
        noveltyScore,
        confirmationScore,
        freshnessScore: freshness.score,
        confidenceScore,
        growthRate,
        attentionAcceleration,
        mainstreamPenalty,
        spamPenalty: (group.labelQualityScore < 42 ? 10 : group.labelQualityScore < 50 ? 4 : 0) + repeatedNarrativePenalty,
        spikeBonus: spikeSignal.hasSpike ? 4 : 0,
      });
      const attentionScore = round1(
        clampScore(
          (
            Math.min(100, Math.log10(totalInteractionScore + 1) * 28) * 0.62 +
            Math.min(100, Math.log10(currentWindowInteractionScore + 1) * 34) * 0.38
          ) * getFreshnessRankFactor(freshness.score, true),
        ),
      );
      const blueskyInsights = buildBlueskyTrendInsights(
        group.documents,
        platformBreakdown,
        scoped.blueskyPostsByRoot,
        scoped.blueskyInteractionsByRoot,
        scoped.blueskySnapshotsByRoot,
        scoped.blueskyProfileByDid,
        referenceTime,
      );
      const lowDataWarning =
        totalInteractionScore < 10 || confidenceScore < 34 || freshness.state === "stale";
      const trend: RankedTrend = {
        id: `emerging-trend-${group.key.replace(/\s+/g, "-")}`,
        rank: 0,
        name: group.label,
        displayName: group.label,
        nameStatus: "ready",
        nameSource: "ai_exact",
        scope: group.isMeme ? "memes" : "overall",
        leaderboardMode: "emerging",
        attentionScore,
        emergingScore: breakoutScore,
        breakoutScore,
        velocityScore,
        noveltyScore,
        confirmationScore,
        attentionInteractions: round1(unique24hInteractionCount),
        confidenceScore,
        freshnessScore: freshness.score,
        freshnessState: freshness.state,
        sampleSize: round1(unique24hInteractionCount),
        supportingThreadCount,
        lowDataWarning,
        growthRate: round1(growthRate),
        attentionAcceleration: round1(attentionAcceleration),
        mentions: round1(totalNarrativeScore),
        platforms,
        platformSpread: platforms.length,
        confirmedPlatformSpread: freshness.confirmedPlatformSpread,
        attentionHistory: interactionHistory,
        platformBreakdown,
        topPosts: buildTopPosts(group.documents, referenceTime),
        lifecycleStage,
        originPlatform:
          platformBreakdown[0]?.platformId ?? platformMigrationPath[0] ?? ("bluesky" as const),
        platformMigrationPath,
        attentionDrivers: platformBreakdown.slice(0, 3).map((item) => ({
          platformId: item.platformId,
          contributionPct: item.sharePct,
          deltaPct: round1(attentionAcceleration),
        })),
        hasSpike: spikeSignal.hasSpike,
        spikeMagnitude: spikeSignal.hasSpike ? spikeSignal.spikeMagnitude : undefined,
        clusterId: group.themeId,
        clusterName:
          sourceLabels.length > 1
            ? `${group.themeLabel} | ${sourceLabels.slice(0, 2).join(", ")}${sourceLabels.length > 2 ? " +" : ""}`
            : `${group.themeLabel} | ${sourceLabels[0] ?? "Internet"}`,
        trendStrengthScore: breakoutScore,
        persistenceScore: round1(persistenceScore),
        isEarlyTrend:
          breakoutScore >= 58 &&
          freshness.state !== "stale" &&
          (lifecycleStage === "Emerging" || lifecycleStage === "Expanding"),
        positionChange24h: 0,
        googleSearchInterest: buildGoogleSearchInterest(group.documents),
        blueskySummary: blueskyInsights?.summary ?? null,
        blueskyDetail: blueskyInsights?.detail ?? null,
      };

      return {
        trend,
        totalInteractionScore: round1(totalInteractionScore),
        currentWindowInteractionScore,
        priorWindowInteractionScore,
        totalNarrativeScore: round1(totalNarrativeScore),
        currentWindowNarrativeScore,
        priorWindowNarrativeScore,
        rawVelocityScore: velocityScore,
        rawNoveltyScore: noveltyScore,
        rawConfirmationScore: confirmationScore,
        rawBreakoutScore: breakoutScore,
      } satisfies EmergingTrendSeed;
    })
    .filter((seed) => seed.rawBreakoutScore >= 30 || seed.currentWindowInteractionScore >= 10);

  if (ANALYTICS_DEBUG) {
    console.info("[analytics] emerging pipeline outputs", {
      scope: query.scope,
      range: query.range,
      topicGroupCount: topicGroups.length,
      emergingSeedCount: seeds.length,
    });
  }

  const rankChanges = buildRankChanges(seeds);

  return seeds
    .map((seed) => ({
      ...seed.trend,
      positionChange24h: rankChanges.get(seed.trend.id) ?? 0,
    }))
    .sort((left, right) => {
      if ((right.breakoutScore ?? 0) !== (left.breakoutScore ?? 0)) {
        return (right.breakoutScore ?? 0) - (left.breakoutScore ?? 0);
      }

      if ((right.velocityScore ?? 0) !== (left.velocityScore ?? 0)) {
        return (right.velocityScore ?? 0) - (left.velocityScore ?? 0);
      }

      return right.attentionInteractions - left.attentionInteractions;
    })
    .slice(0, 80)
    .map((trend, index) => ({
      ...trend,
      rank: index + 1,
    }));
}

function buildEstablishedLeaderboardFromSeeds(seeds: RankedTrendSeed[]) {
  if (seeds.length === 0) {
    return [] as RankedTrend[];
  }

  const hasAnyInteractions = seeds.some((seed) => seed.totalInteractionScore > 0);
  const maxTotalInteractions = Math.max(...seeds.map((seed) => seed.totalInteractionScore), 1);
  const maxCurrentInteractions = Math.max(
    ...seeds.map((seed) => seed.currentWindowInteractionScore),
    1,
  );
  const maxTotalNarrative = Math.max(...seeds.map((seed) => seed.totalNarrativeScore), 1);
  const maxCurrentNarrative = Math.max(
    ...seeds.map((seed) => seed.currentWindowNarrativeScore),
    1,
  );
  const maxBlueskyMomentum = Math.max(
    ...seeds.map(
      (seed) =>
        (seed.trend.blueskySummary?.repostVelocity ?? 0) +
        (seed.trend.blueskySummary?.replyVelocity ?? 0) +
        (seed.trend.blueskySummary?.quoteVelocity ?? 0),
    ),
    1,
  );
  const maxBlueskyDominance = Math.max(
    ...seeds.map(
      (seed) =>
        (seed.trend.blueskySummary?.attentionSharePct ?? 0) *
        Math.log2((seed.trend.blueskySummary?.uniqueAuthorCount ?? 0) + 1),
    ),
    1,
  );
  const rankChanges = buildRankChanges(seeds);
  const scoredRows = seeds.map((seed) => {
    const totalInteractionScore = normalizeComponent(
      seed.totalInteractionScore,
      maxTotalInteractions,
    );
    const recentInteractionScore = normalizeComponent(
      seed.currentWindowInteractionScore,
      maxCurrentInteractions,
    );
    const totalNarrativeScore = normalizeComponent(
      seed.totalNarrativeScore,
      maxTotalNarrative,
    );
    const recentNarrativeScore = normalizeComponent(
      seed.currentWindowNarrativeScore,
      maxCurrentNarrative,
    );
    const blueskyMomentumScore = normalizeComponent(
      (seed.trend.blueskySummary?.repostVelocity ?? 0) +
        (seed.trend.blueskySummary?.replyVelocity ?? 0) +
        (seed.trend.blueskySummary?.quoteVelocity ?? 0),
      maxBlueskyMomentum,
    );
    const blueskyDominanceScore = normalizeComponent(
      (seed.trend.blueskySummary?.attentionSharePct ?? 0) *
        Math.log2((seed.trend.blueskySummary?.uniqueAuthorCount ?? 0) + 1),
      maxBlueskyDominance,
    );
    const baseAttentionScore = hasAnyInteractions
      ? round1(
          totalInteractionScore * 0.54 +
            recentInteractionScore * 0.2 +
            totalNarrativeScore * 0.12 +
            recentNarrativeScore * 0.04 +
            blueskyMomentumScore * 0.05 +
            blueskyDominanceScore * 0.05,
        )
      : round1(totalNarrativeScore * 0.7 + recentNarrativeScore * 0.3);
    const attentionScore = round1(
      clampScore(baseAttentionScore * getFreshnessRankFactor(seed.trend.freshnessScore)),
    );
    const confirmedSpread =
      seed.trend.confirmedPlatformSpread > 0
        ? seed.trend.confirmedPlatformSpread
        : seed.trend.platformSpread;
    const trendStrengthScore = getTrendStrengthScore({
      attentionScore,
      confidenceScore: seed.trend.confidenceScore,
      growthRate: seed.trend.growthRate,
      attentionAcceleration: seed.trend.attentionAcceleration,
      platformSpread: confirmedSpread,
      persistenceScore: seed.trend.persistenceScore,
      blueskyShare: seed.trend.blueskySummary?.attentionSharePct ?? 0,
    });

    return {
      seed,
      trend: {
        ...seed.trend,
        attentionScore,
        trendStrengthScore,
        isEarlyTrend: getIsEarlyTrend({
          attentionScore,
          growthRate: seed.trend.growthRate,
          attentionAcceleration: seed.trend.attentionAcceleration,
          platformSpread: confirmedSpread,
          persistenceScore: seed.trend.persistenceScore,
          lifecycleStage: seed.trend.lifecycleStage,
          blueskyShare: seed.trend.blueskySummary?.attentionSharePct ?? 0,
        }),
        positionChange24h: rankChanges.get(seed.trend.id) ?? 0,
      },
    };
  });

  return scoredRows
    .map(({ trend }) => trend)
    .sort(compareBySort("established", "posts"))
    .map((trend, index) => ({
      ...trend,
      rank: index + 1,
    }));
}

function buildEmergingLeaderboardFromSeeds(
  seeds: RankedTrendSeed[],
  establishedRanked: RankedTrend[],
) {
  const attentionRankById = new Map(
    establishedRanked.map((trend, index) => [trend.id, index + 1] as const),
  );
  const seedById = new Map(seeds.map((seed) => [seed.trend.id, seed] as const));

  return establishedRanked
    .map((trend) => {
      const seed = seedById.get(trend.id);
      if (!seed) {
        return {
          ...trend,
          leaderboardMode: "emerging" as const,
          emergingScore: trend.breakoutScore ?? trend.emergingScore ?? 0,
          breakoutScore: trend.breakoutScore ?? trend.emergingScore ?? 0,
        };
      }

      const attentionRank = attentionRankById.get(trend.id) ?? establishedRanked.length;
      const emergingScore = getEmergingTrendScore(seed, trend, attentionRank);
      return {
        ...trend,
        leaderboardMode: "emerging" as const,
        emergingScore,
        breakoutScore: emergingScore,
      };
    })
    .sort(compareBySort("emerging", "breakout"))
    .map((trend, index) => ({
      ...trend,
      rank: index + 1,
    }));
}

export async function getTrendDashboardVM(
  query: TrendDashboardQuery,
  snapshot?: RedditIngestionSnapshot,
  options: AnalyticsBuildOptions = {},
): Promise<TrendDashboardVM> {
  const posts = snapshot?.posts ?? [];
  const comments = snapshot?.comments ?? [];
  const publicItems = snapshot?.publicItems ?? [];
  const blueskyPosts = snapshot?.blueskyPosts ?? [];
  const blueskyInteractions = snapshot?.blueskyInteractions ?? [];
  const blueskyPostSnapshots = snapshot?.blueskyPostSnapshots ?? [];
  const blueskyProfiles = snapshot?.blueskyProfiles ?? [];
  const youtubeComments = snapshot?.youtubeComments ?? [];
  const youtubeVideoSnapshots = snapshot?.youtubeVideoSnapshots ?? [];
  if (
    posts.length === 0 &&
    comments.length === 0 &&
    publicItems.length === 0 &&
    blueskyPosts.length === 0 &&
    blueskyInteractions.length === 0 &&
    blueskyPostSnapshots.length === 0 &&
    youtubeComments.length === 0 &&
    youtubeVideoSnapshots.length === 0
  ) {
    return {
      ...createZeroTrendDashboardVM(query),
      ingestionHealth: snapshot?.health ?? null,
    };
  }

  const referenceTime = snapshot?.generatedAt
    ? new Date(snapshot.generatedAt)
    : snapshot?.fetchedAt
      ? new Date(snapshot.fetchedAt)
      : new Date();
  const mode = query.mode ?? "established";
  const scoped = buildScopedAnalyticsSnapshot(
    posts,
    comments,
    publicItems,
    blueskyPosts,
    blueskyInteractions,
    blueskyPostSnapshots,
    blueskyProfiles,
    youtubeComments,
    youtubeVideoSnapshots,
    query,
    referenceTime,
  );
  const hasBlueskyWindowData =
    scoped.windowBlueskyPosts.length > 0 ||
    scoped.windowBlueskyInteractions.length > 0 ||
    scoped.windowBlueskyPostSnapshots.length > 0;
  const shouldUseExhaustiveBluesky =
    hasBlueskyWindowData &&
    scoped.windowBlueskyPosts.length <= EXHAUSTIVE_BLUESKY_MAX_WINDOW_POSTS &&
    scoped.windowBlueskyInteractions.length <= EXHAUSTIVE_BLUESKY_MAX_WINDOW_INTERACTIONS &&
    scoped.windowBlueskyPostSnapshots.length <= EXHAUSTIVE_BLUESKY_MAX_WINDOW_SNAPSHOTS;
  let seeds: RankedTrendSeed[] = [];
  let trendCoverage: TrendCoverageDebug | null = null;

  if (shouldUseExhaustiveBluesky) {
    const exhaustive = await buildExhaustiveBlueskyTrendSeeds(
      scoped,
      query,
      referenceTime,
      snapshot?.sourceHealth,
      snapshot?.health,
      options,
    );
    seeds = exhaustive.seeds;
    trendCoverage = exhaustive.coverage;
  } else {
    if (ANALYTICS_DEBUG && hasBlueskyWindowData) {
      console.info("[analytics] skipping exhaustive bluesky path due window volume", {
        range: query.range,
        windowPosts: scoped.windowBlueskyPosts.length,
        windowInteractions: scoped.windowBlueskyInteractions.length,
        windowSnapshots: scoped.windowBlueskyPostSnapshots.length,
      });
    }
    seeds = await buildSeeds(
      posts,
      comments,
      publicItems,
      blueskyPosts,
      blueskyInteractions,
      blueskyPostSnapshots,
      blueskyProfiles,
      youtubeComments,
      youtubeVideoSnapshots,
      query,
      referenceTime,
      snapshot?.generatedAt ?? snapshot?.fetchedAt,
      snapshot?.sourceHealth,
      snapshot?.health,
    );
  }

  const establishedRanked = buildEstablishedLeaderboardFromSeeds(seeds);
  const emergingRanked = shouldUseExhaustiveBluesky
    ? buildEmergingLeaderboardFromSeeds(seeds, establishedRanked)
    : await buildEmergingLeaderboard(
        scoped,
        query,
        referenceTime,
        snapshot?.sourceHealth,
        snapshot?.health,
        new Set(
          establishedRanked
            .map((trend) => canonicalNarrativeMergeKey(trend.name, [trend.clusterName]))
            .filter((key): key is string => Boolean(key)),
        ),
      );
  const leaderboards = {
    established: establishedRanked,
    emerging: emergingRanked,
  } satisfies TrendDashboardVM["leaderboards"];
  const baseLeaderboard = leaderboards[mode] ?? [];
  const leaderboard = [...baseLeaderboard]
    .sort(compareBySort(mode, query.sort))
    .map((trend, index) => ({
      ...trend,
      rank: index + 1,
    }));
  const displayedAiGroupedRowsCount = leaderboard.filter(
    (trend) =>
      Boolean(trend.aiAssisted) &&
      (trend.groupingSource === "ai_semantic_cluster" || trend.groupingSource === "canonical_url_anchor") &&
      !trend.isSingleton,
  ).length;
  const displayedSingletonRowsCount = leaderboard.filter((trend) => Boolean(trend.isSingleton)).length;
  const displayedFallbackRowsCount = leaderboard.filter(
    (trend) =>
      trend.labelType === "fallback_generated" || trend.groupingSource === "fallback_singleton",
  ).length;
  const displayedLowInformationRowsCount = leaderboard.filter((trend) => Boolean(trend.lowInformation)).length;
  const rankingDiagnostics = leaderboard.slice(0, 10).map((trend) => ({
    id: trend.id,
    rank: trend.rank,
    tier: trend.leaderboardTier,
    groupingSource: trend.groupingSource,
    rootsCount24h: trend.rootsCount24h ?? 0,
    totalInteractions24h: trend.totalInteractions24h ?? 0,
    qualityAdjustedScore: trend.qualityAdjustedScore,
    reason:
      (trend.rootsCount24h ?? 0) > 1
        ? `grouped evidence across ${trend.rootsCount24h ?? 0} roots`
        : trend.groupingSource === "canonical_url_anchor"
          ? "singleton URL anchor demoted to audit"
          : trend.aiAssisted
            ? "singleton AI narrative"
            : trend.lowInformation
              ? "low-information singleton"
              : "singleton fallback",
  }));

  if (ANALYTICS_DEBUG) {
    console.info("[analytics] final leaderboard counts", {
      scope: query.scope,
      range: query.range,
      mode,
      sort: query.sort,
      establishedRowCount: leaderboards.established.length,
      emergingRowCount: leaderboards.emerging.length,
      selectedLeaderboardCount: leaderboard.length,
    });
    console.info("[analytics] leaderboard ranking diagnostics", {
      scope: query.scope,
      range: query.range,
      mode,
      sort: query.sort,
      topRows: rankingDiagnostics,
    });
  }

  const scopedOverviewBlueskyInteractions = scoped.windowBlueskyInteractions;
  const scopedOverviewBlueskySnapshots = scoped.windowBlueskyPostSnapshots;
  const scopedOverviewBlueskyPosts = scoped.windowBlueskyPosts;
  const blueskyOverview = buildBlueskyFirehoseOverview({
    ranked:
      leaderboards.established.length > 0
        ? leaderboards.established
        : leaderboards.emerging,
    posts: scopedOverviewBlueskyPosts,
    interactions: scopedOverviewBlueskyInteractions,
    snapshots: scopedOverviewBlueskySnapshots,
    referenceTime,
    windowMs: RANGE_MS[query.range],
    generatedAt: snapshot?.generatedAt ?? snapshot?.fetchedAt ?? null,
  });
  const overallHealth = snapshot?.health ?? null;
  const firehoseState = snapshot?.blueskyFirehoseState ?? null;
  const overviewWindowStartMs = referenceTime.getTime() - RANGE_MS[query.range];
  const rawReplay =
    Array.isArray(firehoseState?.rawReplay)
      ? firehoseState.rawReplay
          .filter(
            (point): point is { timestamp: string; value: number } =>
              Boolean(point) &&
              typeof point.timestamp === "string" &&
              typeof point.value === "number" &&
              Number.isFinite(point.value),
          )
          .map((point) => ({
            timestamp: point.timestamp,
            value: point.value,
          }))
          .filter((point) => {
            const pointMs = Date.parse(point.timestamp);
            return Number.isFinite(pointMs) && pointMs >= overviewWindowStartMs;
          })
      : [];
  const rawReplayCoversSelectedWindow = timeSeriesCoversWindow(rawReplay, query.range);
  const pickFiniteNumber = (preferred: unknown, fallback: number) =>
    typeof preferred === "number" && Number.isFinite(preferred) ? preferred : fallback;
  const firehoseReplayIsFresh =
    (overallHealth?.freshnessState ?? "empty") !== "stale" &&
    firehoseState?.workerAlive !== false &&
    firehoseState?.status !== "failed";
  const firehoseGeneratedAt =
    firehoseState?.lastReceivedAt ??
    firehoseState?.lastEventAt ??
    firehoseState?.workerHeartbeatAt ??
    snapshot?.generatedAt ??
    snapshot?.fetchedAt ??
    null;
  const rawOnlyBlueskyOverview =
    rawReplay.length > 0 || firehoseState
      ? {
          generatedAt: firehoseGeneratedAt,
          firehoseLagMinutes:
            typeof firehoseState?.backlogLagMinutes === "number" &&
            Number.isFinite(firehoseState.backlogLagMinutes)
              ? firehoseState.backlogLagMinutes
              : null,
          attentionSharePct: 100,
          engagementIntensity: pickFiniteNumber(firehoseState?.eventsPerMinute, 0),
          meaningfulAttentionScore: pickFiniteNumber(firehoseState?.eventsPerMinute, 0),
          narrativeCount: leaderboards.established.length + leaderboards.emerging.length,
          accountSpread: 0,
          postsPerMinute: pickFiniteNumber(firehoseState?.postsPerMinute, 0),
          likesPerMinute: pickFiniteNumber(firehoseState?.likesPerMinute, 0),
          repostsPerMinute: pickFiniteNumber(firehoseState?.repostsPerMinute, 0),
          repliesPerMinute: pickFiniteNumber(firehoseState?.repliesPerMinute, 0),
          quotesPerMinute: pickFiniteNumber(firehoseState?.quotesPerMinute, 0),
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
          replay: firehoseReplayIsFresh ? rawReplay : [],
        }
      : null;
  const mergedBlueskyOverview = blueskyOverview
    ? {
        ...blueskyOverview,
        generatedAt: firehoseGeneratedAt ?? blueskyOverview.generatedAt,
        firehoseLagMinutes:
          typeof firehoseState?.backlogLagMinutes === "number" &&
          Number.isFinite(firehoseState.backlogLagMinutes)
            ? firehoseState.backlogLagMinutes
            : blueskyOverview.firehoseLagMinutes,
        postsPerMinute: pickFiniteNumber(firehoseState?.postsPerMinute, blueskyOverview.postsPerMinute),
        likesPerMinute: pickFiniteNumber(firehoseState?.likesPerMinute, blueskyOverview.likesPerMinute),
        repostsPerMinute: pickFiniteNumber(
          firehoseState?.repostsPerMinute,
          blueskyOverview.repostsPerMinute,
        ),
        repliesPerMinute: pickFiniteNumber(
          firehoseState?.repliesPerMinute,
          blueskyOverview.repliesPerMinute,
        ),
        quotesPerMinute: pickFiniteNumber(
          firehoseState?.quotesPerMinute,
          blueskyOverview.quotesPerMinute,
        ),
        replay:
          firehoseReplayIsFresh && rawReplay.length > 0 && rawReplayCoversSelectedWindow
            ? rawReplay
            : blueskyOverview.replay,
      }
    : rawOnlyBlueskyOverview;
  const mergedTrendCoverage = trendCoverage
    ? {
        ...trendCoverage,
        displayedRowsCount: leaderboard.length,
        displayedAiGroupedRowsCount,
        displayedSingletonRowsCount,
        displayedFallbackRowsCount,
        displayedLowInformationRowsCount,
        firehoseLagMinutes:
          typeof firehoseState?.backlogLagMinutes === "number" &&
          Number.isFinite(firehoseState.backlogLagMinutes)
            ? firehoseState.backlogLagMinutes
            : trendCoverage.firehoseLagMinutes,
      }
    : null;

  if (leaderboard.length === 0) {
    if (leaderboards.established.length === 0 && leaderboards.emerging.length === 0) {
      return {
        ...createZeroTrendDashboardVM(query),
        ingestionHealth: snapshot?.health ?? null,
        blueskyOverview: mergedBlueskyOverview,
        trendCoverage: mergedTrendCoverage,
      };
    }
  }

  return applyTrendDashboardSelection(
    {
      query: {
        ...query,
        mode,
        selectedId: undefined,
      },
      ingestionHealth: snapshot?.health ?? null,
      blueskyOverview: mergedBlueskyOverview,
      trendCoverage: mergedTrendCoverage,
      leaderboards,
      leaderboard,
      overviewSeries: [],
      detail: null,
    },
    query.selectedId,
  );
}
