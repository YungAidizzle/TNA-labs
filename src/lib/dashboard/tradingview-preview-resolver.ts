import "server-only";

import { getServerPostgresPool, hasDatabaseUrl } from "@/lib/db/server-postgres";
import {
  buildPairDerivedTradingViewCandidates,
  createFallbackTradingViewPreview,
  createResolvedTradingViewPreview,
  getCuratedTradingViewSymbol,
  getExplicitTradingViewSymbol,
  pairLabelFromPreviewInput,
  resolvePairAddress,
  type TradingViewPreviewCandidateValidation,
  type TradingViewPreviewFailureCode,
  type TradingViewPreviewInput,
  type TradingViewPreviewPairCandidate,
  type TradingViewPreviewProvider,
  type TradingViewPreviewResponse,
} from "@/lib/dashboard/tradingview-preview";

const PREVIEW_CACHE_TTL_MS = 5 * 60_000;
const DEX_LOOKUP_TIMEOUT_MS = 8_000;
const TRADINGVIEW_SEARCH_TIMEOUT_MS = 3_500;
const TRADINGVIEW_VALIDATE_TIMEOUT_MS = 2_500;
const MAX_TRADINGVIEW_CANDIDATES = 12;
const TRADINGVIEW_VALIDATION_BATCH_SIZE = 3;
const MAX_TRADINGVIEW_SEARCH_QUERIES = 6;
const MAX_TRADINGVIEW_SEARCH_RESULTS = 8;
const MAX_TRADINGVIEW_SEARCH_VALIDATIONS = 4;
const SPARKLINE_HISTORY_LIMIT = 24;
const SPARKLINE_HISTORY_QUERY_LIMIT = 48;
const PREVIEW_METRIC_SNAPSHOT_INTERVAL = 25;

const PREFERRED_QUOTE_SCORES: Record<string, number> = {
  SOL: 60,
  USDC: 56,
  USDT: 54,
  WETH: 50,
  ETH: 48,
  WBNB: 44,
  BNB: 42,
  WBTC: 36,
  BTC: 34,
};

const QUOTE_SYMBOL_EQUIVALENTS: Record<string, string[]> = {
  SOL: ["SOL", "WSOL"],
  WSOL: ["SOL", "WSOL"],
  ETH: ["ETH", "WETH"],
  WETH: ["ETH", "WETH"],
  BNB: ["BNB", "WBNB"],
  WBNB: ["BNB", "WBNB"],
  BTC: ["BTC", "WBTC"],
  WBTC: ["BTC", "WBTC"],
  USDT: ["USDT", "USD"],
  USDC: ["USDC", "USD"],
};

const GENERIC_TRADINGVIEW_QUOTES = [
  "USDT",
  "USDC",
  "USD",
  "SOL",
  "WSOL",
  "WETH",
  "ETH",
  "WBNB",
  "BNB",
  "WBTC",
  "BTC",
  "EUR",
  "TRY",
];

const NAME_STOPWORDS = new Set([
  "A",
  "AN",
  "AND",
  "COIN",
  "JUST",
  "MEME",
  "MEMECOIN",
  "OFFICIAL",
  "THE",
  "TOKEN",
]);

const previewCache = new Map<
  string,
  {
    expiresAt: number;
    promise: Promise<TradingViewPreviewResponse> | null;
    value: TradingViewPreviewResponse | null;
  }
>();

const previewMetrics = {
  total: 0,
  byStatus: {
    tradingview: 0,
    dexscreener: 0,
    sparkline: 0,
    unavailable: 0,
  } satisfies Record<TradingViewPreviewProvider, number>,
  byFailureCode: {} as Record<string, number>,
  byResolutionSource: {} as Record<string, number>,
  byChain: {} as Record<string, number>,
  byDex: {} as Record<string, number>,
};

type DexPairRecord = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  pairCreatedAt?: number | string;
  labels?: string[];
  boosts?: {
    active?: number | string;
  };
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
    usd?: number | string;
  };
  volume?: {
    h24?: number | string;
    h6?: number | string;
    h1?: number | string;
  };
  txns?: {
    h24?: {
      buys?: number | string;
      sells?: number | string;
    };
  };
  priceUsd?: number | string;
  priceChange?: {
    h24?: number | string;
    h6?: number | string;
    h1?: number | string;
  };
  info?: {
    openGraph?: string;
    imageUrl?: string;
    header?: string;
  };
};

type DexPairLookupResponse = {
  pair?: DexPairRecord | null;
  pairs?: DexPairRecord[] | null;
};

type DexPairFetchResult = {
  candidatePairs: DexPairRecord[];
  source: "input_only" | "pair_address" | "token_address";
  failureCode: TradingViewPreviewFailureCode | null;
  failureDetail: string | null;
};

type DexPairLookupResult = {
  pair: DexPairRecord | null;
  candidatePairs: DexPairRecord[];
  ranking: TradingViewPreviewPairCandidate[];
  source: "input_only" | "pair_address" | "token_address";
  failureCode: TradingViewPreviewFailureCode | null;
  failureDetail: string | null;
};

type SparklineResult = {
  points: number[];
  source: "market_snapshot_history" | "derived_market_metrics";
  detail: string;
};

type HistoryPointRow = {
  recorded_at: string;
  price_usd: number | null;
  pair_address: string | null;
};

type PairRankingCandidate = {
  pair: DexPairRecord;
  diagnostic: TradingViewPreviewPairCandidate;
};

type TradingViewSearchRecord = {
  symbol?: string;
  description?: string;
  exchange?: string;
  type?: string;
  currency_code?: string;
  prefix?: string;
  source_id?: string;
  typespecs?: string[];
};

type TradingViewSearchResponse = {
  symbols?: TradingViewSearchRecord[];
};

type TradingViewSearchQuery = {
  term: string;
  kind: "symbol" | "symbol_quote" | "name" | "name_compact" | "name_compact_quote";
};

