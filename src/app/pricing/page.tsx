import Link from "next/link";
import { Activity, ArrowRight, BadgeCheck, ShieldCheck } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { getCurrentViewerSubscription } from "@/lib/billing/subscriptions";
import { isPaidAccessState } from "@/lib/billing/shared";
import { hasStripeServerConfig } from "@/lib/stripe/server";

type PricingPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PricingPage({ searchParams }: PricingPageProps) {
  const params = searchParams ? await searchParams : {};
  const error = readQueryValue(params.error);
  const { user, profile } = await getCurrentAuthContext();
  const subscription = await getCurrentViewerSubscription(user?.id);
  const hasPaidAccess = isPaidAccessState(profile?.access_state);
  const stripeConfigured = hasStripeServerConfig();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader
        isAuthenticated={Boolean(user)}
        hasPaidAccess={hasPaidAccess}
      />

      <main className="mx-auto w-full max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.95fr_0.85fr]">
          <section className="surface-panel border border-white/[0.08] p-8">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#6e8299]">
              Paid access
            </p>
            <h1 className="mt-5 max-w-[680px] text-[42px] font-semibold leading-[0.98] tracking-[-0.05em] text-[#f4f8ff]">
              Subscription access gates the live terminal.
            </h1>
            <p className="mt-5 max-w-[720px] text-[15px] leading-7 text-[#92a8c0]">
              The landing page stays public. The execution surface, validation workflows, and future premium routes are reserved for subscribed members.
            </p>

            <div className="mt-8 grid gap-3 md:grid-cols-2">
              {[
                "Live narrative ranking and linked memecoin surface",
                "Server-side access control tied to webhook-synced subscription state",
                "Future billing portal and subscription management ready",
                "Terminal workflow without client-side-only gating",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3 border border-white/[0.07] bg-white/[0.02] p-4">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                  <p className="text-[14px] leading-6 text-[#dde7f3]">{item}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="surface-panel border border-cyan/15 p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Membership</p>
                <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-[#f4f9ff]">
                  Operator Access
                </h2>
              </div>
              <span className="border border-cyan/20 bg-cyan/10 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-cyan">
                Subscription
              </span>
            </div>

            <div className="mt-8 space-y-3 text-[14px] text-[#dde7f3]">
              <p>Paid access to the live dashboard routes</p>
              <p>Webhook-synced subscription state in Supabase</p>
              <p>Checkout flow through Stripe Billing</p>
              <p>Future billing portal compatibility</p>
            </div>

            <div className="mt-8 border border-white/[0.08] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Current access</p>
              <p className="mt-3 text-[15px] capitalize text-[#eef5ff]">
                {profile?.access_state ?? "guest"}
              </p>
              {subscription?.current_period_end ? (
                <p className="mt-2 text-[13px] text-[#8ca2ba]">
                  Period end: {new Date(subscription.current_period_end).toLocaleString()}
                </p>
              ) : null}
            </div>

            {error ? (
              <div className="mt-5 border border-rose/20 bg-rose/10 px-4 py-3 text-[13px] text-[#ff9b9b]">
                {error === "stripe_not_configured" && "Stripe is not configured yet."}
                {error === "checkout_unavailable" && "Checkout session could not be created."}
                {error === "missing_customer" && "A billing customer record was not found for this account."}
              </div>
            ) : null}

            {!stripeConfigured ? (
              <div className="mt-5 border border-amber/20 bg-amber/10 px-4 py-3 text-[13px] text-[#f7c27b]">
                Stripe server env vars are not configured yet.
              </div>
            ) : null}

            <div className="mt-8 flex flex-wrap gap-3">
              {hasPaidAccess ? (
                <Link
                  href="/dashboard"
                  className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
                >
                  Open terminal
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <form action="/api/stripe/checkout" method="post">
                  <button
                    type="submit"
                    disabled={!stripeConfigured}
                    className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff] transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Unlock access
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              )}

              {user && subscription?.stripe_customer_id ? (
                <form action="/api/stripe/portal" method="post">
                  <button
                    type="submit"
                    className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee]"
                  >
                    Manage billing
                  </button>
                </form>
              ) : null}
            </div>

            {!user ? (
              <p className="mt-4 text-[13px] text-[#8ea4bc]">
                You will be prompted to sign in before Checkout if you do not already have an account.
              </p>
            ) : null}

            <div className="mt-10 flex items-center gap-3 border-t border-white/[0.08] pt-6 text-[13px] text-[#8fa5bd]">
              <ShieldCheck className="h-4 w-4 text-cyan" />
              Access unlocks from webhook-synced subscription state, not just from returning from Stripe.
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
