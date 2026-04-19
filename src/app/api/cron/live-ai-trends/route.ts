import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleRequest(request: NextRequest) {
  return NextResponse.json(
    {
      error: {
        code: "LEGACY_TREND_PIPELINE_DISABLED",
        message:
          "The legacy live-ai trend cron is disabled. Use /api/cron/ai-native-narratives instead.",
        path: request.nextUrl.pathname,
      },
    },
    { status: 410 },
  );
}

export async function GET(request: NextRequest) {
  return handleRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}