type TradingViewSearchCandidate = {
  symbol: string;
  score: number;
  query: TradingViewSearchQuery;
  record: TradingViewSearchRecord;
  rejectionReason: string | null;
  notes: string[];
};

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getCacheKey(input: TradingViewPreviewInput) {
  return JSON.stringify({
    coinId: input.id,
    chainId: input.chainId,
    dexId: input.dexId,
    pairAddress: resolvePairAddress(input),
    tokenAddress: input.tokenAddress,
    symbol: input.symbol,
    quoteSymbol: input.quoteSymbol,
    tradingviewSymbol: input.tradingviewSymbol,
    dexscreenerUrl: input.dexscreenerUrl,
    priceUsd: input.priceUsd,
    priceChange1hPct: input.priceChange1hPct,
    priceChange6hPct: input.priceChange6hPct,
    priceChange24hPct: input.priceChange24hPct,
  });
}

function normalizeLower(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeUpper(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase();
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

function incrementMetric(counter: Record<string, number>, key: string | null | undefined) {
  const normalized = String(key ?? "").trim() || "unknown";
  counter[normalized] = (counter[normalized] ?? 0) + 1;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];

  values.forEach((value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      return;
    }

    const dedupeKey = normalized.toUpperCase();
    if (seen.has(dedupeKey)) {
      return;
    }

    seen.add(dedupeKey);
    output.push(normalized);
  });

  return output;
}

function normalizeSearchText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function compactSearchText(value: string | null | undefined) {
  return normalizeUpper(value).replace(/[^A-Z0-9]/g, "");
}

function preferredQuoteCandidates(value: string | null | undefined) {
  const normalized = compactSearchText(value);
  if (!normalized) {
    return [];
  }

  return uniqueStrings([normalized, ...(QUOTE_SYMBOL_EQUIVALENTS[normalized] ?? [])]).map((entry) =>
    compactSearchText(entry),
  );
}

function tokenizeName(value: string | null | undefined) {
  return normalizeSearchText(value)
    .split(" ")
    .map((token) => compactSearchText(token))
    .filter((token) => token && !NAME_STOPWORDS.has(token));
}

function buildTradingViewPageSlug(symbol: string) {
  return normalizeUpper(symbol).replace(/:/g, "-");
}

function buildTradingViewSearchQueries(input: TradingViewPreviewInput): TradingViewSearchQuery[] {
  const symbol = compactSearchText(input.symbol);
  const rawName = normalizeSearchText(input.name);
  const compactName = compactSearchText(rawName);
  const cleanedTokens = tokenizeName(rawName);
  const cleanedName = cleanedTokens.join(" ");
  const cleanedCompactName = cleanedTokens.join("");
  const quoteCandidates = preferredQuoteCandidates(input.quoteSymbol).slice(0, 2);

  const queries = uniqueStrings([
    ...quoteCandidates.map((quote) => (symbol ? `${symbol}${quote}` : null)),
    ...quoteCandidates.map((quote) => (compactName ? `${compactName}${quote}` : null)),
    compactName,
    cleanedCompactName,
    cleanedName,
    rawName,
    symbol,
  ])
    .slice(0, MAX_TRADINGVIEW_SEARCH_QUERIES)
    .map<TradingViewSearchQuery>((term) => {
      if (symbol && quoteCandidates.some((quote) => term === `${symbol}${quote}`)) {
        return { term, kind: "symbol_quote" };
      }
      if (compactName && quoteCandidates.some((quote) => term === `${compactName}${quote}`)) {
        return { term, kind: "name_compact_quote" };
      }
      if (term === compactName || term === cleanedCompactName) {
        return { term, kind: "name_compact" };
      }
      if (term === rawName || term === cleanedName) {
        return { term, kind: "name" };
      }
      return { term, kind: "symbol" };
    });

  return queries;
}

function buildTradingViewWidgetSymbol(record: TradingViewSearchRecord) {
  const symbol = normalizeSearchText(record.symbol);
  const prefix = normalizeSearchText(record.prefix);
  if (!symbol) {
    return null;
  }

  return prefix ? `${prefix}:${symbol}` : symbol;
}

function splitSearchResultBaseQuote(
  value: string,
  preferredQuotes: string[],
) {
  const normalized = compactSearchText(value);
  const quotes = uniqueStrings([...preferredQuotes, ...GENERIC_TRADINGVIEW_QUOTES])
    .map((entry) => compactSearchText(entry))
    .sort((left, right) => right.length - left.length);

  for (const quote of quotes) {
    if (normalized.length > quote.length && normalized.endsWith(quote)) {
      return {
        base: normalized.slice(0, normalized.length - quote.length),
        quote,
      };
    }
  }

  return {
    base: normalized,
    quote: null,
  };
}

function buildRejectionValidation(symbol: string, rejectionReason: string): TradingViewPreviewCandidateValidation {
  return {
    symbol,
    valid: false,
    status: null,
    rejectionReason,
  };
}

