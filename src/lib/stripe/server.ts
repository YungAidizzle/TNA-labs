import "server-only";

import Stripe from "stripe";

type StripeServerConfig = {
  secretKey: string | null;
  publishableKey: string | null;
  webhookSecret: string | null;
  priceId: string | null;
};

let stripeClient: Stripe | null = null;

function readStripeServerConfig(): StripeServerConfig {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY?.trim() || null,
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || null,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || null,
    priceId: process.env.STRIPE_PRICE_ID?.trim() || null,
  };
}

export function hasStripeServerConfig() {
  const { secretKey, priceId } = readStripeServerConfig();
  return Boolean(secretKey && priceId);
}

export function hasStripeWebhookConfig() {
  const { secretKey, webhookSecret } = readStripeServerConfig();
  return Boolean(secretKey && webhookSecret);
}

export function getStripeServerClient() {
  if (stripeClient) {
    return stripeClient;
  }

  const { secretKey } = readStripeServerConfig();
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY.");
  }

  stripeClient = new Stripe(secretKey);
  return stripeClient;
}

export function getStripePriceId() {
  const { priceId } = readStripeServerConfig();
  if (!priceId) {
    throw new Error("Missing STRIPE_PRICE_ID.");
  }

  return priceId;
}

export function getStripeWebhookSecret() {
  const { webhookSecret } = readStripeServerConfig();
  if (!webhookSecret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET.");
  }

  return webhookSecret;
}

export function resolveRequestOrigin(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}
