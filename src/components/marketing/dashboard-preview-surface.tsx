"use client";

import { useMemo, useState } from "react";
import { NarrativeTrendsTable } from "@/components/trends/narrative-trends-table";
import { MemecoinMarketTable, type MemecoinTerminalRow } from "@/components/trends/memecoin-market-table";
import { OverviewStatusStrip } from "@/components/trends/overview-status-strip";
import { SelectedCoinPanel } from "@/components/trends/selected-coin-panel";
import { TerminalCommandBar } from "@/components/trends/terminal-command-bar";
import { TerminalPanel } from "@/components/trends/terminal-panel";
import { TerminalSidebar } from "@/components/layout/terminal-sidebar";
import { getTrendDisplayNameOrPlaceholder } from "@/lib/dashboard/trend-name-state";
import { cn } from "@/lib/utils/cn";
import type { PlatformId, TimeSeriesPoint, TrendScope } from "@/types/domain";
import type {
  CorrelatedMemecoinLink,
  CorrelatedMemecoinRow,
  RankedTrend,
  TrendAttentionDriver,
  TrendPlatformBreakdown,
} from "@/types/view-models";

type PanelMode = "trend" | "all" | "momentum";

function buildAttentionHistory(values: number[]): TimeSeriesPoint[] {
  return values.map((value, index) => ({
    timestamp: new Date(Date.UTC(2026, 3, 12, index + 8, 0, 0)).toISOString(),
    value,
  }));
}

function buildPlatformBreakdown(primary: PlatformId, secondary: PlatformId): TrendPlatformBreakdown {
  return [
    {
      platformId: primary,
      interactions: 1840,
      sharePct: 62,
    },
    {
      platformId: secondary,
      interactions: 1120,
      sharePct: 38,
    },
  ];
}

function buildAttentionDrivers(primary: PlatformId, secondary: PlatformId): TrendAttentionDriver[] {
  return [
    {
      platformId: primary,
      contributionPct: 61,
      deltaPct: 24,
    },
    {
      platformId: secondary,
      contributionPct: 25,
      deltaPct: 13,
    },
  ];
}

function createTrend(input: {
  id: string;
  rank: number;
  name: string;
  description: string;
  supportingThreadCount: number;
  growthRate: number;
  attentionAcceleration: number;
  attentionScore: number;
  strength: number;
  positionChange24h: number;
  platforms: [PlatformId, PlatformId];
  lifecycleStage?: RankedTrend["lifecycleStage"];
  scope?: TrendScope;
}): RankedTrend {
  return {
    id: input.id,
    rank: input.rank,
    name: input.name,
    displayName: input.name,
    nameStatus: "ready",
    nameSource: "ai_exact",
    trendDescription: input.description,
    trendNarrativeSummary: input.description,
    trendRawLabel: input.name,
    trendFallbackLabel: input.name,
    scope: input.scope ?? "overall",
    source: "mixed",
    leaderboardMode: "established",
    attentionScore: input.attentionScore,
    attentionInteractions: input.supportingThreadCount * 22,
    rootsCount24h: input.supportingThreadCount,
    uniqueAuthors24h: Math.round(input.supportingThreadCount * 2.6),
    firstSeenAt: "2026-04-12T08:00:00.000Z",
    lastSeenAt: "2026-04-12T13:55:00.000Z",
    confidenceScore: 88,
    freshnessScore: 93,
    freshnessState: "fresh",
    sampleSize: input.supportingThreadCount * 3,
    supportingThreadCount: input.supportingThreadCount,
    lowDataWarning: false,
    growthRate: input.growthRate,
    attentionAcceleration: input.attentionAcceleration,
    mentions: input.supportingThreadCount * 18,
    platforms: [...input.platforms],
    platformSpread: input.platforms.length,
    confirmedPlatformSpread: input.platforms.length,
    attentionHistory: buildAttentionHistory([22, 28, 31, 44, 57, 63, 72]),
    platformBreakdown: buildPlatformBreakdown(input.platforms[0], input.platforms[1]),
    topPosts: [],
    lifecycleStage: input.lifecycleStage ?? "Expanding",
    originPlatform: input.platforms[0],
    platformMigrationPath: [...input.platforms],
    attentionDrivers: buildAttentionDrivers(input.platforms[0], input.platforms[1]),
    hasSpike: true,
    spikeMagnitude: 18,
    clusterId: `${input.id}-cluster`,
    clusterName: input.name,
    trendStrengthScore: input.strength,
    persistenceScore: 74,
    isEarlyTrend: true,
    positionChange24h: input.positionChange24h,
    googleSearchInterest: null,
  };
}

