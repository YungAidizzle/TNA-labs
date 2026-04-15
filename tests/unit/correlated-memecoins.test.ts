import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postgresMocks = vi.hoisted(() => {
  const query = vi.fn();
  const pool = { query };
  return {
    query,
    pool,
    getServerPostgresPool: vi.fn(() => pool),
    hasDatabaseUrl: vi.fn(() => true),
  };
});

const liveValidationMocks = vi.hoisted(() => {
  return {
    getDashboardLiveValidationThresholds: vi.fn(() => ({
      liveMinLiquidityUsd: 750,
      liveMinVolume24hUsd: 400,
      liveMinRecentTxns: 2,
      liveMaxStalenessHours: 6,
      trustValidationTtlHours: 4,
      lastKnownGoodTtlHours: 48,
    })),
    revalidateCorrelatedMemecoinRows: vi.fn(async (rows: unknown[]) => ({
      liveRows: rows,
      rejected: [] as Array<{ row: unknown; reason: string | null }>,
      stats: {
        attempted: Array.isArray(rows) ? rows.length : 0,
        liveRows: Array.isArray(rows) ? rows.length : 0,
        rejected: 0,
        rejectReasonCounts: {},
        decisionSourceCounts: { network: Array.isArray(rows) ? rows.length : 0 },
        fallbackReasonCounts: {},
      },
    })),
  };
});

const dbCapabilityMocks = vi.hoisted(() => {
  return {
    getMemecoinDbCapabilities: vi.fn(async () => ({
      assetLiveValidationColumnsAvailable: true,
      assetColumns: [
        "asset_id",
        "chain_id",
        "token_address",
        "pair_address",
        "is_live",
        "last_validated_at",
        "validation_status",
        "validation_reason",
        "last_seen_liquidity_usd",
        "last_seen_volume_h24",
        "last_seen_txns_h24",
      ],
      refreshedAt: "2026-04-05T12:00:00.000Z",
    })),
  };
});

vi.mock("@/lib/db/server-postgres", () => postgresMocks);
vi.mock("@/lib/dashboard/dexscreener-live-validation", () => liveValidationMocks);
vi.mock("@/lib/dashboard/memecoin-db-capabilities", () => dbCapabilityMocks);

