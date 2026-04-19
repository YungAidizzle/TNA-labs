import { NextRequest, NextResponse } from "next/server";
import { getLatestSuccessfulAiNativeNarrativeRunView } from "@/lib/ai-native-narratives/repository";
import { runAiNativeNarrativePipeline } from "@/lib/ai-native-narratives/worker";
import { requirePaidApiUser } from "@/lib/supabase/auth";

export async function GET() {
  const authResult = await requirePaidApiUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const view = await getLatestSuccessfulAiNativeNarrativeRunView();
  return NextResponse.json({
    status: view.run ? "succeeded" : "idle",
    latestRunId: view.run?.id ?? null,
    latestGeneratedAt: view.run?.generatedAt ?? null,
    candidateCount: view.run?.candidateCount ?? 0,
    evidenceCount: view.run?.evidenceCount ?? 0,
    narrativeCount: view.run?.narrativeCount ?? 0,
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
  const result = await runAiNativeNarrativePipeline({
    force,
    trigger,
  });
  return NextResponse.json(result, { status: 202 });
}
