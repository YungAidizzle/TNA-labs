import { beforeEach, describe, expect, it, vi } from "vitest";

const postgresMocks = vi.hoisted(() => {
  const query = vi.fn();
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    query,
    connect: vi.fn(async () => client),
  };
  return {
    client,
    query,
    pool,
    getServerPostgresPool: vi.fn(() => pool),
    hasDatabaseUrl: vi.fn(() => true),
  };
});

vi.mock("@/lib/db/server-postgres", () => postgresMocks);
const validationMocks = vi.hoisted(() => ({
  revalidateNarrativeLinkedCoins: vi.fn(async (coins) => ({
    liveCoins: Array.isArray(coins) ? coins.slice(0, 1) : [],
    rejected: [],
    stats: {
      attempted: Array.isArray(coins) ? coins.length : 0,
      liveRows: Array.isArray(coins) ? Math.min(1, coins.length) : 0,
      rejected: 0,
      rejectReasonCounts: {},
      decisionSourceCounts: {},
      fallbackReasonCounts: {},
    },
  })),
}));
vi.mock("@/lib/dashboard/dexscreener-live-validation", () => validationMocks);

import {
  attachStoredTrendDexscreenerMatches,
  refreshStoredTrendDexscreenerMatches,
} from "@/lib/dashboard/trend-dexscreener-matches";
import { createZeroRankedTrend, createZeroTrendDashboardVM } from "@/lib/dashboard/zero-state";
import type { RankedTrend } from "@/types/view-models";

function buildTrend(topicKey: string, label: string): RankedTrend {
  const trend = createZeroRankedTrend("overall", "24h");
  return {
    ...trend,
    id: `trend:${topicKey}`,
    name: label,
    displayName: label,
    nameStatus: "ready",
    nameSource: "ai_exact",
    canonicalKeySummary: topicKey,
    trendRawLabel: label,
    trendFallbackLabel: label,
    trendNarrativeSummary: `${label} summary`,
    trendDescription: `${label} description`,
    trendContextParagraph: `${label} context`,
  };
}

