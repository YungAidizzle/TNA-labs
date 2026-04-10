import { NextResponse } from "next/server";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { isPaidAccessState } from "@/lib/billing/shared";
import { getOrCreateStripeCustomerForUser } from "@/lib/billing/subscriptions";
import {
  getStripePriceId,
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

  if (profile && isPaidAccessState(profile.access_state)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const stripe = getStripeServerClient();
  const customerId = await getOrCreateStripeCustomerForUser({
    userId: user.id,
    email: user.email ?? profile?.email ?? null,
    existingCustomerId: profile?.stripe_customer_id ?? null,
  });
  const origin = resolveRequestOrigin(request);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    line_items: [
      {
        price: getStripePriceId(),
        quantity: 1,
      },
    ],
    metadata: {
      supabaseUserId: user.id,
    },
    subscription_data: {
      metadata: {
        supabaseUserId: user.id,
      },
    },
    success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/billing/cancel`,
  });

  if (!session.url) {
    return NextResponse.redirect(new URL("/pricing?error=checkout_unavailable", request.url));
  }

  return NextResponse.redirect(session.url, { status: 303 });
}
