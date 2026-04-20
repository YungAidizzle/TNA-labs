import { describe, expect, it } from "vitest";
import { buildTrendsPageMemecoinDatasets } from "@/lib/dashboard/trends-page-memecoin-selectors";
import { createZeroRankedTrend } from "@/lib/dashboard/zero-state";
import type { CorrelatedMemecoinRow, NarrativeLinkedCoin, RankedTrend } from "@/types/view-models";

function makeTrend(
  topicKey: string,
  label: string,
  linkedCoins: NarrativeLinkedCoin[] = [],
): RankedTrend {
  const row = createZeroRankedTrend("overall", "24h");

  return {
    ...row,
    id: `trend:${topicKey}`,
    name: label,
    displayName: label,
    nameStatus: "ready",
    nameSource: "ai_exact",
    canonicalKeySummary: topicKey,
    trendRawLabel: label,
    trendFallbackLabel: label,
    trendNarrativeSummary: `${label} summary`,
    trendContextParagraph: `${label} context`,
    trendDescription: `${label} description`,
    linkedCoins,
  };
}

function makeRow(
  overrides: Partial<CorrelatedMemecoinRow> &
    Pick<CorrelatedMemecoinRow, "id" | "name" | "symbol" | "correlationScore">,
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
    quoteSymbol: overrides.quoteSymbol ?? "USDC",
    strongestTrendKey: overrides.strongestTrendKey ?? "trend-frog",
    strongestTrendLabel: overrides.strongestTrendLabel ?? "Frog Rotation",
    strongestTrendCategory: overrides.strongestTrendCategory ?? "meme",
    strongestTrendSummary: overrides.strongestTrendSummary ?? "Frog summary",
    correlationScore: overrides.correlationScore,
    correlationLabel: overrides.correlationLabel ?? "High",
    marketScore: overrides.marketScore ?? 76,
    liquidityUsd: overrides.liquidityUsd ?? 220_000,
    volume24hUsd: overrides.volume24hUsd ?? 900_000,
    volume6hUsd: overrides.volume6hUsd ?? 320_000,
    volume1hUsd: overrides.volume1hUsd ?? 95_000,
    priceUsd: overrides.priceUsd ?? 0.001,
    priceChange1hPct: overrides.priceChange1hPct ?? 4,
    priceChange6hPct: overrides.priceChange6hPct ?? 12,
    priceChange24hPct: overrides.priceChange24hPct ?? 18,
    pairAgeHours: overrides.pairAgeHours ?? 48,
    txns24h: overrides.txns24h ?? 3200,
    txns6h: overrides.txns6h ?? 900,
    txns1h: overrides.txns1h ?? 180,
    momentumScore: overrides.momentumScore ?? 62,
    momentumRank: overrides.momentumRank ?? overrides.rank ?? 1,
    fdvUsd: overrides.fdvUsd ?? 4_000_000,
    marketCapUsd: overrides.marketCapUsd ?? 3_800_000,
    seedTerms: overrides.seedTerms ?? [],
    matchedTrendKeys: overrides.matchedTrendKeys ?? [],
    links: overrides.links ?? [],
    dexscreenerUrl: overrides.dexscreenerUrl ?? `https://dexscreener.com/solana/${overrides.id}-pair`,
    updatedAt: overrides.updatedAt ?? "2026-04-15T10:00:00.000Z",
  };
}

