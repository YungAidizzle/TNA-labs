import { CorrelatedMemecoinRow } from "@/types/view-models";

export type CorrelatedMemecoinSortKey =
  | "correlationScore"
  | "liquidityUsd"
  | "volume24hUsd"
  | "priceChange24hPct";

export type CorrelatedMemecoinSortDirection = "desc" | "asc";

export type CorrelatedMemecoinSortState = {
  key: CorrelatedMemecoinSortKey;
  direction: CorrelatedMemecoinSortDirection;
};

export const DEFAULT_CORRELATED_MEMECOIN_SORT: CorrelatedMemecoinSortState = {
  key: "correlationScore",
  direction: "desc",
};

const SORT_VALUE_GETTERS: Record<
  CorrelatedMemecoinSortKey,
  (row: CorrelatedMemecoinRow) => number | null | undefined
> = {
  correlationScore: (row) => row.correlationScore,
  liquidityUsd: (row) => row.liquidityUsd,
  volume24hUsd: (row) => row.volume24hUsd,
  priceChange24hPct: (row) => row.priceChange24hPct,
};

function normalizeSortValue(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function compareValues(
  leftValue: number | null | undefined,
  rightValue: number | null | undefined,
  direction: CorrelatedMemecoinSortDirection,
) {
  const left = normalizeSortValue(leftValue);
  const right = normalizeSortValue(rightValue);

  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return direction === "desc" ? right - left : left - right;
}

export function sortCorrelatedMemecoinRows(
  rows: CorrelatedMemecoinRow[],
  sortState: CorrelatedMemecoinSortState = DEFAULT_CORRELATED_MEMECOIN_SORT,
) {
  const getSortValue = SORT_VALUE_GETTERS[sortState.key];

  return rows
    .map((row, index) => ({
      row,
      index,
    }))
    .sort((left, right) => {
      const metricComparison = compareValues(
        getSortValue(left.row),
        getSortValue(right.row),
        sortState.direction,
      );

      if (metricComparison !== 0) {
        return metricComparison;
      }

      return left.index - right.index;
    })
    .map(({ row }) => row);
}
