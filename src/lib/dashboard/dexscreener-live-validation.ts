import "server-only";

import type { CorrelatedMemecoinRow, NarrativeLinkedCoin } from "@/types/view-models";

const DEX_LOOKUP_TIMEOUT_MS = 8_000;
const VALIDATION_CACHE_TTL_MS = 45_000;
const VALIDATION_CONCURRENCY = 6;

const LIVE_MIN_LIQUIDITY_USD = readNumberEnv("MEMECOIN_LIVE_VALIDATION_MIN_LIQUIDITY_USD", 750);
const LIVE_MIN_VOLUME_24H_USD = readNumberEnv("MEMECOIN_LIVE_VALIDATION_MIN_VOLUME_24H_USD", 400);
const LIVE_MIN_RECENT_TXNS = readIntEnv("MEMECOIN_LIVE_VALIDATION_MIN_RECENT_TXNS", 2);
const LIVE_MAX_STALENESS_HOURS = readNumberEnv("MEMECOIN_LIVE_VALIDATION_MAX_STALENESS_HOURS", 6);
const LIVE_TRUST_VALIDATION_TTL_HOURS = readNumberEnv("MEMECOIN_LIVE_VALIDATION_TRUST_TTL_HOURS", 4);
const LIVE_LAST_KNOWN_GOOD_TTL_HOURS = readNumberEnv("MEMECOIN_LIVE_VALIDATION_LAST_KNOWN_GOOD_TTL_HOURS", 48);

type DexPairRecord = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  labels?: string[] | null;
  pairCreatedAt?: number | string | null;
  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  quoteToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  liquidity?: {
    usd?: number | string | null;
  } | null;
  volume?: {
    h24?: number | string | null;
    h6?: number | string | null;
    h1?: number | string | null;
  } | null;
  txns?: {
    h24?: { buys?: number | string | null; sells?: number | string | null } | null;
    h6?: { buys?: number | string | null; sells?: number | string | null } | null;
    h1?: { buys?: number | string | null; sells?: number | string | null } | null;
  } | null;
  priceUsd?: number | string | null;
  priceChange?: {
    h24?: number | string | null;
    h6?: number | string | null;
    h1?: number | string | null;
  } | null;
  info?: {
    imageUrl?: string | null;
    header?: string | null;
  } | null;
};

type PairLookupResponse = {
  pair?: DexPairRecord | null;
  pairs?: DexPairRecord[] | null;
};

export type LiveValidationIdentity = {
  chainId: string;
  tokenAddress: string;
  pairAddress: string | null;
  dexscreenerUrl: string | null;
  isLive?: boolean | null;
  lastValidatedAt?: string | null;
  validationStatus?: string | null;
  validationReason?: string | null;
  storedLiquidityUsd?: number | null;
  storedVolume24hUsd?: number | null;
  storedTxns24h?: number | null;
  updatedAt?: string | null;
};

export type DexLiveValidationResult = {
  isLive: boolean;
  validationStatus: "live" | "invalid";
  validationReason: string | null;
  validatedAt: string;
  decisionSource: "network" | "trusted_recent" | "transient_fallback";
  fallbackReason: string | null;
  chainId: string;
  tokenAddress: string;
  pairAddress: string | null;
  dexscreenerUrl: string | null;
  dexId: string | null;
  pairLabels: string[];
  quoteSymbol: string | null;
  quoteTokenName: string | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  volume6hUsd: number | null;
  volume1hUsd: number | null;
  txns24h: number | null;
  txns6h: number | null;
  txns1h: number | null;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  priceChange6hPct: number | null;
  priceChange1hPct: number | null;
  pairCreatedAt: string | null;
  iconUrl: string | null;
  headerUrl: string | null;
  source: "pair_address" | "token_address" | "input_only";
};

export type LiveValidationThresholdDiagnostics = {
  liveMinLiquidityUsd: number;
  liveMinVolume24hUsd: number;
  liveMinRecentTxns: number;
  liveMaxStalenessHours: number;
  trustValidationTtlHours: number;
  lastKnownGoodTtlHours: number;
};