function createLink(topicLabel: string, linkScore: number, supportPostCount: number): CorrelatedMemecoinLink {
  return {
    topicKey: topicLabel.toLowerCase().replace(/\s+/g, "-"),
    topicLabel,
    lexicalScore: 83,
    mentionScore: 79,
    timingScore: 88,
    cultureFitScore: 76,
    linkScore,
    supportPostCount,
    supportInteractionScore: supportPostCount * 41,
    isPrimary: true,
    whyLinked: `${topicLabel} is producing repeated coin references and fast follow-on market attention.`,
    matchReasons: ["lexical overlap", "timing overlap", "community clustering"],
  };
}

function createCoin(input: {
  id: string;
  name: string;
  symbol: string;
  chainId: string;
  chainLabel: string;
  strongestTrendLabel: string;
  liquidityUsd: number;
  volume24hUsd: number;
  volume1hUsd: number;
  priceUsd: number;
  priceChange1hPct: number;
  priceChange24hPct: number;
  pairAgeHours: number;
  txns24h: number;
  momentumScore: number;
  momentumRank: number;
  momentumSignal: string;
  confidenceScore: number;
  activeLink: CorrelatedMemecoinLink;
  dexscreenerUrl: string;
  tokenAddress: string;
  pairAddress: string;
  tradingviewSymbol?: string | null;
}): MemecoinTerminalRow {
  const row: CorrelatedMemecoinRow = {
    id: input.id,
    rank: input.momentumRank,
    chainId: input.chainId,
    chainLabel: input.chainLabel,
    dexId: "raydium",
    tokenAddress: input.tokenAddress,
    pairAddress: input.pairAddress,
    name: input.name,
    symbol: input.symbol,
    quoteSymbol: "USDC",
    strongestTrendKey: input.strongestTrendLabel.toLowerCase().replace(/\s+/g, "-"),
    strongestTrendLabel: input.strongestTrendLabel,
    strongestTrendSummary: `${input.strongestTrendLabel} remains one of the fastest moving narrative clusters in the terminal.`,
    correlationScore: 89,
    correlationLabel: "high",
    marketScore: 82,
    liquidityUsd: input.liquidityUsd,
    volume24hUsd: input.volume24hUsd,
    volume6hUsd: Math.round(input.volume24hUsd * 0.42),
    volume1hUsd: input.volume1hUsd,
    priceUsd: input.priceUsd,
    priceChange1hPct: input.priceChange1hPct,
    priceChange6hPct: Math.round(input.priceChange1hPct * 2.7 * 10) / 10,
    priceChange24hPct: input.priceChange24hPct,
    pairAgeHours: input.pairAgeHours,
    buys24h: Math.round(input.txns24h * 0.58),
    sells24h: Math.round(input.txns24h * 0.42),
    txns24h: input.txns24h,
    txns6h: Math.round(input.txns24h * 0.34),
    txns1h: Math.round(input.txns24h * 0.12),
    fdvUsd: Math.round(input.liquidityUsd * 11.8),
    marketCapUsd: Math.round(input.liquidityUsd * 9.2),
    description: `${input.name} is rotating with the ${input.strongestTrendLabel.toLowerCase()} cluster.`,
    websites: [],
    socials: [],
    tradingviewSymbol: input.tradingviewSymbol ?? null,
    tradingviewExchange: input.tradingviewSymbol ? "CRYPTO" : null,
    hasVerifiedTradingviewPreview: Boolean(input.tradingviewSymbol),
    tvResolutionStatus: input.tradingviewSymbol ? "resolved" : "pending",
    isLive: true,
    lastValidatedAt: "2026-04-12T13:54:00.000Z",
    validationStatus: "verified",
    lastSeenLiquidityUsd: input.liquidityUsd,
    lastSeenVolume24hUsd: input.volume24hUsd,
    lastSeenTxns24h: input.txns24h,
    memecoinFitScore: 86,
    seedTerms: [input.strongestTrendLabel, input.symbol],
    discoverySources: ["bluesky", "reddit", "dexscreener"],
    matchedTrendKeys: [input.strongestTrendLabel.toLowerCase().replace(/\s+/g, "-")],
    communityTakeover: false,
    links: [input.activeLink],
    confidenceBand: input.confidenceScore >= 85 ? "high" : "medium",
    whyLinked: input.activeLink.whyLinked,
    matchReasons: input.activeLink.matchReasons,
    momentumScore: input.momentumScore,
    momentumRank: input.momentumRank,
    momentumSignal: input.momentumSignal,
    dexscreenerUrl: input.dexscreenerUrl,
    updatedAt: "2026-04-12T13:55:00.000Z",
  };

  return {
    row,
    activeLink: input.activeLink,
    confidenceScore: input.confidenceScore,
    related: true,
  };
}

