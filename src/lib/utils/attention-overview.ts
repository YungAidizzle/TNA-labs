import { TrendDashboardVM } from "@/types/view-models";

type OverviewSeries = TrendDashboardVM["overviewSeries"];
const ALL_TRENDS_SERIES_ID = "all-trends-aggregate";

export function selectAttentionOverviewSeries(params: {
  overviewSeries: OverviewSeries | null | undefined;
  blueskyOverview: TrendDashboardVM["blueskyOverview"] | null | undefined;
}): OverviewSeries {
  const trendSeries = (params.overviewSeries ?? []).filter(
    (series) => series.id !== ALL_TRENDS_SERIES_ID,
  );
  if (trendSeries.length > 0) {
    return trendSeries;
  }

  const replay = params.blueskyOverview?.replay ?? [];
  if (replay.length === 0) {
    return [];
  }

  return [
    {
      id: "bluesky-live-replay",
      name: "Raw Jetstream events",
      selected: true,
      color: "#5ee7ff",
      points: replay,
      window: params.blueskyOverview?.replayWindow ?? null,
    },
  ];
}
