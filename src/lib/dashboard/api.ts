import { DateRangePreset, TrendScope } from "@/types/domain";
import {
  CorrelatedMemecoinBoard,
  DashboardDataStatus,
  RankedTrend,
  TrendDashboardQuery,
  TrendLeaderboardMode,
  TrendSort,
} from "@/types/view-models";

export type DashboardApiView = "status" | "summary" | "memecoins";

export type DashboardStatusStripTone = "neutral" | "green" | "red" | "amber";

export type DashboardStatusStripItem = {
  label: string;
  value: string;
  tone?: DashboardStatusStripTone;
};

export type TrendDashboardStatusResponse = {
  items: DashboardStatusStripItem[];
  dataStatus: DashboardDataStatus | null;
};

export type TrendDashboardSummaryResponse = {
  query: TrendDashboardQuery;
  leaderboard: RankedTrend[];
  dataStatus: DashboardDataStatus | null;
};

export type TrendDashboardMemecoinsResponse = {
  correlatedMemecoins: CorrelatedMemecoinBoard | null;
  dataStatus: DashboardDataStatus | null;
};

const RANGE_OPTIONS: DateRangePreset[] = ["1h", "6h", "24h", "7d"];
const SCOPE_OPTIONS: TrendScope[] = ["overall", "memes"];
const MODE_OPTIONS: TrendLeaderboardMode[] = ["established", "emerging"];
const SORT_OPTIONS: TrendSort[] = [
  "posts",
  "attention",
  "growth",
  "mentions",
  "strength",
  "breakout",
  "velocity",
  "novelty",
  "confirmation",
];

function isRangePreset(value: string | null): value is DateRangePreset {
  return Boolean(value && RANGE_OPTIONS.includes(value as DateRangePreset));
}

function isScope(value: string | null): value is TrendScope {
  return Boolean(value && SCOPE_OPTIONS.includes(value as TrendScope));
}

function isMode(value: string | null): value is TrendLeaderboardMode {
  return Boolean(value && MODE_OPTIONS.includes(value as TrendLeaderboardMode));
}

function isSort(value: string | null): value is TrendSort {
  return Boolean(value && SORT_OPTIONS.includes(value as TrendSort));
}

export function buildTrendDashboardSearchParams(
  query: TrendDashboardQuery,
  view: DashboardApiView,
) {
  const searchParams = new URLSearchParams({
    view,
    scope: query.scope,
    range: query.range,
    sort: query.sort,
  });

  if (query.mode) {
    searchParams.set("mode", query.mode);
  }
  if (query.selectedId) {
    searchParams.set("selected", query.selectedId);
  }

  return searchParams;
}

export function parseTrendDashboardRequestQuery(searchParams: URLSearchParams): TrendDashboardQuery {
  const scope = isScope(searchParams.get("scope")) ? (searchParams.get("scope") as TrendScope) : "overall";
  const range = isRangePreset(searchParams.get("range"))
    ? (searchParams.get("range") as DateRangePreset)
    : "24h";
  const sort = isSort(searchParams.get("sort")) ? (searchParams.get("sort") as TrendSort) : "posts";
  const mode = isMode(searchParams.get("mode"))
    ? (searchParams.get("mode") as TrendLeaderboardMode)
    : "established";
  const selectedId = searchParams.get("selected")?.trim() || undefined;

  return {
    scope,
    range,
    sort,
    mode,
    selectedId,
  };
}
