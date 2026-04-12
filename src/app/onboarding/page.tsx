import { Activity, ArrowRight, Clock3, Sparkles } from "lucide-react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { buttonClassName } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";
import { isPaidAccessState } from "@/lib/billing/shared";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";

type OnboardingPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const params = searchParams ? await searchParams : {};
  const { user, profile } = await getCurrentAuthContext();
  const mode = readQueryValue(params.mode) ?? "created";
  const email = readQueryValue(params.email) ?? user?.email ?? profile?.email ?? null;
  const hasPaidAccess = isPaidAccessState(profile?.access_state);

  if (!user && !email) {
    redirect("/sign-up");
  }

  const needsEmailConfirmation = mode === "check-email" && !user;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.18),transparent_62%),rgba(6,11,17,0.92)] text-cyan">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#6e8299]">Narrative To Asset</p>
            <p className="text-[15px] font-semibold text-[#eef5ff]">Access setup</p>
          </div>
        </div>

        <div className="surface-panel mt-8 border border-white/[0.08] p-6 sm:p-8 lg:p-10">
          <span className="eyebrow-chip">
            <Sparkles className="h-3.5 w-3.5 text-cyan" />
            Post-signup state
          </span>

          <h1 className="mt-6 text-[34px] font-semibold tracking-[-0.05em] text-[#f3f8ff] sm:text-[40px]">
            {needsEmailConfirmation
              ? "Confirm your email to finish access setup."
              : hasPaidAccess
                ? "Access is active."
                : "Account created. Membership activation is the next step."}
          </h1>
          <p className="mt-4 max-w-[760px] text-[15px] leading-8 text-[#92a7bf]">
            {needsEmailConfirmation
              ? "Your account record is created. Email confirmation is required before sign-in if that setting is enabled in Supabase."
              : hasPaidAccess
                ? "Your subscription state is synced and the paid dashboard routes are available."
                : "The account is ready. Subscription checkout unlocks the dashboard once the Stripe webhook syncs access state back into Supabase."}
          </p>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <div className="metric-card">
              <p className="section-kicker">Account</p>
              <p className="mt-3 text-[14px] text-[#e9f1fb]">{email ?? "Pending email"}</p>
            </div>
            <div className="metric-card">
              <p className="section-kicker">Access state</p>
              <p className="mt-3 text-[14px] capitalize text-[#e9f1fb]">
                {profile?.access_state ?? "pending_setup"}
              </p>
            </div>
            <div className="metric-card">
              <p className="section-kicker">Billing stage</p>
              <p className="mt-3 text-[14px] text-[#e9f1fb]">
                {hasPaidAccess ? "Subscription active" : "Subscription required"}
              </p>
            </div>
          </div>

          <div className="mt-8 status-banner flex items-start gap-3 border-cyan/12 bg-cyan/[0.06] text-[#dbe7f4]">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
            <span>
              Access unlocks from webhook-synced subscription state, not just from account creation or returning from Checkout.
            </span>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {hasPaidAccess ? (
              <InteractiveLink
                href="/dashboard"
                pendingLabel="Opening platform"
                navigationLabel="Opening platform"
                className={buttonClassName({ tone: "primary", size: "lg" })}
              >
                <span className="inline-flex items-center gap-2">
                  Continue to platform
                  <ArrowRight className="h-4 w-4" />
                </span>
              </InteractiveLink>
            ) : (
              <InteractiveLink
                href={user ? "/pricing" : "/sign-in"}
                pendingLabel={user ? "Opening pricing" : "Opening sign in"}
                navigationLabel={user ? "Opening pricing" : "Opening sign in"}
                className={buttonClassName({ tone: "primary", size: "lg" })}
              >
                <span className="inline-flex items-center gap-2">
                  {user ? "View pricing" : "Go to sign in"}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </InteractiveLink>
            )}
            <InteractiveLink
              href="/"
              pendingLabel="Returning home"
              navigationLabel="Returning home"
              className={buttonClassName({ tone: "secondary", size: "lg" })}
            >
              Return home
            </InteractiveLink>
            {user ? <SignOutButton /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
