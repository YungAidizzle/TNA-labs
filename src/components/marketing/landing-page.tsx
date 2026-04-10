import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BellRing,
  CandlestickChart,
  ChartLine,
  Compass,
  Database,
  Layers3,
  Radar,
  ShieldCheck,
  Sparkles,
  TimerReset,
} from "lucide-react";
import { MarketingHeader } from "@/components/marketing/marketing-header";

type LandingPageProps = {
  isAuthenticated: boolean;
  hasPaidAccess: boolean;
};

const heroMetrics = [
  { label: "Narratives monitored", value: "250" },
  { label: "Linked memecoins", value: "42" },
  { label: "Posts per minute", value: "11" },
  { label: "Validation confidence", value: "97" },
] as const;

const features = [
  {
    icon: Radar,
    title: "Real-time narrative monitoring",
    text: "Track the topics gaining attention before price action fully reflects the shift.",
  },
  {
    icon: CandlestickChart,
    title: "Correlated memecoin discovery",
    text: "Map narratives to market-linked tokens instead of screening the market blind.",
  },
  {
    icon: ChartLine,
    title: "Momentum signal surface",
    text: "See acceleration, participation quality, and early coin rotation in one interface.",
  },
  {
    icon: ShieldCheck,
    title: "Validation panel",
    text: "Check liquidity, volume, transaction activity, and live market context on selection.",
  },
  {
    icon: Layers3,
    title: "Market-linked filtering",
    text: "Reduce social noise into ranked setups tied to actual tradable assets.",
  },
  {
    icon: TimerReset,
    title: "Terminal-speed workflow",
    text: "Dense, fast, and built for repeated scanning instead of slow dashboard theater.",
  },
] as const;

const useCases = [
  "Memecoin traders tracking attention before the crowd rotates",
  "Narrative researchers mapping online themes to live assets",
  "Crypto content operators validating whether a topic is actually tradable",
  "Market observers who want attention flow, not another lagging screener",
] as const;

const faqs = [
  {
    question: "What is this platform?",
    answer:
      "It is a narrative-to-asset intelligence terminal that ranks internet attention, maps related memecoins, and surfaces market-linked validation signals.",
  },
  {
    question: "Who is it for?",
    answer:
      "It is built for serious crypto users: traders, researchers, content operators, and market observers who need structured signal around internet attention.",
  },
  {
    question: "How is it different from a normal screener?",
    answer:
      "A normal screener starts with market data. This platform starts with attention flow, then connects that attention to tradable assets and validation context.",
  },
  {
    question: "Does it provide financial advice?",
    answer:
      "No. It provides intelligence and workflow support. Users remain responsible for their own decisions and risk management.",
  },
  {
    question: "How often is data updated?",
    answer:
      "The surface is designed for live monitoring with frequent refreshes so narrative ranking, linked assets, and validation context stay current.",
  },
  {
    question: "What do I get access to?",
    answer:
      "Access includes the live narrative board, linked memecoin surface, validation workflows, and future expansion into broader intelligence modules.",
  },
] as const;

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.2em] text-[#6e8299]">
      {children}
    </p>
  );
}

function SectionHeading({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="max-w-[760px]">
      <SectionEyebrow>Execution surface</SectionEyebrow>
      <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[#edf5ff] sm:text-[36px]">
        {title}
      </h2>
      <p className="mt-4 max-w-[680px] text-[15px] leading-7 text-[#91a7bf]">
        {text}
      </p>
    </div>
  );
}

function PreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface-panel panel-glow-cyan relative overflow-hidden border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,16,25,0.98),rgba(6,10,16,0.98))]">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">
        <span>Live execution surface</span>
        <span className="inline-flex items-center gap-2 text-[#8da3bc]">
          <span className="h-1.5 w-1.5 bg-emerald shadow-[0_0_12px_rgba(77,219,147,0.65)]" />
          Terminal online
        </span>
      </div>
      {children}
    </div>
  );
}

