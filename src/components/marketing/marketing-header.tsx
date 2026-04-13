"use client";

import Link from "next/link";
import { Activity } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { BRAND_DESCRIPTOR, BRAND_NAME } from "@/lib/brand";

type MarketingHeaderProps = {
  isAuthenticated: boolean;
  hasPaidAccess?: boolean;
};

const NAV_LINKS = [
  { href: "/#proof", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/#product", label: "Demo" },
] as const;

export function MarketingHeader({
  isAuthenticated,
  hasPaidAccess = false,
}: MarketingHeaderProps) {
  const [scrolled, setScrolled] = useState(false);

  const updateScrollState = useEffectEvent(() => {
    setScrolled(window.scrollY > 12);
  });

  useEffect(() => {
    updateScrollState();
    const listener = () => updateScrollState();
    window.addEventListener("scroll", listener, { passive: true });
    return () => window.removeEventListener("scroll", listener);
  }, []);

  const secondaryHref = hasPaidAccess
    ? "/dashboard"
    : isAuthenticated
      ? "/pricing"
      : "/sign-in";

  const secondaryLabel = hasPaidAccess
    ? "Dashboard"
    : isAuthenticated
      ? "Pricing"
      : "Sign In";

  const primaryHref = hasPaidAccess
    ? "/dashboard"
    : isAuthenticated
      ? "/pricing"
      : "/sign-up";

  return (
    <header
      className={[
        "sticky top-0 z-50 transition-all duration-200",
        scrolled
          ? "border-b border-white/[0.08] bg-[rgba(5,8,12,0.88)] backdrop-blur-xl"
          : "bg-transparent",
      ].join(" ")}
    >
      <div className="mx-auto flex w-full max-w-[1320px] items-center justify-between gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,18,28,0.98),rgba(6,10,16,0.98))] text-cyan shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <Activity className="h-4 w-4" />
          </span>

            <span className="min-w-0">
              <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-[#70849d]">
                {BRAND_NAME}
              </span>
              <span className="block truncate text-[15px] font-semibold tracking-[-0.03em] text-[#eef4fb]">
                {BRAND_DESCRIPTOR}
              </span>
            </span>
        </Link>

        <nav className="hidden items-center gap-8 lg:flex">
          {NAV_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#9ab0c7] transition-colors hover:text-[#eef4fb]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href={secondaryHref}
            className="hidden h-10 items-center px-3 text-[12px] font-medium uppercase tracking-[0.16em] text-[#adbed1] transition-colors hover:text-[#eef4fb] sm:inline-flex"
          >
            {secondaryLabel}
          </Link>
          <Link
            href={primaryHref}
            className="inline-flex h-10 items-center border border-cyan/24 bg-[linear-gradient(180deg,rgba(15,44,57,0.96),rgba(8,18,25,0.98))] px-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#effdff] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors hover:border-cyan/36"
          >
            Open Terminal
          </Link>
        </div>
      </div>
    </header>
  );
}
