"use client";

import dynamic from "next/dynamic";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { MemecoinTerminalRow } from "@/components/trends/memecoin-market-table";
import { OverviewStatusStrip } from "@/components/trends/overview-status-strip";
import { dashboardClient } from "@/lib/dashboard/client";
import { resolveSelectedLiveMemecoinId } from "@/lib/dashboard/memecoin-selection";
import {
  getMemecoinConfidenceScore,
  getNarrativeCoinOpportunities,
  getNarrativeLinkForCoin,
  getNarrativeTopicKey,
} from "@/lib/dashboard/memecoin-opportunities";
import { getTrendDisplayNameOrPlaceholder } from "@/lib/dashboard/trend-name-state";
import { resolveSelectedTrendId } from "@/lib/dashboard/trend-selection-state";
import { DateRangePreset, TrendScope } from "@/types/domain";
import {
  TREND_DASHBOARD_LAYOUT_CLASS_NAME,
  TREND_DASHBOARD_WORKSPACE_CLASS_NAME,
  TrendMemecoinsPanelSkeleton,
  TrendNarrativesPanelSkeleton,
  TrendStatusStripSkeleton,
  TrendValidationPanelSkeleton,
} from "@/features/trends/trend-dashboard-loading-shell";
import {
  TrendDashboardQuery,
  TrendLeaderboardMode,
  TrendSort,
} from "@/types/view-models";

const LazyTrendNarrativesPanel = dynamic(
  () => import("@/features/trends/trend-dashboard-panels").then((mod) => mod.TrendNarrativesPanel),
  {
    loading: () => <TrendNarrativesPanelSkeleton />,
  },
);
const LazyTrendMemecoinsPanel = dynamic(
  () => import("@/features/trends/trend-dashboard-panels").then((mod) => mod.TrendMemecoinsPanel),
  {
    loading: () => <TrendMemecoinsPanelSkeleton />,
  },
);
const LazyTrendValidationPanel = dynamic(
  () => import("@/features/trends/trend-dashboard-panels").then((mod) => mod.TrendValidationPanel),
  {
    loading: () => <TrendValidationPanelSkeleton />,
  },
);

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
const DEFAULT_REFRESH_MS = 60_000;
const RANGE_PRESETS: DateRangePreset[] = ["1h", "6h", "24h", "7d"];

type CoinTableMode = "trend" | "all" | "momentum";

function resolveSort(value: string | null): TrendSort {
  if (value && SORT_OPTIONS.includes(value as TrendSort)) {
    return value as TrendSort;
  }

  return "posts";
}

function resolveRangePreset(value: string | null): DateRangePreset {
  if (value && RANGE_PRESETS.includes(value as DateRangePreset)) {
    return value as DateRangePreset;
  }

  return "24h";
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
  const momentumRankDelta =
    Number(left.row.momentumRank ?? Number.MAX_SAFE_INTEGER) -
    Number(right.row.momentumRank ?? Number.MAX_SAFE_INTEGER);
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
};

