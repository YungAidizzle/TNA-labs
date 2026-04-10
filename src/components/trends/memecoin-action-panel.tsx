"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { NarrativeCoinOpportunity } from "@/lib/dashboard/memecoin-opportunities";
import { getTrendDisplayNameOrPlaceholder } from "@/lib/dashboard/trend-name-state";
import {
  formatCompactCurrency,
  formatHoursShort,
  formatRelativeTimeShort,
} from "@/lib/formatters";
import { cn } from "@/lib/utils/cn";
import { resolveNarrativeSignalState } from "@/lib/utils/narrative-state";
import { RankedTrend } from "@/types/view-models";

type MemecoinActionPanelProps = {
  narrative: RankedTrend | null | undefined;
  opportunities: NarrativeCoinOpportunity[];
  selectedCoinId: string | null;
  onSelectCoin: (id: string) => void;
  showAll: boolean;
  onToggleShowAll: () => void;
  referenceTime: string | null | undefined;
};

const OPPORTUNITY_GRID_CLASS =
  "grid grid-cols-[minmax(0,1fr)_42px_30px_48px_48px_50px_14px] items-center gap-0.5";

function confidenceToneClass(tier: NarrativeCoinOpportunity["confidenceTier"]) {
  if (tier === "high") {
    return "text-emerald";
  }
  if (tier === "medium") {
    return "text-amber";
  }
  if (tier === "speculative") {
    return "text-cyan";
  }
  return "text-[#9bb0c8]";
}

function confidenceLabel(tier: NarrativeCoinOpportunity["confidenceTier"]) {
  if (tier === "high") {
    return "High";
  }
  if (tier === "medium") {
    return "Medium";
  }
  if (tier === "speculative") {
    return "Speculative";
  }
  return "Coverage";
}

function riskTagClass(tag: NarrativeCoinOpportunity["riskTag"]) {
  if (tag === "STRONG") {
    return "border-emerald/24 bg-emerald/10 text-emerald";
  }
  if (tag === "NEW") {
    return "border-cyan/24 bg-cyan/10 text-cyan";
  }
  if (tag === "THIN") {
    return "border-amber/24 bg-amber/10 text-amber";
  }
  if (tag === "STALE") {
    return "border-white/[0.12] bg-white/[0.05] text-[#b8c6d8]";
  }
  return "border-rose/24 bg-rose/10 text-rose";
}

function stateClassName(state: ReturnType<typeof resolveNarrativeSignalState>) {
  if (state === "Accelerating") {
    return "border-emerald/22 bg-emerald/10 text-emerald";
  }
  if (state === "Emerging") {
    return "border-cyan/22 bg-cyan/10 text-cyan";
  }
  if (state === "Peaking") {
    return "border-amber/22 bg-amber/10 text-amber";
  }
  return "border-rose/22 bg-rose/10 text-rose";
}

function formatMarketMetric(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "--";
  }
  return formatCompactCurrency(value);
}

function panelSummary(narrative: RankedTrend) {
  return (
    narrative.trendEnrichment?.whyAttention ??
    narrative.trendNarrativeSummary ??
    narrative.trendDescription ??
    narrative.trendContextParagraph ??
    "No narrative brief available yet."
  );
}

