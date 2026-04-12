import Link from "next/link";
import { ArrowRight, BadgeCheck, ShieldCheck } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { BRAND_ACCESS_NAME, BRAND_NAME } from "@/lib/brand";
import { getCurrentViewerSubscription } from "@/lib/billing/subscriptions";
import { formatBillingIntervalLabel, getConfiguredBillingPlanSummary } from "@/lib/billing/plan";
import { isPaidAccessState } from "@/lib/billing/shared";
import { LEGAL_CONTACT } from "@/lib/legal/contact-details";
import { SHORT_MARKETING_DISCLAIMER } from "@/lib/legal/disclaimers";
import { BILLING_VERSION, PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/policy-versions";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import {
  hasStripeCheckoutConfig,
  hasStripeServerConfig,
  hasStripeWebhookConfig,
} from "@/lib/stripe/server";

type PricingPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatPeriodEnd(value: string | null | undefined) {
  if (!value) {
    return "Not available";
  }

  return new Date(value).toLocaleString();
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
  const plan = await getConfiguredBillingPlanSummary();
  const billingInterval = formatBillingIntervalLabel(plan);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader isAuthenticated={Boolean(user)} hasPaidAccess={hasPaidAccess} />

      <main className="mx-auto w-full max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.95fr_0.85fr]">
          <section className="surface-panel border border-white/[0.08] p-8">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#6e8299]">
              Paid research access
            </p>
            <h1 className="mt-5 max-w-[680px] text-[42px] font-semibold leading-[0.98] tracking-[-0.05em] text-[#f4f8ff]">
              Subscription access for {BRAND_NAME}.
            </h1>
            <p className="mt-5 max-w-[720px] text-[15px] leading-7 text-[#92a8c0]">
              The public site stays open. Paid access covers the {BRAND_NAME} platform, correlated asset
              views, and market context workflows for traders and researchers who want structured information
              without execution tooling.
            </p>

            <div className="mt-8 grid gap-3 md:grid-cols-2">
              {[
                "Narrative monitoring, correlated assets, and market context in one subscription",
                "Research software only. No brokerage, custody, trade execution, or managed accounts",
                "Server-side access control tied to Stripe-synced subscription status",
                "Self-serve billing management and cancellation through Stripe",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3 border border-white/[0.07] bg-white/[0.02] p-4">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                  <p className="text-[14px] leading-6 text-[#dde7f3]">{item}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 border border-amber/18 bg-amber/10 px-4 py-4 text-[14px] leading-7 text-[#e7d1ae]">
              {SHORT_MARKETING_DISCLAIMER}
            </div>
          </section>

          <section className="surface-panel border border-cyan/15 p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Membership</p>
                <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-[#f4f9ff]">
                  {plan?.productName ?? BRAND_ACCESS_NAME}
                </h2>
              </div>
              <span className="border border-cyan/20 bg-cyan/10 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-cyan">
                Subscription
              </span>
            </div>

            <div className="mt-8 grid gap-4 border border-white/[0.08] bg-[#07101a] p-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Price</p>
                <p className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-[#eef5ff]">
                  {plan?.displayPrice ?? "Configured in Stripe"}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Billing interval</p>
                <p className="mt-3 text-[18px] font-semibold text-[#eef5ff] capitalize">{billingInterval}</p>
                <p className="mt-2 text-[13px] text-[#8ea4bc]">
                  Auto-renews until cancelled.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-3 border border-white/[0.08] bg-[#07101a] p-4 text-[14px] leading-7 text-[#dde7f3]">
              <p>Cancellation: self-serve in the billing portal.</p>
              <p>Refunds: generally not prorated for unused time, subject to the Refund Policy and mandatory consumer law.</p>
              <p>Access starts promptly after successful payment and subscription sync.</p>
              <p>Nature of service: informational research software only, not personal financial advice.</p>
            </div>

            <div className="mt-6 flex flex-wrap gap-4 text-[12px] font-medium uppercase tracking-[0.16em] text-[#99aec5]">
              <Link href="/terms" className="hover:text-[#eef5ff]">Terms</Link>
              <Link href="/privacy" className="hover:text-[#eef5ff]">Privacy</Link>
              <Link href="/risk-disclosure" className="hover:text-[#eef5ff]">Risk Disclosure</Link>
              <Link href="/refund-policy" className="hover:text-[#eef5ff]">Refund Policy</Link>
            </div>

            <div className="mt-8 border border-white/[0.08] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Current access</p>
              <p className="mt-3 text-[15px] capitalize text-[#eef5ff]">{profile?.access_state ?? "guest"}</p>
              <p className="mt-2 text-[13px] text-[#8ca2ba]">
                Current period end: {formatPeriodEnd(subscription?.current_period_end)}
              </p>
              {subscription?.cancel_at_period_end ? (
                <p className="mt-2 text-[13px] text-amber">
                  Cancellation is already scheduled for the end of the current period.
                </p>
              ) : null}
            </div>

            {error ? (
              <div className="mt-5 border border-rose/20 bg-rose/10 px-4 py-3 text-[13px] text-[#ffb0b0]">
                {error === "stripe_not_configured" && "Stripe is not configured yet."}
                {error === "checkout_unavailable" && "Checkout session could not be created."}
                {error === "missing_customer" && "A billing customer record was not found for this account."}
                {error === "stripe_request_failed" && "Stripe rejected the request. Check the server logs and Stripe configuration."}
                {error === "checkout_consent_required" &&
                  "You must accept the legal and billing disclosures before starting checkout."}
              </div>
            ) : null}

            {!stripeServerConfigured ? (
              <div className="mt-5 border border-amber/20 bg-amber/10 px-4 py-3 text-[13px] text-[#f7c27b]">
                Stripe server env vars are missing or invalid.
              </div>
            ) : null}

            {stripeServerConfigured && !stripeWebhookConfigured ? (
              <div className="mt-5 border border-amber/20 bg-amber/10 px-4 py-3 text-[13px] text-[#f7c27b]">
                Stripe webhook configuration is missing or invalid. Checkout stays disabled because access unlocks only after the subscription state sync completes.
              </div>
            ) : null}

            {hasPaidAccess ? (
              <div className="mt-8 space-y-4">
                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/dashboard"
                    className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
                  >
                    Open {BRAND_NAME}
                    <ArrowRight className="h-4 w-4" />
                  </Link>

                  {user && subscription?.stripe_customer_id ? (
                    <>
                      <form action="/api/stripe/portal" method="post">
                        <button
                          type="submit"
                          className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee]"
                        >
                          Manage billing
                        </button>
                      </form>
                      <form action="/api/stripe/portal" method="post">
                        <button
                          type="submit"
                          className="inline-flex h-11 items-center border border-rose/20 bg-rose/10 px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#ffb0b0]"
                        >
                          Cancel subscription
                        </button>
                      </form>
                    </>
                  ) : null}
                </div>

                <p className="text-[13px] text-[#8fa5bd]">
                  Cancellation is handled through the Stripe customer portal. Billing support:{" "}
                  <a className="text-cyan hover:text-[#b8f2ff]" href={`mailto:${LEGAL_CONTACT.billingSupportEmail}`}>
                    {LEGAL_CONTACT.billingSupportEmail}
                  </a>
                </p>
              </div>
            ) : user ? (
              <div className="mt-8 space-y-4">
                <form action="/api/stripe/checkout" method="post" className="space-y-4">
                  <label className="flex items-start gap-3 border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[13px] leading-6 text-[#9ab0c8]">
                    <input type="checkbox" name="accept_terms_privacy" required className="mt-1 h-4 w-4 shrink-0 border border-white/[0.16] bg-[#07101a]" />
                    <span>
                      I have read and agree to the{" "}
                      <Link href="/terms" className="text-cyan hover:text-[#b8f2ff]">Terms of Service</Link>
                      {" "}and{" "}
                      <Link href="/privacy" className="text-cyan hover:text-[#b8f2ff]">Privacy Policy</Link>.
                      Current versions: {TERMS_VERSION} and {PRIVACY_VERSION}.
                    </span>
                  </label>

                  <label className="flex items-start gap-3 border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[13px] leading-6 text-[#9ab0c8]">
                    <input type="checkbox" name="accept_billing_disclosure" required className="mt-1 h-4 w-4 shrink-0 border border-white/[0.16] bg-[#07101a]" />
                    <span>
                      I understand this is a recurring {billingInterval.toLowerCase()} subscription, cancellation is self-serve through the billing portal, refunds are governed by the{" "}
                      <Link href="/refund-policy" className="text-cyan hover:text-[#b8f2ff]">Refund Policy</Link>
                      {" "}and mandatory consumer law, access starts immediately after payment, and the service is informational only and not personal financial advice. Billing disclosure version: {BILLING_VERSION}. Please review the{" "}
                      <Link href="/risk-disclosure" className="text-cyan hover:text-[#b8f2ff]">Risk Disclosure</Link>.
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={!stripeCheckoutConfigured}
                    className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff] transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Start subscription
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>

                <p className="text-[13px] text-[#8ea4bc]">
                  Billing support:{" "}
                  <a className="text-cyan hover:text-[#b8f2ff]" href={`mailto:${LEGAL_CONTACT.billingSupportEmail}`}>
                    {LEGAL_CONTACT.billingSupportEmail}
                  </a>
                </p>
              </div>
            ) : (
              <div className="mt-8 space-y-4">
                <p className="text-[13px] text-[#8ea4bc]">
                  Sign in or create an account before payment. You will be asked to accept the legal and billing disclosures before checkout starts.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/sign-in"
                    className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee]"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/sign-up"
                    className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
                  >
                    Create account
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            )}

            <div className="mt-10 flex items-center gap-3 border-t border-white/[0.08] pt-6 text-[13px] text-[#8fa5bd]">
              <ShieldCheck className="h-4 w-4 text-cyan" />
              Access unlocks from webhook-synced subscription state. Research software only. Not personal financial advice.
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
