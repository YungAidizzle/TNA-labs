"use client";

import dynamic from "next/dynamic";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/shared/empty-state";
import type { MemecoinTerminalRow } from "@/components/trends/memecoin-market-table";
import { OverviewStatusStrip } from "@/components/trends/overview-status-strip";
import { dashboardClient } from "@/lib/dashboard/client";
import { resolveSelectedLiveMemecoinId } from "@/lib/dashboard/memecoin-selection";
import { buildTrendsPageMemecoinDatasets } from "@/lib/dashboard/trends-page-memecoin-selectors";
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

function formatQueryError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
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

  const correlatedMemecoinRows = useMemo(
    () => memecoinsQuery.data?.correlatedMemecoins?.rows ?? [],
    [memecoinsQuery.data?.correlatedMemecoins?.rows],
  );
  const marketMemecoinRows = useMemo(
    () =>
      memecoinsQuery.data?.marketMemecoins?.rows ??
      memecoinsQuery.data?.correlatedMemecoins?.rows ??
      [],
    [
      memecoinsQuery.data?.correlatedMemecoins?.rows,
      memecoinsQuery.data?.marketMemecoins?.rows,
    ],
  );

  const memecoinDatasets = useMemo(
    () =>
      buildTrendsPageMemecoinDatasets({
        selectedTrend: selectedNarrative,
        trends: allRows,
        correlatedRows: correlatedMemecoinRows,
        marketRows: marketMemecoinRows,
      }),
    [allRows, correlatedMemecoinRows, marketMemecoinRows, selectedNarrative],
  );

  const displayedMemecoinRows =
    coinTableMode === "trend"
      ? (memecoinDatasets.trendRows as MemecoinTerminalRow[])
      : coinTableMode === "momentum"
        ? (memecoinDatasets.momentumRows as MemecoinTerminalRow[])
        : (memecoinDatasets.allRows as MemecoinTerminalRow[]);

  const selectedCoinId = resolveSelectedLiveMemecoinId(displayedMemecoinRows, manualSelectedCoinId);
  const selectedCoin =
    displayedMemecoinRows.find((item) => item.row.id === selectedCoinId) ?? null;

  const summaryErrorMessage =
    summaryQuery.isError && !summaryQuery.data
      ? formatQueryError(
          summaryQuery.error,
          "The narrative ranking request failed. Retry to load the latest ranked trends.",
        )
      : null;
  const memecoinsErrorMessage =
    memecoinsQuery.isError && !memecoinsQuery.data
      ? formatQueryError(
          memecoinsQuery.error,
          "The linked market request failed. Retry to load the latest memecoin rows.",
        )
      : null;
  const validationErrorMessage =
    memecoinsQuery.isError && !memecoinsQuery.data
      ? formatQueryError(
          memecoinsQuery.error,
          "Validation data is unavailable until the market request succeeds.",
        )
      : null;
  const topLevelDashboardError =
    statusQuery.isError && !statusQuery.data
      ? formatQueryError(
          statusQuery.error,
          "The dashboard status request failed. Retry to reconnect to live data.",
        )
      : null;
  const hasAnyStaleData =
    (summaryQuery.isError && Boolean(summaryQuery.data)) ||
    (memecoinsQuery.isError && Boolean(memecoinsQuery.data)) ||
    (statusQuery.isError && Boolean(statusQuery.data));

  return (
    <div className={TREND_DASHBOARD_LAYOUT_CLASS_NAME}>
      {statusQuery.data ? (
        <OverviewStatusStrip items={statusQuery.data.items} />
      ) : statusQuery.isPending ? (
        <TrendStatusStripSkeleton />
      ) : (
        <div className="surface-panel border border-white/[0.08] p-4">
          <EmptyState
            title="Live status unavailable"
            detail={topLevelDashboardError ?? "The status strip could not be loaded."}
          />
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => {
                void statusQuery.refetch();
              }}
              className="inline-flex h-10 items-center border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
            >
              Retry status
            </button>
          </div>
        </div>
      )}

      {hasAnyStaleData ? (
        <div className="surface-panel border border-amber/20 bg-amber/10 px-4 py-3 text-[13px] text-[#f7c27b]">
          Live refresh is degraded. You are viewing the most recent synced dashboard data while requests reconnect.
        </div>
      ) : null}

      <section data-testid="trend-main-workspace" className={TREND_DASHBOARD_WORKSPACE_CLASS_NAME}>
        <LazyTrendNarrativesPanel
          rows={filteredRows}
          selectedId={resolvedSelectedId ?? selectedNarrative?.id ?? null}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          onSelect={handleSelect}
          loading={summaryQuery.isPending && !summaryQuery.data}
          connecting={summaryQuery.isFetching}
          errorMessage={summaryErrorMessage}
          staleMessage={
            summaryQuery.data && summaryQuery.isError
              ? "Showing last synced narratives while refresh reconnects."
              : summaryQuery.data && summaryQuery.isFetching
                ? "Refreshing live narratives..."
                : null
          }
          onRetry={() => {
            void summaryQuery.refetch();
          }}
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
          errorMessage={memecoinsErrorMessage}
          staleMessage={
            memecoinsQuery.data && memecoinsQuery.isError
              ? "Showing last synced market rows while refresh reconnects."
              : memecoinsQuery.data && memecoinsQuery.isFetching
                ? "Refreshing market rows..."
                : null
          }
          onRetry={() => {
            void memecoinsQuery.refetch();
          }}
        />

        <LazyTrendValidationPanel
          selectedCoin={selectedCoin}
          loading={memecoinsQuery.isPending && !memecoinsQuery.data}
          connecting={memecoinsQuery.isFetching}
          errorMessage={validationErrorMessage}
          staleMessage={
            memecoinsQuery.data && memecoinsQuery.isError
              ? "Showing last synced validation context while refresh reconnects."
              : memecoinsQuery.data && memecoinsQuery.isFetching
                ? "Refreshing validation context..."
                : null
          }
          onRetry={() => {
            void memecoinsQuery.refetch();
          }}
        />
      </section>
    </div>
  );
}
