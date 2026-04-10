import { describe, expect, it } from "vitest";
import {
  getHighConfidenceMemecoinCount,
  getMemecoinConfidenceScore,
  getMemecoinConfidenceTier,
  getMemecoinRiskTag,
  getNarrativeCoinOpportunities,
  getNarrativeLinkedCoinCount,
} from "@/lib/dashboard/memecoin-opportunities";
import { CorrelatedMemecoinRow, RankedTrend } from "@/types/view-models";

function makeNarrative(id: string, name: string): RankedTrend {
  return {
    id,
    rank: 1,
    name,
    displayName: name,
    nameStatus: "ready",
    nameSource: "ai_exact",
    trendRawLabel: name,
    trendKeyEntities: ["frog", "solana", "pepe"],
    scope: "overall",
    leaderboardMode: "established",
    attentionScore: 100,
    attentionInteractions: 100,
    confidenceScore: 80,
    freshnessScore: 92,
    freshnessState: "fresh",
    sampleSize: 100,
    supportingThreadCount: 10,
    lowDataWarning: false,
    growthRate: 21,
    attentionAcceleration: 16,
    mentions: 100,
    platforms: ["bluesky", "reddit"],
    platformSpread: 2,
    confirmedPlatformSpread: 2,
    attentionHistory: [],
    platformBreakdown: [],
    topPosts: [],
    lifecycleStage: "Expanding",
    originPlatform: "bluesky",
    platformMigrationPath: ["bluesky", "reddit"],
    attentionDrivers: [],
    hasSpike: false,
    clusterId: id,
    clusterName: name,
    trendStrengthScore: 90,
    persistenceScore: 75,
    isEarlyTrend: false,
    positionChange24h: 3,
    googleSearchInterest: null,
  } as RankedTrend;
}

function makeCoin(
  overrides: Partial<CorrelatedMemecoinRow> & Pick<CorrelatedMemecoinRow, "id" | "name" | "symbol" | "correlationScore">,
): CorrelatedMemecoinRow {
  return {
    id: overrides.id,
    rank: overrides.rank ?? 1,
    chainId: "solana",
    chainLabel: "Solana",
    tokenAddress: overrides.tokenAddress ?? `${overrides.id}-token`,
    pairAddress: overrides.pairAddress ?? `${overrides.id}-pair`,
    name: overrides.name,
    symbol: overrides.symbol,
    strongestTrendKey: overrides.strongestTrendKey ?? "trend-frog",
    strongestTrendLabel: overrides.strongestTrendLabel ?? "Frog Rotation",
    strongestTrendCategory: overrides.strongestTrendCategory ?? "meme",
    strongestTrendSummary: overrides.strongestTrendSummary ?? "Frog memes are accelerating.",
    correlationScore: overrides.correlationScore,
    correlationLabel: overrides.correlationLabel ?? "High",
    marketScore: overrides.marketScore ?? 76,
    liquidityUsd: overrides.liquidityUsd ?? 280_000,
    volume24hUsd: overrides.volume24hUsd ?? 1_400_000,
    priceUsd: overrides.priceUsd ?? 0.001,
    priceChange24hPct: overrides.priceChange24hPct ?? 14,
    pairAgeHours: overrides.pairAgeHours ?? 42,
    fdvUsd: overrides.fdvUsd ?? 4_000_000,
    marketCapUsd: overrides.marketCapUsd ?? 3_500_000,
    memecoinFitScore: overrides.memecoinFitScore ?? 74,
    seedTerms: overrides.seedTerms ?? ["frog", "solana"],
    discoverySources: overrides.discoverySources ?? ["trend_seed_search"],
    matchedTrendKeys: overrides.matchedTrendKeys ?? ["trend-frog"],
    communityTakeover: overrides.communityTakeover ?? true,
    links: overrides.links ?? [
      {
        topicKey: "trend-frog",
        topicLabel: "Frog Rotation",
        trendCategory: "meme",
        narrativeSummary: "Frog memes are accelerating.",
        lexicalScore: 17,
        mentionScore: 8,
        timingScore: 9,
        cultureFitScore: 8,
        linkScore: 36,
        supportPostCount: 3,
        supportInteractionScore: 14,
        isPrimary: true,
      },
    ],
    dexscreenerUrl: overrides.dexscreenerUrl ?? `https://dexscreener.com/solana/${overrides.id}-pair`,
    updatedAt: overrides.updatedAt ?? "2026-04-05T10:00:00.000Z",
  };
}