function parsePairCreatedAtIso(value: unknown) {
  const numeric = parseNullableNumber(value);
  if (numeric !== null && numeric > 10_000_000_000) {
    return new Date(numeric).toISOString();
  }

  const iso = String(value ?? "").trim();
  if (!iso) {
    return null;
  }

  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseTxns24h(pair: DexPairRecord) {
  const buys = parseNumber(pair.txns?.h24?.buys);
  const sells = parseNumber(pair.txns?.h24?.sells);
  return buys + sells;
}

function snapshotImageUrlFromPair(pair: DexPairRecord | null) {
  const openGraph = String(pair?.info?.openGraph ?? "").trim();
  return openGraph || null;
}

function pairAddressMatches(left: DexPairRecord | null, right: DexPairRecord | null) {
  if (!left || !right) {
    return false;
  }

  const leftPairAddress = normalizeLower(left.pairAddress);
  const rightPairAddress = normalizeLower(right.pairAddress);
  if (leftPairAddress && rightPairAddress) {
    return leftPairAddress === rightPairAddress;
  }

  return normalizeLower(left.url) === normalizeLower(right.url);
}

function uniquePairs(pairs: DexPairRecord[]) {
  const seen = new Set<string>();
  const output: DexPairRecord[] = [];

  pairs.forEach((pair) => {
    const key =
      normalizeLower(pair.pairAddress) ||
      normalizeLower(pair.url) ||
      `${normalizeLower(pair.chainId)}:${normalizeLower(pair.dexId)}:${normalizeUpper(pair.baseToken?.symbol)}:${normalizeUpper(pair.quoteToken?.symbol)}`;
    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    output.push(pair);
  });

  return output;
}

function scoreDexPair(pair: DexPairRecord, input: TradingViewPreviewInput): TradingViewPreviewPairCandidate {
  const requestedPairAddress = normalizeLower(resolvePairAddress(input));
  const requestedDexId = normalizeLower(input.dexId);
  const requestedBaseSymbol = normalizeUpper(input.symbol);
  const requestedQuoteSymbol = normalizeUpper(input.quoteSymbol);
  const pairAddress = normalizeLower(pair.pairAddress);
  const dexId = normalizeLower(pair.dexId);
  const baseSymbol = normalizeUpper(pair.baseToken?.symbol);
  const quoteSymbol = normalizeUpper(pair.quoteToken?.symbol);
  const liquidityUsd = parseNumber(pair.liquidity?.usd);
  const volume24hUsd = parseNumber(pair.volume?.h24);
  const txns24h = parseTxns24h(pair);
  const hasPreviewImage = Boolean(snapshotImageUrlFromPair(pair));
  const pairCreatedAt = parsePairCreatedAtIso(pair.pairCreatedAt);

  let score = 0;
  if (pairAddress && pairAddress === requestedPairAddress && requestedPairAddress) {
    score += 1_200;
  }
  if (dexId && dexId === requestedDexId && requestedDexId) {
    score += 180;
  }
  if (baseSymbol && baseSymbol === requestedBaseSymbol && requestedBaseSymbol) {
    score += 160;
  }
  if (quoteSymbol && quoteSymbol === requestedQuoteSymbol && requestedQuoteSymbol) {
    score += 110;
  }

  score += PREFERRED_QUOTE_SCORES[quoteSymbol] ?? 0;
  score += Math.min(260, Math.log10(liquidityUsd + 1) * 64);
  score += Math.min(220, Math.log10(volume24hUsd + 1) * 54);
  score += Math.min(140, Math.log1p(txns24h) * 18);

  const boostsActive = parseNumber(pair.boosts?.active);
  if (boostsActive > 0) {
    score += Math.min(35, boostsActive * 9);
  }

  if (hasPreviewImage) {
    score += 24;
  }
  if (String(pair.url ?? "").trim()) {
    score += 10;
  }

  if (pairCreatedAt) {
    const ageHours = (Date.now() - Date.parse(pairCreatedAt)) / 3_600_000;
    if (Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= 96 && (liquidityUsd > 0 || volume24hUsd > 0)) {
      score += Math.max(4, 18 - ageHours / 8);
    }
    if (Number.isFinite(ageHours) && ageHours > 24 * 365 && liquidityUsd < 10_000 && volume24hUsd < 5_000) {
      score -= 20;
    }
  }

  if (!quoteSymbol) {
    score -= 50;
  }
  if (quoteSymbol && quoteSymbol === baseSymbol) {
    score -= 60;
  }
  if (liquidityUsd <= 0 && volume24hUsd <= 0 && txns24h <= 0) {
    score -= 400;
  }

  return {
    pairAddress: String(pair.pairAddress ?? "").trim() || null,
    dexId: String(pair.dexId ?? "").trim() || null,
    quoteSymbol: quoteSymbol || null,
    liquidityUsd,
    volume24hUsd,
    txns24h,
    pairCreatedAt,
    score: Number(score.toFixed(3)),
    matchedRequestedPair: Boolean(pairAddress && pairAddress === requestedPairAddress && requestedPairAddress),
    matchedRequestedDex: Boolean(dexId && dexId === requestedDexId && requestedDexId),
    matchedRequestedSymbol: Boolean(baseSymbol && baseSymbol === requestedBaseSymbol && requestedBaseSymbol),
    matchedRequestedQuote: Boolean(quoteSymbol && quoteSymbol === requestedQuoteSymbol && requestedQuoteSymbol),
    hasPreviewImage,
  };
}

function rankDexPairs(
  pairs: DexPairRecord[],
  input: TradingViewPreviewInput,
): PairRankingCandidate[] {
  return uniquePairs(pairs)
    .map((pair) => ({
      pair,
      diagnostic: scoreDexPair(pair, input),
    }))
    .sort((left, right) => right.diagnostic.score - left.diagnostic.score);
}

function mergePairLookupResults(
  input: TradingViewPreviewInput,
  pairLookup: DexPairFetchResult,
  tokenLookup: DexPairFetchResult,
): DexPairLookupResult {
  const rankedPairs = rankDexPairs(
    [...pairLookup.candidatePairs, ...tokenLookup.candidatePairs],
    input,
  );
  const pair = rankedPairs[0]?.pair ?? null;
  const ranking = rankedPairs.slice(0, 6).map((entry) => entry.diagnostic);

  if (pair) {
    const source = pairLookup.candidatePairs.some((candidate) => pairAddressMatches(candidate, pair))
      ? "pair_address"
      : tokenLookup.candidatePairs.some((candidate) => pairAddressMatches(candidate, pair))
        ? "token_address"
        : "input_only";

    return {
      pair,
      candidatePairs: rankedPairs.map((entry) => entry.pair),
      ranking,
      source,
      failureCode: null,
      failureDetail: null,
    };
  }

  if (pairLookup.failureCode && tokenLookup.failureCode && pairLookup.failureDetail && tokenLookup.failureDetail) {
    return {
      pair: null,
      candidatePairs: [],
      ranking,
      source: tokenLookup.source !== "input_only" ? tokenLookup.source : pairLookup.source,
      failureCode: pairLookup.failureCode === "pair_lookup_failed" ? pairLookup.failureCode : tokenLookup.failureCode,
      failureDetail: `${pairLookup.failureDetail} Token-address fallback also failed: ${tokenLookup.failureDetail}`,
    };
  }

  if (pairLookup.failureCode && pairLookup.failureCode !== "no_pair_identity") {
    return {
      pair: null,
      candidatePairs: [],
      ranking,
      source: pairLookup.source,
      failureCode: pairLookup.failureCode,
      failureDetail: pairLookup.failureDetail,
    };
  }

  return {
    pair: null,
    candidatePairs: [],
    ranking,
    source: tokenLookup.source,
    failureCode: tokenLookup.failureCode ?? pairLookup.failureCode,
    failureDetail: tokenLookup.failureDetail ?? pairLookup.failureDetail,
  };
}

function summarizeCandidateRejections(candidateValidation: TradingViewPreviewCandidateValidation[]) {
  const rejectionReasons = candidateValidation
    .filter((entry) => !entry.valid)
    .map((entry) => String(entry.rejectionReason ?? "").trim())
    .filter(Boolean);

  if (rejectionReasons.length === 0) {
    return null;
  }

  const uniqueReasons = [...new Set(rejectionReasons)];
  return uniqueReasons.length === 1 ? uniqueReasons[0] : "mixed";
}

function buildTradingViewUnavailableDetail(
  input: TradingViewPreviewInput,
  candidateValidation: TradingViewPreviewCandidateValidation[],
) {
  const pairLabel = pairLabelFromPreviewInput(input) ?? input.id;
  const commonRejectionReason = summarizeCandidateRejections(candidateValidation);
  const validationSummary =
    candidateValidation.length > 0
      ? `${candidateValidation.length} TradingView market candidates were checked${commonRejectionReason ? ` (common rejection: ${commonRejectionReason})` : ""}.`
      : "No TradingView candidates could be derived from the selected pair metadata or TradingView search.";

  return `TradingView mapping is unavailable for ${pairLabel}. ${validationSummary}`;
}

async function fetchDexPairByPairAddress(
  input: TradingViewPreviewInput,
): Promise<DexPairFetchResult> {
  const chainId = String(input.chainId ?? "").trim().toLowerCase();
  const pairAddress = resolvePairAddress(input);
  if (!chainId || !pairAddress) {
    return {
      candidatePairs: [],
      source: "input_only",
      failureCode: "no_pair_identity",
      failureDetail: "Missing chainId or pairAddress required for pair-level preview resolution.",
    };
  }

  const url = `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`;
  try {
    const response = await fetchWithTimeout(
      url,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      },
      DEX_LOOKUP_TIMEOUT_MS,
    );
    if (!response.ok) {
      return {
        candidatePairs: [],
        source: "pair_address",
        failureCode: "pair_lookup_failed",
        failureDetail: `Dexscreener pair lookup returned HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as DexPairLookupResponse;
    const pairs = [
      ...(payload.pair ? [payload.pair] : []),
      ...((payload.pairs ?? []).filter(Boolean) as DexPairRecord[]),
    ];
    if (pairs.length === 0) {
      return {
        candidatePairs: [],
        source: "pair_address",
        failureCode: "pair_not_found",
        failureDetail: "Dexscreener did not return a pair record for this chain/pair identity.",
      };
    }

    return {
      candidatePairs: pairs,
      source: "pair_address",
      failureCode: null,
      failureDetail: null,
    };
  } catch (error) {
    return {
      candidatePairs: [],
      source: "pair_address",
      failureCode: "pair_lookup_failed",
      failureDetail: String((error as Error)?.message ?? error ?? "Dexscreener pair lookup failed."),
    };
  }
}

async function fetchDexPairByTokenAddress(
  input: TradingViewPreviewInput,
): Promise<DexPairFetchResult> {
  const chainId = String(input.chainId ?? "").trim().toLowerCase();
  const tokenAddress = String(input.tokenAddress ?? "").trim();
  if (!chainId || !tokenAddress) {
    return {
      candidatePairs: [],
      source: "input_only",
      failureCode: "no_pair_identity",
      failureDetail: "Missing chainId or tokenAddress required for token-level preview resolution.",
    };
  }

  const url = `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddress)}`;
  try {
    const response = await fetchWithTimeout(
      url,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      },
      DEX_LOOKUP_TIMEOUT_MS,
    );
    if (!response.ok) {
      return {
        candidatePairs: [],
        source: "token_address",
        failureCode: "pair_lookup_failed",
        failureDetail: `Dexscreener token-pairs lookup returned HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as DexPairRecord[] | null;
    const pairs = Array.isArray(payload) ? payload : [];
    if (pairs.length === 0) {
      return {
        candidatePairs: [],
        source: "token_address",
        failureCode: "pair_not_found",
        failureDetail: "Dexscreener did not return any token-level pairs for this token address.",
      };
    }

    return {
      candidatePairs: pairs,
      source: "token_address",
      failureCode: null,
      failureDetail: null,
    };
  } catch (error) {
    return {
      candidatePairs: [],
      source: "token_address",
      failureCode: "pair_lookup_failed",
      failureDetail: String((error as Error)?.message ?? error ?? "Dexscreener token-pairs lookup failed."),
    };
  }
}

