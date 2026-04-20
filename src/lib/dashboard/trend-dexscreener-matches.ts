import "server-only";

import {
  revalidateNarrativeLinkedCoins,
} from "@/lib/dashboard/dexscreener-live-validation";
import { getTrendDisplayNameOrPlaceholder } from "@/lib/dashboard/trend-name-state";
import { getServerPostgresPool, hasDatabaseUrl } from "@/lib/db/server-postgres";
import type {
  MemecoinExternalLink,
  NarrativeLinkedCoin,
  RankedTrend,
  TrendDashboardVM,
} from "@/types/view-models";

const DEXSCREENER_SEARCH_URL = "https://api.dexscreener.com/latest/dex/search";
const MAX_STORED_MATCHES_PER_TREND = 5;
const MAX_VALIDATED_CANDIDATES_PER_TREND = 12;
const SEARCH_QUERY_LIMIT = 3;
const SEARCH_CONCURRENCY = 1;
const DEX_SEARCH_MIN_INTERVAL_MS = 900;
const DEX_SEARCH_RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SUPPORTED_QUOTE_BONUS: Record<string, number> = {
  SOL: 6,
  USDC: 6,
  USDT: 6,
  WETH: 5,
  ETH: 5,
  WBNB: 4,
  BNB: 4,
};
const CHAIN_BONUS: Record<string, number> = {
  solana: 6,
  base: 5,
  ethereum: 5,
  bsc: 4,
};
const COIN_SUFFIX_TOKENS = new Set([
  "coin",
  "coins",
  "cto",
  "dog",
  "doge",
  "inu",
  "meme",
  "memecoin",
  "official",
  "token",
  "tokens",
]);
const STOP_TOKENS = new Set([
  "a",
  "about",
  "after",
  "all",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "for",
  "from",
  "has",
  "have",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "with",
]);
const GENERIC_TREND_TOKENS = new Set([
  "ai",
  "alert",
  "board",
  "campaign",
  "clip",
  "clips",
  "coin",
  "coins",
  "community",
  "compute",
  "conflict",
  "coverage",
  "crypto",
  "culture",
  "cycle",
  "daily",
  "debate",
  "discussion",
  "drama",
  "economy",
  "event",
  "focus",
  "headline",
  "headlines",
  "hype",
  "internet",
  "latest",
  "macro",
  "market",
  "markets",
  "media",
  "meme",
  "memecoin",
  "moment",
  "narrative",
  "narratives",
  "news",
  "panic",
  "policy",
  "push",
  "race",
  "reaction",
  "risk",
  "rotation",
  "saga",
  "signal",
  "signals",
  "social",
  "spiral",
  "story",
  "surge",
  "takeover",
  "theme",
  "trend",
  "trends",
  "update",
  "updates",
  "viral",
  "watch",
  "wave",
]);
const QUERY_FILLER_TOKENS = new Set([
  "cycle",
  "focus",
  "mania",
  "panic",
  "push",
  "race",
  "risk",
  "rotation",
  "spiral",
  "story",
  "surge",
  "watch",
  "wave",
]);

type TrendDexNarrativeSource = {
  topicKey: string;
  topicLabel: string;
  summary: string | null;
  keyEntities: string[];
  sourceRunId: number | null;
  sourceNarrativeId: number | null;
};

type StoredTrendDexMatchRow = {
  topic_key: string;
  rank: number;
  search_query: string;
  query_aliases_json: unknown;
  chain_id: string;
  coin_address: string;
  pair_address: string | null;
  dexscreener_url: string | null;
  dex_id: string | null;
  coin_symbol: string;
  coin_name: string;
  quote_symbol: string | null;
  quote_token_name: string | null;
  price_usd: number | null;
  price_change_1h_pct: number | null;
  price_change_6h_pct: number | null;
  price_change_24h_pct: number | null;
  liquidity_usd: number | null;
  volume_24h_usd: number | null;
  fdv_usd: number | null;
  market_cap_usd: number | null;
  pair_created_at: string | null;
  market_score: number | null;
  relevance_score: number;
  match_reasons_json: unknown;
  raw_match_signals_json: unknown;
  websites_json: unknown;
  socials_json: unknown;
  icon_url: string | null;
  last_updated_at: string | null;
  is_live: boolean | null;
  last_validated_at: string | null;
  validation_status: string | null;
  validation_reason: string | null;
  last_seen_liquidity_usd: number | null;
  last_seen_volume_h24: number | null;
  last_seen_txns_h24: number | null;
};

type ExistingTrendDexMatchMetadataRow = {
  topic_key: string;
  topic_label: string;
  source_run_id: number | null;
  row_count: number;
};

type DexPairTxnBucket = {
  buys?: unknown;
  sells?: unknown;
};

type DexSearchPair = {
  chainId?: unknown;
  dexId?: unknown;
  url?: unknown;
  pairAddress?: unknown;
  pairCreatedAt?: unknown;
  labels?: unknown;
  fdv?: unknown;
  marketCap?: unknown;
  priceUsd?: unknown;
  liquidity?: {
    usd?: unknown;
  } | null;
  volume?: {
    h24?: unknown;
    h6?: unknown;
    h1?: unknown;
  } | null;
  priceChange?: {
    h24?: unknown;
    h6?: unknown;
    h1?: unknown;
  } | null;
  txns?: {
    h24?: DexPairTxnBucket | null;
    h6?: DexPairTxnBucket | null;
    h1?: DexPairTxnBucket | null;
  } | null;
  baseToken?: {
    address?: unknown;
    name?: unknown;
    symbol?: unknown;
  } | null;
  quoteToken?: {
    name?: unknown;
    symbol?: unknown;
  } | null;
  info?: {
    imageUrl?: unknown;
    websites?: unknown;
    socials?: unknown;
  } | null;
};

type PhraseProfile = {
  raw: string;
  normalized: string;
  compact: string;
  tokens: string[];
  distinctiveTokens: string[];
};

