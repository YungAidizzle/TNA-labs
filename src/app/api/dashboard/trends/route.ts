import { NextRequest, NextResponse } from "next/server";
import { getAiNativeNarrativeConfig } from "@/lib/ai-native-narratives/config";
import {
  AI_NATIVE_NARRATIVE_SCHEDULER_LABEL,
  AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY,
} from "@/lib/ai-native-narratives/scheduler";
import type {
  DashboardApiView,
  TrendDashboardMemecoinsResponse,
  TrendDashboardStatusResponse,
  TrendDashboardSummaryResponse,
} from "@/lib/dashboard/api";
import { parseTrendDashboardRequestQuery } from "@/lib/dashboard/api";
import { DASHBOARD_API_CACHE_CONTROL } from "@/lib/dashboard/cache";
import {
  getSharedTrendDashboardMemecoinState,
  getSharedTrendDashboardSummaryState,
} from "@/lib/dashboard/cached-state";
import { resolveDashboardServingMode } from "@/lib/dashboard/data-status";
import {
  buildTrendDashboardStatusStripItems,
  buildTrendDashboardStatusStripSystemDetails,
} from "@/lib/dashboard/status-strip";
import { requirePaidApiUser } from "@/lib/supabase/auth";
import type { DashboardDataStatus } from "@/types/view-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveView(value: string | null): DashboardApiView {
  if (value === "status" || value === "memecoins") {
    return value;
  }

  return "summary";
}

async function buildDashboardResponseHeaders(
  view: DashboardApiView,
  dataStatus: DashboardDataStatus | null | undefined,
) {
  const config = getAiNativeNarrativeConfig();
  const diagnostics = dataStatus?.freshnessDiagnostics ?? null;
  const primaryFreshness = dataStatus?.sourceFreshness[0] ?? null;
  const sourceStatus = primaryFreshness?.sourceStatus ?? "unknown";
  const servingMode = resolveDashboardServingMode(dataStatus) ?? "unknown";
  const chainBreakStage = diagnostics?.chainBreakStage ?? "none";
  const sourceSnapshotAt =
    dataStatus?.sourceSnapshotGeneratedAt ??
    diagnostics?.sourceSnapshotAt ??
    primaryFreshness?.latestCreatedAt ??
    "";
  const servingStaleSource =
    servingMode === "stale_fallback" ||
    sourceStatus === "stale" ||
    (chainBreakStage && chainBreakStage !== "none");
  if (servingStaleSource) {
    console.warn("[dashboard-api] serving stale dashboard source data", {
      view,
      servingMode,
      sourceStatus,
      chainBreakStage,
      sourceSnapshotAt: sourceSnapshotAt || null,
    });
  }

  const cacheControl = servingStaleSource ? "private, no-store" : DASHBOARD_API_CACHE_CONTROL[view];
  return {
    "Cache-Control": cacheControl,
    "X-Attentra-Cache-Policy": cacheControl,
    "X-Attentra-Serving-Mode": servingMode,
    "X-Attentra-Source-Status": sourceStatus,
    "X-Attentra-Chain-Break-Stage": chainBreakStage,
    "X-Attentra-Refresh-Interval-Seconds": String(config.refreshIntervalSeconds),
    "X-Attentra-Scheduler-Strategy": AI_NATIVE_NARRATIVE_SCHEDULER_STRATEGY,
    "X-Attentra-Scheduler-Label": AI_NATIVE_NARRATIVE_SCHEDULER_LABEL,
    ...(sourceSnapshotAt ? { "X-Attentra-Source-Snapshot-At": sourceSnapshotAt } : {}),
    ...(diagnostics?.latestRunId ? { "X-Attentra-Latest-Run-Id": String(diagnostics.latestRunId) } : {}),
    ...(diagnostics?.latestRunStatus
      ? { "X-Attentra-Latest-Run-Status": diagnostics.latestRunStatus }
      : {}),
    ...(diagnostics?.latestRunTrigger
      ? { "X-Attentra-Latest-Run-Trigger": diagnostics.latestRunTrigger }
      : {}),
    ...(diagnostics?.latestRunAt
      ? { "X-Attentra-Latest-Run-Generated-At": diagnostics.latestRunAt }
      : {}),
    ...(diagnostics?.latestRunCompletedAt
      ? { "X-Attentra-Latest-Run-Completed-At": diagnostics.latestRunCompletedAt }
      : {}),
    ...(diagnostics?.latestRunErrorMessage
      ? { "X-Attentra-Latest-Run-Error": diagnostics.latestRunErrorMessage }
      : {}),
    ...(diagnostics?.latestSuccessfulRunId
      ? { "X-Attentra-Run-Id": String(diagnostics.latestSuccessfulRunId) }
      : {}),
    ...(diagnostics?.latestSuccessfulTrigger
      ? { "X-Attentra-Run-Trigger": diagnostics.latestSuccessfulTrigger }
      : {}),
    ...(diagnostics?.latestSuccessfulRunAt
      ? { "X-Attentra-Run-Generated-At": diagnostics.latestSuccessfulRunAt }
      : {}),
    ...(diagnostics?.latestSuccessfulRunCompletedAt
      ? { "X-Attentra-Run-Completed-At": diagnostics.latestSuccessfulRunCompletedAt }
      : {}),
    ...(diagnostics?.latestSuccessfulRunCandidateCount !== null &&
    diagnostics?.latestSuccessfulRunCandidateCount !== undefined
      ? {
          "X-Attentra-Run-Candidate-Count": String(
            diagnostics.latestSuccessfulRunCandidateCount,
          ),
        }
      : {}),
    ...(diagnostics?.latestSuccessfulRunEvidenceCount !== null &&
    diagnostics?.latestSuccessfulRunEvidenceCount !== undefined
      ? {
          "X-Attentra-Run-Evidence-Count": String(
            diagnostics.latestSuccessfulRunEvidenceCount,
          ),
        }
      : {}),
    ...(diagnostics?.latestSuccessfulRunNarrativeCount !== null &&
    diagnostics?.latestSuccessfulRunNarrativeCount !== undefined
      ? {
          "X-Attentra-Run-Narrative-Count": String(
            diagnostics.latestSuccessfulRunNarrativeCount,
          ),
        }
      : {}),
    ...(diagnostics?.boardTargetCount !== null && diagnostics?.boardTargetCount !== undefined
      ? { "X-Attentra-Board-Target-Count": String(diagnostics.boardTargetCount) }
      : {}),
    ...(diagnostics?.boardServedNarrativeCount !== null &&
    diagnostics?.boardServedNarrativeCount !== undefined
      ? {
          "X-Attentra-Board-Served-Count": String(diagnostics.boardServedNarrativeCount),
        }
      : {}),
    ...(diagnostics?.boardFreshNarrativeCount !== null &&
    diagnostics?.boardFreshNarrativeCount !== undefined
      ? {
          "X-Attentra-Board-Fresh-Count": String(diagnostics.boardFreshNarrativeCount),
        }
      : {}),
    ...(diagnostics?.boardBackfillNarrativeCount !== null &&
    diagnostics?.boardBackfillNarrativeCount !== undefined
      ? {
          "X-Attentra-Board-Backfill-Count": String(
            diagnostics.boardBackfillNarrativeCount,
          ),
        }
      : {}),
    ...(dataStatus?.sourceSnapshotGeneratedAt
      ? { "X-Attentra-Run-Source-Snapshot-At": dataStatus.sourceSnapshotGeneratedAt }
      : {}),
  };
}

