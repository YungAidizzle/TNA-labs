import { Activity, ArrowRight, CheckCircle2, RefreshCcw, Sparkles } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";
import { isPaidAccessState } from "@/lib/billing/shared";
import { getCurrentAuthContext } from "@/lib/supabase/auth";

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
  const { user, profile } = await getCurrentAuthContext();
  const hasPaidAccess = isPaidAccessState(profile?.access_state);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.18),transparent_62%),rgba(6,11,17,0.92)] text-cyan">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#6e8299]">Billing</p>
            <p className="text-[15px] font-semibold text-[#eef5ff]">Checkout success</p>
          </div>
        </div>

        <div className="surface-panel mt-8 border border-white/[0.08] p-6 sm:p-8 lg:p-10">
          <span className="eyebrow-chip">
            <Sparkles className="h-3.5 w-3.5 text-cyan" />
            Stripe returned successfully
          </span>

          <div className="mt-6 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald" />
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#6e8299]">
              Billing handoff complete
            </p>
          </div>

          <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.05em] text-[#f3f8ff] sm:text-[40px]">
            {hasPaidAccess ? "Access is active." : "Payment returned. Waiting for subscription sync."}
          </h1>

          <p className="mt-4 max-w-[760px] text-[15px] leading-8 text-[#92a7bf]">
            {hasPaidAccess
              ? "Your subscription state is synced and the dashboard routes are unlocked."
              : "Access is granted only after the Stripe webhook updates Supabase. If this page returns before the webhook finishes, refresh after a few seconds and try again."}
          </p>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <div className="metric-card">
              <p className="section-kicker">Account</p>
              <p className="mt-3 text-[14px] text-[#e9f1fb]">{user?.email ?? "Not signed in"}</p>
            </div>
            <div className="metric-card">
              <p className="section-kicker">Access state</p>
              <p className="mt-3 text-[14px] capitalize text-[#e9f1fb]">
                {profile?.access_state ?? "unknown"}
              </p>
            </div>
            <div className="metric-card">
              <p className="section-kicker">Session</p>
              <p className="mt-3 truncate text-[14px] text-[#e9f1fb]">{sessionId ?? "Unavailable"}</p>
            </div>
          </div>

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
              <InteractiveLink
                href="/billing/success"
                pendingLabel="Refreshing access state"
                navigationLabel="Refreshing access state"
                className={buttonClassName({ tone: "primary", size: "lg" })}
              >
                <span className="inline-flex items-center gap-2">
                  Refresh status
                  <RefreshCcw className="h-4 w-4" />
                </span>
              </InteractiveLink>
            )}
            <InteractiveLink
              href="/pricing"
              pendingLabel="Opening pricing"
              navigationLabel="Opening pricing"
              className={buttonClassName({ tone: "secondary", size: "lg" })}
            >
              Back to pricing
            </InteractiveLink>
          </div>
        </div>
      </div>
    </div>
  );
}
