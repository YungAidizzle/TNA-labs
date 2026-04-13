import { NextResponse } from "next/server";
import { getLatestSuccessfulTrendSnapshotView } from "@/lib/gpt-trends/repository";
import { requirePaidApiUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requirePaidApiUser();
  if (user instanceof NextResponse) {
    return user;
  }

  const view = await getLatestSuccessfulTrendSnapshotView();
  const headers = new Headers({
    "Cache-Control": "private, max-age=300, stale-while-revalidate=3600",
  });

  if (view.snapshot?.id) {
    headers.set("X-Trend-Snapshot-Id", String(view.snapshot.id));
  }
  if (view.snapshot?.generatedAt) {
    headers.set("X-Trend-Snapshot-Generated-At", view.snapshot.generatedAt);
  }

  return NextResponse.json(view, { headers });
}
