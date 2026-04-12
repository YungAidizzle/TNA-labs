import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DashboardShowcase } from "@/components/marketing/dashboard-showcase";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { LEGAL_CONTACT } from "@/lib/legal/contact-details";
import { SHORT_MARKETING_DISCLAIMER } from "@/lib/legal/disclaimers";

type LandingPageProps = {
  isAuthenticated: boolean;
  hasPaidAccess: boolean;
  pricing: {
    productName: string;
    displayPrice: string;
    billingInterval: string;
  } | null;
};

const HERO_SIGNALS = [
  "Cross-platform narrative tracking",
  "Linked memecoin discovery",
  "Real-time validation workflow",
] as const;

const HERO_NOTES = [
  "Research software only",
  "Membership access",
  "No execution tooling",
] as const;

const PROOF_ITEMS = [
  {
    title: "Cross-platform narrative tracking",
    text: "Monitor fast-moving themes from one terminal instead of stitching together separate feeds and screeners.",
  },
  {
    title: "Linked memecoin discovery",
    text: "See which coins are being pulled into the move while the narrative is still forming.",
  },
  {
    title: "Momentum monitoring",
    text: "Keep price response, liquidity, and transaction flow next to the narrative instead of in another tab.",
  },
  {
    title: "Real-time dashboard workflow",
    text: "Scan, compare, validate, and move on without losing the original context that surfaced the setup.",
  },
] as const;

const WORKFLOW_STEPS = [
  {
    step: "01",
    title: "Track narratives",
    text: "Rank the themes gathering attention across the internet before the move gets fully crowded.",
  },
  {
    step: "02",
    title: "Review linked assets",
    text: "Open the memecoin board and see which names are being pulled into the same attention cluster.",
  },
  {
    step: "03",
    title: "Validate and act",
    text: "Check liquidity, volume, recent price response, and transaction activity before committing attention or capital.",
  },
] as const;

const PRODUCT_DETAILS = [
  {
    title: "Narrative board first",
    text: "The left side of the terminal stays focused on the themes actually gaining attention so the product is understandable at a glance.",
  },
  {
    title: "Assets tied to the story",
    text: "The center board keeps linked memecoins and momentum context visible, so you move from narrative to asset without tab-hopping.",
  },
  {
    title: "Validation beside the signal",
    text: "The right panel keeps market context close to the thesis: liquidity, volume, transaction flow, and recent price response.",
  },
  {
    title: "Built for repeated monitoring",
    text: "This is a working terminal for scanning and validating setups, not a marketing dashboard full of decorative widgets.",
  },
] as const;

const FAQS = [
  {
    question: "What does the platform track?",
    answer:
      "It tracks internet narratives, ranks them by attention, and connects those narratives to linked memecoins and market validation data.",
  },
  {
    question: "Who is it for?",
    answer:
      "It is built for active crypto traders, narrative researchers, and operators who need to move from attention to asset quickly.",
  },
  {
    question: "What makes it different from a typical screener?",
    answer:
      "A normal screener starts with price and volume. This workflow starts with the narrative, then shows the assets and market context tied to it.",
  },
  {
    question: "Is this brokerage or execution software?",
    answer:
      "No. It is research software. It does not custody funds, route orders, or provide personal financial advice.",
  },
  {
    question: "How do I get access?",
    answer:
      "Create an account, start a membership, and the paid routes unlock once subscription access is active on the account.",
  },
] as const;

function SectionIntro({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="max-w-[720px]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#70849d]">
        {eyebrow}
      </p>
      <h2 className="mt-4 text-[34px] font-semibold leading-[1.02] tracking-[-0.05em] text-[#f2f7fd] sm:text-[42px]">
        {title}
      </h2>
      <p className="mt-5 max-w-[680px] text-[16px] leading-8 text-[#97abc2]">
        {text}
      </p>
    </div>
  );
}

function PrimaryCta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center gap-2 border border-cyan/24 bg-[linear-gradient(180deg,rgba(16,45,58,0.96),rgba(8,19,26,0.98))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#f1fdff] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_18px_40px_rgba(0,0,0,0.28)] transition-colors hover:border-cyan/36"
    >
      {children}
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

function SecondaryCta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center border border-white/[0.1] bg-white/[0.03] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d8e2ee] transition-colors hover:border-white/[0.16] hover:bg-white/[0.05]"
    >
      {children}
    </Link>
  );
}

