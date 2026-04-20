import type { DashboardDataStatus, DashboardServingMode } from "@/types/view-models";

type ServingModeOptions = {
  hasRenderableData?: boolean;
};

function getSourceSnapshotAt(dataStatus: DashboardDataStatus | null | undefined) {
  return (
    dataStatus?.sourceSnapshotGeneratedAt ??
    dataStatus?.freshnessDiagnostics?.sourceSnapshotAt ??
    dataStatus?.sourceFreshness[0]?.latestCreatedAt ??
    null
  );
}

export function resolveDashboardServingMode(
  dataStatus: DashboardDataStatus | null | undefined,
  options: ServingModeOptions = {},
): DashboardServingMode | null {
  if (!dataStatus) {
    return null;
  }

  if (dataStatus.servingMode) {
    return dataStatus.servingMode;
  }

  if (dataStatus.showing === "zero_state") {
    return "empty";
  }

  if (options.hasRenderableData && dataStatus.sourceFreshness[0]?.sourceStatus === "stale") {
    return "stale_fallback";
  }

  return options.hasRenderableData ? "fresh" : null;
}

export function isDashboardStaleFallback(
  dataStatus: DashboardDataStatus | null | undefined,
  options: ServingModeOptions = {},
) {
  return resolveDashboardServingMode(dataStatus, options) === "stale_fallback";
}

export function buildDashboardStaleFallbackMessage(
  dataStatus: DashboardDataStatus | null | undefined,
  label: string,
  options: ServingModeOptions = {},
) {
  if (!isDashboardStaleFallback(dataStatus, options)) {
    return null;
  }

  const sourceSnapshotAt = getSourceSnapshotAt(dataStatus);
  const chainBreakStage = dataStatus?.freshnessDiagnostics?.chainBreakStage ?? null;
  const latestFailureAt =
    dataStatus?.freshnessDiagnostics?.latestFailureAt ??
    dataStatus?.freshnessDiagnostics?.latestRunAt ??
    null;
  const latestFailureTrigger =
    dataStatus?.freshnessDiagnostics?.latestFailureTrigger ??
    dataStatus?.freshnessDiagnostics?.latestRunTrigger ??
    null;
  const latestFailureMessage =
    dataStatus?.freshnessDiagnostics?.latestFailureErrorMessage ??
    dataStatus?.freshnessDiagnostics?.latestRunErrorMessage ??
    null;

  return [
    `${label} source is stale. Showing the last known good ${label.toLowerCase()} set.`,
    sourceSnapshotAt ? `Last successful snapshot: ${sourceSnapshotAt}.` : null,
    chainBreakStage && chainBreakStage !== "none"
      ? `Upstream issue: ${chainBreakStage}.`
      : null,
    latestFailureAt ? `Latest failed attempt: ${latestFailureAt}.` : null,
    latestFailureTrigger ? `Trigger: ${latestFailureTrigger}.` : null,
    latestFailureMessage ? `Error: ${latestFailureMessage}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export function getDashboardRefreshLabel(
  dataStatus: DashboardDataStatus | null | undefined,
  options: ServingModeOptions = {},
) {
  return isDashboardStaleFallback(dataStatus, options)
    ? "Last good refresh"
    : "Last refresh";
}