const PREVIEW_TRENDS: RankedTrend[] = [
  createTrend({
    id: "trend-telegram-bots",
    rank: 1,
    name: "Telegram Bot Rotation",
    description: "Fresh attention is clustering around bot-linked meme launches and secondary follow-through names.",
    supportingThreadCount: 1480,
    growthRate: 27,
    attentionAcceleration: 19,
    attentionScore: 94,
    strength: 91,
    positionChange24h: 4,
    platforms: ["telegram", "bluesky"],
  }),
  createTrend({
    id: "trend-solana-launchpads",
    rank: 2,
    name: "Solana Meme Launchpads",
    description: "Launchpad-driven meme issuance is compressing discovery time and pulling liquidity into linked tickers quickly.",
    supportingThreadCount: 1216,
    growthRate: 24,
    attentionAcceleration: 17,
    attentionScore: 89,
    strength: 88,
    positionChange24h: 3,
    platforms: ["bluesky", "reddit"],
  }),
  createTrend({
    id: "trend-base-wallet",
    rank: 3,
    name: "Base Wallet Speculation",
    description: "Base-linked wallet chatter is lifting attention around ecosystem meme names and infrastructure spillover.",
    supportingThreadCount: 914,
    growthRate: 18,
    attentionAcceleration: 14,
    attentionScore: 82,
    strength: 80,
    positionChange24h: 2,
    platforms: ["bluesky", "x"],
  }),
  createTrend({
    id: "trend-listing-rumors",
    rank: 4,
    name: "Exchange Listing Rumors",
    description: "Listing rumor cycles are reactivating dormant meme names and short-window liquidity spikes.",
    supportingThreadCount: 803,
    growthRate: 15,
    attentionAcceleration: 11,
    attentionScore: 77,
    strength: 74,
    positionChange24h: 1,
    platforms: ["x", "telegram"],
  }),
  createTrend({
    id: "trend-ai-agent-revival",
    rank: 5,
    name: "AI Agent Token Revival",
    description: "Older AI meme names are reappearing inside fresh attention clusters as traders search for beta.",
    supportingThreadCount: 688,
    growthRate: 12,
    attentionAcceleration: 8,
    attentionScore: 70,
    strength: 68,
    positionChange24h: 1,
    platforms: ["bluesky", "reddit"],
  }),
];

const BONK_LINK = createLink("Solana Meme Launchpads", 92, 1840);

