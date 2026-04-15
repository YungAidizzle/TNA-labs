import Link from "next/link";
import { getConfiguredBillingPlanSummary, formatBillingIntervalLabel } from "@/lib/billing/plan";
import { getCurrentViewerSubscription } from "@/lib/billing/subscriptions";
import { BRAND_ACCESS_NAME } from "@/lib/brand";
import {
  LEGAL_CONTACT,
  getSupportContactHref,
  getSupportContactLabel,
} from "@/lib/legal/contact-details";
import { getCurrentPolicyAcceptanceMap } from "@/lib/legal/policy-acceptances";
import {
  BILLING_VERSION,
  PRIVACY_VERSION,
  RISK_VERSION,
  TERMS_VERSION,
} from "@/lib/legal/policy-versions";
import { getCurrentAuthContext } from "@/lib/supabase/auth";

function formatPeriodEnd(value: string | null | undefined) {
  if (!value) {
    return "Not available";
  }

  return new Date(value).toLocaleString();
}

export default async function SettingsPage() {
  const { user, profile } = await getCurrentAuthContext();
  const subscription = await getCurrentViewerSubscription(user?.id);
  const plan = await getConfiguredBillingPlanSummary();
  const acceptanceMap = user ? await getCurrentPolicyAcceptanceMap(user.id) : null;
  const billingInterval = formatBillingIntervalLabel(plan);

  return (
    <div className="grid gap-4">
      <section className="surface-panel border border-white/[0.08] p-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[#6f86a1]">Account and billing</p>
        <h1 className="mt-3 text-[30px] font-semibold tracking-[-0.04em] text-[#eef5ff]">Settings</h1>
        <p className="mt-4 max-w-[760px] text-[14px] leading-7 text-[#94a9c1]">
          Manage billing visibility, review current policy versions, and keep the account aligned with the
          product&apos;s research-only positioning.
        </p>
      </section>

      <section className="surface-panel border border-white/[0.08] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Subscription</p>
            <h2 className="mt-3 text-[24px] font-semibold tracking-[-0.04em] text-[#eef5ff]">
              {plan?.productName ?? BRAND_ACCESS_NAME}
            </h2>
          </div>
          <div className="border border-white/[0.08] bg-[#07101a] px-4 py-3 text-right">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Renewal</p>
            <p className="mt-1 text-[14px] text-[#eef5ff]">{formatPeriodEnd(subscription?.current_period_end)}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="border border-white/[0.08] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Current plan</p>
              <p className="mt-2 text-[16px] font-semibold text-[#eef5ff]">
              {plan?.displayPrice ?? "Active subscription pricing"}
              </p>
              <p className="mt-1 text-[13px] capitalize text-[#8ea4bc]">{billingInterval}</p>
            </div>
          <div className="border border-white/[0.08] bg-[#07101a] p-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Access state</p>
            <p className="mt-2 text-[16px] font-semibold capitalize text-[#eef5ff]">
              {profile?.access_state ?? "unknown"}
            </p>
            <p className="mt-1 text-[13px] text-[#8ea4bc]">
              Cancellation remains self-serve through Stripe.
            </p>
          </div>
          <div className="border border-white/[0.08] bg-[#07101a] p-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Support</p>
            {LEGAL_CONTACT.serviceAddress ? (
              <p className="mt-2 text-[13px] text-[#8ea4bc]">{LEGAL_CONTACT.serviceAddress}</p>
            ) : null}
            {LEGAL_CONTACT.supportEmail ? (
              <p className="mt-2 text-[13px] text-[#8ea4bc]">
                <a className="text-cyan hover:text-[#b8f2ff]" href={getSupportContactHref("support") ?? undefined}>
                  {getSupportContactLabel("support")}
                </a>
              </p>
            ) : null}
            <p className="mt-2 text-[13px] text-[#8ea4bc]">
              Billing management and cancellation stay available through the Stripe customer portal.
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <form action="/api/stripe/portal" method="post">
            <button
              type="submit"
              className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee]"
            >
              Manage Billing
            </button>
          </form>
        </div>
      </section>

      <section className="surface-panel border border-white/[0.08] p-6">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Legal status</p>
        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Terms", version: TERMS_VERSION, accepted: acceptanceMap?.hasCurrentTerms ?? false, href: "/terms" },
            { label: "Privacy", version: PRIVACY_VERSION, accepted: acceptanceMap?.hasCurrentPrivacy ?? false, href: "/privacy" },
            { label: "Risk", version: RISK_VERSION, accepted: acceptanceMap?.hasCurrentRisk ?? false, href: "/risk-disclosure" },
            { label: "Billing", version: BILLING_VERSION, accepted: acceptanceMap?.hasCurrentBilling ?? false, href: "/refund-policy" },
          ].map((item) => (
            <div key={item.label} className="border border-white/[0.08] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">{item.label}</p>
              <p className="mt-2 font-mono text-[13px] text-[#eef5ff]">{item.version}</p>
              <p className="mt-2 text-[13px] text-[#8ea4bc]">
                {item.accepted ? "Current version acknowledged." : "Current version not yet acknowledged."}
              </p>
              <Link href={item.href} className="mt-3 inline-block text-[12px] uppercase tracking-[0.14em] text-cyan hover:text-[#b8f2ff]">
                Open document
              </Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
