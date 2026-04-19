import { NextRequest, NextResponse } from "next/server";
import { getAiNativeNarrativeConfig } from "@/lib/ai-native-narratives/config";
import { getLatestSuccessfulAiNativeNarrativeRunView } from "@/lib/ai-native-narratives/repository";
import { runAiNativeNarrativePipeline } from "@/lib/ai-native-narratives/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const { cronSecret } = getAiNativeNarrativeConfig();
  if (!cronSecret) {
    return process.env.NODE_ENV !== "production";
  }

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function handleRequest(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid cron authorization.",
        },
      },
      { status: 401 },
    );
  }

  if (request.method === "GET") {
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

  try {
    const force = request.nextUrl.searchParams.get("force") === "true";
    const result = await runAiNativeNarrativePipeline({
      force,
      trigger: "vercel-cron",
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[ai-native-narratives-cron] worker failed", error);
    return NextResponse.json(
      {
        error: {
          code: "AI_NATIVE_NARRATIVE_WORKER_FAILED",
          message: String((error as Error)?.message ?? error ?? "Unknown worker failure."),
        },
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}
