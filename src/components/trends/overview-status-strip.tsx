"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { SkeletonBlock } from "@/components/shared/skeleton-block";
import { cn } from "@/lib/utils/cn";

type StatusStripItem = {
  label: string;
  value: string;
  tone?: "neutral" | "green" | "red" | "amber";
};

type OverviewStatusStripProps = {
  items?: StatusStripItem[];
  systemDetails?: StatusStripItem[] | null;
  loading?: boolean;
};

const LOADING_ITEMS: Array<StatusStripItem & { valueWidth: string }> = [
  { label: "Active narratives", tone: "neutral", value: "", valueWidth: "w-10" },
  { label: "Avg confidence", tone: "neutral", value: "", valueWidth: "w-12" },
  { label: "Last update", tone: "neutral", value: "", valueWidth: "w-14" },
  { label: "Status", tone: "green", value: "", valueWidth: "w-10" },
];

function toneClassName(tone: StatusStripItem["tone"]) {
  if (tone === "green") {
    return "text-emerald";
  }
  if (tone === "red") {
    return "text-rose";
  }
  if (tone === "amber") {
    return "text-amber";
  }

  return "text-[#f3f7fd]";
}

export function OverviewStatusStrip({
  items = [],
  systemDetails = null,
  loading = false,
}: OverviewStatusStripProps) {
  const [showSystemDetails, setShowSystemDetails] = useState(false);
  const renderedItems: Array<StatusStripItem & { valueWidth?: string }> = loading ? LOADING_ITEMS : items;
  const hasSystemDetails = !loading && Boolean(systemDetails?.length);

  return (
    <section
      id="overview"
      data-testid="trend-live-strip"
      className="shrink-0 border border-[#1d2a37] bg-[linear-gradient(180deg,rgba(8,12,18,0.995),rgba(5,8,12,0.995))]"
    >
      <div className="flex min-h-[56px] items-stretch">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {renderedItems.map((item, index) => (
            <div
              key={item.label}
              data-testid="trend-live-strip-item"
              className={cn(
                "flex min-w-[176px] flex-1 items-center gap-3 px-4 py-3.5",
                index > 0 ? "border-l border-white/[0.08]" : undefined,
              )}
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6d8098]">
                {item.label}
              </span>
              {loading ? (
                <SkeletonBlock
                  className={cn(
                    "ml-auto h-5 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]",
                    item.valueWidth ?? "w-12",
                  )}
                />
              ) : (
                <span className={cn("ml-auto text-[19px] font-semibold tracking-[-0.03em]", toneClassName(item.tone))}>
                  {item.value}
                </span>
              )}
            </div>
          ))}
        </div>

        {hasSystemDetails ? (
          <button
            type="button"
            data-testid="trend-live-strip-details-toggle"
            onClick={() => setShowSystemDetails((current) => !current)}
            aria-expanded={showSystemDetails}
            className="inline-flex shrink-0 items-center gap-2 border-l border-white/[0.08] px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8ea3bd] transition-colors hover:text-[#d8e5f3]"
          >
            <span>System details</span>
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", showSystemDetails ? "rotate-180" : undefined)}
            />
          </button>
        ) : null}
      </div>

      {hasSystemDetails && showSystemDetails ? (
        <div
          data-testid="trend-live-strip-details"
          className="grid gap-px border-t border-[#1d2a37] bg-white/[0.06] md:grid-cols-2 xl:grid-cols-4"
        >
          {systemDetails?.map((item) => (
            <div key={item.label} className="bg-[#07101a] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6d8098]">
                {item.label}
              </p>
              <p className={cn("mt-1.5 text-[13px] font-semibold text-[#f3f7fd]", toneClassName(item.tone))}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