export function TrendDashboardPage({
  scope,
  initialSelectedId = null,
}: TrendDashboardPageProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [searchTerm, setSearchTerm] = useState("");
  const [manualSelectedTrendId, setManualSelectedTrendId] = useState<string | null>(null);
  const [manualSelectedCoinId, setManualSelectedCoinId] = useState<string | null>(null);
  const [coinTableMode, setCoinTableMode] = useState<CoinTableMode>("momentum");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const range = resolveRangePreset(searchParams.get("range"));
  const mode: TrendLeaderboardMode = "established";
  const sort = resolveSort(searchParams.get("sort"));
  const requestedSelectedId = manualSelectedTrendId ?? searchParams.get("selected") ?? initialSelectedId ?? undefined;

  const baseQuery = useMemo<TrendDashboardQuery>(
    () => ({
      scope,
      range,
      mode,
      sort,
    }),
    [mode, range, scope, sort],
  );

  const statusQueryKey = useMemo(() => ["trend-dashboard-status", baseQuery] as const, [baseQuery]);
  const summaryQueryKey = useMemo(() => ["trend-dashboard-summary", baseQuery] as const, [baseQuery]);
  const memecoinsQueryKey = useMemo(() => ["trend-dashboard-memecoins", baseQuery] as const, [baseQuery]);

  const statusQuery = useQuery({
    queryKey: statusQueryKey,
    queryFn: ({ signal }) => dashboardClient.getTrendDashboardStatus(baseQuery, { signal }),
    staleTime: DEFAULT_REFRESH_MS,
    refetchInterval: DEFAULT_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const summaryQuery = useQuery({
    queryKey: summaryQueryKey,
    queryFn: ({ signal }) => dashboardClient.getTrendDashboardSummaryVM(baseQuery, { signal }),
    staleTime: DEFAULT_REFRESH_MS,
    refetchInterval: DEFAULT_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const memecoinsQuery = useQuery({
    queryKey: memecoinsQueryKey,
    queryFn: ({ signal }) => dashboardClient.getTrendDashboardMemecoins(baseQuery, { signal }),
    staleTime: DEFAULT_REFRESH_MS,
    refetchInterval: DEFAULT_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const allRows = useMemo(() => summaryQuery.data?.leaderboard ?? [], [summaryQuery.data?.leaderboard]);
  const resolvedSelectedId = useMemo(
    () =>
      resolveSelectedTrendId({
        leaderboard: allRows,
        requestedSelectedId,
        fallbackSelectedId: summaryQuery.data?.query.selectedId,
      }),
    [allRows, requestedSelectedId, summaryQuery.data?.query.selectedId],
  );

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
    if (!resolvedSelectedId || !summaryQuery.data) {
      return;
    }

    const searchSelectedId = searchParams.get("selected");
    if (searchSelectedId === resolvedSelectedId) {
      return;
    }

    const selectedTrendStillVisible = searchSelectedId
      ? allRows.some((trend) => trend.id === searchSelectedId)
      : false;
    if (selectedTrendStillVisible) {
      return;
    }

    replaceDashboardQuery({
      selected: resolvedSelectedId,
      range,
    });
  }, [allRows, range, replaceDashboardQuery, resolvedSelectedId, searchParams, summaryQuery.data]);

  const handleSelect = useCallback(
    (id: string) => {
      if (id === resolvedSelectedId && searchParams.get("selected") === id) {
        return;
      }

      setManualSelectedTrendId(id);
      setManualSelectedCoinId(null);
      replaceDashboardQuery({
        selected: id,
        range,
      });
    },
    [range, replaceDashboardQuery, resolvedSelectedId, searchParams],
  );

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

  const correlatedMemecoinRows = useMemo(
    () => memecoinsQuery.data?.correlatedMemecoins?.rows ?? [],
    [memecoinsQuery.data?.correlatedMemecoins?.rows],
  );

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
      correlatedMemecoinRows.map((row) => {
        const selectedNarrativeLink = selectedNarrativeTopicKey
          ? getNarrativeLinkForCoin(row, selectedNarrativeTopicKey)
          : null;
        const strongestLink =
          getNarrativeLinkForCoin(row, row.strongestTrendKey) ??
          row.links?.find((link) => link.isPrimary) ??
          row.links?.[0] ??
          null;
        const activeLink = selectedNarrativeLink ?? strongestLink;

        return {
          row,
          activeLink,
          confidenceScore: getMemecoinConfidenceScore(
            row,
            activeLink?.topicKey ?? row.strongestTrendKey,
          ),
          related: Boolean(selectedNarrativeLink),
        };
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

  const selectedCoinId = resolveSelectedLiveMemecoinId(displayedMemecoinRows, manualSelectedCoinId);
  const selectedCoin =
    displayedMemecoinRows.find((item) => item.row.id === selectedCoinId) ?? null;

  useEffect(() => {
    if (!manualSelectedCoinId || manualSelectedCoinId === selectedCoinId) {
      return;
    }
    setManualSelectedCoinId(selectedCoinId);
  }, [manualSelectedCoinId, selectedCoinId]);

  return (
    <div className={TREND_DASHBOARD_LAYOUT_CLASS_NAME}>
      {statusQuery.data ? (
        <OverviewStatusStrip items={statusQuery.data.items} />
      ) : (
        <TrendStatusStripSkeleton />
      )}

      <section data-testid="trend-main-workspace" className={TREND_DASHBOARD_WORKSPACE_CLASS_NAME}>
        <LazyTrendNarrativesPanel
          rows={filteredRows}
          selectedId={resolvedSelectedId ?? selectedNarrative?.id ?? null}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          onSelect={handleSelect}
          loading={summaryQuery.isPending && !summaryQuery.data}
          connecting={summaryQuery.isFetching}
        />

        <LazyTrendMemecoinsPanel
          rows={displayedMemecoinRows}
          selectedCoinId={selectedCoinId}
          selectedTrendLabel={selectedNarrative ? getTrendDisplayNameOrPlaceholder(selectedNarrative) : null}
          mode={coinTableMode}
          onModeChange={setCoinTableMode}
          onSelectCoin={setManualSelectedCoinId}
          loading={memecoinsQuery.isPending && !memecoinsQuery.data}
          connecting={memecoinsQuery.isFetching}
        />

        <LazyTrendValidationPanel
          selectedCoin={selectedCoin}
          loading={memecoinsQuery.isPending && !memecoinsQuery.data}
          connecting={memecoinsQuery.isFetching}
        />
      </section>
    </div>
  );
}
