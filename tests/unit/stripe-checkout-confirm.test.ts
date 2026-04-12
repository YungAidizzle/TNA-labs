import { afterEach, describe, expect, it, vi } from "vitest";

const getCurrentAuthContextMock = vi.hoisted(() => vi.fn());
const hasStripeServerConfigMock = vi.hoisted(() => vi.fn());
const confirmCheckoutSessionForUserMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/auth", () => ({
  getCurrentAuthContext: getCurrentAuthContextMock,
}));

vi.mock("@/lib/stripe/server", () => ({
  hasStripeServerConfig: hasStripeServerConfigMock,
}));

vi.mock("@/lib/billing/subscriptions", () => ({
  confirmCheckoutSessionForUser: confirmCheckoutSessionForUserMock,
}));

async function loadRouteModule() {
  vi.resetModules();
  return import("@/app/api/stripe/checkout/confirm/route");
}

describe("stripe checkout confirmation route", () => {
  afterEach(() => {
    getCurrentAuthContextMock.mockReset();
    hasStripeServerConfigMock.mockReset();
    confirmCheckoutSessionForUserMock.mockReset();
  });

  it("rejects missing session ids", async () => {
    hasStripeServerConfigMock.mockReturnValue(true);
    getCurrentAuthContextMock.mockResolvedValue({
      user: { id: "user_123" },
      profile: { access_state: "inactive", stripe_customer_id: "cus_123" },
    });

    const route = await loadRouteModule();
    const response = await route.POST(
      new Request("http://localhost/api/stripe/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "MISSING_SESSION_ID",
      },
    });
  });

  it("returns access confirmation when Stripe session is valid", async () => {
    hasStripeServerConfigMock.mockReturnValue(true);
    getCurrentAuthContextMock.mockResolvedValue({
      user: { id: "user_123" },
      profile: { access_state: "inactive", stripe_customer_id: "cus_123" },
    });
    confirmCheckoutSessionForUserMock.mockResolvedValue({
      status: "access_granted",
      message: "Access confirmed. Redirecting to the terminal.",
      accessState: "active",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      subscriptionStatus: "active",
    });

    const route = await loadRouteModule();
    const response = await route.POST(
      new Request("http://localhost/api/stripe/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "cs_test_123" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "access_granted",
      accessState: "active",
    });
    expect(confirmCheckoutSessionForUserMock).toHaveBeenCalledWith({
      sessionId: "cs_test_123",
      userId: "user_123",
      currentAccessState: "inactive",
      expectedStripeCustomerId: "cus_123",
    });
  });

  it("returns provisional access when billing is still finalizing", async () => {
    hasStripeServerConfigMock.mockReturnValue(true);
    getCurrentAuthContextMock.mockResolvedValue({
      user: { id: "user_123" },
      profile: { access_state: "inactive", stripe_customer_id: "cus_123" },
    });
    confirmCheckoutSessionForUserMock.mockResolvedValue({
      status: "pending_access",
      message: "Access is available now while Stripe finishes billing confirmation.",
      accessState: "pending",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      subscriptionStatus: "pending",
    });

    const route = await loadRouteModule();
    const response = await route.POST(
      new Request("http://localhost/api/stripe/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "cs_test_123" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "pending_access",
      accessState: "pending",
    });
  });

  it("rejects checkout sessions that do not belong to the current user", async () => {
    hasStripeServerConfigMock.mockReturnValue(true);
    getCurrentAuthContextMock.mockResolvedValue({
      user: { id: "user_123" },
      profile: { access_state: "inactive", stripe_customer_id: "cus_123" },
    });
    confirmCheckoutSessionForUserMock.mockResolvedValue({
      status: "invalid",
      message: "This checkout session does not belong to the current account.",
    });

    const route = await loadRouteModule();
    const response = await route.POST(
      new Request("http://localhost/api/stripe/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "cs_test_123" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_SESSION",
      },
    });
  });
});
