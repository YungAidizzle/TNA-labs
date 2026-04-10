"use client";

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NarrativeTrendsTable } from "@/components/trends/narrative-trends-table";
import { MemecoinMarketTable, MemecoinTerminalRow } from "@/components/trends/memecoin-market-table";
import { OverviewStatusStrip } from "@/components/trends/overview-status-strip";
import { SelectedCoinPanel } from "@/components/trends/selected-coin-panel";
import { TerminalPanel } from "@/components/trends/terminal-panel";
import { dashboardClient } from "@/lib/dashboard/client";
import { resolveSelectedLiveMemecoinId } from "@/lib/dashboard/memecoin-selection";
import {
  getMemecoinConfidenceScore,
  getNarrativeCoinOpportunities,
  getNarrativeLinkForCoin,
  getNarrativeTopicKey,
  getNewMemecoinCount,
} from "@/lib/dashboard/memecoin-opportunities";
import { reconcileTrendDashboardVM } from "@/lib/dashboard/reconcile";
import { getTrendDisplayNameOrPlaceholder } from "@/lib/dashboard/trend-name-state";
import { resolveSelectedTrendId } from "@/lib/dashboard/trend-selection-state";
import { formatCompactNumber, formatRelativeTimeShort } from "@/lib/formatters";
import { deriveBlueskyLiveStatus } from "@/lib/utils/bluesky-live-status";
import { getTrendPostCount } from "@/lib/utils/trend-ranking";
import { cn } from "@/lib/utils/cn";
import { DateRangePreset, TrendScope } from "@/types/domain";
import {
  TrendDashboardQuery,
  TrendDashboardVM,
  TrendLeaderboardMode,
  TrendSort,
} from "@/types/view-models";
import {
  TREND_DASHBOARD_LAYOUT_CLASS_NAME,
  TREND_DASHBOARD_WORKSPACE_CLASS_NAME,
  TrendDashboardLoadingShell,
} from "@/features/trends/trend-dashboard-loading-shell";

const SORT_OPTIONS: TrendSort[] = [
  "posts",
  "attention",
  "growth",
  "mentions",
  "strength",
  "breakout",
  "velocity",
  "novelty",
  "confirmation",
];
const DEFAULT_SUPABASE_REFRESH_MS = 60_000;
const ADAPTIVE_DELAYED_REFRESH_MS = 60_000;
const ADAPTIVE_STALE_REFRESH_MS = 120_000;
const RANGE_PRESETS: DateRangePreset[] = ["1h", "6h", "24h", "7d"];
type CoinTableMode = "trend" | "all" | "momentum";

function getDefaultSortForMode(): TrendDashboardQuery["sort"] {
  return "posts";
}

function resolveSort(value: string | null): TrendSort {
  if (value && SORT_OPTIONS.includes(value as TrendSort)) {
    return value as TrendSort;
  }

  return getDefaultSortForMode();
}

function parseRefreshMs(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(300_000, Math.max(15_000, parsed));
}

function resolveRangePreset(value: string | null): DateRangePreset {
  if (value && RANGE_PRESETS.includes(value as DateRangePreset)) {
    return value as DateRangePreset;
  }

  return "24h";
}

function resolveAdaptiveRefreshMs(baseRefreshMs: number, dashboard: TrendDashboardVM | null | undefined) {
  if (!dashboard) {
    return baseRefreshMs;
  }

  const replayWindow = dashboard.blueskyOverview?.replayWindow ?? null;
  const streamStatus = deriveBlueskyLiveStatus({
    lastAggregateRefreshAt: dashboard.dataStatus?.sourceSnapshotGeneratedAt ?? null,
    detailLatestPointAt: replayWindow?.latestPointAt ?? null,
    detailStaleGapMinutes: replayWindow?.staleGapMinutes ?? null,
    workerHeartbeatAt: dashboard.dataStatus?.freshnessDiagnostics?.workerHeartbeatAt ?? null,
    pipelineHealthState: dashboard.dataStatus?.freshnessDiagnostics?.pipelineHealthState ?? null,
    streamLagSeconds:
      typeof dashboard.dataStatus?.freshnessDiagnostics?.pipelineLagSeconds === "number"
        ? Math.max(0, Math.round(dashboard.dataStatus.freshnessDiagnostics.pipelineLagSeconds))
        : typeof dashboard.blueskyOverview?.firehoseLagMinutes === "number"
          ? Math.max(0, Math.round(dashboard.blueskyOverview.firehoseLagMinutes * 60))
          : null,
  });

  if (streamStatus.state === "live") {
    return baseRefreshMs;
  }

  if (streamStatus.state === "delayed" || streamStatus.state === "degraded") {
    return Math.max(baseRefreshMs, ADAPTIVE_DELAYED_REFRESH_MS);
  }

  return Math.max(baseRefreshMs, ADAPTIVE_STALE_REFRESH_MS);
}

