import { getNewMemecoinCount } from "@/lib/dashboard/memecoin-opportunities";
import { formatCompactNumber, formatRelativeTimeShort } from "@/lib/formatters";
import { getTrendPostCount } from "@/lib/utils/trend-ranking";
import type { DashboardStatusStripItem } from "@/lib/dashboard/api";
import type { TrendDashboardVM } from "@/types/view-models";

function isFreshWithinHours(
  value: string | null | undefined,
  referenceTime: string | null | undefined,
  hours: number,
) {
  const timestamp = Date.parse(value ?? "");
  const referenceTimestamp = Date.parse(referenceTime ?? "");
  if (!Number.isFinite(timestamp) || !Number.isFinite(referenceTimestamp)) {
    return false;
  }

  return referenceTimestamp - timestamp <= hours * 3_600_000;
}

export function buildTrendDashboardStatusStripItems(
  dashboard: TrendDashboardVM,
): DashboardStatusStripItem[] {
  const allRows = dashboard.leaderboard ?? [];
  const correlatedMemecoinRows = dashboard.correlatedMemecoins?.rows ?? [];
  const prelinkedCoins = allRows.flatMap((row) => row.linkedCoins ?? []);
  const linkedMemecoinCount = prelinkedCoins.length > 0 ? prelinkedCoins.length : correlatedMemecoinRows.length;
  const referenceTime =
    dashboard.dataStatus?.serverNow ??
    dashboard.dataStatus?.latestFetchedAt ??
    dashboard.correlatedMemecoins?.updatedAt ??
    null;
  const totalPosts = allRows.reduce((total, row) => total + getTrendPostCount(row), 0);
  const postsPerMinute =
    typeof dashboard.blueskyOverview?.postsPerMinute === "number" &&
    Number.isFinite(dashboard.blueskyOverview.postsPerMinute)
      ? dashboard.blueskyOverview.postsPerMinute
      : totalPosts / 1_440;
  const newNarrativesCount = allRows.filter((row) =>
    isFreshWithinHours(row.firstSeenAt, referenceTime, 24),
  ).length;

  return [
    {
      label: "Active narratives",
      value: formatCompactNumber(allRows.length),
      tone: "neutral",
    },
    {
      label: "New narratives",
      value: formatCompactNumber(newNarrativesCount),
      tone: "amber",
    },
    {
      label: "Posts/min",
      value: postsPerMinute >= 10 ? postsPerMinute.toFixed(0) : postsPerMinute.toFixed(1),
      tone: "neutral",
    },
    {
      label: "Linked memecoins",
      value: formatCompactNumber(linkedMemecoinCount),
      tone: "green",
    },
    {
      label: "New coins <24h",
      value: formatCompactNumber(
        prelinkedCoins.length > 0
          ? prelinkedCoins.filter(
              (coin) => typeof coin.age === "number" && Number.isFinite(coin.age) && coin.age < 24,
            ).length
          : getNewMemecoinCount(correlatedMemecoinRows),
      ),
      tone: "amber",
    },
    {
      label: "Last refresh",
      value: formatRelativeTimeShort(
        dashboard.dataStatus?.sourceSnapshotGeneratedAt ??
          dashboard.dataStatus?.latestFetchedAt ??
          dashboard.correlatedMemecoins?.updatedAt,
        referenceTime ?? undefined,
      ),
      tone: "neutral",
    },
  ];
}
