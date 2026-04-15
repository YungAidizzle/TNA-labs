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
  const activeTrendKeys = getActiveTrendKeys(trends);

  const trendRows = getNarrativeCoinOpportunities(selectedTrend, correlatedRows).map((item) => ({
    row: item.row,
    activeLink: item.activeLink,
    confidenceScore: item.confidenceScore,
    related: true,
  }));

  const allRows = buildSurfacedMemecoinUniverse(trends, correlatedRows)
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