type CachedValidation = {
  expiresAt: number;
  promise: Promise<DexLiveValidationResult> | null;
  value: DexLiveValidationResult | null;
};

const validationCache = new Map<string, CachedValidation>();

export function getDashboardLiveValidationThresholds(): LiveValidationThresholdDiagnostics {
  return {
    liveMinLiquidityUsd: LIVE_MIN_LIQUIDITY_USD,
    liveMinVolume24hUsd: LIVE_MIN_VOLUME_24H_USD,
    liveMinRecentTxns: LIVE_MIN_RECENT_TXNS,
    liveMaxStalenessHours: LIVE_MAX_STALENESS_HOURS,
    trustValidationTtlHours: LIVE_TRUST_VALIDATION_TTL_HOURS,
    lastKnownGoodTtlHours: LIVE_LAST_KNOWN_GOOD_TTL_HOURS,
  };
}

function readNumberEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLower(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeMaybeString(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function parseNumber(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNullableNumber(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePairCreatedAtIso(value: unknown) {
  const numeric = parseNullableNumber(value);
  if (numeric !== null && numeric > 10_000_000_000) {
    return new Date(numeric).toISOString();
  }
  const normalized = normalizeMaybeString(String(value ?? ""));
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function summarizeTxns(pair: DexPairRecord, window: "h24" | "h6" | "h1") {
  const bucket = pair.txns?.[window];
  const buys = Math.max(0, parseNumber(bucket?.buys));
  const sells = Math.max(0, parseNumber(bucket?.sells));
  return buys + sells;
}

function buildCanonicalDexUrl(chainId: string, pairAddress: string) {
  const normalizedChain = normalizeLower(chainId);
  const normalizedPair = normalizeMaybeString(pairAddress);
  if (!normalizedChain || !normalizedPair) {
    return null;
  }
  return `https://dexscreener.com/${normalizedChain}/${normalizedPair}`;
}

function isUsableDexUrl(
  value: string | null | undefined,
  options?: {
    expectedChainId?: string | null;
    expectedPairAddress?: string | null;
  },
) {
  const normalized = normalizeMaybeString(value);
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }
    if (!parsed.hostname.toLowerCase().includes("dexscreener.com")) {
      return false;
    }
    const path = parsed.pathname.split("/").filter(Boolean);
    if (path.length < 2) {
      return false;
    }
    if (options?.expectedChainId && normalizeLower(path[0]) !== normalizeLower(options.expectedChainId)) {
      return false;
    }
    if (options?.expectedPairAddress && normalizeLower(path[1]) !== normalizeLower(options.expectedPairAddress)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function pairMatchesIdentity(pair: DexPairRecord, input: LiveValidationIdentity) {
  return (
    normalizeLower(pair.chainId) === normalizeLower(input.chainId) &&
    normalizeLower(pair.baseToken?.address) === normalizeLower(input.tokenAddress) &&
    Boolean(normalizeMaybeString(pair.pairAddress))
  );
}

function uniquePairs(pairs: DexPairRecord[]) {
  const seen = new Set<string>();
  const output: DexPairRecord[] = [];
  pairs.forEach((pair) => {
    const key = normalizeLower(pair.pairAddress) || normalizeLower(pair.url);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push(pair);
  });
  return output;
}

function pairRecentActivityKey(pair: DexPairRecord) {
  return [
    summarizeTxns(pair, "h1"),
    parseNumber(pair.volume?.h1),
    summarizeTxns(pair, "h6"),
    parseNumber(pair.volume?.h6),
    summarizeTxns(pair, "h24"),
    parseNumber(pair.volume?.h24),
  ] as const;
}

function compareTuple(left: readonly (number | string)[], right: readonly (number | string)[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue === rightValue) {
      continue;
    }
    if (typeof leftValue === "string" || typeof rightValue === "string") {
      return String(leftValue).localeCompare(String(rightValue));
    }
    return Number(leftValue) > Number(rightValue) ? 1 : -1;
  }
  return 0;
}

function comparePairs(left: DexPairRecord, right: DexPairRecord) {
  const leftTuple = [
    parseNumber(left.liquidity?.usd),
    parseNumber(left.volume?.h24),
    ...pairRecentActivityKey(left),
    isUsableDexUrl(left.url) ? 1 : 0,
    Date.parse(parsePairCreatedAtIso(left.pairCreatedAt) ?? "") || 0,
    normalizeLower(left.pairAddress),
  ] as const;
  const rightTuple = [
    parseNumber(right.liquidity?.usd),
    parseNumber(right.volume?.h24),
    ...pairRecentActivityKey(right),
    isUsableDexUrl(right.url) ? 1 : 0,
    Date.parse(parsePairCreatedAtIso(right.pairCreatedAt) ?? "") || 0,
    normalizeLower(right.pairAddress),
  ] as const;
  return compareTuple(leftTuple, rightTuple);
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEX_LOOKUP_TIMEOUT_MS);
  try {
    return await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchPairByAddress(input: LiveValidationIdentity) {
  const pairAddress = normalizeMaybeString(input.pairAddress);
  if (!pairAddress) {
    return {
      source: "input_only" as const,
      failureReason: "missing_identity",
      pairs: [] as DexPairRecord[],
    };
  }
  try {
    const response = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(input.chainId)}/${encodeURIComponent(pairAddress)}`,
    );
    if (!response.ok) {
      return {
        source: "pair_address" as const,
        failureReason: "pair_lookup_failed",
        pairs: [] as DexPairRecord[],
      };
    }
    const payload = (await response.json()) as PairLookupResponse;
    const pairs = [
      ...(payload.pair ? [payload.pair] : []),
      ...((payload.pairs ?? []).filter(Boolean) as DexPairRecord[]),
    ];
    return {
      source: "pair_address" as const,
      failureReason: pairs.length === 0 ? "pair_not_found" : null,
      pairs,
    };
  } catch {
    return {
      source: "pair_address" as const,
      failureReason: "pair_lookup_failed",
      pairs: [] as DexPairRecord[],
    };
  }
}

async function fetchPairsByTokenAddress(input: LiveValidationIdentity) {
  try {
    const response = await fetchWithTimeout(
      `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(input.chainId)}/${encodeURIComponent(input.tokenAddress)}`,
    );
    if (!response.ok) {
      return {
        source: "token_address" as const,
        failureReason: "pair_lookup_failed",
        pairs: [] as DexPairRecord[],
      };
    }
    const payload = (await response.json()) as DexPairRecord[] | null;
    const pairs = Array.isArray(payload) ? payload : [];
    return {
      source: "token_address" as const,
      failureReason: pairs.length === 0 ? "pair_not_found" : null,
      pairs,
    };
  } catch {
    return {
      source: "token_address" as const,
      failureReason: "pair_lookup_failed",
      pairs: [] as DexPairRecord[],
    };
  }
}

function timestampAgeHours(value: string | null | undefined) {
  const normalized = normalizeMaybeString(value);
  if (!normalized) {
    return Number.POSITIVE_INFINITY;
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (Date.now() - timestamp) / 3_600_000);
}

function isTimestampFresh(value: string | null | undefined, ttlHours: number) {
  if (ttlHours <= 0) {
    return false;
  }
  return timestampAgeHours(value) <= ttlHours;
}

function hasStoredIdentity(input: LiveValidationIdentity) {
  return Boolean(
    normalizeLower(input.chainId) &&
      normalizeLower(input.tokenAddress) &&
      (normalizeMaybeString(input.pairAddress) || normalizeMaybeString(input.dexscreenerUrl)),
  );
}

function storedMetricsMeetLiveThresholds(input: LiveValidationIdentity) {
  const liquidityUsd = Math.max(0, parseNumber(input.storedLiquidityUsd));
  const volume24hUsd = Math.max(0, parseNumber(input.storedVolume24hUsd));
  const txns24h = Math.max(0, parseNumber(input.storedTxns24h));
  if (liquidityUsd < LIVE_MIN_LIQUIDITY_USD) {
    return false;
  }
  if (volume24hUsd >= LIVE_MIN_VOLUME_24H_USD) {
    return true;
  }
  return txns24h >= LIVE_MIN_RECENT_TXNS;
}

function canTrustRecentStoredValidation(input: LiveValidationIdentity) {
  const storedStatus = normalizeLower(input.validationStatus);
  if (!hasStoredIdentity(input)) {
    return false;
  }
  if (storedStatus === "invalid") {
    return false;
  }
  if (!isTimestampFresh(input.lastValidatedAt, LIVE_TRUST_VALIDATION_TTL_HOURS)) {
    return false;
  }
  return storedStatus === "live" || input.isLive === true;
}

function canUseStoredFallback(input: LiveValidationIdentity) {
  const storedStatus = normalizeLower(input.validationStatus);
  if (!hasStoredIdentity(input)) {
    return false;
  }
  if (storedStatus === "invalid") {
    return false;
  }
  const freshestTimestamp = normalizeMaybeString(input.lastValidatedAt) ?? normalizeMaybeString(input.updatedAt);
  if (!isTimestampFresh(freshestTimestamp, LIVE_LAST_KNOWN_GOOD_TTL_HOURS)) {
    return false;
  }
  return storedStatus === "live" || input.isLive === true || storedMetricsMeetLiveThresholds(input);
}

function buildInvalidResult(
  input: LiveValidationIdentity,
  reason: string,
  source: DexLiveValidationResult["source"],
): DexLiveValidationResult {
  return {
    isLive: false,
    validationStatus: "invalid",
    validationReason: reason,
    validatedAt: new Date().toISOString(),
    decisionSource: "network",
    fallbackReason: null,
    chainId: input.chainId,
    tokenAddress: input.tokenAddress,
    pairAddress: normalizeMaybeString(input.pairAddress),
    dexscreenerUrl: normalizeMaybeString(input.dexscreenerUrl),
    dexId: null,
    pairLabels: [],
    quoteSymbol: null,
    quoteTokenName: null,
    liquidityUsd: null,
    volume24hUsd: null,
    volume6hUsd: null,
    volume1hUsd: null,
    txns24h: null,
    txns6h: null,
    txns1h: null,
    priceUsd: null,
    priceChange24hPct: null,
    priceChange6hPct: null,
    priceChange1hPct: null,
    pairCreatedAt: null,
    iconUrl: null,
    headerUrl: null,
    source,
  };
}

function buildStoredLiveResult(
  input: LiveValidationIdentity,
  decisionSource: DexLiveValidationResult["decisionSource"],
  fallbackReason: string | null,
): DexLiveValidationResult {
  const pairAddress = normalizeMaybeString(input.pairAddress);
  const chainId = normalizeMaybeString(input.chainId) ?? "";
  const dexscreenerUrl =
    normalizeMaybeString(input.dexscreenerUrl) ??
    (pairAddress && chainId ? buildCanonicalDexUrl(chainId, pairAddress) : null);
  return {
    isLive: true,
    validationStatus: "live",
    validationReason: null,
    validatedAt:
      normalizeMaybeString(input.lastValidatedAt) ??
      normalizeMaybeString(input.updatedAt) ??
      new Date().toISOString(),
    decisionSource,
    fallbackReason,
    chainId,
    tokenAddress: input.tokenAddress,
    pairAddress,
    dexscreenerUrl,
    dexId: null,
    pairLabels: [],
    quoteSymbol: null,
    quoteTokenName: null,
    liquidityUsd: parseNullableNumber(input.storedLiquidityUsd),
    volume24hUsd: parseNullableNumber(input.storedVolume24hUsd),
    volume6hUsd: null,
    volume1hUsd: null,
    txns24h: parseNullableNumber(input.storedTxns24h),
    txns6h: null,
    txns1h: null,
    priceUsd: null,
    priceChange24hPct: null,
    priceChange6hPct: null,
    priceChange1hPct: null,
    pairCreatedAt: null,
    iconUrl: null,
    headerUrl: null,
    source: pairAddress ? "pair_address" : "input_only",
  };
}

function validationCacheKey(input: LiveValidationIdentity) {
  return JSON.stringify({
    chainId: normalizeLower(input.chainId),
    tokenAddress: normalizeLower(input.tokenAddress),
    pairAddress: normalizeLower(input.pairAddress),
    dexscreenerUrl: normalizeLower(input.dexscreenerUrl),
  });
}

async function validateLiveMarketUncached(input: LiveValidationIdentity): Promise<DexLiveValidationResult> {
  if (!normalizeLower(input.chainId) || !normalizeLower(input.tokenAddress)) {
    return buildInvalidResult(input, "missing_identity", "input_only");
  }
  if (canTrustRecentStoredValidation(input)) {
    return buildStoredLiveResult(input, "trusted_recent", null);
  }

  const pairLookup = await fetchPairByAddress(input);
  const tokenLookup = await fetchPairsByTokenAddress(input);
  const candidatePairs = uniquePairs(
    [...pairLookup.pairs, ...tokenLookup.pairs].filter((pair) => pairMatchesIdentity(pair, input)),
  );

  if (candidatePairs.length === 0) {
    if (pairLookup.failureReason === "pair_lookup_failed" && tokenLookup.failureReason === "pair_lookup_failed") {
      if (canUseStoredFallback(input)) {
        return buildStoredLiveResult(input, "transient_fallback", "pair_lookup_failed");
      }
      return buildInvalidResult(input, "pair_lookup_failed", "pair_address");
    }
    return buildInvalidResult(input, "no_pair_found", tokenLookup.pairs.length > 0 ? "token_address" : "pair_address");
  }

  const sortedPairs = [...candidatePairs].sort((left, right) => comparePairs(right, left));
  const selectedPair = sortedPairs[0] ?? null;
  if (!selectedPair) {
    return buildInvalidResult(input, "no_pair_found", "token_address");
  }

  const selectedPairAddress = normalizeMaybeString(selectedPair.pairAddress);
  if (!selectedPairAddress) {
    return buildInvalidResult(input, "pair_deleted", "token_address");
  }

  let validatedPair =
    pairLookup.pairs.find((pair) => normalizeLower(pair.pairAddress) === normalizeLower(selectedPairAddress)) ?? null;
  if (!validatedPair) {
    const selectedLookup = await fetchPairByAddress({
      ...input,
      pairAddress: selectedPairAddress,
    });
    validatedPair =
      selectedLookup.pairs.find((pair) => normalizeLower(pair.pairAddress) === normalizeLower(selectedPairAddress)) ??
      null;
  }

  if (!validatedPair) {
    return buildInvalidResult(input, "pair_deleted", "pair_address");
  }

  const chainId = normalizeMaybeString(validatedPair.chainId) ?? input.chainId;
  const canonicalDexUrl =
    isUsableDexUrl(validatedPair.url, { expectedChainId: chainId, expectedPairAddress: selectedPairAddress })
      ? normalizeMaybeString(validatedPair.url)
      : buildCanonicalDexUrl(chainId, selectedPairAddress);
  if (!isUsableDexUrl(canonicalDexUrl, { expectedChainId: chainId, expectedPairAddress: selectedPairAddress })) {
    return buildInvalidResult(input, "bad_url", "pair_address");
  }

  const liquidityUsd = Math.max(0, parseNumber(validatedPair.liquidity?.usd));
  const volume24hUsd = Math.max(0, parseNumber(validatedPair.volume?.h24));
  const volume6hUsd = Math.max(0, parseNumber(validatedPair.volume?.h6));
  const volume1hUsd = Math.max(0, parseNumber(validatedPair.volume?.h1));
  const txns24h = summarizeTxns(validatedPair, "h24");
  const txns6h = summarizeTxns(validatedPair, "h6");
  const txns1h = summarizeTxns(validatedPair, "h1");

  if (liquidityUsd < LIVE_MIN_LIQUIDITY_USD) {
    return buildInvalidResult(input, "liquidity_too_low", "pair_address");
  }

  const hasRecentVolume =
    volume24hUsd >= LIVE_MIN_VOLUME_24H_USD ||
    volume6hUsd >= Math.max(50, LIVE_MIN_VOLUME_24H_USD * 0.25) ||
    volume1hUsd >= Math.max(20, LIVE_MIN_VOLUME_24H_USD * 0.08);
  const hasRecentTxns =
    txns24h >= LIVE_MIN_RECENT_TXNS ||
    txns6h >= Math.max(1, Math.ceil(LIVE_MIN_RECENT_TXNS * 0.5)) ||
    txns1h >= Math.max(1, Math.ceil(LIVE_MIN_RECENT_TXNS * 0.25));
  if (!hasRecentVolume && !hasRecentTxns) {
    return buildInvalidResult(input, "stale_market", "pair_address");
  }

  return {
    isLive: true,
    validationStatus: "live",
    validationReason: null,
    validatedAt: new Date().toISOString(),
    decisionSource: "network",
    fallbackReason: null,
    chainId,
    tokenAddress: input.tokenAddress,
    pairAddress: selectedPairAddress,
    dexscreenerUrl: canonicalDexUrl,
    dexId: normalizeMaybeString(validatedPair.dexId),
    pairLabels: Array.isArray(validatedPair.labels)
      ? validatedPair.labels.map((label) => String(label ?? "").trim()).filter(Boolean)
      : [],
    quoteSymbol: normalizeMaybeString(validatedPair.quoteToken?.symbol),
    quoteTokenName: normalizeMaybeString(validatedPair.quoteToken?.name),
    liquidityUsd,
    volume24hUsd,
    volume6hUsd,
    volume1hUsd,
    txns24h,
    txns6h,
    txns1h,
    priceUsd: parseNullableNumber(validatedPair.priceUsd),
    priceChange24hPct: parseNullableNumber(validatedPair.priceChange?.h24),
    priceChange6hPct: parseNullableNumber(validatedPair.priceChange?.h6),
    priceChange1hPct: parseNullableNumber(validatedPair.priceChange?.h1),
    pairCreatedAt: parsePairCreatedAtIso(validatedPair.pairCreatedAt),
    iconUrl: normalizeMaybeString(validatedPair.info?.imageUrl),
    headerUrl: normalizeMaybeString(validatedPair.info?.header),
    source:
      normalizeLower(selectedPairAddress) === normalizeLower(input.pairAddress) && pairLookup.pairs.length > 0
        ? "pair_address"
        : "token_address",
  };
}

export async function validateDexLiveMarket(input: LiveValidationIdentity): Promise<DexLiveValidationResult> {
  const cacheKey = validationCacheKey(input);
  const cached = validationCache.get(cacheKey);
  const now = Date.now();
  if (cached?.value && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached?.promise) {
    return cached.promise;
  }
  const promise = validateLiveMarketUncached(input)
    .then((value) => {
      validationCache.set(cacheKey, {
        value,
        promise: null,
        expiresAt: Date.now() + VALIDATION_CACHE_TTL_MS,
      });
      return value;
    })
    .catch((error) => {
      validationCache.delete(cacheKey);
      throw error;
    });
  validationCache.set(cacheKey, {
    value: cached?.value ?? null,
    promise,
    expiresAt: now + VALIDATION_CACHE_TTL_MS,
  });
  return promise;
}

function applyValidationToRow(
  row: CorrelatedMemecoinRow,
  validation: DexLiveValidationResult,
): CorrelatedMemecoinRow {
  return {
    ...row,
    chainId: validation.chainId,
    tokenAddress: validation.tokenAddress,
    pairAddress: validation.pairAddress ?? row.pairAddress,
    dexscreenerUrl: validation.dexscreenerUrl ?? row.dexscreenerUrl,
    dexId: validation.dexId ?? row.dexId ?? null,
    pairLabels: validation.pairLabels,
    quoteSymbol: validation.quoteSymbol ?? row.quoteSymbol ?? null,
    quoteTokenName: validation.quoteTokenName ?? row.quoteTokenName ?? null,
    liquidityUsd: validation.liquidityUsd ?? row.liquidityUsd ?? null,
    volume24hUsd: validation.volume24hUsd ?? row.volume24hUsd ?? null,
    volume6hUsd: validation.volume6hUsd ?? row.volume6hUsd ?? null,
    volume1hUsd: validation.volume1hUsd ?? row.volume1hUsd ?? null,
    txns24h: validation.txns24h ?? row.txns24h ?? null,
    txns6h: validation.txns6h ?? row.txns6h ?? null,
    txns1h: validation.txns1h ?? row.txns1h ?? null,
    priceUsd: validation.priceUsd ?? row.priceUsd ?? null,
    priceChange24hPct: validation.priceChange24hPct ?? row.priceChange24hPct ?? null,
    priceChange6hPct: validation.priceChange6hPct ?? row.priceChange6hPct ?? null,
    priceChange1hPct: validation.priceChange1hPct ?? row.priceChange1hPct ?? null,
    pairAgeHours: validation.pairCreatedAt
      ? Math.max(0, Math.floor((Date.now() - Date.parse(validation.pairCreatedAt)) / 3_600_000))
      : row.pairAgeHours ?? null,
    iconUrl: validation.iconUrl ?? row.iconUrl ?? null,
    headerUrl: validation.headerUrl ?? row.headerUrl ?? null,
    isLive: validation.isLive,
    lastValidatedAt: validation.validatedAt,
    validationStatus: validation.validationStatus,
    validationReason: validation.validationReason,
    lastSeenLiquidityUsd: validation.liquidityUsd,
    lastSeenVolume24hUsd: validation.volume24hUsd,
    lastSeenTxns24h: validation.txns24h,
  };
}

function applyValidationToLinkedCoin(
  coin: NarrativeLinkedCoin,
  validation: DexLiveValidationResult,
): NarrativeLinkedCoin {
  return {
    ...coin,
    chainId: validation.chainId,
    pairAddress: validation.pairAddress ?? coin.pairAddress ?? null,
    dexscreenerUrl: validation.dexscreenerUrl ?? coin.dexscreenerUrl ?? null,
    liquidity: validation.liquidityUsd ?? coin.liquidity ?? null,
    volume: validation.volume24hUsd ?? coin.volume ?? null,
    priceUsd: validation.priceUsd ?? coin.priceUsd ?? null,
    priceChange1hPct: validation.priceChange1hPct ?? coin.priceChange1hPct ?? null,
    priceChange6hPct: validation.priceChange6hPct ?? coin.priceChange6hPct ?? null,
    priceChange24hPct: validation.priceChange24hPct ?? coin.priceChange24hPct ?? null,
    iconUrl: validation.iconUrl ?? coin.iconUrl ?? null,
    quoteSymbol: validation.quoteSymbol ?? coin.quoteSymbol ?? null,
    age: validation.pairCreatedAt
      ? Math.max(0, Math.floor((Date.now() - Date.parse(validation.pairCreatedAt)) / 3_600_000))
      : coin.age ?? null,
    isLive: validation.isLive,
    lastValidatedAt: validation.validatedAt,
    validationStatus: validation.validationStatus,
    validationReason: validation.validationReason,
    lastSeenLiquidityUsd: validation.liquidityUsd,
    lastSeenVolume24hUsd: validation.volume24hUsd,
    lastSeenTxns24h: validation.txns24h,
  };
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

function countByKey<T>(
  items: T[],
  selector: (item: T) => string | null | undefined,
) {
  return Object.fromEntries(
    items.reduce<Map<string, number>>((counts, item) => {
      const key = String(selector(item) ?? "unknown").trim() || "unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()),
  );
}

export async function revalidateCorrelatedMemecoinRows(rows: CorrelatedMemecoinRow[]) {
  const validations = await mapWithConcurrency(rows, VALIDATION_CONCURRENCY, async (row) => ({
    row,
    validation: await validateDexLiveMarket({
      chainId: row.chainId,
      tokenAddress: row.tokenAddress,
      pairAddress: row.pairAddress,
      dexscreenerUrl: row.dexscreenerUrl,
      isLive: row.isLive,
      lastValidatedAt: row.lastValidatedAt,
      validationStatus: row.validationStatus,
      validationReason: row.validationReason,
      storedLiquidityUsd: row.lastSeenLiquidityUsd ?? row.liquidityUsd ?? null,
      storedVolume24hUsd: row.lastSeenVolume24hUsd ?? row.volume24hUsd ?? null,
      storedTxns24h: row.lastSeenTxns24h ?? row.txns24h ?? null,
      updatedAt: row.updatedAt,
    }),
  }));

  const liveRows: CorrelatedMemecoinRow[] = [];
  const rejected: Array<{ row: CorrelatedMemecoinRow; reason: string | null }> = [];
  validations.forEach(({ row, validation }) => {
    if (!validation.isLive) {
      rejected.push({ row, reason: validation.validationReason });
      return;
    }
    liveRows.push(applyValidationToRow(row, validation));
  });
  return {
    liveRows,
    rejected,
    stats: {
      attempted: rows.length,
      liveRows: liveRows.length,
      rejected: rejected.length,
      rejectReasonCounts: countByKey(rejected, (entry) => entry.reason),
      decisionSourceCounts: countByKey(validations, (entry) => entry.validation.decisionSource),
      fallbackReasonCounts: countByKey(
        validations.filter((entry) => entry.validation.fallbackReason),
        (entry) => entry.validation.fallbackReason,
      ),
    },
  };
}

export async function revalidateNarrativeLinkedCoins(coins: NarrativeLinkedCoin[]) {
  const validations = await mapWithConcurrency(coins, VALIDATION_CONCURRENCY, async (coin) => ({
    coin,
    validation: await validateDexLiveMarket({
      chainId: coin.chainId ?? "",
      tokenAddress: coin.address,
      pairAddress: coin.pairAddress ?? null,
      dexscreenerUrl: coin.dexscreenerUrl ?? null,
      isLive: coin.isLive,
      lastValidatedAt: coin.lastValidatedAt,
      validationStatus: coin.validationStatus,
      validationReason: coin.validationReason,
      storedLiquidityUsd: coin.lastSeenLiquidityUsd ?? coin.liquidity ?? null,
      storedVolume24hUsd: coin.lastSeenVolume24hUsd ?? coin.volume ?? null,
      storedTxns24h: coin.lastSeenTxns24h ?? null,
      updatedAt: coin.lastUpdatedAt,
    }),
  }));

  const liveCoins: NarrativeLinkedCoin[] = [];
  const rejected: Array<{ coin: NarrativeLinkedCoin; reason: string | null }> = [];
  validations.forEach(({ coin, validation }) => {
    if (!validation.isLive) {
      rejected.push({ coin, reason: validation.validationReason });
      return;
    }
    liveCoins.push(applyValidationToLinkedCoin(coin, validation));
  });
  return {
    liveCoins,
    rejected,
    stats: {
      attempted: coins.length,
      liveRows: liveCoins.length,
      rejected: rejected.length,
      rejectReasonCounts: countByKey(rejected, (entry) => entry.reason),
      decisionSourceCounts: countByKey(validations, (entry) => entry.validation.decisionSource),
      fallbackReasonCounts: countByKey(
        validations.filter((entry) => entry.validation.fallbackReason),
        (entry) => entry.validation.fallbackReason,
      ),
    },
  };
}
