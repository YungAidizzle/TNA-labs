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

  it("preserves stored direct links and annotates explainability fields", async () => {
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
      match_type: "direct",
      match_score: 91,
      supporting_keywords: ["openai", "gpu"],
    });
    expect(linkedCoin?.matchReasons).toContain("Matched narrative keyword 'openai' and entity overlap on GPU.");
  });

  it("guarantees narratively aligned matches across multiple trend families when stored links are blank", async () => {
    const trends = [
      buildTrend({
        topicKey: "ai-openai-anthropic-compute",
        label: "OpenAI vs Anthropic Compute Race",
        category: "ai_tech",
        summary: "OpenAI, Anthropic, model scaling, compute limits, and GPUs are driving discourse.",
        entities: ["OpenAI", "Anthropic", "GPU"],
      }),
      buildTrend({
        topicKey: "geopolitics-conflict-escalation",
        label: "Geopolitical Conflict Escalation",
        category: "politics",
        summary: "War risk, military escalation, leaders, and country-level conflict are dominating headlines.",
        entities: ["leader", "military", "war"],
      }),
      buildTrend({
        topicKey: "macro-fed-inflation",
        label: "Fed Inflation Panic",
        category: "macro",
        summary: "Inflation, recession, debt, central bank policy, and money printing fears are back.",
        entities: ["Fed", "inflation", "recession"],
      }),
      buildTrend({
        topicKey: "celeb-media-viral-clip",
        label: "Celebrity Media Viral Clip",
        category: "entertainment",
        summary: "Celebrity interviews, creator clips, fanbase memes, and viral media reactions are spreading.",
        entities: ["celebrity", "clip", "fanbase"],
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
          id: "solana:war-token:war-pair",
          symbol: "WAR",
          name: "War Mode",
          strongestTrendKey: "macro-fear",
          strongestTrendLabel: "War Fear",
          strongestTrendCategory: "politics",
          strongestTrendSummary:
            "Military escalation, leader rhetoric, conflict, and country-risk memes are accelerating.",
          seedTerms: ["military", "conflict", "war", "leader"],
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
          id: "solana:clip-token:clip-pair",
          symbol: "CLIP",
          name: "Fandom Clip",
          strongestTrendKey: "creator-viral",
          strongestTrendLabel: "Creator Clips",
          strongestTrendCategory: "creator",
          strongestTrendSummary:
            "Streamer clips, celebrity fanbase memes, and viral interview reactions are spreading.",
          seedTerms: ["creator", "clip", "fanbase", "viral"],
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
    expect(topByTopic.get("geopolitics-conflict-escalation")?.symbol).toBe("WAR");
    expect(topByTopic.get("macro-fed-inflation")?.symbol).toBe("BRR");
    expect(topByTopic.get("celeb-media-viral-clip")?.symbol).toBe("CLIP");
    expect(topByTopic.get("crypto-native-solana-memecoin")?.symbol).toBe("PUMP");

    linkedState.leaderboard.forEach((trend) => {
      const linkedCoin = trend.linkedCoins?.[0] ?? null;
      expect(linkedCoin).not.toBeNull();
      expect(linkedCoin?.rawMatchSignals).toMatchObject({
        match_type: expect.stringMatching(/direct|inferred|fallback/),
        match_score: expect.any(Number),
        match_reason: expect.any(String),
      });
      expect(Array.isArray((linkedCoin?.rawMatchSignals as Record<string, unknown>)?.supporting_keywords)).toBe(
        true,
      );
    });
  });
});