async function fetchDexPair(input: TradingViewPreviewInput): Promise<DexPairLookupResult> {
  const pairLookup = await fetchDexPairByPairAddress(input);
  const tokenLookup = await fetchDexPairByTokenAddress(input);
  return mergePairLookupResults(input, pairLookup, tokenLookup);
}

async function validateTradingViewSymbol(symbol: string): Promise<TradingViewPreviewCandidateValidation> {
  try {
    const response = await fetchWithTimeout(
      `https://www.tradingview.com/symbols/${encodeURIComponent(buildTradingViewPageSlug(symbol))}/`,
      {
        cache: "no-store",
        headers: {
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      },
      TRADINGVIEW_VALIDATE_TIMEOUT_MS,
    );

    if (!response.ok) {
      return {
        symbol,
        valid: false,
        status: response.status,
        rejectionReason: `http_${response.status}`,
      };
    }

    const html = await response.text();
    const isInvalid =
      html.includes("This symbol doesn&#39;t exist") ||
      html.includes("This symbol doesn't exist") ||
      html.includes("This symbol does not exist");

    return {
      symbol,
      valid: !isInvalid,
      status: response.status,
      rejectionReason: isInvalid ? "symbol_not_found_page" : null,
    };
  } catch {
    return {
      symbol,
      valid: false,
      status: null,
      rejectionReason: "request_failed",
    };
  }
}

async function validateTradingViewCandidates(candidates: string[]) {
  const candidateValidation: TradingViewPreviewCandidateValidation[] = [];

  for (let index = 0; index < candidates.length; index += TRADINGVIEW_VALIDATION_BATCH_SIZE) {
    const batch = candidates.slice(index, index + TRADINGVIEW_VALIDATION_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((candidate) => validateTradingViewSymbol(candidate)));
    candidateValidation.push(...batchResults);

    if (batchResults.some((entry) => entry.valid)) {
      break;
    }
  }

  return candidateValidation;
}

async function fetchTradingViewSearchResults(query: TradingViewSearchQuery) {
  try {
    const response = await fetchWithTimeout(
      `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(query.term)}&lang=en&search_type=crypto`,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Origin: "https://www.tradingview.com",
          Referer: "https://www.tradingview.com/",
          "User-Agent": "Mozilla/5.0",
        },
      },
      TRADINGVIEW_SEARCH_TIMEOUT_MS,
    );

    if (!response.ok) {
      return {
        query,
        records: [] as TradingViewSearchRecord[],
        error: `search_http_${response.status}`,
      };
    }

    const payload = (await response.json()) as TradingViewSearchResponse;
    return {
      query,
      records: Array.isArray(payload.symbols) ? payload.symbols : [],
      error: null,
    };
  } catch {
    return {
      query,
      records: [] as TradingViewSearchRecord[],
      error: "search_request_failed",
    };
  }
}

