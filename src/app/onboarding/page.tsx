import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, ArrowRight, Clock3 } from "lucide-react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { isPaidAccessState } from "@/lib/billing/shared";

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
      <div className="mx-auto flex w-full max-w-[980px] flex-col px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.16),transparent_62%),rgba(6,11,17,0.92)] text-cyan">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#6e8299]">Narrative To Asset</p>
            <p className="text-[15px] font-semibold text-[#eef5ff]">Access setup</p>
          </div>
        </div>

        <div className="surface-panel mt-8 border border-white/[0.08] p-6 sm:p-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#6e8299]">
            Post-signup state
          </p>
          <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.05em] text-[#f3f8ff]">
            {needsEmailConfirmation
              ? "Confirm your email to finish access setup."
              : hasPaidAccess
                ? "Access is active."
                : "Account created. Membership activation is the next step."}
          </h1>
          <p className="mt-4 max-w-[720px] text-[15px] leading-7 text-[#92a7bf]">
            {needsEmailConfirmation
              ? "Your account record is created. Email confirmation is required before sign-in if that setting is enabled in Supabase."
              : hasPaidAccess
                ? "Your subscription state is synced and the paid dashboard routes are available."
                : "The account is ready. Subscription checkout unlocks the dashboard once Stripe reconciliation updates access state back into Supabase."}
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="border border-white/[0.07] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Account</p>
              <p className="mt-3 text-[14px] text-[#e9f1fb]">{email ?? "Pending email"}</p>
            </div>
            <div className="border border-white/[0.07] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Access state</p>
              <p className="mt-3 text-[14px] capitalize text-[#e9f1fb]">{profile?.access_state ?? "pending_setup"}</p>
            </div>
            <div className="border border-white/[0.07] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Billing stage</p>
              <p className="mt-3 text-[14px] text-[#e9f1fb]">
                {hasPaidAccess ? "Subscription active" : "Subscription required"}
              </p>
            </div>
          </div>

          <div className="mt-8 border border-cyan/12 bg-cyan/[0.08] p-4 text-[14px] leading-7 text-[#dbe7f4]">
            <div className="flex items-center gap-3">
              <Clock3 className="h-4 w-4 text-cyan" />
              <span>Access unlocks from Stripe-synced subscription state, with Checkout confirmation covering delayed webhooks.</span>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {hasPaidAccess ? (
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
              >
                Continue to platform
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <Link
                href={user ? "/pricing" : "/sign-in"}
                className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
              >
                {user ? "View pricing" : "Go to sign in"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
            <Link
              href="/"
              className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee]"
            >
              Return home
            </Link>
            {user ? <SignOutButton /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
