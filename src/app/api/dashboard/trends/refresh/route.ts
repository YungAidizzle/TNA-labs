import { NextRequest, NextResponse } from "next/server";
import {
  getDashboardRefreshState,
  requestDashboardBackgroundRefresh,
} from "@/lib/dashboard/background-refresh";
import { requirePaidApiUser } from "@/lib/supabase/auth";
import { DateRangePreset, TrendScope } from "@/types/domain";
import { DashboardRefreshMode } from "@/types/view-models";

const RANGE_OPTIONS: DateRangePreset[] = ["1h", "6h", "24h", "7d"];
const SCOPE_OPTIONS: TrendScope[] = ["overall", "memes"];

export async function GET() {
  const authResult = await requirePaidApiUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const state = await getDashboardRefreshState();
  return NextResponse.json(state);
}

export async function POST(request: NextRequest) {
  const authResult = await requirePaidApiUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { searchParams } = new URL(request.url);
  const requestedMode = searchParams.get("mode");
  const force = searchParams.get("force") === "true";
  const mode: DashboardRefreshMode =
    requestedMode === "manual_full_regroup"
      ? "manual_full_regroup"
      : requestedMode === "external_refresh" || requestedMode === "local_rebuild"
        ? "local_rebuild"
        : "local_rebuild";
  const trigger = searchParams.get("trigger")?.trim() || "api-trigger";
  const scope = searchParams.get("scope");
  const range = searchParams.get("range");
  const query =
    SCOPE_OPTIONS.includes(scope as TrendScope) && RANGE_OPTIONS.includes(range as DateRangePreset)
      ? [{ scope: scope as TrendScope, range: range as DateRangePreset }]
      : undefined;
  const state = await requestDashboardBackgroundRefresh(mode, trigger, {
    force,
    queries: query,
  });
  return NextResponse.json(state, { status: 202 });
}
