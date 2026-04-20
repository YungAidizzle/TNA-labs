import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BRAND_DESCRIPTOR, BRAND_NAME } from "@/lib/brand";
import {
  LEGAL_CONTACT,
  getSupportContactHref,
} from "@/lib/legal/contact-details";
import { cn } from "@/lib/utils/cn";

export type LandingPageProps = {
  isAuthenticated: boolean;
  hasPaidAccess: boolean;
  pricing: {
    productName: string;
    displayPrice: string;
    billingInterval: string;
  } | null;
};

export function SectionIntro({
  eyebrow,
  title,
  text,
  className,
}: {
  eyebrow: string;
  title: string;
  text: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-[720px]", className)}>
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

export function PrimaryCta({
  href,
  children,
  className,
  arrow = true,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  arrow?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-12 items-center gap-2 border border-cyan/24 bg-[linear-gradient(180deg,rgba(16,45,58,0.96),rgba(8,19,26,0.98))] px-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#f1fdff] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_18px_40px_rgba(0,0,0,0.28)] transition-colors hover:border-cyan/36",
        className,
      )}
    >
      {children}
      {arrow ? <ArrowRight className="h-4 w-4" /> : null}
    </Link>
  );
}

export function SecondaryCta({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-12 items-center border border-white/[0.1] bg-white/[0.03] px-5 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d8e2ee] transition-colors hover:border-white/[0.16] hover:bg-white/[0.05]",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function LandingFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-4 py-10 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#70849d]">
          {BRAND_NAME}
        </p>
        <p className="mt-3 text-[24px] font-semibold tracking-[-0.04em] text-[#eef4fb]">
          {BRAND_DESCRIPTOR}
        </p>
        <p className="mt-3 max-w-[520px] text-[14px] leading-7 text-[#859ab2]">
          Track internet narratives, review linked memecoins, and validate market
          context from one platform built for serious crypto monitoring.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[12px] font-medium uppercase tracking-[0.16em] text-[#9ab0c7] sm:flex sm:flex-wrap">
        <Link href="/#proof" className="hover:text-[#eef4fb]">
          Features
        </Link>
        <Link href="/pricing" className="hover:text-[#eef4fb]">
          Pricing
        </Link>
        <Link href="/#faq" className="hover:text-[#eef4fb]">
          FAQ
        </Link>
        <Link href="/#product" className="hover:text-[#eef4fb]">
          Platform
        </Link>
        <Link href="/privacy" className="hover:text-[#eef4fb]">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-[#eef4fb]">
          Terms
        </Link>
        <Link href="/risk-disclosure" className="hover:text-[#eef4fb]">
          Risk Disclosure
        </Link>
        <Link href="/refund-policy" className="hover:text-[#eef4fb]">
          Refund Policy
        </Link>
        {LEGAL_CONTACT.supportEmail ? (
          <a
            href={getSupportContactHref("support") ?? undefined}
            className="hover:text-[#eef4fb]"
          >
            Support
          </a>
        ) : null}
      </div>
    </footer>
  );
}