export function LandingPage({
  isAuthenticated,
  hasPaidAccess,
}: LandingPageProps) {
  const dashboardHref = hasPaidAccess ? "/dashboard" : isAuthenticated ? "/pricing" : "/sign-up";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingHeader
        isAuthenticated={isAuthenticated}
        hasPaidAccess={hasPaidAccess}
      />

      <main>
        <section className="relative overflow-hidden border-b border-white/[0.07]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(86,217,255,0.09),transparent_26%),radial-gradient(circle_at_80%_20%,rgba(64,110,255,0.08),transparent_24%)]" />
          <div className="mx-auto grid w-full max-w-[1280px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(440px,0.95fr)] lg:px-8 lg:py-24">
            <div className="relative z-10 max-w-[640px]">
              <SectionEyebrow>Narrative intelligence terminal</SectionEyebrow>
              <h1 className="max-w-[620px] text-[42px] font-semibold leading-[0.96] tracking-[-0.06em] text-[#f5f9ff] sm:text-[54px] lg:text-[66px]">
                Spot internet attention before it becomes market movement.
              </h1>
              <p className="mt-6 max-w-[560px] text-[16px] leading-7 text-[#9cb1c8] sm:text-[17px]">
                Monitor live narratives, surface correlated memecoins, and validate market context in a terminal built for traders and researchers who need signal before rotation gets crowded.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={dashboardHref}
                  className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_0_1px_rgba(86,217,255,0.05)] transition-colors hover:border-cyan/40"
                >
                  {hasPaidAccess ? "Open Terminal" : isAuthenticated ? "Unlock Access" : "Get Access"}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/#platform"
                  className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee] transition-colors hover:border-white/[0.16] hover:bg-white/[0.05]"
                >
                  View Platform
                </Link>
              </div>

              <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {heroMetrics.map((item) => (
                  <div
                    key={item.label}
                    className="surface-panel metric-gloss border border-white/[0.08] px-4 py-4"
                  >
                    <p className="text-[10px] uppercase tracking-[0.16em] text-[#6f86a1]">
                      {item.label}
                    </p>
                    <p className="mt-2 font-mono text-[22px] font-semibold tracking-[-0.03em] text-[#f4fbff]">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative z-10">
              <PreviewShell>
                <div className="grid gap-3 p-3 lg:grid-cols-[1.1fr_1.2fr_0.95fr]">
                  <div className="border border-white/[0.07] bg-[#07101a]">
                    <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 text-[11px] text-[#7f94ad]">
                      <span className="uppercase tracking-[0.14em]">Narratives</span>
                      <span className="font-mono text-[#b5c4d7]">250/250</span>
                    </div>
                    <div className="space-y-0.5 p-2">
                      {[
                        ["Canada - fires, politics, energy", "1K"],
                        ["AI-generated art and anime images", "679"],
                        ["Melania", "292"],
                        ["California issues and commentary", "176"],
                        ["Youtube", "157"],
                      ].map(([label, value], index) => (
                        <div
                          key={label}
                          className={[
                            "grid grid-cols-[26px_minmax(0,1fr)_48px] items-center gap-3 px-2 py-2 text-[12px]",
                            index === 0
                              ? "bg-[linear-gradient(90deg,rgba(12,53,69,0.75),rgba(8,16,25,0.24))] text-[#eff8ff]"
                              : "text-[#afc0d3]",
                          ].join(" ")}
                        >
                          <span className="font-mono text-[#78a8cc]">{index + 1}</span>
                          <span className="truncate font-medium">{label}</span>
                          <span className="text-right font-mono">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border border-white/[0.07] bg-[#07101a]">
                    <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 text-[11px] text-[#7f94ad]">
                      <span className="uppercase tracking-[0.14em]">Memecoins</span>
                      <div className="flex gap-1 text-[10px]">
                        <span className="border border-white/[0.07] px-2 py-1">Trend</span>
                        <span className="border border-cyan/25 bg-cyan/10 px-2 py-1 text-cyan">Momentum</span>
                      </div>
                    </div>
                    <div className="space-y-0.5 p-2">
                      {[
                        ["BNB Attestation", "+14.1%", "C97"],
                        ["Anime Bitcoin", "+2.4%", "C68"],
                        ["Shadow Combat League", "+28.4%", "C100"],
                        ["Pixel Coin", "+9.6%", "C97"],
                        ["Kamino", "+0.9%", "C88"],
                      ].map(([label, change, score], index) => (
                        <div
                          key={label}
                          className={[
                            "grid grid-cols-[minmax(0,1fr)_64px_48px] items-center gap-3 px-2 py-2 text-[12px]",
                            index === 0
                              ? "bg-[linear-gradient(90deg,rgba(15,53,61,0.82),rgba(8,16,25,0.24))]"
                              : "",
                          ].join(" ")}
                        >
                          <span className="truncate font-medium text-[#e9f5ff]">{label}</span>
                          <span className="text-right font-mono text-emerald">{change}</span>
                          <span className="text-right font-mono text-[#f6b057]">{score}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border border-white/[0.07] bg-[#07101a]">
                    <div className="border-b border-white/[0.06] px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-[#7f94ad]">
                      Validation
                    </div>
                    <div className="space-y-4 p-3">
                      <div>
                        <p className="text-[11px] text-[#6d829a]">Selected asset</p>
                        <p className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[#f4f8ff]">
                          BNB Attestation
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-[#7d92ab]">BAS / BSC</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          ["Liquidity", "$985K"],
                          ["24h volume", "$12M"],
                          ["Market cap", "$14M"],
                          ["Confidence", "97"],
                        ].map(([label, value]) => (
                          <div key={label} className="border border-white/[0.06] bg-white/[0.02] p-2">
                            <p className="text-[10px] uppercase tracking-[0.12em] text-[#6d829a]">{label}</p>
                            <p className="mt-1 font-mono text-[14px] text-[#eef6ff]">{value}</p>
                          </div>
                        ))}
                      </div>
                      <div className="h-[140px] border border-white/[0.06] bg-[linear-gradient(180deg,rgba(8,14,22,0.98),rgba(5,8,13,0.98))] px-3 py-2">
                        <div className="flex h-full items-end gap-1">
                          {[22, 24, 26, 28, 31, 44, 58, 92, 63, 55, 49, 56].map((height, index) => (
                            <span
                              key={`${height}-${index}`}
                              className={[
                                "w-full border-t",
                                index >= 7 ? "bg-cyan/80 border-cyan/60" : "bg-white/[0.18] border-white/[0.18]",
                              ].join(" ")}
                              style={{ height: `${height}%` }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </PreviewShell>
            </div>
          </div>
        </section>

        <section id="platform" className="border-b border-white/[0.07]">
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-10 px-4 py-20 sm:px-6 lg:px-8">
            <SectionHeading
              title="The internet moves before the market screens do."
              text="Most traders discover a theme after it is already visible in rotation, price, and crowd behavior. This platform watches narrative formation earlier, links that attention to relevant assets, and keeps validation close to the signal instead of in a second tool."
            />
            <div className="grid gap-4 lg:grid-cols-3">
              {[
                {
                  icon: Sparkles,
                  title: "Problem",
                  text: "Noise dominates social feeds. Themes form fast, attention fragments, and raw chatter rarely translates into a usable workflow on its own.",
                },
                {
                  icon: Database,
                  title: "System",
                  text: "Narratives are ranked, mapped to correlated memecoins, and paired with market-linked context so users can move from theme to asset quickly.",
                },
                {
                  icon: Activity,
                  title: "Outcome",
                  text: "You spend less time filtering chaos and more time working with a clean execution surface built around attention flow and validation.",
                },
              ].map((item) => (
                <div key={item.title} className="surface-panel border border-white/[0.08] p-6">
                  <item.icon className="h-5 w-5 text-cyan" />
                  <h3 className="mt-5 text-[18px] font-semibold text-[#eef5ff]">{item.title}</h3>
                  <p className="mt-3 text-[14px] leading-7 text-[#90a6be]">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="border-b border-white/[0.07]">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-20 sm:px-6 lg:px-8">
            <SectionHeading
              title="Built to compress narrative noise into tradable context."
              text="The product is designed as a serious workflow surface: compact signal density, clear hierarchy, and enough market context to help users validate what deserves attention."
            />
            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {features.map((feature) => (
                <div key={feature.title} className="surface-panel border border-white/[0.08] p-5">
                  <feature.icon className="h-5 w-5 text-cyan" />
                  <h3 className="mt-4 text-[16px] font-semibold text-[#eef5ff]">{feature.title}</h3>
                  <p className="mt-2 text-[13px] leading-6 text-[#8ea4bc]">{feature.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-white/[0.07]">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-20 sm:px-6 lg:px-8">
            <SectionHeading
              title="How it works"
              text="The workflow is intentionally simple: detect the narrative, map the tradable assets, then use live validation to decide what deserves follow-through."
            />
            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {[
                ["01", "Detect narratives", "Monitor live attention clusters and identify which themes are actually gaining velocity."],
                ["02", "Map market-linked assets", "Surface correlated memecoins and linked pairs around the selected narrative context."],
                ["03", "Validate and act faster", "Check liquidity, volume, market cap, age, and relative move quality without leaving the terminal."],
              ].map(([step, title, text]) => (
                <div key={step} className="surface-panel border border-white/[0.08] p-6">
                  <p className="font-mono text-[13px] text-cyan">{step}</p>
                  <h3 className="mt-4 text-[18px] font-semibold text-[#eef5ff]">{title}</h3>
                  <p className="mt-3 text-[14px] leading-7 text-[#91a6be]">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-white/[0.07]">
          <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-4 py-20 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
            <div>
              <SectionEyebrow>Why it matters</SectionEyebrow>
              <h2 className="text-[30px] font-semibold tracking-[-0.04em] text-[#eef5ff]">
                Attention flow is a different edge than price-first monitoring.
              </h2>
              <p className="mt-4 text-[15px] leading-7 text-[#92a8c0]">
                Traditional tools are useful once the move is already visible. This platform is designed for the stage before that, where narratives start forming, linked assets begin to appear, and market context can still be evaluated before the screeners fully catch up.
              </p>
            </div>
            <div className="grid gap-3">
              {[
                "Track what the internet is organizing around, not just what has already pumped.",
                "Move from narrative discovery to linked asset validation without context switching.",
                "See serious data density in a workflow built for scanning, ranking, and repeated monitoring.",
              ].map((item) => (
                <div key={item} className="surface-panel flex items-start gap-3 border border-white/[0.08] p-4">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald" />
                  <p className="text-[14px] leading-7 text-[#dbe6f4]">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-white/[0.07]">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-20 sm:px-6 lg:px-8">
            <SectionHeading
              title="Use cases"
              text="The platform is aimed at users who already understand that internet narratives matter, but need a more structured way to work with them."
            />
            <div className="mt-10 grid gap-3 md:grid-cols-2">
              {useCases.map((item) => (
                <div key={item} className="surface-panel flex items-start gap-3 border border-white/[0.08] p-5">
                  <Compass className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                  <p className="text-[14px] leading-7 text-[#dfe9f6]">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-white/[0.07]">
          <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-4 py-20 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
            <div>
              <SectionEyebrow>Credibility</SectionEyebrow>
              <h2 className="text-[30px] font-semibold tracking-[-0.04em] text-[#eef5ff]">
                Built for live monitoring, speed, and structured context.
              </h2>
              <p className="mt-4 text-[15px] leading-7 text-[#92a8c0]">
                The trust model here is product behavior, not invented logos or inflated claims. The interface is built around real-time monitoring, clear signal display, and market-linked validation instead of noise-heavy dashboards.
              </p>
            </div>
            <div className="grid gap-3">
              {[
                { icon: Activity, label: "Built for real-time monitoring" },
                { icon: BellRing, label: "Designed for speed and clarity" },
                { icon: Radar, label: "Focused on attention flow, not noise" },
                { icon: ShieldCheck, label: "Structured around live market context" },
              ].map((item) => (
                <div key={item.label} className="surface-panel flex items-center gap-3 border border-white/[0.08] px-4 py-4">
                  <item.icon className="h-4 w-4 text-cyan" />
                  <span className="text-[14px] font-medium text-[#e5edf8]">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="border-b border-white/[0.07]">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-20 sm:px-6 lg:px-8">
            <SectionHeading
              title="Membership is live."
              text="Paid access now gates the dashboard routes. Checkout runs through Stripe, and access unlocks only after webhook-synced subscription state lands back in Supabase."
            />
            <div className="mt-10 max-w-[520px]">
              <div className="surface-panel border border-cyan/15 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#6f86a1]">Premium plan</p>
                    <h3 className="mt-2 text-[26px] font-semibold tracking-[-0.04em] text-[#f3f9ff]">
                      Operator Access
                    </h3>
                  </div>
                  <span className="border border-cyan/18 bg-cyan/10 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-cyan">
                    Paid access
                  </span>
                </div>
                <div className="mt-6 space-y-3 text-[14px] text-[#dce6f3]">
                  <p>Live narrative terminal</p>
                  <p>Correlated memecoin surface</p>
                  <p>Validation and market-linked context</p>
                  <p>Future module unlocks under one account structure</p>
                </div>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href={isAuthenticated ? "/pricing" : "/sign-up"}
                    className="inline-flex h-11 items-center border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
                  >
                    {isAuthenticated ? "Unlock access" : "Start now"}
                  </Link>
                  <p className="flex items-center text-[12px] uppercase tracking-[0.14em] text-[#6f86a1]">
                    Stripe subscription gating enabled
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="border-b border-white/[0.07]">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-20 sm:px-6 lg:px-8">
            <SectionHeading
              title="FAQ"
              text="The product is straightforward on purpose. These are the practical questions most users ask before requesting access."
            />
            <div className="mt-10 grid gap-3">
              {faqs.map((item) => (
                <details key={item.question} className="surface-panel border border-white/[0.08] p-5">
                  <summary className="cursor-pointer list-none text-[15px] font-semibold text-[#eef5ff]">
                    {item.question}
                  </summary>
                  <p className="mt-3 max-w-[820px] text-[14px] leading-7 text-[#91a7bf]">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-white/[0.07]">
          <div className="mx-auto flex w-full max-w-[1280px] flex-col items-start gap-6 px-4 py-20 sm:px-6 lg:px-8">
            <SectionEyebrow>Final call</SectionEyebrow>
            <h2 className="max-w-[760px] text-[34px] font-semibold tracking-[-0.05em] text-[#f2f8ff]">
              Serious narrative intelligence for users who want earlier context, cleaner signal, and a terminal that respects attention.
            </h2>
            <div className="flex flex-wrap gap-3">
              <Link
                href={dashboardHref}
                className="inline-flex h-11 items-center gap-2 border border-cyan/25 bg-[linear-gradient(180deg,rgba(14,44,57,0.95),rgba(6,17,23,0.96))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff]"
              >
                {hasPaidAccess ? "Open terminal" : isAuthenticated ? "Unlock access" : "Get access"}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee]"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-4 py-10 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.16),transparent_62%),rgba(6,11,17,0.92)] text-cyan">
              <Activity className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#6e8299]">Narrative To Asset</p>
              <p className="text-[15px] font-semibold text-[#eef5ff]">Execution Surface</p>
            </div>
          </div>
          <p className="mt-4 max-w-[420px] text-[13px] leading-6 text-[#7f94ad]">
            Narrative intelligence, correlated memecoin discovery, and validation context for serious market users.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-3 text-[12px] font-medium uppercase tracking-[0.16em] text-[#98aec5]">
          <Link href="/">Home</Link>
          <Link href="/#features">Features</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/#faq">FAQ</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="mailto:contact@example.com">Contact</a>
          <Link href="/sign-in">Sign In</Link>
        </div>
      </footer>
    </div>
  );
}
