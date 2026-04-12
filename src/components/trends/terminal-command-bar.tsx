"use client";

import { Search } from "lucide-react";

type TerminalCommandBarProps = {
  search: string;
  onSearchChange: (value: string) => void;
};

export function TerminalCommandBar({
  search,
  onSearchChange,
}: TerminalCommandBarProps) {
  return (
    <div className="rounded-[12px] border border-[#233345] bg-[linear-gradient(180deg,rgba(10,16,24,0.99),rgba(6,10,15,0.995))] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_18px_34px_rgba(0,0,0,0.28)]">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:items-center lg:gap-x-4">
        <div className="min-w-0 lg:pr-2">
          <h1 className="text-[22px] font-semibold leading-[1.05] tracking-[-0.03em] text-[#eef5ff] sm:text-[24px]">
            Narrative Research Terminal
          </h1>
          <p className="mt-1 max-w-2xl text-[12px] leading-[1.45] text-[#9fb1c7]">
            Ranked narrative views, live narrative briefs, and market-linked correlation context in a
            single scanning surface.
          </p>
        </div>

        <label className="flex h-10 w-full min-w-0 items-center gap-2 rounded-[9px] border border-[#27394e] bg-[#050b13] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
          <Search className="h-4 w-4 shrink-0 text-[#6f8299]" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search narratives, aliases, or linked themes..."
            className="w-full bg-transparent text-[13px] text-[#d3dff0] outline-none placeholder:text-[#64788f]"
          />
        </label>
      </div>
    </div>
  );
}