function scoreTradingViewSearchCandidate(
  input: TradingViewPreviewInput,
  query: TradingViewSearchQuery,
  record: TradingViewSearchRecord,
): TradingViewSearchCandidate | null {
  const widgetSymbol = buildTradingViewWidgetSymbol(record);
  if (!widgetSymbol) {
    return null;
  }

  const rawSymbol = compactSearchText(record.symbol);
  const description = normalizeSearchText(record.description);
  const descriptionCompact = compactSearchText(description);
  const type = normalizeUpper(record.type);
  const sourceId = normalizeUpper(record.source_id ?? record.prefix);
  const typespecs = (record.typespecs ?? []).map((entry) => normalizeUpper(entry));
  const preferredQuotes = preferredQuoteCandidates(input.quoteSymbol);
  const splitPair = splitSearchResultBaseQuote(rawSymbol, preferredQuotes);
  const inputSymbol = compactSearchText(input.symbol);
  const inputNameVariants = uniqueStrings([
    compactSearchText(input.name),
    tokenizeName(input.name).join(""),
  ])
    .map((entry) => compactSearchText(entry))
    .filter(Boolean);
  const longNameVariants = inputNameVariants.filter((entry) => entry.length >= Math.max(inputSymbol.length + 2, 6));
  const descriptionTokens = new Set(tokenizeName(description));
  const notes: string[] = [];

  if (!rawSymbol) {
    return {
      symbol: widgetSymbol,
      score: Number.NEGATIVE_INFINITY,
      query,
      record,
      rejectionReason: "search_missing_symbol",
      notes,
    };
  }

  if (type === "FUNDAMENTAL" || rawSymbol.includes("_SUPPLY") || rawSymbol.includes("_MARKETCAP")) {
    return {
      symbol: widgetSymbol,
      score: Number.NEGATIVE_INFINITY,
      query,
      record,
      rejectionReason: "search_non_chart_result",
      notes,
    };
  }

  if (type === "INDEX" && sourceId === "CRYPTOCAP") {
    return {
      symbol: widgetSymbol,
      score: Number.NEGATIVE_INFINITY,
      query,
      record,
      rejectionReason: "search_market_cap_index",
      notes,
    };
  }

  if (type !== "SPOT" && type !== "SWAP" && !typespecs.includes("CRYPTO")) {
    return {
      symbol: widgetSymbol,
      score: Number.NEGATIVE_INFINITY,
      query,
      record,
      rejectionReason: "search_non_crypto_result",
      notes,
    };
  }

  let score = 0;
  if (query.kind === "symbol_quote") {
    score += 38;
    notes.push("symbol_quote_query");
  } else if (query.kind === "name_compact_quote") {
    score += 44;
    notes.push("name_quote_query");
  } else if (query.kind === "name_compact") {
    score += 34;
    notes.push("compact_name_query");
  } else if (query.kind === "name") {
    score += 28;
    notes.push("name_query");
  } else {
    score += 18;
    notes.push("symbol_query");
  }

  if (splitPair.base && splitPair.base === inputSymbol) {
    score += 44;
    notes.push("base_symbol_match");
  }

  if (preferredQuotes.includes(splitPair.quote ?? "")) {
    score += 26;
    notes.push("preferred_quote_match");
  } else if (splitPair.quote && ["USD", "USDC", "USDT"].includes(splitPair.quote)) {
    score += 12;
    notes.push("stable_quote_match");
  }

  if (type === "SPOT") {
    score += 24;
  } else if (type === "SWAP") {
    score += 6;
  } else if (type === "INDEX") {
    score -= 12;
  }

  if (typespecs.includes("PERPETUAL") || rawSymbol.includes(".P")) {
    score -= 18;
    notes.push("perpetual_penalty");
  }

  if (sourceId === "CRYPTO") {
    score += 14;
    notes.push("aggregate_crypto_source");
  }

  const overlappingNameTokens = tokenizeName(input.name).filter(
    (token) => descriptionTokens.has(token) || rawSymbol.includes(token),
  );
  const strongNamePrefixMatch = inputNameVariants.some(
    (variant) => variant.length >= 4 && rawSymbol.startsWith(variant),
  );
  let hasStructuralIdentityMatch = Boolean(
    (splitPair.base && splitPair.base === inputSymbol && inputSymbol) ||
      overlappingNameTokens.length > 0 ||
      strongNamePrefixMatch,
  );
  if (!hasStructuralIdentityMatch && longNameVariants.length > 0) {
    hasStructuralIdentityMatch = longNameVariants.some(
      (variant) => rawSymbol.startsWith(variant) || descriptionCompact.includes(variant),
    );
  }
  if (!hasStructuralIdentityMatch) {
    return {
      symbol: widgetSymbol,
      score: Number.NEGATIVE_INFINITY,
      query,
      record,
      rejectionReason: "search_no_identity_match",
      notes,
    };
  }

  if (overlappingNameTokens.length > 0) {
    score += Math.min(36, overlappingNameTokens.length * 12);
    notes.push("name_token_overlap");
  }

  const hasStrongNameMatch =
    longNameVariants.length === 0 ||
    longNameVariants.some((variant) => rawSymbol.startsWith(variant) || descriptionCompact.includes(variant));
  if (hasStrongNameMatch && longNameVariants.length > 0) {
    score += 48;
    notes.push("full_name_match");
  } else if (longNameVariants.length > 0) {
    score -= 55;
    notes.push("full_name_mismatch");
  }

  if (inputSymbol.length <= 2 && query.kind === "symbol") {
    score -= 18;
    notes.push("short_symbol_penalty");
  }

  const rejectionReason = score >= 85 ? null : "search_score_too_low";
  return {
    symbol: widgetSymbol,
    score,
    query,
    record,
    rejectionReason,
    notes,
  };
}

