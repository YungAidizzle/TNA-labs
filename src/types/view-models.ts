import {
  DateRangePreset,
  PlatformId,
  TimeSeriesPoint,
  TrendFreshnessState,
  TrendLifecycleStage,
  TrendScope,
} from "@/types/domain";
import { RedditIngestionHealth } from "@/lib/reddit/types";

export type AccentTone = "cyan" | "emerald" | "amber" | "rose" | "violet";

export type TrendLeaderboardMode = "emerging" | "established";

export type TrendGroupingSource =
  | "canonical_url_anchor"
  | "ai_semantic_cluster"
  | "template_anchor"
  | "singleton_ai"
  | "fallback_singleton";

export type TrendLeaderboardTier =
  | "primary_grouped"
  | "secondary_singleton"
  | "audit_low_information"
  | "audit_template"
  | "audit_fallback";

export type EstablishedTrendSort = "posts" | "attention" | "growth" | "mentions" | "strength";

export type EmergingTrendSort = "breakout" | "velocity" | "novelty" | "confirmation";

export type TrendSort = EstablishedTrendSort | EmergingTrendSort;

export type TrendTopPost = {
  id: string;
  platformId: PlatformId;
  title: string;
  subtitle?: string | null;
  author?: string | null;
  authorHandle?: string | null;
  postType?: string | null;
  documentKind?: string | null;
  rootDocumentId?: string | null;
  interactionBreakdown?: string | null;
  engagement: number;
  engagementVelocity: number;
  ageMinutes: number;
  url: string;
};

export type TrendAttentionDriver = {
  platformId: PlatformId;
  contributionPct: number;
  deltaPct: number;
};

export type TrendAiEnrichment = {
  rawLabel: string;
  status: "ok" | "mixed" | "insufficient_evidence" | "junk";
  canonicalName: string | null;
  aiDisplayName?: string | null;
  fallbackLabel?: string | null;
  nameStatus?: TrendNameStatus;
  aiNameStatus?: TrendNameStatus;
  nameSource?: TrendNameSource;
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
  aiNameGeneratedAt?: string | null;
  aiNameRefreshedAt?: string | null;
  aiNameSourceVersion?: string | null;
};

export type TrendNameStatus = "ready" | "pending" | "failed";

export type TrendNameSource =
  | "ai_exact"
  | "historical_exact"
  | "historical_alias"
  | "fallback_cleaned"
  | "raw"
  | "none";

export type TrendPlatformBreakdown = Array<{
  platformId: PlatformId;
  interactions: number;
  sharePct: number;
}>;

export type TrendGoogleSearchInterest = {
  score: number;
  approxTrafficLabel: string | null;
  matchedQueries: string[];
  queryCount: number;
};

export type FirehoseNetworkNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  size: number;
  color: [number, number, number];
};

export type FirehoseNetworkEdge = {
  source: [number, number];
  target: [number, number];
  width: number;
  color: [number, number, number];
};

export type TimeSeriesWindow = {
  range: DateRangePreset;
  windowStart: string;
  windowEnd: string;
  latestPointAt: string | null;
  latestDataAt: string | null;
  staleGapMinutes: number | null;
  trailingGapBucketCount: number;
  hasTrailingGap: boolean;
  bucketIntervalMinutes: number;
};

export type TrendBlueskySummary = {
  attentionSharePct: number;
  postCount: number;
  uniqueAuthorCount: number;
  amplifierCount: number;
  topAmplifierHandle: string | null;
  topAmplifier?: string | null;
  repostVelocity: number;
  replyVelocity: number;
  quoteVelocity: number;
  likeVelocity?: number;
  amplificationScore?: number;
  engagementIntensity?: number;
  accountSpread?: number;
  cascadeCount?: number;
  accelerationScore?: number;
  narrativeCount?: number;
  postsPerMinute?: number;
  repostsPerMinute?: number;
  repliesPerMinute?: number;
  quotesPerMinute?: number;
  likesPerMinute?: number;
  meaningfulAttentionScore?: number;
  noiseRatioPct?: number;
  leadingSignalLabel: string;
  firehoseLagMinutes: number | null;
};

