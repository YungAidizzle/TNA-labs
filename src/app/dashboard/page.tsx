import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ActionButtonForm } from "@/components/ui/action-button-form";
import { buttonClassName } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";
import { getCurrentViewerSubscription } from "@/lib/billing/subscriptions";
import { hasDashboardAccessState, isPaidAccessState } from "@/lib/billing/shared";
import { getCurrentAuthContext } from "@/lib/supabase/auth";

export default async function DashboardPage() {
  const { user, profile } = await getCurrentAuthContext();
  const subscription = await getCurrentViewerSubscription(user?.id);
  const hasDashboardAccess = hasDashboardAccessState(profile?.access_state);
  const hasSettledAccess = isPaidAccessState(profile?.access_state);
  const isPendingAccess = profile?.access_state === "pending";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-[1040px] flex-col justify-center gap-8 px-4 py-16 sm:px-6 lg:px-8">
        <div className="surface-panel panel-glow-cyan border border-white/[0.08] p-8 lg:p-10">
          <span className="eyebrow-chip">
            <Sparkles className="h-3.5 w-3.5 text-cyan" />
            Protected route
          </span>

          <h1 className="mt-6 text-[36px] font-semibold tracking-[-0.05em] text-[#f4f8ff] sm:text-[44px]">
            Access state: {profile?.access_state ?? "unknown"}
          </h1>
          <p className="mt-4 max-w-[760px] text-[15px] leading-8 text-[#92a8c0]">
            This placeholder confirms the Supabase session and Stripe-backed access state are working.
            The full dashboard surface is intentionally excluded from this branch, but the protected
            route now matches the public system language.
          </p>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <div className="metric-card">
              <p className="section-kicker">User</p>
              <p className="mt-3 text-[14px] text-[#e9f1fb]">{user?.email ?? "Unavailable"}</p>
            </div>
            <div className="metric-card">
              <p className="section-kicker">Dashboard access</p>
              <p className="mt-3 text-[14px] text-[#e9f1fb]">
                {hasDashboardAccess
                  ? isPendingAccess
                    ? "Pending"
                    : "Active"
                  : "Inactive"}
              </p>
            </div>
            <div className="metric-card">
              <p className="section-kicker">Stripe customer</p>
              <p className="mt-3 break-all text-[14px] text-[#e9f1fb]">
                {subscription?.stripe_customer_id ?? profile?.stripe_customer_id ?? "Missing"}
              </p>
            </div>
          </div>

          {isPendingAccess ? (
            <div className="mt-8 status-banner flex items-start gap-3 border-amber/20 bg-amber/10 text-[#f7d4a1]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
              <span>
                Your payment is processing. Access is available while billing finalizes, and the
                state will update automatically if Stripe confirms or rejects the payment.
              </span>
            </div>
          ) : (
            <div className="mt-8 status-banner flex items-start gap-3 border-cyan/12 bg-cyan/[0.06] text-[#dbe7f4]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
              <span>
                {hasSettledAccess
                  ? "Membership state is being enforced at the route level, not only in the UI."
                  : "Dashboard access will close automatically if billing becomes invalid."}
              </span>
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <InteractiveLink
              href="/pricing"
              pendingLabel="Opening pricing"
              navigationLabel="Opening pricing"
              className={buttonClassName({ tone: "secondary", size: "lg" })}
            >
              Back to pricing
            </InteractiveLink>

            {subscription?.stripe_customer_id ? (
              <ActionButtonForm
                action="/api/stripe/portal"
                pendingLabel="Opening billing portal"
                navigationLabel="Opening billing portal"
                size="lg"
                trailingAdornment={<ArrowRight className="h-4 w-4" />}
              >
                Manage billing
              </ActionButtonForm>
            ) : null}

            <SignOutButton />
          </div>
        </div>
      </section>
    </main>
  );
}
