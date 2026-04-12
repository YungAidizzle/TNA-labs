import { afterEach, describe, expect, it, vi } from "vitest";

const hasStripeWebhookConfigMock = vi.hoisted(() => vi.fn());
const constructEventMock = vi.hoisted(() => vi.fn());
const getStripeWebhookSecretMock = vi.hoisted(() => vi.fn());
const syncCheckoutSessionMock = vi.hoisted(() => vi.fn());
const syncFailedCheckoutSessionMock = vi.hoisted(() => vi.fn());
const syncSubscriptionFromStripeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/stripe/server", () => ({
  hasStripeWebhookConfig: hasStripeWebhookConfigMock,
  getStripeServerClient: () => ({
    webhooks: {
      constructEvent: constructEventMock,
    },
  }),
  getStripeWebhookSecret: getStripeWebhookSecretMock,
}));

vi.mock("@/lib/billing/subscriptions", () => ({
  syncCheckoutSession: syncCheckoutSessionMock,
  syncFailedCheckoutSession: syncFailedCheckoutSessionMock,
  syncSubscriptionFromStripe: syncSubscriptionFromStripeMock,
}));

async function loadRouteModule() {
  vi.resetModules();
  return import("@/app/api/stripe/webhook/route");
}

describe("stripe webhook route", () => {
  afterEach(() => {
    hasStripeWebhookConfigMock.mockReset();
    constructEventMock.mockReset();
    getStripeWebhookSecretMock.mockReset();
    syncCheckoutSessionMock.mockReset();
    syncFailedCheckoutSessionMock.mockReset();
    syncSubscriptionFromStripeMock.mockReset();
  });

  it("keeps checkout session reconciliation in place", async () => {
    hasStripeWebhookConfigMock.mockReturnValue(true);
    getStripeWebhookSecretMock.mockReturnValue("whsec_test");
    constructEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_123", mode: "subscription" } },
    });

    const route = await loadRouteModule();
    const response = await route.POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": "sig_test",
        },
        body: "payload",
      }),
    );

    expect(response.status).toBe(200);
    expect(syncCheckoutSessionMock).toHaveBeenCalledWith({
      id: "cs_test_123",
      mode: "subscription",
    });
  });

  it("keeps subscription reconciliation in place for later webhook updates", async () => {
    hasStripeWebhookConfigMock.mockReturnValue(true);
    getStripeWebhookSecretMock.mockReturnValue("whsec_test");
    constructEventMock.mockReturnValue({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_123", status: "active" } },
    });

    const route = await loadRouteModule();
    const response = await route.POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": "sig_test",
        },
        body: "payload",
      }),
    );

    expect(response.status).toBe(200);
    expect(syncSubscriptionFromStripeMock).toHaveBeenCalledWith({
      id: "sub_123",
      status: "active",
    });
  });

  it("revokes provisional access when async payment ultimately fails", async () => {
    hasStripeWebhookConfigMock.mockReturnValue(true);
    getStripeWebhookSecretMock.mockReturnValue("whsec_test");
    constructEventMock.mockReturnValue({
      type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_test_123", mode: "subscription" } },
    });

    const route = await loadRouteModule();
    const response = await route.POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": "sig_test",
        },
        body: "payload",
      }),
    );

    expect(response.status).toBe(200);
    expect(syncFailedCheckoutSessionMock).toHaveBeenCalledWith({
      id: "cs_test_123",
      mode: "subscription",
    });
  });
});
