import { NextRequest, NextResponse } from "next/server";
import { getGptTrendConfig } from "@/lib/gpt-trends/config";
import { generateSharedTrendSnapshot } from "@/lib/gpt-trends/generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const { cronSecret } = getGptTrendConfig();
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

  try {
    const force = request.nextUrl.searchParams.get("force") === "true";
    const result = await generateSharedTrendSnapshot({
      force,
      trigger: "cron",
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[gpt-trends-cron] generation failed", error);
    return NextResponse.json(
      {
        error: {
          code: "GPT_TREND_GENERATION_FAILED",
          message: String((error as Error)?.message ?? error ?? "Unknown generation failure."),
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
