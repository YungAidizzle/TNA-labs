import {
  buildSurfacedMemecoinUniverse,
  getMemecoinConfidenceScore,
  getNarrativeCoinOpportunities,
  getNarrativeLinkForCoin,
  getNarrativeTopicKey,
  getPrimaryNarrativeLink,
} from "@/lib/dashboard/memecoin-opportunities";
import type {
  CorrelatedMemecoinLink,
  CorrelatedMemecoinRow,
  RankedTrend,
} from "@/types/view-models";

export type TrendsPageMemecoinRow = {
  row: CorrelatedMemecoinRow;
  activeLink: CorrelatedMemecoinLink | null;
  confidenceScore: number;
  related: boolean;
};

type TrendsPageMemecoinSelectorInput = {
  selectedTrend: RankedTrend | null;
  trends: RankedTrend[];
  correlatedRows: CorrelatedMemecoinRow[];
  marketRows: CorrelatedMemecoinRow[];
};

type TrendsPageMemecoinDatasets = {
  trendRows: TrendsPageMemecoinRow[];
  allRows: TrendsPageMemecoinRow[];
  momentumRows: TrendsPageMemecoinRow[];
};

function normalizeLower(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeUrl(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesStoredLinkedCoin(
  row: CorrelatedMemecoinRow,
  narrativeId: string | null | undefined,
  coin: {
    address: string;
    pairAddress?: string | null;
    dexscreenerUrl?: string | null;
    chainId?: string | null;
    symbol: string;
  },
) {
  const normalizedChain = normalizeLower(coin.chainId);
  const rowChain = normalizeLower(row.chainId);
  if (normalizedChain && rowChain && normalizedChain !== rowChain) {
    return false;
  }

  const normalizedAddress = normalizeLower(coin.address);
  if (normalizedAddress && normalizedAddress === normalizeLower(row.tokenAddress)) {
    return true;
  }

  const normalizedPair = normalizeLower(coin.pairAddress);
  if (normalizedPair && normalizedPair === normalizeLower(row.pairAddress)) {
    return true;
  }

  const normalizedDexUrl = normalizeUrl(coin.dexscreenerUrl);
  if (normalizedDexUrl && normalizedDexUrl === normalizeUrl(row.dexscreenerUrl)) {
    return true;
  }

  return (
    normalizeLower(coin.symbol) === normalizeLower(row.symbol) &&
    (!narrativeId || (row.links ?? []).some((link) => link.topicKey === narrativeId))
  );
}

function filterMarketRowsForStoredLinkedCoins(
  trends: RankedTrend[],
  marketRows: CorrelatedMemecoinRow[],
) {
  return marketRows.filter((row) =>
    trends.some((trend) => {
      const narrativeId = getNarrativeTopicKey(trend);
      return (trend.linkedCoins ?? []).some((coin) => matchesStoredLinkedCoin(row, narrativeId, coin));
    }),
  );
}

function compareLinksByStrength(left: CorrelatedMemecoinLink, right: CorrelatedMemecoinLink) {
  if (left.isPrimary !== right.isPrimary) {
    return left.isPrimary ? -1 : 1;
  }

  if (right.linkScore !== left.linkScore) {
    return right.linkScore - left.linkScore;
  }

  if (right.supportPostCount !== left.supportPostCount) {
    return right.supportPostCount - left.supportPostCount;
  }

  return right.supportInteractionScore - left.supportInteractionScore;
}

function sortAllMemecoinRows(left: TrendsPageMemecoinRow, right: TrendsPageMemecoinRow) {
  if (left.related !== right.related) {
    return left.related ? -1 : 1;
  }

  if (right.confidenceScore !== left.confidenceScore) {
    return right.confidenceScore - left.confidenceScore;
  }

  const volumeDelta = Number(right.row.volume24hUsd ?? 0) - Number(left.row.volume24hUsd ?? 0);
  if (volumeDelta !== 0) {
    return volumeDelta;
  }

  const liquidityDelta = Number(right.row.liquidityUsd ?? 0) - Number(left.row.liquidityUsd ?? 0);
  if (liquidityDelta !== 0) {
    return liquidityDelta;
  }

  return left.row.rank - right.row.rank;
}

function sortMomentumMemecoinRows(left: TrendsPageMemecoinRow, right: TrendsPageMemecoinRow) {
  const momentumRankDelta =
    Number(left.row.momentumRank ?? Number.MAX_SAFE_INTEGER) -
    Number(right.row.momentumRank ?? Number.MAX_SAFE_INTEGER);
  if (momentumRankDelta !== 0) {
    return momentumRankDelta;
  }

  const momentumScoreDelta =
    Number(right.row.momentumScore ?? 0) - Number(left.row.momentumScore ?? 0);
  if (momentumScoreDelta !== 0) {
    return momentumScoreDelta;
  }

  const recentVolumeDelta = Number(right.row.volume1hUsd ?? 0) - Number(left.row.volume1hUsd ?? 0);
  if (recentVolumeDelta !== 0) {
    return recentVolumeDelta;
  }

  const recentTxnDelta = Number(right.row.txns1h ?? 0) - Number(left.row.txns1h ?? 0);
  if (recentTxnDelta !== 0) {
    return recentTxnDelta;
  }

  return sortAllMemecoinRows(left, right);
}

function getActiveTrendKeys(trends: RankedTrend[]) {
  return new Set(trends.map((trend) => getNarrativeTopicKey(trend)).filter(Boolean));
}

function getBestActiveLink(
  row: CorrelatedMemecoinRow,
  activeTrendKeys: Set<string>,
) {
  const activeLinks = (row.links ?? [])
    .filter((link) => activeTrendKeys.has(link.topicKey))
    .sort(compareLinksByStrength);

  return activeLinks[0] ?? null;
}

function getStableMarketLink(
  row: CorrelatedMemecoinRow,
  activeTrendKeys: Set<string>,
) {
  return (
    getBestActiveLink(row, activeTrendKeys) ??
    getNarrativeLinkForCoin(row, row.strongestTrendKey) ??
    getPrimaryNarrativeLink(row)
  );
}

export function buildTrendsPageMemecoinDatasets({
  selectedTrend,
  trends,
  correlatedRows,
  marketRows,
}: TrendsPageMemecoinSelectorInput): TrendsPageMemecoinDatasets {
  void correlatedRows;
  const activeTrendKeys = getActiveTrendKeys(trends);
  const storedTrendScope = selectedTrend ? [selectedTrend] : [];
  const storedTrendMarketRows = filterMarketRowsForStoredLinkedCoins(storedTrendScope, marketRows);
  const storedAllMarketRows = filterMarketRowsForStoredLinkedCoins(trends, marketRows);

  const trendRows = getNarrativeCoinOpportunities(selectedTrend, storedTrendMarketRows).map((item) => ({
    row: item.row,
    activeLink: item.activeLink,
    confidenceScore: item.confidenceScore,
    related: true,
  }));

  const allRows = buildSurfacedMemecoinUniverse(trends, storedAllMarketRows)
    .flatMap((row) => {
      const activeLink = getBestActiveLink(row, activeTrendKeys);
      if (!activeLink) {
        return [];
      }

      return [
        {
          row,
          activeLink,
          confidenceScore: getMemecoinConfidenceScore(row, activeLink.topicKey),
          related: true,
        } satisfies TrendsPageMemecoinRow,
      ];
    })
    .sort(sortAllMemecoinRows);

  const momentumRows = marketRows
    .map((row) => {
      const activeLink = getStableMarketLink(row, activeTrendKeys);

      return {
        row,
        activeLink,
        confidenceScore: getMemecoinConfidenceScore(row, activeLink?.topicKey),
        related: Boolean(activeLink && activeTrendKeys.has(activeLink.topicKey)),
      } satisfies TrendsPageMemecoinRow;
    })
    .sort(sortMomentumMemecoinRows);

  return {
    trendRows,
    allRows,
    momentumRows,
  };
}