function isFreshWithinHours(
  value: string | null | undefined,
  referenceTime: string | null | undefined,
  hours: number,
) {
  const timestamp = Date.parse(value ?? "");
  const referenceTimestamp = Date.parse(referenceTime ?? "");
  if (!Number.isFinite(timestamp) || !Number.isFinite(referenceTimestamp)) {
    return false;
  }

  return referenceTimestamp - timestamp <= hours * 3_600_000;
}

function sortAllMemecoinRows(left: MemecoinTerminalRow, right: MemecoinTerminalRow) {
  if (left.related !== right.related) {
    return left.related ? -1 : 1;
  }

  if (right.confidenceScore !== left.confidenceScore) {
    return right.confidenceScore - left.confidenceScore;
  }

  const volumeDelta = Number(right.row.volume24hUsd ?? 0) - Number(left.row.volume24hUsd ?? 0);
  if (volumeDelta !== 0) {
    return volumeDelta;
  }

  const liquidityDelta = Number(right.row.liquidityUsd ?? 0) - Number(left.row.liquidityUsd ?? 0);
  if (liquidityDelta !== 0) {
    return liquidityDelta;
  }

  return left.row.rank - right.row.rank;
}

function sortMomentumMemecoinRows(left: MemecoinTerminalRow, right: MemecoinTerminalRow) {
  const momentumRankDelta = Number(left.row.momentumRank ?? Number.MAX_SAFE_INTEGER) - Number(right.row.momentumRank ?? Number.MAX_SAFE_INTEGER);
  if (momentumRankDelta !== 0) {
    return momentumRankDelta;
  }

  const momentumScoreDelta = Number(right.row.momentumScore ?? 0) - Number(left.row.momentumScore ?? 0);
  if (momentumScoreDelta !== 0) {
    return momentumScoreDelta;
  }

  const recentVolumeDelta = Number(right.row.volume1hUsd ?? 0) - Number(left.row.volume1hUsd ?? 0);
  if (recentVolumeDelta !== 0) {
    return recentVolumeDelta;
  }

  const recentTxnDelta = Number(right.row.txns1h ?? 0) - Number(left.row.txns1h ?? 0);
  if (recentTxnDelta !== 0) {
    return recentTxnDelta;
  }

  return sortAllMemecoinRows(left, right);
}

type TrendDashboardPageProps = {
  scope: TrendScope;
  initialSelectedId?: string | null;
  showHeatmap?: boolean;
};

