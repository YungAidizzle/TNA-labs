import "server-only";

import Stripe from "stripe";

type StripeEnvName =
  | "STRIPE_SECRET_KEY"
  | "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
  | "STRIPE_WEBHOOK_SECRET"
  | "STRIPE_PRICE_ID";

type StripeServerConfig = {
  secretKey: string | null;
  publishableKey: string | null;
  webhookSecret: string | null;
  priceId: string | null;
};

type ValidatedStripeServerConfig = StripeServerConfig & {
  issues: Array<{
    env: StripeEnvName;
    message: string;
  }>;
};

const STRIPE_SECRET_KEY_PATTERN = /^sk_(live|test)_[A-Za-z0-9]+$/;
const STRIPE_PUBLISHABLE_KEY_PATTERN = /^pk_(live|test)_[A-Za-z0-9]+$/;
const STRIPE_WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9]+$/;
const STRIPE_PRICE_ID_PATTERN = /^price_[A-Za-z0-9]+$/;

let stripeClient: Stripe | null = null;

function readStripeServerConfig(): StripeServerConfig {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY?.trim() || null,
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || null,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || null,
    priceId: process.env.STRIPE_PRICE_ID?.trim() || null,
  };
}

function resolveStripeMode(value: string | null, pattern: RegExp) {
  const match = value?.match(pattern);
  return match?.[1] ?? null;
}

function validateStripeServerConfig(): ValidatedStripeServerConfig {
  const config = readStripeServerConfig();
  const issues: ValidatedStripeServerConfig["issues"] = [];

  let { secretKey, publishableKey, webhookSecret, priceId } = config;

  if (secretKey && !STRIPE_SECRET_KEY_PATTERN.test(secretKey)) {
    issues.push({
      env: "STRIPE_SECRET_KEY",
      message: "Invalid STRIPE_SECRET_KEY. Expected a Stripe secret key like sk_live_... or sk_test_....",
    });
    secretKey = null;
  }

  if (publishableKey && !STRIPE_PUBLISHABLE_KEY_PATTERN.test(publishableKey)) {
    issues.push({
      env: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      message:
        "Invalid NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY. Expected a Stripe publishable key like pk_live_... or pk_test_....",
    });
    publishableKey = null;
  }

  if (webhookSecret && !STRIPE_WEBHOOK_SECRET_PATTERN.test(webhookSecret)) {
    issues.push({
      env: "STRIPE_WEBHOOK_SECRET",
      message: "Invalid STRIPE_WEBHOOK_SECRET. Expected a Stripe webhook secret like whsec_....",
    });
    webhookSecret = null;
  }

  if (priceId && !STRIPE_PRICE_ID_PATTERN.test(priceId)) {
    issues.push({
      env: "STRIPE_PRICE_ID",
      message: "Invalid STRIPE_PRICE_ID. Expected a Stripe recurring price ID like price_....",
    });
    priceId = null;
  }

  const secretMode = resolveStripeMode(secretKey, /^sk_(live|test)_/);
  const publishableMode = resolveStripeMode(publishableKey, /^pk_(live|test)_/);
  if (secretMode && publishableMode && secretMode !== publishableMode) {
    issues.push({
      env: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      message:
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY mode must match STRIPE_SECRET_KEY mode.",
    });
  }

  return {
    secretKey,
    publishableKey,
    webhookSecret,
    priceId,
    issues,
  };
}

function getConfigIssueMessage(
  issues: ValidatedStripeServerConfig["issues"],
  env: StripeEnvName,
  fallback: string,
) {
  return issues.find((issue) => issue.env === env)?.message ?? fallback;
}

export function hasStripeServerConfig() {
  const { secretKey, priceId } = validateStripeServerConfig();
  return Boolean(secretKey && priceId);
}

export function hasStripeCheckoutConfig() {
  const { secretKey, priceId, webhookSecret } = validateStripeServerConfig();
  return Boolean(secretKey && priceId && webhookSecret);
}

export function hasStripeWebhookConfig() {
  const { secretKey, webhookSecret } = validateStripeServerConfig();
  return Boolean(secretKey && webhookSecret);
}

export function getStripeServerClient() {
  if (stripeClient) {
    return stripeClient;
  }

  const { secretKey, issues } = validateStripeServerConfig();
  if (!secretKey) {
    throw new Error(
      getConfigIssueMessage(issues, "STRIPE_SECRET_KEY", "Missing STRIPE_SECRET_KEY."),
    );
  }

  stripeClient = new Stripe(secretKey);
  return stripeClient;
}

export function getStripePriceId() {
  const { priceId, issues } = validateStripeServerConfig();
  if (!priceId) {
    throw new Error(getConfigIssueMessage(issues, "STRIPE_PRICE_ID", "Missing STRIPE_PRICE_ID."));
  }

  return priceId;
}

export function getStripeWebhookSecret() {
  const { webhookSecret, issues } = validateStripeServerConfig();
  if (!webhookSecret) {
    throw new Error(
      getConfigIssueMessage(issues, "STRIPE_WEBHOOK_SECRET", "Missing STRIPE_WEBHOOK_SECRET."),
    );
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