export type TrendBlueskyAmplifier = {
  did?: string | null;
  handle: string;
  displayName?: string | null;
  followersCount?: number | null;
  interactions: number;
  documents: number;
  contributionPct: number;
};

export type TrendBlueskyCascade = {
  rootDocumentId: string;
  title: string;
  authorHandle: string | null;
  interactions: number;
  velocity: number;
  sharePct: number;
  uniqueParticipants: number;
};

export type TrendBlueskyDetail = {
  summary: TrendBlueskySummary;
  topAmplifiers: TrendBlueskyAmplifier[];
  cascadeLeaders?: TrendBlueskyCascade[];
  engagementBreakdown?: Array<{
    label: string;
    count: number;
    velocityPerHour: number;
  }>;
  postTypeMix: Array<{
    type: string;
    count: number;
    sharePct: number;
  }>;
  accountSpreadLabel: string;
  propagationSummary: string;
  noiseSummary?: string | null;
  meaningfulAttentionScore?: number | null;
  network?: {
    nodes: FirehoseNetworkNode[];
    edges: FirehoseNetworkEdge[];
  };
  earliestOriginAt: string | null;
  earliestOriginHandle: string | null;
};

export type BlueskyFirehoseLeader = {
  id: string;
  label: string;
  trendId?: string | null;
  attentionScore: number;
  velocity: number;
  accelerationScore: number;
  attentionSharePct: number;
  uniqueAuthors: number;
  amplificationScore: number;
  topAmplifierHandle: string | null;
};

export type BlueskyFirehoseCluster = {
  id: string;
  label: string;
  narratives: number;
  attentionScore: number;
  velocity: number;
  uniqueAuthors: number;
  sharePct: number;
};

export type BlueskyFirehoseOverview = {
  generatedAt: string | null;
  firehoseLagMinutes: number | null;
  attentionSharePct: number;
  engagementIntensity: number;
  meaningfulAttentionScore: number;
  narrativeCount: number;
  accountSpread: number;
  postsPerMinute: number;
  likesPerMinute: number;
  repostsPerMinute: number;
  repliesPerMinute: number;
  quotesPerMinute: number;
  accelerationScore: number;
  noiseRatioPct: number;
  leaders: BlueskyFirehoseLeader[];
  emerging: BlueskyFirehoseLeader[];
  topAmplifiers: TrendBlueskyAmplifier[];
  cascades: TrendBlueskyCascade[];
  clusters: BlueskyFirehoseCluster[];
  network: {
    nodes: FirehoseNetworkNode[];
    edges: FirehoseNetworkEdge[];
  };
  replay: TimeSeriesPoint[];
  replayWindow?: TimeSeriesWindow | null;
};