describe("correlated memecoin board loader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));
    vi.clearAllMocks();
    postgresMocks.query.mockReset();
    vi.spyOn(console, "info").mockImplementation(() => {});
    postgresMocks.hasDatabaseUrl.mockReturnValue(true);
    liveValidationMocks.revalidateCorrelatedMemecoinRows.mockImplementation(async (rows: unknown[]) => ({
      liveRows: rows,
      rejected: [] as Array<{ row: unknown; reason: string | null }>,
      stats: {
        attempted: Array.isArray(rows) ? rows.length : 0,
        liveRows: Array.isArray(rows) ? rows.length : 0,
        rejected: 0,
        rejectReasonCounts: {},
        decisionSourceCounts: { network: Array.isArray(rows) ? rows.length : 0 },
        fallbackReasonCounts: {},
      },
    }));
    dbCapabilityMocks.getMemecoinDbCapabilities.mockResolvedValue({
      assetLiveValidationColumnsAvailable: true,
      assetColumns: [
        "asset_id",
        "chain_id",
        "token_address",
        "pair_address",
        "is_live",
        "last_validated_at",
        "validation_status",
        "validation_reason",
        "last_seen_liquidity_usd",
        "last_seen_volume_h24",
        "last_seen_txns_h24",
      ],
      refreshedAt: "2026-04-05T12:00:00.000Z",
    });
    delete process.env.DASHBOARD_MEMECOIN_CACHE_TTL_MS;
    delete process.env.DASHBOARD_MEMECOIN_RECENT_RUN_LIMIT;
    delete process.env.DASHBOARD_MEMECOIN_MAX_ROWS;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    delete process.env.DASHBOARD_MEMECOIN_CACHE_TTL_MS;
    delete process.env.DASHBOARD_MEMECOIN_RECENT_RUN_LIMIT;
    delete process.env.DASHBOARD_MEMECOIN_MAX_ROWS;
  });

  it("aggregates recent successful runs and deduplicates by token", async () => {
    process.env.DASHBOARD_MEMECOIN_RECENT_RUN_LIMIT = "4";
    process.env.DASHBOARD_MEMECOIN_MAX_ROWS = "10";

    postgresMocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 17,
            completed_at: "2026-04-05T11:45:00.000Z",
          },
          {
            run_id: 16,
            completed_at: "2026-04-05T11:30:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 17,
            run_completed_at: "2026-04-05T11:45:00.000Z",
            rank: 1,
            correlation_score: 86.2,
            correlation_label: "High",
            strongest_topic_key: "internet-culture-ai-agents",
            strongest_topic_label: "AI Agents Flood The Timeline",
            strongest_trend_category: "ai_tech",
            strongest_narrative_summary: "AI agent memes and builders are dominating attention.",
            market_score: 74.2,
            dexscreener_url: "https://dexscreener.com/solana/frogpair",
            chain_id: "solana",
            token_address: "frog-token",
            symbol: "FROG",
            name: "Frog CTO",
            icon_url: "https://assets.example/frog.png",
            header_url: null,
            description: "Frog takeover coin",
            websites_json: [{ label: "Website", url: "https://frog.example" }],
            socials_json: [{ type: "twitter", url: "https://x.com/frog" }],
            pair_address: "frogpair",
            quote_symbol: "USDC",
            quote_token_name: "USD Coin",
            price_usd: 0.0012,
            liquidity_usd: 152000,
            volume_h24_usd: 810000,
            volume_h6_usd: 320000,
            volume_h1_usd: 70000,
            price_change_h24_pct: 22.5,
            price_change_h6_pct: 12.4,
            price_change_h1_pct: 3.2,
            buys_h24: 1200,
            sells_h24: 900,
            txns_h24: 2100,
            txns_h6: 800,
            txns_h1: 200,
            fdv_usd: 9200000,
            market_cap_usd: 9100000,
            pair_created_at: "2026-04-02T12:00:00.000Z",
            asset_metadata_json: {
              seed_terms: ["frog", "cto"],
              discovery_sources: ["trend_seed_search"],
              matched_trend_keys: ["internet-culture-ai-agents"],
              community_takeover: true,
              tradingview_symbol: "BINANCE:FROGUSDT",
            },
            market_metadata_json: {
              memecoin_fit_score: 78,
            },
            links_json: [
              {
                topicKey: "internet-culture-ai-agents",
                topicLabel: "AI Agents Flood The Timeline",
                trendCategory: "ai_tech",
                narrativeSummary: "AI agent memes and builders are dominating attention.",
                lexicalScore: 18,
                mentionScore: 9,
                timingScore: 8,
                cultureFitScore: 7,
                linkScore: 42,
                supportPostCount: 3,
                supportInteractionScore: 12,
                isPrimary: true,
              },
            ],
          },
          {
            run_id: 16,
            run_completed_at: "2026-04-05T11:30:00.000Z",
            rank: 1,
            correlation_score: 88.4,
            correlation_label: "High",
            strongest_topic_key: "internet-culture-ai-agents",
            strongest_topic_label: "AI Agents Flood The Timeline",
            strongest_trend_category: "ai_tech",
            strongest_narrative_summary: "AI agent memes and builders are dominating attention.",
            market_score: 74.2,
            dexscreener_url: "https://dexscreener.com/solana/frogpair",
            chain_id: "solana",
            token_address: "frog-token",
            symbol: "FROG",
            name: "Frog CTO",
            icon_url: "https://assets.example/frog.png",
            header_url: null,
            description: "Frog takeover coin",
            websites_json: [{ label: "Website", url: "https://frog.example" }],
            socials_json: [{ type: "twitter", url: "https://x.com/frog" }],
            pair_address: "frogpair",
            quote_symbol: "USDC",
            quote_token_name: "USD Coin",
            price_usd: 0.0013,
            liquidity_usd: 155000,
            volume_h24_usd: 812000,
            volume_h6_usd: 325000,
            volume_h1_usd: 71000,
            price_change_h24_pct: 21.2,
            price_change_h6_pct: 11.8,
            price_change_h1_pct: 2.9,
            buys_h24: 1180,
            sells_h24: 870,
            txns_h24: 2050,
            txns_h6: 790,
            txns_h1: 195,
            fdv_usd: 9210000,
            market_cap_usd: 9110000,
            pair_created_at: "2026-04-02T12:00:00.000Z",
            asset_metadata_json: {
              tradingview_symbol: "BINANCE:FROGUSDT",
            },
            market_metadata_json: {},
            links_json: [],
          },
          {
            run_id: 17,
            run_completed_at: "2026-04-05T11:45:00.000Z",
            rank: 2,
            correlation_score: 72.1,
            correlation_label: "Elevated",
            strongest_topic_key: "digital-art",
            strongest_topic_label: "#DigitalArt",
            strongest_trend_category: "internet_culture",
            strongest_narrative_summary: "Digital art creators are driving discussion.",
            market_score: 68.5,
            dexscreener_url: "https://dexscreener.com/solana/animepair",
            chain_id: "solana",
            token_address: "anime-token",
            symbol: "ANIME",
            name: "Anime Bitcoin",
            pair_address: "animepair",
            price_usd: 0.00042,
            liquidity_usd: 98000,
            volume_h24_usd: 455000,
            price_change_h24_pct: 14.7,
            fdv_usd: 5400000,
            market_cap_usd: 5200000,
            pair_created_at: "2026-04-03T12:00:00.000Z",
            asset_metadata_json: {
              seed_terms: ["anime", "velocity"],
              discovery_sources: ["dex_feed"],
              matched_trend_keys: ["digital-art"],
              community_takeover: false,
            },
            market_metadata_json: {
              memecoin_fit_score: 68,
            },
            links_json: [
              {
                topicKey: "digital-art",
                topicLabel: "#DigitalArt",
                trendCategory: "internet_culture",
                narrativeSummary: "Digital art creators are driving discussion.",
                lexicalScore: 16,
                mentionScore: 6,
                timingScore: 7,
                cultureFitScore: 8,
                linkScore: 31,
                supportPostCount: 2,
                supportInteractionScore: 9,
                isPrimary: true,
              },
            ],
          },
        ],
      });

    const { fetchLatestCorrelatedMemecoinBoard } = await import("@/lib/dashboard/correlated-memecoins");
    const board = await fetchLatestCorrelatedMemecoinBoard();

    expect(board).toMatchObject({
      runId: 17,
      updatedAt: "2026-04-05T11:45:00.000Z",
    });
    expect(board?.rows).toHaveLength(2);
    expect(board?.rows[0]).toMatchObject({
      rank: 1,
      chainId: "solana",
      chainLabel: "Solana",
      name: "Frog CTO",
      symbol: "FROG",
      strongestTrendLabel: "AI Agents Flood The Timeline",
      correlationScore: 88.4,
      dexscreenerUrl: "https://dexscreener.com/solana/frogpair",
      updatedAt: "2026-04-05T11:30:00.000Z",
      memecoinFitScore: null,
      quoteSymbol: "USDC",
      priceChange1hPct: 2.9,
      priceChange6hPct: 11.8,
      tradingviewSymbol: "BINANCE:FROGUSDT",
    });
    expect(board?.rows[0].pairAgeHours).toBe(72);
    expect(board?.rows[0].seedTerms).toEqual([]);
    expect(board?.rows[0].matchedTrendKeys).toEqual([]);
    expect(board?.rows[0].links).toEqual([]);
    expect(board?.rows[0].iconUrl).toBe("https://assets.example/frog.png");
    expect(board?.rows[0].momentumScore).toEqual(expect.any(Number));
    expect(board?.rows[0].momentumRank).toEqual(expect.any(Number));
    expect(board?.rows[0].momentumSignal).toEqual(expect.any(String));
    expect(board?.rows[0].websites).toEqual([
      { label: "Website", type: null, url: "https://frog.example" },
    ]);
    expect(board?.rows[0].socials).toEqual([
      { label: null, type: "twitter", url: "https://x.com/frog" },
    ]);
    expect(board?.rows[1]).toMatchObject({
      rank: 2,
      symbol: "ANIME",
      strongestTrendLabel: "#DigitalArt",
      correlationScore: 72.1,
      memecoinFitScore: 68,
      seedTerms: ["anime", "velocity"],
      matchedTrendKeys: ["digital-art"],
    });
    expect(board?.rows[1].links?.[0]).toMatchObject({
      topicKey: "digital-art",
      topicLabel: "#DigitalArt",
      supportPostCount: 2,
      isPrimary: true,
    });
    expect(postgresMocks.query).toHaveBeenCalledTimes(2);
    expect(console.info).toHaveBeenCalledWith(
      "[correlated-memecoins] aggregated board",
      expect.objectContaining({
        runs_used: [17, 16],
        rows_returned_by_query: 3,
        rows_after_dedupe: 2,
        final_rows: 2,
      }),
    );
  });

  it("returns more than twenty rows when the board limit is unlimited", async () => {
    process.env.DASHBOARD_MEMECOIN_MAX_ROWS = "0";

    postgresMocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 31,
            completed_at: "2026-04-05T11:59:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: Array.from({ length: 25 }, (_, index) => ({
          run_id: 31,
          run_completed_at: "2026-04-05T11:59:00.000Z",
          rank: index + 1,
          correlation_score: 90 - index,
          correlation_label: "High",
          strongest_topic_key: `trend-${index}`,
          strongest_topic_label: `Trend ${index}`,
          strongest_trend_category: "internet_culture",
          strongest_narrative_summary: `Narrative ${index}`,
          market_score: 70 - index * 0.2,
          dexscreener_url: `https://dexscreener.com/solana/pair-${index}`,
          chain_id: "solana",
          token_address: `token-${index}`,
          symbol: `TOK${index}`,
          name: `Token ${index}`,
          pair_address: `pair-${index}`,
          price_usd: 0.001 + index * 0.00001,
          liquidity_usd: 50000 - index * 500,
          volume_h24_usd: 100000 - index * 1000,
          price_change_h24_pct: 10 - index * 0.2,
          fdv_usd: 2000000 + index * 1000,
          market_cap_usd: 1800000 + index * 1000,
          pair_created_at: "2026-04-03T12:00:00.000Z",
          asset_metadata_json: {},
          market_metadata_json: {},
          links_json: [],
        })),
      });

    const { fetchLatestCorrelatedMemecoinBoard } = await import("@/lib/dashboard/correlated-memecoins");
    const board = await fetchLatestCorrelatedMemecoinBoard();

    expect(board?.rows).toHaveLength(25);
    expect(board?.rows[0]).toMatchObject({
      rank: 1,
      symbol: "TOK0",
    });
    expect(board?.rows[24]).toMatchObject({
      rank: 25,
      symbol: "TOK24",
    });
  });

  it("falls back cleanly when only one successful run exists", async () => {
    postgresMocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 21,
            completed_at: "2026-04-05T11:55:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 21,
            run_completed_at: "2026-04-05T11:55:00.000Z",
            rank: 1,
            correlation_score: 61.4,
            correlation_label: "Moderate",
            strongest_topic_key: "youtube",
            strongest_topic_label: "YouTube",
            strongest_trend_category: "creator",
            strongest_narrative_summary: "Creator chatter is driving the topic.",
            market_score: 55.2,
            dexscreener_url: "https://dexscreener.com/solana/bullpair",
            chain_id: "solana",
            token_address: "bull-token",
            symbol: "BULL",
            name: "Bull",
            pair_address: "bullpair",
            price_usd: 0.001,
            liquidity_usd: 111000,
            volume_h24_usd: 412000,
            price_change_h24_pct: 7.5,
            fdv_usd: 6500000,
            market_cap_usd: 6200000,
            pair_created_at: "2026-04-02T12:00:00.000Z",
            asset_metadata_json: {},
            market_metadata_json: {},
            links_json: [],
          },
        ],
      });

    const { fetchLatestCorrelatedMemecoinBoard } = await import("@/lib/dashboard/correlated-memecoins");
    const board = await fetchLatestCorrelatedMemecoinBoard();

    expect(board).toMatchObject({
      runId: 21,
      updatedAt: "2026-04-05T11:55:00.000Z",
    });
    expect(board?.rows).toHaveLength(1);
    expect(board?.rows[0]).toMatchObject({
      symbol: "BULL",
      strongestTrendLabel: "YouTube",
      correlationScore: 61.4,
    });
  });

  it("excludes dead coins from the rendered board when live validation rejects them", async () => {
    postgresMocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 41,
            completed_at: "2026-04-05T11:59:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 41,
            run_completed_at: "2026-04-05T11:59:00.000Z",
            rank: 1,
            correlation_score: 91.1,
            correlation_label: "High",
            strongest_topic_key: "frog",
            strongest_topic_label: "Frog",
            strongest_trend_category: "meme",
            strongest_narrative_summary: "Frog chatter",
            market_score: 70,
            dexscreener_url: "https://dexscreener.com/solana/livepair",
            chain_id: "solana",
            token_address: "live-token",
            symbol: "LIVE",
            name: "Live Coin",
            pair_address: "livepair",
            liquidity_usd: 120000,
            volume_h24_usd: 800000,
            price_usd: 0.0011,
            pair_created_at: "2026-04-04T12:00:00.000Z",
            asset_metadata_json: {},
            market_metadata_json: {},
            links_json: [],
          },
          {
            run_id: 41,
            run_completed_at: "2026-04-05T11:59:00.000Z",
            rank: 2,
            correlation_score: 84.4,
            correlation_label: "High",
            strongest_topic_key: "frog",
            strongest_topic_label: "Frog",
            strongest_trend_category: "meme",
            strongest_narrative_summary: "Frog chatter",
            market_score: 66,
            dexscreener_url: "https://dexscreener.com/solana/deadpair",
            chain_id: "solana",
            token_address: "dead-token",
            symbol: "DEAD",
            name: "Dead Coin",
            pair_address: "deadpair",
            liquidity_usd: 5000,
            volume_h24_usd: 1000,
            price_usd: 0.0001,
            pair_created_at: "2026-04-04T12:00:00.000Z",
            asset_metadata_json: {},
            market_metadata_json: {},
            links_json: [],
          },
        ],
      });
    liveValidationMocks.revalidateCorrelatedMemecoinRows.mockResolvedValueOnce({
      liveRows: [
        {
          id: "solana:live-token:livepair",
          rank: 1,
          chainId: "solana",
          chainLabel: "Solana",
          tokenAddress: "live-token",
          pairAddress: "livepair",
          name: "Live Coin",
          symbol: "LIVE",
          strongestTrendKey: "frog",
          strongestTrendLabel: "Frog",
          correlationScore: 91.1,
          correlationLabel: "High",
          dexscreenerUrl: "https://dexscreener.com/solana/livepair",
          updatedAt: "2026-04-05T11:59:00.000Z",
        },
      ],
      rejected: [
        {
          row: {
            id: "solana:dead-token:deadpair",
            rank: 2,
            chainId: "solana",
            chainLabel: "Solana",
            tokenAddress: "dead-token",
            pairAddress: "deadpair",
            name: "Dead Coin",
            symbol: "DEAD",
            strongestTrendKey: "frog",
            strongestTrendLabel: "Frog",
            correlationScore: 84.4,
            correlationLabel: "High",
            dexscreenerUrl: "https://dexscreener.com/solana/deadpair",
            updatedAt: "2026-04-05T11:59:00.000Z",
          },
          reason: "pair_deleted",
        },
      ],
      stats: {
        attempted: 2,
        liveRows: 1,
        rejected: 1,
        rejectReasonCounts: { pair_deleted: 1 },
        decisionSourceCounts: { network: 2 },
        fallbackReasonCounts: {},
      },
    });

    const { fetchLatestCorrelatedMemecoinBoard } = await import("@/lib/dashboard/correlated-memecoins");
    const board = await fetchLatestCorrelatedMemecoinBoard();

    expect(board?.rows).toHaveLength(1);
    expect(board?.rows[0]?.symbol).toBe("LIVE");
    expect(board?.diagnostics?.rowsExcluded).toBe(1);
    expect(board?.diagnostics?.liveValidationRejectCounts).toEqual({ pair_deleted: 1 });
  });

  it("keeps serving the last good board when a refresh query fails", async () => {
    process.env.DASHBOARD_MEMECOIN_CACHE_TTL_MS = "1";

    postgresMocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 17,
            completed_at: "2026-04-05T11:45:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            rank: 1,
            correlation_score: 88.4,
            correlation_label: "High",
            strongest_topic_key: "internet-culture-ai-agents",
            strongest_topic_label: "AI Agents Flood The Timeline",
            strongest_trend_category: "ai_tech",
            strongest_narrative_summary: "AI agent memes and builders are dominating attention.",
            market_score: 74.2,
            dexscreener_url: "https://dexscreener.com/solana/frogpair",
            chain_id: "solana",
            token_address: "frog-token",
            symbol: "FROG",
            name: "Frog CTO",
            pair_address: "frogpair",
            price_usd: 0.0012,
            liquidity_usd: 152000,
            volume_h24_usd: 810000,
            price_change_h24_pct: 22.5,
            fdv_usd: 9200000,
            market_cap_usd: 9100000,
            pair_created_at: "2026-04-02T12:00:00.000Z",
            asset_metadata_json: {},
            market_metadata_json: {},
            links_json: [],
          },
        ],
      })
      .mockRejectedValueOnce(new Error("transient database outage"));

    const { fetchLatestCorrelatedMemecoinBoard } = await import("@/lib/dashboard/correlated-memecoins");
    const firstBoard = await fetchLatestCorrelatedMemecoinBoard();

    vi.advanceTimersByTime(5);

    const refreshedBoard = await fetchLatestCorrelatedMemecoinBoard();

    expect(refreshedBoard).toEqual(firstBoard);
    expect(postgresMocks.query).toHaveBeenCalledTimes(3);
  });

  it("uses schema compatibility mode instead of blanking the board when live validation columns are missing", async () => {
    dbCapabilityMocks.getMemecoinDbCapabilities.mockResolvedValueOnce({
      assetLiveValidationColumnsAvailable: false,
      assetColumns: ["asset_id", "chain_id", "token_address", "pair_address", "dexscreener_url"],
      refreshedAt: "2026-04-05T12:00:00.000Z",
    });

    postgresMocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 55,
            completed_at: "2026-04-05T11:59:00.000Z",
            notes_json: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 55,
            run_completed_at: "2026-04-05T11:59:00.000Z",
            asset_updated_at: "2026-04-05T11:59:00.000Z",
            rank: 1,
            correlation_score: 81.4,
            correlation_label: "High",
            strongest_topic_key: "frog",
            strongest_topic_label: "Frog",
            strongest_trend_category: "meme",
            strongest_narrative_summary: "Frog chatter",
            market_score: 69,
            dexscreener_url: "https://dexscreener.com/solana/frogpair",
            chain_id: "solana",
            token_address: "frog-token",
            asset_pair_address: "frogpair",
            symbol: "FROG",
            name: "Frog Coin",
            icon_url: null,
            header_url: null,
            description: null,
            websites_json: [],
            socials_json: [],
            pair_address: "frogpair",
            quote_symbol: "SOL",
            quote_token_name: "Solana",
            price_usd: 0.001,
            liquidity_usd: 120000,
            volume_h24_usd: 500000,
            volume_h6_usd: 120000,
            volume_h1_usd: 22000,
            price_change_h24_pct: 12,
            price_change_h6_pct: 5,
            price_change_h1_pct: 1.5,
            buys_h24: 500,
            sells_h24: 420,
            txns_h24: 920,
            txns_h6: 210,
            txns_h1: 48,
            fdv_usd: 3500000,
            market_cap_usd: 3300000,
            pair_created_at: "2026-04-04T12:00:00.000Z",
            tradingview_symbol: null,
            tradingview_exchange: null,
            tradingview_embed_symbol: null,
            tv_resolution_status: null,
            tv_last_checked_at: null,
            tv_failure_reason: null,
            has_verified_tradingview_preview: null,
            tv_search_evidence_json: {},
            asset_metadata_json: {},
            market_metadata_json: {},
            links_json: [],
          },
        ],
      });

    const { fetchLatestCorrelatedMemecoinBoard } = await import("@/lib/dashboard/correlated-memecoins");
    const board = await fetchLatestCorrelatedMemecoinBoard();

    expect(board?.rows).toHaveLength(1);
    expect(board?.diagnostics?.schemaCompatibility?.assetLiveValidationColumnsAvailable).toBe(false);
    expect(String(postgresMocks.query.mock.calls[1]?.[0] ?? "")).toContain("NULL::boolean AS is_live");
    expect(String(postgresMocks.query.mock.calls[1]?.[0] ?? "")).not.toContain(
      "COALESCE(a.validation_status, 'pending') <> 'invalid'",
    );
  });

  it("surfaces producer/read threshold mismatches in diagnostics", async () => {
    postgresMocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 56,
            completed_at: "2026-04-05T11:59:00.000Z",
            notes_json: {
              live_validation_thresholds: {
                live_min_liquidity_usd: 250,
                live_min_volume_24h_usd: 100,
                live_min_recent_txns: 1,
                live_max_snapshot_staleness_hours: 24,
              },
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 56,
            run_completed_at: "2026-04-05T11:59:00.000Z",
            asset_updated_at: "2026-04-05T11:59:00.000Z",
            rank: 1,
            correlation_score: 81.4,
            correlation_label: "High",
            strongest_topic_key: "frog",
            strongest_topic_label: "Frog",
            strongest_trend_category: "meme",
            strongest_narrative_summary: "Frog chatter",
            market_score: 69,
            dexscreener_url: "https://dexscreener.com/solana/frogpair",
            chain_id: "solana",
            token_address: "frog-token",
            asset_pair_address: "frogpair",
            symbol: "FROG",
            name: "Frog Coin",
            is_live: true,
            last_validated_at: "2026-04-05T11:50:00.000Z",
            validation_status: "live",
            validation_reason: null,
            last_seen_liquidity_usd: 120000,
            last_seen_volume_h24: 500000,
            last_seen_txns_h24: 920,
            icon_url: null,
            header_url: null,
            description: null,
            websites_json: [],
            socials_json: [],
            pair_address: "frogpair",
            quote_symbol: "SOL",
            quote_token_name: "Solana",
            price_usd: 0.001,
            liquidity_usd: 120000,
            volume_h24_usd: 500000,
            volume_h6_usd: 120000,
            volume_h1_usd: 22000,
            price_change_h24_pct: 12,
            price_change_h6_pct: 5,
            price_change_h1_pct: 1.5,
            buys_h24: 500,
            sells_h24: 420,
            txns_h24: 920,
            txns_h6: 210,
            txns_h1: 48,
            fdv_usd: 3500000,
            market_cap_usd: 3300000,
            pair_created_at: "2026-04-04T12:00:00.000Z",
            tradingview_symbol: null,
            tradingview_exchange: null,
            tradingview_embed_symbol: null,
            tv_resolution_status: null,
            tv_last_checked_at: null,
            tv_failure_reason: null,
            has_verified_tradingview_preview: null,
            tv_search_evidence_json: {},
            asset_metadata_json: {},
            market_metadata_json: {},
            links_json: [],
          },
        ],
      });

    const { fetchLatestCorrelatedMemecoinBoard } = await import("@/lib/dashboard/correlated-memecoins");
    const board = await fetchLatestCorrelatedMemecoinBoard();

    expect(board?.rows).toHaveLength(1);
    expect(board?.diagnostics?.thresholdDiagnostics?.mismatchKeys).toEqual([
      "liveMinLiquidityUsd",
      "liveMinVolume24hUsd",
      "liveMinRecentTxns",
      "liveMaxStalenessHours",
    ]);
  });

  it("uses stored validation mode without read-time validation or schema capability probes", async () => {
    postgresMocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 57,
            completed_at: "2026-04-05T11:59:00.000Z",
            notes_json: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 57,
            run_completed_at: "2026-04-05T11:59:00.000Z",
            asset_updated_at: "2026-04-05T11:59:00.000Z",
            rank: 1,
            correlation_score: 81.4,
            correlation_label: "High",
            strongest_topic_key: "frog",
            strongest_topic_label: "Frog",
            strongest_trend_category: "meme",
            strongest_narrative_summary: "Frog chatter",
            market_score: 69,
            dexscreener_url: "https://dexscreener.com/solana/frogpair",
            chain_id: "solana",
            token_address: "frog-token",
            asset_pair_address: "frogpair",
            symbol: "FROG",
            name: "Frog Coin",
            is_live: true,
            last_validated_at: "2026-04-05T11:50:00.000Z",
            validation_status: "live",
            validation_reason: null,
            last_seen_liquidity_usd: 120000,
            last_seen_volume_h24: 500000,
            last_seen_txns_h24: 920,
            icon_url: null,
            header_url: null,
            description: null,
            websites_json: [],
            socials_json: [],
            pair_address: "frogpair",
            quote_symbol: "SOL",
            quote_token_name: "Solana",
            price_usd: 0.001,
            liquidity_usd: 120000,
            volume_h24_usd: 500000,
            volume_h6_usd: 120000,
            volume_h1_usd: 22000,
            price_change_h24_pct: 12,
            price_change_h6_pct: 5,
            price_change_h1_pct: 1.5,
            buys_h24: 500,
            sells_h24: 420,
            txns_h24: 920,
            txns_h6: 210,
            txns_h1: 48,
            fdv_usd: 3500000,
            market_cap_usd: 3300000,
            pair_created_at: "2026-04-04T12:00:00.000Z",
            tradingview_symbol: null,
            tradingview_exchange: null,
            tradingview_embed_symbol: null,
            tv_resolution_status: null,
            tv_last_checked_at: null,
            tv_failure_reason: null,
            has_verified_tradingview_preview: null,
            tv_search_evidence_json: {},
            asset_metadata_json: {},
            market_metadata_json: {},
            links_json: [],
          },
        ],
      });

    const { fetchLatestCorrelatedMemecoinBoard } = await import("@/lib/dashboard/correlated-memecoins");
    const board = await fetchLatestCorrelatedMemecoinBoard({ validationMode: "stored" });

    expect(board?.rows).toHaveLength(1);
    expect(dbCapabilityMocks.getMemecoinDbCapabilities).not.toHaveBeenCalled();
    expect(liveValidationMocks.revalidateCorrelatedMemecoinRows).not.toHaveBeenCalled();
    expect(board?.diagnostics?.dbStageCounts?.rowsSubmittedForReadValidation).toBe(0);
    expect(board?.diagnostics?.liveValidationDecisionSourceCounts).toEqual({ stored_snapshot: 1 });
  });

  it("falls back to compatibility mode in stored validation mode when live validation columns are missing", async () => {
    postgresMocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 58,
            completed_at: "2026-04-05T11:59:00.000Z",
            notes_json: {},
          },
        ],
      })
      .mockRejectedValueOnce(new Error('column "is_live" does not exist'))
      .mockResolvedValueOnce({
        rows: [
          {
            run_id: 58,
            run_completed_at: "2026-04-05T11:59:00.000Z",
            asset_updated_at: "2026-04-05T11:59:00.000Z",
            rank: 1,
            correlation_score: 81.4,
            correlation_label: "High",
            strongest_topic_key: "frog",
            strongest_topic_label: "Frog",
            strongest_trend_category: "meme",
            strongest_narrative_summary: "Frog chatter",
            market_score: 69,
            dexscreener_url: "https://dexscreener.com/solana/frogpair",
            chain_id: "solana",
            token_address: "frog-token",
            asset_pair_address: "frogpair",
            symbol: "FROG",
            name: "Frog Coin",
            icon_url: null,
            header_url: null,
            description: null,
            websites_json: [],
            socials_json: [],
            pair_address: "frogpair",
            quote_symbol: "SOL",
            quote_token_name: "Solana",
            price_usd: 0.001,
            liquidity_usd: 120000,
            volume_h24_usd: 500000,
            volume_h6_usd: 120000,
            volume_h1_usd: 22000,
            price_change_h24_pct: 12,
            price_change_h6_pct: 5,
            price_change_h1_pct: 1.5,
            buys_h24: 500,
            sells_h24: 420,
            txns_h24: 920,
            txns_h6: 210,
            txns_h1: 48,
            fdv_usd: 3500000,
            market_cap_usd: 3300000,
            pair_created_at: "2026-04-04T12:00:00.000Z",
            tradingview_symbol: null,
            tradingview_exchange: null,
            tradingview_embed_symbol: null,
            tv_resolution_status: null,
            tv_last_checked_at: null,
            tv_failure_reason: null,
            has_verified_tradingview_preview: null,
            tv_search_evidence_json: {},
            asset_metadata_json: {},
            market_metadata_json: {},
            links_json: [],
          },
        ],
      });

    const { fetchLatestCorrelatedMemecoinBoard } = await import("@/lib/dashboard/correlated-memecoins");
    const board = await fetchLatestCorrelatedMemecoinBoard({ validationMode: "stored" });

    expect(board?.rows).toHaveLength(1);
    expect(dbCapabilityMocks.getMemecoinDbCapabilities).not.toHaveBeenCalled();
    expect(liveValidationMocks.revalidateCorrelatedMemecoinRows).not.toHaveBeenCalled();
    expect(board?.diagnostics?.schemaCompatibility?.assetLiveValidationColumnsAvailable).toBe(false);
    expect(String(postgresMocks.query.mock.calls[1]?.[0] ?? "")).toContain("a.is_live");
    expect(String(postgresMocks.query.mock.calls[2]?.[0] ?? "")).toContain("NULL::boolean AS is_live");
  });
});