export function LandingPage({
  isAuthenticated,
  hasPaidAccess,
  pricing,
}: LandingPageProps) {
  const dashboardHref = hasPaidAccess
    ? "/dashboard"
    : isAuthenticated
      ? "/pricing"
      : "/sign-up";

  const accessLabel = pricing?.productName ?? "Operator Access";
  const priceLabel = pricing?.displayPrice ?? "Configured in Stripe";
  const billingLabel = pricing?.billingInterval ?? "Recurring";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05080d] text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(86,217,255,0.08),transparent_22%),radial-gradient(circle_at_80%_12%,rgba(121,151,255,0.08),transparent_18%),linear-gradient(180deg,rgba(255,255,255,0.015),transparent_18%)]" />

      <div className="relative">
        <MarketingHeader
          isAuthenticated={isAuthenticated}
          hasPaidAccess={hasPaidAccess}
        />

        <main>
          <section className="border-b border-white/[0.06]">
            <div className="mx-auto grid w-full max-w-[1360px] gap-16 px-4 pb-24 pt-12 sm:px-6 lg:grid-cols-[minmax(0,0.76fr)_minmax(680px,1.24fr)] lg:px-8 lg:pb-32 lg:pt-24">
              <div className="max-w-[580px] lg:pt-10">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#70849d]">
                  Narrative Intelligence Terminal
                </p>
                <h1 className="mt-6 text-[44px] font-semibold leading-[0.93] tracking-[-0.065em] text-[#f4f8fd] sm:text-[58px] lg:text-[78px]">
                  Track narratives before the trade gets crowded.
                </h1>
                <p className="mt-7 max-w-[560px] text-[17px] leading-8 text-[#9cb1c7]">
                  Follow the theme, review the linked memecoins, and validate price response from one working terminal built for active market users.
                </p>

                <div className="mt-9 flex flex-wrap gap-3">
                  <PrimaryCta href={dashboardHref}>Open Live Terminal</PrimaryCta>
                  <SecondaryCta href="/#product">View Platform</SecondaryCta>
                </div>

                <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-[12px] font-medium uppercase tracking-[0.14em] text-[#c9d6e4]">
                  {HERO_SIGNALS.map((item) => (
                    <span key={item} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 bg-cyan" />
                      {item}
                    </span>
                  ))}
                </div>

                <p className="mt-6 max-w-[520px] text-[13px] leading-6 text-[#7f93ab]">
                  {SHORT_MARKETING_DISCLAIMER}
                </p>

                <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/[0.08] pt-5 text-[12px] uppercase tracking-[0.14em] text-[#91a5bc]">
                  {HERO_NOTES.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </div>

              <div className="relative lg:pt-3">
                <DashboardShowcase variant="hero" showCallouts className="mx-auto w-full max-w-[940px]" />
              </div>
            </div>
          </section>

          <section id="proof" className="border-b border-white/[0.06] bg-[linear-gradient(180deg,rgba(255,255,255,0.012),rgba(255,255,255,0))]">
            <div className="mx-auto w-full max-w-[1320px] px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
              <SectionIntro
                eyebrow="Proof"
                title="The pitch is simple because the workflow is visible."
                text="People should understand the product quickly: it tracks attention, links that attention to tradable names, and keeps validation close to the signal."
              />

              <div className="mt-12 grid gap-10 lg:grid-cols-4 lg:gap-0">
                {PROOF_ITEMS.map((item, index) => (
                  <div
                    key={item.title}
                    className={[
                      "border-t border-white/[0.08] pt-5 lg:px-6",
                      index > 0 ? "lg:border-l lg:border-t-0 lg:pt-0" : "",
                    ].join(" ")}
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#6f849c]">
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <p className="mt-4 text-[16px] font-semibold text-[#eef4fb]">{item.title}</p>
                    <p className="mt-3 max-w-[280px] text-[14px] leading-7 text-[#8ea3ba]">
                      {item.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="workflow" className="border-b border-white/[0.06]">
            <div className="mx-auto w-full max-w-[1320px] px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
              <SectionIntro
                eyebrow="How It Works"
                title="Track it. Review it. Validate it."
                text="The page follows the same logic as the product. Each step has one job, so the workflow stays fast to understand."
              />

              <ol className="mt-12 grid gap-10 lg:grid-cols-3 lg:gap-12">
                {WORKFLOW_STEPS.map((item) => (
                  <li key={item.step} className="relative border-t border-white/[0.08] pt-6 lg:pt-8">
                    <span className="pointer-events-none absolute right-0 top-0 hidden h-px w-[44%] bg-white/[0.08] lg:block" />
                    <p className="font-mono text-[13px] text-cyan">{item.step}</p>
                    <h3 className="mt-4 text-[24px] font-semibold tracking-[-0.04em] text-[#eef4fb]">
                      {item.title}
                    </h3>
                    <p className="mt-4 max-w-[360px] text-[15px] leading-7 text-[#8fa4bc]">
                      {item.text}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section id="product" className="border-b border-white/[0.06] bg-[linear-gradient(180deg,rgba(255,255,255,0.01),rgba(255,255,255,0))]">
            <div className="mx-auto grid w-full max-w-[1320px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1.16fr)_minmax(300px,0.84fr)] lg:px-8 lg:py-24">
              <div>
                <SectionIntro
                  eyebrow="Platform View"
                  title="A closer product view, not another marketing diagram."
                  text="The second product section now zooms into the working surface that matters most once a narrative is selected: the linked assets and the validation panel."
                />

                <div className="mt-10">
                  <DashboardShowcase variant="detail" />
                </div>
              </div>

              <div className="lg:pt-12">
                <div className="space-y-7">
                  {PRODUCT_DETAILS.map((item) => (
                    <div key={item.title} className="border-t border-white/[0.08] pt-6">
                      <h3 className="text-[19px] font-semibold text-[#eef4fb]">
                        {item.title}
                      </h3>
                      <p className="mt-3 text-[15px] leading-7 text-[#8ea4bc]">
                        {item.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section id="pricing" className="border-b border-white/[0.06]">
            <div className="mx-auto grid w-full max-w-[1320px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:px-8 lg:py-24">
              <div>
                <SectionIntro
                  eyebrow="Pricing / Access"
                  title="One plan. Clear access."
                  text="The membership section should read like product access, not like a pricing template."
                />
              </div>

              <div className="border border-white/[0.08] bg-[linear-gradient(180deg,rgba(9,13,20,0.98),rgba(5,8,12,0.99))] px-6 py-7 shadow-[0_24px_64px_rgba(0,0,0,0.35)] sm:px-8 sm:py-8">
                <div className="flex flex-col gap-6 border-b border-white/[0.08] pb-6 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#70849d]">
                      Membership
                    </p>
                    <h3 className="mt-3 text-[32px] font-semibold tracking-[-0.05em] text-[#f2f7fd]">
                      {accessLabel}
                    </h3>
                    <p className="mt-3 max-w-[560px] text-[15px] leading-7 text-[#8fa4bc]">
                      Full access to the narrative terminal, linked memecoin board, and validation workflow.
                    </p>
                  </div>

                  <div className="min-w-[180px] lg:text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#70849d]">
                      Price
                    </p>
                    <p className="mt-3 text-[34px] font-semibold tracking-[-0.05em] text-[#f2f7fd]">
                      {priceLabel}
                    </p>
                    <p className="mt-2 text-[13px] uppercase tracking-[0.14em] text-[#8ea4bc]">
                      {billingLabel}
                    </p>
                  </div>
                </div>

                <div className="grid gap-8 py-6 lg:grid-cols-2">
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#70849d]">
                      Included
                    </p>
                    <div className="mt-4 space-y-3 text-[15px] leading-7 text-[#dde7f3]">
                      <p>Live narrative ranking and monitoring.</p>
                      <p>Linked memecoin discovery in the same workflow.</p>
                      <p>Market validation context beside the signal.</p>
                      <p>One account for current and future terminal modules.</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#70849d]">
                      Access Notes
                    </p>
                    <div className="mt-4 space-y-3 text-[15px] leading-7 text-[#8fa4bc]">
                      <p>Research software only. No brokerage, custody, or trade execution.</p>
                      <p>Paid routes unlock from the account access state once membership is active.</p>
                      <p>The workflow is built for serious monitoring, not social hype or copy-trading theatrics.</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 border-t border-white/[0.08] pt-6">
                  <PrimaryCta href={dashboardHref}>Open Live Terminal</PrimaryCta>
                  <SecondaryCta href="/pricing">View Pricing</SecondaryCta>
                </div>
              </div>
            </div>
          </section>

          <section id="faq" className="border-b border-white/[0.06]">
            <div className="mx-auto w-full max-w-[1320px] px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
              <SectionIntro
                eyebrow="FAQ"
                title="Short answers to practical questions."
                text="Enough detail to remove friction, without turning the bottom of the page into filler."
              />

              <div className="mt-12 border-t border-white/[0.08]">
                {FAQS.map((item) => (
                  <details
                    key={item.question}
                    className="border-b border-white/[0.08] py-5"
                  >
                    <summary className="cursor-pointer list-none pr-8 text-[18px] font-semibold tracking-[-0.03em] text-[#eef4fb]">
                      {item.question}
                    </summary>
                    <p className="mt-4 max-w-[860px] text-[15px] leading-7 text-[#8ea4bc]">
                      {item.answer}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        </main>

        <footer className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-4 py-10 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#70849d]">
              Narrative To Asset
            </p>
            <p className="mt-3 text-[24px] font-semibold tracking-[-0.04em] text-[#eef4fb]">
              Research Terminal
            </p>
            <p className="mt-3 max-w-[520px] text-[14px] leading-7 text-[#859ab2]">
              Track internet narratives, review linked memecoins, and validate market context from one research terminal built for serious crypto monitoring.
            </p>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-3 text-[12px] font-medium uppercase tracking-[0.16em] text-[#9ab0c7]">
            <Link href="/#proof" className="hover:text-[#eef4fb]">Features</Link>
            <Link href="/pricing" className="hover:text-[#eef4fb]">Pricing</Link>
            <Link href="/#faq" className="hover:text-[#eef4fb]">FAQ</Link>
            <Link href="/#product" className="hover:text-[#eef4fb]">Platform</Link>
            <Link href="/privacy" className="hover:text-[#eef4fb]">Privacy</Link>
            <Link href="/terms" className="hover:text-[#eef4fb]">Terms</Link>
            <Link href="/risk-disclosure" className="hover:text-[#eef4fb]">Risk Disclosure</Link>
            <Link href="/refund-policy" className="hover:text-[#eef4fb]">Refund Policy</Link>
            <a href={`mailto:${LEGAL_CONTACT.supportEmail}`} className="hover:text-[#eef4fb]">Support</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
