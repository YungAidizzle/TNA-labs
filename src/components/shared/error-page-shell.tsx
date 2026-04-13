import Link from "next/link";
import { Activity } from "lucide-react";
import { BRAND_DESCRIPTOR, BRAND_NAME } from "@/lib/brand";

type ErrorPageShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  primaryAction?: React.ReactNode;
  secondaryHref?: string;
  secondaryLabel?: string;
};

export function ErrorPageShell({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryHref = "/",
  secondaryLabel = "Return home",
}: ErrorPageShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[980px] flex-col justify-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="surface-panel border border-white/[0.08] p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.16),transparent_62%),rgba(6,11,17,0.92)] text-cyan">
              <Activity className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#6e8299]">{BRAND_NAME}</p>
              <p className="text-[15px] font-semibold text-[#eef5ff]">{BRAND_DESCRIPTOR}</p>
            </div>
          </div>

          <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.2em] text-[#6e8299]">
            {eyebrow}
          </p>
          <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.05em] text-[#f3f8ff]">
            {title}
          </h1>
          <p className="mt-4 max-w-[720px] text-[15px] leading-7 text-[#92a7bf]">
            {description}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {primaryAction}
            <Link
              href={secondaryHref}
              className="inline-flex h-11 items-center border border-white/[0.1] bg-white/[0.02] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee]"
            >
              {secondaryLabel}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
