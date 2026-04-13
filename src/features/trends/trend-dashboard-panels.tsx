"use client";

import { Search } from "lucide-react";
import { NarrativeTrendsTable } from "@/components/trends/narrative-trends-table";
import { MemecoinMarketTable, type MemecoinTerminalRow } from "@/components/trends/memecoin-market-table";
import { SelectedCoinPanel } from "@/components/trends/selected-coin-panel";
import { TerminalPanel } from "@/components/trends/terminal-panel";
import { cn } from "@/lib/utils/cn";
import type { RankedTrend } from "@/types/view-models";

type TrendNarrativesPanelProps = {
  rows: RankedTrend[];
  selectedId: string | null;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  onSelect: (id: string) => void;
  loading?: boolean;
  connecting?: boolean;
};

type TrendMemecoinsPanelProps = {
  rows: MemecoinTerminalRow[];
  selectedCoinId: string | null;
  selectedTrendLabel: string | null;
  mode: "trend" | "all" | "momentum";
  onModeChange: (mode: "trend" | "all" | "momentum") => void;
  onSelectCoin: (id: string) => void;
  loading?: boolean;
  connecting?: boolean;
};

type TrendValidationPanelProps = {
  selectedCoin: MemecoinTerminalRow | null;
  loading?: boolean;
  connecting?: boolean;
};

export function TrendNarrativesPanel({
  rows,
  selectedId,
  searchTerm,
  onSearchTermChange,
  onSelect,
  loading = false,
  connecting = false,
}: TrendNarrativesPanelProps) {
  return (
    <div id="signals" className="min-h-[320px] min-w-0 xl:min-h-0 xl:overflow-hidden">
      <TerminalPanel
        title="Narratives"
        subtitle="Attention-ranked source table"
        tone="cyan"
        className="h-full min-h-0 min-w-0"
        bodyClassName="overflow-hidden"
        action={(
          <div className="flex items-center gap-2">
            <span className="border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 font-mono text-[12px] text-[#a8b9cd]">
              {rows.length}
            </span>
            <label className="flex h-9 items-center gap-2 border border-white/[0.08] bg-[#060b11] px-2.5">
              <Search className="h-3.5 w-3.5 text-[#69809a]" />
              <input
                value={searchTerm}
                onChange={(event) => onSearchTermChange(event.target.value)}
                placeholder="Search narratives"
                className="w-[160px] bg-transparent text-[13px] text-[#d6e0ed] outline-none placeholder:text-[#5d738c]"
              />
            </label>
          </div>
        )}
        disclaimer={connecting ? "Live data connecting..." : undefined}
      >
        <NarrativeTrendsTable rows={rows} selectedId={selectedId} onSelect={onSelect} loading={loading} />
      </TerminalPanel>
    </div>
  );
}

export function TrendMemecoinsPanel({
  rows,
  selectedCoinId,
  selectedTrendLabel,
  mode,
  onModeChange,
  onSelectCoin,
  loading = false,
  connecting = false,
}: TrendMemecoinsPanelProps) {
  return (
    <div id="memecoins" className="min-h-[320px] min-w-0 xl:min-h-0 xl:overflow-hidden">
      <TerminalPanel
        title="Memecoins"
        subtitle="Market-linked execution table"
        tone="neutral"
        className="h-full min-h-0 min-w-0"
        bodyClassName="overflow-hidden"
        action={(
          <div className="flex items-center gap-2 text-[12px] text-[#8da1bb]">
            <span className="border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 font-mono">
              {rows.length}
            </span>
            {selectedTrendLabel ? (
              <span className="max-w-[190px] truncate border border-white/[0.08] bg-white/[0.03] px-2 py-1.5">
                {selectedTrendLabel}
              </span>
            ) : null}
          </div>
        )}
        disclaimer={connecting ? "Live data connecting..." : undefined}
      >
        <MemecoinMarketTable
          rows={rows}
          selectedCoinId={selectedCoinId}
          selectedTrendLabel={selectedTrendLabel}
          mode={mode}
          onModeChange={onModeChange}
          onSelectCoin={onSelectCoin}
          loading={loading}
        />
      </TerminalPanel>
    </div>
  );
}

export function TrendValidationPanel({
  selectedCoin,
  loading = false,
  connecting = false,
}: TrendValidationPanelProps) {
  return (
    <div id="validation" className="min-h-[320px] min-w-0 xl:min-h-0 xl:overflow-hidden">
      <TerminalPanel
        title="Validation"
        subtitle={selectedCoin ? "Selected coin market context" : "Select a coin to validate"}
        tone="emerald"
        className="h-full min-h-0 min-w-0"
        bodyClassName="overflow-hidden"
        action={selectedCoin ? (
          <span
            className={cn(
              "border px-2 py-1.5 font-mono text-[12px]",
              selectedCoin.related
                ? "border-emerald/25 bg-emerald/10 text-emerald"
                : "border-white/[0.08] bg-white/[0.03] text-[#a8b9cd]",
            )}
          >
            {selectedCoin.row.symbol}
          </span>
        ) : null}
        disclaimer={connecting ? "Live data connecting..." : undefined}
      >
        <SelectedCoinPanel selectedCoin={selectedCoin} loading={loading} />
      </TerminalPanel>
    </div>
  );
}
