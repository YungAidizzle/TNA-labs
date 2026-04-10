import "server-only";

import { DashboardProfiler, formatDashboardProfileLog } from "@/lib/dashboard/profiling";
import {
  CURRENT_DASHBOARD_SESSION_ID,
  appendDashboardRefreshLog,
  buildAndPersistDashboardRuntimeBundle,
  getRuntimeBaseQueries,
  loadDashboardRefreshState,
  loadLatestDashboardRuntimeBundle,
  saveDashboardRefreshState,
} from "@/lib/dashboard/runtime-store";
import {
  DashboardRefreshMode,
  DashboardRefreshState,
  TrendDashboardQuery,
} from "@/types/view-models";

let inflightRefresh: Promise<DashboardRefreshState> | null = null;

function mergeRequestedQueries(
  current: Array<Pick<TrendDashboardQuery, "scope" | "range">>,
  incoming: Array<Pick<TrendDashboardQuery, "scope" | "range">> = [],
) {
  const deduped = new Map<string, Pick<TrendDashboardQuery, "scope" | "range">>();
  for (const query of [...current, ...incoming]) {
    deduped.set(`${query.scope}:${query.range}`, query);
  }

  return [...deduped.values()];
}

function createRefreshState(
  mode: DashboardRefreshMode,
  trigger: string,
  overrides: Partial<DashboardRefreshState> = {},
): DashboardRefreshState {
  return {
    status: "idle",
    mode,
    trigger,
    requestedAt: null,
    startedAt: null,
    completedAt: null,
    lastError: null,
    latestBundleGeneratedAt: null,
    latestSourceSnapshotGeneratedAt: null,
    ownerPid: process.pid,
    ownerSessionId: CURRENT_DASHBOARD_SESSION_ID,
    staleClearedAt: null,
    staleReason: null,
    ...overrides,
  };
}

function getStateActivityTimestamp(state: DashboardRefreshState | null) {
  return state?.startedAt ?? state?.requestedAt ?? null;
}

function isActiveRefreshState(state: DashboardRefreshState | null) {
  if (!state || (state.status !== "scheduled" && state.status !== "running")) {
    return false;
  }

  const timestamp = getStateActivityTimestamp(state);
  if (!timestamp) {
    return true;
  }

  const ageMs = Date.now() - Date.parse(timestamp);
  return Number.isFinite(ageMs) && ageMs < 4 * 60 * 60 * 1000;
}

function normalizeRefreshMode(mode: DashboardRefreshMode): DashboardRefreshMode {
  if (mode === "external_refresh") {
    console.warn(
      "[dashboard-refresh] external_refresh is deprecated; using local_rebuild without launching ingestion",
    );
    return "local_rebuild";
  }

  return mode;
}

export async function getDashboardRefreshState() {
  const state = await loadDashboardRefreshState();
  return state ?? createRefreshState("local_rebuild", "startup");
}

async function runRefresh(
  mode: DashboardRefreshMode,
  trigger: string,
  requestedQueries: Array<Pick<TrendDashboardQuery, "scope" | "range">> = [],
  options: { force?: boolean } = {},
) {
  const normalizedMode = normalizeRefreshMode(mode);
  const runningState = createRefreshState(normalizedMode, trigger, {
    status: "running",
    requestedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  });
  console.info("[dashboard-refresh] rebuild start", {
    mode: normalizedMode,
    trigger,
    ownerPid: runningState.ownerPid,
    ownerSessionId: runningState.ownerSessionId,
  });
  await saveDashboardRefreshState(runningState);

  try {
    const profiler = new DashboardProfiler();
    const existingBundle =
      options.force || normalizedMode === "manual_full_regroup"
        ? null
        : await loadLatestDashboardRuntimeBundle();
    const effectiveQueries = mergeRequestedQueries(
      existingBundle ? getRuntimeBaseQueries(existingBundle) : [],
      requestedQueries,
    );
    const bundleOrigin =
      normalizedMode === "manual_full_regroup" ? "manual_full_regroup" : "background_refresh";
    const { bundle, timings } = await buildAndPersistDashboardRuntimeBundle(bundleOrigin, {
      profiler,
      refreshState: runningState,
      requestedQueries: effectiveQueries,
      existingBundle,
    });

    const succeededState = createRefreshState(normalizedMode, trigger, {
      status: "succeeded",
      requestedAt: runningState.requestedAt,
      startedAt: runningState.startedAt,
      completedAt: new Date().toISOString(),
      latestBundleGeneratedAt: bundle.generatedAt,
      latestSourceSnapshotGeneratedAt: bundle.sourceSnapshotGeneratedAt,
    });
    await saveDashboardRefreshState(succeededState);
    await appendDashboardRefreshLog({
      completedAt: succeededState.completedAt,
      mode: normalizedMode,
      trigger,
      timings,
      latestBundleGeneratedAt: bundle.generatedAt,
      latestSourceSnapshotGeneratedAt: bundle.sourceSnapshotGeneratedAt,
    });
    console.info(
      formatDashboardProfileLog("background-refresh", timings, {
        mode: normalizedMode,
        trigger,
        origin: bundle.origin,
      }),
    );
    console.info("[dashboard-refresh] rebuild complete", {
      mode: normalizedMode,
      trigger,
      origin: bundle.origin,
      generatedAt: bundle.generatedAt,
      sourceSnapshotGeneratedAt: bundle.sourceSnapshotGeneratedAt,
      latestFetchedAt: bundle.latestFetchedAt,
      rawCounts: bundle.rawCounts,
    });
    return succeededState;
  } catch (error) {
    const failedState = createRefreshState(normalizedMode, trigger, {
      status: "failed",
      requestedAt: runningState.requestedAt,
      startedAt: runningState.startedAt,
      completedAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
    });
    await saveDashboardRefreshState(failedState);
    await appendDashboardRefreshLog({
      completedAt: failedState.completedAt,
      mode: normalizedMode,
      trigger,
      error: failedState.lastError,
    });
    console.error("[dashboard-refresh] failed", error);
    return failedState;
  } finally {
    inflightRefresh = null;
  }
}

export async function requestDashboardBackgroundRefresh(
  mode: DashboardRefreshMode,
  trigger: string,
  options: {
    force?: boolean;
    queries?: TrendDashboardQuery[] | Array<Pick<TrendDashboardQuery, "scope" | "range">>;
  } = {},
) {
  const normalizedMode = normalizeRefreshMode(mode);
  const currentState = await loadDashboardRefreshState();
  if (inflightRefresh && isActiveRefreshState(currentState)) {
    return currentState!;
  }

  if (!inflightRefresh && isActiveRefreshState(currentState)) {
    return currentState!;
  }

  if (options.force) {
    console.info("[dashboard-refresh] force requested", {
      mode: normalizedMode,
      trigger,
      currentStatus: currentState?.status ?? null,
      currentOwnerPid: currentState?.ownerPid ?? null,
      currentOwnerSessionId: currentState?.ownerSessionId ?? null,
    });
  }

  const scheduledState = createRefreshState(normalizedMode, trigger, {
    status: "scheduled",
    requestedAt: new Date().toISOString(),
  });
  await saveDashboardRefreshState(scheduledState);
  inflightRefresh = runRefresh(
    normalizedMode,
    trigger,
    mergeRequestedQueries([], options.queries as Array<Pick<TrendDashboardQuery, "scope" | "range">> | undefined),
    { force: options.force },
  );
  return scheduledState;
}
