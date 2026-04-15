import { beforeEach, describe, expect, it, vi } from "vitest";

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
    revalidateNarrativeLinkedCoins: vi.fn(async (coins: unknown[]) => ({
      liveCoins: Array.isArray(coins) ? coins : [],
      rejected: [] as Array<{ coin: unknown; reason: string | null }>,
      stats: {
        attempted: Array.isArray(coins) ? coins.length : 0,
        liveCoins: Array.isArray(coins) ? coins.length : 0,
        rejected: 0,
        rejectReasonCounts: {},
        decisionSourceCounts: { network: Array.isArray(coins) ? coins.length : 0 },
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
      refreshedAt: "2026-04-13T12:00:00.000Z",
    })),
  };
});

vi.mock("@/lib/db/server-postgres", () => postgresMocks);
vi.mock("@/lib/dashboard/dexscreener-live-validation", () => liveValidationMocks);
vi.mock("@/lib/dashboard/memecoin-db-capabilities", () => dbCapabilityMocks);

import { createZeroRankedTrend, createZeroTrendDashboardVM } from "@/lib/dashboard/zero-state";
import { attachTrendMemecoinLinks } from "@/lib/dashboard/trend-memecoin-links";
import { CorrelatedMemecoinBoard, CorrelatedMemecoinRow, RankedTrend } from "@/types/view-models";

function buildTrend(params: {
  topicKey: string;
  label: string;
  category: string;
  summary: string;
  description?: string;
  entities?: string[];
}) {
  const row = createZeroRankedTrend("overall", "24h");
  const label = params.label;

  return {
    ...row,
    id: `trend:${params.topicKey}`,
    rank: 1,
    name: label,
    displayName: label,
    nameStatus: "ready",
    nameSource: "ai_exact",
    canonicalKeySummary: params.topicKey,
    trendCategory: params.category,
    trendRawLabel: label,
    trendFallbackLabel: label,
    trendDescription: params.description ?? params.summary,
    trendContextParagraph: params.summary,
    trendNarrativeSummary: params.summary,
    trendKeyEntities: params.entities ?? [label],
    linkedCoins: [],
  } satisfies RankedTrend;
}

function buildState(trends: RankedTrend[]) {
  const state = createZeroTrendDashboardVM({
    scope: "overall",
    range: "24h",
    sort: "posts",
    mode: "established",
  });

  return {
    ...state,
    leaderboard: trends,
    leaderboards: {
      established: trends,
      emerging: [],
    },
  };
}

function buildBoardRow(params: {
  id: string;
  symbol: string;
  name: string;
  strongestTrendKey: string;
  strongestTrendLabel: string;
  strongestTrendCategory: string;
  strongestTrendSummary: string;
  seedTerms?: string[];
  matchedTrendKeys?: string[];
}) {
  return {
    id: params.id,
    rank: 1,
    chainId: "solana",
    chainLabel: "Solana",
    tokenAddress: `${params.symbol.toLowerCase()}-token`,
    pairAddress: `${params.symbol.toLowerCase()}-pair`,
    name: params.name,
    symbol: params.symbol,
    strongestTrendKey: params.strongestTrendKey,
    strongestTrendLabel: params.strongestTrendLabel,
    strongestTrendCategory: params.strongestTrendCategory,
    strongestTrendSummary: params.strongestTrendSummary,
    correlationScore: 72,
    correlationLabel: "High",
    marketScore: 68,
    liquidityUsd: 180_000,
    volume24hUsd: 720_000,
    priceUsd: 0.0012,
    priceChange1hPct: 2.1,
    priceChange6hPct: 9.2,
    priceChange24hPct: 21.4,
    pairAgeHours: 72,
    marketCapUsd: 9_200_000,
    fdvUsd: 9_500_000,
    description: params.strongestTrendSummary,
    seedTerms: params.seedTerms ?? [],
    matchedTrendKeys: params.matchedTrendKeys ?? [],
    links: [],
    dexscreenerUrl: `https://dexscreener.com/solana/${params.symbol.toLowerCase()}-pair`,
    updatedAt: "2026-04-13T12:00:00.000Z",
  } satisfies CorrelatedMemecoinRow;
}