describe("memecoin opportunity ranking", () => {
  const narrative = makeNarrative("trend-frog", "Frog Rotation");

  it("counts coins linked to the selected narrative across primary and secondary links", () => {
    const rows = [
      makeCoin({
        id: "frog-1",
        name: "Frog CTO",
        symbol: "FROG",
        correlationScore: 88,
      }),
      makeCoin({
        id: "frog-2",
        name: "Pepe Rotor",
        symbol: "ROTOR",
        correlationScore: 80,
        strongestTrendKey: "other-trend",
        links: [
          {
            topicKey: "other-trend",
            topicLabel: "Other Trend",
            trendCategory: "meme",
            narrativeSummary: "Other trend summary",
            lexicalScore: 10,
            mentionScore: 4,
            timingScore: 4,
            cultureFitScore: 4,
            linkScore: 22,
            supportPostCount: 1,
            supportInteractionScore: 6,
            isPrimary: true,
          },
          {
            topicKey: "trend-frog",
            topicLabel: "Frog Rotation",
            trendCategory: "meme",
            narrativeSummary: "Frog rotation summary",
            lexicalScore: 13,
            mentionScore: 7,
            timingScore: 8,
            cultureFitScore: 8,
            linkScore: 31,
            supportPostCount: 2,
            supportInteractionScore: 10,
            isPrimary: false,
          },
        ],
      }),
    ];

    expect(getNarrativeLinkedCoinCount(rows, narrative.id)).toBe(2);
  });

  it("prefers stored per-narrative linked coins when they are attached to the trend row", () => {
    const narrativeWithLinkedCoins = {
      ...narrative,
      linkedCoins: [
        {
          id: "solana:frog-coin",
          symbol: "FROG",
          name: "Frog CTO",
          address: "frog-coin",
          confidence: 92,
          liquidity: 240_000,
          volume: 1_100_000,
          age: 18,
          mentionCount: 3,
          engagementScore: 12,
          dexscreenerUrl: "https://dexscreener.com/solana/frog-pair",
          lastUpdatedAt: "2026-04-07T10:00:00.000Z",
        },
        {
          id: "solana:pepe-coin",
          symbol: "PEPE",
          name: "Pepe Rotor",
          address: "pepe-coin",
          confidence: 81,
          liquidity: 180_000,
          volume: 780_000,
          age: 42,
          mentionCount: 2,
          engagementScore: 8,
          dexscreenerUrl: "https://dexscreener.com/solana/pepe-pair",
          lastUpdatedAt: "2026-04-07T10:00:00.000Z",
        },
      ],
    } satisfies RankedTrend;

    const opportunities = getNarrativeCoinOpportunities(narrativeWithLinkedCoins, []);

    expect(opportunities.map((item) => item.row.symbol)).toEqual(["FROG", "PEPE"]);
    expect(opportunities[0]?.confidenceScore).toBe(92);
    expect(opportunities[0]?.activeLink?.supportPostCount).toBe(3);
  });

  it("includes all correlated market rows for the selected trend even when stored linked coins exist", () => {
    const narrativeWithLinkedCoins = {
      ...narrative,
      linkedCoins: [
        {
          id: "solana:frog-coin",
          symbol: "FROG",
          name: "Frog CTO",
          address: "frog-coin",
          confidence: 92,
          liquidity: 240_000,
          volume: 1_100_000,
          age: 18,
          mentionCount: 3,
          engagementScore: 12,
          dexscreenerUrl: "https://dexscreener.com/solana/frog-pair",
          lastUpdatedAt: "2026-04-07T10:00:00.000Z",
        },
      ],
    } satisfies RankedTrend;

    const rows = [
      makeCoin({
        id: "frog-market",
        name: "Frog CTO",
        symbol: "FROG",
        tokenAddress: "frog-coin",
        pairAddress: "frog-pair",
        correlationScore: 88,
        dexscreenerUrl: "https://dexscreener.com/solana/frog-pair",
      }),
      makeCoin({
        id: "pepe-market",
        name: "Pepe Rotor",
        symbol: "PEPE",
        correlationScore: 81,
        tokenAddress: "pepe-coin",
        pairAddress: "pepe-pair",
        dexscreenerUrl: "https://dexscreener.com/solana/pepe-pair",
      }),
    ];

    const opportunities = getNarrativeCoinOpportunities(narrativeWithLinkedCoins, rows);

    expect(opportunities.map((item) => item.row.symbol)).toEqual(["FROG", "PEPE"]);
    expect(opportunities[0]?.row.tokenAddress).toBe("frog-coin");
    expect(opportunities[1]?.row.tokenAddress).toBe("pepe-coin");
  });

  it("applies harsh confidence tiers instead of inflating everything to high", () => {
    const strongCoin = makeCoin({
      id: "frog-strong",
      name: "Frog CTO",
      symbol: "FROG",
      correlationScore: 91,
    });
    const speculativeCoin = makeCoin({
      id: "frog-thin",
      name: "Thin Frog",
      symbol: "THIN",
      correlationScore: 84,
      liquidityUsd: 42_000,
      volume24hUsd: 80_000,
      pairAgeHours: 5,
      links: [
        {
          topicKey: "trend-frog",
          topicLabel: "Frog Rotation",
          trendCategory: "meme",
          narrativeSummary: "Frog rotation summary",
          lexicalScore: 8,
          mentionScore: 3,
          timingScore: 2,
          cultureFitScore: 4,
          linkScore: 16,
          supportPostCount: 0,
          supportInteractionScore: 0,
          isPrimary: true,
        },
      ],
    });

    const strongScore = getMemecoinConfidenceScore(strongCoin, narrative.id);
    const speculativeScore = getMemecoinConfidenceScore(speculativeCoin, narrative.id);

    expect(strongScore).toBeGreaterThanOrEqual(85);
    expect(getMemecoinConfidenceTier(strongScore)).toBe("high");
    expect(speculativeScore).toBeLessThan(65);
    expect(getMemecoinConfidenceTier(speculativeScore)).toBe("coverage");
  });

  it("assigns clear risk tags for new, thin, stale, and strong setups", () => {
    const newCoin = makeCoin({
      id: "new-frog",
      name: "New Frog",
      symbol: "NEW",
      correlationScore: 77,
      pairAgeHours: 2,
    });
    const thinCoin = makeCoin({
      id: "thin-frog",
      name: "Thin Frog",
      symbol: "THIN",
      correlationScore: 77,
      liquidityUsd: 45_000,
      volume24hUsd: 90_000,
    });
    const staleCoin = makeCoin({
      id: "stale-frog",
      name: "Stale Frog",
      symbol: "STALE",
      correlationScore: 77,
      pairAgeHours: 240,
    });
    const strongCoin = makeCoin({
      id: "strong-frog",
      name: "Strong Frog",
      symbol: "STRONG",
      correlationScore: 92,
      pairAgeHours: 36,
    });

    expect(getMemecoinRiskTag(newCoin, getMemecoinConfidenceScore(newCoin, narrative.id), newCoin.links?.[0] ?? null)).toBe("NEW");
    expect(getMemecoinRiskTag(thinCoin, getMemecoinConfidenceScore(thinCoin, narrative.id), thinCoin.links?.[0] ?? null)).toBe("THIN");
    expect(getMemecoinRiskTag(staleCoin, getMemecoinConfidenceScore(staleCoin, narrative.id), staleCoin.links?.[0] ?? null)).toBe("STALE");
    expect(getMemecoinRiskTag(strongCoin, getMemecoinConfidenceScore(strongCoin, narrative.id), strongCoin.links?.[0] ?? null)).toBe("STRONG");
  });

  it("sorts opportunities by selected-narrative action quality", () => {
    const rows = [
      makeCoin({
        id: "alpha",
        name: "Alpha Frog",
        symbol: "ALPHA",
        correlationScore: 88,
      }),
      makeCoin({
        id: "beta",
        name: "Beta Frog",
        symbol: "BETA",
        correlationScore: 79,
        liquidityUsd: 75_000,
        volume24hUsd: 180_000,
      }),
    ];

    const opportunities = getNarrativeCoinOpportunities(narrative, rows);

    expect(opportunities.map((item) => item.row.symbol)).toEqual(["ALPHA", "BETA"]);
    expect(getHighConfidenceMemecoinCount(rows)).toBe(1);
  });

  it("does not surface fallback ghost rows that have no real narrative link", () => {
    const rows = [
      makeCoin({
        id: "ghost-row",
        name: "Ghost Coin",
        symbol: "GHOST",
        correlationScore: 72,
        strongestTrendKey: narrative.id,
        strongestTrendLabel: narrative.displayName ?? narrative.name,
        links: [],
      }),
    ];

    const opportunities = getNarrativeCoinOpportunities(narrative, rows);

    expect(opportunities).toHaveLength(0);
  });
});
