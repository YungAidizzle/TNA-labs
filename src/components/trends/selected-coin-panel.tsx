"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Copy, Globe, MessageSquareShare } from "lucide-react";
import { SkeletonBlock } from "@/components/shared/skeleton-block";
import { CoinIcon } from "@/components/trends/coin-icon";
import {
  TradingViewChartPreview,
  type TradingViewChartPreviewStatus,
} from "@/components/trends/tradingview-chart-preview";
import { dashboardClient } from "@/lib/dashboard/client";
import {
  type TradingViewPreviewFailureCode,
  type TradingViewPreviewResponse,
} from "@/lib/dashboard/tradingview-preview";
import { resolveDexscreenerUrl } from "@/lib/dashboard/dexscreener-url";
import { formatCompactCurrency, formatCurrency, formatHoursShort, formatSignedPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils/cn";
import type { MemecoinTerminalRow } from "@/components/trends/memecoin-market-table";

type SelectedCoinPanelProps = {
  selectedCoin: MemecoinTerminalRow | null;
  loading?: boolean;
  allowMarketPreview?: boolean;
  previewOverride?: TradingViewPreviewResponse | null;
};

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

function formatChange(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return formatSignedPercent(value, 1);
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

  return "text-[#c5d1de]";
}

function firstWebsiteUrl(row: MemecoinTerminalRow["row"]) {
  return row.websites?.find((entry) => entry.url)?.url ?? null;
}

function firstSocial(row: MemecoinTerminalRow["row"]) {
  const socials = row.socials ?? [];
  const preferred =
    socials.find((entry) => ["twitter", "x", "telegram"].includes(String(entry.type ?? "").toLowerCase())) ??
    socials.find((entry) => entry.url);

  return preferred ?? null;
}

function socialLabel(type: string | null | undefined) {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (normalized === "twitter" || normalized === "x") {
    return "Open X";
  }
  if (normalized === "telegram") {
    return "Open Telegram";
  }

  return "Open Social";
}

function pairLabel(row: MemecoinTerminalRow["row"]) {
  if (row.quoteSymbol) {
    return `${row.symbol}/${row.quoteSymbol}`;
  }

  return row.symbol;
}

function confidenceToneClass(score: number) {
  if (score >= 80) {
    return "border-emerald/28 bg-emerald/10 text-emerald";
  }
  if (score >= 60) {
    return "border-amber/28 bg-amber/10 text-amber";
  }
  if (score >= 40) {
    return "border-cyan/28 bg-cyan/10 text-cyan";
  }

  return "border-white/[0.12] bg-white/[0.05] text-[#b8c6d8]";
}

type PreviewRenderMode = "tradingview" | "dexscreener" | "unavailable";

function resolvePreviewRenderMode(
  preview: TradingViewPreviewResponse | null,
  options: {
    widgetFailureCode: TradingViewPreviewFailureCode | null;
    dexUrl: string | null;
  },
): PreviewRenderMode {
  if (preview?.status === "tradingview" && preview.tradingviewSymbol && !options.widgetFailureCode) {
    return "tradingview";
  }

  if (preview?.status === "dexscreener") {
    return "dexscreener";
  }

  if (options.widgetFailureCode && options.dexUrl) {
    return "dexscreener";
  }

  if (preview && options.dexUrl) {
    return "dexscreener";
  }

  return "unavailable";
}

function previewSubtitle(
  mode: PreviewRenderMode,
  loading: boolean,
  marketPreviewEnabled: boolean,
) {
  if (!marketPreviewEnabled) {
    return "Static marketing capture";
  }

  if (loading) {
    return "Resolving market preview";
  }

  if (mode === "tradingview") {
    return "Live TradingView chart";
  }

  return mode === "dexscreener" ? "Dexscreener market preview" : "Preview unavailable";
}

function previewBadgeText(mode: PreviewRenderMode, marketPreviewEnabled: boolean) {
  if (!marketPreviewEnabled) {
    return "STATIC";
  }

  if (mode === "tradingview") {
    return null;
  }

  return mode === "dexscreener" ? "DEX" : "UNAVAILABLE";
}

function degradedPreviewHeadline(mode: PreviewRenderMode, widgetFailureCode: TradingViewPreviewFailureCode | null) {
  if (mode === "tradingview" && !widgetFailureCode) {
    return "Live TradingView chart";
  }

  return mode === "dexscreener" ? "Dexscreener market preview" : "Preview unavailable";
}

function degradedPreviewMessage(
  mode: PreviewRenderMode,
  widgetFailureCode: TradingViewPreviewFailureCode | null,
  detail: string | null,
) {
  if (mode === "tradingview" && !widgetFailureCode) {
    return "TradingView resolved a compatible market for this asset.";
  }

  if (mode === "dexscreener") {
    if (widgetFailureCode) {
      return "TradingView did not finish loading in the panel, so the preview fell back to Dexscreener.";
    }

    return "TradingView mapping was unavailable for this asset, so the panel fell back to Dexscreener.";
  }

  if (widgetFailureCode) {
    return "TradingView returned a market symbol, but the embedded chart did not finish loading in the panel.";
  }

  return detail
    ? "TradingView did not return a compatible market symbol for this asset."
    : "A compatible TradingView market is not available for this asset yet.";
}

function buildPreviewDebugLog(
  preview: TradingViewPreviewResponse,
  widgetFailureCode: TradingViewPreviewFailureCode | null,
  widgetMounted: boolean,
) {
  return {
    status: preview.status,
    ...preview.debug,
    failureCode: preview.failureCode,
    failureDetail: preview.failureDetail,
    displayMode: preview.displayMode,
    snapshotImageUrl: preview.snapshotImageUrl,
    failureReason: widgetFailureCode ?? preview.failureCode,
    fallbackTriggeredBeforeMountCompleted: Boolean(widgetFailureCode),
    widgetMounted,
  };
}

type ChartPreviewState = {
  key: string;
  mounted: boolean;
  failureCode: TradingViewPreviewFailureCode | null;
};

export function SelectedCoinPanel({
  selectedCoin,
  loading = false,
  allowMarketPreview = true,
  previewOverride = null,
}: SelectedCoinPanelProps) {
  const [copiedCoinId, setCopiedCoinId] = useState<string | null>(null);
  const [chartPreviewState, setChartPreviewState] = useState<ChartPreviewState>({
    key: "empty",
    mounted: false,
    failureCode: null,
  });
  const row = selectedCoin?.row ?? null;
  const rowIsLive = row ? row.isLive !== false && row.validationStatus !== "invalid" : false;
  const resolvedDexscreenerUrl = row
    ? resolveDexscreenerUrl({
        chainId: row.chainId,
        pairAddress: row.pairAddress,
        tokenAddress: row.tokenAddress,
        dexscreenerUrl: row.dexscreenerUrl,
      })
    : null;
  const previewRow = row
    ? {
        ...row,
        dexscreenerUrl: resolvedDexscreenerUrl ?? row.dexscreenerUrl,
      }
    : null;
  const previewQuery = useQuery({
    queryKey: previewRow
      ? [
          "memecoin-preview",
          previewRow.id,
          previewRow.chainId,
          previewRow.pairAddress,
          previewRow.tokenAddress,
          previewRow.symbol,
          previewRow.quoteSymbol,
          previewRow.tradingviewSymbol,
          previewRow.priceUsd,
          previewRow.priceChange1hPct,
          previewRow.priceChange6hPct,
          previewRow.priceChange24hPct,
          resolvedDexscreenerUrl,
          previewRow.updatedAt,
        ]
      : ["memecoin-preview", "empty"],
    queryFn: ({ signal }) => {
      if (!previewRow) {
        throw new Error("No memecoin selected");
      }

      return dashboardClient.getMemecoinPreview(previewRow, { signal });
    },
    enabled: Boolean(
      !previewOverride &&
      allowMarketPreview &&
      previewRow &&
      rowIsLive &&
      resolvedDexscreenerUrl,
    ),
    staleTime: 5 * 60_000,
  });
  const preview = previewOverride ?? previewQuery.data ?? null;
  const previewLoading = !previewOverride && previewQuery.isPending;
  const previewSessionKey = row
    ? `${row.id}:${preview?.status === "tradingview" ? preview.tradingviewSymbol : "none"}`
    : "empty";
  const copied = copiedCoinId === row?.id;
  const widgetMounted =
    chartPreviewState.key === previewSessionKey && chartPreviewState.mounted;
  const widgetFailureCode =
    chartPreviewState.key === previewSessionKey
      ? chartPreviewState.failureCode
      : null;

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !previewQuery.data) {
      return;
    }

    console.info(
      "[memecoin-preview-debug]",
      buildPreviewDebugLog(previewQuery.data, widgetFailureCode, widgetMounted),
    );
  }, [previewQuery.data, widgetFailureCode, widgetMounted]);

  if (loading) {
    return (
      <div data-testid="selected-coin-panel" className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="border-b border-white/[0.08] px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <SkeletonBlock className="h-12 w-12 rounded-[10px] bg-gradient-to-r from-white/[0.06] via-white/[0.11] to-white/[0.06]" />
              <div className="min-w-0">
                <SkeletonBlock className="h-6 w-36 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SkeletonBlock className="h-3 w-10 bg-gradient-to-r from-cyan/14 via-cyan/24 to-cyan/14" />
                  <SkeletonBlock className="h-3 w-16 bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]" />
                  <SkeletonBlock className="h-3 w-12 bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]" />
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              <div className="border border-white/[0.12] bg-white/[0.05] px-2.5 py-1.5">
                <SkeletonBlock className="h-3 w-20 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
              </div>
              <SkeletonBlock className="h-6 w-20 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
            </div>
          </div>
        </div>

        <div className="border-b border-white/[0.08] px-3 py-3">
          <div className="grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {["Liquidity", "24h Volume", "Market Cap", "FDV", "Age", "24h Transactions"].map((label, index) => (
              <div key={label} className="border-b border-white/[0.06] px-0 py-2">
                <p className="text-[12px] font-medium text-[#6e839c]">{label}</p>
                <SkeletonBlock
                  className={cn(
                    "mt-2 h-4 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]",
                    index % 3 === 0 ? "w-20" : index % 3 === 1 ? "w-16" : "w-14",
                  )}
                />
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-1 border-t border-white/[0.06] pt-3 sm:grid-cols-3">
            {["1h", "6h", "24h"].map((label) => (
              <div key={label} className="flex items-center justify-between border-b border-white/[0.06] px-0 py-2 sm:block sm:text-left">
                <p className="text-[12px] font-medium text-[#6e839c]">{label}</p>
                <SkeletonBlock className="h-4 w-12 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
              </div>
            ))}
          </div>
        </div>

        <div className="border-b border-white/[0.08] px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium text-[#6d819a]">Chart Preview</p>
              <SkeletonBlock className="mt-1 h-4 w-40 bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]" />
            </div>
            <div className="border border-white/[0.12] bg-white/[0.04] px-2 py-1">
              <SkeletonBlock className="h-3 w-16 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
            </div>
          </div>

          <div className="relative h-[320px] border border-white/[0.08] bg-[#050911] px-4 py-4">
            <div className="flex h-full flex-col justify-between">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SkeletonBlock className="h-4 w-28 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
                  <SkeletonBlock className="mt-2 h-3 w-44 bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]" />
                </div>
                <SkeletonBlock className="h-8 w-24 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
              </div>

              <div className="grid h-[138px] grid-cols-12 items-end gap-2">
                {[48, 62, 54, 72, 66, 88, 74, 94, 70, 82, 60, 76].map((height, index) => (
                  <SkeletonBlock
                    key={`selected-coin-chart-bar-${index}`}
                    className="w-full bg-gradient-to-t from-cyan/10 via-cyan/18 to-white/[0.05]"
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <SkeletonBlock className="h-5 w-20 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
                <SkeletonBlock className="h-5 w-24 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
                <SkeletonBlock className="h-5 w-16 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
              </div>
            </div>
          </div>
        </div>

        <div className="px-3 py-3">
          <div className="flex flex-wrap gap-2">
            <SkeletonBlock className="h-9 w-[132px] bg-gradient-to-r from-cyan/14 via-cyan/24 to-cyan/14" />
            <SkeletonBlock className="h-9 w-[120px] bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
            <SkeletonBlock className="h-9 w-[108px] bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
            {["Link Score", "Support Posts"].map((label, index) => (
              <div key={label} className="border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
                <p className="text-[12px] font-medium text-[#6d819a]">{label}</p>
                <SkeletonBlock
                  className={cn(
                    "mt-2 h-5 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]",
                    index === 0 ? "w-12" : "w-10",
                  )}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!selectedCoin || !row) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-[13px] text-[#7f91a9]">
        Select a memecoin to load market validation.
      </div>
    );
  }

  if (!rowIsLive) {
    return (
      <div
        data-testid="selected-coin-panel"
        className="flex h-full items-center justify-center px-4 text-center text-[13px] text-[#7f91a9]"
      >
        The selected coin is no longer live on Dexscreener. The panel will move to the next valid market.
      </div>
    );
  }

  const { activeLink, confidenceScore } = selectedCoin;
  const websiteUrl = firstWebsiteUrl(row);
  const social = firstSocial(row);
  const previewFailureDetail =
    preview?.failureDetail ??
    (previewQuery.error ? String((previewQuery.error as Error)?.message ?? "") : null);
  const previewDexUrl = preview?.dexUrl || resolvedDexscreenerUrl;
  const previewSnapshotUrl = preview?.snapshotImageUrl ?? null;
  const previewSymbol = preview?.status === "tradingview" ? preview.tradingviewSymbol : null;
  const previewRenderMode = allowMarketPreview
    ? resolvePreviewRenderMode(preview, {
        widgetFailureCode,
        dexUrl: previewDexUrl,
      })
    : "unavailable";
  const showChart = previewRenderMode === "tradingview";
  const showDexPreview = previewRenderMode === "dexscreener";
  const showChartLoadingOverlay =
    previewLoading || Boolean(showChart && !widgetMounted && !widgetFailureCode);

  const handleChartStatusChange = (status: TradingViewChartPreviewStatus) => {
    if (status.state === "mounting") {
      setChartPreviewState({
        key: previewSessionKey,
        mounted: false,
        failureCode: null,
      });
      return;
    }

    if (status.state === "mounted") {
      setChartPreviewState({
        key: previewSessionKey,
        mounted: true,
        failureCode: null,
      });
      return;
    }

    setChartPreviewState({
      key: previewSessionKey,
      mounted: false,
      failureCode: status.failureCode,
    });
  };

  return (
    <div data-testid="selected-coin-panel" className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-white/[0.08] px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <CoinIcon
              src={row.iconUrl}
              symbol={row.symbol}
              name={row.name}
              className="h-12 w-12 rounded-[10px]"
              labelClassName="text-[11px]"
            />
            <div className="min-w-0">
              <p className="truncate text-[20px] font-semibold tracking-[-0.03em] text-[#eef4fd]">
                {row.name}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[#7f92ab]">
                <span className="font-mono text-cyan">{row.symbol}</span>
                <span>{pairLabel(row)}</span>
                <span>{row.chainLabel}</span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <span
              className={cn(
                "inline-flex items-center border px-2.5 py-1.5 text-[12px] font-medium",
                confidenceToneClass(confidenceScore),
              )}
            >
              Confidence {confidenceScore}
            </span>
            <p className="text-right font-mono text-[22px] font-semibold tracking-[-0.03em] text-[#f3f7fd]">
              {formatTokenPrice(row.priceUsd)}
            </p>
          </div>
        </div>
      </div>

      <div className="border-b border-white/[0.08] px-3 py-3">
        <div className="grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { label: "Liquidity", value: formatMarketValue(row.liquidityUsd) },
            { label: "24h Volume", value: formatMarketValue(row.volume24hUsd) },
            { label: "Market Cap", value: formatMarketValue(row.marketCapUsd) },
            { label: "FDV", value: formatMarketValue(row.fdvUsd) },
            { label: "Age", value: formatHoursShort(row.pairAgeHours) },
            {
              label: "24h Transactions",
              value:
                typeof row.txns24h === "number" && Number.isFinite(row.txns24h)
                  ? row.txns24h.toLocaleString("en-US")
                  : "--",
            },
          ].map((metric) => (
            <div key={metric.label} className="border-b border-white/[0.06] px-0 py-2">
              <p className="text-[12px] font-medium text-[#6e839c]">{metric.label}</p>
              <p className="mt-1 text-[14px] font-semibold text-[#eef4fd]">{metric.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-1 border-t border-white/[0.06] pt-3 sm:grid-cols-3">
          {[
            { label: "1h", value: row.priceChange1hPct },
            { label: "6h", value: row.priceChange6hPct },
            { label: "24h", value: row.priceChange24hPct },
          ].map((change) => (
            <div key={change.label} className="flex items-center justify-between border-b border-white/[0.06] px-0 py-2 sm:block sm:text-left">
              <p className="text-[12px] font-medium text-[#6e839c]">{change.label}</p>
              <p className={cn("mt-0 sm:mt-1 font-mono text-[14px] font-semibold", changeToneClass(change.value))}>
                {formatChange(change.value)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-white/[0.08] px-3 py-3">
        <div className="mb-2 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-[#6d819a]">Chart Preview</p>
            <p className="text-[13px] text-[#a7b7ca]">
              {previewSubtitle(previewRenderMode, previewLoading, allowMarketPreview)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-start justify-end gap-2 self-start">
            {resolvedDexscreenerUrl ? (
              <a
                data-testid="selected-coin-dexscreener-link"
                href={resolvedDexscreenerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 whitespace-nowrap border border-cyan/28 bg-cyan/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan transition-colors hover:bg-cyan/14"
              >
                View on Dexscreener
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            ) : null}

            {previewSymbol ? (
              <span className="whitespace-nowrap border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[12px] font-mono text-[#c9d4e2]">
                {previewSymbol}
              </span>
            ) : previewBadgeText(previewRenderMode, allowMarketPreview) ? (
              <span className="whitespace-nowrap border border-white/[0.12] bg-white/[0.04] px-2 py-1 text-[12px] font-mono text-[#c9d4e2]">
                {previewBadgeText(previewRenderMode, allowMarketPreview)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="relative h-[320px] border border-white/[0.08] bg-[#050911]">
          {!allowMarketPreview ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <CoinIcon
                src={row.iconUrl}
                symbol={row.symbol}
                name={row.name}
                className="h-16 w-16 rounded-[14px]"
                labelClassName="text-[13px]"
              />
              <div>
                <p className="text-[18px] font-semibold tracking-[-0.03em] text-[#eef4fd]">
                  Static preview capture
                </p>
                <p className="mt-2 max-w-[320px] text-[13px] leading-[1.55] text-[#9cb0c7]">
                  Live market embeds are disabled for this marketing capture so the preview stays self-contained.
                </p>
              </div>
            </div>
          ) : showChart && previewSymbol ? (
            <>
              <TradingViewChartPreview symbol={previewSymbol} onStatusChange={handleChartStatusChange} />
              {showChartLoadingOverlay ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#050911]/70 text-center">
                  <p className="text-[13px] font-semibold text-cyan">
                    Loading chart preview
                  </p>
                  <p className="max-w-[260px] text-[13px] text-[#a5b7cc]">
                    Waiting for TradingView to finish mounting the embedded chart.
                  </p>
                </div>
              ) : null}
            </>
          ) : showDexPreview ? (
            previewSnapshotUrl && previewDexUrl ? (
              <a
                href={previewDexUrl}
                target="_blank"
                rel="noreferrer"
                className="group relative block h-full w-full overflow-hidden"
              >
                <img
                  src={previewSnapshotUrl}
                  alt={preview?.snapshotAlt ?? `${pairLabel(row)} Dexscreener market snapshot`}
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.01]"
                />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-[#050911] via-[#050911]/85 to-transparent px-4 py-3">
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-cyan">DEX Snapshot</p>
                    <p className="mt-1 text-[13px] text-[#d5e1ef]">{pairLabel(row)} on Dexscreener</p>
                  </div>
                  <span className="inline-flex items-center gap-2 border border-cyan/28 bg-cyan/10 px-3 py-2 text-[12px] font-semibold text-cyan">
                    Open Dexscreener
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </a>
            ) : previewSnapshotUrl ? (
              <div className="relative h-full w-full overflow-hidden">
                <img
                  src={previewSnapshotUrl}
                  alt={preview?.snapshotAlt ?? `${pairLabel(row)} Dexscreener market snapshot`}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#050911] via-[#050911]/85 to-transparent px-4 py-3">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-cyan">DEX Snapshot</p>
                  <p className="mt-1 text-[13px] text-[#d5e1ef]">{pairLabel(row)} on Dexscreener</p>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                <CoinIcon
                  src={row.iconUrl}
                  symbol={row.symbol}
                  name={row.name}
                  className="h-16 w-16 rounded-[14px]"
                  labelClassName="text-[13px]"
                />
                <div>
                  <p className="text-[18px] font-semibold tracking-[-0.03em] text-[#eef4fd]">
                    {degradedPreviewHeadline(previewRenderMode, widgetFailureCode)}
                  </p>
                  <p className="mt-2 max-w-[320px] text-[13px] leading-[1.55] text-[#9cb0c7]">
                    {degradedPreviewMessage(previewRenderMode, widgetFailureCode, previewFailureDetail)}
                  </p>
                </div>
                {previewDexUrl ? (
                  <a
                    href={previewDexUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 border border-cyan/28 bg-cyan/10 px-3 py-2 text-[12px] font-semibold text-cyan transition-colors hover:bg-cyan/14"
                  >
                    Open Dexscreener
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>
            )
          ) : previewQuery.isPending ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-[13px] font-semibold text-cyan">
                Resolving Market Preview
              </p>
              <p className="max-w-[280px] text-[13px] leading-[1.55] text-[#9cb0c7]">
                Ranking market pairs and checking TradingView before falling back to Dexscreener when needed.
              </p>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <CoinIcon
                src={row.iconUrl}
                symbol={row.symbol}
                name={row.name}
                className="h-16 w-16 rounded-[14px]"
                labelClassName="text-[13px]"
              />
              <div>
                <p className="text-[18px] font-semibold tracking-[-0.03em] text-[#eef4fd]">
                  {degradedPreviewHeadline(previewRenderMode, widgetFailureCode)}
                </p>
                <p className="mt-2 max-w-[320px] text-[13px] leading-[1.55] text-[#9cb0c7]">
                  {degradedPreviewMessage(previewRenderMode, widgetFailureCode, previewFailureDetail)}
                </p>
              </div>
              {previewDexUrl ? (
                <a
                  href={previewDexUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 border border-cyan/28 bg-cyan/10 px-3 py-2 text-[12px] font-semibold text-cyan transition-colors hover:bg-cyan/14"
                >
                  Open Dexscreener
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="px-3 py-3">
        <div className="flex flex-wrap gap-2">
          {resolvedDexscreenerUrl ? (
            <a
              href={resolvedDexscreenerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 border border-cyan/28 bg-cyan/10 px-3 py-2 text-[12px] font-semibold text-cyan transition-colors hover:bg-cyan/14"
            >
              Open Dexscreener
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          ) : null}

          {websiteUrl ? (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-[12px] font-medium text-[#dce6f4] transition-colors hover:bg-white/[0.06]"
            >
              <Globe className="h-3.5 w-3.5" />
              Open Website
            </a>
          ) : null}

          {social?.url ? (
            <a
              href={social.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-[12px] font-medium text-[#dce6f4] transition-colors hover:bg-white/[0.06]"
            >
              <MessageSquareShare className="h-3.5 w-3.5" />
              {socialLabel(social.type)}
            </a>
          ) : null}

          {(row.pairAddress || row.tokenAddress) ? (
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(row.pairAddress || row.tokenAddress);
                  setCopiedCoinId(row.id);
                  window.setTimeout(() => setCopiedCoinId((current) => (current === row.id ? null : current)), 1500);
                } catch {
                  setCopiedCoinId(null);
                }
              }}
              className="inline-flex items-center gap-2 border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-[12px] font-medium text-[#dce6f4] transition-colors hover:bg-white/[0.06]"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy Pair"}
            </button>
          ) : null}
        </div>

        {activeLink ? (
          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
            <div className="border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
              <p className="text-[12px] font-medium text-[#6d819a]">Link Score</p>
              <p
                data-testid="selected-coin-link-score"
                className="mt-1 font-mono text-[16px] font-semibold text-[#eef4fd]"
              >
                {Math.round(activeLink.linkScore)}
              </p>
            </div>
            <div className="border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
              <p className="text-[12px] font-medium text-[#6d819a]">Support Posts</p>
              <p
                data-testid="selected-coin-support-posts"
                className="mt-1 font-mono text-[16px] font-semibold text-[#eef4fd]"
              >
                {activeLink.supportPostCount.toLocaleString("en-US")}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
