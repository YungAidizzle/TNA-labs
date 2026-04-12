import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  hasStripeWebhookConfig,
  getStripeServerClient,
  getStripeWebhookSecret,
} from "@/lib/stripe/server";
import {
  syncFailedCheckoutSession,
  syncCheckoutSession,
  syncSubscriptionFromStripe,
} from "@/lib/billing/subscriptions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasStripeWebhookConfig()) {
    return NextResponse.json(
      { error: { code: "STRIPE_NOT_CONFIGURED", message: "Stripe webhook is not configured." } },
      { status: 500 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: { code: "MISSING_SIGNATURE", message: "Missing Stripe signature." } },
      { status: 400 },
    );
  }

  const stripe = getStripeServerClient();
  const payload = await request.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, getStripeWebhookSecret());
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_SIGNATURE",
          message: error instanceof Error ? error.message : "Invalid Stripe signature.",
        },
      },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await syncCheckoutSession(event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.async_payment_failed":
        await syncFailedCheckoutSession(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscriptionFromStripe(event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }
  } catch (error) {
    console.error("[stripe-webhook] failed to process event", {
      eventType: event.type,
      error,
    });
    return NextResponse.json(
      {
        error: {
          code: "WEBHOOK_PROCESSING_FAILED",
          message: error instanceof Error ? error.message : "Stripe webhook processing failed.",
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
