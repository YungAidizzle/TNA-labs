import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionButtonForm } from "@/components/ui/action-button-form";
import { InteractiveLink } from "@/components/ui/interactive-link";
import { SignInForm } from "@/components/auth/sign-in-form";

const startNavigationMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
const signInWithPasswordMock = vi.hoisted(() => vi.fn());

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
});

describe("public interaction feedback", () => {
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
});