export type RankedTrend = {
  id: string;
  rank: number;
  name: string;
  displayName: string | null;
  nameStatus: TrendNameStatus;
  nameSource: TrendNameSource;
  trendDescription?: string | null;
  trendContextParagraph?: string | null;
  trendNarrativeSummary?: string | null;
  trendRawLabel?: string | null;
  trendFallbackLabel?: string | null;
  trendSummaryConfidence?: number | null;
  trendEnrichmentStatus?: TrendAiEnrichment["status"] | null;
  trendEnrichmentAbstainReason?: string | null;
  trendKeyEntities?: string[] | null;
  trendEnrichment?: TrendAiEnrichment | null;
  scope: TrendScope;
  source?: "bluesky" | "mixed";
  labelType?: TrendLabelType;
  groupingSource?: TrendGroupingSource;
  leaderboardTier?: TrendLeaderboardTier;
  canonicalKeySummary?: string | null;
  labelQualityScore?: number;
  lowQualityLabel?: boolean;
  aiAssisted?: boolean;
  leaderboardMode: TrendLeaderboardMode;
  attentionScore: number;
  emergingScore?: number;
  breakoutScore?: number;
  velocityScore?: number;
  noveltyScore?: number;
  confirmationScore?: number;
  totalInteractions24h?: number;
  qualityAdjustedScore?: number;
  attentionInteractions: number;
  rootsCount24h?: number;
  uniqueAuthors24h?: number;
  positiveMentions24h?: number;
  neutralMentions24h?: number;
  negativeMentions24h?: number;
  sentimentBalance?: number;
  singleAuthorShare?: number;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  isSingleton?: boolean;
  trendCategory?: string | null;
  contentType?: string | null;
  spamLikelihood?: number;
  templateLikelihood?: number;
  contextualCoherence?: number;
  lowInformation?: boolean;
  templateSeries?: boolean;
  seriesExpectedBucketCount?: number;
  seriesObservedBucketCount?: number;
  seriesObservedCoverageRatio?: number;
  seriesNonZeroBucketCount?: number;
  seriesPreviousWindowObservedBucketCount?: number;
  seriesRecentWindowObservedBucketCount?: number;
  seriesPreviousWindowCoverageRatio?: number;
  seriesRecentWindowCoverageRatio?: number;
  seriesPreviousAccelerationWindowObservedBucketCount?: number;
  seriesRecentAccelerationWindowObservedBucketCount?: number;
  seriesPreviousAccelerationWindowCoverageRatio?: number;
  seriesRecentAccelerationWindowCoverageRatio?: number;
  momentumSupportQualified?: boolean;
  momentumTrustScore?: number;
  growthTrusted?: boolean;
  accelerationTrusted?: boolean;
  velocityTrusted?: boolean;
  noveltyTrusted?: boolean;
  attentionMetricTrusted?: boolean;
  breakoutMomentumTrusted?: boolean;
  confidenceScore: number;
  freshnessScore: number;
  freshnessState: TrendFreshnessState;
  sampleSize: number;
  supportingThreadCount: number;
  lowDataWarning: boolean;
  growthRate: number;
  attentionAcceleration: number;
  mentions: number;
  platforms: PlatformId[];
  platformSpread: number;
  confirmedPlatformSpread: number;
  attentionHistory: TimeSeriesPoint[];
  platformBreakdown: TrendPlatformBreakdown;
  topPosts: TrendTopPost[];
  lifecycleStage: TrendLifecycleStage;
  originPlatform: PlatformId;
  platformMigrationPath: PlatformId[];
  attentionDrivers: TrendAttentionDriver[];
  hasSpike: boolean;
  spikeMagnitude?: number;
  clusterId: string;
  clusterName: string;
  clusterTopicKeys?: string[] | null;
  trendStrengthScore: number;
  persistenceScore: number;
  isEarlyTrend: boolean;
  positionChange24h: number;
  googleSearchInterest: TrendGoogleSearchInterest | null;
  blueskySummary?: TrendBlueskySummary | null;
  blueskyDetail?: TrendBlueskyDetail | null;
  linkedCoins?: NarrativeLinkedCoin[];
};

export type TrendLabelType =
  | "canonical_url_title"
  | "entity_label"
  | "repeated_phrase"
  | "hashtag_label"
  | "cleaned_singleton_text"
  | "ai_generated"
  | "fallback_generated";

export type FastestGrowingTrend = {
  id: string;
  name: string;
  growthRate: number;
  attentionAcceleration: number;
  attentionScore: number;
  emergingScore: number;
  attentionInteractions: number;
  confidenceScore: number;
  lowDataWarning: boolean;
  platformSpread: number;
  supportingThreadCount: number;
  lifecycleStage: TrendLifecycleStage;
  hasSpike: boolean;
  deltaLabel: string;
  positionChange24h: number;
  blueskySummary?: TrendBlueskySummary | null;
};

