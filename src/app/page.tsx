import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Binary,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { buttonClassName } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";
import { isPaidAccessState } from "@/lib/billing/shared";
import { getCurrentAuthContext } from "@/lib/supabase/auth";

const featureCards = [
  {
    title: "Narrative ranking",
    description:
      "Structure market narratives into a disciplined scan surface instead of scattered feeds and impulsive context switching.",
    icon: Activity,
  },
  {
    title: "Linked asset context",
    description:
      "Trace related memecoin exposure and supporting context in the same workflow so discovery and validation stay connected.",
    icon: Waypoints,
  },
  {
    title: "Membership-backed access",
    description:
      "Use Stripe and Supabase to keep premium routes, billing state, and account permissions aligned with live subscription status.",
    icon: ShieldCheck,
  },
] as const;

const workflowSteps = [
  {
    step: "01",
    title: "Scan",
    description:
      "Surface ranked narrative changes fast enough to support repeat monitoring, not just one-off research.",
  },
  {
    step: "02",
    title: "Validate",
    description:
      "Keep linked assets, market context, and operational notes inside one controlled environment with cleaner handoff between views.",
  },
  {
    step: "03",
    title: "Operate",
    description:
      "Gate the live terminal behind authenticated membership so the operator workspace stays intentional and monetizable.",
  },
] as const;

const controlNotes = [
  "Paid access is enforced from webhook-synced subscription state, not optimistic client-only assumptions.",
  "Public-facing pages stay concise and serious while the protected product surface remains separate.",
  "Navigation, loading, and auth feedback are tuned to feel immediate instead of silent after click.",
] as const;

const faqItems = [
  {
    question: "Who is this built for?",
    answer:
      "Operators who want a repeatable narrative-monitoring workflow with a more disciplined public entry point and paid access control.",
  },
  {
    question: "What unlocks after membership?",
    answer:
      "The protected terminal routes, billing controls, and the workflow that depends on synchronized subscription state.",
  },
  {
    question: "Why keep the public site restrained?",
    answer:
      "The product is closer to operator software than a general marketing site. Clarity and trust matter more than volume.",
  },
] as const;

