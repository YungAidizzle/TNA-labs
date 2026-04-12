import Link from "next/link";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { isPaidAccessState } from "@/lib/billing/shared";

export default async function HomePage() {
  const { user, profile } = await getCurrentAuthContext();
  const hasPaidAccess = isPaidAccessState(profile?.access_state);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-[960px] flex-col justify-center gap-8 px-4 py-16 sm:px-6 lg:px-8">
        <div className="surface-panel border border-white/[0.08] p-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#6e8299]">
            Billing surface
          </p>
          <h1 className="mt-4 text-[40px] font-semibold tracking-[-0.05em] text-[#f4f8ff]">
            Stripe checkout is isolated on this branch.
          </h1>
          <p className="mt-4 max-w-[720px] text-[15px] leading-7 text-[#92a8c0]">
            This branch contains only the auth, pricing, Stripe API routes, and webhook-backed
            subscription sync needed to verify the checkout flow.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={hasPaidAccess ? "/dashboard" : "/pricing"}
              className="inline-flex h-11 items-center border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
            >
              {hasPaidAccess ? "Open dashboard" : "Open pricing"}
            </Link>
            {!user ? (
              <Link
                href="/sign-in"
                className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee]"
              >
                Sign in
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
