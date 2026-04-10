"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_CORRELATED_MEMECOIN_SORT,
  type CorrelatedMemecoinSortKey,
  type CorrelatedMemecoinSortDirection,
  sortCorrelatedMemecoinRows,
} from "@/lib/dashboard/correlated-memecoin-sorting";
import { formatCompactCurrency, formatCurrency, formatSignedPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils/cn";
import { CorrelatedMemecoinRow } from "@/types/view-models";

type TerminalCorrelatedMemecoinsTableProps = {
  rows: CorrelatedMemecoinRow[];
};

const TABLE_GRID_CLASS =
  "grid w-full grid-cols-[24px_minmax(0,0.95fr)_minmax(0,1fr)_38px_46px_46px_42px_30px] gap-x-1 sm:grid-cols-[30px_minmax(0,1fr)_minmax(0,1.15fr)_46px_58px_58px_50px_40px] sm:gap-x-1.5 xl:grid-cols-[34px_minmax(0,1.05fr)_minmax(0,1.25fr)_54px_68px_68px_60px_46px]";

const SORTABLE_HEADERS: Array<{
  key: CorrelatedMemecoinSortKey;
  label: string;
  description: string;
}> = [
  {
    key: "correlationScore",
    label: "Corr",
    description: "correlation score",
  },
  {
    key: "liquidityUsd",
    label: "Liq",
    description: "liquidity",
  },
  {
    key: "volume24hUsd",
    label: "Vol",
    description: "24 hour volume",
  },
  {
    key: "priceChange24hPct",
    label: "24h %",
    description: "24 hour change",
  },
];

function formatTokenPrice(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "--";
  }

  if (value >= 1) {
    return formatCurrency(value, value >= 100 ? 0 : 2);
  }

  if (value >= 0.01) {
    return formatCurrency(value, 4);
  }

  if (value >= 0.0001) {
    return `$${value.toFixed(6)}`;
  }

  return `$${value.toExponential(2)}`;
}

function formatMarketValue(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "--";
  }

  if (value >= 1_000) {
    return formatCompactCurrency(value);
  }

  return formatCurrency(value, 0);
}

