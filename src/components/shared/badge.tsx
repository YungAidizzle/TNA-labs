import { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

const toneClasses = {
  cyan: "border-cyan/30 bg-cyan/8 text-cyan",
  emerald: "border-emerald/30 bg-emerald/8 text-emerald",
  amber: "border-amber/30 bg-amber/8 text-amber",
  rose: "border-rose/30 bg-rose/8 text-rose",
  violet: "border-violet/30 bg-violet/8 text-violet",
  neutral: "border-border bg-white/3 text-muted",
} as const;

type BadgeProps = {
  children: ReactNode;
  tone?: keyof typeof toneClasses;
  className?: string;
};

export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center border px-2.5 py-1 text-[12px] font-medium tracking-[0.03em]",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