export type RelatedTrend = {
  id: string;
  name: string;
  attentionScore: number;
  attentionInteractions: number;
  growthRate: number;
  lifecycleStage: TrendLifecycleStage;
};

export type TrendDetailVM = {
  trend: RankedTrend;
  attentionGraph: TimeSeriesPoint[];
  attentionWindow: TimeSeriesWindow | null;
  platformBreakdown: TrendPlatformBreakdown;
  topPosts: TrendTopPost[];
  relatedTrends: RelatedTrend[];
  blueskyDetail?: TrendBlueskyDetail | null;
};

export type CorrelatedMemecoinLink = {
  topicKey: string;
  topicLabel: string;
  trendCategory?: string | null;
  narrativeSummary?: string | null;
  lexicalScore: number;
  mentionScore: number;
  timingScore: number;
  cultureFitScore: number;
  linkScore: number;
  supportPostCount: number;
  supportInteractionScore: number;
  isPrimary: boolean;
  whyLinked?: string | null;
  matchReasons?: string[] | null;
  rawMatchSignals?: Record<string, unknown> | null;
};

export type MemecoinExternalLink = {
  label?: string | null;
  type?: string | null;
  url: string;
};

export type CorrelatedMemecoinRow = {
  id: string;
  rank: number;
  chainId: string;
  chainLabel: string;
  dexId?: string | null;
  tokenAddress: string;
  pairAddress: string;
  pairLabels?: string[] | null;
  name: string;
  symbol: string;
  quoteSymbol?: string | null;
  quoteTokenName?: string | null;
  strongestTrendKey: string;
  strongestTrendLabel: string;
  strongestTrendCategory?: string | null;
  strongestTrendSummary?: string | null;
  correlationScore: number;
  correlationLabel: string;
  marketScore?: number | null;
  liquidityUsd?: number | null;
  volume24hUsd?: number | null;
  volume6hUsd?: number | null;
  volume1hUsd?: number | null;
  priceUsd?: number | null;
  priceChange5mPct?: number | null;
  priceChange1hPct?: number | null;
  priceChange6hPct?: number | null;
  priceChange24hPct?: number | null;
  pairAgeHours?: number | null;
  buys24h?: number | null;
  sells24h?: number | null;
  txns24h?: number | null;
  txns6h?: number | null;
  txns1h?: number | null;
  fdvUsd?: number | null;
  marketCapUsd?: number | null;
  iconUrl?: string | null;
  headerUrl?: string | null;
  description?: string | null;
  websites?: MemecoinExternalLink[] | null;
  socials?: MemecoinExternalLink[] | null;
  tradingviewSymbol?: string | null;
  tradingviewExchange?: string | null;
  hasVerifiedTradingviewPreview?: boolean | null;
  tvResolutionStatus?: string | null;
  tvLastCheckedAt?: string | null;
  tvFailureReason?: string | null;
  isLive?: boolean | null;
  lastValidatedAt?: string | null;
  validationStatus?: string | null;
  validationReason?: string | null;
  lastSeenLiquidityUsd?: number | null;
  lastSeenVolume24hUsd?: number | null;
  lastSeenTxns24h?: number | null;
  tvSearchAttempts?: number | null;
  memecoinFitScore?: number | null;
  seedTerms?: string[] | null;
  discoverySources?: string[] | null;
  matchedTrendKeys?: string[] | null;
  communityTakeover?: boolean | null;
  links?: CorrelatedMemecoinLink[] | null;
  confidenceBand?: string | null;
  whyLinked?: string | null;
  matchReasons?: string[] | null;
  rawMatchSignals?: Record<string, unknown> | null;
  momentumScore?: number | null;
  momentumRank?: number | null;
  momentumSignal?: string | null;
  dexscreenerUrl: string;
  updatedAt: string | null;
};

