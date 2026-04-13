import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { generateSharedTrendSnapshot } from "@/lib/gpt-trends/generator";
import { getLatestSuccessfulTrendSnapshotView } from "@/lib/gpt-trends/repository";
import { requirePaidApiUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function buildSnapshotRefreshResponse() {
  const view = await getLatestSuccessfulTrendSnapshotView();

  return {
    status: view.snapshot ? "ready" : "empty",
    snapshot: view.snapshot,
    freshnessMinutes: view.freshnessMinutes,
    trendCount: view.trends.length,
  } as const;
}

export async function GET() {
  const authResult = await requirePaidApiUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  return NextResponse.json(await buildSnapshotRefreshResponse());
}

export async function POST(request: NextRequest) {
  const authResult = await requirePaidApiUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";
  const trigger = searchParams.get("trigger")?.trim() || "dashboard-refresh-api";
  const deprecatedMode = searchParams.get("mode")?.trim() || null;

  if (deprecatedMode) {
    console.warn("[gpt-trends-refresh] ignoring legacy dashboard refresh mode", {
      mode: deprecatedMode,
      trigger,
    });
  }

  try {
    const result = await generateSharedTrendSnapshot({
      force,
      trigger,
    });
    revalidatePath("/trends");

    return NextResponse.json({
      result,
      ...(await buildSnapshotRefreshResponse()),
    });
  } catch (error) {
    console.error("[gpt-trends-refresh] generation failed", error);
    return NextResponse.json(
      {
        error: {
          code: "GPT_TREND_REFRESH_FAILED",
          message: String((error as Error)?.message ?? error ?? "Unknown refresh failure."),
        },
        ...(await buildSnapshotRefreshResponse()),
      },
      { status: 500 },
    );
  }
}
