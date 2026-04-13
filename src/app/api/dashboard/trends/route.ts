import { NextRequest, NextResponse } from "next/server";
import type {
  DashboardApiView,
  TrendDashboardMemecoinsResponse,
  TrendDashboardStatusResponse,
  TrendDashboardSummaryResponse,
} from "@/lib/dashboard/api";
import { parseTrendDashboardRequestQuery } from "@/lib/dashboard/api";
import { getSharedTrendDashboardSummaryState } from "@/lib/dashboard/cached-state";
import { buildTrendDashboardStatusStripItems } from "@/lib/dashboard/status-strip";
import { requirePaidApiUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
};

function resolveView(value: string | null): DashboardApiView {
  if (value === "status" || value === "memecoins") {
    return value;
  }

  return "summary";
}

export async function GET(request: NextRequest) {
  const user = await requirePaidApiUser();
  if (user instanceof NextResponse) {
    return user;
  }

  const { searchParams } = new URL(request.url);
  const view = resolveView(searchParams.get("view"));
  const query = parseTrendDashboardRequestQuery(searchParams);
  const summaryState = await getSharedTrendDashboardSummaryState(query);

  if (view === "status") {
    const payload: TrendDashboardStatusResponse = {
      items: buildTrendDashboardStatusStripItems(summaryState),
      dataStatus: summaryState.dataStatus ?? null,
    };

    return NextResponse.json(payload, { headers: RESPONSE_HEADERS });
  }

  if (view === "memecoins") {
    const payload: TrendDashboardMemecoinsResponse = {
      correlatedMemecoins: summaryState.correlatedMemecoins ?? null,
      dataStatus: summaryState.dataStatus ?? null,
    };

    return NextResponse.json(payload, { headers: RESPONSE_HEADERS });
  }

  const payload: TrendDashboardSummaryResponse = {
    query: summaryState.query,
    leaderboard: summaryState.leaderboard,
    dataStatus: summaryState.dataStatus ?? null,
  };

  return NextResponse.json(payload, { headers: RESPONSE_HEADERS });
}
