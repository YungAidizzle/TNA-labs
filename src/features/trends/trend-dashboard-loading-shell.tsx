"use client";

import { Search } from "lucide-react";
import { SkeletonBlock } from "@/components/shared/skeleton-block";
import { MemecoinMarketTable } from "@/components/trends/memecoin-market-table";
import { OverviewStatusStrip } from "@/components/trends/overview-status-strip";
import { NarrativeTrendsTable } from "@/components/trends/narrative-trends-table";
import { SelectedCoinPanel } from "@/components/trends/selected-coin-panel";
import { TerminalPanel } from "@/components/trends/terminal-panel";

export const TREND_DASHBOARD_LAYOUT_CLASS_NAME =
  "flex h-full min-h-0 flex-col gap-2 overflow-y-auto pb-2 xl:overflow-hidden xl:pb-0";
export const TREND_DASHBOARD_WORKSPACE_CLASS_NAME =
  "grid min-h-0 min-w-0 gap-2 xl:flex-1 xl:grid-cols-[minmax(280px,0.92fr)_minmax(360px,1.22fr)_minmax(300px,0.96fr)] xl:overflow-hidden 2xl:grid-cols-[minmax(300px,0.95fr)_minmax(420px,1.28fr)_minmax(320px,0.98fr)]";

const noop = () => {};
const CONNECTING_LABEL = "Live data connecting...";

function NarrativePanelActionSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <div className="border border-white/[0.08] bg-white/[0.03] px-2 py-1.5">
        <SkeletonBlock className="h-4 w-8 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
      </div>
      <div
        data-testid="trend-loading-search"
        className="flex h-9 items-center gap-2 border border-white/[0.08] bg-[#060b11] px-2.5"
      >
        <Search className="h-3.5 w-3.5 text-[#69809a]" />
        <SkeletonBlock className="h-4 w-[112px] bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]" />
      </div>
    </div>
  );
}

function MemecoinPanelActionSkeleton() {
  return (
    <div className="flex items-center gap-2 text-[12px] text-[#8da1bb]">
      <div className="border border-white/[0.08] bg-white/[0.03] px-2 py-1.5">
        <SkeletonBlock className="h-4 w-7 bg-gradient-to-r from-white/[0.05] via-white/[0.1] to-white/[0.05]" />
      </div>
      <div className="border border-white/[0.08] bg-white/[0.03] px-2 py-1.5">
        <SkeletonBlock className="h-4 w-[138px] bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]" />
      </div>
    </div>
  );
}

function ValidationPanelActionSkeleton() {
  return (
    <span className="border border-emerald/25 bg-emerald/10 px-2 py-1.5 font-mono text-[12px] text-emerald">
      <SkeletonBlock className="h-4 w-12 bg-gradient-to-r from-emerald/16 via-emerald/24 to-emerald/16" />
    </span>
  );
}

export function TrendStatusStripSkeleton() {
  return <OverviewStatusStrip loading />;
}

export function TrendNarrativesPanelSkeleton() {
  return (
    <div id="signals" className="min-h-[320px] min-w-0 xl:min-h-0 xl:overflow-hidden">
      <TerminalPanel
        title="Narratives"
        subtitle="Attention-ranked source table"
        tone="cyan"
        className="h-full min-h-0 min-w-0"
        bodyClassName="overflow-hidden"
        action={<NarrativePanelActionSkeleton />}
        disclaimer={CONNECTING_LABEL}
      >
        <NarrativeTrendsTable rows={[]} selectedId={null} onSelect={noop} loading />
      </TerminalPanel>
    </div>
  );
}

export function TrendMemecoinsPanelSkeleton() {
  return (
    <div id="memecoins" className="min-h-[320px] min-w-0 xl:min-h-0 xl:overflow-hidden">
      <TerminalPanel
        title="Memecoins"
        subtitle="Market-linked execution table"
        tone="neutral"
        className="h-full min-h-0 min-w-0"
        bodyClassName="overflow-hidden"
        action={<MemecoinPanelActionSkeleton />}
        disclaimer={CONNECTING_LABEL}
      >
        <MemecoinMarketTable
          rows={[]}
          selectedCoinId={null}
          selectedTrendLabel={null}
          mode="momentum"
          onModeChange={noop}
          onSelectCoin={noop}
          loading
        />
      </TerminalPanel>
    </div>
  );
}

export function TrendValidationPanelSkeleton() {
  return (
    <div id="validation" className="min-h-[320px] min-w-0 xl:min-h-0 xl:overflow-hidden">
      <TerminalPanel
        title="Validation"
        subtitle="Selected coin market context"
        tone="emerald"
        className="h-full min-h-0 min-w-0"
        bodyClassName="overflow-hidden"
        action={<ValidationPanelActionSkeleton />}
        disclaimer={CONNECTING_LABEL}
      >
        <SelectedCoinPanel selectedCoin={null} loading />
      </TerminalPanel>
    </div>
  );
}

export function TrendDashboardLoadingShell() {
  return (
    <div data-testid="trend-dashboard-loading-shell" className={TREND_DASHBOARD_LAYOUT_CLASS_NAME}>
      <TrendStatusStripSkeleton />

      <section data-testid="trend-main-workspace" className={TREND_DASHBOARD_WORKSPACE_CLASS_NAME}>
        <TrendNarrativesPanelSkeleton />
        <TrendMemecoinsPanelSkeleton />
        <TrendValidationPanelSkeleton />
      </section>
    </div>
  );
}
