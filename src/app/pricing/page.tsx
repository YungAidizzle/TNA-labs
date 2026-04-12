import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  CreditCard,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { ActionButtonForm } from "@/components/ui/action-button-form";
import { buttonClassName } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";
import { getCurrentViewerSubscription } from "@/lib/billing/subscriptions";
import { hasDashboardAccessState, isPaidAccessState } from "@/lib/billing/shared";
import {
  hasStripeCheckoutConfig,
  hasStripeServerConfig,
  hasStripeWebhookConfig,
} from "@/lib/stripe/server";
import { getCurrentAuthContext } from "@/lib/supabase/auth";

type PricingPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const membershipIncludes = [
  {
    title: "Live terminal access",
    description:
      "Enter the ranked narrative workspace and linked asset context reserved for members.",
    icon: Workflow,
  },
  {
    title: "Account continuity",
    description:
      "Your access follows the same account across sessions, devices, and billing updates.",
    icon: ShieldCheck,
  },
  {
    title: "Billing control",
    description:
      "Manage renewal or cancellation from Stripe's hosted billing portal once membership is active.",
    icon: CreditCard,
  },
] as const;

const nextSteps = [
  {
    step: "01",
    title: "Create an account or sign in",
    description:
      "Membership attaches to your account first, so the terminal opens in the right place after payment.",
  },
  {
    step: "02",
    title: "Review billing in secure checkout",
    description:
      "Stripe Checkout shows the exact billing amount and renewal cadence before you confirm the purchase.",
  },
  {
    step: "03",
    title: "Return and enter the terminal",
    description:
      "After payment, you come back here and access opens as soon as the membership is confirmed.",
  },
] as const;

function readQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function resolveErrorMessage(error: string | undefined) {
  if (error === "stripe_not_configured") {
    return "Membership checkout is temporarily unavailable.";
  }

  if (error === "checkout_unavailable") {
    return "We could not open secure checkout just now. Please try again.";
  }

  if (error === "missing_customer") {
    return "We could not load billing for this account. Please try again.";
  }

  if (error === "stripe_request_failed") {
    return "Billing could not be reached just now. Please try again.";
  }

  return null;
}

