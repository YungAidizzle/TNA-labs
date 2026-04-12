import Link from "next/link";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { getCurrentViewerSubscription } from "@/lib/billing/subscriptions";
import { isPaidAccessState } from "@/lib/billing/shared";
import { SignOutButton } from "@/components/auth/sign-out-button";

export default async function DashboardPage() {
  const { user, profile } = await getCurrentAuthContext();
  const subscription = await getCurrentViewerSubscription(user?.id);
  const hasPaidAccess = isPaidAccessState(profile?.access_state);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-[960px] flex-col justify-center gap-8 px-4 py-16 sm:px-6 lg:px-8">
        <div className="surface-panel border border-white/[0.08] p-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#6e8299]">
            Protected route
          </p>
          <h1 className="mt-4 text-[36px] font-semibold tracking-[-0.05em] text-[#f4f8ff]">
            Access state: {profile?.access_state ?? "unknown"}
          </h1>
          <p className="mt-4 max-w-[720px] text-[15px] leading-7 text-[#92a8c0]">
            This placeholder confirms the Supabase session and Stripe-backed access state are
            working. The full dashboard surface is intentionally excluded from this branch.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="border border-white/[0.07] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">User</p>
              <p className="mt-3 text-[14px] text-[#e9f1fb]">{user?.email ?? "Unavailable"}</p>
            </div>
            <div className="border border-white/[0.07] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Paid access</p>
              <p className="mt-3 text-[14px] text-[#e9f1fb]">{hasPaidAccess ? "Active" : "Inactive"}</p>
            </div>
            <div className="border border-white/[0.07] bg-[#07101a] p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Stripe customer</p>
              <p className="mt-3 break-all text-[14px] text-[#e9f1fb]">
                {subscription?.stripe_customer_id ?? profile?.stripe_customer_id ?? "Missing"}
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/pricing"
              className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee]"
            >
              Back to pricing
            </Link>
            {subscription?.stripe_customer_id ? (
              <form action="/api/stripe/portal" method="post">
                <button
                  type="submit"
                  className="inline-flex h-11 items-center border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
                >
                  Manage billing
                </button>
              </form>
            ) : null}
            <SignOutButton />
          </div>
        </div>
      </section>
    </main>
  );
}
