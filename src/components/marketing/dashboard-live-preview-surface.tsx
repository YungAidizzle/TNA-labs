"use client";

import { TerminalSidebar } from "@/components/layout/terminal-sidebar";
import { OverviewStatusStrip } from "@/components/trends/overview-status-strip";
import { TrendMemecoinsPanel, TrendNarrativesPanel, TrendValidationPanel } from "@/features/trends/trend-dashboard-panels";
import {
  TREND_DASHBOARD_LAYOUT_CLASS_NAME,
  TREND_DASHBOARD_WORKSPACE_CLASS_NAME,
} from "@/features/trends/trend-dashboard-loading-shell";
import type { DashboardStatusStripItem } from "@/lib/dashboard/api";
import type { TradingViewPreviewResponse } from "@/lib/dashboard/tradingview-preview";
import type { RankedTrend } from "@/types/view-models";
import type { MemecoinTerminalRow } from "@/components/trends/memecoin-market-table";

type DashboardLivePreviewSurfaceProps = {
  statusItems: DashboardStatusStripItem[];
  statusSystemDetails?: DashboardStatusStripItem[] | null;
  narrativeRows: RankedTrend[];
  selectedNarrativeId: string | null;
  selectedNarrativeLabel: string | null;
  memecoinRows: MemecoinTerminalRow[];
  selectedCoinId: string | null;
  selectedCoin: MemecoinTerminalRow | null;
  previewOverride?: TradingViewPreviewResponse | null;
};

const noop = () => {};

export function DashboardLivePreviewSurface({
  statusItems,
  statusSystemDetails = null,
  narrativeRows,
  selectedNarrativeId,
  selectedNarrativeLabel,
  memecoinRows,
  selectedCoinId,
  selectedCoin,
  previewOverride = null,
}: DashboardLivePreviewSurfaceProps) {
  return (
    <div
      data-testid="dashboard-preview-capture"
      className="flex h-[1080px] w-[2140px] overflow-hidden border border-white/[0.08] bg-[radial-gradient(circle_at_top_left,rgba(86,217,255,0.06),transparent_18%),linear-gradient(180deg,rgba(8,12,18,0.995),rgba(4,7,11,0.998))] text-foreground shadow-[0_40px_120px_rgba(0,0,0,0.5)]"
    >
      <TerminalSidebar pathname="/trends" onOpenCommandPalette={noop} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="min-h-0 flex-1 overflow-hidden p-3">
          <div className={TREND_DASHBOARD_LAYOUT_CLASS_NAME}>
            <OverviewStatusStrip items={statusItems} systemDetails={statusSystemDetails} />

            <section className={TREND_DASHBOARD_WORKSPACE_CLASS_NAME}>
              <TrendNarrativesPanel
                rows={narrativeRows}
                selectedId={selectedNarrativeId}
                searchTerm=""
                onSearchTermChange={noop}
                onSelect={noop}
              />

              <TrendMemecoinsPanel
                rows={memecoinRows}
                selectedCoinId={selectedCoinId}
                selectedTrendLabel={selectedNarrativeLabel}
                mode="trend"
                onModeChange={noop}
                onSelectCoin={noop}
              />

              <TrendValidationPanel
                selectedCoin={selectedCoin}
                previewOverride={previewOverride}
              />
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
