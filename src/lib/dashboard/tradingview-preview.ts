import type { CorrelatedMemecoinRow } from "@/types/view-models";

export type TradingViewPreviewProvider = "tradingview" | "dexscreener" | "sparkline" | "unavailable";
export type TradingViewPreviewDisplayMode =
  | "tradingview_chart"
  | "dexscreener_snapshot"
  | "dexscreener_link"
  | "sparkline_chart"
  | "unavailable";

export type TradingViewPreviewResolutionSource =
  | "stored_symbol"
  | "curated_ticker"
  | "pair_derived"
  | "tradingview_search"
  | "dex_pair_metadata"
  | "market_snapshot_history"
  | "derived_market_metrics";

export type TradingViewPreviewFailureCode =
  | "no_pair_identity"
  | "pair_lookup_failed"
  | "pair_not_found"
  | "market_not_live"
  | "tradingview_symbol_unavailable"
  | "symbol_candidates_exhausted"
  | "dexscreener_snapshot_unavailable"
  | "sparkline_unavailable"
  | "no_recovery_path"
  | "widget_script_error"
  | "widget_iframe_timeout";

export type TradingViewPreviewCandidateValidation = {
  symbol: string;
  valid: boolean;
  status: number | null;
  rejectionReason: string | null;
};

export type TradingViewPreviewPairCandidate = {
  pairAddress: string | null;
  dexId: string | null;
  quoteSymbol: string | null;
  liquidityUsd: number;
  volume24hUsd: number;
  txns24h: number;
  pairCreatedAt: string | null;
  score: number;
  matchedRequestedPair: boolean;
  matchedRequestedDex: boolean;
  matchedRequestedSymbol: boolean;
  matchedRequestedQuote: boolean;
  hasPreviewImage: boolean;
};

export type TradingViewPreviewDebug = {
  coinId: string;
  chainId: string | null;
  dexId: string | null;
  pairAddress: string | null;
  tokenAddress: string | null;
  pairUrl: string | null;
  baseTokenSymbol: string | null;
  quoteTokenSymbol: string | null;
  symbolTextShownInUi: string | null;
  symbolPassedToChartWidget: string | null;
  previewProviderSelected: TradingViewPreviewProvider;
  displayMode: TradingViewPreviewDisplayMode;
  resolutionSource: TradingViewPreviewResolutionSource | null;
  failureReason: TradingViewPreviewFailureCode | null;
  failureDetail: string | null;
  fallbackTriggeredBeforeMountCompleted: boolean;
  storedTradingviewSymbol: string | null;
  snapshotImageUrl: string | null;
  dexscreenerEmbedUrl: string | null;
  sparklinePointCount: number;
  sparklineSource: "market_snapshot_history" | "derived_market_metrics" | null;
  pairLookupSource: "input_only" | "pair_address" | "token_address";
  pairLookupFailureCode: TradingViewPreviewFailureCode | null;
  pairLookupFailureDetail: string | null;
  pairLabels: string[];
  pairRanking: TradingViewPreviewPairCandidate[];
  candidateSymbolsTried: string[];
  candidateValidation: TradingViewPreviewCandidateValidation[];
  commonCandidateRejectionReason: string | null;
  availablePreviewModes: TradingViewPreviewProvider[];
  resolutionNotes: string[];
};

export type TradingViewPreviewResponse = {
  status: TradingViewPreviewProvider;
  provider: TradingViewPreviewProvider;
  displayMode: TradingViewPreviewDisplayMode;
  tradingviewSymbol: string | null;
  dexUrl: string;
  dexscreenerEmbedUrl: string | null;
  snapshotImageUrl: string | null;
  snapshotAlt: string | null;
  sparklinePoints: number[] | null;
  sparklineSource: "market_snapshot_history" | "derived_market_metrics" | null;
  failureCode: TradingViewPreviewFailureCode | null;
  failureDetail: string | null;
  resolutionSource: TradingViewPreviewResolutionSource | null;
  debug: TradingViewPreviewDebug;
};

