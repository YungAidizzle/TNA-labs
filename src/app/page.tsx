import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Search,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { buttonClassName } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";
import { isPaidAccessState } from "@/lib/billing/shared";
import { getCurrentAuthContext } from "@/lib/supabase/auth";

const heroPoints = [
  {
    title: "Catch attention shifts earlier",
    description: "See which narratives are building before they become obvious everywhere else.",
  },
  {
    title: "Move from narrative to asset fast",
    description: "Find linked memecoins and related symbols without losing the thread of the move.",
  },
  {
    title: "Check whether it is real or just noise",
    description: "Keep validation context next to the idea before you decide whether it is worth acting on.",
  },
] as const;

const featureCards = [
  {
    title: "Narrative ranking",
    description:
      "Rank internet narratives by momentum so it is clear what is building, fading, or fragmenting.",
    icon: Activity,
  },
  {
    title: "Linked memecoin discovery",
    description:
      "Jump from the narrative to the memecoins tied to it instead of piecing the trade together across multiple feeds.",
    icon: Waypoints,
  },
  {
    title: "Validation context",
    description:
      "Keep supporting context beside the narrative so you can judge whether the move has enough signal to matter.",
    icon: Search,
  },
  {
    title: "Member terminal access",
    description:
      "Paid access opens the live dashboard and keeps billing, account access, and the terminal tied together.",
    icon: ShieldCheck,
  },
] as const;

const workflowSteps = [
  {
    step: "01",
    title: "Track narratives",
    description: "Monitor which internet narratives are gaining or losing attention.",
  },
  {
    step: "02",
    title: "Review linked assets",
    description: "See the memecoins and related symbols being pulled into that attention.",
  },
  {
    step: "03",
    title: "Validate the setup",
    description: "Check the context and decide whether the move is worth acting on.",
  },
  {
    step: "04",
    title: "Continue in the live dashboard",
    description: "Member access opens the terminal where the live workflow continues.",
  },
] as const;

const faqItems = [
  {
    question: "Who is this for?",
    answer:
      "Traders and researchers who want earlier context on internet narratives and the assets tied to them.",
  },
  {
    question: "What happens after payment?",
    answer:
      "Checkout runs in Stripe. When payment completes, access opens on the same account and the live dashboard becomes available.",
  },
  {
    question: "Why is the dashboard members-only?",
    answer:
      "The public site explains the workflow. The live dashboard is the paid product where the ongoing tracking lives.",
  },
] as const;