describe("stored trend DexScreener matches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    postgresMocks.client.query.mockReset();
    postgresMocks.client.release.mockReset();
  });

  it("attaches stored matches from the dedicated trend_dexscreener_matches table", async () => {
    const frogTrend = buildTrend("trend-frog", "Frog Rotation");
    const magaTrend = buildTrend("trend-maga", "MAGA Meme Cycle");
    const baseState = createZeroTrendDashboardVM({
      scope: "overall",
      range: "24h",
      sort: "posts",
      mode: "established",
    });
    const state = {
      ...baseState,
      leaderboard: [frogTrend, magaTrend],
      leaderboards: {
        established: [frogTrend, magaTrend],
        emerging: [],
      },
    };

    postgresMocks.query.mockResolvedValueOnce({
      rows: [
        {
          topic_key: "trend-frog",
          rank: 1,
          search_query: "Frog Rotation",
          query_aliases_json: ["Frog Rotation", "Frog"],
          chain_id: "solana",
          coin_address: "frog-token",
          pair_address: "frog-pair",
          dexscreener_url: "https://dexscreener.com/solana/frog-pair",
          dex_id: "raydium",
          coin_symbol: "FROG",
          coin_name: "Frog CTO",
          quote_symbol: "USDC",
          quote_token_name: "USD Coin",
          price_usd: 0.001,
          price_change_1h_pct: 4,
          price_change_6h_pct: 12,
          price_change_24h_pct: 20,
          liquidity_usd: 240000,
          volume_24h_usd: 980000,
          fdv_usd: 4200000,
          market_cap_usd: 4100000,
          pair_created_at: "2026-04-14T00:00:00.000Z",
          market_score: 86,
          relevance_score: 94,
          match_reasons_json: ["Exact DexScreener name match for \"Frog Rotation\""],
          raw_match_signals_json: {
            match_type: "dexscreener_search",
            matched_alias: "Frog Rotation",
          },
          websites_json: [],
          socials_json: [],
          icon_url: "https://example.com/frog.png",
          last_updated_at: "2026-04-20T01:00:00.000Z",
          is_live: true,
          last_validated_at: "2026-04-20T01:00:00.000Z",
          validation_status: "live",
          validation_reason: null,
          last_seen_liquidity_usd: 240000,
          last_seen_volume_h24: 980000,
          last_seen_txns_h24: 1800,
        },
        {
          topic_key: "trend-maga",
          rank: 1,
          search_query: "MAGA Meme Cycle",
          query_aliases_json: ["MAGA Meme Cycle", "MAGA"],
          chain_id: "solana",
          coin_address: "maga-token",
          pair_address: "maga-pair",
          dexscreener_url: "https://dexscreener.com/solana/maga-pair",
          dex_id: "raydium",
          coin_symbol: "MAGA",
          coin_name: "MAGA Coin",
          quote_symbol: "USDC",
          quote_token_name: "USD Coin",
          price_usd: 0.002,
          price_change_1h_pct: 3,
          price_change_6h_pct: 9,
          price_change_24h_pct: 15,
          liquidity_usd: 180000,
          volume_24h_usd: 710000,
          fdv_usd: 3500000,
          market_cap_usd: 3400000,
          pair_created_at: "2026-04-13T00:00:00.000Z",
          market_score: 79,
          relevance_score: 88,
          match_reasons_json: ["DexScreener token name preserves the trend phrase \"MAGA\""],
          raw_match_signals_json: {
            match_type: "dexscreener_search",
            matched_alias: "MAGA",
          },
          websites_json: [],
          socials_json: [],
          icon_url: null,
          last_updated_at: "2026-04-20T01:00:00.000Z",
          is_live: true,
          last_validated_at: "2026-04-20T01:00:00.000Z",
          validation_status: "live",
          validation_reason: null,
          last_seen_liquidity_usd: 180000,
          last_seen_volume_h24: 710000,
          last_seen_txns_h24: 1200,
        },
      ],
    });

    const result = await attachStoredTrendDexscreenerMatches(state);

    expect(postgresMocks.query).toHaveBeenCalledTimes(1);
    expect(result.leaderboard[0]?.linkedCoins?.[0]?.symbol).toBe("FROG");
    expect(result.leaderboard[1]?.linkedCoins?.[0]?.symbol).toBe("MAGA");
    expect(result.leaderboards.established[0]?.linkedCoins?.[0]?.rawMatchSignals).toMatchObject({
      match_type: "dexscreener_search",
      search_query: "Frog Rotation",
    });
  });

  it("dedupes repeated DexScreener pairs for the same token before insert", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn(() => null),
      },
      json: async () => ({
        pairs: [
          {
            chainId: "solana",
            dexId: "raydium",
            url: "https://dexscreener.com/solana/pair-1",
            pairAddress: "pair-1",
            pairCreatedAt: "2026-04-18T00:00:00.000Z",
            liquidity: { usd: 250000 },
            volume: { h24: 900000 },
            priceChange: { h24: 12, h6: 6, h1: 2 },
            txns: { h24: { buys: 500, sells: 380 } },
            baseToken: {
              address: "same-token",
              name: "AI Slop",
              symbol: "SLOP",
            },
            quoteToken: {
              symbol: "USDC",
              name: "USD Coin",
            },
            info: {},
          },
          {
            chainId: "solana",
            dexId: "raydium",
            url: "https://dexscreener.com/solana/pair-2",
            pairAddress: "pair-2",
            pairCreatedAt: "2026-04-18T00:00:00.000Z",
            liquidity: { usd: 175000 },
            volume: { h24: 480000 },
            priceChange: { h24: 8, h6: 4, h1: 1 },
            txns: { h24: { buys: 320, sells: 260 } },
            baseToken: {
              address: "same-token",
              name: "AI Slop CTO",
              symbol: "SLOP",
            },
            quoteToken: {
              symbol: "USDC",
              name: "USD Coin",
            },
            info: {},
          },
        ],
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    postgresMocks.query.mockResolvedValueOnce({
      rows: [],
    });
    postgresMocks.client.query.mockResolvedValue({
      rows: [],
    });

    const result = await refreshStoredTrendDexscreenerMatches({
      narratives: [
        {
          topicKey: "ai-slop",
          topicLabel: "AI Slop",
          summary: "AI slop meme coin trend",
          keyEntities: ["AI Slop"],
          sourceRunId: 11,
          sourceNarrativeId: 42,
        },
      ],
      force: true,
    });

    const insertCalls = postgresMocks.client.query.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO public.trend_dexscreener_matches"),
    );

    expect(result.writtenRowCount).toBe(1);
    expect(result.topicDiagnostics[0]).toMatchObject({
      topicKey: "ai-slop",
      candidateCount: 1,
      validationAttempted: 1,
      validationLive: 1,
      persistedCount: 1,
    });
    expect(insertCalls).toHaveLength(1);

  });
});