function formatPairAge(hours: number | null | undefined) {
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0) {
    return "--";
  }

  if (hours < 24) {
    return `${Math.max(1, Math.round(hours))}h`;
  }

  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${days}d`;
  }

  return `${Math.round(days / 30)}mo`;
}

function formatTrendMeta(row: CorrelatedMemecoinRow) {
  const category = row.strongestTrendCategory
    ? row.strongestTrendCategory.replace(/_/g, " ")
    : null;

  if (category && row.strongestTrendSummary) {
    return `${category} | ${row.strongestTrendSummary}`;
  }

  return category ?? row.strongestTrendSummary ?? row.strongestTrendKey;
}

function sortIndicator(active: boolean, direction: CorrelatedMemecoinSortDirection) {
  if (!active) {
    return "";
  }

  return direction === "desc" ? "v" : "^";
}

export function TerminalCorrelatedMemecoinsTable({
  rows,
}: TerminalCorrelatedMemecoinsTableProps) {
  const [sortState, setSortState] = useState(DEFAULT_CORRELATED_MEMECOIN_SORT);
  const sortedRows = useMemo(() => sortCorrelatedMemecoinRows(rows, sortState), [rows, sortState]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-[#7f91a9]">
        Awaiting a completed correlation run.
      </div>
    );
  }

  return (
    <div data-testid="correlated-memecoins-table" className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div
          className={cn(
            TABLE_GRID_CLASS,
            "border-b border-white/[0.11] px-2.5 py-2.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#7890ac] sm:px-3 sm:py-3 sm:text-[10px]",
          )}
        >
          <span>#</span>
          <span>Coin</span>
          <span>Trend</span>
          {SORTABLE_HEADERS.map(({ key, label, description }) => {
            const active = sortState.key === key;

            return (
              <button
                key={key}
                type="button"
                data-testid={`correlated-memecoin-sort-${key}`}
                aria-label={`Sort memecoins by ${description}`}
                aria-pressed={active}
                title={`Sort by ${description}`}
                onClick={() => {
                  setSortState((previousState) =>
                    previousState.key === key
                      ? {
                          key,
                          direction: previousState.direction === "desc" ? "asc" : "desc",
                        }
                      : {
                          key,
                          direction: "desc",
                        },
                  );
                }}
                className={cn(
                  "flex min-w-0 items-center justify-end gap-1 text-right transition-colors hover:text-[#a6b6cb] focus-visible:outline-none focus-visible:text-cyan",
                  active ? "text-cyan" : "text-[#7890ac]",
                )}
              >
                <span className="truncate">{label}</span>
                <span className="w-2 font-mono text-[9px]">{sortIndicator(active, sortState.direction)}</span>
              </button>
            );
          })}
          <span className="text-right">Dex</span>
        </div>
        <div>
          {sortedRows.map((row, index) => {
            const priceLabel = `${row.chainLabel} | ${formatTokenPrice(row.priceUsd)}`;
            const trendMeta = formatTrendMeta(row);
            const pairAgeLabel = formatPairAge(row.pairAgeHours);

            return (
              <a
                key={row.id}
                href={row.dexscreenerUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="correlated-memecoin-row"
                className={cn(
                  TABLE_GRID_CLASS,
                  "items-center border-b border-white/[0.06] px-2.5 py-2 text-left transition-colors hover:bg-white/[0.03] focus-visible:bg-[linear-gradient(90deg,rgba(31,95,122,0.18),rgba(12,23,33,0.18))] focus-visible:outline-none sm:px-3 sm:py-2.5",
                )}
              >
                <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-[6px] border border-white/[0.12] bg-white/[0.03] font-mono text-[10px] text-[#a8b8cd] sm:h-7 sm:w-8 sm:text-[11px]">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p
                      className="truncate text-[11px] font-semibold text-[#e8eef9] sm:text-[12px]"
                      title={row.name}
                    >
                      {row.name}
                    </p>
                    <span
                      className="max-w-[42px] shrink-0 truncate font-mono text-[9px] text-cyan sm:max-w-[60px] sm:text-[10px] xl:max-w-[72px] xl:text-[11px]"
                      title={row.symbol}
                    >
                      {row.symbol}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[9px] text-[#6f839d] sm:text-[10px]" title={priceLabel}>
                    {priceLabel}
                  </p>
                </div>
                <div className="min-w-0">
                  <p
                    className="truncate text-[11px] font-semibold text-[#e8eef9] sm:text-[12px]"
                    title={row.strongestTrendLabel}
                  >
                    {row.strongestTrendLabel}
                  </p>
                  <p className="mt-0.5 truncate text-[9px] text-[#6f839d] sm:text-[10px]" title={trendMeta}>
                    {trendMeta}
                  </p>
                </div>
                <div className="py-0.5 text-right">
                  <p className="font-mono text-[10px] text-[#d7e2f3] sm:text-[11px] xl:text-[12px]">
                    {Math.round(row.correlationScore)}
                  </p>
                  <p className="mt-0.5 truncate text-[8px] uppercase tracking-[0.12em] text-[#6f839d] sm:text-[9px] xl:text-[10px]">
                    {row.correlationLabel}
                  </p>
                </div>
                <span className="py-1 text-right font-mono text-[10px] text-[#d7e2f3] sm:text-[11px] xl:text-[12px]">
                  {formatMarketValue(row.liquidityUsd)}
                </span>
                <span className="py-1 text-right font-mono text-[10px] text-[#d7e2f3] sm:text-[11px] xl:text-[12px]">
                  {formatMarketValue(row.volume24hUsd)}
                </span>
                <span
                  className={cn(
                    "py-1 text-right font-mono text-[10px] sm:text-[11px] xl:text-[12px]",
                    typeof row.priceChange24hPct === "number" && Number.isFinite(row.priceChange24hPct)
                      ? row.priceChange24hPct >= 0
                        ? "text-emerald"
                        : "text-rose"
                      : "text-[#d7e2f3]",
                  )}
                >
                  {typeof row.priceChange24hPct === "number" && Number.isFinite(row.priceChange24hPct)
                    ? formatSignedPercent(row.priceChange24hPct, 1)
                    : "--"}
                </span>
                <div className="py-0.5 text-right">
                  <p className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-cyan sm:text-[10px] xl:text-[11px]">
                    Open
                  </p>
                  <p className="mt-0.5 truncate text-[8px] text-[#6f839d] sm:text-[9px] xl:text-[10px]" title={`Pair age ${pairAgeLabel}`}>
                    {pairAgeLabel}
                  </p>
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
