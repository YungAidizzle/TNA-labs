import { NextResponse } from "next/server";
import Stripe from "stripe";
import { confirmCheckoutSessionForUser } from "@/lib/billing/subscriptions";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { hasStripeServerConfig } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ConfirmCheckoutPayload = {
  sessionId?: string;
};

export async function POST(request: Request) {
  const { user, profile } = await getCurrentAuthContext();
  if (!user) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required.",
        },
      },
      { status: 401 },
    );
  }

  if (!hasStripeServerConfig()) {
    return NextResponse.json(
      {
        error: {
          code: "STRIPE_NOT_CONFIGURED",
          message: "Stripe checkout confirmation is unavailable.",
        },
      },
      { status: 500 },
    );
  }

  let payload: ConfirmCheckoutPayload;

  try {
    payload = (await request.json()) as ConfirmCheckoutPayload;
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_BODY",
          message: "Request body must be valid JSON.",
        },
      },
      { status: 400 },
    );
  }

  const sessionId = payload.sessionId?.trim();
  if (!sessionId) {
    return NextResponse.json(
      {
        error: {
          code: "MISSING_SESSION_ID",
          message: "Missing Stripe Checkout session ID.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await confirmCheckoutSessionForUser({
      sessionId,
      userId: user.id,
      currentAccessState: profile?.access_state ?? null,
      expectedStripeCustomerId: profile?.stripe_customer_id ?? null,
    });

    if (result.status === "invalid") {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_SESSION",
            message: result.message,
          },
        },
        { status: 403 },
      );
    }

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[stripe-checkout-confirm] failed to confirm checkout session", {
      userId: user.id,
      sessionId,
      error:
        error instanceof Stripe.errors.StripeError
          ? { type: error.type, code: error.code, message: error.message }
          : error,
    });

    return NextResponse.json(
      {
        error: {
          code: "CONFIRMATION_FAILED",
          message: "We could not confirm access with Stripe right now.",
        },
      },
      { status: 500 },
    );
  }
}
