"use client";

import {
  getTrendDisplayNameOrPlaceholder,
  hasTrustedTrendDisplayName,
} from "@/lib/dashboard/trend-name-state";
import { formatCompactNumber, formatRelativeTimeShort } from "@/lib/formatters";
import { cn } from "@/lib/utils/cn";
import { resolveNarrativeSignalState } from "@/lib/utils/narrative-state";
import { getTrendPostCount } from "@/lib/utils/trend-ranking";
import { RankedTrend } from "@/types/view-models";

type NarrativeSignalBoardProps = {
  rows: RankedTrend[];
  selectedId?: string | null;
  linkedCoinCounts: Map<string, number>;
  referenceTime: string | null | undefined;
  onSelect: (id: string) => void;
};

const TABLE_COLUMNS_CLASS =
  "grid w-full min-w-[836px] grid-cols-[38px_minmax(220px,2.6fr)_70px_54px_76px_62px_70px_104px_62px] gap-2 xl:min-w-[664px] xl:grid-cols-[34px_minmax(122px,1.85fr)_54px_58px_68px_60px_62px_84px_58px]";

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

function platformLabel(platforms: string[]) {
  if (platforms.length === 0) {
    return "--";
  }

  return platforms
    .slice(0, 3)
    .map((platform) => platform.slice(0, 3).toUpperCase())
    .join(" / ");
}

function freshnessLabel(row: RankedTrend, referenceTime: string | null | undefined) {
  const lastSeen = row.lastSeenAt ?? row.firstSeenAt ?? null;
  const relative = formatRelativeTimeShort(lastSeen, referenceTime ?? undefined);
  if (relative !== "--") {
    return relative;
  }
  return row.freshnessState === "fresh" ? "now" : row.freshnessState;
}

export function NarrativeSignalBoard({
  rows,
  selectedId,
  linkedCoinCounts,
  referenceTime,
  onSelect,
}: NarrativeSignalBoardProps) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-[#7f91a9]">
        No narratives in this window.
      </div>
    );
  }

  return (
    <div
      data-testid="narrative-signal-board"
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className={cn(
            TABLE_COLUMNS_CLASS,
            "sticky top-0 z-10 border-b border-white/[0.08] bg-[linear-gradient(180deg,rgba(9,14,21,0.98),rgba(7,11,16,0.96))] px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#7187a1] backdrop-blur-md",
          )}
        >
          <span>Rank</span>
          <span>Narrative</span>
          <span className="text-right">Posts</span>
          <span className="text-right">Vel</span>
          <span className="text-right">Engage</span>
          <span>Plat</span>
          <span>Fresh</span>
          <span>State</span>
          <span className="text-right">Linked</span>
        </div>

        <div>
          {rows.map((row) => {
            const selected = row.id === selectedId;
            const signalState = resolveNarrativeSignalState(row);
            const linkedCoins = linkedCoinCounts.get(row.id) ?? 0;
            const displayName = getTrendDisplayNameOrPlaceholder(row);
            const trustedLabel = hasTrustedTrendDisplayName(row);

            return (
              <button
                key={row.id}
                type="button"
                data-testid="narrative-row"
                onClick={() => onSelect(row.id)}
                className={cn(
                  TABLE_COLUMNS_CLASS,
                  "items-center border-b border-white/[0.05] px-3 py-2 text-left transition-colors",
                  selected
                    ? "bg-[linear-gradient(90deg,rgba(18,40,53,0.9),rgba(8,12,18,0.96))] shadow-[inset_2px_0_0_rgba(86,217,255,0.9)]"
                    : "hover:bg-white/[0.025]",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-6 w-8 items-center justify-center rounded-[6px] border font-mono text-[10px]",
                    selected
                      ? "border-cyan/28 bg-cyan/10 text-cyan"
                      : "border-white/[0.12] bg-white/[0.03] text-[#a8b8cd]",
                  )}
                >
                  {row.rank}
                </span>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[12px] font-semibold text-[#edf3fc]">
                      {displayName}
                    </p>
                    {!trustedLabel ? (
                      <span className="rounded-[5px] border border-white/[0.1] bg-white/[0.04] px-1 py-0.5 text-[8px] uppercase tracking-[0.12em] text-[#8ea2bb]">
                        Derived
                      </span>
                    ) : null}
                  </div>
                </div>

                <span className="text-right font-mono text-[11px] text-[#d5dfec]">
                  {formatCompactNumber(getTrendPostCount(row))}
                </span>

                <span
                  className={cn(
                    "text-right font-mono text-[12px] font-semibold",
                    (row.velocityScore ?? 0) >= 50 ? "text-[#f3f7ff]" : "text-[#c2cfdf]",
                  )}
                >
                  {Math.round(row.velocityScore ?? 0)}
                </span>

                <span className="text-right font-mono text-[11px] text-[#c9d5e4]">
                  {formatCompactNumber(row.totalInteractions24h ?? row.attentionInteractions)}
                </span>

                <span className="truncate text-[11px] text-[#aab9cc]">
                  {platformLabel(row.platforms)}
                </span>

                <span className="truncate text-[12px] font-semibold text-[#edf3fc]">
                  {freshnessLabel(row, referenceTime)}
                </span>

                <span
                  className={cn(
                    "inline-flex h-6 items-center justify-center truncate rounded-[6px] border px-1.5 text-[9px] font-semibold uppercase tracking-[0.12em]",
                    stateClassName(signalState),
                  )}
                >
                  {signalState}
                </span>

                <span className="text-right font-mono text-[12px] font-semibold text-cyan">
                  {linkedCoins}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
