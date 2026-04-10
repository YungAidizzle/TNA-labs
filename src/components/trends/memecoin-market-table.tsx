"use client";

import { SkeletonBlock } from "@/components/shared/skeleton-block";
import { CoinIcon } from "@/components/trends/coin-icon";
import { formatCompactCurrency, formatCurrency, formatHoursShort, formatSignedPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils/cn";
import { CorrelatedMemecoinLink, CorrelatedMemecoinRow } from "@/types/view-models";

export type MemecoinTerminalRow = {
  row: CorrelatedMemecoinRow;
  activeLink: CorrelatedMemecoinLink | null;
  confidenceScore: number;
  related: boolean;
};

type MemecoinMarketTableProps = {
  rows: MemecoinTerminalRow[];
  selectedCoinId: string | null;
  selectedTrendLabel: string | null;
  mode: "trend" | "all" | "momentum";
  onModeChange: (mode: "trend" | "all" | "momentum") => void;
  onSelectCoin: (id: string) => void;
  loading?: boolean;
};

const DEFAULT_TABLE_CLASS =
  "grid w-full grid-cols-[minmax(0,1.9fr)_minmax(66px,0.95fr)_minmax(44px,0.55fr)_minmax(50px,0.62fr)_minmax(58px,0.72fr)_minmax(58px,0.72fr)] gap-x-1.5";
const MOMENTUM_TABLE_CLASS =
  "grid w-full grid-cols-[minmax(0,1.72fr)_minmax(62px,0.9fr)_minmax(42px,0.5fr)_minmax(48px,0.56fr)_minmax(54px,0.66fr)_minmax(54px,0.66fr)_minmax(78px,0.86fr)] gap-x-1.5";
const MEMECOIN_NAME_WIDTHS = [
  "w-[62%]",
  "w-[54%]",
  "w-[70%]",
  "w-[58%]",
  "w-[66%]",
  "w-[49%]",
  "w-[74%]",
  "w-[57%]",
];
const MEMECOIN_META_WIDTHS = [
  "w-[112px]",
  "w-[140px]",
  "w-[124px]",
  "w-[136px]",
  "w-[118px]",
];
const MEMECOIN_VALUE_WIDTHS = ["w-12", "w-11", "w-10", "w-14", "w-12", "w-10"];

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

function changeToneClass(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "text-[#7b8ea6]";
  }

  if (value > 0) {
    return "text-emerald";
  }

  if (value < 0) {
    return "text-rose";
  }

  return "text-[#b6c4d6]";
}

function formatChange(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return formatSignedPercent(value, 1);
}

function confidenceToneClass(score: number) {
  if (score >= 80) {
    return "text-emerald";
  }
  if (score >= 60) {
    return "text-amber";
  }
  if (score >= 40) {
    return "text-cyan";
  }

  return "text-[#9db0c9]";
}

function momentumToneClass(score: number | null | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return "text-[#9db0c9]";
  }
  if (score >= 78) {
    return "text-emerald";
  }
  if (score >= 62) {
    return "text-cyan";
  }
  if (score >= 45) {
    return "text-amber";
  }

  return "text-[#9db0c9]";
}

function chainCompactLabel(row: CorrelatedMemecoinRow) {
  const normalizedChain = row.chainId.trim().toLowerCase();
  if (normalizedChain === "solana") {
    return "SOL";
  }
  if (normalizedChain === "ethereum") {
    return "ETH";
  }
  if (normalizedChain === "base") {
    return "BASE";
  }
  if (normalizedChain === "bsc") {
    return "BSC";
  }

  return row.chainLabel.slice(0, 4).toUpperCase();
}

function pairLabel(row: CorrelatedMemecoinRow) {
  const pair = row.quoteSymbol ? `${row.symbol}/${row.quoteSymbol}` : row.symbol;
  return `${chainCompactLabel(row)} | ${pair} | ${formatHoursShort(row.pairAgeHours)}`;
}

function tableClassName(mode: MemecoinMarketTableProps["mode"]) {
  return mode === "momentum" ? MOMENTUM_TABLE_CLASS : DEFAULT_TABLE_CLASS;
}

function modeContextLabel(mode: MemecoinMarketTableProps["mode"]) {
  if (mode === "trend") {
    return "Current filter";
  }
  if (mode === "momentum") {
    return "Narrative context";
  }

  return "Related highlight";
}

function emptyStateMessage(mode: MemecoinMarketTableProps["mode"]) {
  if (mode === "momentum") {
    return "No momentum setups are qualifying from the current memecoin board.";
  }
  if (mode === "all") {
    return "No linked memecoins are available in the current board.";
  }

  return "No linked memecoins surfaced for this narrative.";
}

