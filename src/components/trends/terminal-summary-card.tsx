"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type TerminalSummaryCardProps = {
  title: string;
  value: string;
  detail: string;
  meta?: string;
  tone?: "cyan" | "emerald" | "amber" | "rose";
  icon?: ReactNode;
};

const TONE_CLASS = {
  cyan: "from-cyan/18 via-cyan/6 text-cyan border-cyan/18",
  emerald: "from-emerald/18 via-emerald/6 text-emerald border-emerald/18",
  amber: "from-amber/18 via-amber/6 text-amber border-amber/18",
  rose: "from-rose/18 via-rose/6 text-rose border-rose/18",
} as const;

export function TerminalSummaryCard({
  title,
  value,
  detail,
  meta,
  tone = "cyan",
  icon,
}: TerminalSummaryCardProps) {
  return (
    <div
      data-testid="trend-summary-card"
      className="relative overflow-hidden rounded-[10px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,15,22,0.98),rgba(6,9,14,0.99))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_18px_30px_rgba(0,0,0,0.22)]"
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b to-transparent",
          TONE_CLASS[tone],
        )}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7d92ad]">
            {title}
          </p>
          <p className="mt-2.5 text-[28px] font-semibold leading-none tracking-[-0.03em] text-[#eef5ff]">
            {value}
          </p>
        </div>
        {icon ? (
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-[9px] border bg-[#050c14]", TONE_CLASS[tone])}>
            {icon}
          </div>
        ) : null}
      </div>
      <div className="relative mt-3 space-y-1">
        <p className="text-[11px] leading-[1.45] text-[#c7d5e8]">{detail}</p>
        {meta ? <p className="text-[11px] text-[#7388a4]">{meta}</p> : null}
      </div>
    </div>
  );
}
