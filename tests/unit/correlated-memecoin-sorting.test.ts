import { describe, expect, it } from "vitest";
import {
  DEFAULT_CORRELATED_MEMECOIN_SORT,
  sortCorrelatedMemecoinRows,
} from "@/lib/dashboard/correlated-memecoin-sorting";
import { CorrelatedMemecoinRow } from "@/types/view-models";

function buildRow(
  overrides: Pick<
    CorrelatedMemecoinRow,
    "id" | "rank" | "name" | "symbol" | "correlationScore" | "liquidityUsd" | "volume24hUsd" | "priceChange24hPct"
  >,
): CorrelatedMemecoinRow {
  return {
    id: overrides.id,
    rank: overrides.rank,
    chainId: "solana",
    chainLabel: "Solana",
    tokenAddress: `${overrides.id}-token`,
    pairAddress: `${overrides.id}-pair`,
    name: overrides.name,
    symbol: overrides.symbol,
    strongestTrendKey: `${overrides.id}-trend`,
    strongestTrendLabel: `${overrides.name} Trend`,
    strongestTrendCategory: "meme",
    strongestTrendSummary: `${overrides.name} summary`,
    correlationScore: overrides.correlationScore,
    correlationLabel: "High",
    marketScore: 70,
    liquidityUsd: overrides.liquidityUsd,
    volume24hUsd: overrides.volume24hUsd,
    priceUsd: 0.001,
    priceChange24hPct: overrides.priceChange24hPct,
    pairAgeHours: 48,
    fdvUsd: 1_000_000,
    marketCapUsd: 900_000,
    dexscreenerUrl: `https://dexscreener.com/solana/${overrides.id}-pair`,
    updatedAt: "2026-04-05T10:00:00.000Z",
  };
}

describe("correlated memecoin sorting", () => {
  const rows: CorrelatedMemecoinRow[] = [
    buildRow({
      id: "frog",
      rank: 1,
      name: "Frog CTO",
      symbol: "FROG",
      correlationScore: 88,
      liquidityUsd: 152_000,
      volume24hUsd: 810_000,
      priceChange24hPct: 22.5,
    }),
    buildRow({
      id: "trump",
      rank: 2,
      name: "Trump Coin",
      symbol: "TRUMP",
      correlationScore: 76,
      liquidityUsd: 241_000,
      volume24hUsd: 630_000,
      priceChange24hPct: 11.2,
    }),
    buildRow({
      id: "anime",
      rank: 3,
      name: "Anime Velocity",
      symbol: "ANIME",
      correlationScore: 81,
      liquidityUsd: null,
      volume24hUsd: 1_200_000,
      priceChange24hPct: -4.7,
    }),
  ];

  it("defaults to correlation score descending", () => {
    expect(sortCorrelatedMemecoinRows(rows, DEFAULT_CORRELATED_MEMECOIN_SORT).map((row) => row.symbol)).toEqual([
      "FROG",
      "ANIME",
      "TRUMP",
    ]);
  });

  it.each([
    {
      label: "liquidity",
      sortState: {
        key: "liquidityUsd" as const,
        direction: "desc" as const,
      },
      expected: ["TRUMP", "FROG", "ANIME"],
    },
    {
      label: "24 hour volume",
      sortState: {
        key: "volume24hUsd" as const,
        direction: "desc" as const,
      },
      expected: ["ANIME", "FROG", "TRUMP"],
    },
    {
      label: "24 hour change",
      sortState: {
        key: "priceChange24hPct" as const,
        direction: "desc" as const,
      },
      expected: ["FROG", "TRUMP", "ANIME"],
    },
    {
      label: "correlation score",
      sortState: {
        key: "correlationScore" as const,
        direction: "desc" as const,
      },
      expected: ["FROG", "ANIME", "TRUMP"],
    },
  ])("sorts by $label from highest to lowest", ({ sortState, expected }) => {
    expect(sortCorrelatedMemecoinRows(rows, sortState).map((row) => row.symbol)).toEqual(expected);
  });

  it("supports ascending toggles while keeping missing values at the bottom", () => {
    expect(
      sortCorrelatedMemecoinRows(rows, {
        key: "liquidityUsd",
        direction: "asc",
      }).map((row) => row.symbol),
    ).toEqual(["FROG", "TRUMP", "ANIME"]);
  });
});