function shortMomentumSignalLabel(signal: string | null | undefined) {
  const normalized = String(signal ?? "").trim().toLowerCase();
  if (normalized === "breakout starting") {
    return "Breakout";
  }
  if (normalized === "volume confirmation") {
    return "Volume";
  }
  if (normalized === "early continuation") {
    return "Continue";
  }
  if (normalized === "buy pressure") {
    return "Buy flow";
  }
  if (normalized === "acceleration") {
    return "Accel";
  }

  return normalized ? "Strength" : "--";
}

export function MemecoinMarketTable({
  rows,
  selectedCoinId,
  selectedTrendLabel,
  mode,
  onModeChange,
  onSelectCoin,
  loading = false,
}: MemecoinMarketTableProps) {
  const showMomentumSignal = mode === "momentum";
  const activeTableClass = tableClassName(mode);

  if (loading) {
    return (
      <div data-testid="memecoin-market-table" className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="border-b border-white/[0.08] px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <span className="border border-cyan/35 bg-cyan/10 px-2.5 py-1.5 text-[12px] font-medium text-cyan">
                Trend
              </span>
              <span className="border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[12px] font-medium text-[#93a7bf]">
                All
              </span>
              <span className="border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[12px] font-medium text-[#93a7bf]">
                Momentum
              </span>
            </div>

            <div className="min-w-0 text-right">
              <p className="text-[12px] font-medium text-[#6d819a]">
                {modeContextLabel(mode)}
              </p>
              <SkeletonBlock className="ml-auto mt-1 h-4 w-[148px] bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
            </div>
          </div>
        </div>

        <div
          data-testid="memecoin-table-scroller"
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          <div
            className={cn(
              activeTableClass,
              "sticky top-0 z-10 border-b border-white/[0.08] bg-[#090e15] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7388a2]",
            )}
          >
            <span>Coin</span>
            <span className="text-right">Price</span>
            <span className="text-right">1h</span>
            <span className="text-right">24h</span>
            <span className="text-right">Liq</span>
            <span className="text-right">Vol</span>
            {showMomentumSignal ? <span className="text-right">Signal</span> : null}
          </div>

          <div>
            {Array.from({ length: 9 }).map((_, index) => {
              const selected = index === 0;
              return (
                <div
                  key={`memecoin-market-row-skeleton-${index}`}
                  className={cn(
                    activeTableClass,
                    "items-center border-b border-white/[0.05] px-3 py-3 text-left",
                    selected
                      ? "bg-[linear-gradient(90deg,rgba(26,54,68,0.92),rgba(8,12,18,0.98))] shadow-[inset_2px_0_0_rgba(77,219,147,0.9)]"
                      : "bg-[linear-gradient(90deg,rgba(12,24,33,0.75),rgba(8,12,18,0.96))]",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <SkeletonBlock className="h-7 w-7 rounded-[7px] bg-gradient-to-r from-white/[0.06] via-white/[0.11] to-white/[0.06]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <SkeletonBlock
                          className={cn(
                            "h-4 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]",
                            MEMECOIN_NAME_WIDTHS[index % MEMECOIN_NAME_WIDTHS.length],
                          )}
                        />
                        <SkeletonBlock className="h-3 w-10 bg-gradient-to-r from-cyan/15 via-cyan/25 to-cyan/15" />
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5">
                        <SkeletonBlock
                          className={cn(
                            "h-3 bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]",
                            MEMECOIN_META_WIDTHS[index % MEMECOIN_META_WIDTHS.length],
                          )}
                        />
                        <SkeletonBlock className="ml-auto h-3 w-8 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <SkeletonBlock
                      className={cn(
                        "ml-auto h-4 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]",
                        MEMECOIN_VALUE_WIDTHS[index % MEMECOIN_VALUE_WIDTHS.length],
                      )}
                    />
                  </div>
                  <div className="flex justify-end">
                    <SkeletonBlock className="ml-auto h-4 w-10 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
                  </div>
                  <div className="flex justify-end">
                    <SkeletonBlock className="ml-auto h-4 w-11 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
                  </div>
                  <div className="flex justify-end">
                    <SkeletonBlock className="ml-auto h-4 w-12 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
                  </div>
                  <div className="flex justify-end">
                    <SkeletonBlock className="ml-auto h-4 w-12 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
                  </div>
                  {showMomentumSignal ? (
                    <div className="flex flex-col items-end">
                      <SkeletonBlock className="h-4 w-8 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
                      <SkeletonBlock className="mt-1 h-3 w-12 bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]" />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="memecoin-market-table" className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-white/[0.08] px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onModeChange("trend")}
              className={cn(
                "border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                mode === "trend"
                  ? "border-cyan/35 bg-cyan/10 text-cyan"
                  : "border-white/[0.08] bg-white/[0.03] text-[#93a7bf] hover:text-[#e4ebf7]",
              )}
            >
              Trend
            </button>
            <button
              type="button"
              onClick={() => onModeChange("all")}
              className={cn(
                "border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                mode === "all"
                  ? "border-cyan/35 bg-cyan/10 text-cyan"
                  : "border-white/[0.08] bg-white/[0.03] text-[#93a7bf] hover:text-[#e4ebf7]",
              )}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => onModeChange("momentum")}
              className={cn(
                "border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                mode === "momentum"
                  ? "border-cyan/35 bg-cyan/10 text-cyan"
                  : "border-white/[0.08] bg-white/[0.03] text-[#93a7bf] hover:text-[#e4ebf7]",
              )}
            >
              Momentum
            </button>
          </div>

          <div className="min-w-0 text-right">
            <p className="text-[12px] font-medium text-[#6d819a]">
              {modeContextLabel(mode)}
            </p>
            <p className="truncate text-[13px] text-[#d6e0ed]">
              {selectedTrendLabel ?? "No narrative selected"}
            </p>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-sm text-[#7f91a9]">
          {emptyStateMessage(mode)}
        </div>
      ) : (
        <div
          data-testid="memecoin-table-scroller"
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          <div
            className={cn(
              activeTableClass,
              "sticky top-0 z-10 border-b border-white/[0.08] bg-[#090e15] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7388a2]",
            )}
          >
            <span>Coin</span>
            <span className="text-right">Price</span>
            <span className="text-right">1h</span>
            <span className="text-right">24h</span>
            <span className="text-right">Liq</span>
            <span className="text-right">Vol</span>
            {showMomentumSignal ? <span className="text-right">Signal</span> : null}
          </div>

          <div>
            {rows.map(({ row, confidenceScore, related }) => {
              const selected = row.id === selectedCoinId;
              const coinMeta = pairLabel(row);

              return (
                <button
                  key={row.id}
                  type="button"
                  data-testid="memecoin-market-row"
                  onClick={() => onSelectCoin(row.id)}
                  className={cn(
                    activeTableClass,
                    "items-center border-b border-white/[0.05] px-3 py-3 text-left transition-colors",
                    selected
                      ? "bg-[linear-gradient(90deg,rgba(26,54,68,0.92),rgba(8,12,18,0.98))] shadow-[inset_2px_0_0_rgba(77,219,147,0.9)]"
                      : related
                        ? "bg-[linear-gradient(90deg,rgba(12,24,33,0.75),rgba(8,12,18,0.96))] hover:bg-[linear-gradient(90deg,rgba(18,30,41,0.9),rgba(8,12,18,0.98))]"
                        : "hover:bg-white/[0.025]",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <CoinIcon
                      src={row.iconUrl}
                      symbol={row.symbol}
                      name={row.name}
                      className="h-7 w-7 rounded-[7px]"
                    />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p className="truncate text-[14px] font-semibold tracking-[-0.02em] text-[#eef4fd]">
                          {row.name}
                        </p>
                        <span className="truncate font-mono text-[12px] text-cyan">
                          {row.symbol}
                        </span>
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                        <p className="min-w-0 flex-1 truncate text-[12px] text-[#71859f]" title={coinMeta}>
                          {coinMeta}
                        </p>
                        <span
                          className={cn(
                            "shrink-0 font-mono text-[12px] font-semibold",
                            confidenceToneClass(confidenceScore),
                          )}
                          title={`Confidence ${confidenceScore}`}
                        >
                          C{confidenceScore}
                        </span>
                      </div>
                    </div>
                  </div>

                  <span className="text-right font-mono text-[13px] font-semibold text-[#eef4fd]">
                    {formatTokenPrice(row.priceUsd)}
                  </span>
                  <span
                    className={cn(
                      "text-right font-mono text-[13px] font-semibold",
                      changeToneClass(row.priceChange1hPct),
                    )}
                  >
                    {formatChange(row.priceChange1hPct)}
                  </span>
                  <span
                    className={cn(
                      "text-right font-mono text-[13px] font-semibold",
                      changeToneClass(row.priceChange24hPct),
                    )}
                  >
                    {formatChange(row.priceChange24hPct)}
                  </span>
                  <span className="text-right font-mono text-[13px] font-semibold text-[#d5dfec]">
                    {formatMarketValue(row.liquidityUsd)}
                  </span>
                  <span className="text-right font-mono text-[13px] font-semibold text-[#d5dfec]">
                    {formatMarketValue(row.volume24hUsd)}
                  </span>
                  {showMomentumSignal ? (
                    <div className="text-right">
                      <p
                        className={cn(
                          "font-mono text-[13px] font-semibold",
                          momentumToneClass(row.momentumScore),
                        )}
                        title={`Momentum ${row.momentumScore ?? "--"}`}
                      >
                        {typeof row.momentumScore === "number" && Number.isFinite(row.momentumScore)
                          ? row.momentumScore
                          : "--"}
                      </p>
                      <p
                        className="mt-0.5 truncate text-[10px] uppercase tracking-[0.12em] text-[#6f839d]"
                        title={row.momentumSignal ?? "Momentum"}
                      >
                        {shortMomentumSignalLabel(row.momentumSignal)}
                      </p>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