export type CorrelatedMemecoinBoardDiagnostics = {
  runsUsed: number;
  rowsConsidered: number;
  rowsVerified: number;
  rowsExcluded: number;
  displayedRows: number;
  coverageRatePct: number;
  schemaCompatibility?: {
    assetLiveValidationColumnsAvailable: boolean;
    assetColumns?: string[] | null;
  } | null;
  producerStageCounts?: Record<string, number> | null;
  dbStageCounts?: Record<string, number> | null;
  readValidationStageCounts?: Record<string, number> | null;
  unresolvedReasonCounts?: Record<string, number> | null;
  statusCounts?: Record<string, number> | null;
  liveValidationRejectCounts?: Record<string, number> | null;
  liveValidationDecisionSourceCounts?: Record<string, number> | null;
  liveValidationFallbackReasonCounts?: Record<string, number> | null;
  thresholdDiagnostics?:
    | {
        producer?: Record<string, number> | null;
        read?: Record<string, number> | null;
        mismatchKeys?: string[] | null;
        producerSource?: string | null;
      }
    | null;
  averageSearchAttemptsPerCoin?: number | null;
  latestRunPreviewDiagnostics?: Record<string, unknown> | null;
};

export type CorrelatedMemecoinBoard = {
  runId: number | null;
  updatedAt: string | null;
  rows: CorrelatedMemecoinRow[];
  diagnostics?: CorrelatedMemecoinBoardDiagnostics | null;
};

export type NarrativeLinkedCoin = {
  id: string;
  symbol: string;
  name: string;
  address: string;
  confidence: number;
  confidenceBand?: string | null;
  liquidity?: number | null;
  volume?: number | null;
  age?: number | null;
  priceUsd?: number | null;
  priceChange1hPct?: number | null;
  priceChange6hPct?: number | null;
  priceChange24hPct?: number | null;
  marketCap?: number | null;
  fdv?: number | null;
  iconUrl?: string | null;
  quoteSymbol?: string | null;
  websites?: MemecoinExternalLink[] | null;
  socials?: MemecoinExternalLink[] | null;
  tradingviewSymbol?: string | null;
  mentionCount?: number | null;
  engagementScore?: number | null;
  chainId?: string | null;
  pairAddress?: string | null;
  dexscreenerUrl?: string | null;
  isLive?: boolean | null;
  lastValidatedAt?: string | null;
  validationStatus?: string | null;
  validationReason?: string | null;
  lastSeenLiquidityUsd?: number | null;
  lastSeenVolume24hUsd?: number | null;
  lastSeenTxns24h?: number | null;
  marketScore?: number | null;
  memecoinFitScore?: number | null;
  whyLinked?: string | null;
  matchReasons?: string[] | null;
  rawMatchSignals?: Record<string, unknown> | null;
  lastUpdatedAt: string | null;
};

export type TrendDashboardQuery = {
  scope: TrendScope;
  range: DateRangePreset;
  sort: TrendSort;
  mode?: TrendLeaderboardMode;
  selectedId?: string;
  selectedKey?: string;
};

export type DashboardRuntimeSource =
  | "ai_native_canonical"
  | "live_ai_named"
  | "supabase_live"
  | "runtime_snapshot"
  | "local_raw_rebuild"
  | "zero_state";

export type DashboardRuntimeBundleOrigin =
  | "startup_rebuild"
  | "local_rebuild"
  | "background_refresh"
  | "manual_full_regroup"
  | "legacy_bootstrap";

export type DashboardServingMode = "fresh" | "stale_fallback" | "empty";

export type DashboardRefreshMode =
  | "local_rebuild"
  | "manual_full_regroup"
  | "external_refresh";

export type DashboardRefreshStatus =
  | "idle"
  | "scheduled"
  | "running"
  | "succeeded"
  | "failed";

export type DashboardRefreshState = {
  status: DashboardRefreshStatus;
  mode: DashboardRefreshMode;
  trigger: string;
  requestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  latestBundleGeneratedAt?: string | null;
  latestSourceSnapshotGeneratedAt?: string | null;
  ownerPid?: number | null;
  ownerSessionId?: string | null;
  staleClearedAt?: string | null;
  staleReason?: string | null;
};

