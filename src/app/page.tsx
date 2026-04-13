import { LandingPage } from "@/components/marketing/landing-page";
import {
  formatBillingIntervalLabel,
  getConfiguredBillingPlanSummary,
} from "@/lib/billing/plan";
import { getCurrentAuthContext } from "@/lib/supabase/auth";
import { isPaidAccessState } from "@/lib/billing/shared";

export default async function Home() {
  const [{ user, profile }, plan] = await Promise.all([
    getCurrentAuthContext(),
    getConfiguredBillingPlanSummary(),
  ]);

  return (
    <LandingPage
      isAuthenticated={Boolean(user)}
      hasPaidAccess={isPaidAccessState(profile?.access_state)}
      pricing={
        plan
          ? {
              productName: plan.productName,
              displayPrice: plan.displayPrice,
              billingInterval: formatBillingIntervalLabel(plan),
            }
          : null
      }
    />
  );
}
