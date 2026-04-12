"use client";

import Link from "next/link";
import { Activity } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

type MarketingHeaderProps = {
  isAuthenticated: boolean;
  hasPaidAccess?: boolean;
};

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
] as const;

export function MarketingHeader({
  isAuthenticated,
  hasPaidAccess = false,
}: MarketingHeaderProps) {
  const [scrolled, setScrolled] = useState(false);

  const updateScrollState = useEffectEvent(() => {
    setScrolled(window.scrollY > 18);
  });

  useEffect(() => {
    updateScrollState();
    const listener = () => updateScrollState();
    window.addEventListener("scroll", listener, { passive: true });
    return () => window.removeEventListener("scroll", listener);
  }, [updateScrollState]);

  return (
    <header
      className={[
        "sticky top-0 z-50 border-b transition-all duration-200",
        scrolled
          ? "border-white/[0.1] bg-[rgba(5,9,14,0.92)] backdrop-blur-xl"
          : "border-transparent bg-transparent",
      ].join(" ")}
    >
      <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.16),transparent_62%),rgba(6,11,17,0.92)] text-cyan shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <Activity className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.22em] text-[#6e8299]">
              Narrative To Asset
            </span>
            <span className="block text-[15px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
              Execution Surface
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#9ab0c7] transition-colors hover:text-[#eef5ff]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href={hasPaidAccess ? "/dashboard" : isAuthenticated ? "/pricing" : "/sign-in"}
            className="inline-flex h-10 items-center border border-white/[0.1] bg-white/[0.02] px-4 text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e0ee] transition-colors hover:border-white/[0.16] hover:bg-white/[0.05]"
          >
            {hasPaidAccess ? "Dashboard" : isAuthenticated ? "Pricing" : "Sign In"}
          </Link>
          <Link
            href={hasPaidAccess ? "/dashboard" : isAuthenticated ? "/pricing" : "/sign-up"}
            className="inline-flex h-10 items-center border border-cyan/25 bg-[linear-gradient(180deg,rgba(13,42,53,0.9),rgba(6,18,24,0.92))] px-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#eefdff] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_0_1px_rgba(86,217,255,0.06)] transition-colors hover:border-cyan/40 hover:text-white"
          >
            {hasPaidAccess ? "Open Terminal" : isAuthenticated ? "Unlock Access" : "Get Access"}
          </Link>
        </div>
      </div>
    </header>
  );
}