export type DashboardSourceFreshness = {
  sourceId: string;
  sourceLabel: string;
  platformId: PlatformId;
  sourceStatus?: string | null;
  itemCount: number;
  lastFetchedAt: string | null;
  latestCreatedAt: string | null;
  ageMinutes: number | null;
};

export type DashboardTimingEntry = {
  name: string;
  durationMs: number;
  count?: number;
};

export type DashboardRequestTimings = {
  totalMs: number;
  runtimeSnapshotReadMs: number;
  sourceManifestReadMs: number;
  localRawReadMs: number;
  analyticsBuildMs: number;
  variantBuildMs: number;
  sqliteWriteMs: number;
  steps: DashboardTimingEntry[];
  perQueryBuilds: DashboardTimingEntry[];
};

export type DashboardFreshnessDiagnostics = {
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
  workerHeartbeatAt?: string | null;
  workerCurrentStage?: string | null;
  workerLastSuccessfulWriteAt?: string | null;
  maxSourceTimestampSeen?: string | null;
  maxWrittenTimestamp?: string | null;
  maxProcessedTimestamp?: string | null;
  maxAggregateTimestamp?: string | null;
  pipelineLagSeconds?: number | null;
  backlogSize?: number | null;
  unprocessedBacklogSize?: number | null;
  pipelineHealthState?: "live" | "delayed" | "degraded" | "stale" | "disconnected" | null;
  latestRunId?: number | null;
  latestRunAt?: string | null;
  latestRunCompletedAt?: string | null;
  latestRunStatus?: "succeeded" | "failed" | null;
  latestRunTrigger?: string | null;
  latestRunErrorMessage?: string | null;
  latestRunRuntimePath?: string | null;
  latestRunExecutionEnvironment?: string | null;
  latestSuccessfulRunId?: number | null;
  latestSuccessfulRunAt?: string | null;
  latestSuccessfulRunCompletedAt?: string | null;
  latestSuccessfulRunCandidateCount?: number | null;
  latestSuccessfulRunEvidenceCount?: number | null;
  latestSuccessfulRunNarrativeCount?: number | null;
  latestSuccessfulTrigger?: string | null;
  latestSuccessfulRuntimePath?: string | null;
  latestSuccessfulExecutionEnvironment?: string | null;
  latestFailureRunId?: number | null;
  latestFailureAt?: string | null;
  latestFailureTrigger?: string | null;
  latestFailureErrorMessage?: string | null;
  latestFailureRuntimePath?: string | null;
  latestFailureExecutionEnvironment?: string | null;
  latestRunCandidateCount?: number | null;
  latestRunEvidenceCount?: number | null;
  latestRunNarrativeCount?: number | null;
  boardTargetCount?: number | null;
  boardServedNarrativeCount?: number | null;
  boardFreshNarrativeCount?: number | null;
  boardBackfillNarrativeCount?: number | null;
  schedulerStrategy?: string | null;
  schedulerLabel?: string | null;
  schedulerExpectedIntervalSeconds?: number | null;
  cronAuthorizationConfigured?: boolean | null;
  cronSecretSources?: string[] | null;
  apiResponseAt: string | null;
  sourceSnapshotAt: string | null;
  selectedTrendLatestDataAt: string | null;
  selectedTrendLatestPointAt: string | null;
  renderedStaleReferenceAt: string | null;
  renderedStaleReferenceSource: "source_snapshot" | "latest_point" | "latest_data" | null;
  chainBreakStage:
    | "ingestion"
    | "processing"
    | "read_model_refresh"
    | "api_cache"
    | "render_stale_field"
    | "none"
    | null;
  agesMinutes: {
    ingestion: number | null;
    processed: number | null;
    mentionEvent: number | null;
    readModelFinalize: number | null;
    readModelWrite: number | null;
    readModelWindowEnd: number | null;
    workerLastEvent: number | null;
    sourceSnapshot: number | null;
    selectedLatestPoint: number | null;
    selectedLatestData: number | null;
    renderedStaleReference: number | null;
  };
};