const PREVIEW_MEMECOINS: MemecoinTerminalRow[] = [
  createCoin({
    id: "coin-bonk",
    name: "Bonk",
    symbol: "BONK",
    chainId: "solana",
    chainLabel: "Solana",
    strongestTrendLabel: "Solana Meme Launchpads",
    liquidityUsd: 9_800_000,
    volume24hUsd: 31_400_000,
    volume1hUsd: 2_900_000,
    priceUsd: 0.0000241,
    priceChange1hPct: 11.2,
    priceChange24hPct: 29.4,
    pairAgeHours: 984,
    txns24h: 18420,
    momentumScore: 91,
    momentumRank: 1,
    momentumSignal: "volume confirmation",
    confidenceScore: 93,
    activeLink: BONK_LINK,
    dexscreenerUrl: "https://dexscreener.com/solana/dezxca1rz4yhf2fk8n1gzvxhzk8bukkf4g4ndztyprb",
    tokenAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6N7YaB1pPB263",
    pairAddress: "DezXCA1Rz4Yhf2FK8N1gZVxhzk8BUKKF4G4NdZTYprb",
    tradingviewSymbol: "CRYPTO:BONKUSD",
  }),
  createCoin({
    id: "coin-popcat",
    name: "Popcat",
    symbol: "POPCAT",
    chainId: "solana",
    chainLabel: "Solana",
    strongestTrendLabel: "Solana Meme Launchpads",
    liquidityUsd: 7_150_000,
    volume24hUsd: 18_200_000,
    volume1hUsd: 1_700_000,
    priceUsd: 0.72,
    priceChange1hPct: 5.4,
    priceChange24hPct: 17.1,
    pairAgeHours: 640,
    txns24h: 9720,
    momentumScore: 82,
    momentumRank: 2,
    momentumSignal: "early continuation",
    confidenceScore: 88,
    activeLink: createLink("Solana Meme Launchpads", 84, 1206),
    dexscreenerUrl: "https://dexscreener.com/solana/popcat",
    tokenAddress: "7GCihgDB8fe6K4MZc7XaKag4S67bQScBicYBbmNf8nrL",
    pairAddress: "98SWAB1PopcatPair111111111111111111111111111",
    tradingviewSymbol: "CRYPTO:POPCATUSD",
  }),
  createCoin({
    id: "coin-brett",
    name: "Brett",
    symbol: "BRETT",
    chainId: "base",
    chainLabel: "Base",
    strongestTrendLabel: "Base Wallet Speculation",
    liquidityUsd: 8_640_000,
    volume24hUsd: 24_100_000,
    volume1hUsd: 1_940_000,
    priceUsd: 0.081,
    priceChange1hPct: 7.8,
    priceChange24hPct: 18.8,
    pairAgeHours: 1201,
    txns24h: 12480,
    momentumScore: 79,
    momentumRank: 3,
    momentumSignal: "breakout starting",
    confidenceScore: 86,
    activeLink: createLink("Base Wallet Speculation", 81, 968),
    dexscreenerUrl: "https://dexscreener.com/base/brett",
    tokenAddress: "0x532f27101965dd16442e59d40670faf5ebb142e4",
    pairAddress: "0xBrettPair111111111111111111111111111111111111",
    tradingviewSymbol: null,
  }),
  createCoin({
    id: "coin-moodeng",
    name: "Moo Deng",
    symbol: "MOODENG",
    chainId: "solana",
    chainLabel: "Solana",
    strongestTrendLabel: "Telegram Bot Rotation",
    liquidityUsd: 5_240_000,
    volume24hUsd: 13_100_000,
    volume1hUsd: 1_180_000,
    priceUsd: 0.19,
    priceChange1hPct: 8.6,
    priceChange24hPct: 14.2,
    pairAgeHours: 184,
    txns24h: 7620,
    momentumScore: 74,
    momentumRank: 4,
    momentumSignal: "acceleration",
    confidenceScore: 79,
    activeLink: createLink("Telegram Bot Rotation", 78, 714),
    dexscreenerUrl: "https://dexscreener.com/solana/moodeng",
    tokenAddress: "MoodEng11111111111111111111111111111111111111",
    pairAddress: "MoodEngPair11111111111111111111111111111111111",
    tradingviewSymbol: null,
  }),
  createCoin({
    id: "coin-pepe",
    name: "Pepe",
    symbol: "PEPE",
    chainId: "ethereum",
    chainLabel: "Ethereum",
    strongestTrendLabel: "Exchange Listing Rumors",
    liquidityUsd: 14_200_000,
    volume24hUsd: 42_800_000,
    volume1hUsd: 3_220_000,
    priceUsd: 0.0000093,
    priceChange1hPct: 3.7,
    priceChange24hPct: 9.9,
    pairAgeHours: 2156,
    txns24h: 22600,
    momentumScore: 68,
    momentumRank: 5,
    momentumSignal: "order flow",
    confidenceScore: 73,
    activeLink: createLink("Exchange Listing Rumors", 72, 588),
    dexscreenerUrl: "https://dexscreener.com/ethereum/pepe",
    tokenAddress: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
    pairAddress: "0xPepePair111111111111111111111111111111111111",
    tradingviewSymbol: "CRYPTO:PEPEUSD",
  }),
];

const STATUS_ITEMS = [
  { label: "Active narratives", value: "248", tone: "neutral" as const },
  { label: "New narratives", value: "14", tone: "amber" as const },
  { label: "Posts/min", value: "11.8", tone: "neutral" as const },
  { label: "Linked memecoins", value: "42", tone: "green" as const },
  { label: "New coins <24h", value: "6", tone: "amber" as const },
  { label: "Last refresh", value: "19s", tone: "neutral" as const },
] as const;

const PANEL_DISCLAIMER =
  "Information only. Not personal financial advice. Data may be delayed or inaccurate.";

