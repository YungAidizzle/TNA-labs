import { NextRequest, NextResponse } from "next/server";
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
import { buildTrendDashboardStatusStripItems } from "@/lib/dashboard/status-strip";
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

function buildDashboardResponseHeaders(
  view: DashboardApiView,
  dataStatus: DashboardDataStatus | null | undefined,
) {
  const primaryFreshness = dataStatus?.sourceFreshness[0] ?? null;
  const sourceStatus = primaryFreshness?.sourceStatus ?? "unknown";
  const chainBreakStage = dataStatus?.freshnessDiagnostics?.chainBreakStage ?? "none";
  const sourceSnapshotAt =
    dataStatus?.sourceSnapshotGeneratedAt ??
    dataStatus?.freshnessDiagnostics?.sourceSnapshotAt ??
    primaryFreshness?.latestCreatedAt ??
    "";
  const servingStaleSource = sourceStatus === "stale" || (chainBreakStage && chainBreakStage !== "none");
  if (servingStaleSource) {
    console.warn("[dashboard-api] serving stale dashboard source data", {
      view,
      sourceStatus,
      chainBreakStage,
      sourceSnapshotAt: sourceSnapshotAt || null,
    });
  }

  return {
    "Cache-Control": servingStaleSource ? "private, no-store" : DASHBOARD_API_CACHE_CONTROL[view],
    "X-Attentra-Source-Status": sourceStatus,
    "X-Attentra-Chain-Break-Stage": chainBreakStage,
    ...(sourceSnapshotAt ? { "X-Attentra-Source-Snapshot-At": sourceSnapshotAt } : {}),
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
      dataStatus: summaryState.dataStatus ?? null,
    };

    return NextResponse.json(payload, {
      headers: buildDashboardResponseHeaders("status", payload.dataStatus),
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
      headers: buildDashboardResponseHeaders("memecoins", payload.dataStatus),
    });
  }

  const summaryState = await getSharedTrendDashboardSummaryState(query);
  const payload: TrendDashboardSummaryResponse = {
    query: summaryState.query,
    leaderboard: summaryState.leaderboard,
    dataStatus: summaryState.dataStatus ?? null,
  };

  return NextResponse.json(payload, {
    headers: buildDashboardResponseHeaders("summary", payload.dataStatus),
  });
}
