import { getTrendDisplayNameOrPlaceholder } from "@/lib/dashboard/trend-name-state";
import type {
  CorrelatedMemecoinBoard,
  CorrelatedMemecoinLink,
  CorrelatedMemecoinRow,
  MemecoinExternalLink,
  NarrativeLinkedCoin,
  RankedTrend,
  TrendDashboardVM,
} from "@/types/view-models";

type NarrativeMatchType = "explicit_origin" | "strong_narrative";

type TrendsPageStrictMatchKind =
  | "exact_name"
  | "compact_name"
  | "core_name"
  | "symbol"
  | "suffix_name"
  | "alias_phrase"
  | "distinctive_token"
  | "token_overlap";

type PhraseProfile = {
  raw: string;
  normalized: string;
  compact: string;
  tokens: string[];
  meaningfulTokens: string[];
  reducedTokens: string[];
  reducedPhrase: string;
};

type TrendIdentityProfile = {
  topicKey: string;
  label: string;
  trendCategory: string | null;
  summary: string | null;
  phrases: PhraseProfile[];
  meaningfulTokenSet: Set<string>;
};

type CandidateAliasSource = "name" | "pair_label" | "seed_term" | "external_alias";

type CandidateAlias = {
  source: CandidateAliasSource;
  value: string;
  profile: PhraseProfile;
};

type CandidateSupport = {
  supportPostCount: number;
  supportInteractionScore: number;
};

type CoinIdentityCandidate = {
  symbol: string | null;
  aliases: CandidateAlias[];
  supportByTopicKey: Map<string, CandidateSupport>;
};

type StrictMatchEvaluation = {
  score: number;
  narrativeMatchType: NarrativeMatchType;
  matchKind: TrendsPageStrictMatchKind;
  matchedAlias: string;
  matchedAliasSource: CandidateAliasSource | "symbol";
  matchedTrendText: string;
  matchedTokens: string[];
  reasons: string[];
  supportPostCount: number;
  supportInteractionScore: number;
};

type StrictBoardMatch = {
  link: CorrelatedMemecoinLink;
  linkedCoin: NarrativeLinkedCoin;
  matchScore: number;
  supportPostCount: number;
  supportInteractionScore: number;
  correlationScore: number;
  volume24hUsd: number;
  liquidityUsd: number;
};

const MAX_LINKS_PER_ROW = 3;
const STRICT_MIN_SCORE = 82;

const STOP_TOKENS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const SOFT_FILLER_TOKENS = new Set([
  "breaking",
  "clip",
  "clips",
  "daily",
  "fanbase",
  "headline",
  "headlines",
  "inflow",
  "inflows",
  "latest",
  "media",
  "news",
  "outflow",
  "outflows",
  "panic",
  "push",
  "pushes",
  "risk",
  "risks",
  "rotation",
  "rotations",
  "spiral",
  "spirals",
  "story",
  "stories",
  "surge",
  "surges",
  "update",
  "updates",
]);

const GENERIC_MATCH_TOKENS = new Set([
  ...SOFT_FILLER_TOKENS,
  "agent",
  "agents",
  "ai",
  "america",
  "american",
  "bitcoin",
  "blockchain",
  "btc",
  "campaign",
  "coin",
  "coins",
  "conflict",
  "crypto",
  "economy",
  "economic",
  "election",
  "etf",
  "etfs",
  "ethereum",
  "fed",
  "federal",
  "government",
  "inflation",
  "macro",
  "market",
  "markets",
  "meme",
  "memecoin",
  "narrative",
  "narratives",
  "onchain",
  "official",
  "people",
  "policy",
  "political",
  "politics",
  "post",
  "posts",
  "price",
  "prices",
  "reserve",
  "reserves",
  "signal",
  "signals",
  "social",
  "solana",
  "spot",
  "state",
  "states",
  "token",
  "tokens",
  "trend",
  "trends",
  "united",
  "usa",
  "war",
]);

const COIN_SUFFIX_TOKENS = new Set([
  "cat",
  "coin",
  "coins",
  "community",
  "cto",
  "dao",
  "dog",
  "inu",
  "meme",
  "memecoin",
  "official",
  "takeover",
  "token",
  "tokens",
]);