export default async function HomePage() {
  const { user, profile } = await getCurrentAuthContext();
  const hasPaidAccess = isPaidAccessState(profile?.access_state);
  const primaryHref = hasPaidAccess ? "/dashboard" : "/pricing";
  const primaryLabel = hasPaidAccess ? "Open terminal" : "View pricing";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader
        isAuthenticated={Boolean(user)}
        hasPaidAccess={hasPaidAccess}
      />

      <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-4 pb-16 pt-8 sm:px-6 lg:px-8 lg:gap-10 lg:pb-24">
        <section className="grid gap-6 lg:grid-cols-[1.12fr_0.88fr] lg:items-start">
          <div className="surface-panel panel-glow-cyan p-8 sm:p-10 lg:p-12">
            <p className="section-kicker">Narrative Intelligence for Memecoins</p>

            <h1 className="mt-6 max-w-[820px] text-[42px] font-semibold leading-[0.96] tracking-[-0.06em] text-[#f7fbff] sm:text-[56px] lg:text-[66px]">
              Spot internet narratives before they become crowded trades.
            </h1>

            <p className="mt-6 max-w-[720px] text-[16px] leading-8 text-[#9bb0c8] sm:text-[17px]">
              Track narrative momentum, linked memecoins, and validation signals in one place.
              Built for traders and researchers who want earlier context, not more noise.
            </p>

            <div className="mt-10 flex flex-wrap gap-3">
              <InteractiveLink
                href={primaryHref}
                pendingLabel={hasPaidAccess ? "Opening terminal" : "Opening pricing"}
                navigationLabel={hasPaidAccess ? "Opening terminal" : "Opening pricing"}
                className={buttonClassName({ tone: "primary", size: "lg" })}
              >
                <span className="inline-flex items-center gap-2">
                  {primaryLabel}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </InteractiveLink>

              <InteractiveLink
                href="/#how-it-works"
                pendingLabel="Opening workflow"
                className={buttonClassName({ tone: "secondary", size: "lg" })}
              >
                How it works
              </InteractiveLink>
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

          <aside className="surface-panel p-8 sm:p-10">
            <p className="section-kicker">Why People Use It</p>
            <div className="mt-6 space-y-3">
              {heroPoints.map((item) => (
                <div key={item.title} className="panel-list-row flex items-start gap-3">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                  <div>
                    <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                      {item.title}
                    </h2>
                    <p className="mt-2 text-[14px] leading-7 text-[#8ea4bc]">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 border-t border-white/[0.08] pt-6">
              <p className="text-[13px] leading-7 text-[#93a8c0]">
                The live dashboard is available to members. Billing is handled in Stripe and tied to
                the same account you use to sign in.
              </p>
            </div>
          </aside>
        </section>

        <section id="features" className="grid gap-4 md:grid-cols-2">
          {featureCards.map((item) => (
            <article key={item.title} className="surface-panel p-7 sm:p-8">
              <div className="flex h-11 w-11 items-center justify-center border border-white/[0.08] bg-[#08111c] text-cyan">
                <item.icon className="h-4 w-4" />
              </div>
              <h2 className="mt-6 text-[24px] font-semibold tracking-[-0.04em] text-[#f4f9ff]">
                {item.title}
              </h2>
              <p className="mt-4 text-[15px] leading-8 text-[#92a7bf]">{item.description}</p>
            </article>
          ))}
        </section>

        <section
          id="how-it-works"
          className="surface-panel grid gap-8 p-8 sm:p-10 lg:grid-cols-[0.9fr_1.1fr] lg:p-12"
        >
          <div>
            <p className="section-kicker">How It Works</p>
            <h2 className="mt-5 max-w-[420px] text-[32px] font-semibold leading-[1.02] tracking-[-0.05em] text-[#f3f8ff] sm:text-[40px]">
              Track the narrative. Review the assets. Validate the setup.
            </h2>
            <p className="mt-5 max-w-[520px] text-[15px] leading-8 text-[#94aac2]">
              The workflow is simple: follow attention as it moves, inspect the assets tied to it,
              decide whether the setup is real, then continue into the live dashboard if you want the
              full member view.
            </p>
          </div>

          <div className="grid gap-4">
            {workflowSteps.map((step) => (
              <div
                key={step.step}
                className="panel-list-row grid gap-4 sm:grid-cols-[88px_1fr] sm:items-start"
              >
                <div className="border border-cyan/14 bg-cyan/[0.06] px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-cyan">
                    Step {step.step}
                  </p>
                </div>
                <div>
                  <h3 className="text-[20px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-[14px] leading-7 text-[#8fa6bf]">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className="grid gap-4 lg:grid-cols-[1.04fr_0.96fr]">
          <div className="surface-panel p-8 sm:p-10">
            <p className="section-kicker">FAQ</p>
            <div className="mt-5 space-y-3">
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

          <aside className="surface-panel border border-cyan/14 p-8 sm:p-10">
            <p className="section-kicker">Member Access</p>
            <h2 className="mt-5 text-[30px] font-semibold tracking-[-0.05em] text-[#f4f9ff] sm:text-[36px]">
              Start with pricing. Continue into the live dashboard when you are ready.
            </h2>
            <p className="mt-5 text-[15px] leading-8 text-[#93a8c0]">
              Review access, create an account if needed, and continue into secure checkout. If you
              already have access, go straight to the terminal.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <InteractiveLink
                href={primaryHref}
                pendingLabel={hasPaidAccess ? "Opening terminal" : "Opening pricing"}
                navigationLabel={hasPaidAccess ? "Opening terminal" : "Opening pricing"}
                className={buttonClassName({ tone: "primary", size: "lg" })}
              >
                <span className="inline-flex items-center gap-2">
                  {primaryLabel}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </InteractiveLink>
              {!user ? (
                <InteractiveLink
                  href="/sign-in"
                  pendingLabel="Opening sign in"
                  navigationLabel="Opening sign in"
                  className={buttonClassName({ tone: "secondary", size: "lg" })}
                >
                  Sign in
                </InteractiveLink>
              ) : null}
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