export function MemecoinActionPanel({
  narrative,
  opportunities,
  selectedCoinId,
  onSelectCoin,
  showAll,
  onToggleShowAll,
  referenceTime,
}: MemecoinActionPanelProps) {
  if (!narrative) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-[#7f91a9]">
        Select a narrative to load action-ready memecoins.
      </div>
    );
  }

  const visibleOpportunities = showAll ? opportunities : opportunities.slice(0, 6);
  const selectedOpportunity =
    visibleOpportunities.find((item) => item.row.id === selectedCoinId) ??
    opportunities.find((item) => item.row.id === selectedCoinId) ??
    opportunities[0] ??
    null;
  const signalState = resolveNarrativeSignalState(narrative);
  const freshness = formatRelativeTimeShort(
    narrative.lastSeenAt ?? narrative.firstSeenAt,
    referenceTime ?? undefined,
  );
  const explorerHref = `/narrative-explorer/${narrative.id}`;

  return (
    <div
      data-testid="memecoin-action-panel"
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="border-b border-white/[0.08] px-3 py-3">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#6f859e]">
              Narrative Header
            </p>
            <p className="mt-0.5 text-[16px] font-semibold leading-[1.15] tracking-[-0.03em] text-[#f2f6fd]">
              {getTrendDisplayNameOrPlaceholder(narrative)}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex h-6 items-center rounded-[6px] border px-1.5 text-[9px] font-semibold uppercase tracking-[0.12em]",
              stateClassName(signalState),
            )}
          >
            {signalState}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-[#9cb0c8]">
          <span className="rounded-[6px] border border-white/[0.08] bg-white/[0.03] px-1.5 py-[3px]">
            Freshness {freshness}
          </span>
          <span className="rounded-[6px] border border-white/[0.08] bg-white/[0.03] px-1.5 py-[3px]">
            Platforms {narrative.platforms.map((platform) => platform.slice(0, 3).toUpperCase()).join(" / ") || "--"}
          </span>
        </div>

        <p className="mt-2 line-clamp-3 text-[12px] leading-[1.45] text-[#c9d5e5]">
          {panelSummary(narrative)}
        </p>
      </div>

      <div className="border-b border-white/[0.08] px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#6f859e]">
              Top Correlated Memecoins
            </p>
            <p className="mt-0.5 text-[11px] text-[#9cb0c8]">
              {opportunities.length} linked coins surfaced for this narrative.
            </p>
          </div>
          {opportunities.length > 6 ? (
            <button
              type="button"
              onClick={onToggleShowAll}
              className="rounded-[7px] border border-white/[0.1] bg-white/[0.03] px-2 py-1 text-[10px] font-medium text-[#d5e0ee] transition-colors hover:bg-white/[0.06]"
            >
              {showAll ? "Collapse set" : "View full correlated set"}
            </button>
          ) : null}
        </div>

        <div
          className={cn(
            OPPORTUNITY_GRID_CLASS,
            "mt-3 border-b border-white/[0.08] pb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#6f859e]",
          )}
        >
          <span>Coin</span>
          <span className="text-right">Conf</span>
          <span className="text-right">Age</span>
          <span className="text-right">Liq</span>
          <span className="text-right">Vol</span>
          <span className="text-right">Risk</span>
          <span />
        </div>

        <div className="mt-2 space-y-1">
          {visibleOpportunities.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-white/[0.1] px-3 py-4 text-[12px] text-[#8da2bb]">
              No correlated memecoins cleared the board for this narrative.
            </div>
          ) : null}

          {visibleOpportunities.map((item) => {
            const selected = item.row.id === selectedOpportunity?.row.id;

            return (
              <div
                key={item.row.id}
                data-testid="memecoin-opportunity-row"
                className={cn(
                  OPPORTUNITY_GRID_CLASS,
                  "rounded-[9px] border px-2.5 py-2 transition-colors",
                  selected
                    ? "border-cyan/22 bg-[linear-gradient(90deg,rgba(15,37,50,0.92),rgba(8,12,18,0.96))]"
                    : "border-white/[0.06] bg-white/[0.02]",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectCoin(item.row.id)}
                  className="min-w-0 text-left"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="truncate text-[12px] font-semibold text-[#edf3fc]">
                      {item.row.name}
                    </p>
                    <span className="truncate font-mono text-[9px] uppercase tracking-[0.1em] text-cyan">
                      {item.row.symbol}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[9px] leading-[1.3] text-[#8195ad]">
                    {item.activeLink?.topicLabel ?? item.row.strongestTrendLabel}
                  </p>
                </button>

                <div className="text-right">
                  <p
                    className={cn(
                      "font-mono text-[11px] font-semibold",
                      confidenceToneClass(item.confidenceTier),
                    )}
                  >
                    {item.confidenceScore}
                  </p>
                  <p className="text-[8px] uppercase tracking-[0.12em] text-[#8195ad]">
                    {confidenceLabel(item.confidenceTier)}
                  </p>
                </div>

                <span className="text-right font-mono text-[11px] font-semibold text-[#edf3fc]">
                  {formatHoursShort(item.row.pairAgeHours)}
                </span>

                <span className="text-right font-mono text-[10px] text-[#d5dfec]">
                  {formatMarketMetric(item.row.liquidityUsd)}
                </span>

                <span className="text-right font-mono text-[10px] text-[#d5dfec]">
                  {formatMarketMetric(item.row.volume24hUsd)}
                </span>

                <div className="flex justify-end">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-[6px] border px-1.5 py-[3px] text-[8px] font-semibold uppercase tracking-[0.12em]",
                      riskTagClass(item.riskTag),
                    )}
                  >
                    {item.riskTag}
                  </span>
                </div>

                <a
                  href={item.row.dexscreenerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-white/[0.08] bg-[#071018] text-[#a7b7ca] transition-colors hover:text-[#edf3fc]"
                  aria-label={`Open ${item.row.name} on Dexscreener`}
                >
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              </div>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.02] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#6f859e]">
                Why This Coin
              </p>
              <p className="mt-0.5 truncate text-[15px] font-semibold tracking-[-0.02em] text-[#edf3fc]">
                {selectedOpportunity
                  ? `${selectedOpportunity.row.name} (${selectedOpportunity.row.symbol})`
                  : "No coin selected"}
              </p>
            </div>
            {selectedOpportunity ? (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <span
                  className={cn(
                    "inline-flex items-center rounded-[7px] border px-1.5 py-[3px] text-[8px] font-semibold uppercase tracking-[0.12em]",
                    riskTagClass(selectedOpportunity.riskTag),
                  )}
                >
                  {selectedOpportunity.riskTag}
                </span>
                <span className="inline-flex items-center rounded-[7px] border border-white/[0.1] bg-white/[0.04] px-1.5 py-[3px] text-[8px] font-semibold uppercase tracking-[0.12em] text-[#d9e6f4]">
                  {selectedOpportunity.confidenceScore} {confidenceLabel(selectedOpportunity.confidenceTier)}
                </span>
              </div>
            ) : null}
          </div>

          {selectedOpportunity ? (
            <>
              <div className="mt-3 grid gap-2.5 2xl:grid-cols-2">
                <div className="rounded-[9px] border border-white/[0.08] bg-[#070d14] px-2.5 py-2.5">
                  <p className="text-[9px] uppercase tracking-[0.16em] text-[#6f859e]">
                    Keyword Overlap
                  </p>
                  <p className="mt-1.5 break-words text-[12px] text-[#d9e3f0]">
                    {selectedOpportunity.keywordOverlap.length > 0
                      ? selectedOpportunity.keywordOverlap.join(" / ")
                      : "Narrative link score carried the match more than direct token overlap."}
                  </p>
                </div>

                <div className="rounded-[9px] border border-white/[0.08] bg-[#070d14] px-2.5 py-2.5">
                  <p className="text-[9px] uppercase tracking-[0.16em] text-[#6f859e]">
                    Narrative Evidence
                  </p>
                  <p className="mt-1.5 break-words text-[12px] text-[#d9e3f0]">
                    {(selectedOpportunity.activeLink?.supportPostCount ?? 0) > 0
                      ? `${selectedOpportunity.activeLink?.supportPostCount} supporting posts with link score ${Math.round(
                          selectedOpportunity.activeLink?.linkScore ?? 0,
                        )}.`
                      : "No direct supporting posts were captured, so this stays speculative unless market quality improves."}
                  </p>
                </div>
              </div>

              <p className="mt-3 break-words text-[12px] leading-[1.55] text-[#c7d4e4]">
                {selectedOpportunity.explanation}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  href={explorerHref}
                  className="rounded-[7px] border border-white/[0.1] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-[#d7e2ef] transition-colors hover:bg-white/[0.06]"
                >
                  Open social mentions
                </Link>
                <a
                  href={selectedOpportunity.row.dexscreenerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-[7px] border border-cyan/18 bg-cyan/10 px-2.5 py-1.5 text-[11px] font-medium text-cyan transition-colors hover:bg-cyan/14"
                >
                  Open market view
                </a>
              </div>
            </>
          ) : (
            <p className="mt-3 text-[12px] text-[#8da2bb]">
              No actionable memecoins are linked to this narrative right now.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
