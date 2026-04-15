import { describe, expect, it } from "vitest";
import {
  buildStrictTrendsPageBoardMatch,
  buildStrictTrendsPageCorrelatedBoard,
  strictifyTrendsPageLinkedCoin,
} from "@/lib/dashboard/trends-page-memecoin-matcher";
import { createZeroRankedTrend, createZeroTrendDashboardVM } from "@/lib/dashboard/zero-state";
import { CorrelatedMemecoinBoard, CorrelatedMemecoinRow, NarrativeLinkedCoin, RankedTrend } from "@/types/view-models";

function makeTrend(params: {
  topicKey: string;
  label: string;
  rawLabel?: string;
  category?: string;
  entities?: string[];
  summary?: string;
}) {
  const row = createZeroRankedTrend("overall", "24h");

  return {
    ...row,
    id: `trend:${params.topicKey}`,
    name: params.label,
    displayName: params.label,
    nameStatus: "ready",
    nameSource: "ai_exact",
    trendRawLabel: params.rawLabel ?? params.label,
    trendFallbackLabel: params.rawLabel ?? params.label,
    canonicalKeySummary: params.topicKey,
    trendCategory: params.category ?? "culture",
    trendKeyEntities: params.entities ?? [params.label],
    trendNarrativeSummary: params.summary ?? params.label,
    trendDescription: params.summary ?? params.label,
    trendContextParagraph: params.summary ?? params.label,
  } satisfies RankedTrend;
}

function makeBoardRow(
  overrides: Partial<CorrelatedMemecoinRow> & Pick<CorrelatedMemecoinRow, "id" | "name" | "symbol">,
) {
  return {
    id: overrides.id,
    rank: overrides.rank ?? 1,
    chainId: "solana",
    chainLabel: "Solana",
    tokenAddress: overrides.tokenAddress ?? `${overrides.id}-token`,
    pairAddress: overrides.pairAddress ?? `${overrides.id}-pair`,
    name: overrides.name,
    symbol: overrides.symbol,
    strongestTrendKey: overrides.strongestTrendKey ?? "other-trend",
    strongestTrendLabel: overrides.strongestTrendLabel ?? "Other Trend",
    strongestTrendCategory: overrides.strongestTrendCategory ?? "culture",
    strongestTrendSummary: overrides.strongestTrendSummary ?? "Other summary",
    correlationScore: overrides.correlationScore ?? 78,
    correlationLabel: overrides.correlationLabel ?? "High",
    marketScore: overrides.marketScore ?? 70,
    liquidityUsd: overrides.liquidityUsd ?? 180_000,
    volume24hUsd: overrides.volume24hUsd ?? 750_000,
    priceUsd: overrides.priceUsd ?? 0.0012,
    priceChange1hPct: overrides.priceChange1hPct ?? 2.1,
    priceChange6hPct: overrides.priceChange6hPct ?? 8.4,
    priceChange24hPct: overrides.priceChange24hPct ?? 16.8,
    pairAgeHours: overrides.pairAgeHours ?? 36,
    marketCapUsd: overrides.marketCapUsd ?? 4_200_000,
    fdvUsd: overrides.fdvUsd ?? 4_500_000,
    pairLabels: overrides.pairLabels ?? [],
    seedTerms: overrides.seedTerms ?? [],
    websites: overrides.websites ?? [],
    socials: overrides.socials ?? [],
    links: overrides.links ?? [],
    dexscreenerUrl: overrides.dexscreenerUrl ?? `https://dexscreener.com/solana/${overrides.id}-pair`,
    updatedAt: overrides.updatedAt ?? "2026-04-15T10:00:00.000Z",
  } satisfies CorrelatedMemecoinRow;
}