export function DashboardPreviewSurface() {
  const [search, setSearch] = useState("");
  const [selectedTrendId, setSelectedTrendId] = useState<string>(PREVIEW_TRENDS[1]?.id ?? PREVIEW_TRENDS[0]?.id ?? "");
  const [selectedCoinId, setSelectedCoinId] = useState<string>(PREVIEW_MEMECOINS[0]?.row.id ?? "");
  const [mode, setMode] = useState<PanelMode>("momentum");

  const filteredTrends = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return PREVIEW_TRENDS;
    }

    return PREVIEW_TRENDS.filter((trend) =>
      getTrendDisplayNameOrPlaceholder(trend).toLowerCase().includes(query),
    );
  }, [search]);

  const selectedTrend =
    filteredTrends.find((trend) => trend.id === selectedTrendId) ??
    PREVIEW_TRENDS.find((trend) => trend.id === selectedTrendId) ??
    filteredTrends[0] ??
    PREVIEW_TRENDS[0] ??
    null;

  const selectedTrendLabel = selectedTrend ? getTrendDisplayNameOrPlaceholder(selectedTrend) : null;
  const selectedCoin =
    PREVIEW_MEMECOINS.find((coin) => coin.row.id === selectedCoinId) ?? PREVIEW_MEMECOINS[0] ?? null;

  return (
    <div
      data-testid="dashboard-preview-capture"
      className="flex h-[1080px] w-[2140px] overflow-hidden border border-white/[0.08] bg-[radial-gradient(circle_at_top_left,rgba(86,217,255,0.06),transparent_18%),linear-gradient(180deg,rgba(8,12,18,0.995),rgba(4,7,11,0.998))] text-foreground shadow-[0_40px_120px_rgba(0,0,0,0.5)]"
    >
      <TerminalSidebar pathname="/trends" onOpenCommandPalette={() => undefined} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,11,16,0.985),rgba(6,9,14,0.95))] px-4 py-3">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#6f849d]">
                Live narrative monitor
              </p>
              <p className="mt-1 text-[20px] font-semibold tracking-[-0.03em] text-[#edf4ff]">
                Narrative-to-memecoin workspace
              </p>
            </div>

            <div className="flex items-center gap-6 text-[12px] uppercase tracking-[0.14em] text-[#8fa5bd]">
              <span>Range 24h</span>
              <span>Mode Established</span>
              <span>Sort Attention</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden p-3">
          <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
            <TerminalCommandBar search={search} onSearchChange={setSearch} />
            <OverviewStatusStrip items={[...STATUS_ITEMS]} />

            <section
              className={cn(
                "grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden",
                "grid-cols-[minmax(360px,0.96fr)_minmax(560px,1.32fr)_minmax(430px,1fr)]",
              )}
            >
              <div id="signals" className="min-h-0 min-w-0 overflow-hidden">
                <TerminalPanel
                  title="Narratives"
                  subtitle="Attention-ranked research table"
                  tone="cyan"
                  className="h-full min-h-0 min-w-0"
                  bodyClassName="overflow-hidden"
                  disclaimer={PANEL_DISCLAIMER}
                  action={
                    <span className="border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 font-mono text-[11px] text-[#a4b5c8]">
                      248 tracked
                    </span>
                  }
                >
                  <NarrativeTrendsTable
                    rows={filteredTrends}
                    selectedId={selectedTrend?.id ?? null}
                    onSelect={setSelectedTrendId}
                  />
                </TerminalPanel>
              </div>

              <div id="memecoins" className="min-h-0 min-w-0 overflow-hidden">
                <TerminalPanel
                  title="Memecoins"
                  subtitle="Linked memecoins ranked by momentum"
                  tone="neutral"
                  className="h-full min-h-0 min-w-0"
                  bodyClassName="overflow-hidden"
                  disclaimer={PANEL_DISCLAIMER}
                >
                  <MemecoinMarketTable
                    rows={PREVIEW_MEMECOINS}
                    selectedCoinId={selectedCoin?.row.id ?? null}
                    selectedTrendLabel={selectedTrendLabel}
                    mode={mode}
                    onModeChange={setMode}
                    onSelectCoin={setSelectedCoinId}
                  />
                </TerminalPanel>
              </div>

              <div id="validation" className="min-h-0 min-w-0 overflow-hidden">
                <TerminalPanel
                  title="Validation"
                  subtitle="Selected asset market context"
                  tone="emerald"
                  className="h-full min-h-0 min-w-0"
                  bodyClassName="overflow-hidden"
                  disclaimer={PANEL_DISCLAIMER}
                  action={
                    selectedCoin ? (
                      <span className="border border-emerald/25 bg-emerald/10 px-2 py-1.5 font-mono text-[11px] text-emerald">
                        {selectedCoin.row.symbol}
                      </span>
                    ) : null
                  }
                >
                  <SelectedCoinPanel selectedCoin={selectedCoin} allowMarketPreview={false} />
                </TerminalPanel>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