async function resolveTradingViewSearch(
  input: TradingViewPreviewInput,
  excludedSymbols: string[],
) {
  const queries = buildTradingViewSearchQueries(input);
  if (queries.length === 0) {
    return {
      symbol: null,
      queries,
      candidateSymbols: [] as string[],
      validation: [] as TradingViewPreviewCandidateValidation[],
      notes: ["TradingView search was skipped because no usable symbol or token-name query could be constructed."],
    };
  }

  const queryResults = await Promise.all(queries.map((query) => fetchTradingViewSearchResults(query)));
  const scoredBySymbol = new Map<string, TradingViewSearchCandidate>();
  const validation: TradingViewPreviewCandidateValidation[] = [];
  const exclusionSet = new Set(excludedSymbols.map((entry) => normalizeUpper(entry)));
  const notes = [
    `TradingView search queries: ${queries.map((query) => query.term).join(", ")}`,
  ];

  queryResults.forEach((result) => {
    if (result.error) {
      notes.push(`TradingView search for "${result.query.term}" returned ${result.error}.`);
    }

    result.records.forEach((record) => {
      const scored = scoreTradingViewSearchCandidate(input, result.query, record);
      if (!scored) {
        return;
      }

      const dedupeKey = normalizeUpper(scored.symbol);
      const existing = scoredBySymbol.get(dedupeKey);
      if (!existing || existing.score < scored.score) {
        scoredBySymbol.set(dedupeKey, scored);
      }
    });
  });

  const ranked = [...scoredBySymbol.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_TRADINGVIEW_SEARCH_RESULTS);

  ranked.forEach((candidate) => {
    if (exclusionSet.has(normalizeUpper(candidate.symbol))) {
      validation.push(buildRejectionValidation(candidate.symbol, "duplicate_search_candidate"));
      return;
    }

    if (candidate.rejectionReason) {
      validation.push(buildRejectionValidation(candidate.symbol, candidate.rejectionReason));
    }
  });

  const candidatesToValidate = ranked
    .filter((candidate) => !candidate.rejectionReason && !exclusionSet.has(normalizeUpper(candidate.symbol)))
    .slice(0, MAX_TRADINGVIEW_SEARCH_VALIDATIONS);
  const validatedCandidates = await validateTradingViewCandidates(
    candidatesToValidate.map((candidate) => candidate.symbol),
  );
  validation.push(...validatedCandidates);

  const validCandidate = validatedCandidates.find((entry) => entry.valid)?.symbol ?? null;
  if (validCandidate) {
    const winningCandidate = ranked.find((candidate) => normalizeUpper(candidate.symbol) === normalizeUpper(validCandidate));
    if (winningCandidate) {
      notes.push(
        `TradingView search matched ${validCandidate} via query "${winningCandidate.query.term}" (${winningCandidate.notes.join(", ")}).`,
      );
    }
  }

  return {
    symbol: validCandidate,
    queries,
    candidateSymbols: ranked.map((candidate) => candidate.symbol),
    validation,
    notes,
  };
}

function downsamplePoints(points: number[], targetCount: number) {
  if (points.length <= targetCount) {
    return points;
  }

  const sampled: number[] = [];
  const maxIndex = points.length - 1;
  for (let index = 0; index < targetCount; index += 1) {
    const sourceIndex = Math.round((index / (targetCount - 1)) * maxIndex);
    sampled.push(points[sourceIndex]);
  }

  return sampled;
}

async function loadSparklineFromHistory(
  input: TradingViewPreviewInput,
): Promise<SparklineResult | null> {
  const chainId = String(input.chainId ?? "").trim().toLowerCase();
  const tokenAddress = String(input.tokenAddress ?? "").trim();
  if (!hasDatabaseUrl() || !chainId || !tokenAddress) {
    return null;
  }

  try {
    const pool = getServerPostgresPool();
    const result = await pool.query<HistoryPointRow>(
      `
        SELECT
          s.recorded_at,
          s.price_usd,
          s.pair_address
        FROM public.memecoin_market_snapshots s
        INNER JOIN public.memecoin_assets a
          ON a.asset_id = s.asset_id
        WHERE a.chain_id = $1
          AND LOWER(a.token_address) = LOWER($2)
          AND s.price_usd IS NOT NULL
        ORDER BY s.recorded_at DESC
        LIMIT $3
      `,
      [chainId, tokenAddress, SPARKLINE_HISTORY_QUERY_LIMIT],
    );

    const rows = result.rows.filter((row) => typeof row.price_usd === "number" && Number.isFinite(row.price_usd));
    if (rows.length === 0) {
      return null;
    }

    const requestedPairAddress = normalizeLower(resolvePairAddress(input));
    const preferredRows =
      requestedPairAddress
        ? rows.filter((row) => normalizeLower(row.pair_address) === requestedPairAddress)
        : [];
    const sourceRows = preferredRows.length >= 2 ? preferredRows : rows;
    const points = sourceRows
      .slice(0, SPARKLINE_HISTORY_LIMIT)
      .reverse()
      .map((row) => row.price_usd as number)
      .filter((value) => Number.isFinite(value) && value > 0);

    if (points.length < 2) {
      return null;
    }

    return {
      points: downsamplePoints(points, SPARKLINE_HISTORY_LIMIT),
      source: "market_snapshot_history",
      detail: `Loaded ${points.length} stored market snapshots for sparkline fallback.`,
    };
  } catch (error) {
    const message = String((error as Error)?.message ?? error ?? "");
    if (message.includes("relation") && message.includes("does not exist")) {
      return null;
    }
    return null;
  }
}

