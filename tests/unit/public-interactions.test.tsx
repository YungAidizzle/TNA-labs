import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { ActionButtonForm } from "@/components/ui/action-button-form";
import { Button, buttonClassName } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";

const startNavigationMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
const signInWithPasswordMock = vi.hoisted(() => vi.fn());
const signUpMock = vi.hoisted(() => vi.fn());

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
  usePathname: () => "/",
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/navigation/route-feedback-provider", () => ({
  RouteFeedbackProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useRouteFeedback: () => ({
    isNavigating: false,
    label: null,
    startNavigation: startNavigationMock,
  }),
}));

vi.mock("@/lib/supabase/browser", () => ({
  hasSupabaseBrowserConfig: () => true,
  getSupabaseBrowserClient: () => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signUp: signUpMock,
    },
  }),
}));

vi.mock("@/lib/supabase/shared", () => ({
  resolveSafeRedirectTarget: () => "/dashboard",
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  startNavigationMock.mockReset();
  replaceMock.mockReset();
  refreshMock.mockReset();
  signInWithPasswordMock.mockReset();
  signUpMock.mockReset();
});

describe("public interaction feedback", () => {
  it("shared CTA classes include visible hover, focus, active, and disabled feedback", () => {
    const className = buttonClassName({ tone: "primary", size: "lg" });

    expect(className).toContain("cursor-pointer");
    expect(className).toContain("focus-visible:ring-2");
    expect(className).toContain("hover:-translate-y-px");
    expect(className).toContain("active:translate-y-[1px]");
    expect(className).toContain("disabled:cursor-not-allowed");
  });

  it("shows immediate pending feedback for internal navigation links", async () => {
    const user = userEvent.setup();

    render(
      <InteractiveLink href="/pricing" pendingLabel="Opening pricing">
        Review pricing
      </InteractiveLink>,
    );

    await user.click(screen.getByRole("link", { name: /review pricing/i }));

    expect(startNavigationMock).toHaveBeenCalledWith("Opening pricing");
    expect(screen.getByRole("link", { name: /opening pricing/i }).textContent).toContain(
      "Opening pricing",
    );
  });

  it("shows pending feedback on navbar CTAs", async () => {
    const user = userEvent.setup();

    render(<MarketingHeader isAuthenticated={false} />);

    await user.click(screen.getByRole("link", { name: /get access/i }));

    expect(startNavigationMock).toHaveBeenCalledWith("Opening account setup");
    expect(screen.getByRole("link", { name: /opening account setup/i })).toBeTruthy();
  });

  it("shows immediate pending feedback for checkout actions", async () => {
    const user = userEvent.setup();

    render(
      <ActionButtonForm
        action="/api/stripe/checkout"
        pendingLabel="Opening Stripe Checkout"
      >
        Unlock access
      </ActionButtonForm>,
    );

    const form = screen.getByRole("button", { name: /unlock access/i }).closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    expect(startNavigationMock).toHaveBeenCalledWith("Opening Stripe Checkout");
    expect(
      screen.getByRole("button", { name: /opening stripe checkout/i }),
    ).toHaveProperty("disabled", true);
  });

  it("keeps keyboard focus on main interactive controls", async () => {
    const user = userEvent.setup();

    render(
      <div>
        <InteractiveLink
          href="/pricing"
          pendingLabel="Opening pricing"
          className={buttonClassName({ tone: "primary" })}
        >
          Review pricing
        </InteractiveLink>
        <Button>Continue</Button>
      </div>,
    );

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: /review pricing/i }));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /continue/i }));
  });

  it("keeps the sign-in form in a visible pending state while auth is in flight", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<{ error: null }>();
    signInWithPasswordMock.mockReturnValueOnce(deferred.promise);

    render(<SignInForm />);

    const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

    await user.type(emailInput, "operator@desk.com");
    await user.type(passwordInput, "password123");
    const form = screen.getByRole("button", { name: /^sign in$/i }).closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "operator@desk.com",
      password: "password123",
    });
    expect(screen.getByText(/validating credentials and loading the next surface/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /signing in/i })).toHaveProperty("disabled", true);
    expect(emailInput.disabled).toBe(true);
    expect(passwordInput.disabled).toBe(true);

    deferred.resolve({ error: null });

    await waitFor(() => {
      expect(startNavigationMock).toHaveBeenCalledWith("Opening operator workspace");
      expect(replaceMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("keeps the sign-up form in a visible pending state while account creation is in flight", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<{ data: { session: null }; error: null }>();
    signUpMock.mockReturnValueOnce(deferred.promise);

    render(<SignUpForm />);

    const emailInput = screen.getByLabelText(/^email$/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    const confirmPasswordInput = screen.getByLabelText(/confirm password/i) as HTMLInputElement;

    await user.type(emailInput, "operator@desk.com");
    await user.type(passwordInput, "password123");
    await user.type(confirmPasswordInput, "password123");
    const form = screen.getByRole("button", { name: /create account/i }).closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    expect(signUpMock).toHaveBeenCalled();
    expect(screen.getByText(/provisioning account and preparing the next access step/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /creating account/i })).toHaveProperty("disabled", true);
    expect(emailInput.disabled).toBe(true);
    expect(passwordInput.disabled).toBe(true);
    expect(confirmPasswordInput.disabled).toBe(true);

    deferred.resolve({ data: { session: null }, error: null });

    await waitFor(() => {
      expect(startNavigationMock).toHaveBeenCalledWith("Opening access setup");
      expect(replaceMock).toHaveBeenCalledWith(
        "/onboarding?mode=check-email&email=operator%40desk.com",
      );
    });
  });
});
