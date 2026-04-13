"use client";

import { SkeletonBlock } from "@/components/shared/skeleton-block";
import {
  getTrendDisplayNameOrPlaceholder,
} from "@/lib/dashboard/trend-name-state";
import { formatCompactNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils/cn";
import { getTrendPostCount } from "@/lib/utils/trend-ranking";
import { RankedTrend } from "@/types/view-models";

type NarrativeTrendsTableProps = {
  rows: RankedTrend[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
};

const TABLE_CLASS =
  "grid w-full grid-cols-[30px_minmax(0,1fr)_62px] gap-x-2.5 md:grid-cols-[36px_minmax(0,1fr)_70px]";
const NARRATIVE_NAME_WIDTHS = [
  "w-[72%]",
  "w-[54%]",
  "w-[66%]",
  "w-[61%]",
  "w-[78%]",
  "w-[58%]",
  "w-[69%]",
  "w-[52%]",
  "w-[74%]",
  "w-[57%]",
];
const NARRATIVE_POST_WIDTHS = [
  "w-8",
  "w-10",
  "w-9",
  "w-11",
  "w-8",
  "w-10",
];

export function NarrativeTrendsTable({
  rows,
  selectedId,
  onSelect,
  loading = false,
}: NarrativeTrendsTableProps) {
  if (loading) {
    return (
      <div data-testid="narrative-signal-board" className="flex h-full min-h-0 flex-col overflow-hidden">
        <div
          data-testid="narrative-table-scroller"
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          <div
            className={cn(
              TABLE_CLASS,
              "sticky top-0 z-10 border-b border-white/[0.08] bg-[#090e15] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7388a2]",
            )}
          >
            <span>#</span>
            <span>Narrative</span>
            <span className="text-right">Posts</span>
          </div>

          <div>
            {Array.from({ length: 12 }).map((_, index) => {
              const selected = index === 0;
              return (
                <div
                  key={`narrative-row-skeleton-${index}`}
                  className={cn(
                    TABLE_CLASS,
                    "items-center border-b border-white/[0.05] px-3 py-3.5",
                    selected
                      ? "bg-[linear-gradient(90deg,rgba(16,44,58,0.92),rgba(8,12,18,0.98))] shadow-[inset_2px_0_0_rgba(86,217,255,0.95)]"
                      : undefined,
                  )}
                >
                  <SkeletonBlock className="h-4 w-4 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
                  <SkeletonBlock
                    className={cn(
                      "h-4 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]",
                      NARRATIVE_NAME_WIDTHS[index % NARRATIVE_NAME_WIDTHS.length],
                    )}
                  />
                  <div className="flex justify-end">
                    <SkeletonBlock
                      className={cn(
                        "h-4 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]",
                        NARRATIVE_POST_WIDTHS[index % NARRATIVE_POST_WIDTHS.length],
                      )}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-[13px] text-[#7f91a9]">
        No narratives in this window.
      </div>
    );
  }

  return (
    <div data-testid="narrative-signal-board" className="flex h-full min-h-0 flex-col overflow-hidden">
      <div
        data-testid="narrative-table-scroller"
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div
          className={cn(
            TABLE_CLASS,
            "sticky top-0 z-10 border-b border-white/[0.08] bg-[#090e15] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7388a2]",
          )}
        >
          <span>#</span>
          <span>Narrative</span>
          <span className="text-right">Posts</span>
        </div>

        <div>
          {rows.map((row) => {
            const selected = row.id === selectedId;

            return (
              <button
                key={row.id}
                type="button"
                data-testid="narrative-row"
                onClick={() => onSelect(row.id)}
                className={cn(
                  TABLE_CLASS,
                  "items-center border-b border-white/[0.05] px-3 py-3.5 text-left transition-colors",
                  selected
                    ? "bg-[linear-gradient(90deg,rgba(16,44,58,0.92),rgba(8,12,18,0.98))] shadow-[inset_2px_0_0_rgba(86,217,255,0.95)]"
                    : "hover:bg-white/[0.03]",
                )}
              >
                <span className={cn("font-mono text-[13px] font-semibold", selected ? "text-cyan" : "text-[#8fa3bd]")}>
                  {row.rank}
                </span>

                <p className="line-clamp-2 min-w-0 pr-1 text-[14px] font-semibold leading-[1.25] tracking-[-0.02em] text-[#eef4fd] md:text-[15px]">
                  {getTrendDisplayNameOrPlaceholder(row)}
                </p>

                <span className="text-right font-mono text-[13px] font-semibold text-[#d7e1ee] md:text-[14px]">
                  {formatCompactNumber(getTrendPostCount(row))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