export type TradingViewPreviewInput = Pick<
  CorrelatedMemecoinRow,
  | "id"
  | "chainId"
  | "dexId"
  | "pairAddress"
  | "pairLabels"
  | "tokenAddress"
  | "name"
  | "symbol"
  | "quoteSymbol"
  | "tradingviewSymbol"
  | "dexscreenerUrl"
  | "priceUsd"
  | "priceChange1hPct"
  | "priceChange6hPct"
  | "priceChange24hPct"
>;

export const KNOWN_MEME_TRADINGVIEW_SYMBOLS: Record<string, string> = {
  DOGE: "BINANCE:DOGEUSDT",
  SHIB: "BINANCE:SHIBUSDT",
  PEPE: "BINANCE:PEPEUSDT",
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

const DEX_EXCHANGE_ALIASES: Record<string, string[]> = {
  AERODROME: ["AERODROME"],
  BASESWAP: ["BASESWAP"],
  METEORA: ["METEORA"],
  ORCA: ["ORCA"],
  PANCAKESWAP: ["PANCAKESWAP"],
  PUMPFUN: ["PUMPFUN"],
  PUMPSWAP: ["PUMPSWAP"],
  RAYDIUM: ["RAYDIUM"],
  UNISWAP: ["UNISWAP"],
};

const CHAIN_EXCHANGE_ALIASES: Record<string, string[]> = {
  BASE: ["BASE"],
  BSC: ["BSC"],
  ETHEREUM: ["ETHEREUM"],
  SOLANA: ["SOLANA"],
};

function normalizeMaybeString(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeImageUrl(value: string | null | undefined) {
  const normalized = normalizeMaybeString(value);
  if (!normalized) {
    return null;
  }

  if (
    normalized.startsWith("https://") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("data:")
  ) {
    return normalized;
  }

  return null;
}

export function normalizeTicker(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeTradingViewSymbol(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function sanitizeTradingViewSegment(value: string | null | undefined) {
  return normalizeTicker(value).slice(0, 32);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];

  values.forEach((value) => {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    output.push(normalized);
  });

  return output;
}

function normalizeNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function preferredQuoteCandidates(value: string | null | undefined) {
  const normalized = sanitizeTradingViewSegment(value);
  if (!normalized) {
    return [];
  }

  return uniqueStrings([normalized, ...(QUOTE_SYMBOL_EQUIVALENTS[normalized] ?? [])]);
}

function preferredExchangeCandidates(input: TradingViewPreviewInput) {
  const dexId = normalizeTicker(input.dexId);
  const chainId = normalizeTicker(input.chainId);

  return uniqueStrings([
    ...(DEX_EXCHANGE_ALIASES[dexId] ?? []),
    ...(CHAIN_EXCHANGE_ALIASES[chainId] ?? []),
  ]);
}

export function pairLabelFromPreviewInput(
  row: Pick<TradingViewPreviewInput, "symbol" | "quoteSymbol">,
) {
  const symbol = normalizeMaybeString(row.symbol);
  const quoteSymbol = normalizeMaybeString(row.quoteSymbol);
  if (!symbol) {
    return null;
  }

  return quoteSymbol ? `${symbol}/${quoteSymbol}` : symbol;
}

export function parsePairAddressFromDexscreenerUrl(url: string | null | undefined) {
  const normalized = normalizeMaybeString(url);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    const segments = parsed.pathname
      .split("/")
      .map((value) => value.trim())
      .filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    return segments.at(-1) ?? null;
  } catch {
    return null;
  }
}

export function resolvePairAddress(input: TradingViewPreviewInput) {
  return normalizeMaybeString(input.pairAddress) ?? parsePairAddressFromDexscreenerUrl(input.dexscreenerUrl);
}

export function getExplicitTradingViewSymbol(input: TradingViewPreviewInput) {
  return normalizeMaybeString(normalizeTradingViewSymbol(input.tradingviewSymbol));
}

export function getCuratedTradingViewSymbol(input: Pick<TradingViewPreviewInput, "symbol">) {
  const normalizedSymbol = normalizeTicker(input.symbol);
  return KNOWN_MEME_TRADINGVIEW_SYMBOLS[normalizedSymbol] ?? null;
}

export function buildPairDerivedTradingViewCandidates(input: TradingViewPreviewInput) {
  const baseSymbol = sanitizeTradingViewSegment(input.symbol);
  const pairAddress = sanitizeTradingViewSegment(resolvePairAddress(input)).replace(/^0X/, "");
  if (!baseSymbol || !pairAddress) {
    return [];
  }

  const quoteSymbols = preferredQuoteCandidates(input.quoteSymbol);
  const exchangeSymbols = preferredExchangeCandidates(input);
  const pairCodes = uniqueStrings([
    ...quoteSymbols.map((quote) => `${baseSymbol}${quote}`),
    baseSymbol,
  ]);
  const pairSuffixes = uniqueStrings([
    pairAddress.slice(0, 6),
    pairAddress.slice(0, 8),
  ]).filter((value) => value.length >= 6);

  return uniqueStrings([
    ...pairSuffixes.flatMap((pairSuffix) =>
      pairCodes.flatMap((pairCode) => [`${pairCode}_${pairSuffix}.USD`, `${pairCode}_${pairSuffix}`]),
    ),
    ...exchangeSymbols.flatMap((exchange) =>
      pairCodes.flatMap((pairCode) => [`${exchange}:${pairCode}`, `${exchange}:${pairCode}.USD`]),
    ),
    ...pairCodes.map((pairCode) => `${pairCode}.USD`),
  ]).slice(0, 18);
}

export function buildTradingViewPreviewInput(row: CorrelatedMemecoinRow): TradingViewPreviewInput {
  return {
    id: row.id,
    chainId: row.chainId,
    dexId: row.dexId ?? null,
    pairAddress: row.pairAddress,
    pairLabels: row.pairLabels ?? null,
    tokenAddress: row.tokenAddress,
    name: row.name,
    symbol: row.symbol,
    quoteSymbol: row.quoteSymbol ?? null,
    tradingviewSymbol: row.tradingviewSymbol ?? null,
    dexscreenerUrl: row.dexscreenerUrl,
    priceUsd: row.priceUsd ?? null,
    priceChange1hPct: row.priceChange1hPct ?? null,
    priceChange6hPct: row.priceChange6hPct ?? null,
    priceChange24hPct: row.priceChange24hPct ?? null,
  };
}

export function buildTradingViewPreviewSearchParams(input: TradingViewPreviewInput) {
  const params = new URLSearchParams();
  params.set("coinId", input.id);
  if (normalizeMaybeString(input.chainId)) {
    params.set("chainId", input.chainId);
  }
  if (normalizeMaybeString(input.dexId)) {
    params.set("dexId", input.dexId as string);
  }
  const pairAddress = resolvePairAddress(input);
  if (pairAddress) {
    params.set("pairAddress", pairAddress);
  }
  if (normalizeMaybeString(input.tokenAddress)) {
    params.set("tokenAddress", input.tokenAddress);
  }
  if (normalizeMaybeString(input.name)) {
    params.set("name", input.name);
  }
  if (normalizeMaybeString(input.symbol)) {
    params.set("symbol", input.symbol);
  }
  if (normalizeMaybeString(input.quoteSymbol)) {
    params.set("quoteSymbol", input.quoteSymbol as string);
  }
  if (normalizeMaybeString(input.tradingviewSymbol)) {
    params.set("tradingviewSymbol", input.tradingviewSymbol as string);
  }
  if (normalizeMaybeString(input.dexscreenerUrl)) {
    params.set("dexscreenerUrl", input.dexscreenerUrl);
  }
  ([
    ["priceUsd", normalizeNumber(input.priceUsd)],
    ["priceChange1hPct", normalizeNumber(input.priceChange1hPct)],
    ["priceChange6hPct", normalizeNumber(input.priceChange6hPct)],
    ["priceChange24hPct", normalizeNumber(input.priceChange24hPct)],
  ] as const).forEach(([key, value]) => {
    if (value !== null) {
      params.set(key, String(value));
    }
  });
  (input.pairLabels ?? []).forEach((label) => {
    const normalized = normalizeMaybeString(label);
    if (normalized) {
      params.append("pairLabel", normalized);
    }
  });

  return params;
}

function buildPreviewDebug(
  input: TradingViewPreviewInput,
  options: {
    provider: TradingViewPreviewProvider;
    displayMode: TradingViewPreviewDisplayMode;
    tradingviewSymbol: string | null;
    resolutionSource: TradingViewPreviewResolutionSource | null;
    failureReason: TradingViewPreviewFailureCode | null;
    failureDetail?: string | null;
    snapshotImageUrl?: string | null;
    dexscreenerEmbedUrl?: string | null;
    sparklinePoints?: number[] | null;
    sparklineSource?: "market_snapshot_history" | "derived_market_metrics" | null;
    baseTokenSymbol?: string | null;
    quoteTokenSymbol?: string | null;
    pairLookupSource?: "input_only" | "pair_address" | "token_address";
    pairLookupFailureCode?: TradingViewPreviewFailureCode | null;
    pairLookupFailureDetail?: string | null;
    dexId?: string | null;
    pairLabels?: string[] | null;
    pairRanking?: TradingViewPreviewPairCandidate[];
    candidateSymbolsTried?: string[];
    candidateValidation?: TradingViewPreviewCandidateValidation[];
    availablePreviewModes?: TradingViewPreviewProvider[];
    resolutionNotes?: string[];
  },
): TradingViewPreviewDebug {
  const candidateValidation = options.candidateValidation ?? [];
  const rejectionReasons = candidateValidation
    .filter((entry) => !entry.valid)
    .map((entry) => normalizeMaybeString(entry.rejectionReason))
    .filter((entry): entry is string => Boolean(entry));
  const uniqueRejectionReasons = rejectionReasons.filter((value, index, values) => {
    const normalized = value.toLowerCase();
    return values.findIndex((entry) => entry.toLowerCase() === normalized) === index;
  });

  return {
    coinId: input.id,
    chainId: normalizeMaybeString(input.chainId),
    dexId: normalizeMaybeString(options.dexId ?? input.dexId),
    pairAddress: resolvePairAddress(input),
    tokenAddress: normalizeMaybeString(input.tokenAddress),
    pairUrl: normalizeMaybeString(input.dexscreenerUrl),
    baseTokenSymbol: normalizeMaybeString(options.baseTokenSymbol ?? input.symbol),
    quoteTokenSymbol: normalizeMaybeString(options.quoteTokenSymbol ?? input.quoteSymbol),
    symbolTextShownInUi: pairLabelFromPreviewInput(input),
    symbolPassedToChartWidget: options.tradingviewSymbol,
    previewProviderSelected: options.provider,
    displayMode: options.displayMode,
    resolutionSource: options.resolutionSource,
    failureReason: options.failureReason,
    failureDetail: normalizeMaybeString(options.failureDetail),
    fallbackTriggeredBeforeMountCompleted: false,
    storedTradingviewSymbol: getExplicitTradingViewSymbol(input),
    snapshotImageUrl: normalizeImageUrl(options.snapshotImageUrl),
    dexscreenerEmbedUrl: normalizeMaybeString(options.dexscreenerEmbedUrl),
    sparklinePointCount: options.sparklinePoints?.length ?? 0,
    sparklineSource: options.sparklineSource ?? null,
    pairLookupSource: options.pairLookupSource ?? "input_only",
    pairLookupFailureCode: options.pairLookupFailureCode ?? null,
    pairLookupFailureDetail: normalizeMaybeString(options.pairLookupFailureDetail),
    pairLabels: uniqueStrings(options.pairLabels ?? input.pairLabels ?? []),
    pairRanking: options.pairRanking ?? [],
    candidateSymbolsTried: options.candidateSymbolsTried ?? [],
    candidateValidation,
    commonCandidateRejectionReason:
      uniqueRejectionReasons.length === 1 ? uniqueRejectionReasons[0] : uniqueRejectionReasons.length > 1 ? "mixed" : null,
    availablePreviewModes: options.availablePreviewModes ?? [],
    resolutionNotes: options.resolutionNotes ?? [],
  };
}

function createPreviewResponse(
  input: TradingViewPreviewInput,
  options: {
    status: TradingViewPreviewProvider;
    displayMode: TradingViewPreviewDisplayMode;
    tradingviewSymbol?: string | null;
    resolutionSource?: TradingViewPreviewResolutionSource | null;
    failureCode?: TradingViewPreviewFailureCode | null;
    failureDetail?: string | null;
    snapshotImageUrl?: string | null;
    snapshotAlt?: string | null;
    dexscreenerEmbedUrl?: string | null;
    sparklinePoints?: number[] | null;
    sparklineSource?: "market_snapshot_history" | "derived_market_metrics" | null;
    baseTokenSymbol?: string | null;
    quoteTokenSymbol?: string | null;
    pairLookupSource?: "input_only" | "pair_address" | "token_address";
    pairLookupFailureCode?: TradingViewPreviewFailureCode | null;
    pairLookupFailureDetail?: string | null;
    dexId?: string | null;
    pairLabels?: string[] | null;
    pairRanking?: TradingViewPreviewPairCandidate[];
    candidateSymbolsTried?: string[];
    candidateValidation?: TradingViewPreviewCandidateValidation[];
    availablePreviewModes?: TradingViewPreviewProvider[];
    resolutionNotes?: string[];
  },
): TradingViewPreviewResponse {
  const tradingviewSymbol = normalizeMaybeString(normalizeTradingViewSymbol(options.tradingviewSymbol));
  const snapshotImageUrl = normalizeImageUrl(options.snapshotImageUrl);
  const sparklinePoints = options.sparklinePoints?.filter((value) => Number.isFinite(value)) ?? null;

  return {
    status: options.status,
    provider: options.status,
    displayMode: options.displayMode,
    tradingviewSymbol,
    dexUrl: normalizeMaybeString(input.dexscreenerUrl) ?? "",
    dexscreenerEmbedUrl: normalizeMaybeString(options.dexscreenerEmbedUrl) ?? normalizeMaybeString(input.dexscreenerUrl),
    snapshotImageUrl,
    snapshotAlt:
      normalizeMaybeString(options.snapshotAlt) ??
      (snapshotImageUrl && pairLabelFromPreviewInput(input)
        ? `Dexscreener market snapshot for ${pairLabelFromPreviewInput(input)}`
        : null),
    sparklinePoints: sparklinePoints && sparklinePoints.length >= 2 ? sparklinePoints : null,
    sparklineSource: sparklinePoints && sparklinePoints.length >= 2 ? options.sparklineSource ?? null : null,
    failureCode: options.failureCode ?? null,
    failureDetail: normalizeMaybeString(options.failureDetail),
    resolutionSource: options.resolutionSource ?? null,
    debug: buildPreviewDebug(input, {
      provider: options.status,
      displayMode: options.displayMode,
      tradingviewSymbol,
      resolutionSource: options.resolutionSource ?? null,
      failureReason: options.failureCode ?? null,
      failureDetail: options.failureDetail ?? null,
      snapshotImageUrl,
      dexscreenerEmbedUrl: options.dexscreenerEmbedUrl ?? input.dexscreenerUrl,
      sparklinePoints: sparklinePoints ?? null,
      sparklineSource: options.sparklineSource ?? null,
      baseTokenSymbol: options.baseTokenSymbol,
      quoteTokenSymbol: options.quoteTokenSymbol,
      pairLookupSource: options.pairLookupSource,
      pairLookupFailureCode: options.pairLookupFailureCode,
      pairLookupFailureDetail: options.pairLookupFailureDetail,
      dexId: options.dexId,
      pairLabels: options.pairLabels,
      pairRanking: options.pairRanking,
      candidateSymbolsTried: options.candidateSymbolsTried,
      candidateValidation: options.candidateValidation,
      availablePreviewModes: options.availablePreviewModes,
      resolutionNotes: options.resolutionNotes,
    }),
  };
}

export function createResolvedTradingViewPreview(
  input: TradingViewPreviewInput,
  options: {
    tradingviewSymbol: string;
    resolutionSource: TradingViewPreviewResolutionSource;
    snapshotImageUrl?: string | null;
    snapshotAlt?: string | null;
    dexscreenerEmbedUrl?: string | null;
    sparklinePoints?: number[] | null;
    sparklineSource?: "market_snapshot_history" | "derived_market_metrics" | null;
    baseTokenSymbol?: string | null;
    quoteTokenSymbol?: string | null;
    pairLookupSource?: "input_only" | "pair_address" | "token_address";
    pairLookupFailureCode?: TradingViewPreviewFailureCode | null;
    pairLookupFailureDetail?: string | null;
    dexId?: string | null;
    pairLabels?: string[] | null;
    pairRanking?: TradingViewPreviewPairCandidate[];
    candidateSymbolsTried?: string[];
    candidateValidation?: TradingViewPreviewCandidateValidation[];
    availablePreviewModes?: TradingViewPreviewProvider[];
    resolutionNotes?: string[];
  },
): TradingViewPreviewResponse {
  return createPreviewResponse(input, {
    status: "tradingview",
    displayMode: "tradingview_chart",
    tradingviewSymbol: options.tradingviewSymbol,
    resolutionSource: options.resolutionSource,
    snapshotImageUrl: options.snapshotImageUrl,
    snapshotAlt: options.snapshotAlt,
    dexscreenerEmbedUrl: options.dexscreenerEmbedUrl,
    sparklinePoints: options.sparklinePoints,
    sparklineSource: options.sparklineSource,
    baseTokenSymbol: options.baseTokenSymbol,
    quoteTokenSymbol: options.quoteTokenSymbol,
    pairLookupSource: options.pairLookupSource,
    pairLookupFailureCode: options.pairLookupFailureCode,
    pairLookupFailureDetail: options.pairLookupFailureDetail,
    dexId: options.dexId,
    pairLabels: options.pairLabels,
    pairRanking: options.pairRanking,
    candidateSymbolsTried: options.candidateSymbolsTried,
    candidateValidation: options.candidateValidation,
    availablePreviewModes: options.availablePreviewModes,
    resolutionNotes: options.resolutionNotes,
  });
}

export function createDexscreenerPreview(
  input: TradingViewPreviewInput,
  options: {
    snapshotImageUrl?: string | null;
    snapshotAlt?: string | null;
    dexscreenerEmbedUrl?: string | null;
    sparklinePoints?: number[] | null;
    sparklineSource?: "market_snapshot_history" | "derived_market_metrics" | null;
    failureCode?: TradingViewPreviewFailureCode | null;
    failureDetail?: string | null;
    resolutionSource?: TradingViewPreviewResolutionSource | null;
    baseTokenSymbol?: string | null;
    quoteTokenSymbol?: string | null;
    pairLookupSource?: "input_only" | "pair_address" | "token_address";
    pairLookupFailureCode?: TradingViewPreviewFailureCode | null;
    pairLookupFailureDetail?: string | null;
    dexId?: string | null;
    pairLabels?: string[] | null;
    pairRanking?: TradingViewPreviewPairCandidate[];
    candidateSymbolsTried?: string[];
    candidateValidation?: TradingViewPreviewCandidateValidation[];
    availablePreviewModes?: TradingViewPreviewProvider[];
    resolutionNotes?: string[];
  },
): TradingViewPreviewResponse {
  const hasSnapshotImage = Boolean(normalizeImageUrl(options.snapshotImageUrl));

  return createPreviewResponse(input, {
    status: "dexscreener",
    displayMode: hasSnapshotImage ? "dexscreener_snapshot" : "dexscreener_link",
    resolutionSource: options.resolutionSource ?? (hasSnapshotImage ? "dex_pair_metadata" : null),
    snapshotImageUrl: options.snapshotImageUrl,
    snapshotAlt: options.snapshotAlt,
    dexscreenerEmbedUrl: options.dexscreenerEmbedUrl,
    sparklinePoints: options.sparklinePoints,
    sparklineSource: options.sparklineSource,
    failureCode: options.failureCode ?? null,
    failureDetail: options.failureDetail ?? null,
    baseTokenSymbol: options.baseTokenSymbol,
    quoteTokenSymbol: options.quoteTokenSymbol,
    pairLookupSource: options.pairLookupSource,
    pairLookupFailureCode: options.pairLookupFailureCode,
    pairLookupFailureDetail: options.pairLookupFailureDetail,
    dexId: options.dexId,
    pairLabels: options.pairLabels,
    pairRanking: options.pairRanking,
    candidateSymbolsTried: options.candidateSymbolsTried,
    candidateValidation: options.candidateValidation,
    availablePreviewModes: options.availablePreviewModes,
    resolutionNotes: options.resolutionNotes,
  });
}

export function createSparklinePreview(
  input: TradingViewPreviewInput,
  options: {
    sparklinePoints: number[];
    sparklineSource: "market_snapshot_history" | "derived_market_metrics";
    snapshotImageUrl?: string | null;
    snapshotAlt?: string | null;
    dexscreenerEmbedUrl?: string | null;
    failureCode?: TradingViewPreviewFailureCode | null;
    failureDetail?: string | null;
    resolutionSource?: TradingViewPreviewResolutionSource | null;
    baseTokenSymbol?: string | null;
    quoteTokenSymbol?: string | null;
    pairLookupSource?: "input_only" | "pair_address" | "token_address";
    pairLookupFailureCode?: TradingViewPreviewFailureCode | null;
    pairLookupFailureDetail?: string | null;
    dexId?: string | null;
    pairLabels?: string[] | null;
    pairRanking?: TradingViewPreviewPairCandidate[];
    candidateSymbolsTried?: string[];
    candidateValidation?: TradingViewPreviewCandidateValidation[];
    availablePreviewModes?: TradingViewPreviewProvider[];
    resolutionNotes?: string[];
  },
): TradingViewPreviewResponse {
  return createPreviewResponse(input, {
    status: "sparkline",
    displayMode: "sparkline_chart",
    resolutionSource: options.resolutionSource ?? options.sparklineSource,
    sparklinePoints: options.sparklinePoints,
    sparklineSource: options.sparklineSource,
    snapshotImageUrl: options.snapshotImageUrl,
    snapshotAlt: options.snapshotAlt,
    dexscreenerEmbedUrl: options.dexscreenerEmbedUrl,
    failureCode: options.failureCode ?? null,
    failureDetail: options.failureDetail ?? null,
    baseTokenSymbol: options.baseTokenSymbol,
    quoteTokenSymbol: options.quoteTokenSymbol,
    pairLookupSource: options.pairLookupSource,
    pairLookupFailureCode: options.pairLookupFailureCode,
    pairLookupFailureDetail: options.pairLookupFailureDetail,
    dexId: options.dexId,
    pairLabels: options.pairLabels,
    pairRanking: options.pairRanking,
    candidateSymbolsTried: options.candidateSymbolsTried,
    candidateValidation: options.candidateValidation,
    availablePreviewModes: options.availablePreviewModes,
    resolutionNotes: options.resolutionNotes,
  });
}

export function createUnavailableTradingViewPreview(
  input: TradingViewPreviewInput,
  options: {
    failureCode: TradingViewPreviewFailureCode;
    failureDetail: string;
    snapshotImageUrl?: string | null;
    snapshotAlt?: string | null;
    dexscreenerEmbedUrl?: string | null;
    sparklinePoints?: number[] | null;
    sparklineSource?: "market_snapshot_history" | "derived_market_metrics" | null;
    baseTokenSymbol?: string | null;
    quoteTokenSymbol?: string | null;
    pairLookupSource?: "input_only" | "pair_address" | "token_address";
    pairLookupFailureCode?: TradingViewPreviewFailureCode | null;
    pairLookupFailureDetail?: string | null;
    dexId?: string | null;
    pairLabels?: string[] | null;
    pairRanking?: TradingViewPreviewPairCandidate[];
    candidateSymbolsTried?: string[];
    candidateValidation?: TradingViewPreviewCandidateValidation[];
    availablePreviewModes?: TradingViewPreviewProvider[];
    resolutionNotes?: string[];
  },
): TradingViewPreviewResponse {
  return createPreviewResponse(input, {
    status: "unavailable",
    displayMode: "unavailable",
    failureCode: options.failureCode,
    failureDetail: options.failureDetail,
    snapshotImageUrl: options.snapshotImageUrl,
    snapshotAlt: options.snapshotAlt,
    dexscreenerEmbedUrl: options.dexscreenerEmbedUrl,
    sparklinePoints: options.sparklinePoints,
    sparklineSource: options.sparklineSource,
    baseTokenSymbol: options.baseTokenSymbol,
    quoteTokenSymbol: options.quoteTokenSymbol,
    pairLookupSource: options.pairLookupSource,
    pairLookupFailureCode: options.pairLookupFailureCode,
    pairLookupFailureDetail: options.pairLookupFailureDetail,
    dexId: options.dexId,
    pairLabels: options.pairLabels,
    pairRanking: options.pairRanking,
    candidateSymbolsTried: options.candidateSymbolsTried,
    candidateValidation: options.candidateValidation,
    availablePreviewModes: options.availablePreviewModes,
    resolutionNotes: options.resolutionNotes,
  });
}

export function createFallbackTradingViewPreview(
  input: TradingViewPreviewInput,
  options: {
    failureCode: TradingViewPreviewFailureCode;
    failureDetail: string;
    snapshotImageUrl?: string | null;
    snapshotAlt?: string | null;
    dexscreenerEmbedUrl?: string | null;
    sparklinePoints?: number[] | null;
    sparklineSource?: "market_snapshot_history" | "derived_market_metrics" | null;
    baseTokenSymbol?: string | null;
    quoteTokenSymbol?: string | null;
    pairLookupSource?: "input_only" | "pair_address" | "token_address";
    pairLookupFailureCode?: TradingViewPreviewFailureCode | null;
    pairLookupFailureDetail?: string | null;
    dexId?: string | null;
    pairLabels?: string[] | null;
    pairRanking?: TradingViewPreviewPairCandidate[];
    candidateSymbolsTried?: string[];
    candidateValidation?: TradingViewPreviewCandidateValidation[];
    availablePreviewModes?: TradingViewPreviewProvider[];
    resolutionNotes?: string[];
  },
): TradingViewPreviewResponse {
  if (normalizeImageUrl(options.snapshotImageUrl) || normalizeMaybeString(input.dexscreenerUrl)) {
    return createDexscreenerPreview(input, options);
  }

  if ((options.sparklinePoints?.length ?? 0) >= 2 && options.sparklineSource) {
    return createSparklinePreview(input, {
      sparklinePoints: options.sparklinePoints as number[],
      sparklineSource: options.sparklineSource,
      snapshotImageUrl: options.snapshotImageUrl,
      snapshotAlt: options.snapshotAlt,
      dexscreenerEmbedUrl: options.dexscreenerEmbedUrl,
      failureCode: options.failureCode,
      failureDetail: options.failureDetail,
      baseTokenSymbol: options.baseTokenSymbol,
      quoteTokenSymbol: options.quoteTokenSymbol,
      pairLookupSource: options.pairLookupSource,
      pairLookupFailureCode: options.pairLookupFailureCode,
      pairLookupFailureDetail: options.pairLookupFailureDetail,
      dexId: options.dexId,
      pairLabels: options.pairLabels,
      pairRanking: options.pairRanking,
      candidateSymbolsTried: options.candidateSymbolsTried,
      candidateValidation: options.candidateValidation,
      availablePreviewModes: options.availablePreviewModes,
      resolutionNotes: options.resolutionNotes,
    });
  }

  return createUnavailableTradingViewPreview(input, options);
}

export function resolveTradingViewPreview(
  input: TradingViewPreviewInput,
): TradingViewPreviewResponse {
  const explicitSymbol = getExplicitTradingViewSymbol(input);
  if (explicitSymbol) {
    return createResolvedTradingViewPreview(input, {
      tradingviewSymbol: explicitSymbol,
      resolutionSource: "stored_symbol",
      availablePreviewModes: ["tradingview"],
    });
  }

  const curatedSymbol = getCuratedTradingViewSymbol(input);
  if (curatedSymbol) {
    return createResolvedTradingViewPreview(input, {
      tradingviewSymbol: curatedSymbol,
      resolutionSource: "curated_ticker",
      availablePreviewModes: ["tradingview"],
    });
  }

  return createUnavailableTradingViewPreview(input, {
    failureCode: "tradingview_symbol_unavailable",
    failureDetail: `TradingView mapping is unavailable for ${pairLabelFromPreviewInput(input) ?? input.id}.`,
    availablePreviewModes: ["unavailable"],
  });
}