type TrendSearchProfile = {
  topicKey: string;
  topicLabel: string;
  summary: string | null;
  keyEntities: string[];
  sourceRunId: number | null;
  sourceNarrativeId: number | null;
  queries: string[];
  aliasProfiles: PhraseProfile[];
  distinctiveTokens: Set<string>;
  summaryTokens: Set<string>;
};

type DexCandidateMatchKind =
  | "exact_name"
  | "compact_name"
  | "alias_phrase"
  | "entity_phrase"
  | "symbol_match"
  | "token_overlap"
  | "single_token";

type RankedDexCandidate = {
  topicKey: string;
  topicLabel: string;
  sourceRunId: number | null;
  sourceNarrativeId: number | null;
  searchQuery: string;
  queryAliases: string[];
  chainId: string;
  coinAddress: string;
  pairAddress: string | null;
  dexscreenerUrl: string | null;
  dexId: string | null;
  coinSymbol: string;
  coinName: string;
  quoteSymbol: string | null;
  quoteTokenName: string | null;
  priceUsd: number | null;
  priceChange1hPct: number | null;
  priceChange6hPct: number | null;
  priceChange24hPct: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  pairCreatedAt: string | null;
  marketScore: number;
  relevanceScore: number;
  matchReasons: string[];
  rawMatchSignals: Record<string, unknown>;
  websites: MemecoinExternalLink[];
  socials: MemecoinExternalLink[];
  iconUrl: string | null;
  initialSearchRank: number;
};

let hasWarnedMissingTrendDexscreenerMatchesTable = false;
let lastDexSearchRequestAt = 0;

function isMissingRelationError(error: unknown) {
  const databaseError = error as { code?: string; message?: string };
  const message = String(databaseError?.message ?? "").toLowerCase();
  return databaseError?.code === "42P01" || message.includes("does not exist");
}

