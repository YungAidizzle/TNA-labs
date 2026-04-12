"use client";

import { Activity } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";
import { buttonClassName, joinClasses } from "@/components/ui/button";
import { InteractiveLink } from "@/components/ui/interactive-link";

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
  const pathname = usePathname();
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
          ? "border-white/[0.08] bg-[rgba(3,7,12,0.88)] backdrop-blur-2xl"
          : "border-transparent bg-transparent",
      ].join(" ")}
    >
      <div className="mx-auto flex w-full max-w-[1320px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <InteractiveLink
          href="/"
          pendingLabel="Opening site home"
          navigationLabel="Opening site home"
          className="group flex items-center gap-3"
        >
          <span className="flex h-10 w-10 items-center justify-center border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.18),transparent_62%),rgba(6,11,17,0.92)] text-cyan shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-transform duration-200 group-hover:-translate-y-[1px]">
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
        </InteractiveLink>

        <nav className="hidden items-center gap-2 md:flex">
          {NAV_LINKS.map((item) => (
            <InteractiveLink
              key={item.href}
              href={item.href}
              pendingLabel={
                item.href.startsWith("/#")
                  ? item.label
                  : `Opening ${item.label.toLowerCase()}`
              }
              navigationLabel={
                item.href.startsWith("/#")
                  ? undefined
                  : `Opening ${item.label.toLowerCase()}`
              }
              className="nav-link"
              ariaLabel={item.label}
              active={
                item.href === "/"
                  ? pathname === "/"
                  : item.href === "/pricing"
                    ? pathname === "/pricing"
                    : false
              }
            >
              {item.label}
            </InteractiveLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <InteractiveLink
            href={hasPaidAccess ? "/dashboard" : isAuthenticated ? "/pricing" : "/sign-in"}
            pendingLabel="Opening access controls"
            navigationLabel="Opening access controls"
            className={buttonClassName({
              tone: "secondary",
              size: "sm",
            })}
          >
            {hasPaidAccess ? "Dashboard" : isAuthenticated ? "Pricing" : "Sign In"}
          </InteractiveLink>
          <InteractiveLink
            href={hasPaidAccess ? "/dashboard" : isAuthenticated ? "/pricing" : "/sign-up"}
            pendingLabel={
              hasPaidAccess
                ? "Opening terminal"
                : isAuthenticated
                  ? "Opening membership controls"
                  : "Opening account setup"
            }
            navigationLabel={
              hasPaidAccess
                ? "Opening terminal"
                : isAuthenticated
                  ? "Opening membership controls"
                  : "Opening account setup"
            }
            className={joinClasses(
              buttonClassName({
                tone: "primary",
                size: "sm",
              }),
              "hidden sm:inline-flex",
            )}
          >
            {hasPaidAccess ? "Open Terminal" : isAuthenticated ? "Unlock Access" : "Get Access"}
          </InteractiveLink>
        </div>
      </div>
    </header>
  );
}
