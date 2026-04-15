import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { MemecoinTerminalRow } from "@/components/trends/memecoin-market-table";
import { DashboardLivePreviewSurface } from "@/components/marketing/dashboard-live-preview-surface";
import { fetchLatestCorrelatedMemecoinBoard } from "@/lib/dashboard/correlated-memecoins";
import { resolveDexscreenerUrl } from "@/lib/dashboard/dexscreener-url";
import { getNarrativeCoinOpportunities } from "@/lib/dashboard/memecoin-opportunities";
import { resolveSelectedLiveMemecoinId } from "@/lib/dashboard/memecoin-selection";
import { getTrendDashboardState } from "@/lib/dashboard/service";
import { buildTrendDashboardStatusStripItems } from "@/lib/dashboard/status-strip";
import { attachTrendMemecoinLinks } from "@/lib/dashboard/trend-memecoin-links";
import { buildTradingViewPreviewInput, type TradingViewPreviewResponse } from "@/lib/dashboard/tradingview-preview";
import { resolveCoinPreview } from "@/lib/dashboard/tradingview-preview-resolver";
import { getTrendDisplayNameOrPlaceholder } from "@/lib/dashboard/trend-name-state";
import { BRAND_NAME } from "@/lib/brand";
import type { CorrelatedMemecoinRow, RankedTrend, TrendDashboardQuery, TrendDashboardVM } from "@/types/view-models";

