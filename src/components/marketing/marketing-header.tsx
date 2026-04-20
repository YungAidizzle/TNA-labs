"use client";

import Link from "next/link";
import { Activity } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { BRAND_DESCRIPTOR, BRAND_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils/cn";

type MarketingHeaderProps = {
  isAuthenticated: boolean;
  hasPaidAccess?: boolean;
  tone?: "default" | "subdued";
  mobileVariant?: "default" | "minimal";
  mobilePrimaryLabel?: string;
};

const NAV_LINKS = [
  { href: "/#proof", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/#product", label: "Platform" },
] as const;

export function MarketingHeader({
  isAuthenticated,
  hasPaidAccess = false,
  tone = "default",
  mobileVariant = "default",
  mobilePrimaryLabel,
}: MarketingHeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const isSubdued = tone === "subdued";
  const isMinimalMobile = mobileVariant === "minimal";

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

  const primaryLabel = "Open Terminal";

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-200",
        scrolled
          ? isSubdued
            ? "border-b border-white/[0.06] bg-[rgba(5,8,12,0.74)] backdrop-blur-xl"
            : "border-b border-white/[0.08] bg-[rgba(5,8,12,0.88)] backdrop-blur-xl"
          : "bg-transparent",
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full items-center justify-between gap-5 px-4 sm:px-6 lg:px-8",
          isSubdued ? "max-w-[1440px] py-3 sm:py-3.5" : "max-w-[1320px] py-3.5 sm:py-4",
        )}
      >
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center bg-[linear-gradient(180deg,rgba(10,18,28,0.98),rgba(6,10,16,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
              isSubdued
                ? "border border-white/[0.06] text-[#8dd9ff]"
                : "border border-white/[0.08] text-cyan",
            )}
          >
            <Activity className="h-4 w-4" />
          </span>

          <span className="min-w-0">
            <span
              className={cn(
                "block truncate text-[10px] font-semibold uppercase tracking-[0.22em]",
                isSubdued ? "text-[#677d95]" : "text-[#70849d]",
              )}
            >
              {BRAND_NAME}
            </span>
            <span
              className={cn(
                "block truncate text-[15px] font-semibold tracking-[-0.03em]",
                isSubdued ? "text-[#dfe8f2]" : "text-[#eef4fb]",
                isMinimalMobile ? "hidden sm:block" : "",
              )}
            >
              {BRAND_DESCRIPTOR}
            </span>
          </span>
        </Link>

        <nav className={cn("hidden items-center lg:flex", isSubdued ? "gap-7" : "gap-8")}>
          {NAV_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "text-[12px] font-medium uppercase tracking-[0.16em] transition-colors",
                isSubdued
                  ? "text-[#8196ad] hover:text-[#dbe6f2]"
                  : "text-[#9ab0c7] hover:text-[#eef4fb]",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href={secondaryHref}
            className={cn(
              "hidden h-10 items-center px-3 text-[12px] font-medium uppercase tracking-[0.16em] transition-colors sm:inline-flex",
              isSubdued
                ? "text-[#8ea1b3] hover:text-[#e3edf7]"
                : "text-[#adbed1] hover:text-[#eef4fb]",
            )}
          >
            {secondaryLabel}
          </Link>
          <Link
            href={primaryHref}
            className={cn(
              "inline-flex h-10 items-center px-4 text-[12px] font-semibold uppercase tracking-[0.16em] transition-colors",
              isSubdued
                ? "border border-white/[0.1] bg-white/[0.025] text-[#e2ebf6] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-white/[0.16] hover:bg-white/[0.045]"
                : "border border-cyan/24 bg-[linear-gradient(180deg,rgba(15,44,57,0.96),rgba(8,18,25,0.98))] text-[#effdff] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-cyan/36",
            )}
          >
            {mobilePrimaryLabel ? (
              <>
                <span className="md:hidden">{mobilePrimaryLabel}</span>
                <span className="hidden md:inline">{primaryLabel}</span>
              </>
            ) : (
              primaryLabel
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
