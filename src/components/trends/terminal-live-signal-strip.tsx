"use client";

import { Search } from "lucide-react";
import { BRAND_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils/cn";

type SignalStripItem = {
  label: string;
  value: string;
  tone?: "neutral" | "cyan" | "emerald" | "amber";
};

type TerminalLiveSignalStripProps = {
  search: string;
  onSearchChange: (value: string) => void;
  items: SignalStripItem[];
};

function toneClassName(tone: SignalStripItem["tone"]) {
  if (tone === "cyan") {
    return "text-cyan";
  }
  if (tone === "emerald") {
    return "text-emerald";
  }
  if (tone === "amber") {
    return "text-amber";
  }
  return "text-[#dbe6f5]";
}

export function TerminalLiveSignalStrip({
  search,
  onSearchChange,
  items,
}: TerminalLiveSignalStripProps) {
  return (
    <section
      id="overview"
      data-testid="trend-live-strip"
      className="shrink-0 rounded-[10px] border border-[#22303f] bg-[linear-gradient(180deg,rgba(9,13,19,0.985),rgba(5,8,12,0.995))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
    >
      <div className="grid gap-2.5 px-3 py-2.5 xl:grid-cols-[200px_minmax(0,1fr)_280px] xl:items-center xl:gap-3">
        <div className="min-w-0 xl:max-w-[200px]">
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#667d98]">
            {BRAND_NAME} execution monitor
          </p>
          <p className="mt-0.5 truncate text-[16px] font-semibold tracking-[-0.03em] text-[#f2f6fd]">
            Memecoin Conversion Desk
          </p>
        </div>

        <div className="min-w-0 overflow-x-auto">
          <div className="flex min-w-max items-center gap-1">
            {items.map((item, index) => (
              <div
                key={item.label}
                data-testid="trend-live-strip-item"
                className={cn(
                  "flex items-baseline gap-2 px-2.5 py-1",
                  index > 0 ? "border-l border-white/[0.08] pl-3" : "pl-0",
                )}
              >
                <span className="text-[9px] uppercase tracking-[0.16em] text-[#6d839d]">
                  {item.label}
                </span>
                <span className={cn("text-[13px] font-semibold tracking-[-0.02em]", toneClassName(item.tone))}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        <label className="flex h-9 w-full min-w-0 items-center gap-2 rounded-[8px] border border-[#243445] bg-[#060b11] px-3 xl:max-w-[280px]">
          <Search className="h-3.5 w-3.5 shrink-0 text-[#6d8098]" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Filter narratives"
            className="w-full bg-transparent text-[12px] text-[#d8e2ef] outline-none placeholder:text-[#5f728b]"
          />
        </label>
      </div>
    </section>
  );
}