export async function GET(request: NextRequest) {
  const user = await requirePaidApiUser();
  if (user instanceof NextResponse) {
    return user;
  }

  const { searchParams } = new URL(request.url);
  const view = resolveView(searchParams.get("view"));
  const query = parseTrendDashboardRequestQuery(searchParams);

  if (view === "status") {
    const summaryState = await getSharedTrendDashboardSummaryState(query);
    const payload: TrendDashboardStatusResponse = {
      items: buildTrendDashboardStatusStripItems(summaryState),
      systemDetails: buildTrendDashboardStatusStripSystemDetails(summaryState),
      dataStatus: summaryState.dataStatus ?? null,
    };

    return NextResponse.json(payload, {
      headers: await buildDashboardResponseHeaders("status", payload.dataStatus),
    });
  }

  if (view === "memecoins") {
    const memecoinState = await getSharedTrendDashboardMemecoinState(query);
    const payload: TrendDashboardMemecoinsResponse = {
      marketMemecoins: memecoinState.marketMemecoins ?? null,
      correlatedMemecoins: memecoinState.correlatedMemecoins ?? null,
      dataStatus: memecoinState.dataStatus ?? null,
    };

    return NextResponse.json(payload, {
      headers: await buildDashboardResponseHeaders("memecoins", payload.dataStatus),
    });
  }

  const summaryState = await getSharedTrendDashboardSummaryState(query);
  const payload: TrendDashboardSummaryResponse = {
    query: summaryState.query,
    leaderboard: summaryState.leaderboard,
    dataStatus: summaryState.dataStatus ?? null,
  };

  return NextResponse.json(payload, {
    headers: await buildDashboardResponseHeaders("summary", payload.dataStatus),
  });
}
