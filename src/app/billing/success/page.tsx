import { Activity, Sparkles } from "lucide-react";
import { CheckoutSuccessState } from "@/components/billing/checkout-success-state";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { hasDashboardAccessState } from "@/lib/billing/shared";

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
  const sessionId = readQueryValue(params.session_id) ?? null;
  const { user, profile } = await getCurrentAuthContext();
  const hasDashboardAccess = hasDashboardAccessState(profile?.access_state);

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

        <div className="mt-8">
          <span className="eyebrow-chip">
            <Sparkles className="h-3.5 w-3.5 text-cyan" />
            Stripe returned successfully
          </span>
        </div>

        <CheckoutSuccessState
          sessionId={sessionId}
          initialHasPaidAccess={hasDashboardAccess}
          initialAccessState={profile?.access_state}
          userEmail={user?.email ?? profile?.email ?? null}
        />
      </div>
    </div>
  );
}