describe("trends page memecoin matcher", () => {
  it("accepts direct same-name matches after normalization and suffix cleanup", () => {
    const trend = makeTrend({
      topicKey: "maga",
      label: "MAGA!!!",
      rawLabel: "MAGA",
      category: "politics",
    });
    const row = makeBoardRow({
      id: "maga-coin",
      name: "MAGA Coin",
      symbol: "MAGA",
    });

    const match = buildStrictTrendsPageBoardMatch(trend, row);

    expect(match?.matchScore).toBeGreaterThanOrEqual(90);
    expect(match?.link.rawMatchSignals).toMatchObject({
      strict_trends_page_match: true,
      trends_page_match_type: expect.stringMatching(/core_name|suffix_name|exact_name|compact_name/),
    });
  });

  it("accepts distinctive one-token name matches but rejects generic one-token overlaps", () => {
    const openAiTrend = makeTrend({
      topicKey: "openai-media-push",
      label: "OpenAI Media Push",
      category: "ai",
      entities: ["OpenAI"],
    });
    const openAiRow = makeBoardRow({
      id: "openai-dog",
      name: "OpenAI Dog",
      symbol: "DOG",
    });

    const bitcoinTrend = makeTrend({
      topicKey: "spot-bitcoin-etf-inflows",
      label: "Spot Bitcoin ETF Inflows",
      category: "crypto",
      entities: ["Bitcoin ETF"],
    });
    const bitcoinRow = makeBoardRow({
      id: "bitcoin-dog",
      name: "Bitcoin Dog",
      symbol: "BTDOG",
    });

    expect(buildStrictTrendsPageBoardMatch(openAiTrend, openAiRow)?.matchScore).toBeGreaterThanOrEqual(
      82,
    );
    expect(buildStrictTrendsPageBoardMatch(bitcoinTrend, bitcoinRow)).toBeNull();
  });

  it("accepts ticker matches only when the trend text explicitly supports the ticker", () => {
    const explicitTickerTrend = makeTrend({
      topicKey: "trump",
      label: "$TRUMP moves higher",
      category: "politics",
      entities: ["TRUMP"],
    });
    const unsupportedTickerTrend = makeTrend({
      topicKey: "united-states-crypto-reserve",
      label: "United States Crypto Reserve",
      category: "policy",
    });
    const row = makeBoardRow({
      id: "trump-row",
      name: "Patriot Coin",
      symbol: "TRUMP",
    });
    const unsupportedRow = makeBoardRow({
      id: "uscr-row",
      name: "Reserve Coin",
      symbol: "USCR",
    });

    expect(buildStrictTrendsPageBoardMatch(explicitTickerTrend, row)?.matchScore).toBeGreaterThanOrEqual(
      90,
    );
    expect(buildStrictTrendsPageBoardMatch(unsupportedTickerTrend, unsupportedRow)).toBeNull();
  });

  it("accepts alias and slug matches when the alias is clearly meaningful", () => {
    const trend = makeTrend({
      topicKey: "taylor-swift-media-spiral",
      label: "Taylor Swift Media Spiral",
      category: "entertainment",
      entities: ["Taylor Swift"],
    });
    const row = makeBoardRow({
      id: "swift-clip",
      name: "Clip Coin",
      symbol: "CLIP",
      socials: [{ type: "twitter", url: "https://x.com/swift_clip" }],
    });

    const match = buildStrictTrendsPageBoardMatch(trend, row);

    expect(match?.matchScore).toBeGreaterThanOrEqual(82);
    expect(match?.link.rawMatchSignals).toMatchObject({
      matched_alias_source: "external_alias",
    });
  });

  it("rejects generic reserve-style narratives when no direct name evidence exists", () => {
    const trend = makeTrend({
      topicKey: "united-states-crypto-reserve",
      label: "United States Crypto Reserve",
      category: "policy",
    });
    const row = makeBoardRow({
      id: "reserve-row",
      name: "Reserve Coin",
      symbol: "RSV",
      seedTerms: ["reserve", "crypto"],
    });

    expect(buildStrictTrendsPageBoardMatch(trend, row)).toBeNull();
  });

  it("filters the trends-page board down to only rows with strict matches", () => {
    const openAiTrend = makeTrend({
      topicKey: "openai-media-push",
      label: "OpenAI Media Push",
      category: "ai",
      entities: ["OpenAI"],
    });
    const bitcoinTrend = makeTrend({
      topicKey: "spot-bitcoin-etf-inflows",
      label: "Spot Bitcoin ETF Inflows",
      category: "crypto",
      entities: ["Bitcoin ETF"],
    });
    const state = {
      ...createZeroTrendDashboardVM({
        scope: "overall",
        range: "24h",
        sort: "posts",
        mode: "established",
      }),
      leaderboard: [openAiTrend, bitcoinTrend],
      leaderboards: {
        established: [openAiTrend, bitcoinTrend],
        emerging: [],
      },
    };
    const board: CorrelatedMemecoinBoard = {
      runId: 12,
      updatedAt: "2026-04-15T10:00:00.000Z",
      rows: [
        makeBoardRow({
          id: "openai-dog",
          name: "OpenAI Dog",
          symbol: "DOG",
        }),
        makeBoardRow({
          id: "bitcoin-dog",
          name: "Bitcoin Dog",
          symbol: "BTDOG",
        }),
      ],
      diagnostics: null,
    };

    const strictBoard = buildStrictTrendsPageCorrelatedBoard(state, board);

    expect(strictBoard?.rows).toHaveLength(1);
    expect(strictBoard?.rows[0]).toMatchObject({
      name: "OpenAI Dog",
      strongestTrendKey: "openai-media-push",
    });
  });

  it("drops persisted linked coins that only relied on broad narrative similarity", () => {
    const trend = makeTrend({
      topicKey: "fed-inflation-panic",
      label: "Fed Inflation Panic",
      category: "macro",
      entities: ["Fed", "inflation"],
    });
    const broadCoin: NarrativeLinkedCoin = {
      id: "solana:brr-token",
      symbol: "BRR",
      name: "Printer Go Brr",
      address: "brr-token",
      confidence: 88,
      whyLinked: "Matched macro and inflation narrative",
      matchReasons: ["matched macro and inflation narrative"],
      rawMatchSignals: {
        match_type: "strong_narrative",
        supporting_keywords: ["inflation", "macro"],
      },
      lastUpdatedAt: "2026-04-15T10:00:00.000Z",
    };

    expect(strictifyTrendsPageLinkedCoin(trend, broadCoin)).toBeNull();
  });
});
