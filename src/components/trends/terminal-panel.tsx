import { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type TerminalPanelProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  disclaimer?: ReactNode;
  tone?: "neutral" | "cyan" | "emerald" | "amber";
  moduleId?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
};

const TONE_STYLES: Record<NonNullable<TerminalPanelProps["tone"]>, string> = {
  neutral:
    "before:from-transparent before:via-white/16 before:to-transparent",
  cyan:
    "before:from-transparent before:via-cyan/48 before:to-transparent",
  emerald:
    "before:from-transparent before:via-emerald/48 before:to-transparent",
  amber:
    "before:from-transparent before:via-amber/48 before:to-transparent",
};

export function TerminalPanel({
  title,
  subtitle,
  action,
  disclaimer,
  tone = "neutral",
  moduleId,
  className,
  bodyClassName,
  children,
}: TerminalPanelProps) {
  return (
    <section
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden border border-[#223141] bg-[linear-gradient(180deg,rgba(9,14,21,0.992),rgba(6,9,14,0.996))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_26px_rgba(0,0,0,0.28)] before:absolute before:left-0 before:right-0 before:top-0 before:h-px",
        TONE_STYLES[tone],
        className,
      )}
    >
      <header className="flex min-h-[56px] shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[#1b2735] bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0))] px-4 py-2.5">
        <div className="min-w-[120px] flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5", tone === "cyan" ? "bg-cyan" : tone === "emerald" ? "bg-emerald" : tone === "amber" ? "bg-amber" : "bg-[#8299b4]")} />
            <p className="truncate text-[17px] font-semibold text-[#e3ebf8]">
              {title}
            </p>
            {moduleId ? (
              <span className="border border-white/[0.12] bg-white/[0.03] px-1.5 py-[2px] font-mono text-[11px] text-[#7d92ad]">
                {moduleId}
              </span>
            ) : null}
          </div>
          {subtitle ? (
            <p className="mt-1 truncate text-[13px] text-[#6f839c]">{subtitle}</p>
          ) : null}
        </div>
        {action ? <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">{action}</div> : null}
      </header>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
      {disclaimer ? (
        <div className="border-t border-[#1b2735] bg-[#07101a] px-4 py-2 text-[11px] uppercase tracking-[0.14em] text-[#7a8fa8]">
          {disclaimer}
        </div>
      ) : null}
    </section>
  );
}
