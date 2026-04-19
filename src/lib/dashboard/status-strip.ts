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
  const referenceTime =
    dashboard.dataStatus?.serverNow ??
    dashboard.dataStatus?.latestFetchedAt ??
    null;
  const totalEvidence = allRows.reduce((total, row) => total + getTrendPostCount(row), 0);
  const totalSources = allRows.reduce(
    (total, row) => total + Math.max(0, row.sampleSize ?? 0),
    0,
  );
  const newNarrativesCount = allRows.filter((row) =>
    isFreshWithinHours(row.firstSeenAt, referenceTime, 24),
  ).length;
  const averageConfidence =
    allRows.length > 0
      ? Math.round(
          allRows.reduce((total, row) => total + Math.max(0, row.confidenceScore ?? 0), 0) /
            allRows.length,
        )
      : 0;

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
      label: "Evidence rows",
      value: formatCompactNumber(totalEvidence),
      tone: "neutral",
    },
    {
      label: "Source links",
      value: formatCompactNumber(totalSources),
      tone: "green",
    },
    {
      label: "Avg confidence",
      value: `${averageConfidence}%`,
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
