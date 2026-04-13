import { NextRequest, NextResponse } from "next/server";
import { generateSharedAiTrendSnapshot } from "@/lib/ai-trends/generator";
import { getLatestSuccessfulAiTrendSnapshotView } from "@/lib/ai-trends/repository";
import { requirePaidApiUser } from "@/lib/supabase/auth";
import { DateRangePreset, TrendScope } from "@/types/domain";

const RANGE_OPTIONS: DateRangePreset[] = ["1h", "6h", "24h", "7d"];
const SCOPE_OPTIONS: TrendScope[] = ["overall", "memes"];

export async function GET() {
  const authResult = await requirePaidApiUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const view = await getLatestSuccessfulAiTrendSnapshotView();
  return NextResponse.json({
    status: view.snapshot ? "succeeded" : "idle",
    latestSnapshotId: view.snapshot?.id ?? null,
    latestGeneratedAt: view.snapshot?.generatedAt ?? null,
    trendCount: view.snapshot?.trendCount ?? 0,
    freshnessMinutes: view.freshnessMinutes,
  });
}

export async function POST(request: NextRequest) {
  const authResult = await requirePaidApiUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";
  const trigger = searchParams.get("trigger")?.trim() || "api-trigger";
  const scope = searchParams.get("scope");
  const range = searchParams.get("range");
  const hasTargetedQuery =
    SCOPE_OPTIONS.includes(scope as TrendScope) &&
    RANGE_OPTIONS.includes(range as DateRangePreset);
  const result = await generateSharedAiTrendSnapshot({
    force: force || hasTargetedQuery,
    trigger,
  });
  return NextResponse.json(result, { status: 202 });
}
