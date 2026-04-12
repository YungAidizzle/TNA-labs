import { describe, expect, it } from "vitest";
import {
  assessMemecoinMomentum,
  compareCorrelatedMemecoinsByMomentum,
} from "@/lib/dashboard/memecoin-momentum";
import { CorrelatedMemecoinRow } from "@/types/view-models";

function makeRow(
  overrides: Partial<CorrelatedMemecoinRow> & Pick<CorrelatedMemecoinRow, "id" | "name" | "symbol">,
): CorrelatedMemecoinRow {
  return {
    id: overrides.id,
    rank: overrides.rank ?? 1,
    chainId: overrides.chainId ?? "solana",
    chainLabel: overrides.chainLabel ?? "Solana",
    tokenAddress: overrides.tokenAddress ?? `${overrides.id}-token`,
    pairAddress: overrides.pairAddress ?? `${overrides.id}-pair`,
    name: overrides.name,
    symbol: overrides.symbol,
    quoteSymbol: overrides.quoteSymbol ?? "USDC",
    strongestTrendKey: overrides.strongestTrendKey ?? "trend-frog",
    strongestTrendLabel: overrides.strongestTrendLabel ?? "Frog Rotation",
    correlationScore: overrides.correlationScore ?? 78,
    correlationLabel: overrides.correlationLabel ?? "High",
    marketScore: overrides.marketScore ?? 74,
    liquidityUsd: overrides.liquidityUsd ?? 260_000,
    volume24hUsd: overrides.volume24hUsd ?? 1_200_000,
    volume6hUsd: overrides.volume6hUsd ?? 420_000,
    volume1hUsd: overrides.volume1hUsd ?? 110_000,
    priceUsd: overrides.priceUsd ?? 0.0012,
    priceChange1hPct: overrides.priceChange1hPct ?? 4.8,
    priceChange6hPct: overrides.priceChange6hPct ?? 14.5,
    priceChange24hPct: overrides.priceChange24hPct ?? 31,
    buys24h: overrides.buys24h ?? 950,
    sells24h: overrides.sells24h ?? 620,
    txns24h: overrides.txns24h ?? 1_570,
    txns6h: overrides.txns6h ?? 650,
    txns1h: overrides.txns1h ?? 180,
    fdvUsd: overrides.fdvUsd ?? 7_200_000,
    marketCapUsd: overrides.marketCapUsd ?? 6_400_000,
    pairAgeHours: overrides.pairAgeHours ?? 52,
    websites: overrides.websites ?? [{ url: "https://frog.example" }],
    socials: overrides.socials ?? [{ type: "twitter", url: "https://x.com/frog" }],
    dexscreenerUrl: overrides.dexscreenerUrl ?? `https://dexscreener.com/solana/${overrides.id}-pair`,
    updatedAt: overrides.updatedAt ?? "2026-04-07T12:00:00.000Z",
  };
}

describe("memecoin momentum scoring", () => {
  it("prefers early acceleration over an already extended move with fading continuation", () => {
    const earlyBreakout = makeRow({
      id: "early-breakout",
      name: "Early Breakout",
      symbol: "EARLY",
      priceChange1hPct: 5.9,
      priceChange6hPct: 16.4,
      priceChange24hPct: 34,
      volume24hUsd: 1_100_000,
      volume6hUsd: 440_000,
      volume1hUsd: 125_000,
      txns24h: 1_420,
      txns6h: 640,
      txns1h: 190,
      buys24h: 930,
      sells24h: 560,
      pairAgeHours: 44,
    });
    const exhaustedRunner = makeRow({
      id: "exhausted-runner",
      name: "Exhausted Runner",
      symbol: "SENT",
      priceChange1hPct: 0.3,
      priceChange6hPct: 3.1,
      priceChange24hPct: 132,
      volume24hUsd: 2_900_000,
      volume6hUsd: 380_000,
      volume1hUsd: 35_000,
      txns24h: 2_600,
      txns6h: 420,
      txns1h: 42,
      buys24h: 1_100,
      sells24h: 1_040,
      pairAgeHours: 40,
    });

    const earlyAssessment = assessMemecoinMomentum(earlyBreakout);
    const exhaustedAssessment = assessMemecoinMomentum(exhaustedRunner);

    expect(earlyAssessment.momentumScore).toBeGreaterThan(exhaustedAssessment.momentumScore);
    expect(earlyAssessment.momentumSignal).toMatch(/Breakout|Acceleration|Volume|Early continuation/);
    expect(compareCorrelatedMemecoinsByMomentum(
      { ...earlyBreakout, ...earlyAssessment },
      { ...exhaustedRunner, ...exhaustedAssessment },
    )).toBeLessThan(0);
  });

  it("heavily penalizes illiquid noise even if the short-term candle is green", () => {
    const qualitySetup = makeRow({
      id: "quality-setup",
      name: "Quality Setup",
      symbol: "QUAL",
      liquidityUsd: 320_000,
      volume24hUsd: 1_500_000,
      volume1hUsd: 160_000,
      txns24h: 1_900,
      txns1h: 240,
      priceChange1hPct: 4.2,
      priceChange24hPct: 26,
    });
    const noisySpike = makeRow({
      id: "noisy-spike",
      name: "Noisy Spike",
      symbol: "NOISE",
      liquidityUsd: 12_000,
      volume24hUsd: 24_000,
      volume6hUsd: 9_000,
      volume1hUsd: 6_000,
      txns24h: 34,
      txns6h: 12,
      txns1h: 6,
      priceChange1hPct: 11.5,
      priceChange6hPct: 18,
      priceChange24hPct: 54,
      buys24h: 20,
      sells24h: 13,
      marketScore: 41,
      pairAgeHours: 1.5,
      websites: [],
      socials: [],
    });

    const qualityAssessment = assessMemecoinMomentum(qualitySetup);
    const noiseAssessment = assessMemecoinMomentum(noisySpike);

    expect(qualityAssessment.momentumScore).toBeGreaterThanOrEqual(55);
    expect(noiseAssessment.momentumScore).toBeLessThan(30);
  });

  it("favors improving participation over a flat stale setup", () => {
    const strengthening = makeRow({
      id: "strengthening",
      name: "Strengthening Frog",
      symbol: "STR",
      priceChange1hPct: 3.4,
      priceChange6hPct: 11.2,
      priceChange24hPct: 18,
      volume24hUsd: 860_000,
      volume6hUsd: 330_000,
      volume1hUsd: 100_000,
      txns24h: 980,
      txns6h: 420,
      txns1h: 135,
      pairAgeHours: 70,
    });
    const stale = makeRow({
      id: "stale",
      name: "Stale Frog",
      symbol: "STALE",
      priceChange1hPct: 0.2,
      priceChange6hPct: 0.8,
      priceChange24hPct: 4.5,
      volume24hUsd: 240_000,
      volume6hUsd: 40_000,
      volume1hUsd: 5_000,
      txns24h: 220,
      txns6h: 28,
      txns1h: 4,
      pairAgeHours: 24 * 38,
      buys24h: 120,
      sells24h: 116,
    });

    const strengtheningAssessment = assessMemecoinMomentum(strengthening);
    const staleAssessment = assessMemecoinMomentum(stale);

    expect(strengtheningAssessment.momentumScore).toBeGreaterThan(staleAssessment.momentumScore);
    expect(staleAssessment.momentumScore).toBeLessThan(45);
  });
});