export const metadata: Metadata = {
  title: `${BRAND_NAME} Live Dashboard Preview`,
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

const HERO_CAPTURE_QUERY: TrendDashboardQuery = {
  scope: "overall",
  range: "24h",
  mode: "established",
  sort: "posts",
};

function toCaptureMemecoinRow(row: MemecoinTerminalRow): MemecoinTerminalRow {
  const resolvedDexscreenerUrl = resolveDexscreenerUrl({
    chainId: row.row.chainId,
    pairAddress: row.row.pairAddress,
    tokenAddress: row.row.tokenAddress,
    dexscreenerUrl: row.row.dexscreenerUrl,
  });

  return {
    ...row,
    row: {
      ...row.row,
      dexscreenerUrl: resolvedDexscreenerUrl ?? row.row.dexscreenerUrl,
    },
  };
}

function isSelectableMemecoin(row: MemecoinTerminalRow) {
  return row.row.isLive !== false && row.row.validationStatus !== "invalid";
}

function representativeCoinScore(
  row: MemecoinTerminalRow,
  preview: TradingViewPreviewResponse | null,
  linkedCount: number,
) {
  const liquidityUsd = Number(row.row.liquidityUsd ?? 0);
  const volume24hUsd = Number(row.row.volume24hUsd ?? 0);
  const txns24h = Number(row.row.txns24h ?? 0);
  const supportPostCount = Number(row.activeLink?.supportPostCount ?? 0);
  const previewBonus =
    preview?.status === "dexscreener"
      ? 18
      : preview?.status === "sparkline"
        ? 10
        : preview?.status === "tradingview"
          ? 4
          : -20;
  const liquidityPenalty =
    liquidityUsd < 25_000 ? -120 : liquidityUsd < 100_000 ? -40 : 0;
  const volumePenalty =
    volume24hUsd < 25_000 ? -100 : volume24hUsd < 100_000 ? -35 : 0;
  const supportPenalty = supportPostCount <= 0 ? -55 : supportPostCount === 1 ? -20 : 0;

  return (
    row.confidenceScore * 1.6 +
    Math.log10(Math.max(liquidityUsd, 1)) * 18 +
    Math.log10(Math.max(volume24hUsd, 1)) * 20 +
    Math.log10(Math.max(txns24h, 1)) * 10 +
    Math.min(linkedCount, 8) * 4 +
    previewBonus +
    liquidityPenalty +
    volumePenalty +
    supportPenalty
  );
}

async function chooseCaptureState(
  rows: RankedTrend[],
  correlatedRows: CorrelatedMemecoinRow[],
) {
  let fallback:
    | {
        narrative: RankedTrend;
        memecoinRows: MemecoinTerminalRow[];
        selectedCoin: MemecoinTerminalRow;
        preview: TradingViewPreviewResponse | null;
      }
    | null = null;
  let bestResolved:
    | {
        narrative: RankedTrend;
        memecoinRows: MemecoinTerminalRow[];
        selectedCoin: MemecoinTerminalRow;
        preview: TradingViewPreviewResponse;
        score: number;
      }
    | null = null;

  for (const narrative of rows) {
    const memecoinRows = getNarrativeCoinOpportunities(narrative, correlatedRows)
      .map((opportunity) =>
        toCaptureMemecoinRow({
          row: opportunity.row,
          activeLink: opportunity.activeLink,
          confidenceScore: opportunity.confidenceScore,
          related: true,
        }),
      )
      .filter(isSelectableMemecoin);

    if (memecoinRows.length === 0) {
      continue;
    }

    let bestPreview:
      | {
          row: MemecoinTerminalRow;
          preview: TradingViewPreviewResponse;
          score: number;
        }
      | null = null;

    for (const row of memecoinRows.slice(0, 5)) {
      const preview = await resolveCoinPreview(buildTradingViewPreviewInput(row.row));
      const candidateScore = representativeCoinScore(row, preview, memecoinRows.length);
      if (
        !bestPreview ||
        candidateScore > bestPreview.score
      ) {
        bestPreview = {
          row,
          preview,
          score: candidateScore,
        };
      }
    }

    if (!fallback) {
      fallback = {
        narrative,
        memecoinRows,
        selectedCoin: memecoinRows[0],
        preview: bestPreview?.preview ?? null,
      };
    }

    if (bestPreview && bestPreview.preview.status !== "unavailable") {
      const candidateState = {
        narrative,
        memecoinRows,
        selectedCoin: bestPreview.row,
        preview: bestPreview.preview,
        score: bestPreview.score,
      };

      if (
        !bestResolved ||
        candidateState.score > bestResolved.score
      ) {
        bestResolved = candidateState;
      }

      if (
        bestPreview.preview.status === "dexscreener" &&
        Number(bestPreview.row.row.liquidityUsd ?? 0) >= 50_000 &&
        Number(bestPreview.row.row.volume24hUsd ?? 0) >= 100_000
      ) {
        return candidateState;
      }
    }
  }

  return bestResolved ?? fallback;
}

async function getHeroCaptureDashboardState(): Promise<TrendDashboardVM> {
  const state = await getTrendDashboardState(HERO_CAPTURE_QUERY, {
    readProfile: "summary",
  });

  let correlatedMemecoins = null;
  try {
    correlatedMemecoins = await fetchLatestCorrelatedMemecoinBoard();
  } catch (error) {
    console.error("[dashboard-hero-current] failed to load correlated memecoin board", error);
  }

  const stateWithBoard: TrendDashboardVM = {
    ...state,
    correlatedMemecoins,
  };

  try {
    return await attachTrendMemecoinLinks(stateWithBoard, correlatedMemecoins);
  } catch (error) {
    console.error("[dashboard-hero-current] failed to attach trend memecoin links", error);
    return stateWithBoard;
  }
}

export default async function DashboardHeroCurrentPreviewPage() {
  const previewRoutesEnabled =
    process.env.NODE_ENV !== "production" ||
    process.env.ATTENTRA_ENABLE_PREVIEW_ROUTES?.trim().toLowerCase() === "1" ||
    process.env.ATTENTRA_ENABLE_PREVIEW_ROUTES?.trim().toLowerCase() === "true";

  if (!previewRoutesEnabled) {
    notFound();
  }

  const summaryState = await getHeroCaptureDashboardState();
  const narrativeRows = summaryState.leaderboard ?? [];
  const captureState = await chooseCaptureState(
    narrativeRows,
    summaryState.correlatedMemecoins?.rows ?? [],
  );

  if (!captureState) {
    notFound();
  }

  const selectedCoinId = resolveSelectedLiveMemecoinId(
    captureState.memecoinRows,
    captureState.selectedCoin.row.id,
  );
  const selectedCoin =
    captureState.memecoinRows.find((row) => row.row.id === selectedCoinId) ?? captureState.selectedCoin;

  return (
    <main className="min-h-screen bg-[#03060a] p-8">
      <div className="mx-auto w-fit">
        <DashboardLivePreviewSurface
          statusItems={buildTrendDashboardStatusStripItems(summaryState)}
          narrativeRows={narrativeRows}
          selectedNarrativeId={captureState.narrative.id}
          selectedNarrativeLabel={getTrendDisplayNameOrPlaceholder(captureState.narrative)}
          memecoinRows={captureState.memecoinRows}
          selectedCoinId={selectedCoinId}
          selectedCoin={selectedCoin}
          previewOverride={captureState.preview}
        />
      </div>
    </main>
  );
}
