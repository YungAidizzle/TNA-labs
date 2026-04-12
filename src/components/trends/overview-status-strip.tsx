"use client";

import { SkeletonBlock } from "@/components/shared/skeleton-block";
import { cn } from "@/lib/utils/cn";

type StatusStripItem = {
  label: string;
  value: string;
  tone?: "neutral" | "green" | "red" | "amber";
};

type OverviewStatusStripProps = {
  items?: StatusStripItem[];
  loading?: boolean;
};

const LOADING_ITEMS: Array<StatusStripItem & { valueWidth: string }> = [
  { label: "Active narratives", tone: "neutral", value: "", valueWidth: "w-10" },
  { label: "New narratives", tone: "amber", value: "", valueWidth: "w-8" },
  { label: "Posts/min", tone: "neutral", value: "", valueWidth: "w-12" },
  { label: "Linked memecoins", tone: "green", value: "", valueWidth: "w-11" },
  { label: "New coins <24h", tone: "amber", value: "", valueWidth: "w-10" },
  { label: "Last refresh", tone: "neutral", value: "", valueWidth: "w-14" },
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
  loading = false,
}: OverviewStatusStripProps) {
  const renderedItems: Array<StatusStripItem & { valueWidth?: string }> = loading ? LOADING_ITEMS : items;

  return (
    <section
      id="overview"
      data-testid="trend-live-strip"
      className="shrink-0 border border-[#1d2a37] bg-[linear-gradient(180deg,rgba(8,12,18,0.995),rgba(5,8,12,0.995))]"
    >
      <div className="flex min-h-[48px] overflow-x-auto">
        {renderedItems.map((item, index) => (
          <div
            key={item.label}
            data-testid="trend-live-strip-item"
            className={cn(
              "flex min-w-[156px] flex-1 items-center gap-3 px-4 py-3",
              index > 0 ? "border-l border-white/[0.08]" : undefined,
            )}
          >
            <span className="text-[12px] font-medium text-[#6d8098]">
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
              <span className={cn("ml-auto text-[18px] font-semibold tracking-[-0.03em]", toneClassName(item.tone))}>
                {item.value}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
