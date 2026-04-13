import Link from "next/link";
import { Activity, ArrowRight, CheckCircle2, RefreshCcw } from "lucide-react";
import { confirmCheckoutSessionById } from "@/lib/billing/subscriptions";
import { isPaidAccessState } from "@/lib/billing/shared";
import { getCurrentAuthContext, getCurrentProfile } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[980px] flex-col px-4 py-8 sm:px-6 lg:px-8">
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
            <CheckCircle2 className="h-5 w-5 text-emerald" />
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#6e8299]">Stripe returned successfully</p>
          </div>

          <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.05em] text-[#f3f8ff]">
            {hasPaidAccess ? "Access is active." : "Payment returned. Access is still reconciling."}
          </h1>

          <p className="mt-4 max-w-[720px] text-[15px] leading-7 text-[#92a7bf]">
            {hasPaidAccess
              ? "Your subscription state is synced and the dashboard routes are unlocked."
              : "This page now attempts an immediate Stripe reconciliation using the Checkout session. If the webhook is still catching up, refresh once and inspect the billing logs."}
          </p>

          {confirmationError ? (
            <div className="mt-6 border border-amber/20 bg-amber/10 px-4 py-3 text-[13px] text-[#f7c27b]">
              {confirmationError}
            </div>
          ) : null}

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="border border-white/[0.07] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Account</p>
              <p className="mt-3 text-[14px] text-[#e9f1fb]">{user?.email ?? "Not signed in"}</p>
            </div>
            <div className="border border-white/[0.07] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Access state</p>
              <p className="mt-3 text-[14px] capitalize text-[#e9f1fb]">{profile?.access_state ?? "unknown"}</p>
            </div>
            <div className="border border-white/[0.07] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Session</p>
              <p className="mt-3 truncate text-[14px] text-[#e9f1fb]">{sessionId ?? "Unavailable"}</p>
            </div>
          </div>

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
              <Link
                href={sessionId ? `/billing/success?session_id=${encodeURIComponent(sessionId)}` : "/billing/success"}
                className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
              >
                Refresh status
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
        </div>
      </div>
    </div>
  );
}
