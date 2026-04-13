"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Search } from "lucide-react";
import { ReactNode, useEffect, useEffectEvent, useMemo, useState } from "react";
import {
  NAV_ITEMS,
  getNavigationItemByPathname,
  isDashboardSurfacePath,
} from "@/lib/constants/navigation";
import { PageTransition } from "@/components/layout/page-transition";
import { TerminalSidebar } from "@/components/layout/terminal-sidebar";
import { BRAND_NAME } from "@/lib/brand";
import {
  LEGAL_CONTACT,
  getSupportContactHref,
} from "@/lib/legal/contact-details";
import { EXPANDED_PRODUCT_DISCLAIMER, SHORT_PRODUCT_DISCLAIMER } from "@/lib/legal/disclaimers";
import { cn } from "@/lib/utils/cn";
import { useAppStore } from "@/store/app-store";

const LazyCommandPalette = dynamic(
  () => import("@/components/layout/command-palette").then((mod) => mod.CommandPalette),
  { ssr: false },
);

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const setCommandPaletteOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const isDashboardSurfaceRoute = isDashboardSurfacePath(pathname);
  const [commandPaletteMounted, setCommandPaletteMounted] = useState(false);

  const openCommandPalette = () => {
    if (!commandPaletteMounted) {
      setCommandPaletteMounted(true);
    }
    setCommandPaletteOpen(true);
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCommandPalette();
      return;
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const matchingRoute = NAV_ITEMS.find(
        (item) => item.shortcut === event.key,
      );
      if (matchingRoute) {
        event.preventDefault();
        router.push(matchingRoute.href);
      }
    }

    if (event.key === "Escape" && commandPaletteOpen) {
      event.preventDefault();
      setCommandPaletteOpen(false);
    }
  });

  const activeRouteLabel = useMemo(
    () => getNavigationItemByPathname(pathname)?.label ?? "Trends",
    [pathname],
  );

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <div className="app-grid flex h-full overflow-hidden bg-background text-foreground">
      <TerminalSidebar
        pathname={pathname}
        onOpenCommandPalette={openCommandPalette}
      />

      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,11,16,0.985),rgba(6,9,14,0.95))] px-3 py-2 shadow-[0_10px_24px_rgba(0,0,0,0.24)] lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-cyan/18 bg-[#050c14] text-cyan">
                <Activity className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-[#70859f]">
                  {BRAND_NAME}
                </p>
                <p className="truncate text-[18px] font-semibold text-[#e9f0fb]">
                  {activeRouteLabel}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={openCommandPalette}
              className="inline-flex h-9 items-center gap-2 border border-white/[0.1] bg-white/[0.03] px-3 text-[13px] font-medium text-[#b4c4d8] transition-colors hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-[#eef4ff]"
            >
              <Search className="h-4 w-4" />
              <span>Search</span>
            </button>
          </div>
        </div>

        <main
          className={cn(
            "min-h-0 flex-1",
            isDashboardSurfaceRoute
              ? "overflow-hidden p-2.5 md:p-3 lg:p-3"
              : "overflow-y-auto p-3 md:p-4",
          )}
        >
          <PageTransition className="h-full min-h-0">
            {children}
          </PageTransition>
        </main>

        <footer className="border-t border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,11,16,0.98),rgba(4,7,11,0.99))] px-4 py-3 text-[12px] text-[#91a6bf]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <p>{SHORT_PRODUCT_DISCLAIMER}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2 uppercase tracking-[0.14em] text-[#99aec5]">
              <Link href="/risk-disclosure" className="hover:text-[#eef5ff]">Risk Disclosure</Link>
              <Link href="/terms" className="hover:text-[#eef5ff]">Terms</Link>
              <Link href="/privacy" className="hover:text-[#eef5ff]">Privacy</Link>
              <Link href="/settings" className="hover:text-[#eef5ff]">Settings</Link>
              {LEGAL_CONTACT.supportEmail ? (
                <a href={getSupportContactHref("support") ?? undefined} className="hover:text-[#eef5ff]">
                  Support
                </a>
              ) : null}
            </div>
          </div>

          <details className="mt-3 text-[12px] leading-6 text-[#7388a2]">
            <summary className="cursor-pointer uppercase tracking-[0.14em] text-[#8fa4bd]">
              Compliance summary
            </summary>
            <div className="mt-2 space-y-1">
              {EXPANDED_PRODUCT_DISCLAIMER.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </details>
        </footer>
      </div>

      {commandPaletteMounted ? <LazyCommandPalette /> : null}
    </div>
  );
}
