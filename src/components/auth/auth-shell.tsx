import Link from "next/link";
import { Activity, ArrowLeft, BadgeCheck, ShieldCheck, Zap } from "lucide-react";
import { BRAND_DESCRIPTOR, BRAND_NAME } from "@/lib/brand";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
};

const sideItems = [
  "Live narrative ranking with market-linked context",
  "Correlated memecoin discovery inside the same workflow",
  "Research-first interface built for repeat scanning",
] as const;

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: AuthShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-[#91a7bf] transition-colors hover:text-[#eef5ff]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to site
          </Link>
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.16),transparent_62%),rgba(6,11,17,0.92)] text-cyan">
              <Activity className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-[#6e8299]">
                {BRAND_NAME}
              </span>
              <span className="block text-[15px] font-semibold text-[#eef5ff]">
                {BRAND_DESCRIPTOR}
              </span>
            </span>
          </Link>
        </div>

        <div className="mt-8 grid flex-1 gap-6 lg:grid-cols-[minmax(0,1.02fr)_minmax(420px,0.98fr)] lg:items-stretch">
          <section className="surface-panel hidden border border-white/[0.08] p-8 lg:flex lg:flex-col">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#6e8299]">
              Access surface
            </p>
            <h1 className="mt-5 max-w-[520px] text-[38px] font-semibold leading-[1.02] tracking-[-0.05em] text-[#f2f8ff]">
              Secure account access for the live Attentra terminal.
            </h1>
            <p className="mt-5 max-w-[520px] text-[15px] leading-7 text-[#94a9c1]">
              Sign in, create an account, and manage access with the same research-first product language used across the platform. Legal assent and billing disclosures stay explicit before paid access unlocks.
            </p>

            <div className="mt-8 grid gap-3">
              {sideItems.map((item) => (
                <div key={item} className="flex items-start gap-3 border border-white/[0.07] bg-white/[0.02] p-4">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                  <p className="text-[14px] leading-6 text-[#d9e4f1]">{item}</p>
                </div>
              ))}
            </div>

            <div className="mt-auto grid gap-3 pt-8 sm:grid-cols-3">
              {[
                { icon: Zap, label: "Fast research flow" },
                { icon: ShieldCheck, label: "Clean access control" },
                { icon: BadgeCheck, label: "Billing and legal ready" },
              ].map((item) => (
                <div key={item.label} className="border border-white/[0.07] bg-[#07101a] p-4">
                  <item.icon className="h-4 w-4 text-cyan" />
                  <p className="mt-3 text-[12px] uppercase tracking-[0.14em] text-[#dce6f2]">
                    {item.label}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="surface-panel border border-white/[0.08] p-6 sm:p-8">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#6e8299]">
              {eyebrow}
            </p>
            <h2 className="mt-4 text-[32px] font-semibold tracking-[-0.05em] text-[#f3f8ff]">
              {title}
            </h2>
            <p className="mt-4 max-w-[560px] text-[15px] leading-7 text-[#92a7bf]">
              {description}
            </p>
            <div className="mt-8">{children}</div>
          </section>
        </div>
      </div>
    </div>
  );
}
