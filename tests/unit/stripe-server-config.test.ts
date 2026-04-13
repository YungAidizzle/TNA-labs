import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function loadStripeServerModule() {
  vi.resetModules();
  return import("@/lib/stripe/server");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("stripe server config validation", () => {
  it("rejects malformed env values that only look configured", async () => {
    process.env.STRIPE_SECRET_KEY = "STRIPE_SECRET_KEY=sk_live_example";
    process.env.STRIPE_PRICE_ID = "STRIPE_PRICE_ID=20";
    process.env.STRIPE_WEBHOOK_SECRET = "STRIPE_WEBHOOK_SECRET=whsec_example";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY =
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_example";

    const stripeServer = await loadStripeServerModule();

    expect(stripeServer.hasStripeServerConfig()).toBe(false);
    expect(stripeServer.hasStripeCheckoutConfig()).toBe(false);
    expect(stripeServer.hasStripeWebhookConfig()).toBe(false);
    expect(() => stripeServer.getStripeServerClient()).toThrow("Invalid STRIPE_SECRET_KEY.");
    expect(() => stripeServer.getStripePriceId()).toThrow("Invalid STRIPE_PRICE_ID.");
    expect(() => stripeServer.getStripeWebhookSecret()).toThrow("Invalid STRIPE_WEBHOOK_SECRET.");
  });

  it("accepts valid live Stripe configuration", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_example";
    process.env.STRIPE_PRICE_ID = "price_example";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_example";

    const stripeServer = await loadStripeServerModule();

    expect(stripeServer.hasStripeServerConfig()).toBe(true);
    expect(stripeServer.hasStripeCheckoutConfig()).toBe(true);
    expect(stripeServer.hasStripeWebhookConfig()).toBe(true);
    expect(stripeServer.getStripePriceId()).toBe("price_example");
    expect(stripeServer.getStripeWebhookSecret()).toBe("whsec_example");
  });
});
