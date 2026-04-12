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
import { isPaidAccessState } from "@/lib/billing/shared";
import {
  hasStripeCheckoutConfig,
  hasStripeServerConfig,
  hasStripeWebhookConfig,
} from "@/lib/stripe/server";
import { getCurrentAuthContext } from "@/lib/supabase/auth";

type PricingPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const includedItems = [
  "Protected operator terminal routes",
  "Stripe Billing checkout and customer portal handoff",
  "Webhook-synced access state stored in Supabase",
  "A public-to-private flow that stays consistent across auth, pricing, and billing",
] as const;

const trustRows = [
  {
    title: "Access integrity",
    description:
      "Membership is unlocked from synced subscription state, not from optimistic client redirects.",
    icon: ShieldCheck,
  },
  {
    title: "Billing control",
    description:
      "Checkout and portal actions route through Stripe so payment state stays within the billing system of record.",
    icon: CreditCard,
  },
  {
    title: "Operator posture",
    description:
      "The page acts like a control surface, not a marketing upsell. State, gating, and next steps are explicit.",
    icon: Workflow,
  },
] as const;

function readQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function resolveErrorMessage(error: string | undefined) {
  if (error === "stripe_not_configured") {
    return "Stripe is not configured yet.";
  }

  if (error === "checkout_unavailable") {
    return "Checkout session could not be created.";
  }

  if (error === "missing_customer") {
    return "A billing customer record was not found for this account.";
  }

  if (error === "stripe_request_failed") {
    return "Stripe rejected the request. Check the server logs and Stripe configuration.";
  }

  return null;
}

