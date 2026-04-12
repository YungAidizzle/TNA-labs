import { clamp } from "@/lib/formatters";
import { getTrendDisplayNameOrPlaceholder } from "@/lib/dashboard/trend-name-state";
import {
  CorrelatedMemecoinLink,
  CorrelatedMemecoinRow,
  NarrativeLinkedCoin,
  RankedTrend,
} from "@/types/view-models";

export type MemecoinConfidenceTier = "high" | "medium" | "speculative" | "coverage";
export type MemecoinRiskTag = "NEW" | "THIN" | "SPECULATIVE" | "STALE" | "STRONG";

export type NarrativeCoinOpportunity = {
  row: CorrelatedMemecoinRow;
  activeLink: CorrelatedMemecoinLink | null;
  confidenceScore: number;
  confidenceTier: MemecoinConfidenceTier;
  riskTag: MemecoinRiskTag;
  keywordOverlap: string[];
  explanation: string;
};

const BASIC_LIQUIDITY_USD = 60_000;
const BASIC_VOLUME_USD = 150_000;
const THIN_LIQUIDITY_USD = 100_000;
const THIN_VOLUME_USD = 250_000;
const STRONG_LIQUIDITY_USD = 200_000;
const STRONG_VOLUME_USD = 900_000;
const NEW_PAIR_HOURS = 24;
const STALE_PAIR_HOURS = 24 * 7;
const STOP_TOKENS = new Set([
  "the",
  "and",
  "coin",
  "coins",
  "meme",
  "memecoin",
  "cto",
  "token",
  "community",
  "takeover",
  "solana",
  "base",
  "ethereum",
  "bsc",
]);

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function tokenize(value: string | null | undefined) {
  return normalizeText(value)
    .replace(/[^a-z0-9$#\s_-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[$#]+/, ""))
    .filter((token) => token.length >= 2 && !STOP_TOKENS.has(token));
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

export function getNarrativeTopicKey(narrative: RankedTrend) {
  const topicKey =
    typeof narrative.canonicalKeySummary === "string" ? narrative.canonicalKeySummary.trim() : "";
  return topicKey || narrative.id;
}

export function getMemecoinLinks(row: CorrelatedMemecoinRow) {
  return row.links?.filter(Boolean) ?? [];
}

export function getNarrativeLinkForCoin(
  row: CorrelatedMemecoinRow,
  narrativeId: string | null | undefined,
) {
  const links = getMemecoinLinks(row);
  if (!narrativeId) {
    return links[0] ?? null;
  }

  return links.find((link) => link.topicKey === narrativeId) ?? null;
}

export function getNarrativeLinkedCoinCount(
  rows: CorrelatedMemecoinRow[],
  narrativeId: string | null | undefined,
) {
  if (!narrativeId) {
    return 0;
  }

  return rows.filter((row) => Boolean(getNarrativeLinkForCoin(row, narrativeId))).length;
}

function toStoredNarrativeLink(
  narrative: RankedTrend,
  linkedCoin: NarrativeLinkedCoin,
): CorrelatedMemecoinLink {
  const topicKey = getNarrativeTopicKey(narrative);
  return {
    topicKey,
    topicLabel: getTrendDisplayNameOrPlaceholder(narrative),
    trendCategory: narrative.trendCategory ?? null,
    narrativeSummary:
      narrative.trendNarrativeSummary ??
      narrative.trendDescription ??
      narrative.trendContextParagraph ??
      null,
    lexicalScore: 0,
    mentionScore: 0,
    timingScore: 0,
    cultureFitScore: 0,
    linkScore: linkedCoin.confidence,
    supportPostCount: Math.max(0, Math.round(linkedCoin.mentionCount ?? 0)),
    supportInteractionScore: linkedCoin.engagementScore ?? 0,
    isPrimary: true,
    whyLinked: linkedCoin.whyLinked ?? null,
    matchReasons: linkedCoin.matchReasons ?? null,
    rawMatchSignals: linkedCoin.rawMatchSignals ?? null,
  };
}

function toStoredNarrativeRow(
  narrative: RankedTrend,
  linkedCoin: NarrativeLinkedCoin,
): CorrelatedMemecoinRow {
  const topicKey = getNarrativeTopicKey(narrative);
  const activeLink = toStoredNarrativeLink(narrative, linkedCoin);
  return {
    id: linkedCoin.id,
    rank: 0,
    chainId: linkedCoin.chainId ?? "unknown",
    chainLabel: linkedCoin.chainId ?? "Unknown",
    tokenAddress: linkedCoin.address,
    pairAddress: linkedCoin.pairAddress ?? "",
    name: linkedCoin.name,
    symbol: linkedCoin.symbol,
    quoteSymbol: linkedCoin.quoteSymbol ?? null,
    quoteTokenName: null,
    strongestTrendKey: topicKey,
    strongestTrendLabel: getTrendDisplayNameOrPlaceholder(narrative),
    strongestTrendCategory: narrative.trendCategory ?? null,
    strongestTrendSummary:
      narrative.trendNarrativeSummary ??
      narrative.trendDescription ??
      narrative.trendContextParagraph ??
      null,
    correlationScore: linkedCoin.confidence,
    correlationLabel: "Stored",
    marketScore: linkedCoin.marketScore ?? null,
    liquidityUsd: linkedCoin.liquidity ?? null,
    volume24hUsd: linkedCoin.volume ?? null,
    volume6hUsd: null,
    volume1hUsd: null,
    priceUsd: linkedCoin.priceUsd ?? null,
    priceChange5mPct: null,
    priceChange1hPct: linkedCoin.priceChange1hPct ?? null,
    priceChange6hPct: linkedCoin.priceChange6hPct ?? null,
    priceChange24hPct: linkedCoin.priceChange24hPct ?? null,
    pairAgeHours: linkedCoin.age ?? null,
    buys24h: null,
    sells24h: null,
    txns24h: null,
    txns6h: null,
    txns1h: null,
    fdvUsd: linkedCoin.fdv ?? null,
    marketCapUsd: linkedCoin.marketCap ?? null,
    iconUrl: linkedCoin.iconUrl ?? null,
    headerUrl: null,
    description: null,
    websites: linkedCoin.websites ?? null,
    socials: linkedCoin.socials ?? null,
    tradingviewSymbol: linkedCoin.tradingviewSymbol ?? null,
    memecoinFitScore: linkedCoin.memecoinFitScore ?? null,
    seedTerms: narrative.trendKeyEntities ?? [],
    discoverySources: ["trend_memecoin_links"],
    matchedTrendKeys: [topicKey],
    communityTakeover: null,
    confidenceBand: linkedCoin.confidenceBand ?? null,
    whyLinked: linkedCoin.whyLinked ?? null,
    matchReasons: linkedCoin.matchReasons ?? null,
    rawMatchSignals: linkedCoin.rawMatchSignals ?? null,
    links: [activeLink],
    dexscreenerUrl: linkedCoin.dexscreenerUrl ?? "",
    updatedAt: linkedCoin.lastUpdatedAt,
  };
}

function dedupeStrings(values: Array<string | null | undefined>) {
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

function dedupeLinks(links: CorrelatedMemecoinLink[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.topicKey.toLowerCase()}:${link.topicLabel.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function dedupeExternalLinks(links: CorrelatedMemecoinRow["websites"] | CorrelatedMemecoinRow["socials"]) {
  const seen = new Set<string>();
  return (links ?? []).filter((link) => {
    const url = String(link?.url ?? "").trim();
    if (!url) {
      return false;
    }

    const key = url.toLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizeAddress(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeUrl(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function linearScore(value: number | null | undefined, min: number, max: number) {
  if (!isFiniteNumber(value) || max <= min) {
    return 0;
  }

  return clamp01((value - min) / (max - min));
}

function logScore(value: number | null | undefined, min: number, max: number) {
  if (!isFiniteNumber(value) || value <= 0 || min <= 0 || max <= min) {
    return 0;
  }

  const normalized = (Math.log10(value) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
  return clamp01(normalized);
}

function averageScore(values: number[], fallback = 0) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) {
    return fallback;
  }

  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function compareIsoTimestamps(left: string | null | undefined, right: string | null | undefined) {
  const leftTimestamp = Date.parse(left ?? "");
  const rightTimestamp = Date.parse(right ?? "");

  if (!Number.isFinite(leftTimestamp) && !Number.isFinite(rightTimestamp)) {
    return 0;
  }

  if (!Number.isFinite(leftTimestamp)) {
    return -1;
  }

  if (!Number.isFinite(rightTimestamp)) {
    return 1;
  }

  return leftTimestamp - rightTimestamp;
}

function latestTimestamp(left: string | null | undefined, right: string | null | undefined) {
  return compareIsoTimestamps(left, right) >= 0 ? (left ?? null) : (right ?? null);
}

function rowDataCompletenessScore(row: CorrelatedMemecoinRow) {
  return [
    row.priceUsd,
    row.liquidityUsd,
    row.volume24hUsd,
    row.volume6hUsd,
    row.volume1hUsd,
    row.txns24h,
    row.txns6h,
    row.txns1h,
    row.marketCapUsd,
    row.fdvUsd,
    row.pairAgeHours,
    row.marketScore,
    row.memecoinFitScore,
  ].reduce<number>((score, value) => score + (isFiniteNumber(value) ? 1 : 0), row.dexscreenerUrl ? 1 : 0);
}

function rowNarrativeStrengthScore(row: CorrelatedMemecoinRow) {
  const link = getPrimaryNarrativeLink(row);
  return (
    (isFiniteNumber(row.correlationScore) ? row.correlationScore : 0) +
    (link?.linkScore ?? 0) +
    (link?.supportPostCount ?? 0) * 3 +
    ((row.matchedTrendKeys?.length ?? 0) * 2)
  );
}

function normalizeCorrelatedMemecoinRow(row: CorrelatedMemecoinRow): CorrelatedMemecoinRow {
  return {
    ...row,
    seedTerms: dedupeStrings(row.seedTerms ?? []),
    discoverySources: dedupeStrings(row.discoverySources ?? []),
    matchedTrendKeys: dedupeStrings(row.matchedTrendKeys ?? []),
    matchReasons: dedupeStrings(row.matchReasons ?? []),
    websites: dedupeExternalLinks(row.websites ?? []),
    socials: dedupeExternalLinks(row.socials ?? []),
    links: dedupeLinks(getMemecoinLinks(row)),
  };
}

function mergeSurfacedMemecoinRows(
  existing: CorrelatedMemecoinRow,
  incoming: CorrelatedMemecoinRow,
): CorrelatedMemecoinRow {
  const dataPreferred: CorrelatedMemecoinRow =
    rowDataCompletenessScore(incoming) > rowDataCompletenessScore(existing) ? incoming : existing;
  const narrativePreferred: CorrelatedMemecoinRow =
    rowNarrativeStrengthScore(incoming) > rowNarrativeStrengthScore(existing) ? incoming : existing;
  const newest: CorrelatedMemecoinRow =
    compareIsoTimestamps(incoming.updatedAt, existing.updatedAt) >= 0 ? incoming : existing;

  return {
    ...dataPreferred,
    id: dataPreferred.id || narrativePreferred.id,
    rank: Math.min(existing.rank, incoming.rank),
    chainId: dataPreferred.chainId || narrativePreferred.chainId,
    chainLabel: dataPreferred.chainLabel || narrativePreferred.chainLabel,
    tokenAddress: dataPreferred.tokenAddress || narrativePreferred.tokenAddress,
    pairAddress: dataPreferred.pairAddress || narrativePreferred.pairAddress,
    name: dataPreferred.name || narrativePreferred.name,
    symbol: dataPreferred.symbol || narrativePreferred.symbol,
    quoteSymbol: dataPreferred.quoteSymbol ?? narrativePreferred.quoteSymbol ?? null,
    quoteTokenName: dataPreferred.quoteTokenName ?? narrativePreferred.quoteTokenName ?? null,
    strongestTrendKey: narrativePreferred.strongestTrendKey || dataPreferred.strongestTrendKey,
    strongestTrendLabel: narrativePreferred.strongestTrendLabel || dataPreferred.strongestTrendLabel,
    strongestTrendCategory:
      narrativePreferred.strongestTrendCategory ?? dataPreferred.strongestTrendCategory ?? null,
    strongestTrendSummary:
      narrativePreferred.strongestTrendSummary ?? dataPreferred.strongestTrendSummary ?? null,
    correlationScore: Math.max(existing.correlationScore, incoming.correlationScore),
    correlationLabel:
      incoming.correlationScore >= existing.correlationScore
        ? incoming.correlationLabel
        : existing.correlationLabel,
    marketScore: dataPreferred.marketScore ?? narrativePreferred.marketScore ?? null,
    liquidityUsd: dataPreferred.liquidityUsd ?? narrativePreferred.liquidityUsd ?? null,
    volume24hUsd: dataPreferred.volume24hUsd ?? narrativePreferred.volume24hUsd ?? null,
    volume6hUsd: dataPreferred.volume6hUsd ?? narrativePreferred.volume6hUsd ?? null,
    volume1hUsd: dataPreferred.volume1hUsd ?? narrativePreferred.volume1hUsd ?? null,
    priceUsd: dataPreferred.priceUsd ?? narrativePreferred.priceUsd ?? null,
    priceChange5mPct: dataPreferred.priceChange5mPct ?? narrativePreferred.priceChange5mPct ?? null,
    priceChange1hPct: dataPreferred.priceChange1hPct ?? narrativePreferred.priceChange1hPct ?? null,
    priceChange6hPct: dataPreferred.priceChange6hPct ?? narrativePreferred.priceChange6hPct ?? null,
    priceChange24hPct: dataPreferred.priceChange24hPct ?? narrativePreferred.priceChange24hPct ?? null,
    pairAgeHours: dataPreferred.pairAgeHours ?? narrativePreferred.pairAgeHours ?? null,
    buys24h: dataPreferred.buys24h ?? narrativePreferred.buys24h ?? null,
    sells24h: dataPreferred.sells24h ?? narrativePreferred.sells24h ?? null,
    txns24h: dataPreferred.txns24h ?? narrativePreferred.txns24h ?? null,
    txns6h: dataPreferred.txns6h ?? narrativePreferred.txns6h ?? null,
    txns1h: dataPreferred.txns1h ?? narrativePreferred.txns1h ?? null,
    fdvUsd: dataPreferred.fdvUsd ?? narrativePreferred.fdvUsd ?? null,
    marketCapUsd: dataPreferred.marketCapUsd ?? narrativePreferred.marketCapUsd ?? null,
    iconUrl: dataPreferred.iconUrl ?? narrativePreferred.iconUrl ?? null,
    headerUrl: dataPreferred.headerUrl ?? narrativePreferred.headerUrl ?? null,
    description: dataPreferred.description ?? narrativePreferred.description ?? null,
    websites: dedupeExternalLinks([...(existing.websites ?? []), ...(incoming.websites ?? [])]),
    socials: dedupeExternalLinks([...(existing.socials ?? []), ...(incoming.socials ?? [])]),
    tradingviewSymbol: dataPreferred.tradingviewSymbol ?? narrativePreferred.tradingviewSymbol ?? null,
    memecoinFitScore: dataPreferred.memecoinFitScore ?? narrativePreferred.memecoinFitScore ?? null,
    seedTerms: dedupeStrings([...(existing.seedTerms ?? []), ...(incoming.seedTerms ?? [])]),
    discoverySources: dedupeStrings([
      ...(existing.discoverySources ?? []),
      ...(incoming.discoverySources ?? []),
    ]),
    matchedTrendKeys: dedupeStrings([
      ...(existing.matchedTrendKeys ?? []),
      ...(incoming.matchedTrendKeys ?? []),
    ]),
    communityTakeover: dataPreferred.communityTakeover ?? narrativePreferred.communityTakeover ?? null,
    confidenceBand: narrativePreferred.confidenceBand ?? dataPreferred.confidenceBand ?? null,
    whyLinked: narrativePreferred.whyLinked ?? dataPreferred.whyLinked ?? null,
    matchReasons: dedupeStrings([...(existing.matchReasons ?? []), ...(incoming.matchReasons ?? [])]),
    rawMatchSignals: narrativePreferred.rawMatchSignals ?? dataPreferred.rawMatchSignals ?? null,
    links: dedupeLinks([...(existing.links ?? []), ...(incoming.links ?? [])]),
    dexscreenerUrl: dataPreferred.dexscreenerUrl || narrativePreferred.dexscreenerUrl,
    updatedAt: latestTimestamp(existing.updatedAt, newest.updatedAt),
  };
}

function matchesChain(row: CorrelatedMemecoinRow, chainId: string | null | undefined) {
  const normalizedChain = normalizeText(chainId);
  if (!normalizedChain) {
    return true;
  }

  return normalizeText(row.chainId) === normalizedChain;
}

function findMatchingMarketRow(linkedCoin: NarrativeLinkedCoin, rows: CorrelatedMemecoinRow[]) {
  const tokenAddress = normalizeAddress(linkedCoin.address);
  const pairAddress = normalizeAddress(linkedCoin.pairAddress);
  const dexscreenerUrl = normalizeUrl(linkedCoin.dexscreenerUrl);
  const symbol = normalizeText(linkedCoin.symbol);

  return (
    rows.find((row) => matchesChain(row, linkedCoin.chainId) && tokenAddress && normalizeAddress(row.tokenAddress) === tokenAddress) ??
    rows.find((row) => matchesChain(row, linkedCoin.chainId) && pairAddress && normalizeAddress(row.pairAddress) === pairAddress) ??
    rows.find((row) => dexscreenerUrl && normalizeUrl(row.dexscreenerUrl) === dexscreenerUrl) ??
    rows.find((row) => matchesChain(row, linkedCoin.chainId) && symbol && normalizeText(row.symbol) === symbol) ??
    null
  );
}

function mergeNarrativeRowWithMarketRow(
  narrativeRow: CorrelatedMemecoinRow,
  marketRow: CorrelatedMemecoinRow | null,
) {
  if (!marketRow) {
    return narrativeRow;
  }

  return {
    ...marketRow,
    id: marketRow.id,
    strongestTrendKey: narrativeRow.strongestTrendKey,
    strongestTrendLabel: narrativeRow.strongestTrendLabel,
    strongestTrendCategory: narrativeRow.strongestTrendCategory,
    strongestTrendSummary: narrativeRow.strongestTrendSummary,
    correlationScore: narrativeRow.correlationScore,
    correlationLabel: narrativeRow.correlationLabel,
    marketScore: marketRow.marketScore ?? narrativeRow.marketScore,
    memecoinFitScore: marketRow.memecoinFitScore ?? narrativeRow.memecoinFitScore,
    seedTerms:
      (marketRow.seedTerms?.length ?? 0) > 0
        ? marketRow.seedTerms
        : narrativeRow.seedTerms,
    discoverySources:
      (marketRow.discoverySources?.length ?? 0) > 0
        ? marketRow.discoverySources
        : narrativeRow.discoverySources,
    matchedTrendKeys: dedupeStrings([
      ...(narrativeRow.matchedTrendKeys ?? []),
      ...(marketRow.matchedTrendKeys ?? []),
    ]),
    communityTakeover: marketRow.communityTakeover ?? narrativeRow.communityTakeover,
    links: dedupeLinks([
      ...(narrativeRow.links ?? []),
      ...(marketRow.links ?? []),
    ]),
    updatedAt: marketRow.updatedAt ?? narrativeRow.updatedAt,
    dexscreenerUrl: marketRow.dexscreenerUrl || narrativeRow.dexscreenerUrl,
    tradingviewSymbol: marketRow.tradingviewSymbol ?? narrativeRow.tradingviewSymbol,
  } satisfies CorrelatedMemecoinRow;
}

function opportunityIdentityKey(row: CorrelatedMemecoinRow) {
  const chainId = normalizeText(row.chainId);
  const tokenAddress = normalizeAddress(row.tokenAddress);
  const pairAddress = normalizeAddress(row.pairAddress);
  const dexUrl = normalizeUrl(row.dexscreenerUrl);

  if (chainId && tokenAddress) {
    return `${chainId}:${tokenAddress}`;
  }

  if (pairAddress) {
    return `pair:${pairAddress}`;
  }

  if (dexUrl) {
    return `dex:${dexUrl}`;
  }

  return `${chainId}:${normalizeText(row.symbol)}:${normalizeText(row.name)}`;
}

export function getPrimaryNarrativeLink(row: CorrelatedMemecoinRow) {
  const links = getMemecoinLinks(row);

  return (
    links.sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }

      if (right.linkScore !== left.linkScore) {
        return right.linkScore - left.linkScore;
      }

      if (right.supportPostCount !== left.supportPostCount) {
        return right.supportPostCount - left.supportPostCount;
      }

      return right.supportInteractionScore - left.supportInteractionScore;
    })[0] ?? null
  );
}

export function buildSurfacedMemecoinUniverse(
  narratives: RankedTrend[],
  rows: CorrelatedMemecoinRow[],
) {
  const normalizedMarketRows = rows.map((row) => normalizeCorrelatedMemecoinRow(row));
  const universeByKey = new Map<string, CorrelatedMemecoinRow>();

  normalizedMarketRows.forEach((row) => {
    const key = opportunityIdentityKey(row);
    universeByKey.set(key, universeByKey.has(key) ? mergeSurfacedMemecoinRows(universeByKey.get(key)!, row) : row);
  });

  narratives.forEach((narrative) => {
    (narrative.linkedCoins ?? []).forEach((linkedCoin) => {
      const narrativeRow = normalizeCorrelatedMemecoinRow(
        mergeNarrativeRowWithMarketRow(
          toStoredNarrativeRow(narrative, linkedCoin),
          findMatchingMarketRow(linkedCoin, normalizedMarketRows),
        ),
      );
      const key = opportunityIdentityKey(narrativeRow);
      universeByKey.set(
        key,
        universeByKey.has(key)
          ? mergeSurfacedMemecoinRows(universeByKey.get(key)!, narrativeRow)
          : narrativeRow,
      );
    });
  });

  return [...universeByKey.values()];
}

function narrativeCoverageScore(row: CorrelatedMemecoinRow) {
  const primaryLink = getPrimaryNarrativeLink(row);
  const linkStrength = linearScore(primaryLink?.linkScore ?? row.correlationScore, 16, 38);
  const supportScore = logScore(primaryLink?.supportPostCount ?? 0, 1, 6);
  const semanticScore = averageScore(
    [
      linearScore(primaryLink?.lexicalScore ?? null, 3, 16),
      linearScore(primaryLink?.mentionScore ?? null, 2, 8),
      linearScore(primaryLink?.timingScore ?? null, 2, 9),
      linearScore(primaryLink?.cultureFitScore ?? null, 2, 9),
    ],
    0,
  );
  const breadthScore = linearScore(
    Math.max(row.matchedTrendKeys?.length ?? 0, getMemecoinLinks(row).length),
    1,
    4,
  );
  const fitScore = linearScore(row.memecoinFitScore, 50, 85);

  return 100 * (0.38 * linkStrength + 0.22 * supportScore + 0.2 * semanticScore + 0.1 * breadthScore + 0.1 * fitScore);
}

function fdvSanityScore(row: CorrelatedMemecoinRow) {
  if (!isFiniteNumber(row.fdvUsd) || row.fdvUsd <= 0 || !isFiniteNumber(row.marketCapUsd) || row.marketCapUsd <= 0) {
    return 0.55;
  }

  const ratio = row.marketCapUsd / row.fdvUsd;
  if (ratio >= 0.55 && ratio <= 1.1) {
    return 1;
  }
  if (ratio >= 0.35 && ratio < 0.55) {
    return 0.78;
  }
  if (ratio >= 0.2 && ratio < 0.35) {
    return 0.48;
  }
  if (ratio > 1.1 && ratio <= 1.35) {
    return 0.72;
  }

  return 0.22;
}

function ageQualityScore(pairAgeHours: number | null | undefined) {
  if (!isFiniteNumber(pairAgeHours) || pairAgeHours < 0) {
    return 0.45;
  }
  if (pairAgeHours < 2) {
    return 0.08;
  }
  if (pairAgeHours < 6) {
    return 0.2;
  }
  if (pairAgeHours < 24) {
    return 0.52;
  }
  if (pairAgeHours < 72) {
    return 0.82;
  }
  if (pairAgeHours < 24 * 14) {
    return 1;
  }
  if (pairAgeHours < 24 * 45) {
    return 0.72;
  }

  return 0.42;
}

function marketQualityScore(row: CorrelatedMemecoinRow) {
  const liquidityScore = logScore(row.liquidityUsd, 50_000, 1_800_000);
  const volumeScore = logScore(row.volume24hUsd, 100_000, 8_000_000);
  const txnScore = logScore(row.txns24h, 180, 12_000);
  const marketScore = linearScore(row.marketScore, 48, 86);
  const sanityScore = fdvSanityScore(row);
  const ageScore = ageQualityScore(row.pairAgeHours);

  return 100 * (
    0.24 * liquidityScore +
    0.24 * volumeScore +
    0.16 * txnScore +
    0.16 * marketScore +
    0.1 * sanityScore +
    0.1 * ageScore
  );
}

function priceMomentumComponent(value: number | null | undefined, ceiling: number) {
  if (!isFiniteNumber(value)) {
    return 0.5;
  }

  return clamp01((value + ceiling) / (ceiling * 2));
}

function accelerationRatioScore(current: number | null | undefined, baseline: number | null | undefined, highRatio: number) {
  if (!isFiniteNumber(current) || !isFiniteNumber(baseline) || baseline <= 0) {
    return 0.45;
  }

  return linearScore(current / baseline, 0.8, highRatio);
}

function activityAccelerationScore(row: CorrelatedMemecoinRow) {
  const scores: number[] = [];

  if (isFiniteNumber(row.volume1hUsd) && isFiniteNumber(row.volume24hUsd) && row.volume24hUsd > 0) {
    scores.push(accelerationRatioScore(row.volume1hUsd, row.volume24hUsd / 24, 4));
  }
  if (isFiniteNumber(row.volume6hUsd) && isFiniteNumber(row.volume24hUsd) && row.volume24hUsd > 0) {
    scores.push(accelerationRatioScore(row.volume6hUsd, row.volume24hUsd / 4, 2.5));
  }
  if (isFiniteNumber(row.txns1h) && isFiniteNumber(row.txns24h) && row.txns24h > 0) {
    scores.push(accelerationRatioScore(row.txns1h, row.txns24h / 24, 4));
  }
  if (isFiniteNumber(row.txns6h) && isFiniteNumber(row.txns24h) && row.txns24h > 0) {
    scores.push(accelerationRatioScore(row.txns6h, row.txns24h / 4, 2.5));
  }

  if (scores.length > 0) {
    return averageScore(scores, 0.45);
  }

  if (isFiniteNumber(row.volume24hUsd) && isFiniteNumber(row.liquidityUsd) && row.liquidityUsd > 0) {
    return linearScore(row.volume24hUsd / row.liquidityUsd, 0.8, 6);
  }

  return 0.45;
}

function buyPressureScore(row: CorrelatedMemecoinRow) {
  if (!isFiniteNumber(row.buys24h) && !isFiniteNumber(row.sells24h)) {
    return row.communityTakeover ? 0.58 : 0.5;
  }

  const buys = Math.max(0, row.buys24h ?? 0);
  const sells = Math.max(0, row.sells24h ?? 0);
  const total = buys + sells;
  if (total <= 0) {
    return 0.35;
  }

  return clamp01((buys / total - 0.42) / 0.28);
}

function momentumScore(row: CorrelatedMemecoinRow) {
  const priceScore = averageScore(
    [
      priceMomentumComponent(row.priceChange1hPct, 18),
      priceMomentumComponent(row.priceChange6hPct, 35),
      priceMomentumComponent(row.priceChange24hPct, 65),
    ],
    0.5,
  );
  const accelerationScore = activityAccelerationScore(row);
  const orderFlowScore = buyPressureScore(row);

  return 100 * (0.46 * priceScore + 0.34 * accelerationScore + 0.2 * orderFlowScore);
}

function chainQualityScore(chainId: string | null | undefined) {
  const normalized = normalizeText(chainId);
  if (normalized === "solana") {
    return 1;
  }
  if (normalized === "ethereum") {
    return 0.92;
  }
  if (normalized === "base") {
    return 0.86;
  }
  if (normalized === "bsc") {
    return 0.74;
  }

  return 0.68;
}

function tradabilityScore(row: CorrelatedMemecoinRow) {
  const websiteScore = (row.websites?.length ?? 0) > 0 ? 1 : 0;
  const socialScore = (row.socials?.length ?? 0) > 0 ? 1 : 0;
  const dexScore = row.dexscreenerUrl ? 1 : 0;
  const quoteScore = row.quoteSymbol ? 1 : 0.62;
  const tradingViewScore = row.tradingviewSymbol ? 1 : 0.55;
  const chainScore = chainQualityScore(row.chainId);

  return 100 * (
    0.22 * dexScore +
    0.2 * websiteScore +
    0.18 * socialScore +
    0.14 * tradingViewScore +
    0.14 * quoteScore +
    0.12 * chainScore
  );
}

function deadOrThinPenalty(row: CorrelatedMemecoinRow) {
  let penalty = 0;

  if (!isFiniteNumber(row.liquidityUsd) || row.liquidityUsd <= 0) {
    penalty += 12;
  } else if (row.liquidityUsd < 30_000) {
    penalty += 18;
  } else if (row.liquidityUsd < BASIC_LIQUIDITY_USD) {
    penalty += 10;
  }

  if (!isFiniteNumber(row.volume24hUsd) || row.volume24hUsd <= 0) {
    penalty += 12;
  } else if (row.volume24hUsd < 70_000) {
    penalty += 16;
  } else if (row.volume24hUsd < BASIC_VOLUME_USD) {
    penalty += 8;
  }

  if (isFiniteNumber(row.txns24h) && row.txns24h < 120) {
    penalty += 6;
  }

  if (isFiniteNumber(row.pairAgeHours) && row.pairAgeHours < 2) {
    penalty += 8;
  }

  if (
    isFiniteNumber(row.priceChange1hPct) &&
    isFiniteNumber(row.priceChange24hPct) &&
    row.priceChange1hPct <= -14 &&
    row.priceChange24hPct <= -28
  ) {
    penalty += 8;
  }

  if ((row.websites?.length ?? 0) === 0 && (row.socials?.length ?? 0) === 0) {
    penalty += 4;
  }

  if (fdvSanityScore(row) < 0.3) {
    penalty += 8;
  }

  return penalty;
}

export function getMemecoinOpportunityScore(row: CorrelatedMemecoinRow) {
  const narrativeScore = narrativeCoverageScore(row);
  const marketScore = marketQualityScore(row);
  const momentumOpportunityScore = momentumScore(row);
  const tradabilityOpportunityScore = tradabilityScore(row);
  const survivabilityBonus =
    (row.communityTakeover ? 2 : 0) +
    (isFiniteNumber(row.marketScore) && row.marketScore >= 78 ? 2 : 0) +
    (isFiniteNumber(row.memecoinFitScore) && row.memecoinFitScore >= 72 ? 2 : 0);

  const weightedScore =
    narrativeScore * 0.3 +
    marketScore * 0.3 +
    momentumOpportunityScore * 0.25 +
    tradabilityOpportunityScore * 0.15 +
    survivabilityBonus;

  return Math.round(clamp(weightedScore - deadOrThinPenalty(row), 0, 100));
}

function confidencePenaltyFromLiquidity(liquidityUsd: number | null | undefined) {
  if (typeof liquidityUsd !== "number" || !Number.isFinite(liquidityUsd) || liquidityUsd <= 0) {
    return 18;
  }
  if (liquidityUsd < BASIC_LIQUIDITY_USD) {
    return 20;
  }
  if (liquidityUsd < THIN_LIQUIDITY_USD) {
    return 14;
  }
  if (liquidityUsd < STRONG_LIQUIDITY_USD) {
    return 7;
  }
  return 0;
}

function confidencePenaltyFromVolume(volumeUsd: number | null | undefined) {
  if (typeof volumeUsd !== "number" || !Number.isFinite(volumeUsd) || volumeUsd <= 0) {
    return 18;
  }
  if (volumeUsd < BASIC_VOLUME_USD) {
    return 18;
  }
  if (volumeUsd < THIN_VOLUME_USD) {
    return 11;
  }
  if (volumeUsd < STRONG_VOLUME_USD) {
    return 5;
  }
  return 0;
}

function confidencePenaltyFromAge(pairAgeHours: number | null | undefined) {
  if (typeof pairAgeHours !== "number" || !Number.isFinite(pairAgeHours) || pairAgeHours < 0) {
    return 8;
  }
  if (pairAgeHours < 6) {
    return 9;
  }
  if (pairAgeHours < NEW_PAIR_HOURS) {
    return 4;
  }
  if (pairAgeHours > STALE_PAIR_HOURS) {
    return 12;
  }
  return 0;
}

export function getMemecoinConfidenceScore(
  row: CorrelatedMemecoinRow,
  narrativeId: string | null | undefined,
) {
  const activeLink = getNarrativeLinkForCoin(row, narrativeId);
  const supportPostCount = activeLink?.supportPostCount ?? 0;
  const linkScore = activeLink?.linkScore ?? row.correlationScore;
  const marketScore = row.marketScore ?? 0;
  const memecoinFitScore = row.memecoinFitScore ?? 0;
  let score = row.correlationScore;

  score -= confidencePenaltyFromLiquidity(row.liquidityUsd);
  score -= confidencePenaltyFromVolume(row.volume24hUsd);
  score -= confidencePenaltyFromAge(row.pairAgeHours);

  if (supportPostCount <= 0) {
    score -= 12;
  } else if (supportPostCount === 1) {
    score -= 7;
  } else if (supportPostCount === 2) {
    score -= 3;
  }

  if (linkScore < 18) {
    score -= 9;
  } else if (linkScore < 26) {
    score -= 4;
  }

  if (marketScore < 55) {
    score -= 10;
  } else if (marketScore < 65) {
    score -= 4;
  } else if (marketScore >= 78) {
    score += 2;
  }

  if (memecoinFitScore >= 70) {
    score += 2;
  }

  if (activeLink?.isPrimary) {
    score += 2;
  }

  if (narrativeId && row.matchedTrendKeys?.includes(narrativeId)) {
    score += 3;
  }

  if (
    typeof row.liquidityUsd === "number" &&
    row.liquidityUsd >= STRONG_LIQUIDITY_USD &&
    typeof row.volume24hUsd === "number" &&
    row.volume24hUsd >= STRONG_VOLUME_USD &&
    supportPostCount >= 2
  ) {
    score += 4;
  }

  return Math.round(clamp(score, 0, 100));
}

export function getMemecoinConfidenceTier(score: number): MemecoinConfidenceTier {
  if (score >= 80) {
    return "high";
  }
  if (score >= 60) {
    return "medium";
  }
  if (score >= 40) {
    return "speculative";
  }
  return "coverage";
}

function isThinMarket(row: CorrelatedMemecoinRow) {
  return (
    typeof row.liquidityUsd !== "number" ||
    !Number.isFinite(row.liquidityUsd) ||
    row.liquidityUsd < THIN_LIQUIDITY_USD ||
    typeof row.volume24hUsd !== "number" ||
    !Number.isFinite(row.volume24hUsd) ||
    row.volume24hUsd < THIN_VOLUME_USD
  );
}

export function getMemecoinRiskTag(
  row: CorrelatedMemecoinRow,
  confidenceScore: number,
  activeLink: CorrelatedMemecoinLink | null,
): MemecoinRiskTag {
  if (typeof row.pairAgeHours === "number" && row.pairAgeHours < NEW_PAIR_HOURS) {
    return "NEW";
  }

  if (isThinMarket(row)) {
    return "THIN";
  }

  if (typeof row.pairAgeHours === "number" && row.pairAgeHours > STALE_PAIR_HOURS) {
    return "STALE";
  }

  if (
    confidenceScore >= 80 &&
    (activeLink?.supportPostCount ?? 0) >= 2 &&
    (row.marketScore ?? 0) >= 70
  ) {
    return "STRONG";
  }

  return "SPECULATIVE";
}

export function getNarrativeKeywordOverlap(
  narrative: RankedTrend,
  row: CorrelatedMemecoinRow,
  activeLink: CorrelatedMemecoinLink | null,
) {
  const persistedReasons = uniqueStrings([
    ...((activeLink?.matchReasons ?? []) as string[]),
    ...((row.matchReasons ?? []) as string[]),
  ]);
  if (persistedReasons.length > 0) {
    return persistedReasons.slice(0, 4);
  }

  const narrativePhrases = uniqueStrings([
    ...((narrative.trendKeyEntities ?? []) as string[]),
    getTrendDisplayNameOrPlaceholder(narrative),
    narrative.trendRawLabel,
  ]);
  const coinCorpus = uniqueStrings([
    row.name,
    row.symbol,
    ...(row.seedTerms ?? []),
    activeLink?.topicLabel,
    activeLink?.narrativeSummary,
    row.strongestTrendLabel,
  ]);
  const coinTokenSet = new Set(coinCorpus.flatMap((value) => tokenize(value)));

  const overlap = narrativePhrases.filter((phrase) => {
    const phraseTokens = tokenize(phrase);
    if (phraseTokens.length === 0) {
      return false;
    }
    return phraseTokens.some((token) => coinTokenSet.has(token));
  });

  if (overlap.length > 0) {
    return overlap.slice(0, 4);
  }

  return uniqueStrings([...(row.seedTerms ?? []), activeLink?.topicLabel]).slice(0, 4);
}

export function buildNarrativeCoinExplanation(
  narrative: RankedTrend,
  row: CorrelatedMemecoinRow,
  activeLink: CorrelatedMemecoinLink | null,
  confidenceScore: number,
) {
  const persistedExplanation = activeLink?.whyLinked ?? row.whyLinked;
  if (persistedExplanation) {
    return persistedExplanation;
  }

  const evidenceBits = [
    activeLink?.supportPostCount
      ? `${activeLink.supportPostCount} supporting narrative reference${activeLink.supportPostCount === 1 ? "" : "s"}`
      : "no direct supporting posts captured",
    narrative.platforms.length > 0 ? `${narrative.platforms.length} platform signal` : null,
    typeof row.liquidityUsd === "number" ? `$${Math.round(row.liquidityUsd / 1_000)}k liquidity` : null,
    typeof row.volume24hUsd === "number" ? `$${Math.round(row.volume24hUsd / 1_000)}k volume` : null,
  ].filter((value): value is string => Boolean(value));

  const narrativeTopicKey = getNarrativeTopicKey(narrative);
  const matchSource = row.matchedTrendKeys?.includes(narrativeTopicKey)
    ? "direct narrative discovery match"
    : activeLink?.isPrimary
      ? "primary narrative link"
      : "secondary narrative link";

  return `${matchSource}; ${evidenceBits.join(" / ")}; execution confidence ${confidenceScore}.`;
}

export function getNarrativeCoinOpportunities(
  narrative: RankedTrend | null | undefined,
  rows: CorrelatedMemecoinRow[],
) {
  if (!narrative) {
    return [] satisfies NarrativeCoinOpportunity[];
  }
  const narrativeTopicKey = getNarrativeTopicKey(narrative);

  const opportunities: NarrativeCoinOpportunity[] = [];
  const seenOpportunityKeys = new Set<string>();

  if (Array.isArray(narrative.linkedCoins)) {
    narrative.linkedCoins.forEach((linkedCoin) => {
      const row = mergeNarrativeRowWithMarketRow(
        toStoredNarrativeRow(narrative, linkedCoin),
        findMatchingMarketRow(linkedCoin, rows),
      );
      const activeLink = getNarrativeLinkForCoin(row, narrativeTopicKey) ?? row.links?.[0] ?? null;
      const confidenceScore = Math.round(clamp(linkedCoin.confidence, 0, 100));
      const confidenceTier =
        linkedCoin.confidenceBand === "high" ||
        linkedCoin.confidenceBand === "medium" ||
        linkedCoin.confidenceBand === "speculative" ||
        linkedCoin.confidenceBand === "coverage"
          ? linkedCoin.confidenceBand
          : getMemecoinConfidenceTier(confidenceScore);
      const riskTag = getMemecoinRiskTag(row, confidenceScore, activeLink);
      const keywordOverlap = getNarrativeKeywordOverlap(narrative, row, activeLink);
      const opportunityKey = opportunityIdentityKey(row);

      opportunities.push({
        row,
        activeLink,
        confidenceScore,
        confidenceTier,
        riskTag,
        keywordOverlap,
        explanation: buildNarrativeCoinExplanation(narrative, row, activeLink, confidenceScore),
      });
      seenOpportunityKeys.add(opportunityKey);
    });
  }

  rows.forEach((row) => {
    const activeLink = getNarrativeLinkForCoin(row, narrativeTopicKey);
    if (!activeLink) {
      return;
    }

    const opportunityKey = opportunityIdentityKey(row);
    if (seenOpportunityKeys.has(opportunityKey)) {
      return;
    }

    const confidenceScore = getMemecoinConfidenceScore(row, narrativeTopicKey);
    const confidenceTier =
      row.confidenceBand === "high" ||
      row.confidenceBand === "medium" ||
      row.confidenceBand === "speculative" ||
      row.confidenceBand === "coverage"
        ? row.confidenceBand
        : getMemecoinConfidenceTier(confidenceScore);
    const riskTag = getMemecoinRiskTag(row, confidenceScore, activeLink);
    const keywordOverlap = getNarrativeKeywordOverlap(narrative, row, activeLink);

    opportunities.push({
      row,
      activeLink,
      confidenceScore,
      confidenceTier,
      riskTag,
      keywordOverlap,
      explanation: buildNarrativeCoinExplanation(narrative, row, activeLink, confidenceScore),
    });
    seenOpportunityKeys.add(opportunityKey);
  });

  return opportunities.sort((left, right) => {
      if (right.confidenceScore !== left.confidenceScore) {
        return right.confidenceScore - left.confidenceScore;
      }

      const linkDelta = (right.activeLink?.linkScore ?? 0) - (left.activeLink?.linkScore ?? 0);
      if (linkDelta !== 0) {
        return linkDelta;
      }

      const volumeDelta = Number(right.row.volume24hUsd ?? 0) - Number(left.row.volume24hUsd ?? 0);
      if (volumeDelta !== 0) {
        return volumeDelta;
      }

      return Number(right.row.liquidityUsd ?? 0) - Number(left.row.liquidityUsd ?? 0);
    });
}

export function getHighConfidenceMemecoinCount(rows: CorrelatedMemecoinRow[]) {
  return rows.reduce((total, row) => {
    const confidenceScore = getMemecoinConfidenceScore(row, row.strongestTrendKey);
    return total + (getMemecoinConfidenceTier(confidenceScore) === "high" ? 1 : 0);
  }, 0);
}

export function getNewMemecoinCount(rows: CorrelatedMemecoinRow[]) {
  return rows.filter(
    (row) =>
      typeof row.pairAgeHours === "number" &&
      Number.isFinite(row.pairAgeHours) &&
      row.pairAgeHours < NEW_PAIR_HOURS,
  ).length;
}