export function TrendDashboardPage({
  scope,
  initialSelectedId = null,
}: TrendDashboardPageProps) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const lastFreshnessVersionRef = useRef<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [displayedDashboard, setDisplayedDashboard] = useState<TrendDashboardVM | null>(null);
  const [manualSelectedTrendId, setManualSelectedTrendId] = useState<string | null>(null);
  const [manualSelectedCoinId, setManualSelectedCoinId] = useState<string | null>(null);
  const [coinTableMode, setCoinTableMode] = useState<CoinTableMode>("momentum");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const range = resolveRangePreset(searchParams.get("range"));
  const mode: TrendLeaderboardMode = "established";
  const sort = resolveSort(searchParams.get("sort"));

  const searchSelectedId = searchParams.get("selected") ?? initialSelectedId ?? undefined;
  const requestedSelectedId = manualSelectedTrendId ?? searchSelectedId;
  const baseQuery = useMemo<TrendDashboardQuery>(
    () => ({
      scope,
      range,
      mode,
      sort,
      selectedId: undefined,
    }),
    [scope, range, sort],
  );

  const supabaseRefreshMs = parseRefreshMs(
    process.env.NEXT_PUBLIC_TRENDS_REFRESH_MS,
    DEFAULT_SUPABASE_REFRESH_MS,
  );
  const summaryQueryKey = useMemo(() => ["trend-dashboard-summary", baseQuery] as const, [baseQuery]);
  const {
    data: summaryDashboard,
    isLoading: isSummaryLoading,
    isPlaceholderData,
  } = useQuery({
    queryKey: summaryQueryKey,
    queryFn: ({ signal }) =>
      dashboardClient.getTrendDashboardSummaryVM(baseQuery, {
        previousData: queryClient.getQueryData<TrendDashboardVM>(summaryQueryKey) ?? undefined,
        signal,
      }),
    placeholderData: (previousData) => previousData,
    staleTime: supabaseRefreshMs,
    refetchInterval: (query) =>
      resolveAdaptiveRefreshMs(supabaseRefreshMs, query.state.data as TrendDashboardVM | undefined),
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    notifyOnChangeProps: ["data", "isLoading", "isPlaceholderData"],
  });

  const resolvedSelectedId = useMemo(
    () =>
      resolveSelectedTrendId({
        leaderboard: summaryDashboard?.leaderboard ?? [],
        requestedSelectedId,
        fallbackSelectedId: summaryDashboard?.query.selectedId,
      }),
    [requestedSelectedId, summaryDashboard],
  );

  useEffect(() => {
    if (!summaryDashboard) {
      return;
    }

    startTransition(() => {
      setDisplayedDashboard((previousDashboard) => {
        if (!previousDashboard) {
          return summaryDashboard;
        }

        return reconcileTrendDashboardVM(previousDashboard, summaryDashboard, {
          preserveSelectedDetailId: resolvedSelectedId,
        });
      });
    });
  }, [resolvedSelectedId, summaryDashboard]);

  const renderedDashboard = useDeferredValue(displayedDashboard ?? summaryDashboard ?? null);

  const replaceDashboardQuery = useCallback(
    (updates: Record<string, string | null>) => {
      if (typeof window === "undefined") {
        return;
      }

      const nextParams = new URLSearchParams(window.location.search);
      Object.entries(updates).forEach(([key, value]) => {
        if (value) {
          nextParams.set(key, value);
        } else {
          nextParams.delete(key);
        }
      });

      const queryString = nextParams.toString();
      const nextUrl = queryString ? `${pathname}?${queryString}` : pathname;
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      if (currentUrl !== nextUrl) {
        window.history.replaceState(window.history.state, "", nextUrl);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    },
    [pathname],
  );

  useEffect(() => {
    if (isPlaceholderData || !resolvedSelectedId) {
      return;
    }

    if (searchSelectedId === resolvedSelectedId) {
      return;
    }

    const selectedTrendStillVisible = searchSelectedId
      ? renderedDashboard?.leaderboard.some((trend) => trend.id === searchSelectedId) ?? false
      : false;

    if (selectedTrendStillVisible) {
      return;
    }

    replaceDashboardQuery({
      selected: resolvedSelectedId,
      range,
    });
  }, [
    isPlaceholderData,
    range,
    renderedDashboard?.leaderboard,
    replaceDashboardQuery,
    resolvedSelectedId,
    searchSelectedId,
  ]);

  const handleSelect = (id: string) => {
    if (id === resolvedSelectedId && searchSelectedId === id) {
      return;
    }

    setManualSelectedTrendId(id);
    setManualSelectedCoinId(null);
    replaceDashboardQuery({
      selected: id,
      range,
    });
  };

  const allRows = useMemo(() => renderedDashboard?.leaderboard ?? [], [renderedDashboard?.leaderboard]);
  const filteredRows = useMemo(() => {
    const filter = deferredSearchTerm.trim().toLowerCase();
    if (!filter) {
      return allRows;
    }

    return allRows.filter((row) => {
      const haystack = `${getTrendDisplayNameOrPlaceholder(row)} ${row.trendDescription ?? ""}`.toLowerCase();
      return haystack.includes(filter);
    });
  }, [allRows, deferredSearchTerm]);

  const selectedNarrative =
    allRows.find((trend) => trend.id === resolvedSelectedId) ?? allRows[0] ?? null;
  const selectedNarrativeTopicKey = selectedNarrative ? getNarrativeTopicKey(selectedNarrative) : null;
  const referenceTime =
    renderedDashboard?.dataStatus?.serverNow ??
    renderedDashboard?.dataStatus?.latestFetchedAt ??
    renderedDashboard?.correlatedMemecoins?.updatedAt ??
    null;

  const correlatedMemecoinRows = useMemo(
    () => renderedDashboard?.correlatedMemecoins?.rows ?? [],
    [renderedDashboard?.correlatedMemecoins?.rows],
  );
  const prelinkedCoins = useMemo(() => {
    const deduped = new Map<string, NonNullable<(typeof allRows)[number]["linkedCoins"]>[number]>();
    allRows.forEach((row) => {
      (row.linkedCoins ?? []).forEach((coin) => {
        const key = `${coin.chainId ?? "unknown"}:${coin.address}`;
        if (!deduped.has(key)) {
          deduped.set(key, coin);
        }
      });
    });
    return [...deduped.values()];
  }, [allRows]);
  const narrativeOpportunities = useMemo(
    () => getNarrativeCoinOpportunities(selectedNarrative, correlatedMemecoinRows),
    [correlatedMemecoinRows, selectedNarrative],
  );
  const filteredMemecoinRows = useMemo<MemecoinTerminalRow[]>(
    () =>
      narrativeOpportunities.map((item) => ({
        row: item.row,
        activeLink: item.activeLink,
        confidenceScore: item.confidenceScore,
        related: true,
      })),
    [narrativeOpportunities],
  );
  const marketUniverseRows = useMemo<MemecoinTerminalRow[]>(
    () =>
      correlatedMemecoinRows
        .map((row) => {
          const selectedNarrativeLink = selectedNarrativeTopicKey
            ? getNarrativeLinkForCoin(row, selectedNarrativeTopicKey)
            : null;
          const strongestLink =
            getNarrativeLinkForCoin(row, row.strongestTrendKey) ??
            row.links?.find((link) => link.isPrimary) ??
            row.links?.[0] ??
            null;
          const activeLink = selectedNarrativeLink ?? strongestLink;
          const confidenceScore = getMemecoinConfidenceScore(
            row,
            activeLink?.topicKey ?? row.strongestTrendKey,
          );

          return {
            row,
            activeLink,
            confidenceScore,
            related: Boolean(selectedNarrativeLink),
          } satisfies MemecoinTerminalRow;
        }),
    [correlatedMemecoinRows, selectedNarrativeTopicKey],
  );
  const allMemecoinRows = useMemo<MemecoinTerminalRow[]>(
    () => [...marketUniverseRows].sort(sortAllMemecoinRows),
    [marketUniverseRows],
  );
  const momentumMemecoinRows = useMemo<MemecoinTerminalRow[]>(
    () => [...marketUniverseRows].sort(sortMomentumMemecoinRows),
    [marketUniverseRows],
  );
  const displayedMemecoinRows =
    coinTableMode === "trend"
      ? filteredMemecoinRows
      : coinTableMode === "momentum"
        ? momentumMemecoinRows
        : allMemecoinRows;
  useEffect(() => {
    console.info("[trend-dashboard] memecoin display counts", {
      board_rows: correlatedMemecoinRows.length,
      filtered_rows: filteredMemecoinRows.length,
      all_rows: allMemecoinRows.length,
      momentum_rows: momentumMemecoinRows.length,
      displayed_rows: displayedMemecoinRows.length,
      table_mode: coinTableMode,
      selected_narrative_topic_key: selectedNarrativeTopicKey,
    });
  }, [
    allMemecoinRows.length,
    coinTableMode,
    correlatedMemecoinRows.length,
    displayedMemecoinRows.length,
    filteredMemecoinRows.length,
    momentumMemecoinRows.length,
    selectedNarrativeTopicKey,
  ]);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      return;
    }

    console.info(
      "[memecoin-preview-row-inputs]",
      displayedMemecoinRows.map(({ row, activeLink, related }) => ({
        coinId: row.id,
        chainId: row.chainId,
        dexId: row.dexId ?? null,
        pairAddress: row.pairAddress || null,
        tokenAddress: row.tokenAddress || null,
        pairUrl: row.dexscreenerUrl || null,
        symbolTextShownInUi: row.quoteSymbol ? `${row.symbol}/${row.quoteSymbol}` : row.symbol,
        storedTradingviewSymbol: row.tradingviewSymbol ?? null,
        hasVerifiedTradingviewPreview: row.hasVerifiedTradingviewPreview ?? null,
        tvResolutionStatus: row.tvResolutionStatus ?? null,
        previewProviderSelected: "deferred_until_selected",
        failureReason: null,
        fallbackTriggeredBeforeMountCompleted: false,
        relatedToSelectedNarrative: related,
        activeNarrativeKey: activeLink?.topicKey ?? null,
      })),
    );
  }, [displayedMemecoinRows]);
  const newMemecoinCount = useMemo(() => {
    if (prelinkedCoins.length === 0) {
      return getNewMemecoinCount(correlatedMemecoinRows);
    }
    return prelinkedCoins.filter(
      (coin) => typeof coin.age === "number" && Number.isFinite(coin.age) && coin.age < 24,
    ).length;
  }, [correlatedMemecoinRows, prelinkedCoins]);
  const selectedCoinId = resolveSelectedLiveMemecoinId(displayedMemecoinRows, manualSelectedCoinId);
  const selectedCoin =
    displayedMemecoinRows.find((item) => item.row.id === selectedCoinId) ?? null;

  useEffect(() => {
    if (!manualSelectedCoinId) {
      return;
    }
    if (manualSelectedCoinId === selectedCoinId) {
      return;
    }
    setManualSelectedCoinId(selectedCoinId);
  }, [manualSelectedCoinId, selectedCoinId]);

  const totalPosts = useMemo(
    () => allRows.reduce((total, row) => total + getTrendPostCount(row), 0),
    [allRows],
  );
  const dashboardPostsPerMinute = renderedDashboard?.blueskyOverview?.postsPerMinute;
  const postsPerMinute =
    typeof dashboardPostsPerMinute === "number" && Number.isFinite(dashboardPostsPerMinute)
      ? dashboardPostsPerMinute
      : totalPosts / Math.max(1, (range === "1h" ? 1 : range === "6h" ? 6 : range === "7d" ? 168 : 24) * 60);
  const newNarrativesCount = useMemo(
    () =>
      allRows.filter((row) => isFreshWithinHours(row.firstSeenAt, referenceTime, 24)).length,
    [allRows, referenceTime],
  );
  const linkedMemecoinCount = prelinkedCoins.length > 0 ? prelinkedCoins.length : correlatedMemecoinRows.length;
  const statusStripItems = useMemo(
    () => [
      {
        label: "Active narratives",
        value: formatCompactNumber(allRows.length),
        tone: "neutral" as const,
      },
      {
        label: "New narratives",
        value: formatCompactNumber(newNarrativesCount),
        tone: "amber" as const,
      },
      {
        label: "Posts/min",
        value: postsPerMinute >= 10 ? postsPerMinute.toFixed(0) : postsPerMinute.toFixed(1),
        tone: "neutral" as const,
      },
      {
        label: "Linked memecoins",
        value: formatCompactNumber(linkedMemecoinCount),
        tone: "green" as const,
      },
      {
        label: "New coins <24h",
        value: formatCompactNumber(newMemecoinCount),
        tone: "amber" as const,
      },
      {
        label: "Last refresh",
        value: formatRelativeTimeShort(
          renderedDashboard?.dataStatus?.sourceSnapshotGeneratedAt ??
            renderedDashboard?.dataStatus?.latestFetchedAt ??
            renderedDashboard?.correlatedMemecoins?.updatedAt,
          referenceTime ?? undefined,
        ),
        tone: "neutral" as const,
      },
    ],
    [
      allRows.length,
      linkedMemecoinCount,
      newMemecoinCount,
      newNarrativesCount,
      postsPerMinute,
      referenceTime,
      renderedDashboard?.correlatedMemecoins?.updatedAt,
      renderedDashboard?.dataStatus?.latestFetchedAt,
      renderedDashboard?.dataStatus?.sourceSnapshotGeneratedAt,
    ],
  );

  const replayWindow = renderedDashboard?.blueskyOverview?.replayWindow ?? null;
  const freshnessDiagnostics = renderedDashboard?.dataStatus?.freshnessDiagnostics ?? null;
  const resolvedLagMinutes = useMemo(() => {
    const lagCandidates = [
      renderedDashboard?.blueskyOverview?.firehoseLagMinutes ?? null,
      freshnessDiagnostics?.agesMinutes?.sourceSnapshot ?? null,
      freshnessDiagnostics?.agesMinutes?.ingestion ?? null,
      freshnessDiagnostics?.agesMinutes?.processed ?? null,
    ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    if (lagCandidates.length === 0) {
      return null;
    }

    return Math.max(...lagCandidates);
  }, [
    freshnessDiagnostics?.agesMinutes?.ingestion,
    freshnessDiagnostics?.agesMinutes?.processed,
    freshnessDiagnostics?.agesMinutes?.sourceSnapshot,
    renderedDashboard?.blueskyOverview?.firehoseLagMinutes,
  ]);
  const streamStatus = deriveBlueskyLiveStatus({
    lastReceivedAt: renderedDashboard?.dataStatus?.latestFetchedAt ?? null,
    lastAggregateRefreshAt: renderedDashboard?.dataStatus?.sourceSnapshotGeneratedAt ?? null,
    detailLatestPointAt: replayWindow?.latestPointAt ?? null,
    detailStaleGapMinutes: replayWindow?.staleGapMinutes ?? null,
    workerAlive: freshnessDiagnostics?.workerRunStatus
      ? freshnessDiagnostics.workerRunStatus.toLowerCase() === "running"
      : null,
    workerHeartbeatAt: freshnessDiagnostics?.workerHeartbeatAt ?? null,
    latestRunStatus: freshnessDiagnostics?.workerRunStatus ?? null,
    lastEventAt: freshnessDiagnostics?.workerLastEventAt ?? freshnessDiagnostics?.latestMentionEventAt ?? null,
    pipelineHealthState: freshnessDiagnostics?.pipelineHealthState ?? null,
    streamLagSeconds:
      typeof freshnessDiagnostics?.pipelineLagSeconds === "number"
        ? Math.max(0, Math.round(freshnessDiagnostics.pipelineLagSeconds))
        : typeof resolvedLagMinutes === "number"
          ? Math.max(0, Math.round(resolvedLagMinutes * 60))
          : null,
  });

  useEffect(() => {
    if (!renderedDashboard) {
      return;
    }

    const responseVersion = renderedDashboard.dataStatus?.responseVersion ?? null;
    const diagnostics = renderedDashboard.dataStatus?.freshnessDiagnostics ?? null;
    const freshnessTrace = {
      responseVersion,
      stateSource: renderedDashboard.dataStatus?.stateSource ?? null,
      sourceSnapshotGeneratedAt: renderedDashboard.dataStatus?.sourceSnapshotGeneratedAt ?? null,
      latestFetchedAt: renderedDashboard.dataStatus?.latestFetchedAt ?? null,
      replayLatestPointAt: replayWindow?.latestPointAt ?? null,
      replayLatestDataAt: replayWindow?.latestDataAt ?? null,
      streamStatus: {
        state: streamStatus.state,
        label: streamStatus.label,
        timestampSource: streamStatus.timestampSource,
      },
      frontendObservedAt: new Date().toISOString(),
      diagnostics,
    };

    if (typeof window !== "undefined") {
      (window as Window & { __ATTN_TERMINAL_FRESHNESS?: unknown }).__ATTN_TERMINAL_FRESHNESS =
        freshnessTrace;
    }

    if (
      process.env.NODE_ENV !== "production" &&
      responseVersion &&
      responseVersion !== lastFreshnessVersionRef.current
    ) {
      console.info("[dashboard-freshness-trace]", freshnessTrace);
      lastFreshnessVersionRef.current = responseVersion;
    }
  }, [
    renderedDashboard,
    replayWindow?.latestDataAt,
    replayWindow?.latestPointAt,
    streamStatus.label,
    streamStatus.state,
    streamStatus.timestampSource,
  ]);

  if (isSummaryLoading || !renderedDashboard) {
    return <TrendDashboardLoadingShell />;
  }

  return (
    <div className={TREND_DASHBOARD_LAYOUT_CLASS_NAME}>
      <OverviewStatusStrip items={statusStripItems} />

      <section
        data-testid="trend-main-workspace"
        className={TREND_DASHBOARD_WORKSPACE_CLASS_NAME}
      >
        <div id="signals" className="min-h-[320px] min-w-0 xl:min-h-0 xl:overflow-hidden">
          <TerminalPanel
            title="Narratives"
            subtitle="Attention-ranked source table"
            tone="cyan"
            className="h-full min-h-0 min-w-0"
            bodyClassName="overflow-hidden"
            action={(
              <div className="flex items-center gap-2">
                <span className="border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 font-mono text-[12px] text-[#a8b9cd]">
                  {filteredRows.length}/{allRows.length}
                </span>
                <label className="flex h-9 items-center gap-2 border border-white/[0.08] bg-[#060b11] px-2.5">
                  <Search className="h-3.5 w-3.5 text-[#69809a]" />
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search narratives"
                    className="w-[160px] bg-transparent text-[13px] text-[#d6e0ed] outline-none placeholder:text-[#5d738c]"
                  />
                </label>
              </div>
            )}
          >
            <NarrativeTrendsTable
              rows={filteredRows}
              selectedId={resolvedSelectedId ?? selectedNarrative?.id ?? null}
              onSelect={handleSelect}
            />
          </TerminalPanel>
        </div>

        <div id="memecoins" className="min-h-[320px] min-w-0 xl:min-h-0 xl:overflow-hidden">
          <TerminalPanel
            title="Memecoins"
            subtitle="Market-linked execution table"
            tone="neutral"
            className="h-full min-h-0 min-w-0"
            bodyClassName="overflow-hidden"
            action={(
              <div className="flex items-center gap-2 text-[12px] text-[#8da1bb]">
                <span className="border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 font-mono">
                  {displayedMemecoinRows.length}
                </span>
                {selectedNarrative ? (
                  <span className="max-w-[190px] truncate border border-white/[0.08] bg-white/[0.03] px-2 py-1.5">
                    {getTrendDisplayNameOrPlaceholder(selectedNarrative)}
                  </span>
                ) : null}
              </div>
            )}
          >
            <MemecoinMarketTable
              rows={displayedMemecoinRows}
              selectedCoinId={selectedCoinId}
              selectedTrendLabel={selectedNarrative ? getTrendDisplayNameOrPlaceholder(selectedNarrative) : null}
              mode={coinTableMode}
              onModeChange={setCoinTableMode}
              onSelectCoin={setManualSelectedCoinId}
            />
          </TerminalPanel>
        </div>

        <div id="validation" className="min-h-[320px] min-w-0 xl:min-h-0 xl:overflow-hidden">
          <TerminalPanel
            title="Validation"
            subtitle={selectedCoin ? "Selected coin market context" : "Select a coin to validate"}
            tone="emerald"
            className="h-full min-h-0 min-w-0"
            bodyClassName="overflow-hidden"
            action={selectedCoin ? (
              <span className={cn("border px-2 py-1.5 font-mono text-[12px]", selectedCoin.related ? "border-emerald/25 bg-emerald/10 text-emerald" : "border-white/[0.08] bg-white/[0.03] text-[#a8b9cd]")}>
                {selectedCoin.row.symbol}
              </span>
            ) : null}
          >
            <SelectedCoinPanel selectedCoin={selectedCoin} />
          </TerminalPanel>
        </div>
      </section>
    </div>
  );
}