export default async function HomePage() {
  const { user, profile } = await getCurrentAuthContext();
  const hasPaidAccess = isPaidAccessState(profile?.access_state);
  const primaryHref = hasPaidAccess ? "/dashboard" : user ? "/pricing" : "/sign-up";
  const primaryLabel = hasPaidAccess ? "Open terminal" : user ? "Review access" : "Get access";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader
        isAuthenticated={Boolean(user)}
        hasPaidAccess={hasPaidAccess}
      />

      <main className="mx-auto flex w-full max-w-[1320px] flex-col gap-8 px-4 pb-16 pt-8 sm:px-6 lg:px-8 lg:gap-10 lg:pb-24">
        <section className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="surface-panel panel-glow-cyan p-8 sm:p-10 lg:p-12">
            <span className="eyebrow-chip">
              <Sparkles className="h-3.5 w-3.5 text-cyan" />
              Narrative signal terminal
            </span>

            <h1 className="mt-8 max-w-[820px] text-[42px] font-semibold leading-[0.96] tracking-[-0.06em] text-[#f7fbff] sm:text-[56px] lg:text-[68px]">
              Premium market context for narrative-driven operators.
            </h1>

            <p className="mt-6 max-w-[720px] text-[16px] leading-8 text-[#9bb0c8] sm:text-[17px]">
              Narrative To Asset turns narrative monitoring, linked memecoin discovery, and
              premium access control into one deliberate surface. The public site stays calm and
              credible. The live terminal stays protected.
            </p>

            <div className="mt-10 flex flex-wrap gap-3">
              <InteractiveLink
                href={primaryHref}
                pendingLabel={
                  hasPaidAccess
                    ? "Opening terminal"
                    : user
                      ? "Opening access controls"
                      : "Opening account setup"
                }
                navigationLabel={
                  hasPaidAccess
                    ? "Opening terminal"
                    : user
                      ? "Opening access controls"
                      : "Opening account setup"
                }
                className={buttonClassName({ tone: "primary", size: "lg" })}
              >
                <span className="inline-flex items-center gap-2">
                  {primaryLabel}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </InteractiveLink>

              <InteractiveLink
                href="/#workflow"
                pendingLabel="Reviewing workflow"
                className={buttonClassName({ tone: "secondary", size: "lg" })}
              >
                Review workflow
              </InteractiveLink>
            </div>

            <div className="mt-12 grid gap-3 md:grid-cols-3">
              <div className="metric-card metric-gloss">
                <p className="section-kicker">Operator fit</p>
                <p className="mt-4 text-[18px] font-semibold tracking-[-0.03em] text-[#f2f8ff]">
                  Structured for repeat scanning
                </p>
                <p className="mt-3 text-[14px] leading-7 text-[#8ea4bc]">
                  The interface is tuned for ongoing monitoring rather than one-time onboarding.
                </p>
              </div>
              <div className="metric-card metric-gloss">
                <p className="section-kicker">Access model</p>
                <p className="mt-4 text-[18px] font-semibold tracking-[-0.03em] text-[#f2f8ff]">
                  Stripe-backed membership control
                </p>
                <p className="mt-3 text-[14px] leading-7 text-[#8ea4bc]">
                  Billing, subscription state, and protected routes stay aligned through the same system.
                </p>
              </div>
              <div className="metric-card metric-gloss">
                <p className="section-kicker">Product posture</p>
                <p className="mt-4 text-[18px] font-semibold tracking-[-0.03em] text-[#f2f8ff]">
                  Serious public face, controlled core
                </p>
                <p className="mt-3 text-[14px] leading-7 text-[#8ea4bc]">
                  Minimal public copy up front. Protected routes and account workflows where they belong.
                </p>
              </div>
            </div>
          </div>

          <aside className="surface-panel panel-glow-emerald flex flex-col p-8 sm:p-10">
            <p className="section-kicker">Operator frame</p>
            <h2 className="mt-5 max-w-[520px] text-[30px] font-semibold tracking-[-0.05em] text-[#f2f8ff] sm:text-[36px]">
              A disciplined public layer for a paid execution product.
            </h2>
            <p className="mt-5 text-[15px] leading-8 text-[#94aac2]">
              The goal is not to turn the product into generic SaaS marketing. It is to make every
              public touchpoint feel deliberate, responsive, and operationally trustworthy.
            </p>

            <div className="mt-8 space-y-3">
              {controlNotes.map((note) => (
                <div key={note} className="panel-list-row flex items-start gap-3">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald" />
                  <p className="text-[14px] leading-7 text-[#dce6f2]">{note}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <div className="metric-card">
                <p className="section-kicker">Surface discipline</p>
                <p className="mt-3 text-[16px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                  Calm by default
                </p>
                <p className="mt-3 text-[14px] leading-7 text-[#8fa6bf]">
                  Clear hierarchy, stronger spacing, and restrained motion reduce noise without softening the identity.
                </p>
              </div>
              <div className="metric-card">
                <p className="section-kicker">System trust</p>
                <p className="mt-3 text-[16px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
                  Immediate feedback
                </p>
                <p className="mt-3 text-[14px] leading-7 text-[#8fa6bf]">
                  Buttons, navigation, and auth actions now acknowledge intent instantly instead of waiting in silence.
                </p>
              </div>
            </div>

            <div className="mt-auto border-t border-white/[0.08] pt-8">
              <p className="section-kicker">Next step</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <InteractiveLink
                  href="/pricing"
                  pendingLabel="Opening membership surface"
                  navigationLabel="Opening membership surface"
                  className={buttonClassName({ tone: "secondary", size: "md" })}
                >
                  Membership surface
                </InteractiveLink>
                <InteractiveLink
                  href="/#features"
                  pendingLabel="Reviewing product details"
                  className={buttonClassName({ tone: "quiet", size: "md" })}
                >
                  Product details
                </InteractiveLink>
              </div>
            </div>
          </aside>
        </section>

        <section id="features" className="grid gap-4 lg:grid-cols-3">
          {featureCards.map((item) => (
            <article key={item.title} className="surface-panel p-7 sm:p-8">
              <div className="flex h-11 w-11 items-center justify-center border border-white/[0.08] bg-[#08111c] text-cyan">
                <item.icon className="h-4 w-4" />
              </div>
              <p className="mt-6 section-kicker">Core capability</p>
              <h2 className="mt-3 text-[24px] font-semibold tracking-[-0.04em] text-[#f4f9ff]">
                {item.title}
              </h2>
              <p className="mt-4 text-[15px] leading-8 text-[#92a7bf]">{item.description}</p>
            </article>
          ))}
        </section>

        <section
          id="workflow"
          className="surface-panel grid gap-8 p-8 sm:p-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-start lg:p-12"
        >
          <div>
            <p className="section-kicker">How it works</p>
            <h2 className="mt-5 max-w-[420px] text-[32px] font-semibold leading-[1.02] tracking-[-0.05em] text-[#f3f8ff] sm:text-[40px]">
              One public path, one protected operator surface.
            </h2>
            <p className="mt-5 max-w-[500px] text-[15px] leading-8 text-[#94aac2]">
              The product flow is intentionally linear: attract the right user, authenticate cleanly,
              unlock membership through Stripe, then keep access state synchronized before granting terminal access.
            </p>
          </div>

          <div className="grid gap-4">
            {workflowSteps.map((step) => (
              <div key={step.step} className="panel-list-row grid gap-4 sm:grid-cols-[88px_1fr] sm:items-start">
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
            <p className="section-kicker">Operational notes</p>
            <h2 className="mt-5 text-[30px] font-semibold tracking-[-0.05em] text-[#f3f8ff] sm:text-[36px]">
              Professional outside, controlled inside.
            </h2>
            <p className="mt-5 text-[15px] leading-8 text-[#94aac2]">
              The public site should clarify the product, not dilute it. Every visible state is now
              designed to reduce hesitation, dead clicks, and bolted-on feeling across the access flow.
            </p>

            <div className="mt-8 grid gap-3">
              {[
                "Immediate route feedback on internal navigation",
                "Pending states on auth, checkout, and billing actions",
                "Loading shells that match final layouts closely enough to reduce swap shock",
              ].map((item) => (
                <div key={item} className="panel-list-row flex items-start gap-3">
                  <Binary className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                  <p className="text-[14px] leading-7 text-[#d9e5f1]">{item}</p>
                </div>
              ))}
            </div>
          </div>

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
        </section>

        <section className="surface-panel border border-cyan/14 px-8 py-8 sm:px-10 lg:px-12 lg:py-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="section-kicker">Ready state</p>
              <h2 className="mt-4 text-[30px] font-semibold tracking-[-0.05em] text-[#f4f9ff] sm:text-[38px]">
                Review the membership surface and continue into the protected flow.
              </h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <InteractiveLink
                href="/pricing"
                pendingLabel="Opening membership surface"
                navigationLabel="Opening membership surface"
                className={buttonClassName({ tone: "primary", size: "lg" })}
              >
                <span className="inline-flex items-center gap-2">
                  Review pricing
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
          </div>
        </section>
      </main>
    </div>
  );
}
