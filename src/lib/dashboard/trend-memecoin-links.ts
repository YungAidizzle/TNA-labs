import "server-only";

import { fetchLatestCorrelatedMemecoinBoard } from "@/lib/dashboard/correlated-memecoins";
import { revalidateNarrativeLinkedCoins } from "@/lib/dashboard/dexscreener-live-validation";
import { getMemecoinDbCapabilities } from "@/lib/dashboard/memecoin-db-capabilities";
import { getServerPostgresPool, hasDatabaseUrl } from "@/lib/db/server-postgres";
import {
  CorrelatedMemecoinBoard,
  CorrelatedMemecoinRow,
  NarrativeLinkedCoin,
  RankedTrend,
  TrendDashboardVM,
} from "@/types/view-models";

type TrendMemecoinLinkRow = {
  topic_key: string;
  rank: number;
  chain_id: string;
  coin_address: string;
  pair_address: string | null;
  dexscreener_url: string | null;
  coin_symbol: string;
  coin_name: string;
  confidence_score: number;
  confidence_band: string | null;
  mention_count: number | null;
  engagement_score: number | null;
  age_hours: number | null;
  liquidity: number | null;
  volume_24h: number | null;
  market_score: number | null;
  memecoin_fit_score: number | null;
  why_linked: string | null;
  match_reasons_json: string[] | null;
  raw_match_signals_json: Record<string, unknown> | null;
  last_updated_at: string | null;
  is_live: boolean | null;
  last_validated_at: string | null;
  validation_status: string | null;
  validation_reason: string | null;
  last_seen_liquidity_usd: number | null;
  last_seen_volume_h24: number | null;
  last_seen_txns_h24: number | null;
};

type NarrativeFamily =
  | "ai"
  | "politics"
  | "geopolitics"
  | "macro"
  | "celebrity"
  | "creator"
  | "entertainment"
  | "gaming"
  | "crypto"
  | "internet_culture";

type TrendNarrativeProfile = {
  topicKey: string;
  label: string;
  trendCategory: string | null;
  text: string;
  tokens: Set<string>;
  phrases: string[];
  entities: string[];
  tags: string[];
  families: NarrativeFamily[];
};

type CoinNarrativeProfile = {
  categories: Set<string>;
  text: string;
  tokens: Set<string>;
  summaryTokens: Set<string>;
  phrases: string[];
  phraseKeys: Set<string>;
  entityKeys: Set<string>;
  topicKeys: Set<string>;
  tags: string[];
  families: NarrativeFamily[];
  boardLinkCount: number;
};

type FamilyAffinityResult = {
  score: number;
  shared: NarrativeFamily[];
  adjacent: NarrativeFamily[];
};

type HeuristicNarrativeMatch = {
  linkedCoin: NarrativeLinkedCoin;
  matchType: "direct" | "inferred" | "fallback";
  matchScore: number;
  supportPostCount: number;
  supportInteractionScore: number;
  correlationScore: number;
  volume24hUsd: number;
  liquidityUsd: number;
};

const MAX_LINKS_PER_TREND = 3;
const DIRECT_MATCH_THRESHOLD = 42;
const INFERRED_MATCH_THRESHOLD = 48;

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

const GENERIC_MATCH_TOKENS = new Set([
  "alerts",
  "article",
  "articles",
  "board",
  "breaking",
  "cluster",
  "clusters",
  "coin",
  "coins",
  "commentary",
  "community",
  "content",
  "context",
  "coverage",
  "cto",
  "daily",
  "dashboard",
  "debate",
  "discussion",
  "entity",
  "event",
  "headline",
  "latest",
  "media",
  "meme",
  "memecoin",
  "mentions",
  "mixed",
  "narrative",
  "narratives",
  "news",
  "online",
  "people",
  "posts",
  "reaction",
  "report",
  "score",
  "seed",
  "signal",
  "signals",
  "social",
  "story",
  "takeover",
  "theme",
  "themes",
  "timeline",
  "token",
  "topic",
  "topics",
  "trend",
  "trends",
  "update",
  "updates",
  "viral",
]);

const FAMILY_LABELS: Record<NarrativeFamily, string> = {
  ai: "AI / compute",
  politics: "politics",
  geopolitics: "geopolitics / war",
  macro: "macro / inflation",
  celebrity: "celebrity / media",
  creator: "creator / streamer",
  entertainment: "entertainment",
  gaming: "gaming",
  crypto: "crypto-native",
  internet_culture: "internet culture",
};

const CATEGORY_FAMILY_HINTS: Record<string, NarrativeFamily[]> = {
  "ai": ["ai"],
  "ai tech": ["ai"],
  "artificial intelligence": ["ai"],
  "technology": ["ai"],
  "science and technology": ["ai"],
  "creator": ["creator"],
  "creator influencer": ["creator", "celebrity"],
  "influencer": ["creator", "celebrity"],
  "celebrity": ["celebrity", "entertainment"],
  "entertainment": ["entertainment", "celebrity"],
  "film": ["entertainment"],
  "movies": ["entertainment"],
  "music": ["entertainment"],
  "tv": ["entertainment"],
  "gaming": ["gaming"],
  "games": ["gaming"],
  "internet culture": ["internet_culture"],
  "culture": ["internet_culture"],
  "meme": ["internet_culture", "crypto"],
  "memes": ["internet_culture", "crypto"],
  "crypto": ["crypto", "internet_culture"],
  "markets": ["macro", "crypto"],
  "finance": ["macro", "crypto"],
  "economy": ["macro"],
  "macro": ["macro"],
  "politics": ["politics"],
  "policy": ["politics", "macro"],
  "geopolitics": ["geopolitics", "politics"],
  "war": ["geopolitics", "politics"],
};

