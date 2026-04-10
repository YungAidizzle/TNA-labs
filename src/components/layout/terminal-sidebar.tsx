"use client";

import Link from "next/link";
import { Activity, LockKeyhole, Search } from "lucide-react";
import {
  AppNavigationItem,
  getSidebarNavigationGroups,
  isNavigationItemActive,
} from "@/lib/constants/navigation";
import { cn } from "@/lib/utils/cn";

type TerminalSidebarProps = {
  pathname: string;
  onOpenCommandPalette: () => void;
};

function NavSection({
  heading,
  items,
  pathname,
}: {
  heading: string;
  items: AppNavigationItem[];
  pathname: string;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-3 px-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#5d7189]">
          {heading}
        </p>
        <span className="h-px flex-1 bg-[linear-gradient(90deg,rgba(126,147,171,0.2),rgba(126,147,171,0))]" />
      </div>

      <nav className="space-y-0.5" aria-label={heading}>
        {items.map((item, index) => {
          const Icon = item.icon;
          const active = isNavigationItemActive(pathname, item);
          const locked = item.status === "coming-soon";
          const showDescription = active || !locked;

          const itemClassName = cn(
            "group relative flex items-start gap-3 px-3 py-2.5 transition-[background-color,color,box-shadow] duration-150",
            index > 0 &&
              "before:absolute before:left-3 before:right-2 before:top-0 before:h-px before:bg-white/[0.05]",
            active && locked
              ? "bg-[linear-gradient(90deg,rgba(17,24,33,0.9),rgba(7,11,16,0.28))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_0_1px_rgba(255,255,255,0.06)]"
              : active
                ? "bg-[linear-gradient(90deg,rgba(13,37,49,0.78),rgba(7,11,16,0.22))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_0_1px_rgba(86,217,255,0.08),0_10px_28px_rgba(0,0,0,0.18)]"
                : "hover:bg-white/[0.035]",
          );

          const railClassName = cn(
            "absolute bottom-2 left-0 top-2 w-px transition-all",
            active && locked
              ? "bg-white/[0.26] opacity-100 shadow-[0_0_12px_rgba(255,255,255,0.08)]"
              : active
                ? "bg-cyan opacity-100 shadow-[0_0_18px_rgba(86,217,255,0.52)]"
                : "bg-white/[0.1] opacity-0 group-hover:opacity-100",
          );

          const iconClassName = cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center transition-colors",
            active && locked
              ? "text-[#d7e2ef]"
              : active
                ? "text-cyan"
                : locked
                  ? "text-[#61758d]"
                  : "text-[#8095ad] group-hover:text-[#dce6f2]",
          );

          const labelClassName = cn(
            "truncate text-[13px] leading-[1.2]",
            active && locked
              ? "font-semibold text-[#eef4fb]"
              : active
                ? "font-semibold text-[#eef7ff]"
                : locked
                  ? "font-medium text-[#91a4ba] group-hover:text-[#c4d2e2]"
                  : "font-medium text-[#bccbdd] group-hover:text-[#edf4ff]",
          );

          const descriptionClassName = cn(
            "mt-1 block truncate text-[11.5px] leading-[1.45]",
            active
              ? "text-[#8ea4be]"
              : "text-[#677d97]",
          );

          const statusClassName = cn(
            "ml-2 mt-0.5 inline-flex shrink-0 items-center gap-1 text-[9.5px] font-medium uppercase tracking-[0.16em]",
            active ? "text-[#8ea4be]" : "text-[#647890] group-hover:text-[#879cb6]",
          );

          const shortcutClassName = cn(
            "ml-2 mt-0.5 shrink-0 font-mono text-[11px]",
            active ? "text-[#98aec7]" : "text-[#6f86a2] group-hover:text-[#b7c8dc]",
          );

          const content = (
            <>
              <span className={railClassName} />
              <span className={iconClassName}>
                <Icon className="h-4 w-4" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={labelClassName}>{item.label}</span>
                </span>
                {showDescription ? (
                  <span className={descriptionClassName}>{item.description}</span>
                ) : null}
              </span>

              {locked ? (
                <span className={statusClassName}>
                  <LockKeyhole className="h-3 w-3" />
                  Staged
                </span>
              ) : item.shortcut ? (
                <span className={shortcutClassName}>Alt+{item.shortcut}</span>
              ) : null}
            </>
          );

          if (locked) {
            return (
              <div
                key={item.href}
                aria-disabled="true"
                className={cn(itemClassName, "cursor-default select-none")}
              >
                {content}
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={itemClassName}
            >
              {content}
            </Link>
          );
        })}
      </nav>
    </section>
  );
}

export function TerminalSidebar({
  pathname,
  onOpenCommandPalette,
}: TerminalSidebarProps) {
  const sidebarGroups = getSidebarNavigationGroups(pathname);
  const stagedCount = sidebarGroups.reduce(
    (count, group) => count + group.items.filter((item) => item.status === "coming-soon").length,
    0,
  );

  return (
    <aside className="hidden h-full w-[256px] shrink-0 border-r border-white/[0.07] bg-[radial-gradient(circle_at_top_left,rgba(86,217,255,0.07),transparent_24%),linear-gradient(180deg,rgba(7,11,16,0.99),rgba(3,6,10,0.995))] lg:flex lg:flex-col">
      <div className="border-b border-white/[0.07] px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.16),transparent_62%),rgba(6,11,17,0.92)] text-cyan shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <Activity className="h-4 w-4" />
          </div>

          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#62778f]">
              Narrative To Asset
            </p>
            <p className="mt-1 truncate text-[18px] font-semibold tracking-[-0.03em] text-[#eef5ff]">
              Execution Surface
            </p>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-[#7b8fa8]">
              <span className="h-1.5 w-1.5 shrink-0 bg-emerald shadow-[0_0_12px_rgba(77,219,147,0.65)]" />
              <span>Live terminal</span>
              <span className="text-[#4e6279]">/</span>
              <span>{stagedCount} staged modules</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-5">
          {sidebarGroups.map((group) => (
            <NavSection
              key={group.key}
              heading={group.label}
              items={group.items}
              pathname={pathname}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-white/[0.07] px-3 py-3">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="group flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.035]"
        >
          <span className="flex min-w-0 items-center gap-3">
            <Search className="h-4 w-4 shrink-0 text-[#6f87a2] transition-colors group-hover:text-cyan" />
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium text-[#dce6f2]">
                Search modules
              </span>
              <span className="block truncate text-[11px] text-[#637a95]">
                Open live and staged routes without crowding the sidebar
              </span>
            </span>
          </span>

          <span className="shrink-0 border border-white/[0.08] bg-[#050b12] px-1.5 py-1 font-mono text-[11px] text-[#8fa4bd] transition-colors group-hover:border-white/[0.12] group-hover:text-[#e3edf9]">
            Ctrl K
          </span>
        </button>

        <p className="px-3 pt-2 text-[10px] uppercase tracking-[0.16em] text-[#53677f]">
          Institutional terminal workflow
        </p>
      </div>
    </aside>
  );
}