function makeLinkedCoin(
  topicKey: string,
  label: string,
  row: CorrelatedMemecoinRow,
  confidence: number,
): NarrativeLinkedCoin {
  return {
    id: `${row.chainId}:${row.tokenAddress}`,
    symbol: row.symbol,
    name: row.name,
    address: row.tokenAddress,
    confidence,
    confidenceBand: confidence >= 90 ? "high" : "medium",
    liquidity: row.liquidityUsd ?? null,
    volume: row.volume24hUsd ?? null,
    age: row.pairAgeHours ?? null,
    priceUsd: row.priceUsd ?? null,
    priceChange1hPct: row.priceChange1hPct ?? null,
    priceChange6hPct: row.priceChange6hPct ?? null,
    priceChange24hPct: row.priceChange24hPct ?? null,
    marketCap: row.marketCapUsd ?? null,
    fdv: row.fdvUsd ?? null,
    quoteSymbol: row.quoteSymbol ?? null,
    chainId: row.chainId,
    pairAddress: row.pairAddress,
    dexscreenerUrl: row.dexscreenerUrl,
    marketScore: row.marketScore ?? null,
    whyLinked: `Stored DexScreener search match for ${label}.`,
    matchReasons: [`Stored DexScreener search match for ${label}.`],
    rawMatchSignals: {
      match_type: "dexscreener_search",
      trend_topic_key: topicKey,
    },
    lastUpdatedAt: row.updatedAt,
  };
}

