import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";
import {
  formatBillingIntervalLabel,
  getConfiguredBillingPlanSummary,
} from "@/lib/billing/plan";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Narrative Intelligence Platform",
  description:
    "Attentra helps traders and researchers rank emerging narratives, surface linked memecoins, and validate market response from one paid research workflow.",
  path: "/",
});

export default async function Home() {
  const plan = await getConfiguredBillingPlanSummary();

  return (
    <LandingPage
      isAuthenticated={false}
      hasPaidAccess={false}
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
