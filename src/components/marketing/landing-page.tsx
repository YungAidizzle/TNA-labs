import {
  DesktopLandingFaq,
  DesktopLandingHero,
  DesktopLandingPricing,
  DesktopLandingProduct,
  DesktopLandingProof,
  DesktopLandingWorkflow,
} from "@/components/marketing/landing-page-desktop";
import {
  MobileLandingFaq,
  MobileLandingHero,
  MobileLandingImpact,
  MobileLandingPricing,
  MobileLandingProduct,
  MobileLandingProof,
  MobileLandingWorkflow,
  MobileStickyCta,
} from "@/components/marketing/landing-page-mobile";
import {
  LandingFooter,
  type LandingPageProps,
} from "@/components/marketing/landing-page-shared";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { BRAND_ACCESS_NAME } from "@/lib/brand";

export function LandingPage({
  isAuthenticated,
  hasPaidAccess,
  pricing,
}: LandingPageProps) {
  const primaryHref = hasPaidAccess
    ? "/dashboard"
    : isAuthenticated
      ? "/pricing"
      : "/sign-up";

  const accessLabel = pricing?.productName ?? BRAND_ACCESS_NAME;
  const priceLabel = pricing?.displayPrice ?? "Live pricing at checkout";
  const billingLabel = pricing?.billingInterval ?? "Recurring access";
  const mobilePrimaryLabel = hasPaidAccess
    ? "Open Terminal"
    : isAuthenticated
      ? "View Pricing"
      : "Get Access";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05080d] text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(86,217,255,0.08),transparent_22%),radial-gradient(circle_at_80%_12%,rgba(121,151,255,0.08),transparent_18%),linear-gradient(180deg,rgba(255,255,255,0.015),transparent_18%)]" />

      <div className="relative">
        <MarketingHeader
          isAuthenticated={isAuthenticated}
          hasPaidAccess={hasPaidAccess}
          tone="subdued"
          mobileVariant="minimal"
          mobilePrimaryLabel={mobilePrimaryLabel}
        />

        <main className="pb-28 md:pb-0">
          <section className="border-b border-white/[0.06]">
            <div className="md:hidden">
              <MobileLandingHero
                primaryHref={primaryHref}
                priceLabel={priceLabel}
                billingLabel={billingLabel}
                primaryLabel={mobilePrimaryLabel}
              />
            </div>
            <div className="hidden md:block">
              <DesktopLandingHero primaryHref={primaryHref} />
            </div>
          </section>

          <section
            id="proof"
            className="border-b border-white/[0.06] bg-[linear-gradient(180deg,rgba(255,255,255,0.012),rgba(255,255,255,0))]"
          >
            <div className="md:hidden">
              <MobileLandingProof />
            </div>
            <div className="hidden md:block">
              <DesktopLandingProof />
            </div>
          </section>

          <section id="workflow" className="border-b border-white/[0.06]">
            <div className="md:hidden">
              <MobileLandingWorkflow
                primaryHref={primaryHref}
                primaryLabel={mobilePrimaryLabel}
              />
            </div>
            <div className="hidden md:block">
              <DesktopLandingWorkflow />
            </div>
          </section>

          <section className="border-b border-white/[0.06] md:hidden">
            <MobileLandingImpact />
          </section>

          <section
            id="product"
            className="border-b border-white/[0.06] bg-[linear-gradient(180deg,rgba(255,255,255,0.01),rgba(255,255,255,0))]"
          >
            <div className="md:hidden">
              <MobileLandingProduct
                primaryHref={primaryHref}
                primaryLabel={mobilePrimaryLabel}
              />
            </div>
            <div className="hidden md:block">
              <DesktopLandingProduct />
            </div>
          </section>

          <section id="pricing" className="border-b border-white/[0.06]">
            <div className="md:hidden">
              <MobileLandingPricing
                primaryHref={primaryHref}
                accessLabel={accessLabel}
                priceLabel={priceLabel}
                billingLabel={billingLabel}
                primaryLabel={mobilePrimaryLabel}
              />
            </div>
            <div className="hidden md:block">
              <DesktopLandingPricing
                primaryHref={primaryHref}
                accessLabel={accessLabel}
                priceLabel={priceLabel}
                billingLabel={billingLabel}
              />
            </div>
          </section>

          <section id="faq" className="border-b border-white/[0.06]">
            <div className="md:hidden">
              <MobileLandingFaq />
            </div>
            <div className="hidden md:block">
              <DesktopLandingFaq />
            </div>
          </section>
        </main>

        <LandingFooter />
        <MobileStickyCta
          primaryHref={primaryHref}
          priceLabel={priceLabel}
          billingLabel={billingLabel}
          primaryLabel={mobilePrimaryLabel}
        />
      </div>
    </div>
  );
}