function priceBeforeChange(currentPrice: number, changePct: number | null) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || changePct === null || !Number.isFinite(changePct)) {
    return null;
  }

  const denominator = 1 + changePct / 100;
  if (!Number.isFinite(denominator) || denominator <= 0.01) {
    return null;
  }

  const previousPrice = currentPrice / denominator;
  return Number.isFinite(previousPrice) && previousPrice > 0 ? previousPrice : null;
}

function deriveSparklineFromMetrics(input: TradingViewPreviewInput): SparklineResult | null {
  const currentPrice = parseNullableNumber(input.priceUsd);
  if (currentPrice === null || currentPrice <= 0) {
    return null;
  }

  const anchors = [
    priceBeforeChange(currentPrice, parseNullableNumber(input.priceChange24hPct)),
    priceBeforeChange(currentPrice, parseNullableNumber(input.priceChange6hPct)),
    priceBeforeChange(currentPrice, parseNullableNumber(input.priceChange1hPct)),
    currentPrice,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);

  if (anchors.length < 2) {
    return null;
  }

  return {
    points: anchors,
    source: "derived_market_metrics",
    detail: `Derived ${anchors.length} sparkline anchors from current price and stored percentage changes.`,
  };
}

async function resolveSparkline(input: TradingViewPreviewInput) {
  const historySparkline = await loadSparklineFromHistory(input);
  if (historySparkline) {
    return historySparkline;
  }

  return deriveSparklineFromMetrics(input);
}

function buildAvailablePreviewModes(options: {
  hasTradingView: boolean;
  hasDexPreview: boolean;
  hasSparkline: boolean;
  hasDexLink: boolean;
}) {
  const modes: TradingViewPreviewProvider[] = [];
  if (options.hasTradingView) {
    modes.push("tradingview");
  }
  if (options.hasDexPreview || options.hasDexLink) {
    modes.push("dexscreener");
  }
  if (options.hasSparkline) {
    modes.push("sparkline");
  }
  if (modes.length === 0) {
    modes.push("unavailable");
  }
  return modes;
}

function mergePreviewInput(
  input: TradingViewPreviewInput,
  pair: DexPairRecord | null,
): TradingViewPreviewInput {
  if (!pair) {
    return input;
  }

  return {
    ...input,
    chainId: String(pair.chainId ?? "").trim().toLowerCase() || input.chainId,
    dexId: String(pair.dexId ?? "").trim() || input.dexId || null,
    pairAddress: String(pair.pairAddress ?? "").trim() || resolvePairAddress(input) || input.pairAddress,
    pairLabels: pair.labels ?? input.pairLabels ?? null,
    tokenAddress: String(pair.baseToken?.address ?? "").trim() || input.tokenAddress,
    name: String(pair.baseToken?.name ?? "").trim() || input.name,
    symbol: String(pair.baseToken?.symbol ?? "").trim() || input.symbol,
    quoteSymbol: String(pair.quoteToken?.symbol ?? "").trim() || input.quoteSymbol,
    dexscreenerUrl: String(pair.url ?? "").trim() || input.dexscreenerUrl,
    priceUsd: parseNullableNumber(pair.priceUsd) ?? input.priceUsd ?? null,
    priceChange1hPct: parseNullableNumber(pair.priceChange?.h1) ?? input.priceChange1hPct ?? null,
    priceChange6hPct: parseNullableNumber(pair.priceChange?.h6) ?? input.priceChange6hPct ?? null,
    priceChange24hPct: parseNullableNumber(pair.priceChange?.h24) ?? input.priceChange24hPct ?? null,
  };
}

function recordPreviewMetrics(preview: TradingViewPreviewResponse) {
  previewMetrics.total += 1;
  previewMetrics.byStatus[preview.status] += 1;
  if (preview.failureCode) {
    incrementMetric(previewMetrics.byFailureCode, preview.failureCode);
  }
  incrementMetric(previewMetrics.byResolutionSource, preview.resolutionSource ?? "none");
  incrementMetric(previewMetrics.byChain, preview.debug.chainId);
  incrementMetric(previewMetrics.byDex, preview.debug.dexId);

  if (
    previewMetrics.total % PREVIEW_METRIC_SNAPSHOT_INTERVAL === 0 ||
    preview.status === "unavailable"
  ) {
    console.info("[memecoin-preview-metrics]", {
      total: previewMetrics.total,
      byStatus: previewMetrics.byStatus,
      byFailureCode: previewMetrics.byFailureCode,
      byResolutionSource: previewMetrics.byResolutionSource,
      byChain: previewMetrics.byChain,
      byDex: previewMetrics.byDex,
    });
  }
}