const FAMILY_KEYWORDS: Record<NarrativeFamily, string[]> = {
  ai: [
    "ai",
    "agent",
    "agents",
    "anthropic",
    "automation",
    "chatgpt",
    "chip",
    "claude",
    "compute",
    "gpt",
    "gpu",
    "llm",
    "model",
    "openai",
    "robot",
    "semiconductor",
  ],
  politics: [
    "campaign",
    "congress",
    "democrat",
    "election",
    "fed",
    "government",
    "maga",
    "policy",
    "president",
    "republican",
    "senate",
    "trump",
    "vote",
    "white house",
  ],
  geopolitics: [
    "border",
    "ceasefire",
    "china",
    "conflict",
    "country",
    "iran",
    "israel",
    "leader",
    "military",
    "missile",
    "nato",
    "putin",
    "russia",
    "tariff",
    "ukraine",
    "war",
  ],
  macro: [
    "anti fiat",
    "central bank",
    "cpi",
    "debt",
    "dollar",
    "economy",
    "fed",
    "fiat",
    "inflation",
    "interest rates",
    "liquidity",
    "macro",
    "money printer",
    "printing",
    "rates",
    "recession",
    "stimulus",
    "treasury",
    "yield",
  ],
  celebrity: [
    "actor",
    "album",
    "celebrity",
    "elon",
    "interview",
    "media",
    "musician",
    "podcast",
    "rapper",
    "show",
    "singer",
    "swift",
    "taylor",
    "viral clip",
  ],
  creator: [
    "channel",
    "clips",
    "creator",
    "fanbase",
    "influencer",
    "podcast",
    "stream",
    "streamer",
    "tiktok",
    "twitch",
    "vtuber",
    "youtube",
    "youtuber",
  ],
  entertainment: [
    "anime",
    "box office",
    "celeb",
    "entertainment",
    "film",
    "manga",
    "movie",
    "music",
    "netflix",
    "series",
    "show",
    "tv",
  ],
  gaming: [
    "esports",
    "fortnite",
    "game",
    "gaming",
    "minecraft",
    "nintendo",
    "playstation",
    "roblox",
    "steam",
    "switch",
    "xbox",
  ],
  crypto: [
    "altcoin",
    "base",
    "bitcoin",
    "blockchain",
    "bull",
    "crypto",
    "defi",
    "doge",
    "ethereum",
    "memecoin",
    "nft",
    "onchain",
    "pepe",
    "pump",
    "sol",
    "solana",
  ],
  internet_culture: [
    "brainrot",
    "copypasta",
    "discord",
    "frog",
    "internet",
    "meme",
    "pepe",
    "reddit",
    "shitpost",
    "slang",
    "timeline",
    "tiktok",
    "trend",
    "viral",
  ],
};

const FAMILY_AFFINITY: Partial<Record<NarrativeFamily, Partial<Record<NarrativeFamily, number>>>> =
  {
    ai: {
      crypto: 0.45,
      internet_culture: 0.28,
    },
    politics: {
      geopolitics: 0.82,
      macro: 0.44,
      celebrity: 0.22,
    },
    geopolitics: {
      politics: 0.82,
      macro: 0.38,
    },
    macro: {
      politics: 0.44,
      geopolitics: 0.38,
      crypto: 0.34,
    },
    celebrity: {
      creator: 0.84,
      entertainment: 0.76,
      internet_culture: 0.42,
      politics: 0.22,
    },
    creator: {
      celebrity: 0.84,
      entertainment: 0.58,
      internet_culture: 0.5,
    },
    entertainment: {
      celebrity: 0.76,
      creator: 0.58,
      gaming: 0.36,
      internet_culture: 0.46,
    },
    gaming: {
      entertainment: 0.36,
      internet_culture: 0.42,
    },
    crypto: {
      ai: 0.45,
      macro: 0.34,
      internet_culture: 0.62,
    },
    internet_culture: {
      creator: 0.5,
      entertainment: 0.46,
      gaming: 0.42,
      crypto: 0.62,
      celebrity: 0.42,
      ai: 0.28,
    },
  };

function isMissingRelation(error: unknown) {
  const databaseError = error as { code?: string; message?: string };
  const message = String(databaseError?.message ?? "").toLowerCase();
  return databaseError?.code === "42P01" || message.includes("does not exist");
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9#$\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactIdentity(value: string | null | undefined) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function tokenize(value: string | null | undefined) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.replace(/^[$#]+/, "").trim())
    .filter(
      (token) =>
        token.length >= 2 &&
        !STOP_TOKENS.has(token) &&
        !GENERIC_MATCH_TOKENS.has(token),
    );
}