export type DashboardDataStatus = {
  stateSource: DashboardRuntimeSource;
  bundleOrigin: DashboardRuntimeBundleOrigin | null;
  servingMode?: DashboardServingMode | null;
  showing:
    | "ai_native_canonical"
    | "live_ai_named"
    | "supabase_live"
    | "cached_local"
    | "fresh_local_rebuild"
    | "zero_state";
  serverNow?: string | null;
  responseVersion?: string | null;
  runtimeSnapshotGeneratedAt: string | null;
  sourceSnapshotGeneratedAt: string | null;
  latestFetchedAt: string | null;
  runtimeSnapshotAvailable: boolean;
  localRawDataAvailable: boolean;
  runtimeSnapshotStale: boolean;
  sourceFreshness: DashboardSourceFreshness[];
  freshnessDiagnostics?: DashboardFreshnessDiagnostics | null;
  refresh: DashboardRefreshState | null;
  timings: DashboardRequestTimings | null;
};

export type TrendCoverageDebug = {
  source: "bluesky";
  rankingSource: "ai_grouped_clusters";
  windowHours: number;
  totalInteractionsInWindow: number;
  totalInteractionsAssignedToTrends: number;
  unassignedInteractionsCount: number;
  totalRootsInWindow: number;
  eligibleRootsCount: number;
  assignedRootsCount: number;
  unassignedRootCount: number;
  nonAiAssignedRootCount: number;
  groupedRootsCount: number;
  singletonRootsCount: number;
  totalTrendsReturned: number;
  groupedTrendCount: number;
  singletonTrendCount: number;
  urlAnchorGroupCount: number;
  aiClusterGroupCount: number;
  templateSeriesCount: number;
  lowInformationTrendCount: number;
  fallbackLabelCount: number;
  lowQualityLabelCount: number;
  aiLabeledCount: number;
  aiAttempted: boolean;
  aiClientInitialized: boolean;
  aiCredentialSource: string | null;
  aiCredentialFingerprint: string | null;
  aiModel: string | null;
  aiProcessedRootCount: number;
  aiProcessedFreshRootCount: number;
  aiCacheHitCount: number;
  aiFreshCallCount: number;
  aiBatchCount: number;
  aiBatchFailureCount: number;
  aiFailedRootCount: number;
  aiAssignmentCoveragePct: number;
  aiIncomplete: boolean;
  aiIncompleteReason: string | null;
  groupingRunMode: "incremental_live" | "manual_full_regroup";
  lastAiGroupingRunAt: string | null;
  lastSuccessfulFullRegroupAt: string | null;
  leaderboardSource: "ai_grouped_clusters";
  displayedRowsCount: number;
  displayedAiGroupedRowsCount: number;
  displayedSingletonRowsCount: number;
  displayedFallbackRowsCount: number;
  displayedLowInformationRowsCount: number;
  latestInteractionAt: string | null;
  firehoseLagMinutes: number | null;
};

export type TrendDashboardVM = {
  query: TrendDashboardQuery;
  ingestionHealth: RedditIngestionHealth | null;
  dataStatus?: DashboardDataStatus | null;
  blueskyOverview?: BlueskyFirehoseOverview | null;
  trendCoverage?: TrendCoverageDebug | null;
  marketMemecoins?: CorrelatedMemecoinBoard | null;
  correlatedMemecoins?: CorrelatedMemecoinBoard | null;
  leaderboards: Record<TrendLeaderboardMode, RankedTrend[]>;
  leaderboard: RankedTrend[];
  overviewSeries: Array<{
    id: string;
    name: string;
    selected: boolean;
    color: string;
    points: TimeSeriesPoint[];
    window: TimeSeriesWindow | null;
  }>;
  detail: TrendDetailVM | null;
};
