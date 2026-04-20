import { formatCompactNumber, formatRelativeTimeShort } from "@/lib/formatters";
import {
  formatAiNativeNarrativeRuntimeLabel,
  formatAiNativeNarrativeTriggerLabel,
} from "@/lib/ai-native-narratives/scheduler";
import { getTrendPostCount } from "@/lib/utils/trend-ranking";
import type { DashboardStatusStripItem } from "@/lib/dashboard/api";
import { isDashboardStaleFallback } from "@/lib/dashboard/data-status";
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

function formatRunStatusLabel(status: string | null | undefined) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized) {
    return "Idle";
  }
  if (normalized === "failed") {
    return "Failed";
  }
  if (normalized === "succeeded") {
    return "Succeeded";
  }

  return normalized.slice(0, 1).toUpperCase() + normalized.slice(1);
}

function getRunStatusTone(status: string | null | undefined): DashboardStatusStripItem["tone"] {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "failed") {
    return "red";
  }
  if (normalized === "succeeded") {
    return "green";
  }

  return "neutral";
}

function resolveDashboardHealth(
  dashboard: TrendDashboardVM,
  staleFallback: boolean,
): { value: string; tone: DashboardStatusStripItem["tone"] } {
  const refreshStatus = String(dashboard.dataStatus?.refresh?.status ?? "").trim().toLowerCase();
  const latestRunStatus = String(
    dashboard.dataStatus?.freshnessDiagnostics?.latestRunStatus ??
      dashboard.dataStatus?.freshnessDiagnostics?.workerRunStatus ??
      "",
  )
    .trim()
    .toLowerCase();
  const pipelineHealthState = String(
    dashboard.dataStatus?.freshnessDiagnostics?.pipelineHealthState ?? "",
  )
    .trim()
    .toLowerCase();

  if (refreshStatus === "running" || latestRunStatus === "running") {
    return {
      value: "Updating",
      tone: "amber",
    };
  }

  if (staleFallback || pipelineHealthState === "stale" || pipelineHealthState === "disconnected") {
    return {
      value: "Stale",
      tone: latestRunStatus === "failed" || pipelineHealthState === "disconnected" ? "red" : "amber",
    };
  }

  if (pipelineHealthState === "delayed" || pipelineHealthState === "degraded") {
    return {
      value: "Delayed",
      tone: "amber",
    };
  }

  return {
    value: "Live",
    tone: "green",
  };
}

export function buildTrendDashboardStatusStripItems(
  dashboard: TrendDashboardVM,
): DashboardStatusStripItem[] {
  const allRows = dashboard.leaderboard ?? [];
  const referenceTime =
    dashboard.dataStatus?.serverNow ??
    dashboard.dataStatus?.latestFetchedAt ??
    null;
  const averageConfidence =
    allRows.length > 0
      ? Math.round(
          allRows.reduce((total, row) => total + Math.max(0, row.confidenceScore ?? 0), 0) /
            allRows.length,
        )
      : 0;
  const staleFallback = isDashboardStaleFallback(dashboard.dataStatus, {
    hasRenderableData: allRows.length > 0,
  });
  const diagnostics = dashboard.dataStatus?.freshnessDiagnostics ?? null;
  const lastUpdateAt =
    diagnostics?.latestSuccessfulRunAt ??
    dashboard.dataStatus?.sourceSnapshotGeneratedAt ??
    dashboard.dataStatus?.latestFetchedAt ??
    dashboard.correlatedMemecoins?.updatedAt ??
    null;
  const health = resolveDashboardHealth(dashboard, staleFallback);

  return [
    {
      label: "Active narratives",
      value: formatCompactNumber(allRows.length),
      tone: "neutral",
    },
    {
      label: "Avg confidence",
      value: `${averageConfidence}%`,
      tone: "neutral",
    },
    {
      label: "Last update",
      value: formatRelativeTimeShort(
        lastUpdateAt,
        referenceTime ?? undefined,
      ),
      tone: staleFallback ? "amber" : "neutral",
    },
    {
      label: "Status",
      value: health.value,
      tone: health.tone,
    },
  ];
}

export function buildTrendDashboardStatusStripSystemDetails(
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
  const diagnostics = dashboard.dataStatus?.freshnessDiagnostics ?? null;
  const runStatus =
    diagnostics?.latestRunStatus ??
    diagnostics?.workerRunStatus ??
    null;
  const lastAttemptAt =
    diagnostics?.latestRunAt ??
    diagnostics?.workerRunStartedAt ??
    dashboard.dataStatus?.latestFetchedAt ??
    null;

  return [
    {
      label: "Source links",
      value: formatCompactNumber(totalSources),
      tone: "neutral",
    },
    {
      label: "Evidence rows",
      value: formatCompactNumber(totalEvidence),
      tone: "neutral",
    },
    {
      label: "New narratives",
      value: formatCompactNumber(newNarrativesCount),
      tone: "amber",
    },
    {
      label: "Last attempt",
      value: formatRelativeTimeShort(lastAttemptAt, referenceTime ?? undefined),
      tone: runStatus === "failed" ? "red" : "neutral",
    },
    {
      label: "Run state",
      value: formatRunStatusLabel(runStatus),
      tone: getRunStatusTone(runStatus),
    },
    {
      label: "Trigger",
      value: formatAiNativeNarrativeTriggerLabel(diagnostics?.latestRunTrigger),
      tone: "neutral",
    },
    {
      label: "Scheduler",
      value: diagnostics?.schedulerLabel ?? "Unknown",
      tone: "neutral",
    },
    {
      label: "Runtime",
      value: formatAiNativeNarrativeRuntimeLabel(diagnostics?.latestRunRuntimePath),
      tone: "neutral",
    },
  ];
}