const GENERIC_EXTERNAL_HOSTS = new Set([
  "discord.com",
  "discord.gg",
  "dexscreener.com",
  "github.com",
  "instagram.com",
  "pump.fun",
  "t.me",
  "telegram.me",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "youtube.com",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function getTrendTopicKey(row: RankedTrend) {
  const topicKey = typeof row.canonicalKeySummary === "string" ? row.canonicalKeySummary.trim() : "";
  return topicKey || row.id;
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

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\u2019']/g, "")
    .replace(/[_/\\-]+/g, " ")
    .replace(/[^a-z0-9$#\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value: string | null | undefined) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function singularizeToken(token: string) {
  if (token.length <= 3) {
    return token;
  }
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("ss") || token.endsWith("us") || token.endsWith("is")) {
    return token;
  }
  if (token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenize(value: string | null | undefined) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.replace(/^[$#]+/, ""))
    .map(singularizeToken)
    .filter(Boolean)
    .filter((token) => !STOP_TOKENS.has(token));
}

function isDistinctiveToken(token: string) {
  return token.length >= 4 && !GENERIC_MATCH_TOKENS.has(token) && !/^\d+$/.test(token);
}

function buildPhraseProfile(value: string | null | undefined): PhraseProfile | null {
  const raw = String(value ?? "").trim();
  const normalized = normalizeText(raw);
  if (!normalized) {
    return null;
  }

  const tokens = tokenize(normalized);
  if (tokens.length === 0) {
    return null;
  }

  const meaningfulTokens = tokens.filter((token) => !GENERIC_MATCH_TOKENS.has(token));
  const reducedTokens = tokens.filter(
    (token) => !SOFT_FILLER_TOKENS.has(token) && !COIN_SUFFIX_TOKENS.has(token),
  );

  return {
    raw,
    normalized,
    compact: compactText(normalized),
    tokens,
    meaningfulTokens,
    reducedTokens: reducedTokens.length > 0 ? reducedTokens : tokens,
    reducedPhrase: (reducedTokens.length > 0 ? reducedTokens : tokens).join(" "),
  };
}

function intersect(left: Iterable<string>, right: Iterable<string>) {
  const rightSet = new Set(Array.from(right, (value) => value.toLowerCase()));
  return Array.from(left).filter((value) => rightSet.has(value.toLowerCase()));
}

function confidenceBandFromScore(score: number) {
  if (score >= 90) {
    return "high";
  }
  if (score >= STRICT_MIN_SCORE) {
    return "medium";
  }
  if (score >= 60) {
    return "speculative";
  }
  return "coverage";
}

function compareStrictMatches(left: StrictMatchEvaluation, right: StrictMatchEvaluation) {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  if (left.supportPostCount !== right.supportPostCount) {
    return right.supportPostCount - left.supportPostCount;
  }

  if (left.supportInteractionScore !== right.supportInteractionScore) {
    return right.supportInteractionScore - left.supportInteractionScore;
  }

  return left.matchedAlias.localeCompare(right.matchedAlias);
}

function compareStrictBoardMatches(left: StrictBoardMatch, right: StrictBoardMatch) {
  if (left.matchScore !== right.matchScore) {
    return right.matchScore - left.matchScore;
  }

  if (left.supportPostCount !== right.supportPostCount) {
    return right.supportPostCount - left.supportPostCount;
  }

  if (left.supportInteractionScore !== right.supportInteractionScore) {
    return right.supportInteractionScore - left.supportInteractionScore;
  }

  if (left.correlationScore !== right.correlationScore) {
    return right.correlationScore - left.correlationScore;
  }

  if (left.volume24hUsd !== right.volume24hUsd) {
    return right.volume24hUsd - left.volume24hUsd;
  }

  return right.liquidityUsd - left.liquidityUsd;
}

function sourcePenalty(source: CandidateAliasSource) {
  if (source === "seed_term") {
    return 6;
  }
  if (source === "external_alias") {
    return 3;
  }
  if (source === "pair_label") {
    return 2;
  }
  return 0;
}

function extractExternalAliases(links: MemecoinExternalLink[] | null | undefined) {
  const values: string[] = [];

  (links ?? []).forEach((link) => {
    const rawUrl = String(link?.url ?? "").trim();
    if (!rawUrl) {
      return;
    }

    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      if (!GENERIC_EXTERNAL_HOSTS.has(host)) {
        const rootLabel = host.split(".")[0] ?? "";
        if (rootLabel) {
          values.push(rootLabel.replace(/[-_]+/g, " "));
        }
      }

      const pathSegments = parsed.pathname
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean)
        .filter((segment) => !/^(status|home|explore|search|coin|token)s?$/i.test(segment));
      const lastSegment = pathSegments[pathSegments.length - 1] ?? "";
      if (lastSegment) {
        values.push(lastSegment.replace(/[-_]+/g, " "));
      }
    } catch {
      values.push(rawUrl.replace(/[-_/]+/g, " "));
    }
  });

  return uniqueStrings(values);
}

function supportMapFromLinks(links: CorrelatedMemecoinLink[] | null | undefined) {
  const supportByTopicKey = new Map<string, CandidateSupport>();

  (links ?? []).forEach((link) => {
    const topicKey = String(link.topicKey ?? "").trim();
    if (!topicKey) {
      return;
    }

    supportByTopicKey.set(topicKey, {
      supportPostCount: Math.max(0, Math.round(link.supportPostCount ?? 0)),
      supportInteractionScore: Number(link.supportInteractionScore ?? 0),
    });
  });

  return supportByTopicKey;
}

function buildTrendIdentityProfile(trend: RankedTrend): TrendIdentityProfile {
  const label = getTrendDisplayNameOrPlaceholder(trend);
  const topicKey = getTrendTopicKey(trend);
  const sourceValues = uniqueStrings([
    label,
    trend.name,
    trend.trendRawLabel,
    trend.trendFallbackLabel,
    topicKey.replace(/[-_/]+/g, " "),
    ...(trend.trendKeyEntities ?? []),
  ]);
  const phrases = sourceValues
    .map((value) => buildPhraseProfile(value))
    .filter((value): value is PhraseProfile => Boolean(value));

  return {
    topicKey,
    label,
    trendCategory: trend.trendCategory ?? trend.trendEnrichment?.trendCategory ?? null,
    summary:
      trend.trendNarrativeSummary ??
      trend.trendDescription ??
      trend.trendContextParagraph ??
      null,
    phrases,
    meaningfulTokenSet: new Set(phrases.flatMap((phrase) => phrase.meaningfulTokens)),
  };
}

function buildBoardRowCandidate(row: CorrelatedMemecoinRow): CoinIdentityCandidate {
  const aliases = uniqueStrings([
    row.name,
    ...(row.pairLabels ?? []),
    ...(row.seedTerms ?? []),
    ...extractExternalAliases([...(row.websites ?? []), ...(row.socials ?? [])]),
  ])
    .flatMap((value) => {
      const profile = buildPhraseProfile(value);
      if (!profile) {
        return [];
      }

      let source: CandidateAliasSource = "name";
      if ((row.pairLabels ?? []).includes(value)) {
        source = "pair_label";
      } else if ((row.seedTerms ?? []).includes(value)) {
        source = "seed_term";
      } else if (value !== row.name) {
        source = "external_alias";
      }

      return [{ source, value, profile } satisfies CandidateAlias];
    });

  return {
    symbol: row.symbol,
    aliases,
    supportByTopicKey: supportMapFromLinks(row.links),
  };
}

function buildLinkedCoinCandidate(linkedCoin: NarrativeLinkedCoin): CoinIdentityCandidate {
  const aliases = uniqueStrings([linkedCoin.name])
    .flatMap((value) => {
      const profile = buildPhraseProfile(value);
      return profile ? [{ source: "name", value, profile } satisfies CandidateAlias] : [];
    });

  return {
    symbol: linkedCoin.symbol,
    aliases,
    supportByTopicKey: new Map(),
  };
}

function scoreSymbolMatch(
  trend: TrendIdentityProfile,
  symbol: string | null,
): StrictMatchEvaluation | null {
  const symbolProfile = buildPhraseProfile(symbol);
  const symbolToken = symbolProfile?.tokens[0] ?? "";
  if (!symbolToken || symbolProfile?.tokens.length !== 1) {
    return null;
  }

  const exactTrendPhrase = trend.phrases.find((phrase) => phrase.normalized === symbolProfile.normalized);
  if (exactTrendPhrase) {
    return {
      score: 95,
      narrativeMatchType: "explicit_origin",
      matchKind: "symbol",
      matchedAlias: symbolProfile.raw,
      matchedAliasSource: "symbol",
      matchedTrendText: exactTrendPhrase.raw,
      matchedTokens: [symbolToken],
      reasons: [`exact symbol match: ${symbolProfile.raw}`],
      supportPostCount: 0,
      supportInteractionScore: 0,
    };
  }

  if (!isDistinctiveToken(symbolToken)) {
    return null;
  }

  const supportingPhrase = trend.phrases.find((phrase) => phrase.tokens.includes(symbolToken));
  if (!supportingPhrase) {
    return null;
  }

  return {
    score: 92,
    narrativeMatchType: "explicit_origin",
    matchKind: "symbol",
    matchedAlias: symbolProfile.raw,
    matchedAliasSource: "symbol",
    matchedTrendText: supportingPhrase.raw,
    matchedTokens: [symbolToken],
    reasons: [`trend text explicitly contains ticker ${symbolProfile.raw}`],
    supportPostCount: 0,
    supportInteractionScore: 0,
  };
}

function scoreAliasMatch(
  trend: TrendIdentityProfile,
  alias: CandidateAlias,
): StrictMatchEvaluation | null {
  const aliasProfile = alias.profile;
  const penalty = sourcePenalty(alias.source);
  const distinctAliasTokens = aliasProfile.reducedTokens.filter(isDistinctiveToken);
  const trendDistinctTokens = Array.from(trend.meaningfulTokenSet).filter(isDistinctiveToken);
  let best: StrictMatchEvaluation | null = null;

  trend.phrases.forEach((trendPhrase) => {
    if (aliasProfile.normalized === trendPhrase.normalized) {
      const exactMatch: StrictMatchEvaluation = {
        score: 100 - penalty,
        narrativeMatchType: "explicit_origin",
        matchKind: "exact_name",
        matchedAlias: alias.value,
        matchedAliasSource: alias.source,
        matchedTrendText: trendPhrase.raw,
        matchedTokens: intersect(aliasProfile.tokens, trendPhrase.tokens).slice(0, 6),
        reasons: [`exact normalized name match: ${alias.value}`],
        supportPostCount: 0,
        supportInteractionScore: 0,
      };
      best = best && compareStrictMatches(best, exactMatch) <= 0 ? best : exactMatch;
      return;
    }

    if (aliasProfile.compact.length >= 4 && aliasProfile.compact === trendPhrase.compact) {
      const compactMatch: StrictMatchEvaluation = {
        score: 99 - penalty,
        narrativeMatchType: "explicit_origin",
        matchKind: "compact_name",
        matchedAlias: alias.value,
        matchedAliasSource: alias.source,
        matchedTrendText: trendPhrase.raw,
        matchedTokens: intersect(aliasProfile.tokens, trendPhrase.tokens).slice(0, 6),
        reasons: [`punctuation and spacing normalize to the same name: ${alias.value}`],
        supportPostCount: 0,
        supportInteractionScore: 0,
      };
      best = best && compareStrictMatches(best, compactMatch) <= 0 ? best : compactMatch;
      return;
    }

    if (aliasProfile.reducedPhrase === trendPhrase.reducedPhrase) {
      const coreMatch: StrictMatchEvaluation = {
        score: 96 - penalty,
        narrativeMatchType: "explicit_origin",
        matchKind: "core_name",
        matchedAlias: alias.value,
        matchedAliasSource: alias.source,
        matchedTrendText: trendPhrase.raw,
        matchedTokens: intersect(aliasProfile.reducedTokens, trendPhrase.reducedTokens).slice(0, 6),
        reasons: [`core name still matches after dropping filler terms: ${alias.value}`],
        supportPostCount: 0,
        supportInteractionScore: 0,
      };
      best = best && compareStrictMatches(best, coreMatch) <= 0 ? best : coreMatch;
      return;
    }

    const aliasCoveredByTrend =
      aliasProfile.reducedTokens.length > 0 &&
      aliasProfile.reducedTokens.every((token) => trendPhrase.reducedTokens.includes(token));
    const trendCoveredByAlias =
      trendPhrase.reducedTokens.length > 0 &&
      trendPhrase.reducedTokens.every((token) => aliasProfile.reducedTokens.includes(token));
    const aliasExtraTokens = aliasProfile.tokens.filter((token) => !trendPhrase.tokens.includes(token));
    const trendExtraTokens = trendPhrase.tokens.filter((token) => !aliasProfile.tokens.includes(token));

    if (
      trendCoveredByAlias &&
      trendPhrase.reducedTokens.some(isDistinctiveToken) &&
      aliasExtraTokens.every((token) => COIN_SUFFIX_TOKENS.has(token))
    ) {
      const suffixMatch: StrictMatchEvaluation = {
        score: 90 - penalty,
        narrativeMatchType: "explicit_origin",
        matchKind: "suffix_name",
        matchedAlias: alias.value,
        matchedAliasSource: alias.source,
        matchedTrendText: trendPhrase.raw,
        matchedTokens: intersect(aliasProfile.reducedTokens, trendPhrase.reducedTokens).slice(0, 6),
        reasons: [`trend name is preserved inside the coin alias with only memecoin suffixes`],
        supportPostCount: 0,
        supportInteractionScore: 0,
      };
      best = best && compareStrictMatches(best, suffixMatch) <= 0 ? best : suffixMatch;
    }

    if (
      aliasCoveredByTrend &&
      aliasProfile.reducedTokens.length >= 2 &&
      aliasProfile.reducedTokens.some(isDistinctiveToken) &&
      trendExtraTokens.every(
        (token) => SOFT_FILLER_TOKENS.has(token) || GENERIC_MATCH_TOKENS.has(token),
      )
    ) {
      const aliasPhraseMatch: StrictMatchEvaluation = {
        score: 86 - penalty,
        narrativeMatchType: "strong_narrative",
        matchKind: "alias_phrase",
        matchedAlias: alias.value,
        matchedAliasSource: alias.source,
        matchedTrendText: trendPhrase.raw,
        matchedTokens: intersect(aliasProfile.reducedTokens, trendPhrase.reducedTokens).slice(0, 6),
        reasons: [`coin alias is directly contained in the trend name`],
        supportPostCount: 0,
        supportInteractionScore: 0,
      };
      best = best && compareStrictMatches(best, aliasPhraseMatch) <= 0 ? best : aliasPhraseMatch;
    }
  });

  const sharedDistinctTokens = intersect(distinctAliasTokens, trendDistinctTokens).filter(isDistinctiveToken);
  if (sharedDistinctTokens.length === 1 && aliasProfile.reducedTokens.length === 1) {
    const distinctiveTokenMatch: StrictMatchEvaluation = {
      score: 86 - penalty,
      narrativeMatchType: "strong_narrative",
      matchKind: "distinctive_token",
      matchedAlias: alias.value,
      matchedAliasSource: alias.source,
      matchedTrendText: trend.label,
      matchedTokens: sharedDistinctTokens,
      reasons: [`single distinctive token match: ${sharedDistinctTokens[0]}`],
      supportPostCount: 0,
      supportInteractionScore: 0,
    };
    best =
      best && compareStrictMatches(best, distinctiveTokenMatch) <= 0 ? best : distinctiveTokenMatch;
  }

  if (sharedDistinctTokens.length >= 2) {
    const overlapCoverage =
      sharedDistinctTokens.length / Math.max(1, Math.max(distinctAliasTokens.length, trendDistinctTokens.length));
    const tokenOverlapMatch: StrictMatchEvaluation = {
      score: Math.max(STRICT_MIN_SCORE, Math.round(82 + Math.min(4, overlapCoverage * 4)) - penalty),
      narrativeMatchType: "strong_narrative",
      matchKind: "token_overlap",
      matchedAlias: alias.value,
      matchedAliasSource: alias.source,
      matchedTrendText: trend.label,
      matchedTokens: sharedDistinctTokens.slice(0, 6),
      reasons: [`high-overlap distinctive tokens: ${sharedDistinctTokens.join(", ")}`],
      supportPostCount: 0,
      supportInteractionScore: 0,
    };
    best = best && compareStrictMatches(best, tokenOverlapMatch) <= 0 ? best : tokenOverlapMatch;
  }

  if (!best || best.score < STRICT_MIN_SCORE) {
    return null;
  }

  if (alias.source !== "name" && aliasProfile.meaningfulTokens.length === 0) {
    return null;
  }

  return best;
}

function buildStrictMatchEvaluation(
  trend: TrendIdentityProfile,
  candidate: CoinIdentityCandidate,
): StrictMatchEvaluation | null {
  const evaluations = [
    scoreSymbolMatch(trend, candidate.symbol),
    ...candidate.aliases.map((alias) => scoreAliasMatch(trend, alias)),
  ].filter((value): value is StrictMatchEvaluation => Boolean(value));

  if (evaluations.length === 0) {
    return null;
  }

  evaluations.sort(compareStrictMatches);
  const best = evaluations[0]!;
  const support = candidate.supportByTopicKey.get(trend.topicKey);
  return {
    ...best,
    supportPostCount: support?.supportPostCount ?? 0,
    supportInteractionScore: support?.supportInteractionScore ?? 0,
  };
}

function buildStrictWhyLinked(match: StrictMatchEvaluation) {
  const prefix =
    match.narrativeMatchType === "explicit_origin"
      ? "Direct name match"
      : "Qualified name match";
  return `${prefix}: ${match.reasons.slice(0, 3).join("; ")}.`;
}

function buildRawMatchSignals(
  trend: TrendIdentityProfile,
  match: StrictMatchEvaluation,
): Record<string, unknown> {
  return {
    match_type: match.narrativeMatchType,
    match_score: match.score,
    match_reason: buildStrictWhyLinked(match),
    strict_trends_page_match: true,
    trends_page_match_type: match.matchKind,
    matched_alias: match.matchedAlias,
    matched_alias_source: match.matchedAliasSource,
    matched_trend_text: match.matchedTrendText,
    supporting_keywords: match.matchedTokens,
    exact_overlap_terms: match.matchedTokens,
    matched_keywords: match.matchedTokens,
    generic_only_match: false,
    support_post_count: match.supportPostCount,
    support_interaction_score: Number(match.supportInteractionScore.toFixed(3)),
    trend_topic_key: trend.topicKey,
  };
}

function correlationLabelFromScore(score: number) {
  if (score >= 96) {
    return "Exact";
  }
  if (score >= 90) {
    return "Direct";
  }
  if (score >= STRICT_MIN_SCORE) {
    return "Alias";
  }
  return "Weak";
}

function dedupeTrends(rows: RankedTrend[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const topicKey = getTrendTopicKey(row);
    if (seen.has(topicKey)) {
      return false;
    }

    seen.add(topicKey);
    return true;
  });
}

function mergeDiagnostics(board: CorrelatedMemecoinBoard, displayedRows: number) {
  if (!board.diagnostics) {
    return board.diagnostics ?? null;
  }

  return {
    ...board.diagnostics,
    displayedRows,
  };
}

export function buildStrictTrendsPageBoardMatch(
  trend: RankedTrend,
  row: CorrelatedMemecoinRow,
): StrictBoardMatch | null {
  const trendProfile = buildTrendIdentityProfile(trend);
  const candidate = buildBoardRowCandidate(row);
  const match = buildStrictMatchEvaluation(trendProfile, candidate);
  if (!match) {
    return null;
  }

  const whyLinked = buildStrictWhyLinked(match);
  const rawMatchSignals = buildRawMatchSignals(trendProfile, match);
  const link: CorrelatedMemecoinLink = {
    topicKey: trendProfile.topicKey,
    topicLabel: trendProfile.label,
    trendCategory: trendProfile.trendCategory,
    narrativeSummary: trendProfile.summary,
    lexicalScore: match.score,
    mentionScore: 0,
    timingScore: 0,
    cultureFitScore: 0,
    linkScore: match.score,
    supportPostCount: match.supportPostCount,
    supportInteractionScore: match.supportInteractionScore,
    isPrimary: false,
    whyLinked,
    matchReasons: uniqueStrings([whyLinked, ...match.reasons]).slice(0, 6),
    rawMatchSignals,
  };
  const linkedCoin: NarrativeLinkedCoin = {
    id: `${row.chainId}:${row.tokenAddress}`,
    symbol: row.symbol,
    name: row.name,
    address: row.tokenAddress,
    confidence: match.score,
    confidenceBand: confidenceBandFromScore(match.score),
    liquidity: row.liquidityUsd ?? null,
    volume: row.volume24hUsd ?? null,
    age: row.pairAgeHours ?? null,
    priceUsd: row.priceUsd ?? null,
    priceChange1hPct: row.priceChange1hPct ?? null,
    priceChange6hPct: row.priceChange6hPct ?? null,
    priceChange24hPct: row.priceChange24hPct ?? null,
    marketCap: row.marketCapUsd ?? null,
    fdv: row.fdvUsd ?? null,
    iconUrl: row.iconUrl ?? null,
    quoteSymbol: row.quoteSymbol ?? null,
    websites: row.websites ?? null,
    socials: row.socials ?? null,
    tradingviewSymbol: row.tradingviewSymbol ?? null,
    mentionCount: match.supportPostCount,
    engagementScore: match.supportInteractionScore,
    chainId: row.chainId,
    pairAddress: row.pairAddress,
    dexscreenerUrl: row.dexscreenerUrl,
    isLive: row.isLive,
    lastValidatedAt: row.lastValidatedAt,
    validationStatus: row.validationStatus,
    validationReason: row.validationReason,
    lastSeenLiquidityUsd: row.lastSeenLiquidityUsd,
    lastSeenVolume24hUsd: row.lastSeenVolume24hUsd,
    lastSeenTxns24h: row.lastSeenTxns24h,
    marketScore: row.marketScore ?? null,
    memecoinFitScore: row.memecoinFitScore ?? null,
    whyLinked,
    matchReasons: link.matchReasons,
    rawMatchSignals,
    lastUpdatedAt: row.updatedAt,
  };

  return {
    link,
    linkedCoin,
    matchScore: match.score,
    supportPostCount: match.supportPostCount,
    supportInteractionScore: match.supportInteractionScore,
    correlationScore: row.correlationScore,
    volume24hUsd: Number(row.volume24hUsd ?? 0),
    liquidityUsd: Number(row.liquidityUsd ?? 0),
  };
}

export function strictifyTrendsPageLinkedCoin(
  trend: RankedTrend,
  linkedCoin: NarrativeLinkedCoin,
): NarrativeLinkedCoin | null {
  const trendProfile = buildTrendIdentityProfile(trend);
  const candidate = buildLinkedCoinCandidate(linkedCoin);
  const match = buildStrictMatchEvaluation(trendProfile, candidate);
  if (!match) {
    return null;
  }

  const whyLinked = buildStrictWhyLinked(match);
  const rawMatchSignals = {
    ...(asRecord(linkedCoin.rawMatchSignals) ?? {}),
    ...buildRawMatchSignals(trendProfile, match),
  };

  return {
    ...linkedCoin,
    confidence: match.score,
    confidenceBand: confidenceBandFromScore(match.score),
    whyLinked,
    matchReasons: uniqueStrings([whyLinked, ...match.reasons, ...(linkedCoin.matchReasons ?? [])]).slice(0, 6),
    rawMatchSignals,
  };
}

export function buildStrictTrendsPageCorrelatedBoard(
  state: TrendDashboardVM,
  board: CorrelatedMemecoinBoard | null,
): CorrelatedMemecoinBoard | null {
  if (!board) {
    return null;
  }

  const trends = dedupeTrends([
    ...state.leaderboard,
    ...state.leaderboards.established,
    ...state.leaderboards.emerging,
    ...(state.detail?.trend ? [state.detail.trend] : []),
  ]);
  if (trends.length === 0) {
    return {
      ...board,
      rows: [],
      diagnostics: mergeDiagnostics(board, 0),
    };
  }

  const strictRows = board.rows
    .flatMap((row) => {
      const matches = trends
        .map((trend) => buildStrictTrendsPageBoardMatch(trend, row))
        .filter((value): value is StrictBoardMatch => Boolean(value))
        .sort(compareStrictBoardMatches)
        .slice(0, MAX_LINKS_PER_ROW);

      if (matches.length === 0) {
        return [];
      }

      const links = matches.map((match, index) => ({
        ...match.link,
        isPrimary: index === 0,
      }));
      const topLink = links[0]!;
      const strictRow: CorrelatedMemecoinRow = {
        ...row,
        strongestTrendKey: topLink.topicKey,
        strongestTrendLabel: topLink.topicLabel,
        strongestTrendCategory: topLink.trendCategory ?? row.strongestTrendCategory ?? null,
        strongestTrendSummary: topLink.narrativeSummary ?? row.strongestTrendSummary ?? null,
        correlationScore: topLink.linkScore,
        correlationLabel: correlationLabelFromScore(topLink.linkScore),
        matchedTrendKeys: links.map((link) => link.topicKey),
        confidenceBand: confidenceBandFromScore(topLink.linkScore),
        whyLinked: topLink.whyLinked ?? null,
        matchReasons: topLink.matchReasons ?? null,
        rawMatchSignals: topLink.rawMatchSignals ?? null,
        links,
      };
      return [strictRow];
    })
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));

  return {
    ...board,
    rows: strictRows,
    diagnostics: mergeDiagnostics(board, strictRows.length),
  };
}
