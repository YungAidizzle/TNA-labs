import { TerminalScreenshotFrame } from "@/components/marketing/terminal-screenshot-frame";
import {
  FAQS,
  HERO_BENEFITS,
  MOBILE_CREDIBILITY_CARDS,
  MOBILE_SCREENSHOT_CARDS,
  MOBILE_WHY_IT_MATTERS,
  WORKFLOW_STEPS,
} from "@/components/marketing/landing-page-content";
import {
  PrimaryCta,
  SecondaryCta,
  SectionIntro,
} from "@/components/marketing/landing-page-shared";

type MobileLandingSectionProps = {
  primaryHref: string;
  accessLabel: string;
  priceLabel: string;
  billingLabel: string;
  primaryLabel: string;
};

export function MobileLandingHero({
  primaryHref,
  priceLabel,
  billingLabel,
  primaryLabel,
}: Pick<
  MobileLandingSectionProps,
  "primaryHref" | "priceLabel" | "billingLabel" | "primaryLabel"
>) {
  return (
    <div className="mx-auto w-full max-w-[420px] px-4 pb-10 pt-6">
      <div className="max-w-[22rem]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#87a6c3]">
          ATTENTRA
        </p>
        <h1 className="mt-4 text-[40px] font-semibold leading-[0.94] tracking-[-0.07em] text-[#f4f8fd]">
          Catch narrative-driven memecoins before the crowd.
        </h1>
        <p className="mt-4 text-[16px] leading-7 text-[#c0d0e1]">
          See which themes are accelerating, which coins map to them, and whether
          the move has real market follow-through.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <PrimaryCta
          href={primaryHref}
          className="h-14 w-full justify-center text-[13px]"
        >
          {primaryLabel}
        </PrimaryCta>
        <p className="text-center text-[11px] uppercase tracking-[0.18em] text-[#8ea4bc]">
          {priceLabel} / {billingLabel}
        </p>
      </div>

      <div className="mt-7">
        <TerminalScreenshotFrame
          variant="detail"
          routeLabel="/live"
          frameLabel="Live Terminal"
          frameDescription="Narratives, linked coins, and validation in one screen"
          footerText="Detect the narrative. Match the coin. Validate the move."
          viewportClassName="h-[280px]"
          imageClassName="object-[46%_center]"
          priority
          quality={88}
        />
      </div>

      <div className="mt-6 grid gap-3">
        {HERO_BENEFITS.map((item) => (
          <div
            key={item}
            className="border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.012))] px-4 py-4"
          >
            <p className="text-[15px] leading-6 text-[#e6edf6]">{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MobileLandingProof() {
  return (
    <div className="mx-auto w-full max-w-[420px] px-4 py-12">
      <SectionIntro
        eyebrow="Credibility"
        title="Built for live narrative research, not dashboard theater."
        text="The product keeps source coverage, linked assets, and market validation in a workflow built for active monitoring on fast-moving themes."
      />

      <div className="mt-8 grid gap-3">
        {MOBILE_CREDIBILITY_CARDS.map((item, index) => (
          <div
            key={item.title}
            className="border border-white/[0.08] bg-[linear-gradient(180deg,rgba(9,13,20,0.96),rgba(5,8,13,0.96))] px-4 py-4 shadow-[0_16px_40px_rgba(0,0,0,0.22)]"
          >
            <div className="flex items-center gap-3">
              <span
                className={[
                  "h-2 w-2 shrink-0",
                  index === MOBILE_CREDIBILITY_CARDS.length - 1
                    ? "bg-emerald"
                    : "bg-cyan",
                ].join(" ")}
              />
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#d6e2ef]">
                {item.title}
              </p>
            </div>
            <p className="mt-3 text-[14px] leading-7 text-[#8ea4bc]">{item.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MobileLandingWorkflow({
  primaryHref,
  primaryLabel,
}: Pick<MobileLandingSectionProps, "primaryHref" | "primaryLabel">) {
  return (
    <div className="mx-auto w-full max-w-[420px] px-4 py-12">
      <SectionIntro
        eyebrow="What It Does"
        title="One idea per step, one workflow per signal."
        text="On mobile the product still follows the same sequence: find the narrative, pull the linked coins, then pressure-test the move before it gets crowded."
      />

      <div className="mt-8 grid gap-3">
        {WORKFLOW_STEPS.map((item, index) => (
          <div
            key={item.step}
            className="border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,16,24,0.98),rgba(5,8,13,0.995))] px-4 py-5 shadow-[0_18px_42px_rgba(0,0,0,0.22)]"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[12px] text-cyan">{item.step}</span>
              <span className="border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-[#8fa4bd]">
                {index === 0 ? "Detect" : index === 1 ? "Link" : "Validate"}
              </span>
            </div>
            <h3 className="mt-4 text-[22px] font-semibold tracking-[-0.04em] text-[#eef4fb]">
              {item.title}
            </h3>
            <p className="mt-3 text-[14px] leading-7 text-[#8fa4bc]">{item.detail}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {item.chips.map((chip, chipIndex) => (
                <span
                  key={chip}
                  className={[
                    "border px-3 py-1.5 text-[11px] uppercase tracking-[0.14em]",
                    chipIndex === 0
                      ? "border-cyan/25 bg-cyan/10 text-cyan"
                      : "border-white/[0.08] bg-white/[0.03] text-[#cbd8e7]",
                  ].join(" ")}
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <PrimaryCta
          href={primaryHref}
          className="h-14 w-full justify-center text-[13px]"
        >
          {primaryLabel}
        </PrimaryCta>
      </div>
    </div>
  );
}

export function MobileLandingImpact() {
  return (
    <div className="mx-auto w-full max-w-[420px] px-4 py-12">
      <SectionIntro
        eyebrow="Why It Matters"
        title="The edge is keeping context while the narrative is still moving."
        text="Most mobile dashboards collapse into noise. This flow stays useful because every section answers the next practical question."
      />

      <div className="mt-8 grid gap-3">
        {MOBILE_WHY_IT_MATTERS.map((item) => (
          <div
            key={item.title}
            className="border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] px-4 py-5"
          >
            <h3 className="text-[20px] font-semibold tracking-[-0.04em] text-[#eef4fb]">
              {item.title}
            </h3>
            <p className="mt-3 text-[14px] leading-7 text-[#8ea4bc]">{item.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MobileLandingProduct({
  primaryHref,
  primaryLabel,
}: Pick<MobileLandingSectionProps, "primaryHref" | "primaryLabel">) {
  return (
    <div className="mx-auto w-full max-w-[420px] px-4 py-12">
      <SectionIntro
        eyebrow="Screens / Demo"
        title="Readable product proof for phone screens."
        text="Instead of squeezing a desktop dashboard into one tiny preview, mobile focuses each screenshot on one job at a time."
      />

      <div className="mt-8 grid gap-5">
        {MOBILE_SCREENSHOT_CARDS.map((item) => (
          <div
            key={item.title}
            className="border border-white/[0.08] bg-[linear-gradient(180deg,rgba(9,13,20,0.96),rgba(5,8,13,0.94))] px-3 py-3 shadow-[0_18px_42px_rgba(0,0,0,0.24)]"
          >
            <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#70849d]">
              {item.eyebrow}
            </p>
            <h3 className="mt-3 px-1 text-[22px] font-semibold tracking-[-0.04em] text-[#eef4fb]">
              {item.title}
            </h3>
            <p className="mt-3 px-1 text-[14px] leading-7 text-[#8ea4bc]">{item.text}</p>

            <div className="mt-4">
              <TerminalScreenshotFrame
                variant="detail"
                routeLabel={item.routeLabel}
                frameLabel={item.frameLabel}
                frameDescription={item.frameDescription}
                footerText={item.footerText}
                viewportClassName="h-[250px]"
                imageClassName={item.imageClassName}
                quality={86}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <PrimaryCta
          href={primaryHref}
          className="h-14 w-full justify-center text-[13px]"
        >
          {primaryLabel}
        </PrimaryCta>
        <SecondaryCta href="/#faq" className="h-14 w-full justify-center text-[13px]">
          Read The FAQ
        </SecondaryCta>
      </div>
    </div>
  );
}

export function MobileLandingPricing({
  primaryHref,
  accessLabel,
  priceLabel,
  billingLabel,
  primaryLabel,
}: MobileLandingSectionProps) {
  return (
    <div className="mx-auto w-full max-w-[420px] px-4 py-12">
      <div className="border border-white/[0.08] bg-[linear-gradient(180deg,rgba(9,13,20,0.98),rgba(5,8,12,0.99))] px-5 py-6 shadow-[0_24px_64px_rgba(0,0,0,0.35)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#70849d]">
          Final CTA
        </p>
        <h2 className="mt-4 text-[30px] font-semibold leading-[1.02] tracking-[-0.05em] text-[#f2f7fd]">
          Start with one plan and the full workflow unlocked.
        </h2>
        <p className="mt-4 text-[15px] leading-7 text-[#8fa4bc]">
          Get the live narrative terminal, linked memecoin board, and validation
          workflow from one paid account without tier sprawl.
        </p>

        <div className="mt-6 border-y border-white/[0.08] py-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#70849d]">
                Membership
              </p>
              <p className="mt-3 text-[24px] font-semibold tracking-[-0.04em] text-[#eef4fb]">
                {accessLabel}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#70849d]">
                Price
              </p>
              <p className="mt-3 text-[24px] font-semibold tracking-[-0.04em] text-[#eef4fb]">
                {priceLabel}
              </p>
              <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-[#8ea4bc]">
                {billingLabel}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 space-y-3 text-[14px] leading-7 text-[#dde7f3]">
          <p>Live narrative ranking and monitoring.</p>
          <p>Linked memecoin discovery in the same workflow.</p>
          <p>Market validation context beside the signal.</p>
        </div>

        <div className="mt-6">
          <PrimaryCta
            href={primaryHref}
            className="h-14 w-full justify-center text-[13px]"
          >
            {primaryLabel}
          </PrimaryCta>
        </div>
      </div>
    </div>
  );
}

export function MobileLandingFaq() {
  return (
    <div className="mx-auto w-full max-w-[420px] px-4 py-12">
      <SectionIntro
        eyebrow="FAQ"
        title="Short answers before you commit."
        text="Enough detail to clear objections quickly on mobile without making the page feel like homework."
      />

      <div className="mt-8 border-t border-white/[0.08]">
        {FAQS.map((item) => (
          <details key={item.question} className="border-b border-white/[0.08] py-4">
            <summary className="cursor-pointer list-none pr-7 text-[17px] font-semibold tracking-[-0.03em] text-[#eef4fb]">
              {item.question}
            </summary>
            <p className="mt-3 text-[14px] leading-7 text-[#8ea4bc]">{item.answer}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

export function MobileStickyCta({
  primaryHref,
  priceLabel,
  billingLabel,
  primaryLabel,
}: Pick<
  MobileLandingSectionProps,
  "primaryHref" | "priceLabel" | "billingLabel" | "primaryLabel"
>) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-[rgba(4,7,11,0.94)] pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur-xl md:hidden">
      <div className="mx-auto flex w-full max-w-[420px] items-center gap-3 px-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#70849d]">
            Live Access
          </p>
          <p className="truncate text-[12px] text-[#d6e2ef]">
            {priceLabel} / {billingLabel}
          </p>
        </div>
        <PrimaryCta
          href={primaryHref}
          className="h-12 shrink-0 px-4 text-[11px]"
          arrow={false}
        >
          {primaryLabel}
        </PrimaryCta>
      </div>
    </div>
  );
}