async function resolveCoinPreviewUncached(
  input: TradingViewPreviewInput,
): Promise<TradingViewPreviewResponse> {
  const explicitSymbol = getExplicitTradingViewSymbol(input);
  if (explicitSymbol) {
    return createResolvedTradingViewPreview(input, {
      tradingviewSymbol: explicitSymbol,
      resolutionSource: "stored_symbol",
      availablePreviewModes: ["tradingview"],
      resolutionNotes: [
        "Using the stored TradingView symbol from row metadata.",
      ],
    });
  }

  const curatedSymbol = getCuratedTradingViewSymbol(input);
  if (curatedSymbol) {
    return createResolvedTradingViewPreview(input, {
      tradingviewSymbol: curatedSymbol,
      resolutionSource: "curated_ticker",
      availablePreviewModes: ["tradingview"],
      resolutionNotes: [
        "Using a curated TradingView mapping for a canonical memecoin ticker.",
      ],
    });
  }

  const pairLookup = await fetchDexPair(input);
  const resolvedInput = mergePreviewInput(input, pairLookup.pair);
  const resolutionNotes: string[] = [];
  const requestedPairAddress = normalizeLower(resolvePairAddress(input));
  const selectedPairAddress = normalizeLower(pairLookup.pair?.pairAddress);

  if (pairLookup.pair && selectedPairAddress && requestedPairAddress && selectedPairAddress !== requestedPairAddress) {
    resolutionNotes.push(
      `Preview switched to a higher-quality pair (${pairLookup.pair?.pairAddress}) after token-level pair ranking.`,
    );
  }
  if (pairLookup.failureDetail) {
    resolutionNotes.push(pairLookup.failureDetail);
  }

  const candidates = buildPairDerivedTradingViewCandidates(resolvedInput).slice(0, MAX_TRADINGVIEW_CANDIDATES);
  const pairDerivedValidation =
    candidates.length > 0 ? await validateTradingViewCandidates(candidates) : [];
  const validCandidate = pairDerivedValidation.find((entry) => entry.valid)?.symbol ?? null;

  if (validCandidate) {
    return createResolvedTradingViewPreview(resolvedInput, {
      tradingviewSymbol: validCandidate,
      resolutionSource: "pair_derived",
      baseTokenSymbol: resolvedInput.symbol,
      quoteTokenSymbol: resolvedInput.quoteSymbol,
      pairLookupSource: pairLookup.source,
      pairLookupFailureCode: pairLookup.failureCode,
      pairLookupFailureDetail: pairLookup.failureDetail,
      dexId: resolvedInput.dexId,
      pairLabels: resolvedInput.pairLabels ?? [],
      pairRanking: pairLookup.ranking,
      candidateSymbolsTried: candidates,
      candidateValidation: pairDerivedValidation,
      availablePreviewModes: ["tradingview"],
      resolutionNotes: [
        `Validated ${validCandidate} as a TradingView-compatible heuristic symbol.`,
        ...resolutionNotes,
      ],
    });
  }

  const searchResolution = await resolveTradingViewSearch(resolvedInput, candidates);
  const combinedCandidateSymbols = uniqueStrings([...candidates, ...searchResolution.candidateSymbols]);
  const combinedValidation = [...pairDerivedValidation, ...searchResolution.validation];

  if (searchResolution.symbol) {
    return createResolvedTradingViewPreview(resolvedInput, {
      tradingviewSymbol: searchResolution.symbol,
      resolutionSource: "tradingview_search",
      baseTokenSymbol: resolvedInput.symbol,
      quoteTokenSymbol: resolvedInput.quoteSymbol,
      pairLookupSource: pairLookup.source,
      pairLookupFailureCode: pairLookup.failureCode,
      pairLookupFailureDetail: pairLookup.failureDetail,
      dexId: resolvedInput.dexId,
      pairLabels: resolvedInput.pairLabels ?? [],
      pairRanking: pairLookup.ranking,
      candidateSymbolsTried: combinedCandidateSymbols,
      candidateValidation: combinedValidation,
      availablePreviewModes: ["tradingview"],
      resolutionNotes: [
        ...resolutionNotes,
        ...searchResolution.notes,
      ],
    });
  }

  const mappingFailureCode =
    pairLookup.pair || combinedCandidateSymbols.length > 0
      ? "tradingview_symbol_unavailable"
      : pairLookup.failureCode ?? "symbol_candidates_exhausted";
  const mappingFailureDetail =
    pairLookup.pair || combinedCandidateSymbols.length > 0
      ? buildTradingViewUnavailableDetail(resolvedInput, combinedValidation)
      : pairLookup.failureDetail ?? "No TradingView-compatible symbol mapping could be validated.";
  const snapshotImageUrl = snapshotImageUrlFromPair(pairLookup.pair);
  const availablePreviewModes = buildAvailablePreviewModes({
    hasTradingView: false,
    hasDexPreview: Boolean(snapshotImageUrl),
    hasSparkline: false,
    hasDexLink: Boolean(resolvedInput.dexscreenerUrl),
  });

  return createFallbackTradingViewPreview(resolvedInput, {
    failureCode: mappingFailureCode,
    failureDetail: mappingFailureDetail,
    snapshotImageUrl,
    dexscreenerEmbedUrl: resolvedInput.dexscreenerUrl,
    baseTokenSymbol: resolvedInput.symbol,
    quoteTokenSymbol: resolvedInput.quoteSymbol,
    pairLookupSource: pairLookup.source,
    pairLookupFailureCode: pairLookup.failureCode,
    pairLookupFailureDetail: pairLookup.failureDetail,
    dexId: resolvedInput.dexId,
    pairLabels: resolvedInput.pairLabels ?? [],
    pairRanking: pairLookup.ranking,
    candidateSymbolsTried: combinedCandidateSymbols,
    candidateValidation: combinedValidation,
    availablePreviewModes,
    resolutionNotes: [
      ...resolutionNotes,
      ...searchResolution.notes,
      "Falling back to Dexscreener because TradingView symbol validation did not succeed.",
    ],
  });
}

export async function resolveCoinPreview(
  input: TradingViewPreviewInput,
): Promise<TradingViewPreviewResponse> {
  const cacheKey = getCacheKey(input);
  const now = Date.now();
  const cached = previewCache.get(cacheKey);
  if (cached?.value && cached.expiresAt > now) {
    recordPreviewMetrics(cached.value);
    return cached.value;
  }
  if (cached?.promise) {
    const preview = await cached.promise;
    recordPreviewMetrics(preview);
    return preview;
  }

  const promise = resolveCoinPreviewUncached(input)
    .then((value) => {
      previewCache.set(cacheKey, {
        expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
        promise: null,
        value,
      });
      return value;
    })
    .catch((error) => {
      previewCache.delete(cacheKey);
      throw error;
    });

  previewCache.set(cacheKey, {
    expiresAt: 0,
    promise,
    value: cached?.value ?? null,
  });

  const preview = await promise;
  recordPreviewMetrics(preview);
  return preview;
}

export async function resolveTradingViewPreview(
  input: TradingViewPreviewInput,
): Promise<TradingViewPreviewResponse> {
  return resolveCoinPreview(input);
}