function extractTagTokens(value: string | null | undefined) {
  const text = String(value ?? "");
  const matches = [...text.matchAll(/[$#]([a-z0-9_]{2,})/gi)];
  return uniqueStrings(matches.map((match) => match[1]?.toLowerCase() ?? ""));
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

function intersectStrings(left: Iterable<string>, right: Iterable<string>) {
  const rightSet = new Set(Array.from(right, (value) => value.toLowerCase()));
  return uniqueStrings(
    Array.from(left)
      .filter((value) => rightSet.has(value.toLowerCase()))
      .map((value) => value.toLowerCase()),
  );
}

function normalizeCategoryKey(value: string | null | undefined) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function addFamilyScore(
  scores: Map<NarrativeFamily, number>,
  family: NarrativeFamily,
  score: number,
) {
  scores.set(family, (scores.get(family) ?? 0) + score);
}

function inferNarrativeFamilies(
  textValues: Array<string | null | undefined>,
  categoryValues: Array<string | null | undefined>,
) {
  const scores = new Map<NarrativeFamily, number>();
  const normalizedTexts = uniqueStrings(textValues.map((value) => normalizeText(value)));
  const combinedText = normalizedTexts.join(" ");
  const tokenSet = new Set(normalizedTexts.flatMap((value) => tokenize(value)));

  uniqueStrings(categoryValues.map((value) => normalizeCategoryKey(value))).forEach((category) => {
    Object.entries(CATEGORY_FAMILY_HINTS).forEach(([hint, families]) => {
      if (category === hint || category.includes(hint) || hint.includes(category)) {
        families.forEach((family) => addFamilyScore(scores, family, 2.8));
      }
    });
  });

  (Object.entries(FAMILY_KEYWORDS) as Array<[NarrativeFamily, string[]]>).forEach(
    ([family, keywords]) => {
      let hits = 0;

      keywords.forEach((keyword) => {
        const normalizedKeyword = normalizeText(keyword);
        if (!normalizedKeyword) {
          return;
        }

        if (normalizedKeyword.includes(" ")) {
          if (combinedText.includes(normalizedKeyword)) {
            hits += 1.2;
          }
          return;
        }

        if (tokenSet.has(normalizedKeyword)) {
          hits += 1;
        }
      });

      if (hits > 0) {
        addFamilyScore(scores, family, Math.min(3.8, hits));
      }
    },
  );

  return [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([family]) => family);
}

function resolveFamilyAffinity(
  leftFamilies: NarrativeFamily[],
  rightFamilies: NarrativeFamily[],
): FamilyAffinityResult {
  const shared = leftFamilies.filter((family) => rightFamilies.includes(family));
  if (shared.length > 0) {
    return {
      score: 1,
      shared: uniqueStrings(shared) as NarrativeFamily[],
      adjacent: [],
    };
  }

  let bestScore = 0;
  let bestPair: [NarrativeFamily, NarrativeFamily] | null = null;

  leftFamilies.forEach((leftFamily) => {
    rightFamilies.forEach((rightFamily) => {
      const score =
        FAMILY_AFFINITY[leftFamily]?.[rightFamily] ??
        FAMILY_AFFINITY[rightFamily]?.[leftFamily] ??
        0;
      if (score > bestScore) {
        bestScore = score;
        bestPair = [leftFamily, rightFamily];
      }
    });
  });

  return {
    score: bestScore,
    shared: [],
    adjacent: bestPair
      ? (uniqueStrings([bestPair[0], bestPair[1]]) as NarrativeFamily[])
      : [],
  };
}

function familyLabel(family: NarrativeFamily | null | undefined) {
  if (!family) {
    return "narrative";
  }
  return FAMILY_LABELS[family] ?? family;
}

function readSignalNumber(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readSignalString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readSignalStringArray(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(
    value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean),
  );
}

function extractQuotedTerms(values: Array<string | null | undefined>) {
  const terms: string[] = [];

  values.forEach((value) => {
    const text = String(value ?? "");
    [...text.matchAll(/'([^']+)'/g)].forEach((match) => {
      const term = String(match[1] ?? "").trim();
      if (term) {
        terms.push(term);
      }
    });
  });

  return uniqueStrings(terms);
}

function jaccardSimilarity(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  left.forEach((value) => {
    if (right.has(value)) {
      intersection += 1;
    }
  });

  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function getTrendLabel(row: RankedTrend) {
  return (
    row.displayName ??
    row.name ??
    row.trendFallbackLabel ??
    row.trendRawLabel ??
    row.canonicalKeySummary ??
    row.id
  );
}

function buildTrendProfile(row: RankedTrend): TrendNarrativeProfile {
  const topicKey = getTrendTopicKey(row) ?? row.id;
  const label = getTrendLabel(row);
  const textValues = uniqueStrings([
    label,
    row.trendRawLabel,
    row.trendFallbackLabel,
    row.trendDescription,
    row.trendContextParagraph,
    row.trendNarrativeSummary,
    row.canonicalKeySummary?.replace(/[-_]+/g, " "),
    ...(row.trendKeyEntities ?? []),
  ]);

  return {
    topicKey,
    label,
    trendCategory: row.trendCategory ?? row.trendEnrichment?.trendCategory ?? null,
    text: textValues.map((value) => normalizeText(value)).filter(Boolean).join(" "),
    tokens: new Set(textValues.flatMap((value) => tokenize(value))),
    phrases: uniqueStrings(
      [label, row.trendRawLabel, row.trendFallbackLabel, ...(row.trendKeyEntities ?? [])]
        .map((value) => normalizeText(value))
        .filter((value) => value.length >= 3),
    ),
    entities: uniqueStrings([
      ...(row.trendKeyEntities ?? []),
      label,
      row.trendRawLabel,
      row.trendFallbackLabel,
    ]),
    tags: uniqueStrings(textValues.flatMap((value) => extractTagTokens(value))),
    families: inferNarrativeFamilies(textValues, [
      row.trendCategory,
      row.trendEnrichment?.trendCategory,
    ]),
  };
}

function buildCoinProfile(row: CorrelatedMemecoinRow): CoinNarrativeProfile {
  const linkTexts = (row.links ?? []).flatMap((link) => [
    link.topicLabel,
    link.narrativeSummary,
    link.trendCategory,
  ]);
  const textValues = uniqueStrings([
    row.name,
    row.symbol,
    row.description,
    row.strongestTrendLabel,
    row.strongestTrendSummary,
    ...(row.seedTerms ?? []),
    ...linkTexts,
  ]);
  const categories = new Set(
    uniqueStrings([
      row.strongestTrendCategory,
      ...(row.links ?? []).map((link) => link.trendCategory ?? null),
    ]).map((value) => normalizeCategoryKey(value)),
  );
  const phrases = uniqueStrings(
    [
      row.name,
      row.symbol,
      row.strongestTrendLabel,
      ...(row.seedTerms ?? []),
      ...(row.links ?? []).map((link) => link.topicLabel),
    ]
      .map((value) => normalizeText(value))
      .filter((value) => value.length >= 3),
  );

  return {
    categories,
    text: textValues.map((value) => normalizeText(value)).filter(Boolean).join(" "),
    tokens: new Set(textValues.flatMap((value) => tokenize(value))),
    summaryTokens: new Set(
      uniqueStrings([
        row.description,
        row.strongestTrendSummary,
        ...(row.links ?? []).map((link) => link.narrativeSummary ?? null),
      ]).flatMap((value) => tokenize(value)),
    ),
    phrases,
    phraseKeys: new Set(phrases.map((value) => compactIdentity(value)).filter(Boolean)),
    entityKeys: new Set(
      uniqueStrings([row.name, row.symbol, ...(row.seedTerms ?? [])])
        .map((value) => compactIdentity(value))
        .filter(Boolean),
    ),
    topicKeys: new Set(
      uniqueStrings([
        row.strongestTrendKey,
        ...(row.matchedTrendKeys ?? []),
        ...(row.links ?? []).map((link) => link.topicKey),
      ]),
    ),
    tags: uniqueStrings(textValues.flatMap((value) => extractTagTokens(value))),
    families: inferNarrativeFamilies(textValues, [
      row.strongestTrendCategory,
      ...(row.links ?? []).map((link) => link.trendCategory ?? null),
    ]),
    boardLinkCount: row.links?.length ?? 0,
  };
}

function matchPriority(matchType: string | null | undefined) {
  if (matchType === "direct") {
    return 3;
  }
  if (matchType === "inferred") {
    return 2;
  }
  if (matchType === "fallback") {
    return 1;
  }
  return 0;
}

export function getTrendTopicKey(row: RankedTrend) {
  const topicKey = typeof row.canonicalKeySummary === "string" ? row.canonicalKeySummary.trim() : "";
  return topicKey || null;
}

function dedupeTopicKeys(rows: RankedTrend[]) {
  return [
    ...new Set(
      rows.map((row) => getTrendTopicKey(row)).filter((value): value is string => Boolean(value)),
    ),
  ];
}

async function fetchTrendMemecoinLinks(topicKeys: string[]) {
  const result = new Map<string, NarrativeLinkedCoin[]>();
  if (!hasDatabaseUrl() || topicKeys.length === 0) {
    return result;
  }

  const pool = getServerPostgresPool();
  try {
    const capabilities = await getMemecoinDbCapabilities();
    const liveValidationSelect = capabilities.assetLiveValidationColumnsAvailable
      ? `
          a.is_live,
          a.last_validated_at,
          a.validation_status,
          a.validation_reason,
          a.last_seen_liquidity_usd,
          a.last_seen_volume_h24,
          a.last_seen_txns_h24
      `
      : `
          NULL::boolean AS is_live,
          NULL::timestamptz AS last_validated_at,
          NULL::text AS validation_status,
          NULL::text AS validation_reason,
          NULL::double precision AS last_seen_liquidity_usd,
          NULL::double precision AS last_seen_volume_h24,
          NULL::integer AS last_seen_txns_h24
      `;
    const liveValidationWhere = capabilities.assetLiveValidationColumnsAvailable
      ? `AND COALESCE(a.validation_status, 'pending') <> 'invalid'`
      : "";
    const rowsResult = await pool.query<TrendMemecoinLinkRow>(
      `
        SELECT
          l.topic_key,
          l.rank,
          l.chain_id,
          l.coin_address,
          COALESCE(l.pair_address, a.pair_address) AS pair_address,
          COALESCE(l.dexscreener_url, a.dexscreener_url) AS dexscreener_url,
          l.coin_symbol,
          l.coin_name,
          l.confidence_score,
          l.confidence_band,
          l.mention_count,
          l.engagement_score,
          l.age_hours,
          COALESCE(l.liquidity, a.last_seen_liquidity_usd) AS liquidity,
          COALESCE(l.volume_24h, a.last_seen_volume_h24) AS volume_24h,
          l.market_score,
          l.memecoin_fit_score,
          l.why_linked,
          l.match_reasons_json,
          l.raw_match_signals_json,
          l.last_updated_at,
          ${liveValidationSelect}
        FROM public.trend_memecoin_links l
        LEFT JOIN public.memecoin_assets a
          ON LOWER(a.chain_id) = LOWER(l.chain_id)
         AND LOWER(a.token_address) = LOWER(l.coin_address)
        WHERE l.topic_key = ANY($1::text[])
          ${liveValidationWhere}
        ORDER BY l.topic_key ASC, l.confidence_score DESC, l.rank ASC, l.id ASC
      `,
      [topicKeys],
    );

    const topicCoinEntries = rowsResult.rows.map((row) => {
      const topicKey = row.topic_key.trim();
      const linkedCoin: NarrativeLinkedCoin = {
        id: `${row.chain_id}:${row.coin_address}`,
        symbol: row.coin_symbol,
        name: row.coin_name,
        address: row.coin_address,
        confidence: Number(row.confidence_score ?? 0),
        confidenceBand: row.confidence_band,
        liquidity: row.liquidity,
        volume: row.volume_24h,
        age: row.age_hours,
        mentionCount: row.mention_count,
        engagementScore: row.engagement_score,
        chainId: row.chain_id,
        pairAddress: row.pair_address,
        dexscreenerUrl:
          row.dexscreener_url ??
          (row.pair_address ? `https://dexscreener.com/${row.chain_id}/${row.pair_address}` : null),
        isLive: row.is_live,
        lastValidatedAt: row.last_validated_at,
        validationStatus: row.validation_status,
        validationReason: row.validation_reason,
        lastSeenLiquidityUsd: row.last_seen_liquidity_usd,
        lastSeenVolume24hUsd: row.last_seen_volume_h24,
        lastSeenTxns24h: row.last_seen_txns_h24,
        marketScore: row.market_score,
        memecoinFitScore: row.memecoin_fit_score,
        whyLinked: row.why_linked,
        matchReasons: Array.isArray(row.match_reasons_json) ? row.match_reasons_json : null,
        rawMatchSignals:
          row.raw_match_signals_json && typeof row.raw_match_signals_json === "object"
            ? row.raw_match_signals_json
            : null,
        lastUpdatedAt: row.last_updated_at,
      };
      return { topicKey, linkedCoin };
    });

    const uniqueCoins = new Map<string, NarrativeLinkedCoin>();
    topicCoinEntries.forEach(({ linkedCoin }) => {
      uniqueCoins.set(linkedCoin.id, linkedCoin);
    });
    const { liveCoins, rejected, stats } = await revalidateNarrativeLinkedCoins([
      ...uniqueCoins.values(),
    ]);
    const liveCoinById = new Map(liveCoins.map((coin) => [coin.id, coin] as const));

    topicCoinEntries.forEach(({ topicKey, linkedCoin }) => {
      const liveCoin = liveCoinById.get(linkedCoin.id);
      if (!liveCoin) {
        return;
      }
      const current = result.get(topicKey) ?? [];
      current.push(liveCoin);
      result.set(topicKey, current);
    });

    if (rejected.length > 0) {
      console.info("[trend-memecoin-links] suppressed invalid linked coins", {
        requested_topics: topicKeys.length,
        schema_live_validation_columns_available: capabilities.assetLiveValidationColumnsAvailable,
        unique_coins_requested: uniqueCoins.size,
        live_coin_count: liveCoins.length,
        rejected_count: rejected.length,
        reject_reasons: stats.rejectReasonCounts,
        decision_source_counts: stats.decisionSourceCounts,
        fallback_reason_counts: stats.fallbackReasonCounts,
      });
    }

    return result;
  } catch (error) {
    if (isMissingRelation(error)) {
      return result;
    }
    throw error;
  }
}

function supportingKeywordsFromStoredCoin(linkedCoin: NarrativeLinkedCoin) {
  const signals = asRecord(linkedCoin.rawMatchSignals);
  return uniqueStrings([
    ...readSignalStringArray(signals, "supporting_keywords"),
    ...readSignalStringArray(signals, "exact_overlap_terms"),
    ...readSignalStringArray(signals, "partial_overlap_terms"),
    ...readSignalStringArray(signals, "seed_overlap_terms"),
    ...extractQuotedTerms([linkedCoin.whyLinked, ...(linkedCoin.matchReasons ?? [])]),
  ]).slice(0, 6);
}

function inferStoredMatchType(linkedCoin: NarrativeLinkedCoin): "direct" | "inferred" | "fallback" {
  const signals = asRecord(linkedCoin.rawMatchSignals);
  const explicitType = readSignalString(signals, "match_type");
  if (
    explicitType === "direct" ||
    explicitType === "inferred" ||
    explicitType === "fallback"
  ) {
    return explicitType;
  }

  if (
    (readSignalNumber(signals, "exact_overlap_count") ?? 0) > 0 ||
    (readSignalNumber(signals, "seed_overlap_count") ?? 0) > 0 ||
    (readSignalNumber(signals, "best_name_similarity") ?? 0) >= 0.62 ||
    (readSignalNumber(signals, "best_symbol_similarity") ?? 0) >= 0.72
  ) {
    return "direct";
  }

  const reasonText = normalizeText(
    [linkedCoin.whyLinked, ...(linkedCoin.matchReasons ?? [])].join(" "),
  );

  if (
    reasonText.includes("matched narrative keyword") ||
    reasonText.includes("seed overlap") ||
    reasonText.includes("ticker similarity") ||
    reasonText.includes("name similarity")
  ) {
    return "direct";
  }

  if (linkedCoin.confidence >= 55) {
    return "inferred";
  }

  return "fallback";
}

function confidenceBandForMatch(
  matchType: "direct" | "inferred" | "fallback",
  matchScore: number,
) {
  if (matchType === "direct" && matchScore >= 70) {
    return "high";
  }
  if (matchType !== "fallback" && matchScore >= 55) {
    return "medium";
  }
  if (matchScore >= 40) {
    return "speculative";
  }
  return "coverage";
}

function normalizeStoredLinkedCoin(linkedCoin: NarrativeLinkedCoin) {
  const signals = asRecord(linkedCoin.rawMatchSignals);
  const matchType = inferStoredMatchType(linkedCoin);
  const matchScore = readSignalNumber(signals, "match_score") ?? linkedCoin.confidence;
  const matchReason =
    readSignalString(signals, "match_reason") ??
    linkedCoin.whyLinked ??
    (matchType === "direct"
      ? "Direct narrative match from stored trend-memecoin linking."
      : matchType === "inferred"
        ? "Stored inferred narrative match."
        : "Stored fallback narrative match.");
  const supportingKeywords = supportingKeywordsFromStoredCoin(linkedCoin);

  return {
    ...linkedCoin,
    confidence: Number.isFinite(matchScore) ? matchScore : linkedCoin.confidence,
    confidenceBand:
      linkedCoin.confidenceBand ??
      confidenceBandForMatch(
        matchType,
        Number.isFinite(matchScore) ? matchScore : linkedCoin.confidence,
      ),
    matchReasons: uniqueStrings([...(linkedCoin.matchReasons ?? []), matchReason]).slice(0, 5),
    rawMatchSignals: {
      ...(signals ?? {}),
      match_type: matchType,
      match_score: Number.isFinite(matchScore) ? matchScore : linkedCoin.confidence,
      match_reason: matchReason,
      supporting_keywords: supportingKeywords,
    },
  } satisfies NarrativeLinkedCoin;
}

function getLinkedCoinMatchType(linkedCoin: NarrativeLinkedCoin) {
  const signals = asRecord(linkedCoin.rawMatchSignals);
  const explicitType = readSignalString(signals, "match_type");
  if (
    explicitType === "direct" ||
    explicitType === "inferred" ||
    explicitType === "fallback"
  ) {
    return explicitType;
  }
  return inferStoredMatchType(linkedCoin);
}

function getLinkedCoinMatchScore(linkedCoin: NarrativeLinkedCoin) {
  const signals = asRecord(linkedCoin.rawMatchSignals);
  return readSignalNumber(signals, "match_score") ?? linkedCoin.confidence;
}

function getLinkedCoinSupportingKeywords(linkedCoin: NarrativeLinkedCoin) {
  return uniqueStrings([
    ...supportingKeywordsFromStoredCoin(linkedCoin),
    ...extractQuotedTerms([linkedCoin.whyLinked, ...(linkedCoin.matchReasons ?? [])]),
  ]).slice(0, 6);
}

function compareNarrativeLinkedCoins(left: NarrativeLinkedCoin, right: NarrativeLinkedCoin) {
  const priorityDelta =
    matchPriority(getLinkedCoinMatchType(right)) - matchPriority(getLinkedCoinMatchType(left));
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const scoreDelta = getLinkedCoinMatchScore(right) - getLinkedCoinMatchScore(left);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const volumeDelta = Number(right.volume ?? 0) - Number(left.volume ?? 0);
  if (volumeDelta !== 0) {
    return volumeDelta;
  }

  const liquidityDelta = Number(right.liquidity ?? 0) - Number(left.liquidity ?? 0);
  if (liquidityDelta !== 0) {
    return liquidityDelta;
  }

  return left.id.localeCompare(right.id);
}

function mergeNarrativeLinkedCoins(
  existing: NarrativeLinkedCoin,
  incoming: NarrativeLinkedCoin,
): NarrativeLinkedCoin {
  const preferred =
    compareNarrativeLinkedCoins(existing, incoming) <= 0 ? existing : incoming;
  const secondary = preferred === existing ? incoming : existing;
  const preferredSignals = asRecord(preferred.rawMatchSignals);
  const secondarySignals = asRecord(secondary.rawMatchSignals);

  return {
    ...preferred,
    confidence: Math.max(existing.confidence, incoming.confidence),
    confidenceBand:
      preferred.confidenceBand ??
      secondary.confidenceBand ??
      confidenceBandForMatch(
        getLinkedCoinMatchType(preferred),
        Math.max(existing.confidence, incoming.confidence),
      ),
    liquidity: preferred.liquidity ?? secondary.liquidity ?? null,
    volume: preferred.volume ?? secondary.volume ?? null,
    age: preferred.age ?? secondary.age ?? null,
    priceUsd: preferred.priceUsd ?? secondary.priceUsd ?? null,
    priceChange1hPct: preferred.priceChange1hPct ?? secondary.priceChange1hPct ?? null,
    priceChange6hPct: preferred.priceChange6hPct ?? secondary.priceChange6hPct ?? null,
    priceChange24hPct: preferred.priceChange24hPct ?? secondary.priceChange24hPct ?? null,
    marketCap: preferred.marketCap ?? secondary.marketCap ?? null,
    fdv: preferred.fdv ?? secondary.fdv ?? null,
    iconUrl: preferred.iconUrl ?? secondary.iconUrl ?? null,
    quoteSymbol: preferred.quoteSymbol ?? secondary.quoteSymbol ?? null,
    websites:
      (preferred.websites?.length ?? 0) > 0 ? preferred.websites : secondary.websites ?? null,
    socials:
      (preferred.socials?.length ?? 0) > 0 ? preferred.socials : secondary.socials ?? null,
    tradingviewSymbol: preferred.tradingviewSymbol ?? secondary.tradingviewSymbol ?? null,
    mentionCount: Math.max(preferred.mentionCount ?? 0, secondary.mentionCount ?? 0),
    engagementScore: Math.max(preferred.engagementScore ?? 0, secondary.engagementScore ?? 0),
    chainId: preferred.chainId ?? secondary.chainId ?? null,
    pairAddress: preferred.pairAddress ?? secondary.pairAddress ?? null,
    dexscreenerUrl: preferred.dexscreenerUrl ?? secondary.dexscreenerUrl ?? null,
    marketScore: preferred.marketScore ?? secondary.marketScore ?? null,
    memecoinFitScore: preferred.memecoinFitScore ?? secondary.memecoinFitScore ?? null,
    whyLinked: preferred.whyLinked ?? secondary.whyLinked ?? null,
    matchReasons: uniqueStrings([
      ...(preferred.matchReasons ?? []),
      ...(secondary.matchReasons ?? []),
    ]).slice(0, 6),
    rawMatchSignals: {
      ...(secondarySignals ?? {}),
      ...(preferredSignals ?? {}),
      match_type: getLinkedCoinMatchType(preferred),
      match_score: Math.max(getLinkedCoinMatchScore(existing), getLinkedCoinMatchScore(incoming)),
      match_reason: preferred.whyLinked ?? secondary.whyLinked ?? null,
      supporting_keywords: uniqueStrings([
        ...getLinkedCoinSupportingKeywords(preferred),
        ...getLinkedCoinSupportingKeywords(secondary),
      ]).slice(0, 6),
    },
    lastUpdatedAt: preferred.lastUpdatedAt ?? secondary.lastUpdatedAt,
  };
}

function compareHeuristicMatches(left: HeuristicNarrativeMatch, right: HeuristicNarrativeMatch) {
  const priorityDelta = matchPriority(right.matchType) - matchPriority(left.matchType);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const scoreDelta = right.matchScore - left.matchScore;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const supportDelta = right.supportPostCount - left.supportPostCount;
  if (supportDelta !== 0) {
    return supportDelta;
  }

  const interactionDelta = right.supportInteractionScore - left.supportInteractionScore;
  if (interactionDelta !== 0) {
    return interactionDelta;
  }

  const correlationDelta = right.correlationScore - left.correlationScore;
  if (correlationDelta !== 0) {
    return correlationDelta;
  }

  const volumeDelta = right.volume24hUsd - left.volume24hUsd;
  if (volumeDelta !== 0) {
    return volumeDelta;
  }

  return right.liquidityUsd - left.liquidityUsd;
}

function buildHeuristicNarrativeMatch(
  trend: RankedTrend,
  row: CorrelatedMemecoinRow,
): HeuristicNarrativeMatch | null {
  const trendProfile = buildTrendProfile(trend);
  const coinProfile = buildCoinProfile(row);
  const topicKeyMatch = coinProfile.topicKeys.has(trendProfile.topicKey);
  const exactKeywords = intersectStrings(trendProfile.tokens, coinProfile.tokens)
    .filter((token) => token.length >= 3)
    .slice(0, 5);
  const phraseOverlap = trendProfile.phrases
    .filter((phrase) => {
      const compactPhrase = compactIdentity(phrase);
      return (
        compactPhrase.length >= 3 &&
        (coinProfile.phraseKeys.has(compactPhrase) || coinProfile.text.includes(phrase))
      );
    })
    .slice(0, 4);
  const entityOverlap = trendProfile.entities
    .filter((entity) => {
      const compactEntity = compactIdentity(entity);
      const normalizedEntity = normalizeText(entity);
      return (
        compactEntity.length >= 3 &&
        (coinProfile.entityKeys.has(compactEntity) || coinProfile.text.includes(normalizedEntity))
      );
    })
    .slice(0, 4);
  const tagOverlap = uniqueStrings(
    trendProfile.tags.filter(
      (tag) => coinProfile.tags.includes(tag) || coinProfile.tokens.has(tag),
    ),
  ).slice(0, 3);
  const familyAffinity = resolveFamilyAffinity(trendProfile.families, coinProfile.families);
  const thematicTokensSource =
    coinProfile.summaryTokens.size > 0 ? coinProfile.summaryTokens : coinProfile.tokens;
  const thematicOverlap = intersectStrings(trendProfile.tokens, thematicTokensSource)
    .filter((token) => token.length >= 4 && !exactKeywords.includes(token))
    .slice(0, 5);
  const categoryExact = trendProfile.trendCategory
    ? coinProfile.categories.has(normalizeCategoryKey(trendProfile.trendCategory))
    : false;
  const summarySimilarity = jaccardSimilarity(trendProfile.tokens, thematicTokensSource);
  const directLink = (row.links ?? []).find((link) => link.topicKey === trendProfile.topicKey) ?? null;
  const supportPostCount = directLink?.supportPostCount ?? row.links?.[0]?.supportPostCount ?? 0;
  const supportInteractionScore =
    directLink?.supportInteractionScore ?? row.links?.[0]?.supportInteractionScore ?? 0;

  let directScore = 0;
  if (topicKeyMatch) {
    directScore += 68;
  }
  if (directLink?.isPrimary) {
    directScore += 12;
  }
  directScore += Math.min(30, exactKeywords.length * 10);
  directScore += Math.min(18, phraseOverlap.length * 9);
  directScore += Math.min(24, entityOverlap.length * 12);
  directScore += Math.min(16, tagOverlap.length * 8);
  if (categoryExact) {
    directScore += 8;
  }
  if (familyAffinity.shared.length > 0) {
    directScore += 6;
  }
  directScore = clamp(directScore, 0, 100);

  const narrativeEvidenceCount =
    familyAffinity.shared.length +
    thematicOverlap.length +
    tagOverlap.length +
    (familyAffinity.score > 0 ? 1 : 0) +
    (categoryExact ? 1 : 0);
  let narrativeScore = 0;
  if (narrativeEvidenceCount > 0) {
    narrativeScore += familyAffinity.score * 48;
    narrativeScore += Math.min(16, familyAffinity.shared.length * 8);
    narrativeScore += Math.min(20, thematicOverlap.length * 5);
    if (categoryExact) {
      narrativeScore += 10;
    }
    narrativeScore += Math.min(8, coinProfile.boardLinkCount * 2);
    narrativeScore += Math.min(18, summarySimilarity * 18);
    narrativeScore = clamp(narrativeScore, 0, 100);
  }

  const hasDirectEvidence =
    topicKeyMatch ||
    Boolean(directLink) ||
    entityOverlap.length > 0 ||
    phraseOverlap.length > 0 ||
    exactKeywords.length >= 2 ||
    tagOverlap.length > 0;
  const hasNarrativeEvidence =
    narrativeEvidenceCount > 0 &&
    (familyAffinity.score >= 0.35 || thematicOverlap.length > 0 || categoryExact);

  const matchType: "direct" | "inferred" | "fallback" | null =
    hasDirectEvidence && directScore >= DIRECT_MATCH_THRESHOLD
      ? "direct"
      : hasNarrativeEvidence && narrativeScore >= INFERRED_MATCH_THRESHOLD
        ? "inferred"
        : hasNarrativeEvidence && narrativeScore > 0
          ? "fallback"
          : null;

  if (!matchType) {
    return null;
  }

  const dominantFamily =
    familyAffinity.shared[0] ??
    familyAffinity.adjacent[0] ??
    trendProfile.families[0] ??
    coinProfile.families[0] ??
    null;
  const supportingKeywords = uniqueStrings([
    ...entityOverlap,
    ...phraseOverlap,
    ...exactKeywords,
    ...tagOverlap,
    ...thematicOverlap,
  ]).slice(0, 6);
  const reasons: string[] = [];
  if (topicKeyMatch || directLink) {
    reasons.push("same topic cluster");
  }
  if (entityOverlap.length > 0) {
    reasons.push(`same entity: ${entityOverlap[0]}`);
  }
  if (phraseOverlap.length > 0 && entityOverlap.length === 0) {
    reasons.push(`shared phrase: ${phraseOverlap[0]}`);
  }
  if (exactKeywords.length > 0 && phraseOverlap.length === 0) {
    reasons.push(`shared keyword: ${exactKeywords[0]}`);
  }
  if (tagOverlap.length > 0) {
    reasons.push(`shared tag: ${tagOverlap[0]}`);
  }
  if (familyAffinity.shared.length > 0) {
    reasons.push(`same ${familyLabel(familyAffinity.shared[0])} narrative`);
  } else if (dominantFamily && familyAffinity.score >= 0.45) {
    reasons.push(`adjacent ${familyLabel(dominantFamily)} narrative`);
  }
  if (thematicOverlap.length > 0 && exactKeywords.length === 0) {
    reasons.push(`summary overlap: ${thematicOverlap[0]}`);
  }
  if (reasons.length === 0 && dominantFamily) {
    reasons.push(`best ${familyLabel(dominantFamily)} narrative fit`);
  }

  const prefix =
    matchType === "direct"
      ? "Direct narrative match"
      : matchType === "inferred"
        ? "Inferred narrative fit"
        : "Fallback narrative fit";
  const matchScore = Math.round(
    clamp(matchType === "direct" ? directScore : narrativeScore, 0, 100),
  );
  const whyLinked = `${prefix}: ${reasons.slice(0, 3).join("; ")}.`;
  const rawMatchSignals = {
    match_type: matchType,
    match_score: matchScore,
    match_reason: whyLinked,
    supporting_keywords: supportingKeywords,
    topic_key_match: topicKeyMatch,
    direct_score: Math.round(directScore),
    narrative_score: Math.round(narrativeScore),
    category_match: categoryExact,
    summary_similarity: Number(summarySimilarity.toFixed(3)),
    exact_overlap_terms: exactKeywords,
    phrase_overlap_terms: phraseOverlap,
    entity_overlap_terms: entityOverlap,
    tag_overlap_terms: tagOverlap,
    shared_families: familyAffinity.shared,
    adjacent_families: familyAffinity.adjacent,
    support_post_count: supportPostCount,
    support_interaction_score: Number(supportInteractionScore.toFixed(3)),
    board_strongest_trend_key: row.strongestTrendKey,
    board_strongest_trend_category: row.strongestTrendCategory ?? null,
  } satisfies Record<string, unknown>;
  const linkedCoin: NarrativeLinkedCoin = {
    id: `${row.chainId}:${row.tokenAddress}`,
    symbol: row.symbol,
    name: row.name,
    address: row.tokenAddress,
    confidence: matchScore,
    confidenceBand: confidenceBandForMatch(matchType, matchScore),
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
    mentionCount: supportPostCount,
    engagementScore: supportInteractionScore,
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
    matchReasons: uniqueStrings([whyLinked, ...reasons]).slice(0, 6),
    rawMatchSignals,
    lastUpdatedAt: row.updatedAt,
  };

  return {
    linkedCoin,
    matchType,
    matchScore,
    supportPostCount,
    supportInteractionScore,
    correlationScore: row.correlationScore,
    volume24hUsd: Number(row.volume24hUsd ?? 0),
    liquidityUsd: Number(row.liquidityUsd ?? 0),
  };
}

function collectHeuristicNarrativeMatches(
  trend: RankedTrend,
  boardRows: CorrelatedMemecoinRow[],
) {
  return boardRows
    .map((row) => buildHeuristicNarrativeMatch(trend, row))
    .filter((match): match is HeuristicNarrativeMatch => Boolean(match))
    .sort(compareHeuristicMatches);
}

function resolveNarrativeLinkedCoins(
  trend: RankedTrend,
  persistedLinks: NarrativeLinkedCoin[],
  boardRows: CorrelatedMemecoinRow[],
) {
  const resolvedById = new Map<string, NarrativeLinkedCoin>();
  const normalizedPersisted = persistedLinks.map((linkedCoin) =>
    normalizeStoredLinkedCoin(linkedCoin),
  );

  normalizedPersisted.forEach((linkedCoin) => {
    resolvedById.set(linkedCoin.id, linkedCoin);
  });

  const heuristicMatches = collectHeuristicNarrativeMatches(trend, boardRows);
  const directBoardCoins = heuristicMatches
    .filter((match) => match.matchType === "direct")
    .slice(0, MAX_LINKS_PER_TREND)
    .map((match) => match.linkedCoin);

  directBoardCoins.forEach((linkedCoin) => {
    const existing = resolvedById.get(linkedCoin.id);
    resolvedById.set(
      linkedCoin.id,
      existing ? mergeNarrativeLinkedCoins(existing, linkedCoin) : linkedCoin,
    );
  });

  if (resolvedById.size === 0) {
    const bestHeuristic = heuristicMatches[0]?.linkedCoin ?? null;
    if (bestHeuristic) {
      resolvedById.set(bestHeuristic.id, bestHeuristic);
    }
  }

  return [...resolvedById.values()]
    .sort(compareNarrativeLinkedCoins)
    .slice(0, MAX_LINKS_PER_TREND);
}

function attachLinksToRow(
  row: RankedTrend,
  linkedCoinsByTopic: Map<string, NarrativeLinkedCoin[]>,
): RankedTrend {
  const topicKey = getTrendTopicKey(row);
  return {
    ...row,
    linkedCoins: topicKey ? linkedCoinsByTopic.get(topicKey) ?? [] : [],
  };
}

export async function attachTrendMemecoinLinks(
  state: TrendDashboardVM,
  correlatedMemecoins?: CorrelatedMemecoinBoard | null,
): Promise<TrendDashboardVM> {
  const allRows = [
    ...state.leaderboard,
    ...state.leaderboards.established,
    ...state.leaderboards.emerging,
    ...(state.detail?.trend ? [state.detail.trend] : []),
  ];
  const [linkedCoinsByTopic, correlatedBoard] = await Promise.all([
    fetchTrendMemecoinLinks(dedupeTopicKeys(allRows)),
    correlatedMemecoins === undefined
      ? fetchLatestCorrelatedMemecoinBoard()
      : Promise.resolve(correlatedMemecoins),
  ]);
  const boardRows = correlatedBoard?.rows ?? state.correlatedMemecoins?.rows ?? [];
  const resolvedByTopic = new Map<string, NarrativeLinkedCoin[]>();
  let fallbackTopicCount = 0;

  allRows.forEach((row) => {
    const topicKey = getTrendTopicKey(row);
    if (!topicKey || resolvedByTopic.has(topicKey)) {
      return;
    }

    const resolvedLinks = resolveNarrativeLinkedCoins(
      row,
      linkedCoinsByTopic.get(topicKey) ?? [],
      boardRows,
    );
    const topLink = resolvedLinks[0] ?? null;
    const topMatchType = topLink ? getLinkedCoinMatchType(topLink) : null;
    if (resolvedLinks.length > 0 && topMatchType === "fallback") {
      fallbackTopicCount += 1;
    }
    resolvedByTopic.set(topicKey, resolvedLinks);
  });

  if (fallbackTopicCount > 0) {
    console.info("[trend-memecoin-links] filled narrative coverage from correlated board", {
      topic_count: resolvedByTopic.size,
      fallback_topic_count: fallbackTopicCount,
      board_row_count: boardRows.length,
    });
  }

  return {
    ...state,
    correlatedMemecoins: correlatedBoard ?? state.correlatedMemecoins ?? null,
    leaderboards: {
      established: state.leaderboards.established.map((row) => attachLinksToRow(row, resolvedByTopic)),
      emerging: state.leaderboards.emerging.map((row) => attachLinksToRow(row, resolvedByTopic)),
    },
    leaderboard: state.leaderboard.map((row) => attachLinksToRow(row, resolvedByTopic)),
    detail: state.detail
      ? {
          ...state.detail,
          trend: attachLinksToRow(state.detail.trend, resolvedByTopic),
        }
      : null,
  };
}