function warnMissingTrendDexscreenerMatchesTable(operation: string, error: unknown) {
  if (hasWarnedMissingTrendDexscreenerMatchesTable) {
    return;
  }

  hasWarnedMissingTrendDexscreenerMatchesTable = true;
  console.warn(
    "[trend-dexscreener-matches] trend_dexscreener_matches is missing; apply backend/migrations/20260420_trend_dexscreener_matches.sql",
    {
      operation,
      error: String((error as Error)?.message ?? error),
    },
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function throttleDexSearchRequests() {
  const waitMs = lastDexSearchRequestAt + DEX_SEARCH_MIN_INTERVAL_MS - Date.now();
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  lastDexSearchRequestAt = Date.now();
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[_/\\-]+/g, " ")
    .replace(/[^a-z0-9$#\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value: string | null | undefined) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function tokenize(value: string | null | undefined) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.replace(/^[$#]+/, ""))
    .filter(Boolean)
    .filter((token) => !STOP_TOKENS.has(token));
}

function isDistinctiveToken(token: string) {
  return token.length >= 4 && !GENERIC_TREND_TOKENS.has(token);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];

  values.forEach((value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      return;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    output.push(normalized);
  });

  return output;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function buildPhraseProfile(value: string | null | undefined): PhraseProfile | null {
  const raw = asString(value);
  if (!raw) {
    return null;
  }

  const tokens = tokenize(raw);
  if (tokens.length === 0) {
    return null;
  }

  return {
    raw,
    normalized: normalizeText(raw),
    compact: compactText(raw),
    tokens,
    distinctiveTokens: tokens.filter(isDistinctiveToken),
  };
}

function logScore(value: number | null | undefined, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || minimum <= 0 || maximum <= minimum) {
    return 0;
  }

  return clamp(
    (Math.log10(value) - Math.log10(minimum)) / (Math.log10(maximum) - Math.log10(minimum)),
    0,
    1,
  );
}

function readTxns(bucket: DexPairTxnBucket | null | undefined) {
  const buys = Math.max(0, Math.round(asNumber(bucket?.buys) ?? 0));
  const sells = Math.max(0, Math.round(asNumber(bucket?.sells) ?? 0));
  return buys + sells;
}

function parsePairCreatedAt(value: unknown) {
  const numeric = asNumber(value);
  if (numeric === null) {
    return null;
  }

  const timestamp = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function pairAgeHours(pairCreatedAt: string | null | undefined) {
  const timestamp = Date.parse(pairCreatedAt ?? "");
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.max(0, (Date.now() - timestamp) / 3_600_000);
}

function buildExternalLinks(
  value: unknown,
  fallbackType: MemecoinExternalLink["type"],
) {
  if (!Array.isArray(value)) {
    return [] as MemecoinExternalLink[];
  }

  return value
    .map((entry) => {
      const record = asRecord(entry);
      const url = asString(record?.url);
      if (!url) {
        return null;
      }

      return {
        label: asString(record?.label),
        type: asString(record?.type) ?? fallbackType ?? null,
        url,
      } satisfies MemecoinExternalLink;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function getTrendTopicKey(row: RankedTrend) {
  const topicKey = typeof row.canonicalKeySummary === "string" ? row.canonicalKeySummary.trim() : "";
  return topicKey || row.id;
}

function buildQueryExpansion(label: string, keyEntities: string[]) {
  const queries = [label];
  const reducedLabelTokens = tokenize(label).filter((token) => !QUERY_FILLER_TOKENS.has(token));
  const reducedLabel = reducedLabelTokens.join(" ").trim();
  if (reducedLabel && normalizeText(reducedLabel) !== normalizeText(label)) {
    queries.push(reducedLabel);
  }

  keyEntities
    .map((entity) => buildPhraseProfile(entity))
    .filter((profile): profile is PhraseProfile => Boolean(profile))
    .filter((profile) => profile.distinctiveTokens.length > 0)
    .sort((left, right) => right.distinctiveTokens.length - left.distinctiveTokens.length)
    .slice(0, 2)
    .forEach((profile) => {
      queries.push(profile.raw);
    });

  return uniqueStrings(queries).slice(0, SEARCH_QUERY_LIMIT);
}

function buildTrendSearchProfile(narrative: TrendDexNarrativeSource) {
  const queries = buildQueryExpansion(narrative.topicLabel, narrative.keyEntities);
  const aliasProfiles = uniqueStrings([
    narrative.topicLabel,
    ...queries,
    ...narrative.keyEntities,
  ])
    .map((value) => buildPhraseProfile(value))
    .filter((value): value is PhraseProfile => Boolean(value));

  return {
    ...narrative,
    queries,
    aliasProfiles,
    distinctiveTokens: new Set(aliasProfiles.flatMap((profile) => profile.distinctiveTokens)),
    summaryTokens: new Set(tokenize(narrative.summary).filter(isDistinctiveToken)),
  } satisfies TrendSearchProfile;
}

function computeMarketScore(candidate: {
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  txns24h: number | null;
  pairCreatedAt: string | null;
  quoteSymbol: string | null;
  dexscreenerUrl: string | null;
  websites: MemecoinExternalLink[];
  socials: MemecoinExternalLink[];
  chainId: string;
}) {
  const liquidityScore = logScore(candidate.liquidityUsd, 5_000, 750_000);
  const volumeScore = logScore(candidate.volume24hUsd, 10_000, 2_500_000);
  const txnsScore = logScore(candidate.txns24h, 20, 5_000);
  const ageHours = pairAgeHours(candidate.pairCreatedAt);
  const ageScore =
    ageHours === null
      ? 0.28
      : ageHours < 1
        ? 0.06
        : ageHours < 6
          ? 0.24
          : ageHours < 24
            ? 0.6
            : ageHours < 24 * 14
              ? 1
              : ageHours < 24 * 90
                ? 0.78
                : 0.5;
  const quoteBonus = SUPPORTED_QUOTE_BONUS[(candidate.quoteSymbol ?? "").toUpperCase()] ?? 2;
  const chainBonus = CHAIN_BONUS[candidate.chainId.toLowerCase()] ?? 1;
  const tradabilitySignals =
    (candidate.dexscreenerUrl ? 1 : 0) +
    (candidate.websites.length > 0 ? 1 : 0) +
    (candidate.socials.length > 0 ? 1 : 0);

  return Math.round(
    clamp(
      liquidityScore * 28 +
        volumeScore * 24 +
        txnsScore * 16 +
        ageScore * 14 +
        tradabilitySignals * 4 +
        quoteBonus +
        chainBonus,
      0,
      100,
    ),
  );
}

function confidenceBandForScore(score: number) {
  if (score >= 90) {
    return "high";
  }
  if (score >= 78) {
    return "medium";
  }
  if (score >= 62) {
    return "speculative";
  }
  return "coverage";
}

function candidateIdentityKey(candidate: { chainId: string; coinAddress: string }) {
  return `${candidate.chainId.toLowerCase()}:${candidate.coinAddress.toLowerCase()}`;
}

function compareRankedDexCandidates(left: RankedDexCandidate, right: RankedDexCandidate) {
  if (left.relevanceScore !== right.relevanceScore) {
    return right.relevanceScore - left.relevanceScore;
  }

  const marketDelta = right.marketScore - left.marketScore;
  if (marketDelta !== 0) {
    return marketDelta;
  }

  const volumeDelta = Number(right.volume24hUsd ?? 0) - Number(left.volume24hUsd ?? 0);
  if (volumeDelta !== 0) {
    return volumeDelta;
  }

  const liquidityDelta = Number(right.liquidityUsd ?? 0) - Number(left.liquidityUsd ?? 0);
  if (liquidityDelta !== 0) {
    return liquidityDelta;
  }

  return left.initialSearchRank - right.initialSearchRank;
}

function buildLinkedCoin(candidate: RankedDexCandidate): NarrativeLinkedCoin {
  return {
    id: `${candidate.chainId}:${candidate.coinAddress}`,
    symbol: candidate.coinSymbol,
    name: candidate.coinName,
    address: candidate.coinAddress,
    confidence: candidate.relevanceScore,
    confidenceBand: confidenceBandForScore(candidate.relevanceScore),
    liquidity: candidate.liquidityUsd,
    volume: candidate.volume24hUsd,
    age: pairAgeHours(candidate.pairCreatedAt),
    priceUsd: candidate.priceUsd,
    priceChange1hPct: candidate.priceChange1hPct,
    priceChange6hPct: candidate.priceChange6hPct,
    priceChange24hPct: candidate.priceChange24hPct,
    marketCap: candidate.marketCapUsd,
    fdv: candidate.fdvUsd,
    iconUrl: candidate.iconUrl,
    quoteSymbol: candidate.quoteSymbol,
    websites: candidate.websites,
    socials: candidate.socials,
    chainId: candidate.chainId,
    pairAddress: candidate.pairAddress,
    dexscreenerUrl: candidate.dexscreenerUrl,
    marketScore: candidate.marketScore,
    whyLinked: candidate.matchReasons[0] ?? null,
    matchReasons: candidate.matchReasons,
    rawMatchSignals: candidate.rawMatchSignals,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function scoreDexCandidate(
  trend: TrendSearchProfile,
  pair: DexSearchPair,
  searchQuery: string,
  initialSearchRank: number,
): RankedDexCandidate | null {
  const chainId = asString(pair.chainId)?.toLowerCase() ?? null;
  const coinAddress = asString(pair.baseToken?.address) ?? null;
  const coinName = asString(pair.baseToken?.name) ?? null;
  const coinSymbol = asString(pair.baseToken?.symbol) ?? null;
  const pairAddress = asString(pair.pairAddress);
  const dexscreenerUrl = asString(pair.url);
  if (!chainId || !coinAddress || !coinName || !coinSymbol || !pairAddress || !dexscreenerUrl) {
    return null;
  }

  const coinProfile = buildPhraseProfile(coinName);
  if (!coinProfile) {
    return null;
  }

  const symbolProfile = buildPhraseProfile(coinSymbol);
  const symbolToken = symbolProfile?.tokens[0] ?? normalizeText(coinSymbol);
  const summaryTokenOverlap = Array.from(trend.summaryTokens).filter((token) =>
    coinProfile.tokens.includes(token) || symbolToken === token,
  );
  const sharedDistinctiveTokens = Array.from(trend.distinctiveTokens).filter((token) =>
    coinProfile.tokens.includes(token) || symbolToken === token,
  );

  let bestKind: DexCandidateMatchKind | null = null;
  let bestAlias: string | null = null;
  let bestScore = 0;
  const reasons: string[] = [];

  trend.aliasProfiles.forEach((aliasProfile) => {
    if (coinProfile.normalized === aliasProfile.normalized) {
      if (62 > bestScore) {
        bestKind = "exact_name";
        bestAlias = aliasProfile.raw;
        bestScore = 62;
      }
      return;
    }

    if (coinProfile.compact.length >= 4 && coinProfile.compact === aliasProfile.compact) {
      if (60 > bestScore) {
        bestKind = "compact_name";
        bestAlias = aliasProfile.raw;
        bestScore = 60;
      }
      return;
    }

    const aliasContainedInCoin =
      aliasProfile.normalized.length >= 4 &&
      coinProfile.normalized.includes(aliasProfile.normalized);
    const coinContainedInAlias =
      coinProfile.normalized.length >= 4 &&
      aliasProfile.normalized.includes(coinProfile.normalized);
    const coinExtraTokens = coinProfile.tokens.filter((token) => !aliasProfile.tokens.includes(token));

    if (
      (aliasContainedInCoin || coinContainedInAlias) &&
      aliasProfile.distinctiveTokens.length > 0 &&
      coinExtraTokens.every((token) => COIN_SUFFIX_TOKENS.has(token))
    ) {
      if (56 > bestScore) {
        bestKind = "alias_phrase";
        bestAlias = aliasProfile.raw;
        bestScore = 56;
      }
    }

    if (
      (aliasContainedInCoin || coinContainedInAlias) &&
      aliasProfile.distinctiveTokens.length === 1 &&
      aliasProfile.distinctiveTokens[0] &&
      aliasProfile.distinctiveTokens[0].length >= 5 &&
      coinExtraTokens.length <= 1
    ) {
      if (52 > bestScore) {
        bestKind = "entity_phrase";
        bestAlias = aliasProfile.raw;
        bestScore = 52;
      }
    }

    if (symbolToken && aliasProfile.distinctiveTokens.includes(symbolToken) && isDistinctiveToken(symbolToken)) {
      if (50 > bestScore) {
        bestKind = "symbol_match";
        bestAlias = aliasProfile.raw;
        bestScore = 50;
      }
    }
  });

  if (bestKind === null) {
    if (sharedDistinctiveTokens.length >= 2) {
      bestKind = "token_overlap";
      bestAlias = sharedDistinctiveTokens.join(", ");
      bestScore = 46;
    } else if (
      sharedDistinctiveTokens.length === 1 &&
      sharedDistinctiveTokens[0] &&
      sharedDistinctiveTokens[0].length >= 5 &&
      coinProfile.distinctiveTokens.length <= 2
    ) {
      bestKind = "single_token";
      bestAlias = sharedDistinctiveTokens[0];
      bestScore = 39;
    }
  }

  if (!bestKind || !bestAlias || bestScore <= 0) {
    return null;
  }

  const liquidityUsd = asNumber(pair.liquidity?.usd);
  const volume24hUsd = asNumber(pair.volume?.h24);
  const txns24h = readTxns(pair.txns?.h24);
  const quoteSymbol = asString(pair.quoteToken?.symbol);
  const quoteTokenName = asString(pair.quoteToken?.name);
  const websites = buildExternalLinks(pair.info?.websites, "website");
  const socials = buildExternalLinks(pair.info?.socials, "social");
  const coinShapeBonus =
    coinProfile.tokens.some((token) => COIN_SUFFIX_TOKENS.has(token)) ||
    (Array.isArray(pair.labels) &&
      pair.labels.some((label) => String(label ?? "").toLowerCase().includes("meme")))
      ? 4
      : 0;
  const summaryOverlapBonus = Math.min(4, summaryTokenOverlap.length * 2);
  const marketScore = computeMarketScore({
    liquidityUsd,
    volume24hUsd,
    txns24h,
    pairCreatedAt: parsePairCreatedAt(pair.pairCreatedAt),
    quoteSymbol,
    dexscreenerUrl,
    websites,
    socials,
    chainId,
  });
  const relevanceScore = Math.round(
    clamp(
      bestScore +
        marketScore * 0.32 +
        coinShapeBonus +
        summaryOverlapBonus -
        Math.min(6, initialSearchRank * 0.6),
      0,
      100,
    ),
  );

  const finalKind = bestKind as DexCandidateMatchKind;

  if (
    (finalKind === "single_token" && relevanceScore < 60) ||
    (finalKind === "token_overlap" && relevanceScore < 56) ||
    (finalKind === "symbol_match" && relevanceScore < 52) ||
    (finalKind !== "single_token" &&
      finalKind !== "token_overlap" &&
      finalKind !== "symbol_match" &&
      relevanceScore < 48)
  ) {
    return null;
  }

  if (finalKind === "exact_name") {
    reasons.push(`Exact DexScreener name match for "${bestAlias}"`);
  } else if (finalKind === "compact_name") {
    reasons.push(`Normalized DexScreener name still matches "${bestAlias}"`);
  } else if (finalKind === "alias_phrase") {
    reasons.push(`DexScreener token name preserves the trend phrase "${bestAlias}"`);
  } else if (finalKind === "entity_phrase") {
    reasons.push(`DexScreener token name extends the key entity "${bestAlias}"`);
  } else if (finalKind === "symbol_match") {
    reasons.push(`DexScreener ticker aligns with the trend token "${bestAlias}"`);
  } else {
    reasons.push(`DexScreener result shares distinctive trend tokens: ${sharedDistinctiveTokens.join(", ")}`);
  }
  if (typeof liquidityUsd === "number" && liquidityUsd > 0) {
    reasons.push(`liquidity ${Math.round(liquidityUsd).toLocaleString("en-US")} USD`);
  }
  if (typeof volume24hUsd === "number" && volume24hUsd > 0) {
    reasons.push(`24h volume ${Math.round(volume24hUsd).toLocaleString("en-US")} USD`);
  }

  const rawMatchSignals = {
    match_type: "dexscreener_search",
    match_kind: finalKind,
    matched_alias: bestAlias,
    search_query: searchQuery,
    query_aliases: trend.queries,
    exact_overlap_terms: sharedDistinctiveTokens,
    matched_keywords: sharedDistinctiveTokens,
    supporting_keywords: uniqueStrings([...sharedDistinctiveTokens, ...summaryTokenOverlap]).slice(0, 6),
    relevance_score: relevanceScore,
    market_score: marketScore,
    search_result_rank: initialSearchRank,
    summary_overlap_terms: summaryTokenOverlap,
    coin_shape_bonus: coinShapeBonus,
  } satisfies Record<string, unknown>;

  return {
    topicKey: trend.topicKey,
    topicLabel: trend.topicLabel,
    sourceRunId: trend.sourceRunId,
    sourceNarrativeId: trend.sourceNarrativeId,
    searchQuery: trend.topicLabel,
    queryAliases: trend.queries,
    chainId,
    coinAddress,
    pairAddress,
    dexscreenerUrl,
    dexId: asString(pair.dexId),
    coinSymbol,
    coinName,
    quoteSymbol,
    quoteTokenName,
    priceUsd: asNumber(pair.priceUsd),
    priceChange1hPct: asNumber(pair.priceChange?.h1),
    priceChange6hPct: asNumber(pair.priceChange?.h6),
    priceChange24hPct: asNumber(pair.priceChange?.h24),
    liquidityUsd,
    volume24hUsd,
    fdvUsd: asNumber(pair.fdv),
    marketCapUsd: asNumber(pair.marketCap),
    pairCreatedAt: parsePairCreatedAt(pair.pairCreatedAt),
    marketScore,
    relevanceScore,
    matchReasons: uniqueStrings(reasons).slice(0, 6),
    rawMatchSignals,
    websites,
    socials,
    iconUrl: asString(pair.info?.imageUrl),
    initialSearchRank,
  };
}

async function fetchDexscreenerSearchPairs(query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [] as DexSearchPair[];
  }

  const url = `${DEXSCREENER_SEARCH_URL}?q=${encodeURIComponent(trimmedQuery)}`;
  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await throttleDexSearchRequests();
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "attentra-trend-dexscreener-match/1.0",
      },
    });

    if (response.ok) {
      const payload = (await response.json()) as { pairs?: DexSearchPair[] };
      return Array.isArray(payload.pairs) ? payload.pairs : [];
    }

    lastStatus = response.status;
    lastBody = await response.text();
    if (!DEX_SEARCH_RETRYABLE_STATUSES.has(response.status) || attempt >= 4) {
      break;
    }

    const retryAfterHeader = Number(response.headers.get("retry-after") ?? "");
    const retryAfterMs =
      Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader * 1_000
        : 0;
    const backoffMs =
      response.status === 429
        ? Math.max(4_000 * (attempt + 1), retryAfterMs)
        : Math.max(750 * (attempt + 1), retryAfterMs);
    await sleep(backoffMs);
  }

  throw new Error(
    `DexScreener search failed for "${trimmedQuery}" with status ${lastStatus}: ${lastBody.slice(0, 200)}`,
  );
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  limit: number,
  mapper: (item: TInput) => Promise<TOutput>,
) {
  const results: TOutput[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function rankTrendDexscreenerMatches(trend: TrendDexNarrativeSource) {
  const profile = buildTrendSearchProfile(trend);
  const rankedById = new Map<string, RankedDexCandidate>();
  const queryDiagnostics: Array<{
    query: string;
    responsePairCount: number;
    acceptedCandidateCount: number;
  }> = [];

  for (const query of profile.queries) {
    const pairs = await fetchDexscreenerSearchPairs(query);
    let acceptedCandidateCount = 0;
    pairs.forEach((pair, index) => {
      const candidate = scoreDexCandidate(profile, pair, query, index + 1);
      if (!candidate) {
        return;
      }
      acceptedCandidateCount += 1;

      const identityKey = candidateIdentityKey(candidate);
      const existing = rankedById.get(identityKey);
      if (!existing || compareRankedDexCandidates(existing, candidate) > 0) {
        rankedById.set(identityKey, candidate);
      }
    });
    queryDiagnostics.push({
      query,
      responsePairCount: pairs.length,
      acceptedCandidateCount,
    });
  }

  const ranked = [...rankedById.values()].sort(compareRankedDexCandidates);
  const validationInput = ranked.slice(0, MAX_VALIDATED_CANDIDATES_PER_TREND).map(buildLinkedCoin);
  const validationResult = await revalidateNarrativeLinkedCoins(validationInput);
  const validatedById = new Map(
    validationResult.liveCoins.map((coin) => [`${coin.chainId}:${coin.address}`.toLowerCase(), coin] as const),
  );

  const liveMatches: Array<
    RankedDexCandidate & {
      linkedCoin: NarrativeLinkedCoin;
    }
  > = [];
  const seenLiveCoinKeys = new Set<string>();
  for (const candidate of ranked) {
    const liveCoinKey = candidateIdentityKey(candidate);
    if (seenLiveCoinKeys.has(liveCoinKey)) {
      continue;
    }

    const validated = validatedById.get(liveCoinKey);
    if (!validated) {
      continue;
    }

    seenLiveCoinKeys.add(liveCoinKey);
    liveMatches.push({
      ...candidate,
      marketScore: computeMarketScore({
        chainId: validated.chainId ?? candidate.chainId,
        liquidityUsd: validated.lastSeenLiquidityUsd ?? validated.liquidity ?? candidate.liquidityUsd,
        volume24hUsd: validated.lastSeenVolume24hUsd ?? validated.volume ?? candidate.volume24hUsd,
        txns24h: validated.lastSeenTxns24h ?? null,
        pairCreatedAt: candidate.pairCreatedAt,
        quoteSymbol: validated.quoteSymbol ?? candidate.quoteSymbol,
        dexscreenerUrl: validated.dexscreenerUrl ?? candidate.dexscreenerUrl,
        websites: validated.websites ?? candidate.websites,
        socials: validated.socials ?? candidate.socials,
      }),
      rawMatchSignals: {
        ...candidate.rawMatchSignals,
        validation_status: validated.validationStatus ?? null,
        validation_reason: validated.validationReason ?? null,
      },
      linkedCoin: validated,
    });
    if (liveMatches.length >= MAX_STORED_MATCHES_PER_TREND) {
      break;
    }
  }

  return {
    trend,
    matches: liveMatches.map((entry, index) => ({
      ...entry,
      linkedCoin: {
        ...entry.linkedCoin,
        confidence: entry.relevanceScore,
        confidenceBand: confidenceBandForScore(entry.relevanceScore),
        marketScore: entry.marketScore,
        whyLinked: entry.matchReasons[0] ?? entry.linkedCoin.whyLinked ?? null,
        matchReasons: entry.matchReasons,
        rawMatchSignals: {
          ...entry.rawMatchSignals,
          relevance_score: entry.relevanceScore,
          market_score: entry.marketScore,
          stored_rank: index + 1,
        },
        lastUpdatedAt: new Date().toISOString(),
      },
    })),
    queries: profile.queries,
    candidateCount: ranked.length,
    queryDiagnostics,
    validationStats: validationResult.stats,
  };
}

async function readExistingTrendDexMatchMetadata(topicKeys: string[]) {
  const metadata = new Map<string, ExistingTrendDexMatchMetadataRow>();
  if (!hasDatabaseUrl() || topicKeys.length === 0) {
    return metadata;
  }

  const pool = getServerPostgresPool();
  try {
    const result = await pool.query<ExistingTrendDexMatchMetadataRow>(
      `
        SELECT
          topic_key,
          max(topic_label) AS topic_label,
          max(source_run_id) AS source_run_id,
          count(*)::integer AS row_count
        FROM public.trend_dexscreener_matches
        WHERE topic_key = ANY($1::text[])
        GROUP BY topic_key
      `,
      [topicKeys],
    );
    result.rows.forEach((row) => {
      metadata.set(row.topic_key, row);
    });
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    warnMissingTrendDexscreenerMatchesTable("readExistingTrendDexMatchMetadata", error);
  }

  return metadata;
}

export async function fetchStoredTrendDexscreenerMatches(topicKeys: string[]) {
  const result = new Map<string, NarrativeLinkedCoin[]>();
  if (!hasDatabaseUrl() || topicKeys.length === 0) {
    return result;
  }

  const pool = getServerPostgresPool();
  try {
    const rowsResult = await pool.query<StoredTrendDexMatchRow>(
      `
        SELECT
          topic_key,
          rank,
          search_query,
          query_aliases_json,
          chain_id,
          coin_address,
          pair_address,
          dexscreener_url,
          dex_id,
          coin_symbol,
          coin_name,
          quote_symbol,
          quote_token_name,
          price_usd,
          price_change_1h_pct,
          price_change_6h_pct,
          price_change_24h_pct,
          liquidity_usd,
          volume_24h_usd,
          fdv_usd,
          market_cap_usd,
          pair_created_at,
          market_score,
          relevance_score,
          match_reasons_json,
          raw_match_signals_json,
          websites_json,
          socials_json,
          icon_url,
          last_updated_at,
          is_live,
          last_validated_at,
          validation_status,
          validation_reason,
          last_seen_liquidity_usd,
          last_seen_volume_h24,
          last_seen_txns_h24
        FROM public.trend_dexscreener_matches
        WHERE topic_key = ANY($1::text[])
        ORDER BY topic_key ASC, rank ASC, relevance_score DESC, id ASC
      `,
      [topicKeys],
    );

    rowsResult.rows.forEach((row) => {
      const coin: NarrativeLinkedCoin = {
        id: `${row.chain_id}:${row.coin_address}`,
        symbol: row.coin_symbol,
        name: row.coin_name,
        address: row.coin_address,
        confidence: Math.round(row.relevance_score ?? 0),
        confidenceBand: confidenceBandForScore(Math.round(row.relevance_score ?? 0)),
        liquidity: row.liquidity_usd,
        volume: row.volume_24h_usd,
        age: pairAgeHours(row.pair_created_at),
        priceUsd: row.price_usd,
        priceChange1hPct: row.price_change_1h_pct,
        priceChange6hPct: row.price_change_6h_pct,
        priceChange24hPct: row.price_change_24h_pct,
        marketCap: row.market_cap_usd,
        fdv: row.fdv_usd,
        iconUrl: row.icon_url,
        quoteSymbol: row.quote_symbol,
        websites: buildExternalLinks(row.websites_json, "website"),
        socials: buildExternalLinks(row.socials_json, "social"),
        chainId: row.chain_id,
        pairAddress: row.pair_address,
        dexscreenerUrl: row.dexscreener_url,
        isLive: row.is_live,
        lastValidatedAt: row.last_validated_at,
        validationStatus: row.validation_status,
        validationReason: row.validation_reason,
        lastSeenLiquidityUsd: row.last_seen_liquidity_usd,
        lastSeenVolume24hUsd: row.last_seen_volume_h24,
        lastSeenTxns24h: row.last_seen_txns_h24,
        marketScore: row.market_score,
        whyLinked:
          asStringArray(row.match_reasons_json)[0] ??
          asString(asRecord(row.raw_match_signals_json)?.match_reason) ??
          null,
        matchReasons: asStringArray(row.match_reasons_json),
        rawMatchSignals: {
          ...(asRecord(row.raw_match_signals_json) ?? {}),
          search_query: row.search_query,
          query_aliases: asStringArray(row.query_aliases_json),
          dex_id: row.dex_id,
        },
        lastUpdatedAt: row.last_updated_at,
      };
      const existing = result.get(row.topic_key) ?? [];
      existing.push(coin);
      result.set(row.topic_key, existing);
    });
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    warnMissingTrendDexscreenerMatchesTable("fetchStoredTrendDexscreenerMatches", error);
  }

  return result;
}

function attachLinksToTrend(
  trend: RankedTrend,
  linkedCoinsByTopic: Map<string, NarrativeLinkedCoin[]>,
) {
  const topicKey = getTrendTopicKey(trend);
  return {
    ...trend,
    linkedCoins: linkedCoinsByTopic.get(topicKey) ?? [],
  } satisfies RankedTrend;
}

export async function attachStoredTrendDexscreenerMatches(
  state: TrendDashboardVM,
): Promise<TrendDashboardVM> {
  const trends = [
    ...state.leaderboard,
    ...state.leaderboards.established,
    ...state.leaderboards.emerging,
    ...(state.detail?.trend ? [state.detail.trend] : []),
  ];
  const topicKeys = uniqueStrings(trends.map((trend) => getTrendTopicKey(trend)));
  const linkedCoinsByTopic = await fetchStoredTrendDexscreenerMatches(topicKeys);

  return {
    ...state,
    leaderboard: state.leaderboard.map((trend) => attachLinksToTrend(trend, linkedCoinsByTopic)),
    leaderboards: {
      established: state.leaderboards.established.map((trend) =>
        attachLinksToTrend(trend, linkedCoinsByTopic),
      ),
      emerging: state.leaderboards.emerging.map((trend) =>
        attachLinksToTrend(trend, linkedCoinsByTopic),
      ),
    },
    detail: state.detail
      ? {
          ...state.detail,
          trend: attachLinksToTrend(state.detail.trend, linkedCoinsByTopic),
        }
      : null,
  };
}

function buildTrendDexNarrativeSource(trend: RankedTrend) {
  return {
    topicKey: getTrendTopicKey(trend),
    topicLabel: getTrendDisplayNameOrPlaceholder(trend),
    summary:
      trend.trendNarrativeSummary ??
      trend.trendDescription ??
      trend.trendContextParagraph ??
      null,
    keyEntities: trend.trendKeyEntities ?? [],
    sourceRunId: null,
    sourceNarrativeId: null,
  } satisfies TrendDexNarrativeSource;
}

export async function refreshStoredTrendDexscreenerMatchesForState(
  state: TrendDashboardVM,
  options: {
    force?: boolean;
  } = {},
) {
  const narratives = uniqueStrings(
    [
      ...state.leaderboard,
      ...state.leaderboards.established,
      ...state.leaderboards.emerging,
      ...(state.detail?.trend ? [state.detail.trend] : []),
    ].map((trend) => getTrendTopicKey(trend)),
  )
    .map((topicKey) =>
      [
        ...state.leaderboard,
        ...state.leaderboards.established,
        ...state.leaderboards.emerging,
        ...(state.detail?.trend ? [state.detail.trend] : []),
      ].find((trend) => getTrendTopicKey(trend) === topicKey),
    )
    .filter((trend): trend is RankedTrend => Boolean(trend))
    .map(buildTrendDexNarrativeSource);

  return refreshStoredTrendDexscreenerMatches({
    narratives,
    force: options.force,
  });
}

export async function refreshStoredTrendDexscreenerMatches(params: {
  narratives: TrendDexNarrativeSource[];
  force?: boolean;
}) {
  if (!hasDatabaseUrl()) {
    return {
      refreshedTopicCount: 0,
      prunedTopicCount: 0,
      writtenRowCount: 0,
      topicDiagnostics: [] as Array<{
        topicKey: string;
        topicLabel: string;
        searchQueryCount: number;
        queryDiagnostics: Array<{
          query: string;
          responsePairCount: number;
          acceptedCandidateCount: number;
        }>;
        candidateCount: number;
        validationAttempted: number;
        validationLive: number;
        validationRejected: number;
        persistedCount: number;
      }>,
      topicsRefreshed: [] as string[],
      topicsSkipped: params.narratives.map((narrative) => narrative.topicKey),
    };
  }

  const narratives = params.narratives
    .filter((narrative) => narrative.topicKey && narrative.topicLabel)
    .map((narrative) => ({
      ...narrative,
      keyEntities: uniqueStrings(narrative.keyEntities),
    }));
  const topicKeys = narratives.map((narrative) => narrative.topicKey);
  const existingMetadata = await readExistingTrendDexMatchMetadata(topicKeys);
  const topicsToRefresh = narratives.filter((narrative) => {
    if (params.force) {
      return true;
    }

    const existing = existingMetadata.get(narrative.topicKey);
    if (!existing || existing.row_count <= 0) {
      return true;
    }

    return (
      normalizeText(existing.topic_label) !== normalizeText(narrative.topicLabel) ||
      Number(existing.source_run_id ?? 0) !== Number(narrative.sourceRunId ?? 0)
    );
  });

  const rankedByTopic = new Map<
    string,
    Awaited<ReturnType<typeof rankTrendDexscreenerMatches>>
  >();
  const refreshed = await mapWithConcurrency(
    topicsToRefresh,
    SEARCH_CONCURRENCY,
    async (narrative) => rankTrendDexscreenerMatches(narrative),
  );
  refreshed.forEach((entry) => {
    rankedByTopic.set(entry.trend.topicKey, entry);
  });

  const pool = getServerPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (topicKeys.length === 0) {
      await client.query("DELETE FROM public.trend_dexscreener_matches");
    } else {
      await client.query(
        `DELETE FROM public.trend_dexscreener_matches WHERE topic_key <> ALL($1::text[])`,
        [topicKeys],
      );
    }

    const refreshedTopicKeys = topicsToRefresh.map((narrative) => narrative.topicKey);
    if (refreshedTopicKeys.length > 0) {
      await client.query(
        `DELETE FROM public.trend_dexscreener_matches WHERE topic_key = ANY($1::text[])`,
        [refreshedTopicKeys],
      );
    }

    let writtenRowCount = 0;
    for (const narrative of topicsToRefresh) {
      const ranked = rankedByTopic.get(narrative.topicKey);
      const matches = ranked?.matches ?? [];
      for (const [index, match] of matches.entries()) {
        const coin = match.linkedCoin;
        await client.query(
          `
            INSERT INTO public.trend_dexscreener_matches (
              topic_key,
              topic_label,
              rank,
              search_query,
              query_aliases_json,
              chain_id,
              coin_address,
              pair_address,
              dexscreener_url,
              dex_id,
              coin_symbol,
              coin_name,
              quote_symbol,
              quote_token_name,
              price_usd,
              price_change_1h_pct,
              price_change_6h_pct,
              price_change_24h_pct,
              liquidity_usd,
              volume_24h_usd,
              fdv_usd,
              market_cap_usd,
              pair_created_at,
              market_score,
              relevance_score,
              match_reasons_json,
              raw_match_signals_json,
              websites_json,
              socials_json,
              icon_url,
              source_run_id,
              source_narrative_id,
              last_updated_at,
              is_live,
              last_validated_at,
              validation_status,
              validation_reason,
              last_seen_liquidity_usd,
              last_seen_volume_h24,
              last_seen_txns_h24
            ) VALUES (
              $1,
              $2,
              $3,
              $4,
              $5::jsonb,
              $6,
              $7,
              $8,
              $9,
              $10,
              $11,
              $12,
              $13,
              $14,
              $15,
              $16,
              $17,
              $18,
              $19,
              $20,
              $21,
              $22,
              $23::timestamptz,
              $24,
              $25,
              $26::jsonb,
              $27::jsonb,
              $28::jsonb,
              $29::jsonb,
              $30,
              $31,
              $32,
              now(),
              $33,
              $34::timestamptz,
              $35,
              $36,
              $37,
              $38,
              $39
            )
          `,
          [
            narrative.topicKey,
            narrative.topicLabel,
            index + 1,
            narrative.topicLabel,
            JSON.stringify(match.queryAliases),
            coin.chainId ?? match.chainId,
            coin.address,
            coin.pairAddress ?? null,
            coin.dexscreenerUrl ?? null,
            match.dexId,
            coin.symbol,
            coin.name,
            coin.quoteSymbol ?? match.quoteSymbol ?? null,
            match.quoteTokenName,
            coin.priceUsd ?? match.priceUsd ?? null,
            coin.priceChange1hPct ?? match.priceChange1hPct ?? null,
            coin.priceChange6hPct ?? match.priceChange6hPct ?? null,
            coin.priceChange24hPct ?? match.priceChange24hPct ?? null,
            coin.liquidity ?? match.liquidityUsd ?? null,
            coin.volume ?? match.volume24hUsd ?? null,
            coin.fdv ?? match.fdvUsd ?? null,
            coin.marketCap ?? match.marketCapUsd ?? null,
            match.pairCreatedAt,
            coin.marketScore ?? match.marketScore,
            match.relevanceScore,
            JSON.stringify(match.linkedCoin.matchReasons ?? match.matchReasons),
            JSON.stringify(match.linkedCoin.rawMatchSignals ?? match.rawMatchSignals),
            JSON.stringify(match.linkedCoin.websites ?? match.websites),
            JSON.stringify(match.linkedCoin.socials ?? match.socials),
            coin.iconUrl ?? match.iconUrl,
            narrative.sourceRunId,
            narrative.sourceNarrativeId,
            coin.isLive ?? null,
            coin.lastValidatedAt ?? null,
            coin.validationStatus ?? null,
            coin.validationReason ?? null,
            coin.lastSeenLiquidityUsd ?? null,
            coin.lastSeenVolume24hUsd ?? null,
            coin.lastSeenTxns24h ?? null,
          ],
        );
        writtenRowCount += 1;
      }
    }

    await client.query("COMMIT");
    return {
      refreshedTopicCount: topicsToRefresh.length,
      prunedTopicCount: Math.max(0, existingMetadata.size - narratives.length),
      writtenRowCount,
      topicsRefreshed: topicsToRefresh.map((narrative) => narrative.topicKey),
      topicDiagnostics: topicsToRefresh.map((narrative) => {
        const ranked = rankedByTopic.get(narrative.topicKey);
        return {
          topicKey: narrative.topicKey,
          topicLabel: narrative.topicLabel,
          searchQueryCount: ranked?.queries.length ?? 0,
          queryDiagnostics: ranked?.queryDiagnostics ?? [],
          candidateCount: ranked?.candidateCount ?? 0,
          validationAttempted: ranked?.validationStats.attempted ?? 0,
          validationLive: ranked?.validationStats.liveRows ?? 0,
          validationRejected: ranked?.validationStats.rejected ?? 0,
          persistedCount: ranked?.matches.length ?? 0,
        };
      }),
      topicsSkipped: narratives
        .filter((narrative) => !topicsToRefresh.some((item) => item.topicKey === narrative.topicKey))
        .map((narrative) => narrative.topicKey),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
