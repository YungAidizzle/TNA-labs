import { NextResponse } from "next/server";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { confirmCheckoutSessionById } from "@/lib/billing/subscriptions";
import { hasStripeServerConfig } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readSessionIdFromRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as
      | { session_id?: string; sessionId?: string }
      | null;
    return body?.session_id ?? body?.sessionId ?? null;
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.formData();
    const value = formData.get("session_id") ?? formData.get("sessionId");
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  return new URL(request.url).searchParams.get("session_id");
}

export async function POST(request: Request) {
  if (!hasStripeServerConfig()) {
    return NextResponse.json(
      { error: { code: "STRIPE_NOT_CONFIGURED", message: "Stripe server is not configured." } },
      { status: 500 },
    );
  }

  const sessionId = await readSessionIdFromRequest(request);
  if (!sessionId) {
    return NextResponse.json(
      { error: { code: "MISSING_SESSION_ID", message: "Missing Stripe Checkout session id." } },
      { status: 400 },
    );
  }

  const { user, profile } = await getCurrentAuthContext();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required." } },
      { status: 401 },
    );
  }

  try {
    const result = await confirmCheckoutSessionById(sessionId, {
      authenticatedUserId: user.id,
      expectedEmail: user.email ?? profile?.email ?? null,
      source: "checkout_confirm_route",
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[stripe-checkout-confirm] failed", {
      sessionId,
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: {
          code: "CHECKOUT_CONFIRM_FAILED",
          message:
            error instanceof Error ? error.message : "Stripe Checkout confirmation failed.",
        },
      },
      { status: 500 },
    );
  }
}
