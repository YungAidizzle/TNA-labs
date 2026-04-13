"use client";

import { Search } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
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
  errorMessage?: string | null;
  staleMessage?: string | null;
  onRetry?: () => void;
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
  errorMessage?: string | null;
  staleMessage?: string | null;
  onRetry?: () => void;
};

type TrendValidationPanelProps = {
  selectedCoin: MemecoinTerminalRow | null;
  loading?: boolean;
  connecting?: boolean;
  errorMessage?: string | null;
  staleMessage?: string | null;
  onRetry?: () => void;
};

function PanelMessage({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-4 px-6 text-center">
      <EmptyState title={title} detail={detail} className="w-full max-w-[420px]" />
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="inline-flex h-10 items-center border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function TrendNarrativesPanel({
  rows,
  selectedId,
  searchTerm,
  onSearchTermChange,
  onSelect,
  loading = false,
  connecting = false,
  errorMessage = null,
  staleMessage = null,
  onRetry,
}: TrendNarrativesPanelProps) {
  const hasRows = rows.length > 0;

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
        disclaimer={
          errorMessage && hasRows
            ? staleMessage ?? "Showing last synced narratives while live refresh reconnects."
            : connecting
              ? staleMessage ?? "Refreshing live narratives..."
              : staleMessage ?? undefined
        }
      >
        {errorMessage && !hasRows && !loading ? (
          <PanelMessage
            title="Narratives unavailable"
            detail={errorMessage}
            actionLabel={onRetry ? "Retry" : undefined}
            onAction={onRetry}
          />
        ) : !loading && !errorMessage && !hasRows ? (
          <PanelMessage
            title={searchTerm.trim() ? "No matching narratives" : "No narratives available"}
            detail={
              searchTerm.trim()
                ? "Adjust the search term to broaden the narrative list."
                : "No ranked narratives are available for the selected range yet."
            }
          />
        ) : (
          <NarrativeTrendsTable rows={rows} selectedId={selectedId} onSelect={onSelect} loading={loading} />
        )}
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
  errorMessage = null,
  staleMessage = null,
  onRetry,
}: TrendMemecoinsPanelProps) {
  const hasRows = rows.length > 0;

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
        disclaimer={
          errorMessage && hasRows
            ? staleMessage ?? "Showing last synced market rows while refresh reconnects."
            : connecting
              ? staleMessage ?? "Refreshing market rows..."
              : staleMessage ?? undefined
        }
      >
        {errorMessage && !hasRows && !loading ? (
          <PanelMessage
            title="Memecoins unavailable"
            detail={errorMessage}
            actionLabel={onRetry ? "Retry" : undefined}
            onAction={onRetry}
          />
        ) : !loading && !errorMessage && !hasRows ? (
          <PanelMessage
            title="No linked markets available"
            detail="No market rows are available for the current narrative and filter combination."
          />
        ) : (
          <MemecoinMarketTable
            rows={rows}
            selectedCoinId={selectedCoinId}
            selectedTrendLabel={selectedTrendLabel}
            mode={mode}
            onModeChange={onModeChange}
            onSelectCoin={onSelectCoin}
            loading={loading}
          />
        )}
      </TerminalPanel>
    </div>
  );
}

export function TrendValidationPanel({
  selectedCoin,
  loading = false,
  connecting = false,
  errorMessage = null,
  staleMessage = null,
  onRetry,
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
        disclaimer={
          errorMessage && selectedCoin
            ? staleMessage ?? "Showing last synced validation context while refresh reconnects."
            : connecting
              ? staleMessage ?? "Refreshing validation context..."
              : staleMessage ?? undefined
        }
      >
        {errorMessage && !selectedCoin && !loading ? (
          <PanelMessage
            title="Validation unavailable"
            detail={errorMessage}
            actionLabel={onRetry ? "Retry" : undefined}
            onAction={onRetry}
          />
        ) : (
          <SelectedCoinPanel selectedCoin={selectedCoin} loading={loading} />
        )}
      </TerminalPanel>
    </div>
  );
}
