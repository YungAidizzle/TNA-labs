export type PlatformId =
  | "bluesky"
  | "x"
  | "reddit"
  | "telegram"
  | "youtube"
  | "tiktok"
  | "google"
  | "news";

export type DateRangePreset = "1h" | "6h" | "24h" | "7d";

export type TrendScope = "overall" | "memes";

export type TrendLifecycleStage =
  | "Unknown"
  | "Emerging"
  | "Expanding"
  | "Established"
  | "Fading"
  | "Declining";

export type TrendFreshnessState = "fresh" | "mixed" | "delayed" | "stale";

export type EntityKind = "trend" | "coin";

export type NarrativeStage = "emerging" | "accelerating" | "established";

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export type AlertType =
  | "breakout"
  | "spread"
  | "ignition"
  | "shock"
  | "watchlist";

export type SentimentDistribution = {
  positive: number;
  neutral: number;
  negative: number;
};

export type TimeSeriesPoint = {
  timestamp: string;
  value: number;
};

export type TimeSeriesMetric =
  | "mentions"
  | "engagement"
  | "velocity"
  | "sentiment"
  | "price"
  | "volume"
  | "attention";

export type AttentionInputs = {
  mentionVelocity: number;
  engagementGrowth: number;
  platformSpread: number;
  searchInterest: number;
  reposts: number;
  likes: number;
  videoViews: number;
  commentActivity: number;
};

export type Platform = {
  id: PlatformId;
  name: string;
  shortName: string;
  accent: string;
  description: string;
  velocity: number;
  engagementDensity: number;
};

export type Narrative = {
  id: string;
  trendName: string;
  summary: string;
  keywords: string[];
  scopeTags: TrendScope[];
  mentionCount: number;
  attentionVelocity: number;
  engagementScore: number;
  attentionInputs: AttentionInputs;
  platformsDetected: PlatformId[];
  influencerActivity: number;
  sentimentDistribution: SentimentDistribution;
  anomalyScore: number;
  confidenceScore: number;
  healthScore: number;
  createdAt: string;
  updatedAt: string;
  stage: NarrativeStage;
  category: string;
  clusterId: string;
  clusterName: string;
  coordinates: [number, number];
};

export type Memecoin = {
  id: string;
  symbol: string;
  name: string;
  chain: "Solana" | "Base" | "Ethereum" | "BSC" | "Tron";
  summary: string;
  keywords: string[];
  priceUsd: number;
  change5m: number;
  change1h: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  liquidityUsd: number;
  holderDelta24h: number;
  smartMoneyScore: number;
  socialDominance: number;
  attentionVelocity: number;
  sentimentDistribution: SentimentDistribution;
  riskFlags: string[];
  platformsDetected: PlatformId[];
  updatedAt: string;
  coordinates: [number, number];
};

export type TrendMemecoinLink = {
  id: string;
  narrativeId: string;
  memecoinId: string;
  strength: number;
  reason: string;
};

export type Post = {
  id: string;
  narrativeId: string;
  platformId: PlatformId;
  author: string;
  content: string;
  timestamp: string;
  engagement: number;
  sentiment: number;
  url: string;
  influencerId?: string;
};

export type Influencer = {
  id: string;
  name: string;
  handle: string;
  platformFootprint: PlatformId[];
  reachScore: number;
  momentumScore: number;
  suspiciousAmplification: number;
  narrativesDriven: string[];
  recentPostIds: string[];
  coordinates: [number, number];
};

export type Alert = {
  id: string;
  entityKind: EntityKind;
  entityId: string;
  severity: AlertSeverity;
  type: AlertType;
  title: string;
  detail: string;
  platformIds: PlatformId[];
  timestamp: string;
  read: boolean;
  snoozedUntil?: string;
  tags: string[];
};

export type SentimentSnapshot = {
  id: string;
  entityKind: EntityKind;
  entityId: string;
  platformId: PlatformId;
  timestamp: string;
  netSentiment: number;
  confidence: number;
  intensity: number;
};

export type TimeSeriesAggregate = {
  id: string;
  entityKind: EntityKind;
  entityId: string;
  metric: TimeSeriesMetric;
  points: TimeSeriesPoint[];
};

export type TrendPlatformTimeline = {
  id: string;
  trendId: string;
  platformId: PlatformId;
  points: TimeSeriesPoint[];
};

export type SpreadEvent = {
  id: string;
  narrativeId: string;
  sourcePlatformId: PlatformId;
  targetPlatformId: PlatformId;
  magnitude: number;
  timestamp: string;
};

export type KeywordCluster = {
  id: string;
  label: string;
  keywords: string[];
  intensity: number;
  sentiment: number;
  momentum: number;
  narrativeIds: string[];
};

export type WatchlistItem = {
  key: string;
  kind: EntityKind;
  id: string;
  priority: number;
  addedAt: string;
};

export type DatasetDefinition = {
  id: string;
  name: string;
  description: string;
  intervals: string[];
  historicalDepth: string;
  endpoint: string;
  schema: Array<{ field: string; type: string; description: string }>;
  sample: Record<string, string | number | boolean | string[] | null>;
};

export type GlobalFilters = {
  range: DateRangePreset;
  platforms: PlatformId[];
};