describe("trend memecoin linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postgresMocks.query.mockReset();
    postgresMocks.hasDatabaseUrl.mockReturnValue(true);
    liveValidationMocks.revalidateNarrativeLinkedCoins.mockImplementation(async (coins: unknown[]) => ({
      liveCoins: Array.isArray(coins) ? coins : [],
      rejected: [],
      stats: {
        attempted: Array.isArray(coins) ? coins.length : 0,
        liveCoins: Array.isArray(coins) ? coins.length : 0,
        rejected: 0,
        rejectReasonCounts: {},
        decisionSourceCounts: { network: Array.isArray(coins) ? coins.length : 0 },
        fallbackReasonCounts: {},
      },
    }));
  });

  it("preserves stored explicit-origin links and annotates explainability fields", async () => {
    const aiTrend = buildTrend({
      topicKey: "ai-openai-compute-race",
      label: "OpenAI Compute Race",
      category: "ai_tech",
      summary: "OpenAI, Anthropic, compute limits, and GPU demand are dominating attention.",
      entities: ["OpenAI", "Anthropic", "GPU"],
    });
    const state = buildState([aiTrend]);

    postgresMocks.query.mockResolvedValueOnce({
      rows: [
        {
          topic_key: "ai-openai-compute-race",
          rank: 1,
          chain_id: "solana",
          coin_address: "oai-token",
          pair_address: "oai-pair",
          dexscreener_url: "https://dexscreener.com/solana/oai-pair",
          coin_symbol: "OAI",
          coin_name: "OpenAI Dog",
          confidence_score: 91,
          confidence_band: "high",
          mention_count: 3,
          engagement_score: 12,
          age_hours: 96,
          liquidity: 210000,
          volume_24h: 910000,
          market_score: 74,
          memecoin_fit_score: 66,
          why_linked: "Matched narrative keyword 'openai' and entity overlap on GPU.",
          match_reasons_json: ["matched narrative keyword 'openai'"],
          raw_match_signals_json: {
            exact_overlap_count: 1,
            exact_overlap_terms: ["openai"],
            seed_overlap_count: 1,
            seed_overlap_terms: ["gpu"],
          },
          last_updated_at: "2026-04-13T12:00:00.000Z",
          is_live: true,
          last_validated_at: "2026-04-13T12:00:00.000Z",
          validation_status: "live",
          validation_reason: null,
          last_seen_liquidity_usd: 210000,
          last_seen_volume_h24: 910000,
          last_seen_txns_h24: 1400,
        },
      ],
    });

    const linkedState = await attachTrendMemecoinLinks(state, null);
    const linkedCoin = linkedState.leaderboard[0]?.linkedCoins?.[0];

    expect(linkedCoin?.symbol).toBe("OAI");
    expect(linkedCoin?.rawMatchSignals).toMatchObject({
      match_type: "explicit_origin",
      match_score: expect.any(Number),
    });
    expect(
      Array.isArray((linkedCoin?.rawMatchSignals as Record<string, unknown>)?.supporting_keywords),
    ).toBe(true);
    expect(
      ((linkedCoin?.rawMatchSignals as Record<string, unknown>)?.supporting_keywords as string[] | undefined) ?? [],
    ).toContain("openai");
    expect(linkedCoin?.matchReasons).toContain("Matched narrative keyword 'openai' and entity overlap on GPU.");
  });

  it("only surfaces direct name-style matches and drops broad thematic families when stored links are blank", async () => {
    const trends = [
      buildTrend({
        topicKey: "ai-openai-anthropic-compute",
        label: "OpenAI Anthropic Race",
        category: "ai_tech",
        summary: "OpenAI, Anthropic, model scaling, compute limits, and GPUs are driving discourse.",
        entities: ["OpenAI", "Anthropic", "GPU"],
      }),
      buildTrend({
        topicKey: "geopolitics-iran-escalation",
        label: "Iran Escalation Risk",
        category: "politics",
        summary: "Iran missile threats and escalation risk are dominating geopolitical headlines.",
        entities: ["Iran", "missile", "escalation"],
      }),
      buildTrend({
        topicKey: "macro-fed-inflation",
        label: "Fed Inflation Panic",
        category: "macro",
        summary: "Inflation, recession, debt, central bank policy, and money printing fears are back.",
        entities: ["Fed", "inflation", "recession"],
      }),
      buildTrend({
        topicKey: "politics-trump-maga",
        label: "Trump MAGA Push",
        category: "politics",
        summary: "Trump, MAGA slogans, and campaign messaging are dominating political chatter.",
        entities: ["Trump", "MAGA", "campaign"],
      }),
      buildTrend({
        topicKey: "celeb-media-viral-clip",
        label: "Taylor Media Spiral",
        category: "entertainment",
        summary: "Taylor Swift interview clips and fanbase media reactions are spreading fast.",
        entities: ["Taylor Swift", "interview clip", "fanbase"],
      }),
      buildTrend({
        topicKey: "crypto-native-solana-memecoin",
        label: "Solana Memecoin Rotation",
        category: "crypto",
        summary: "Solana, memecoin rotation, onchain traders, and pump culture are leading crypto chatter.",
        entities: ["Solana", "memecoin", "onchain"],
      }),
    ];
    const state = buildState(trends);

    postgresMocks.query.mockResolvedValueOnce({ rows: [] });

    const correlatedMemecoins: CorrelatedMemecoinBoard = {
      runId: 501,
      updatedAt: "2026-04-13T12:00:00.000Z",
      rows: [
        buildBoardRow({
          id: "solana:oai-token:oai-pair",
          symbol: "OAI",
          name: "OpenAI Dog",
          strongestTrendKey: "ai-agents",
          strongestTrendLabel: "AI Agents",
          strongestTrendCategory: "ai_tech",
          strongestTrendSummary:
            "OpenAI, Claude, GPU, compute, and agent memes are dominating the tape.",
          seedTerms: ["openai", "compute", "gpu", "agent"],
        }),
        buildBoardRow({
          id: "solana:iran-token:iran-pair",
          symbol: "IRAN",
          name: "Iran Risk",
          strongestTrendKey: "iran-escalation",
          strongestTrendLabel: "Iran Escalation",
          strongestTrendCategory: "politics",
          strongestTrendSummary:
            "Iran missile headlines and escalation memes are accelerating this launch story.",
          seedTerms: ["iran", "missile", "escalation"],
        }),
        buildBoardRow({
          id: "solana:brr-token:brr-pair",
          symbol: "BRR",
          name: "Printer Go Brr",
          strongestTrendKey: "anti-fiat",
          strongestTrendLabel: "Anti-Fiat",
          strongestTrendCategory: "finance",
          strongestTrendSummary:
            "Anti-fiat, central bank debasement, debt, and printer memes keep showing up.",
          seedTerms: ["fiat", "printer", "debasement", "central bank"],
        }),
        buildBoardRow({
          id: "solana:maga-token:maga-pair",
          symbol: "MAGA",
          name: "MAGA Coin",
          strongestTrendKey: "trump-rally",
          strongestTrendLabel: "Trump Rally",
          strongestTrendCategory: "politics",
          strongestTrendSummary:
            "Trump campaign slogans, MAGA chants, and election memes are driving this coin.",
          seedTerms: ["trump", "maga", "campaign"],
        }),
        buildBoardRow({
          id: "solana:swift-token:swift-pair",
          symbol: "SWIFT",
          name: "Taylor Swift Coin",
          strongestTrendKey: "taylor-clip",
          strongestTrendLabel: "Taylor Clip",
          strongestTrendCategory: "creator",
          strongestTrendSummary:
            "Taylor Swift interview clips and fan reactions are driving this coin narrative.",
          seedTerms: ["taylor", "swift", "clip", "fanbase"],
        }),
        buildBoardRow({
          id: "solana:pump-token:pump-pair",
          symbol: "PUMP",
          name: "Sol Pump",
          strongestTrendKey: "solana-rotation",
          strongestTrendLabel: "Solana Rotation",
          strongestTrendCategory: "crypto",
          strongestTrendSummary:
            "Solana onchain traders are rotating into memecoins and pump culture again.",
          seedTerms: ["solana", "memecoin", "onchain", "pump"],
        }),
      ],
      diagnostics: null,
    };

    const linkedState = await attachTrendMemecoinLinks(state, correlatedMemecoins);
    const topByTopic = new Map(
      linkedState.leaderboard.map((trend) => [trend.canonicalKeySummary, trend.linkedCoins?.[0] ?? null] as const),
    );

    expect(topByTopic.get("ai-openai-anthropic-compute")?.symbol).toBe("OAI");
    expect(topByTopic.get("geopolitics-iran-escalation")?.symbol).toBe("IRAN");
    expect(topByTopic.get("macro-fed-inflation")).toBeNull();
    expect(topByTopic.get("politics-trump-maga")?.symbol).toBe("MAGA");
    expect(topByTopic.get("celeb-media-viral-clip")?.symbol).toBe("SWIFT");
    expect(topByTopic.get("crypto-native-solana-memecoin")).toBeNull();

    linkedState.leaderboard
      .filter((trend) => (trend.linkedCoins?.length ?? 0) > 0)
      .forEach((trend) => {
      const linkedCoin = trend.linkedCoins?.[0] ?? null;
      expect(linkedCoin).not.toBeNull();
      expect(linkedCoin?.rawMatchSignals).toMatchObject({
        match_type: expect.stringMatching(/explicit_origin|strong_narrative/),
        match_score: expect.any(Number),
        match_reason: expect.any(String),
      });
      expect(Array.isArray((linkedCoin?.rawMatchSignals as Record<string, unknown>)?.supporting_keywords)).toBe(
        true,
      );
    });
  });

  it("prioritizes exact narrative-origin coins over broad thematic coins", async () => {
    const trend = buildTrend({
      topicKey: "openai-media-push",
      label: "OpenAI Media Push",
      category: "ai_tech",
      summary: "OpenAI media partnerships and ChatGPT distribution talks are back in focus.",
      entities: ["OpenAI", "ChatGPT"],
    });
    const state = buildState([trend]);

    postgresMocks.query.mockResolvedValueOnce({ rows: [] });

    const correlatedMemecoins: CorrelatedMemecoinBoard = {
      runId: 777,
      updatedAt: "2026-04-13T12:00:00.000Z",
      rows: [
        buildBoardRow({
          id: "solana:oai-token:oai-pair",
          symbol: "OAI",
          name: "OpenAI Dog",
          strongestTrendKey: "openai-media-push",
          strongestTrendLabel: "OpenAI Media Push",
          strongestTrendCategory: "ai_tech",
          strongestTrendSummary:
            "OpenAI and ChatGPT media distribution rumors are driving this launch narrative.",
          seedTerms: ["openai", "chatgpt", "media"],
          matchedTrendKeys: ["openai-media-push"],
        }),
        buildBoardRow({
          id: "solana:gai-token:gai-pair",
          symbol: "GAI",
          name: "Generic AI",
          strongestTrendKey: "ai-agents",
          strongestTrendLabel: "AI Agents",
          strongestTrendCategory: "ai_tech",
          strongestTrendSummary:
            "Generic agent and compute chatter without any OpenAI or ChatGPT origin story.",
          seedTerms: ["ai", "agents", "compute"],
          matchedTrendKeys: ["ai-agents"],
        }),
      ],
      diagnostics: null,
    };

    const linkedState = await attachTrendMemecoinLinks(state, correlatedMemecoins);
    const linkedCoins = linkedState.leaderboard[0]?.linkedCoins ?? [];

    expect(linkedCoins[0]?.symbol).toBe("OAI");
    expect(linkedCoins[0]?.rawMatchSignals).toMatchObject({
      match_type: "explicit_origin",
    });
    expect(linkedCoins.some((coin) => coin.symbol === "GAI")).toBe(false);
  });

  it("returns no linked coin for category-only matches when no exact narrative coin exists", async () => {
    const trend = buildTrend({
      topicKey: "fed-inflation-jitters",
      label: "Fed Inflation Jitters",
      category: "macro",
      summary: "Macro chatter is rising around inflation, rates, and central bank risk.",
      entities: ["Fed", "inflation"],
    });
    const state = buildState([trend]);

    postgresMocks.query.mockResolvedValueOnce({ rows: [] });

    const correlatedMemecoins: CorrelatedMemecoinBoard = {
      runId: 778,
      updatedAt: "2026-04-13T12:00:00.000Z",
      rows: [
        buildBoardRow({
          id: "solana:econ-token:econ-pair",
          symbol: "ECON",
          name: "Macro Mood",
          strongestTrendKey: "macro-fear",
          strongestTrendLabel: "Macro Fear",
          strongestTrendCategory: "finance",
          strongestTrendSummary:
            "Generic economy and inflation chatter without a specific event-origin coin story.",
          seedTerms: ["economy", "inflation", "macro"],
          matchedTrendKeys: ["macro-fear"],
        }),
      ],
      diagnostics: null,
    };

    const linkedState = await attachTrendMemecoinLinks(state, correlatedMemecoins);
    const linkedCoin = linkedState.leaderboard[0]?.linkedCoins?.[0] ?? null;

    expect(linkedCoin).toBeNull();
  });
});
