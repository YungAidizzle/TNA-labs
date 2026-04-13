import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { isPaidAccessState } from "@/lib/billing/shared";
import { getOrCreateStripeCustomerForUser } from "@/lib/billing/subscriptions";
import { recordPolicyAcceptance } from "@/lib/legal/policy-acceptances";
import { BILLING_VERSION, PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/policy-versions";
import { readRequestIpAddress, readRequestUserAgent } from "@/lib/legal/request-metadata";
import {
  hasStripeCheckoutConfig,
  getStripePriceId,
  getStripeServerClient,
  resolveRequestOrigin,
} from "@/lib/stripe/server";
import { resolveSafeRedirectTarget } from "@/lib/supabase/shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readCheckoutConsent(request: Request) {
  const formData = await request.formData();

  return {
    acceptedTermsPrivacy: formData.get("accept_terms_privacy") === "on",
    acceptedBillingDisclosure: formData.get("accept_billing_disclosure") === "on",
    next: resolveSafeRedirectTarget(
      typeof formData.get("next") === "string" ? String(formData.get("next")) : null,
      "/dashboard",
    ),
  };
}

export async function POST(request: Request) {
  if (!hasStripeCheckoutConfig()) {
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

  const consent = await readCheckoutConsent(request);
  if (!consent.acceptedTermsPrivacy || !consent.acceptedBillingDisclosure) {
    const url = new URL("/pricing", request.url);
    url.searchParams.set("error", "checkout_consent_required");
    return NextResponse.redirect(url);
  }

  try {
    const ipAddress = readRequestIpAddress(request);
    const userAgent = readRequestUserAgent(request);

    await recordPolicyAcceptance({
      userId: user.id,
      policyType: "terms",
      policyVersion: TERMS_VERSION,
      context: "checkout",
      ipAddress,
      userAgent,
    });
    await recordPolicyAcceptance({
      userId: user.id,
      policyType: "privacy",
      policyVersion: PRIVACY_VERSION,
      context: "checkout",
      ipAddress,
      userAgent,
    });
    await recordPolicyAcceptance({
      userId: user.id,
      policyType: "billing",
      policyVersion: BILLING_VERSION,
      context: "checkout",
      ipAddress,
      userAgent,
    });

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
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}&next=${encodeURIComponent(consent.next)}`,
      cancel_url: `${origin}/billing/cancel?next=${encodeURIComponent(consent.next)}`,
    });

    if (!session.url) {
      return NextResponse.redirect(new URL("/pricing?error=checkout_unavailable", request.url));
    }

    return NextResponse.redirect(session.url, { status: 303 });
  } catch (error) {
    console.error("[stripe-checkout] failed to create checkout session", {
      userId: user.id,
      error:
        error instanceof Stripe.errors.StripeError
          ? { type: error.type, code: error.code, message: error.message }
          : error,
    });
    return NextResponse.redirect(new URL("/pricing?error=stripe_request_failed", request.url));
  }
}
