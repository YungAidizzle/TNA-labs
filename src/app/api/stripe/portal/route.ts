import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { getSubscriptionForUser } from "@/lib/billing/subscriptions";
import {
  getStripeServerClient,
  hasStripeServerConfig,
  resolveRequestOrigin,
} from "@/lib/stripe/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasStripeServerConfig()) {
    return NextResponse.redirect(new URL("/pricing?error=stripe_not_configured", request.url));
  }

  const { user, profile } = await getCurrentAuthContext();
  if (!user) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", "/pricing");
    return NextResponse.redirect(url);
  }

  const subscription = await getSubscriptionForUser(user.id);
  const stripeCustomerId =
    profile?.stripe_customer_id ?? subscription?.stripe_customer_id ?? null;

  if (!stripeCustomerId) {
    return NextResponse.redirect(new URL("/pricing?error=missing_customer", request.url));
  }

  try {
    const stripe = getStripeServerClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${resolveRequestOrigin(request)}/pricing`,
    });

    return NextResponse.redirect(session.url, { status: 303 });
  } catch (error) {
    console.error("[stripe-portal] failed to create billing portal session", {
      userId: user.id,
      stripeCustomerId,
      error:
        error instanceof Stripe.errors.StripeError
          ? { type: error.type, code: error.code, message: error.message }
          : error,
    });
    return NextResponse.redirect(new URL("/pricing?error=stripe_request_failed", request.url));
  }
}