export default async function PricingPage({ searchParams }: PricingPageProps) {
  const params = searchParams ? await searchParams : {};
  const error = readQueryValue(params.error);
  const { user, profile } = await getCurrentAuthContext();
  const subscription = await getCurrentViewerSubscription(user?.id);
  const hasDashboardAccess = hasDashboardAccessState(profile?.access_state);
  const hasSettledAccess = isPaidAccessState(profile?.access_state);
  const isPendingAccess = profile?.access_state === "pending";
  const stripeServerConfigured = hasStripeServerConfig();
  const stripeWebhookConfigured = hasStripeWebhookConfig();
  const stripeCheckoutConfigured = hasStripeCheckoutConfig();
  const errorMessage = resolveErrorMessage(error);

  const readinessRows = [
    {
      label: "Account",
      value: user ? "Ready" : "Required",
      accent: user ? "text-cyan" : "text-[#94aac2]",
    },
    {
      label: "Checkout",
      value: stripeCheckoutConfigured ? "Available" : "Unavailable",
      accent: stripeCheckoutConfigured ? "text-emerald" : "text-amber",
    },
    {
      label: "Activation",
      value: stripeWebhookConfigured ? "Fast" : "Delayed",
      accent: stripeWebhookConfigured ? "text-emerald" : "text-amber",
    },
  ] as const;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader
        isAuthenticated={Boolean(user)}
        hasPaidAccess={hasDashboardAccess}
      />

      <main className="mx-auto flex w-full max-w-[1320px] flex-col gap-8 px-4 pb-16 pt-8 sm:px-6 lg:px-8 lg:gap-10 lg:pb-24">
        <section className="grid gap-6 lg:grid-cols-[0.96fr_1.04fr]">
          <div className="surface-panel p-8 sm:p-10 lg:p-12">
            <span className="eyebrow-chip">
              <Sparkles className="h-3.5 w-3.5 text-cyan" />
              Membership
            </span>

            <h1 className="mt-8 max-w-[720px] text-[40px] font-semibold leading-[0.98] tracking-[-0.06em] text-[#f6fbff] sm:text-[52px]">
              Member access to the live narrative terminal.
            </h1>

            <p className="mt-6 max-w-[700px] text-[16px] leading-8 text-[#9cb1c8]">
              Membership opens the live terminal, keeps access attached to your account, and gives
              you direct billing control. The purchase itself is confirmed inside secure Stripe Checkout.
            </p>

            <div className="mt-8 status-banner border-cyan/12 bg-cyan/[0.06] text-[#def1ff]">
              The final billing amount and renewal cadence are shown in checkout before you confirm.
            </div>

            <div className="mt-10 grid gap-3 md:grid-cols-3">
              {membershipIncludes.map((item) => (
                <article key={item.title} className="metric-card">
                  <div className="flex h-11 w-11 items-center justify-center border border-white/[0.08] bg-[#08111c] text-cyan">
                    <item.icon className="h-4 w-4" />
                  </div>
                  <p className="mt-5 text-[17px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                    {item.title}
                  </p>
                  <p className="mt-3 text-[14px] leading-7 text-[#8ea4bc]">{item.description}</p>
                </article>
              ))}
            </div>
          </div>

          <section
            id="readiness"
            className="surface-panel panel-glow-cyan border border-cyan/16 p-8 sm:p-10 lg:p-12"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="section-kicker">Operator Membership</p>
                <h2 className="mt-4 text-[32px] font-semibold tracking-[-0.05em] text-[#f4f9ff] sm:text-[38px]">
                  Secure checkout and account-based access.
                </h2>
              </div>
              <span className="eyebrow-chip border-cyan/18 bg-cyan/[0.06] text-[#dff8ff]">
                <CreditCard className="h-3.5 w-3.5 text-cyan" />
                Hosted in Stripe
              </span>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {readinessRows.map((row) => (
                <div key={row.label} className="metric-card">
                  <p className="section-kicker">{row.label}</p>
                  <p className={`mt-3 text-[15px] font-semibold tracking-[-0.02em] ${row.accent}`}>
                    {row.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-8 grid gap-3 md:grid-cols-2">
              <div className="metric-card">
                <p className="section-kicker">Current status</p>
                <p className="mt-3 text-[16px] font-semibold capitalize tracking-[-0.03em] text-[#eef5ff]">
                  {profile?.access_state ?? "guest"}
                </p>
                <p className="mt-3 text-[13px] leading-6 text-[#8ca2ba]">
                  {isPendingAccess
                    ? "Access is available while Stripe finishes confirming the payment."
                    : subscription?.current_period_end
                    ? `Membership renews through ${new Date(subscription.current_period_end).toLocaleString()}.`
                    : "No active membership is attached to this account yet."}
                </p>
              </div>
              <div className="metric-card">
                <p className="section-kicker">Billing portal</p>
                <p className="mt-3 text-[16px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                  {user && subscription?.stripe_customer_id ? "Ready" : "Available after checkout"}
                </p>
                <p className="mt-3 text-[13px] leading-6 text-[#8ca2ba]">
                  Manage renewal and payment details once the account has an active Stripe customer record.
                </p>
              </div>
            </div>

            {errorMessage ? (
              <div className="mt-6 border border-rose/20 bg-rose/10 px-4 py-3 text-[13px] text-[#ff9b9b]">
                {errorMessage}
              </div>
            ) : null}

            {!stripeServerConfigured ? (
              <div className="mt-6 border border-amber/20 bg-amber/10 px-4 py-3 text-[13px] text-[#f7c27b]">
                Membership checkout is temporarily unavailable.
              </div>
            ) : null}

            {stripeServerConfigured && !stripeWebhookConfigured ? (
              <div className="mt-6 border border-amber/20 bg-amber/10 px-4 py-3 text-[13px] text-[#f7c27b]">
                Access confirmation is temporarily delayed. Membership will appear after the payment record is confirmed.
              </div>
            ) : null}

            <div className="mt-8 flex flex-wrap gap-3">
              {hasDashboardAccess ? (
                <InteractiveLink
                  href="/dashboard"
                  pendingLabel="Opening terminal"
                  navigationLabel="Opening terminal"
                  className={buttonClassName({ tone: "primary", size: "lg" })}
                >
                  <span className="inline-flex items-center gap-2">
                    Open terminal
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </InteractiveLink>
              ) : (
                <ActionButtonForm
                  action="/api/stripe/checkout"
                  pendingLabel="Opening secure checkout"
                  navigationLabel="Opening secure checkout"
                  size="lg"
                  disabled={!stripeCheckoutConfigured}
                  trailingAdornment={<ArrowRight className="h-4 w-4" />}
                >
                  Start membership
                </ActionButtonForm>
              )}

              {user && subscription?.stripe_customer_id ? (
                <ActionButtonForm
                  action="/api/stripe/portal"
                  pendingLabel="Opening billing settings"
                  navigationLabel="Opening billing settings"
                  tone="secondary"
                  size="lg"
                >
                  Manage billing
                </ActionButtonForm>
              ) : (
                <InteractiveLink
                  href={user ? "/" : "/sign-in"}
                  pendingLabel={user ? "Returning home" : "Opening sign in"}
                  navigationLabel={user ? "Returning home" : "Opening sign in"}
                  className={buttonClassName({ tone: "secondary", size: "lg" })}
                >
                  {user ? "Return home" : "Sign in to continue"}
                </InteractiveLink>
              )}
            </div>

            <div className="mt-6 status-banner flex items-start gap-3 border-cyan/12 bg-cyan/[0.06] text-[#dff1ff]">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
              <span>
                {user
                  ? hasSettledAccess
                    ? "Membership is active and the dashboard is unlocked."
                    : isPendingAccess
                      ? "Access is available now while Stripe finishes billing confirmation. If payment fails later, access will be removed automatically."
                      : "After payment, the return flow verifies checkout and opens access as soon as billing can be confirmed."
                  : "If you are not signed in yet, the flow takes you through account access before billing continues."}
              </span>
            </div>
          </section>
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
          <article className="surface-panel p-8 sm:p-10">
            <p className="section-kicker">Why membership matters</p>
            <div className="mt-6 grid gap-3">
              {[
                "The live terminal stays focused because access is reserved for members.",
                "Your account carries the membership, so returning to the product is frictionless.",
                "Billing stays direct and controllable without leaving the same account path.",
              ].map((item) => (
                <div key={item} className="panel-list-row flex items-start gap-3">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                  <p className="text-[14px] leading-7 text-[#dce7f3]">{item}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="surface-panel p-8 sm:p-10">
            <p className="section-kicker">What happens next</p>
            <div className="mt-6 grid gap-3">
              {nextSteps.map((item) => (
                <div key={item.step} className="panel-list-row grid gap-4 sm:grid-cols-[88px_1fr] sm:items-start">
                  <div className="border border-cyan/14 bg-cyan/[0.06] px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-cyan">
                      Step {item.step}
                    </p>
                  </div>
                  <div>
                    <h3 className="text-[18px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                      {item.title}
                    </h3>
                    <p className="mt-3 text-[14px] leading-7 text-[#8fa6bf]">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
