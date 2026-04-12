import { Activity, ArrowLeft, BadgeCheck, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
};

const sideItems = [
  "Narrative ranking and linked asset context stay inside one operator workflow.",
  "Auth, membership control, and protected routes share the same system language.",
  "Loading and navigation states now acknowledge intent immediately instead of waiting in silence.",
] as const;

const trustNotes = [
  { icon: Zap, label: "Fast surface" },
  { icon: ShieldCheck, label: "Session-aware access" },
  { icon: BadgeCheck, label: "Billing-ready structure" },
] as const;

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: AuthShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <InteractiveLink
            href="/"
            pendingLabel="Returning to site home"
            navigationLabel="Returning to site home"
            className={buttonClassName({ tone: "quiet", size: "sm" })}
          >
            <span className="inline-flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to site
            </span>
          </InteractiveLink>

          <InteractiveLink
            href="/"
            pendingLabel="Opening site home"
            navigationLabel="Opening site home"
            className="group flex items-center gap-3"
          >
            <span className="flex h-10 w-10 items-center justify-center border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.18),transparent_62%),rgba(6,11,17,0.92)] text-cyan transition-transform duration-200 group-hover:-translate-y-[1px]">
              <Activity className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-[#6e8299]">
                Narrative To Asset
              </span>
              <span className="block text-[15px] font-semibold text-[#eef5ff]">
                Execution Surface
              </span>
            </span>
          </InteractiveLink>
        </div>

        <div className="mt-8 grid flex-1 gap-6 lg:grid-cols-[1.04fr_0.96fr] lg:items-stretch">
          <section className="surface-panel hidden border border-white/[0.08] p-8 lg:flex lg:flex-col lg:p-10">
            <span className="eyebrow-chip">
              <Sparkles className="h-3.5 w-3.5 text-cyan" />
              Trusted entry flow
            </span>

            <h1 className="mt-8 max-w-[560px] text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] text-[#f4f9ff]">
              Operator-grade access starts with a calmer, clearer auth surface.
            </h1>
            <p className="mt-5 max-w-[560px] text-[15px] leading-8 text-[#95aac2]">
              The public entry flow now matches the discipline of the product it leads into:
              cleaner hierarchy, immediate feedback, and tighter continuity between account access,
              membership control, and the protected terminal.
            </p>

            <div className="mt-8 grid gap-3">
              {sideItems.map((item) => (
                <div key={item} className="panel-list-row flex items-start gap-3">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                  <p className="text-[14px] leading-7 text-[#d9e4f1]">{item}</p>
                </div>
              ))}
            </div>

            <div className="mt-auto grid gap-3 pt-8 sm:grid-cols-3">
              {trustNotes.map((item) => (
                <div key={item.label} className="metric-card">
                  <item.icon className="h-4 w-4 text-cyan" />
                  <p className="mt-4 text-[12px] uppercase tracking-[0.16em] text-[#dce6f2]">
                    {item.label}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="surface-panel border border-white/[0.08] p-6 sm:p-8 lg:p-10">
            <p className="section-kicker">{eyebrow}</p>
            <h2 className="mt-5 text-[32px] font-semibold tracking-[-0.05em] text-[#f3f8ff] sm:text-[38px]">
              {title}
            </h2>
            <p className="mt-4 max-w-[560px] text-[15px] leading-8 text-[#92a7bf]">
              {description}
            </p>
            <div className="mt-8">{children}</div>
          </section>
        </div>
      </div>
    </div>
  );
}
