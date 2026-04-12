import Link from "next/link";
import { ArrowRight, LockKeyhole, Milestone } from "lucide-react";
import {
  AppNavigationItem,
  getNavigationGroupLabel,
} from "@/lib/constants/navigation";
import { TerminalPanel } from "@/components/trends/terminal-panel";

type DashboardRoutePlaceholderProps = {
  item: AppNavigationItem;
};

const GROUP_TONE = {
  workspace: "cyan",
  intelligence: "amber",
  system: "neutral",
} as const;

export function DashboardRoutePlaceholder({
  item,
}: DashboardRoutePlaceholderProps) {
  const Icon = item.icon;
  const groupLabel = getNavigationGroupLabel(item.group);
  const tone = GROUP_TONE[item.group];
  const locked = item.status === "coming-soon";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid={`module-placeholder-${item.id}`}>
      <TerminalPanel
        title={item.label}
        subtitle={`${groupLabel} module`}
        tone={tone}
        moduleId={item.moduleId}
        className="h-full min-h-0"
        bodyClassName="overflow-y-auto"
      >
        <div className="relative flex h-full min-h-[520px] flex-col gap-4 p-5 md:p-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(86,217,255,0.07),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_24%)]" />

          <section className="relative border border-white/[0.08] bg-[linear-gradient(180deg,rgba(12,18,27,0.98),rgba(7,11,16,0.99))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="border border-white/[0.1] bg-white/[0.03] px-1.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[#8ea4be]">
                    {groupLabel}
                  </span>
                  {locked ? (
                    <span className="inline-flex items-center gap-1 border border-white/[0.12] bg-white/[0.04] px-1.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[#dce8f6]">
                      <LockKeyhole className="h-3 w-3" />
                      Coming Soon
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex items-start gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-white/[0.1] bg-[#07101a] text-[#dce8f6]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6d829d]">
                      Staged Module
                    </p>
                    <h1 className="mt-2 text-[32px] font-semibold tracking-[-0.04em] text-[#eef5ff]">
                      {item.label}
                    </h1>
                    <p className="mt-3 max-w-3xl text-[14px] leading-[1.75] text-[#a5b7cd]">
                      {item.placeholderDescription}
                    </p>
                  </div>
                </div>
              </div>

              <div className="min-w-[220px] border border-white/[0.08] bg-[#060b11] p-4">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7890ac]">
                  <Milestone className="h-4 w-4 text-cyan" />
                  Rollout State
                </div>
                <p className="mt-3 text-[13px] leading-[1.65] text-[#cad7e8]">
                  Navigation is live and the route is wired into the dashboard shell. Actions and data
                  surfaces stay locked until this module is promoted beyond roadmap stage.
                </p>
              </div>
            </div>
          </section>

          <section className="relative grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.9fr)]">
            <div className="border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,15,22,0.96),rgba(6,9,14,0.99))] p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7890ac]">
                Planned Scope
              </p>
              <ul className="mt-4 space-y-3">
                {item.placeholderHighlights.map((highlight) => (
                  <li key={highlight} className="flex items-start gap-3 text-[13px] leading-[1.7] text-[#d7e2ef]">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-cyan" />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col justify-between gap-4 border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,15,22,0.96),rgba(6,9,14,0.99))] p-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7890ac]">
                  Current Access
                </p>
                <p className="mt-4 text-[13px] leading-[1.7] text-[#cad7e8]">
                  Overview stays unlocked as the live research surface. This module remains visible now so
                  the product roadmap is explicit inside the terminal instead of hidden behind future releases.
                </p>
              </div>

              <Link
                href="/trends"
                className="inline-flex items-center justify-between border border-cyan/22 bg-cyan/10 px-4 py-3 text-[13px] font-semibold text-cyan transition-colors hover:bg-cyan/14"
              >
                <span>Return to Overview</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>
        </div>
      </TerminalPanel>
    </div>
  );
}