export default async function PricingPage({ searchParams }: PricingPageProps) {
  const params = searchParams ? await searchParams : {};
  const error = readQueryValue(params.error);
  const { user, profile } = await getCurrentAuthContext();
  const subscription = await getCurrentViewerSubscription(user?.id);
  const hasPaidAccess = isPaidAccessState(profile?.access_state);
  const stripeServerConfigured = hasStripeServerConfig();
  const stripeWebhookConfigured = hasStripeWebhookConfig();
  const stripeCheckoutConfigured = hasStripeCheckoutConfig();
  const errorMessage = resolveErrorMessage(error);

  const readinessRows = [
    {
      label: "Session",
      value: user ? "Authenticated" : "Guest",
      accent: user ? "text-cyan" : "text-[#94aac2]",
    },
    {
      label: "Checkout",
      value: stripeCheckoutConfigured ? "Ready" : "Unavailable",
      accent: stripeCheckoutConfigured ? "text-emerald" : "text-amber",
    },
    {
      label: "Webhook sync",
      value: stripeWebhookConfigured ? "Ready" : "Required",
      accent: stripeWebhookConfigured ? "text-emerald" : "text-amber",
    },
  ] as const;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader
        isAuthenticated={Boolean(user)}
        hasPaidAccess={hasPaidAccess}
      />

      <main className="mx-auto flex w-full max-w-[1320px] flex-col gap-8 px-4 pb-16 pt-8 sm:px-6 lg:px-8 lg:gap-10 lg:pb-24">
        <section className="grid gap-6 lg:grid-cols-[0.98fr_1.02fr]">
          <div className="surface-panel p-8 sm:p-10 lg:p-12">
            <span className="eyebrow-chip">
              <Sparkles className="h-3.5 w-3.5 text-cyan" />
              Membership surface
            </span>

            <h1 className="mt-8 max-w-[700px] text-[40px] font-semibold leading-[0.98] tracking-[-0.06em] text-[#f6fbff] sm:text-[52px]">
              Paid access is the control layer for the live operator terminal.
            </h1>

            <p className="mt-6 max-w-[700px] text-[16px] leading-8 text-[#9cb1c8]">
              This page is where access state, billing readiness, and next action converge. It is
              built to make the membership boundary clear without dropping into generic SaaS packaging.
            </p>

            <div className="mt-10 grid gap-3">
              {includedItems.map((item) => (
                <div key={item} className="panel-list-row flex items-start gap-3">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                  <p className="text-[14px] leading-7 text-[#dce7f3]">{item}</p>
                </div>
              ))}
            </div>

            <div className="mt-10 grid gap-3 md:grid-cols-3">
              {trustRows.map((row) => (
                <article key={row.title} className="metric-card">
                  <div className="flex h-11 w-11 items-center justify-center border border-white/[0.08] bg-[#08111c] text-cyan">
                    <row.icon className="h-4 w-4" />
                  </div>
                  <p className="mt-5 text-[17px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                    {row.title}
                  </p>
                  <p className="mt-3 text-[14px] leading-7 text-[#8ea4bc]">{row.description}</p>
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
                <p className="section-kicker">Operator Access</p>
                <h2 className="mt-4 text-[32px] font-semibold tracking-[-0.05em] text-[#f4f9ff] sm:text-[38px]">
                  Membership control surface
                </h2>
              </div>
              <span className="eyebrow-chip border-cyan/18 bg-cyan/[0.06] text-[#dff8ff]">
                <CreditCard className="h-3.5 w-3.5 text-cyan" />
                Stripe managed
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
                <p className="section-kicker">Current access</p>
                <p className="mt-3 text-[16px] font-semibold capitalize tracking-[-0.03em] text-[#eef5ff]">
                  {profile?.access_state ?? "guest"}
                </p>
                <p className="mt-3 text-[13px] leading-6 text-[#8ca2ba]">
                  {subscription?.current_period_end
                    ? `Period end: ${new Date(subscription.current_period_end).toLocaleString()}`
                    : "No active billing period recorded yet."}
                </p>
              </div>
              <div className="metric-card">
                <p className="section-kicker">Billing portal</p>
                <p className="mt-3 text-[16px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                  {user && subscription?.stripe_customer_id ? "Available" : "Not yet available"}
                </p>
                <p className="mt-3 text-[13px] leading-6 text-[#8ca2ba]">
                  Manage billing once a Stripe customer record exists for the account.
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
                Stripe server env vars are missing or invalid.
              </div>
            ) : null}

            {stripeServerConfigured && !stripeWebhookConfigured ? (
              <div className="mt-6 border border-amber/20 bg-amber/10 px-4 py-3 text-[13px] text-[#f7c27b]">
                Stripe webhook configuration is missing or invalid. Checkout stays gated because access unlocks only after the webhook syncs subscription state.
              </div>
            ) : null}

            <div className="mt-8 flex flex-wrap gap-3">
              {hasPaidAccess ? (
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
                  pendingLabel="Opening Stripe Checkout"
                  navigationLabel="Opening Stripe Checkout"
                  size="lg"
                  disabled={!stripeCheckoutConfigured}
                  trailingAdornment={<ArrowRight className="h-4 w-4" />}
                >
                  Unlock access
                </ActionButtonForm>
              )}

              {user && subscription?.stripe_customer_id ? (
                <ActionButtonForm
                  action="/api/stripe/portal"
                  pendingLabel="Opening billing portal"
                  navigationLabel="Opening billing portal"
                  tone="secondary"
                  size="lg"
                >
                  Manage billing
                </ActionButtonForm>
              ) : (
                <InteractiveLink
                  href={user ? "/" : "/sign-in"}
                  pendingLabel={user ? "Opening site home" : "Opening sign in"}
                  navigationLabel={user ? "Opening site home" : "Opening sign in"}
                  className={buttonClassName({ tone: "secondary", size: "lg" })}
                >
                  {user ? "Return home" : "Sign in first"}
                </InteractiveLink>
              )}
            </div>

            <div className="mt-6 status-banner flex items-start gap-3 border-cyan/12 bg-cyan/[0.06] text-[#dff1ff]">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
              <span>
                {user
                  ? "Checkout can redirect immediately, but access remains locked until the webhook sync completes."
                  : "You can begin from here, but unauthenticated users are redirected into sign-in before billing continues."}
              </span>
            </div>
          </section>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          {[
            {
              title: "Protected access",
              copy: "Dashboard routes stay unavailable until membership state is confirmed on the server.",
            },
            {
              title: "Clear next actions",
              copy: "The screen always explains whether the next step is sign-in, checkout, portal management, or terminal access.",
            },
            {
              title: "Less dead time",
              copy: "Buttons and route transitions now acknowledge action immediately so the flow never feels inert after click.",
            },
          ].map((item) => (
            <article key={item.title} className="surface-panel p-7">
              <p className="section-kicker">Why it matters</p>
              <h3 className="mt-4 text-[22px] font-semibold tracking-[-0.04em] text-[#eef5ff]">
                {item.title}
              </h3>
              <p className="mt-4 text-[14px] leading-7 text-[#8ea4bc]">{item.copy}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
