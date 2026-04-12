import { describe, expect, it } from "vitest";
import {
  hasDashboardAccessState,
  isPaidAccessState,
  mapStripeStatusToSubscriptionStatus,
  mapSubscriptionStatusToAccessState,
} from "@/lib/billing/shared";

describe("billing access state model", () => {
  it("allows dashboard access for pending and settled billing states", () => {
    expect(hasDashboardAccessState("pending")).toBe(true);
    expect(hasDashboardAccessState("trialing")).toBe(true);
    expect(hasDashboardAccessState("active")).toBe(true);
    expect(hasDashboardAccessState("inactive")).toBe(false);
    expect(hasDashboardAccessState("canceled")).toBe(false);
  });

  it("keeps settled paid access narrower than dashboard access", () => {
    expect(isPaidAccessState("pending")).toBe(false);
    expect(isPaidAccessState("trialing")).toBe(true);
    expect(isPaidAccessState("active")).toBe(true);
  });

  it("maps incomplete subscriptions to provisional pending access", () => {
    expect(mapStripeStatusToSubscriptionStatus("incomplete")).toBe("pending");
    expect(mapSubscriptionStatusToAccessState("pending")).toBe("pending");
  });

  it("revokes dashboard access when billing becomes past_due or unpaid", () => {
    expect(mapSubscriptionStatusToAccessState("past_due")).toBe("inactive");
    expect(mapStripeStatusToSubscriptionStatus("unpaid")).toBe("inactive");
  });
});
