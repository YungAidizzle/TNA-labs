"use client";

import { SkeletonBlock } from "@/components/shared/skeleton-block";
import {
  TREND_NAME_PLACEHOLDER,
  getTrendDisplayNameOrPlaceholder,
  hasTrustedTrendDisplayName,
} from "@/lib/dashboard/trend-name-state";
import { formatCompactNumber, formatSignedPercent } from "@/lib/formatters";
import { resolveNarrativeSignalState } from "@/lib/utils/narrative-state";
import { cn } from "@/lib/utils/cn";
import { getTrendPostCount } from "@/lib/utils/trend-ranking";
import { RankedTrend, TrendLeaderboardMode, TrendSort } from "@/types/view-models";

type TerminalLeaderboardTableProps = {
  rows: RankedTrend[];
  selectedId?: string | null;
  mode: TrendLeaderboardMode;
  sort: TrendSort;
  onSelect: (id: string) => void;
};

const MAX_SIGNAL_TABLE_ROWS = 250;

function sentimentColor(balance: number) {
  if (balance >= 0.2) {
    return "bg-emerald";
  }
  if (balance <= -0.2) {
    return "bg-rose";
  }
  return "bg-amber";
}

function sentimentMeter(balance: number) {
  if (balance >= 0.2) {
    return "bg-[linear-gradient(90deg,rgba(44,125,94,0.24),rgba(77,219,147,0.88))]";
  }
  if (balance <= -0.2) {
    return "bg-[linear-gradient(90deg,rgba(121,45,60,0.24),rgba(234,106,106,0.88))]";
  }
  return "bg-[linear-gradient(90deg,rgba(140,105,56,0.2),rgba(249,178,94,0.9))]";
}

function stateTone(signalState: ReturnType<typeof resolveNarrativeSignalState>) {
  if (signalState === "Emerging") {
    return "border-cyan/28 bg-cyan/10 text-cyan";
  }

  if (signalState === "Accelerating") {
    return "border-emerald/28 bg-emerald/10 text-emerald";
  }

  if (signalState === "Peaking") {
    return "border-amber/28 bg-amber/10 text-amber";
  }

  return "border-rose/28 bg-rose/10 text-rose";
}

export function TerminalLeaderboardTable({
  rows,
  selectedId,
  mode,
  sort,
  onSelect,
}: TerminalLeaderboardTableProps) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-[#7f91a9]">
        No ranked narratives in this window.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[930px]">
          <div className="grid grid-cols-[48px_minmax(220px,1.8fr)_88px_82px_82px_96px_122px_72px] gap-3 border-b border-white/[0.11] px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7890ac]">
            <span>Rank</span>
            <span>Narrative</span>
            <span className={cn("text-right", sort === "posts" ? "text-cyan" : undefined)}>
              {sort === "posts" ? "Posts v" : "Posts"}
            </span>
            <span
              className={cn(
                "text-right",
                ((mode === "emerging" && sort === "breakout") || (mode !== "emerging" && sort === "strength")) &&
                  "text-cyan",
              )}
            >
              {mode === "emerging" ? "Breakout" : "Strength"}
            </span>
            <span className={cn("text-right", sort === "velocity" ? "text-cyan" : undefined)}>Velocity</span>
            <span className="text-right">Tone</span>
            <span>State</span>
            <span className="text-right">Spread</span>
          </div>
          <div>
            {rows.slice(0, MAX_SIGNAL_TABLE_ROWS).map((row) => {
              const selected = row.id === selectedId;
              const posts = getTrendPostCount(row);
              const displayName = getTrendDisplayNameOrPlaceholder(row);
              const hasTrustedDisplayName = hasTrustedTrendDisplayName(row);
              const showLoadingLabel = displayName === TREND_NAME_PLACEHOLDER;
              const subtitle =
                row.trendDescription ??
                row.trendCategory ??
                (showLoadingLabel ? "Loading label" : null);
              const primaryScore =
                mode === "emerging"
                  ? (row.breakoutScore ?? row.emergingScore ?? 0)
                  : row.trendStrengthScore;
              const sentiment = row.sentimentBalance ?? 0;
              const signalState = resolveNarrativeSignalState(row);

              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onSelect(row.id)}
                  className={cn(
                    "grid w-full grid-cols-[48px_minmax(220px,1.8fr)_88px_82px_82px_96px_122px_72px] gap-3 border-b border-white/[0.06] px-4 py-2.5 text-left transition-colors",
                    selected
                      ? "bg-[linear-gradient(90deg,rgba(31,95,122,0.22),rgba(12,23,33,0.22))] shadow-[inset_2px_0_0_rgba(86,217,255,0.9)]"
                      : "hover:bg-white/[0.03]",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 inline-flex h-7 w-9 items-center justify-center rounded-[6px] border font-mono text-[11px]",
                      selected
                        ? "border-cyan/45 bg-cyan/12 text-cyan"
                        : "border-white/[0.12] bg-white/[0.03] text-[#a8b8cd]",
                    )}
                  >
                    {row.rank}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {!showLoadingLabel ? (
                        <p className="truncate text-[13px] font-semibold text-[#e8eef9]">{displayName}</p>
                      ) : (
                        <div className="flex min-w-0 items-center gap-2">
                          <SkeletonBlock className="h-4 w-28 rounded-sm bg-white/[0.08]" />
                          <span className="truncate text-[11px] uppercase tracking-[0.12em] text-[#6f839d]">
                            Loading...
                          </span>
                        </div>
                      )}
                      {!hasTrustedDisplayName && !showLoadingLabel ? (
                        <span className="rounded-[4px] border border-white/[0.12] bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8ea2bb]">
                          Fallback
                        </span>
                      ) : null}
                      {row.lowDataWarning ? (
                        <span className="rounded-[4px] border border-amber/28 bg-amber/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber">
                          Thin
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px]">
                      <p
                        className={cn(
                          "font-medium",
                          row.growthRate >= 0 ? "text-emerald" : "text-rose",
                        )}
                      >
                        {formatSignedPercent(row.growthRate)}
                      </p>
                      {subtitle ? <span className="truncate text-[#6f839d]">{subtitle}</span> : null}
                    </div>
                  </div>
                  <span className="py-1 text-right font-mono text-[12px] text-[#d7e2f3]">
                    {formatCompactNumber(posts)}
                  </span>
                  <span className="py-1 text-right font-mono text-[12px] text-[#d7e2f3]">
                    {primaryScore.toFixed(0)}
                  </span>
                  <span
                    className={cn(
                      "py-1 text-right font-mono text-[12px]",
                      (row.velocityScore ?? 0) >= 0 ? "text-emerald" : "text-rose",
                    )}
                  >
                    {formatCompactNumber(row.velocityScore ?? 0)}
                  </span>
                  <div className="flex items-center justify-end gap-1.5 py-1">
                    <span className={cn("h-1.5 w-8 rounded-full", sentimentMeter(sentiment))} />
                    <span className="w-8 text-right font-mono text-[10px] text-[#a6b6cb]">
                      {Math.round(sentiment * 100)}%
                    </span>
                    <span className={cn("h-1.5 w-1.5 rounded-full", sentimentColor(sentiment))} />
                  </div>
                  <span
                    className={cn(
                      "inline-flex h-7 items-center justify-center rounded-[6px] border px-2 text-[10px] font-semibold uppercase tracking-[0.13em]",
                      stateTone(signalState),
                    )}
                  >
                    {signalState}
                  </span>
                  <span className="py-1 text-right font-mono text-[12px] text-[#d7e2f3]">
                    {Math.max(row.confirmedPlatformSpread ?? row.platformSpread ?? 0, 1)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
