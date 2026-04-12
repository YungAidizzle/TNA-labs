import {
  Activity,
  ArrowRight,
  BadgeCheck,
  CreditCard,
  Search,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { buttonClassName } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";
import { hasDashboardAccessState } from "@/lib/billing/shared";
import { getCurrentAuthContext } from "@/lib/supabase/auth";

const capabilityCards = [
  {
    title: "Narrative ranking",
    description:
      "See which internet narratives are gaining force, stalling, or breaking apart before the move becomes obvious.",
    icon: Activity,
  },
  {
    title: "Linked memecoin discovery",
    description:
      "Move from the narrative to the tokens being pulled into it without stitching the story together by hand.",
    icon: Waypoints,
  },
  {
    title: "Validation context",
    description:
      "Keep the supporting checks beside the idea so you can decide whether it deserves attention or should be ignored.",
    icon: Search,
  },
  {
    title: "Momentum tracking",
    description:
      "Follow how attention changes over time instead of reacting to isolated spikes with no context.",
    icon: ShieldCheck,
  },
] as const;

const previewNarratives = [
  {
    name: "AI agent wallets",
    velocity: "+31%",
    assets: "GOAT, FARTCOIN, ARC",
    signal: "Broadening",
  },
  {
    name: "Telegram gaming",
    velocity: "+18%",
    assets: "NOT, DOGS",
    signal: "Holding",
  },
  {
    name: "Solana launchpads",
    velocity: "+42%",
    assets: "BONK, WIF, POPCAT",
    signal: "Accelerating",
  },
] as const;

const workflowSteps = [
  {
    step: "01",
    title: "Track narratives",
    description: "Monitor where internet attention is building instead of chasing the move after it is crowded.",
  },
  {
    step: "02",
    title: "Review linked assets",
    description: "See which memecoins and related symbols are being pulled into that narrative.",
  },
  {
    step: "03",
    title: "Validate and act",
    description: "Use the supporting context to decide whether the setup is worth more work or worth a pass.",
  },
] as const;

const membershipPoints = [
  "Live terminal access tied to your account",
  "Secure Stripe checkout and billing controls",
  "Member-only dashboard for ongoing monitoring",
] as const;

const faqItems = [
  {
    question: "Who is this for?",
    answer:
      "It is built for traders and researchers who care about narrative-driven moves and want earlier context around what is getting attention.",
  },
  {
    question: "What happens after payment?",
    answer:
      "Checkout completes in Stripe, then access opens on the same account so you can continue into the live terminal.",
  },
  {
    question: "Why is the live terminal member-only?",
    answer:
      "The public site explains the product. The live dashboard is the paid workspace where the ongoing tracking and review happen.",
  },
  {
    question: "Do I need an account before checkout?",
    answer:
      "Yes. Access is attached to your account first so billing, sign-in, and terminal access stay in one path.",
  },
] as const;

export default async function HomePage() {
  const { user, profile } = await getCurrentAuthContext();
  const hasDashboardAccess = hasDashboardAccessState(profile?.access_state);
  const primaryHref = hasDashboardAccess ? "/dashboard" : "/pricing";
  const primaryLabel = hasDashboardAccess ? "Open terminal" : "View membership";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader
        isAuthenticated={Boolean(user)}
        hasPaidAccess={hasDashboardAccess}
      />

      <main className="mx-auto flex w-full max-w-[1320px] flex-col gap-10 px-4 pb-16 pt-8 sm:px-6 lg:px-8 lg:gap-12 lg:pb-24">
        <section className="grid gap-6 lg:grid-cols-[0.94fr_1.06fr] lg:items-stretch">
          <div className="surface-panel panel-glow-cyan flex flex-col p-8 sm:p-10 lg:p-12">
            <p className="section-kicker">Narrative Intelligence for Memecoins</p>

            <h1 className="mt-6 max-w-[720px] text-[42px] font-semibold leading-[0.96] tracking-[-0.06em] text-[#f7fbff] sm:text-[56px] lg:text-[68px]">
              See internet attention before it becomes a crowded trade.
            </h1>

            <p className="mt-6 max-w-[660px] text-[16px] leading-8 text-[#9bb0c8] sm:text-[17px]">
              Narrative To Asset tracks rising narratives, links them to memecoins and tradable assets,
              and gives you enough context to decide whether the move is worth your time. The live
              terminal is available to members.
            </p>

            <div className="mt-10 flex flex-wrap gap-3">
              <InteractiveLink
                href={primaryHref}
                pendingLabel={hasDashboardAccess ? "Opening terminal" : "Opening pricing"}
                navigationLabel={hasDashboardAccess ? "Opening terminal" : "Opening pricing"}
                className={buttonClassName({ tone: "primary", size: "lg" })}
              >
                <span className="inline-flex items-center gap-2">
                  {primaryLabel}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </InteractiveLink>

              <InteractiveLink
                href="/#platform"
                pendingLabel="Opening platform overview"
                className={buttonClassName({ tone: "secondary", size: "lg" })}
              >
                See platform
              </InteractiveLink>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {[
                { label: "Tracks", value: "Narratives across internet sources" },
                { label: "Links", value: "Memecoins and related assets" },
                { label: "Access", value: "Members-only live terminal" },
              ].map((item) => (
                <div key={item.label} className="metric-card">
                  <p className="section-kicker">{item.label}</p>
                  <p className="mt-3 text-[15px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            {!user ? (
              <p className="mt-5 text-[13px] text-[#8ea4bc]">
                Already have an account?{" "}
                <InteractiveLink
                  href="/sign-in"
                  pendingLabel="Opening sign in"
                  navigationLabel="Opening sign in"
                  className="text-cyan transition-colors hover:text-[#b8f2ff]"
                >
                  Sign in
                </InteractiveLink>
              </p>
            ) : null}
          </div>

          <aside
            id="platform"
            className="surface-panel flex flex-col gap-4 p-6 sm:p-8 lg:p-10"
          >
            <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
              <div>
                <p className="section-kicker">Platform Preview</p>
                <h2 className="mt-3 text-[30px] font-semibold tracking-[-0.05em] text-[#f4f9ff] sm:text-[34px]">
                  One screen for narrative, asset, and validation context.
                </h2>
              </div>
              <span className="eyebrow-chip border-cyan/16 bg-cyan/[0.06] text-[#dff8ff]">
                Member terminal
              </span>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.18fr_0.82fr]">
              <div className="metric-card p-0">
                <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
                  <div>
                    <p className="section-kicker">Narrative board</p>
                    <p className="mt-2 text-[16px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                      Attention shifts in motion
                    </p>
                  </div>
                  <span className="text-[11px] uppercase tracking-[0.16em] text-[#6fd8f6]">
                    Live sample
                  </span>
                </div>

                <div className="divide-y divide-white/[0.06]">
                  {previewNarratives.map((item) => (
                    <div
                      key={item.name}
                      className="grid gap-3 px-5 py-4 sm:grid-cols-[1.2fr_0.65fr_0.75fr] sm:items-center"
                    >
                      <div>
                        <p className="text-[15px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                          {item.name}
                        </p>
                        <p className="mt-1 text-[12px] uppercase tracking-[0.16em] text-[#7489a3]">
                          Linked assets: {item.assets}
                        </p>
                      </div>
                      <p className="font-mono text-[14px] text-[#7ee5ff]">{item.velocity}</p>
                      <p className="text-[13px] text-[#9cb0c7]">{item.signal}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                <div className="metric-card">
                  <p className="section-kicker">Validation stack</p>
                  <div className="mt-4 space-y-3">
                    {[
                      "Cross-platform mention growth",
                      "Related token activity",
                      "Persistence beyond one news cycle",
                    ].map((item) => (
                      <div key={item} className="flex items-start gap-3">
                        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                        <p className="text-[13px] leading-6 text-[#d9e5f1]">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="metric-card">
                  <p className="section-kicker">Member workflow</p>
                  <p className="mt-4 text-[16px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                    Review the narrative, check the assets, then stay inside the terminal.
                  </p>
                  <p className="mt-3 text-[13px] leading-7 text-[#8ea4bc]">
                    The public site shows the product clearly. The live environment is reserved for
                    members who want the ongoing workspace.
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section id="features" className="grid gap-4 lg:grid-cols-[0.34fr_0.66fr]">
          <div className="surface-panel p-8 sm:p-10">
            <p className="section-kicker">Capabilities</p>
            <h2 className="mt-5 text-[34px] font-semibold leading-[1.02] tracking-[-0.05em] text-[#f3f8ff] sm:text-[40px]">
              Built to answer what is moving, what is linked, and what matters.
            </h2>
            <p className="mt-5 text-[15px] leading-8 text-[#94aac2]">
              The product is not another feed. It is a working view for understanding where attention
              is going and which assets are being pulled into it.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {capabilityCards.map((item) => (
              <article key={item.title} className="surface-panel p-7 sm:p-8">
                <div className="flex h-11 w-11 items-center justify-center border border-white/[0.08] bg-[#08111c] text-cyan">
                  <item.icon className="h-4 w-4" />
                </div>
                <h3 className="mt-6 text-[22px] font-semibold tracking-[-0.04em] text-[#f4f9ff]">
                  {item.title}
                </h3>
                <p className="mt-4 text-[15px] leading-8 text-[#92a7bf]">{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="surface-panel grid gap-6 p-8 sm:p-10 lg:grid-cols-[0.88fr_1.12fr] lg:p-12">
          <div>
            <p className="section-kicker">How It Works</p>
            <h2 className="mt-5 max-w-[480px] text-[34px] font-semibold leading-[1.02] tracking-[-0.05em] text-[#f3f8ff] sm:text-[40px]">
              Follow the narrative from first attention to tradeable context.
            </h2>
            <p className="mt-5 max-w-[520px] text-[15px] leading-8 text-[#94aac2]">
              The workflow is straightforward on purpose. Start with the narrative, move to the
              assets, then decide whether the setup deserves more work.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {workflowSteps.map((step) => (
              <article key={step.step} className="panel-list-row h-full">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-cyan">
                  Step {step.step}
                </p>
                <h3 className="mt-5 text-[20px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                  {step.title}
                </h3>
                <p className="mt-3 text-[14px] leading-7 text-[#8fa6bf]">{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          id="membership"
          className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]"
        >
          <article className="surface-panel p-8 sm:p-10 lg:p-12">
            <p className="section-kicker">Membership</p>
            <h2 className="mt-5 text-[34px] font-semibold leading-[1.02] tracking-[-0.05em] text-[#f3f8ff] sm:text-[40px]">
              Membership opens the live terminal.
            </h2>
            <p className="mt-5 text-[15px] leading-8 text-[#94aac2]">
              Membership is the path into the live dashboard. Review the plan on the pricing page,
              confirm the purchase in secure Stripe Checkout, and return to the same account with
              access attached.
            </p>

            <div className="mt-8 grid gap-3">
              {membershipPoints.map((item) => (
                <div key={item} className="panel-list-row flex items-start gap-3">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                  <p className="text-[14px] leading-7 text-[#dce6f2]">{item}</p>
                </div>
              ))}
            </div>
          </article>

          <aside className="surface-panel border border-cyan/14 p-8 sm:p-10 lg:p-12">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.08] pb-5">
              <div>
                <p className="section-kicker">Pricing and Access</p>
                <h2 className="mt-4 text-[30px] font-semibold tracking-[-0.05em] text-[#f4f9ff] sm:text-[36px]">
                  Review membership first. Enter the terminal when access is live.
                </h2>
              </div>
              <span className="eyebrow-chip border-cyan/18 bg-cyan/[0.06] text-[#dff8ff]">
                <CreditCard className="h-3.5 w-3.5 text-cyan" />
                Stripe checkout
              </span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { label: "Account", value: user ? "Ready" : "Required" },
                { label: "Checkout", value: "Secure" },
                { label: "Access", value: hasDashboardAccess ? "Live" : "Members only" },
              ].map((item) => (
                <div key={item.label} className="metric-card">
                  <p className="section-kicker">{item.label}</p>
                  <p className="mt-3 text-[15px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            <p className="mt-6 text-[14px] leading-7 text-[#93a8c0]">
              The pricing page shows the current membership plan. Stripe Checkout shows the billing
              amount and renewal details before you confirm anything.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <InteractiveLink
                href={primaryHref}
                pendingLabel={hasDashboardAccess ? "Opening terminal" : "Opening pricing"}
                navigationLabel={hasDashboardAccess ? "Opening terminal" : "Opening pricing"}
                className={buttonClassName({ tone: "primary", size: "lg" })}
              >
                <span className="inline-flex items-center gap-2">
                  {primaryLabel}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </InteractiveLink>

              {user ? (
                <InteractiveLink
                  href="/pricing"
                  pendingLabel="Opening pricing"
                  navigationLabel="Opening pricing"
                  className={buttonClassName({ tone: "secondary", size: "lg" })}
                >
                  Review pricing
                </InteractiveLink>
              ) : (
                <InteractiveLink
                  href="/sign-in"
                  pendingLabel="Opening sign in"
                  navigationLabel="Opening sign in"
                  className={buttonClassName({ tone: "secondary", size: "lg" })}
                >
                  Sign in first
                </InteractiveLink>
              )}
            </div>

            <div className="mt-6 status-banner border-cyan/12 bg-cyan/[0.06] text-[#def1ff]">
              Access stays tied to the same account you use for sign-in, so returning to the platform
              is straightforward once membership is active.
            </div>
          </aside>
        </section>

        <section
          id="faq"
          className="surface-panel grid gap-8 p-8 sm:p-10 lg:grid-cols-[1.04fr_0.96fr] lg:p-12"
        >
          <div>
            <p className="section-kicker">FAQ</p>
            <div className="mt-6 grid gap-3">
              {faqItems.map((item) => (
                <article key={item.question} className="panel-list-row">
                  <h3 className="text-[18px] font-semibold tracking-[-0.03em] text-[#eff5ff]">
                    {item.question}
                  </h3>
                  <p className="mt-3 text-[14px] leading-7 text-[#8ea4bc]">{item.answer}</p>
                </article>
              ))}
            </div>
          </div>

          <aside className="flex flex-col justify-between gap-6 border-t border-white/[0.08] pt-1 lg:border-l lg:border-t-0 lg:pl-8">
            <div>
              <p className="section-kicker">Trust</p>
              <h2 className="mt-5 max-w-[420px] text-[30px] font-semibold tracking-[-0.05em] text-[#f4f9ff] sm:text-[36px]">
                Clear public overview. Members-only live terminal.
              </h2>
              <div className="mt-6 grid gap-3">
                {[
                  "Secure billing in Stripe",
                  "Account-based access control",
                  "Members-only live terminal",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                    <p className="text-[14px] leading-7 text-[#dce6f2]">{item}</p>
                  </div>
                ))}
              </div>
            </div>

            <footer className="border-t border-white/[0.08] pt-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[14px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                    Narrative To Asset
                  </p>
                  <p className="mt-2 text-[13px] leading-6 text-[#7f93aa]">
                    Narrative monitoring, linked assets, and member access to the live terminal.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 text-[12px] uppercase tracking-[0.16em] text-[#8fa5bd]">
                  <InteractiveLink href="/" pendingLabel="Opening home">
                    Home
                  </InteractiveLink>
                  <InteractiveLink
                    href="/pricing"
                    pendingLabel="Opening pricing"
                    navigationLabel="Opening pricing"
                  >
                    Pricing
                  </InteractiveLink>
                  <InteractiveLink
                    href="/sign-in"
                    pendingLabel="Opening sign in"
                    navigationLabel="Opening sign in"
                  >
                    Sign in
                  </InteractiveLink>
                </div>
              </div>
            </footer>
          </aside>
        </section>
      </main>
    </div>
  );
}
