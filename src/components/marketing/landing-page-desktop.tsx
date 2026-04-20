import { TerminalScreenshotFrame } from "@/components/marketing/terminal-screenshot-frame";
import { TerminalWorkflowDiagram } from "@/components/marketing/terminal-workflow-diagram";
import {
  DETAIL_PROOF_POINTS,
  FAQS,
  HERO_BENEFITS,
  HERO_PROOF_STRIP,
  PLATFORM_DETAILS,
} from "@/components/marketing/landing-page-content";
import {
  PrimaryCta,
  SecondaryCta,
  SectionIntro,
} from "@/components/marketing/landing-page-shared";

type DesktopLandingSectionProps = {
  primaryHref: string;
  accessLabel: string;
  priceLabel: string;
  billingLabel: string;
};

export function DesktopLandingHero({
  primaryHref,
}: Pick<DesktopLandingSectionProps, "primaryHref">) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-10 sm:px-6 lg:px-8 lg:pb-20 lg:pt-16">
      <div className="grid items-start gap-12 xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)] xl:gap-14 2xl:grid-cols-[minmax(0,660px)_minmax(0,1fr)] 2xl:gap-16">
        <div className="min-w-0 max-w-[620px] xl:max-w-[640px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#87a6c3]">
            ATTENTRA
          </p>
          <h1 className="mt-5 text-[40px] font-semibold leading-[0.92] tracking-[-0.075em] text-[#f4f8fd] max-[360px]:text-[36px] sm:text-[58px] lg:text-[64px] xl:text-[70px] 2xl:text-[72px]">
            <span className="block whitespace-nowrap">You miss memecoin runs</span>
            <span className="block whitespace-nowrap">because you see them</span>
            <span className="block whitespace-nowrap">too late.</span>
          </h1>

          <p className="mt-6 max-w-[33rem] text-[17px] leading-8 text-[#c0d0e1] sm:text-[18px]">
            Attentra shows which social media trends are accelerating, which
            memecoins map to them, and whether momentum is real before the trade
            gets crowded.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <PrimaryCta href={primaryHref}>Open Live Terminal</PrimaryCta>
            <SecondaryCta href="/#proof">See How It Works</SecondaryCta>
          </div>

          <div className="mt-8 grid max-w-[34rem] gap-3 text-[14px] leading-6 text-[#dbe7f4] sm:text-[15px]">
            {HERO_BENEFITS.map((item) => (
              <span key={item} className="flex items-start gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-cyan" />
                <span>{item}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="min-w-0 xl:self-start xl:pt-3">
          <TerminalScreenshotFrame
            variant="hero"
            showCallouts
            className="mx-auto w-full max-w-[920px] xl:max-w-[860px]"
          />
        </div>
      </div>

      <div className="mt-10 grid gap-3 border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.012))] px-4 py-4 sm:px-5 lg:mt-12 lg:grid-cols-3 lg:gap-4">
        {HERO_PROOF_STRIP.map((item, index) => (
          <div
            key={item}
            className="flex items-start gap-3 border-white/[0.06] lg:items-center lg:border-l lg:pl-4 first:lg:border-l-0 first:lg:pl-0"
          >
            <span
              className={[
                "mt-1.5 h-2 w-2 shrink-0",
                index === HERO_PROOF_STRIP.length - 1 ? "bg-emerald" : "bg-cyan",
              ].join(" ")}
            />
            <p className="text-[12px] leading-6 text-[#bfd0e2]">{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DesktopLandingProof() {
  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
      <SectionIntro
        eyebrow="Workflow"
        title="From narrative acceleration to market validation."
        text="The terminal follows a simple operating sequence: detect the narrative, surface linked memecoins, then validate price and market context before acting."
      />

      <TerminalWorkflowDiagram />
    </div>
  );
}

export function DesktopLandingWorkflow() {
  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
      <SectionIntro
        eyebrow="Inside The Terminal"
        title="A research surface organized around the actual workflow."
        text="Each panel has a single job: rank narratives, surface linked memecoins, and validate the selected market response without leaving the terminal."
      />

      <div className="mt-12 grid gap-10 lg:grid-cols-4 lg:gap-0">
        {PLATFORM_DETAILS.map((item, index) => (
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
            <p className="mt-4 text-[16px] font-semibold text-[#eef4fb]">
              {item.title}
            </p>
            <p className="mt-3 max-w-[280px] text-[14px] leading-7 text-[#8ea3ba]">
              {item.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DesktopLandingProduct() {
  return (
    <div className="mx-auto grid w-full max-w-[1320px] items-start gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1.02fr)_minmax(320px,0.82fr)] lg:gap-12 lg:px-8 lg:py-24">
      <div className="min-w-0">
        <div className="max-w-[640px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#70849d]">
            Product Zoom-In
          </p>
          <h2 className="mt-4 text-[34px] font-semibold leading-[1.02] tracking-[-0.05em] text-[#f2f7fd] sm:text-[42px]">
            Validate the move without leaving the terminal.
          </h2>
          <p className="mt-5 max-w-[620px] text-[16px] leading-8 text-[#97abc2]">
            Narrative ranking, linked memecoins, and market response stay in one
            workflow so users can move from signal to asset to validation without
            breaking context.
          </p>
        </div>

        <div className="mt-8 border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,14,21,0.58),rgba(6,9,14,0.26))] p-3 shadow-[0_24px_72px_rgba(0,0,0,0.32)] sm:p-4">
          <TerminalScreenshotFrame
            variant="detail"
            className="mx-auto w-full max-w-[720px]"
            imageClassName="object-[63%_center]"
          />
        </div>
      </div>

      <div className="lg:pt-14">
        <div className="space-y-4">
          {DETAIL_PROOF_POINTS.map((item, index) => (
            <div
              key={item.title}
              className="border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] px-5 py-5 shadow-[0_16px_38px_rgba(0,0,0,0.18)]"
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#6f849c]">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-3 text-[18px] font-semibold text-[#eef4fb]">
                {item.title}
              </h3>
              <p className="mt-2 text-[14px] leading-7 text-[#8ea4bc]">
                {item.text}
              </p>
              <p className="mt-4 text-[11px] uppercase tracking-[0.16em] text-[#b6c6d7]">
                {item.metrics}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DesktopLandingPricing({
  primaryHref,
  accessLabel,
  priceLabel,
  billingLabel,
}: DesktopLandingSectionProps) {
  return (
    <div className="mx-auto grid w-full max-w-[1320px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:px-8 lg:py-24">
      <div>
        <SectionIntro
          eyebrow="Pricing / Access"
          title="One plan. Clear access."
          text="One subscription unlocks the live narrative terminal, linked memecoin board, and validation workflow without upsells, tier confusion, or hidden modules."
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
              Full access to the live narrative terminal, correlated memecoin
              board, and validation workflow from a single paid account.
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
              <p>One account for the full live Attentra research workflow.</p>
            </div>
          </div>

          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#70849d]">
              Access Notes
            </p>
            <div className="mt-4 space-y-3 text-[15px] leading-7 text-[#8fa4bc]">
              <p>Research software only. No brokerage, custody, or trade execution.</p>
              <p>
                Paid routes unlock from the account access state once membership is
                active.
              </p>
              <p>
                The workflow is built for serious monitoring, not social hype or
                copy-trading theatrics.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 border-t border-white/[0.08] pt-6">
          <PrimaryCta href={primaryHref}>Open Live Terminal</PrimaryCta>
          <SecondaryCta href="/pricing">View Pricing</SecondaryCta>
        </div>
      </div>
    </div>
  );
}

export function DesktopLandingFaq() {
  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
      <SectionIntro
        eyebrow="FAQ"
        title="Short answers to practical questions."
        text="Enough detail to remove friction, without turning the bottom of the page into filler."
      />

      <div className="mt-12 border-t border-white/[0.08]">
        {FAQS.map((item) => (
          <details key={item.question} className="border-b border-white/[0.08] py-5">
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
  );
}
