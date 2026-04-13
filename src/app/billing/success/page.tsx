import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowRight, CheckCircle2, RefreshCcw } from "lucide-react";
import { confirmCheckoutSessionById } from "@/lib/billing/subscriptions";
import { isPaidAccessState } from "@/lib/billing/shared";
import { buildPageMetadata } from "@/lib/metadata";
import {
  LEGAL_CONTACT,
  getSupportContactHref,
  getSupportContactLabel,
} from "@/lib/legal/contact-details";
import { getCurrentAuthContext, getCurrentProfile } from "@/lib/supabase/auth";
import { resolveSafeRedirectTarget } from "@/lib/supabase/shared";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = buildPageMetadata({
  title: "Billing Success",
  description:
    "Confirm Attentra checkout completion, finish account activation, and continue into the paid product after Stripe returns.",
  path: "/billing/success",
  robots: {
    index: false,
    follow: false,
  },
});

type BillingSuccessPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BillingSuccessPage({
  searchParams,
}: BillingSuccessPageProps) {
  const params = searchParams ? await searchParams : {};
  const sessionId = readQueryValue(params.session_id);
  const next = resolveSafeRedirectTarget(readQueryValue(params.next), "/dashboard");
  const authContext = await getCurrentAuthContext();
  const user = authContext.user;
  let profile = authContext.profile;
  let confirmationError: string | null = null;

  if (user && sessionId) {
    try {
      await confirmCheckoutSessionById(sessionId, {
        authenticatedUserId: user.id,
        expectedEmail: user.email ?? profile?.email ?? null,
        source: "billing_success_page",
      });
      profile = await getCurrentProfile(user);
    } catch (error) {
      confirmationError = error instanceof Error ? error.message : "Checkout confirmation failed.";
      console.error("[billing-success] checkout reconciliation failed", {
        sessionId,
        userId: user.id,
        error: confirmationError,
      });
    }
  }

  const hasPaidAccess = isPaidAccessState(profile?.access_state);
  const paymentReturnedButNeedsSignIn = !user && Boolean(sessionId);
  const accessReconciling = Boolean(user && sessionId && !hasPaidAccess && !confirmationError);
  const unknownState = Boolean(confirmationError) || Boolean(user && !sessionId && !hasPaidAccess);
  const billingSupportHref = getSupportContactHref("billing");
  const billingSupportLabel = getSupportContactLabel("billing");
  const signInReturnHref = sessionId
    ? `/sign-in?next=${encodeURIComponent(`/billing/success?session_id=${encodeURIComponent(sessionId)}&next=${encodeURIComponent(next)}`)}`
    : `/sign-in?next=${encodeURIComponent(next)}`;
  const refreshHref = sessionId
    ? `/billing/success?session_id=${encodeURIComponent(sessionId)}&next=${encodeURIComponent(next)}`
    : `/billing/success?next=${encodeURIComponent(next)}`;

  const stateCopy = hasPaidAccess
    ? {
        title: "Access is active.",
        description:
          "Your payment is confirmed and the subscription is synced to this account. You can continue straight into the live product.",
        nextStep: "Open the terminal and continue your research workflow.",
      }
    : paymentReturnedButNeedsSignIn
      ? {
          title: "Payment returned. Sign in to finish activation.",
          description:
            "Stripe returned successfully, but this browser is not signed in. Sign in with the account email used at checkout so we can attach the subscription and unlock access.",
          nextStep: "Sign in, then this page will retry subscription confirmation.",
        }
      : accessReconciling
        ? {
            title: "Payment received. Access is still activating.",
            description:
              "The checkout completed successfully. We are still reconciling the subscription state to this account, which can take a moment if the webhook arrives after the browser returns.",
            nextStep: "Refresh once in a few seconds. Access should unlock as soon as reconciliation completes.",
          }
        : {
            title: "We could not confirm access yet.",
            description:
              "The billing return did not produce an active access state in this session. Retry once, then contact billing support if the charge has gone through without access.",
            nextStep: "Retry the confirmation page or return to pricing to review the subscription state.",
          };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[980px] flex-col justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.16),transparent_62%),rgba(6,11,17,0.92)] text-cyan">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#6e8299]">Billing</p>
            <p className="text-[15px] font-semibold text-[#eef5ff]">Checkout success</p>
          </div>
        </div>

        <div className="surface-panel mt-8 border border-white/[0.08] p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <CheckCircle2 className={`h-5 w-5 ${hasPaidAccess ? "text-emerald" : "text-cyan"}`} />
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#6e8299]">
              Billing return
            </p>
          </div>

          <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.05em] text-[#f3f8ff]">
            {stateCopy.title}
          </h1>

          <p className="mt-4 max-w-[720px] text-[15px] leading-7 text-[#92a7bf]">
            {stateCopy.description}
          </p>

          {confirmationError ? (
            <div className="mt-6 border border-amber/20 bg-amber/10 px-4 py-3 text-[13px] text-[#f7c27b]">
              We could not confirm the subscription immediately. Retry once, then contact billing support if access still does not unlock.
            </div>
          ) : null}

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="border border-white/[0.07] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Account</p>
              <p className="mt-3 text-[14px] text-[#e9f1fb]">{user?.email ?? "Sign in required"}</p>
            </div>
            <div className="border border-white/[0.07] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Membership</p>
              <p className="mt-3 text-[14px] capitalize text-[#e9f1fb]">
                {hasPaidAccess ? "Active" : profile?.access_state?.replace(/_/g, " ") ?? "Activation pending"}
              </p>
            </div>
            <div className="border border-white/[0.07] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Next step</p>
              <p className="mt-3 text-[14px] text-[#e9f1fb]">{stateCopy.nextStep}</p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {hasPaidAccess ? (
              <Link
                href={next}
                className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
              >
                Open terminal
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : paymentReturnedButNeedsSignIn ? (
              <Link
                href={signInReturnHref}
                className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
              >
                Sign in to activate
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <Link
                href={refreshHref}
                className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
              >
                {accessReconciling ? "Refresh status" : "Retry confirmation"}
                <RefreshCcw className="h-4 w-4" />
              </Link>
            )}
            <Link
              href="/pricing"
              className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee]"
            >
              Back to pricing
            </Link>
          </div>

          <div className="mt-6 border-t border-white/[0.08] pt-6 text-[13px] leading-7 text-[#8ea4bc]">
            {LEGAL_CONTACT.billingSupportEmail ? (
              <p>
                Billing support:{" "}
                <a className="text-cyan hover:text-[#b8f2ff]" href={billingSupportHref ?? undefined}>
                  {billingSupportLabel}
                </a>
              </p>
            ) : (
              <p>Billing support remains available through the Stripe customer portal and your account.</p>
            )}
            {unknownState && sessionId ? (
              <p className="text-[#7388a2]">Reference: {sessionId}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
