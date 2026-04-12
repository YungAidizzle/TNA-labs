import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckoutSuccessState } from "@/components/billing/checkout-success-state";

const startNavigationMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    onClick?: (event: MouseEvent) => void;
  }) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/billing/success",
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
}));

vi.mock("@/components/navigation/route-feedback-provider", () => ({
  useRouteFeedback: () => ({
    isNavigating: false,
    label: null,
    startNavigation: startNavigationMock,
  }),
}));

describe("checkout success confirmation state", () => {
  afterEach(() => {
    cleanup();
    startNavigationMock.mockReset();
    replaceMock.mockReset();
    refreshMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("shows immediate finalizing feedback and redirects when access is confirmed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "access_granted",
          message: "Access confirmed. Redirecting to the terminal.",
          accessState: "active",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          subscriptionStatus: "active",
        }),
      }),
    );

    render(
      <CheckoutSuccessState
        sessionId="cs_test_123"
        initialHasPaidAccess={false}
        initialAccessState="inactive"
        userEmail="user@example.com"
      />,
    );

    expect(screen.getByText(/finalizing your access now/i)).toBeTruthy();
    expect(screen.getByText(/finalizing access with stripe and updating your account/i)).toBeTruthy();

    await waitFor(() => {
      expect(startNavigationMock).toHaveBeenCalledWith("Opening terminal");
      expect(replaceMock).toHaveBeenCalledWith("/dashboard");
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("shows a retry state when the session is still processing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "processing",
          message: "Payment is still being confirmed. Access will open as soon as Stripe marks it paid.",
          accessState: "inactive",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          subscriptionStatus: "inactive",
        }),
      }),
    );

    render(
      <CheckoutSuccessState
        sessionId="cs_test_123"
        initialHasPaidAccess={false}
        initialAccessState="inactive"
        userEmail="user@example.com"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/payment received\. access is still being finalized/i)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /retry confirmation/i })).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects immediately when provisional pending access is granted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "pending_access",
          message: "Access is available now while Stripe finishes billing confirmation.",
          accessState: "pending",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          subscriptionStatus: "pending",
        }),
      }),
    );

    render(
      <CheckoutSuccessState
        sessionId="cs_test_123"
        initialHasPaidAccess={false}
        initialAccessState="inactive"
        userEmail="user@example.com"
      />,
    );

    await waitFor(() => {
      expect(startNavigationMock).toHaveBeenCalledWith("Opening terminal");
      expect(replaceMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("shows an error immediately when session id is missing", async () => {
    render(
      <CheckoutSuccessState
        sessionId={null}
        initialHasPaidAccess={false}
        initialAccessState="inactive"
        userEmail="user@example.com"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/missing checkout session id/i)).toBeTruthy();
    });
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