describe("trends page memecoin selectors", () => {
  const strictRows = [
    makeRow({
      id: "frog-row",
      name: "Frog CTO",
      symbol: "FROG",
      rank: 1,
      correlationScore: 92,
      strongestTrendKey: "trend-frog",
      strongestTrendLabel: "Frog Rotation",
      matchedTrendKeys: ["trend-frog"],
      links: [
        {
          topicKey: "trend-frog",
          topicLabel: "Frog Rotation",
          trendCategory: "meme",
          narrativeSummary: "Frog summary",
          lexicalScore: 18,
          mentionScore: 9,
          timingScore: 8,
          cultureFitScore: 9,
          linkScore: 38,
          supportPostCount: 3,
          supportInteractionScore: 12,
          isPrimary: true,
        },
      ],
    }),
    makeRow({
      id: "anime-row",
      name: "Anime Velocity",
      symbol: "ANIME",
      rank: 2,
      correlationScore: 81,
      strongestTrendKey: "trend-frog",
      strongestTrendLabel: "Frog Rotation",
      matchedTrendKeys: ["trend-frog"],
      links: [
        {
          topicKey: "trend-frog",
          topicLabel: "Frog Rotation",
          trendCategory: "culture",
          narrativeSummary: "Frog summary",
          lexicalScore: 13,
          mentionScore: 5,
          timingScore: 5,
          cultureFitScore: 7,
          linkScore: 25,
          supportPostCount: 1,
          supportInteractionScore: 7,
          isPrimary: true,
        },
      ],
    }),
    makeRow({
      id: "frog-board-only",
      name: "Broad Frog Beta",
      symbol: "BETA",
      rank: 4,
      correlationScore: 74,
      strongestTrendKey: "trend-frog",
      strongestTrendLabel: "Frog Rotation",
      matchedTrendKeys: ["trend-frog"],
      links: [
        {
          topicKey: "trend-frog",
          topicLabel: "Frog Rotation",
          trendCategory: "meme",
          narrativeSummary: "Frog summary",
          lexicalScore: 11,
          mentionScore: 4,
          timingScore: 4,
          cultureFitScore: 5,
          linkScore: 21,
          supportPostCount: 1,
          supportInteractionScore: 5,
          isPrimary: true,
        },
      ],
    }),
    makeRow({
      id: "trump-row",
      name: "Trump Coin",
      symbol: "TRUMP",
      rank: 3,
      correlationScore: 77,
      strongestTrendKey: "trend-maga",
      strongestTrendLabel: "MAGA Meme Cycle",
      matchedTrendKeys: ["trend-maga"],
      links: [
        {
          topicKey: "trend-maga",
          topicLabel: "MAGA Meme Cycle",
          trendCategory: "culture",
          narrativeSummary: "MAGA summary",
          lexicalScore: 15,
          mentionScore: 6,
          timingScore: 6,
          cultureFitScore: 6,
          linkScore: 31,
          supportPostCount: 2,
          supportInteractionScore: 11,
          isPrimary: true,
        },
      ],
    }),
  ];

  const marketRows = [
    ...strictRows,
    makeRow({
      id: "speed-row",
      name: "Speed Dog",
      symbol: "SPEED",
      rank: 4,
      correlationScore: 41,
      strongestTrendKey: "unknown-trend",
      strongestTrendLabel: "Unknown",
      matchedTrendKeys: [],
      links: [],
      volume24hUsd: 1_500_000,
      volume6hUsd: 520_000,
      volume1hUsd: 210_000,
      txns24h: 4800,
      txns6h: 1500,
      txns1h: 360,
      momentumScore: 89,
      momentumRank: 1,
    }),
  ];

  const frogTrend = makeTrend("trend-frog", "Frog Rotation", [
    makeLinkedCoin("trend-frog", "Frog Rotation", strictRows[0]!, 95),
    makeLinkedCoin("trend-frog", "Frog Rotation", strictRows[1]!, 84),
  ]);
  const magaTrend = makeTrend("trend-maga", "MAGA Meme Cycle", [
    makeLinkedCoin("trend-maga", "MAGA Meme Cycle", strictRows[3]!, 88),
  ]);

  it("keeps the trend tab scoped to the selected trend only", () => {
    const datasets = buildTrendsPageMemecoinDatasets({
      selectedTrend: frogTrend,
      trends: [frogTrend, magaTrend],
      correlatedRows: strictRows,
      marketRows,
    });

    expect(datasets.trendRows.map((row) => row.row.symbol)).toEqual(["FROG", "ANIME"]);
    expect(datasets.trendRows.every((row) => row.activeLink?.topicKey === "trend-frog")).toBe(true);
    expect(datasets.trendRows.some((row) => row.row.symbol === "BETA")).toBe(false);
  });

  it("aggregates the all tab across active trends without reusing the selected trend link", () => {
    const datasets = buildTrendsPageMemecoinDatasets({
      selectedTrend: frogTrend,
      trends: [frogTrend, magaTrend],
      correlatedRows: strictRows,
      marketRows,
    });

    expect(datasets.allRows.map((row) => row.row.symbol)).toEqual(["FROG", "TRUMP", "ANIME"]);
    expect(datasets.allRows.find((row) => row.row.symbol === "TRUMP")?.activeLink?.topicKey).toBe("trend-maga");
    expect(datasets.allRows.some((row) => row.row.symbol === "BETA")).toBe(false);
  });

  it("keeps momentum fully independent from trend selection and includes the full market board", () => {
    const frogSelection = buildTrendsPageMemecoinDatasets({
      selectedTrend: frogTrend,
      trends: [frogTrend, magaTrend],
      correlatedRows: strictRows,
      marketRows,
    });
    const magaSelection = buildTrendsPageMemecoinDatasets({
      selectedTrend: magaTrend,
      trends: [frogTrend, magaTrend],
      correlatedRows: strictRows,
      marketRows,
    });

    expect(frogSelection.momentumRows.map((row) => row.row.symbol)).toEqual([
      "SPEED",
      "FROG",
      "ANIME",
      "TRUMP",
      "BETA",
    ]);
    expect(magaSelection.momentumRows.map((row) => row.row.symbol)).toEqual([
      "SPEED",
      "FROG",
      "ANIME",
      "TRUMP",
      "BETA",
    ]);
  });

  it("keeps momentum populated even when no trend is selected and no correlated rows are available", () => {
    const datasets = buildTrendsPageMemecoinDatasets({
      selectedTrend: null,
      trends: [],
      correlatedRows: [],
      marketRows,
    });

    expect(datasets.trendRows).toEqual([]);
    expect(datasets.allRows).toEqual([]);
    expect(datasets.momentumRows.map((row) => row.row.symbol)).toEqual([
      "SPEED",
      "FROG",
      "ANIME",
      "TRUMP",
      "BETA",
    ]);
  });
});
