import Image from "next/image";
import { cn } from "@/lib/utils/cn";

type TerminalScreenshotFrameProps = {
  variant?: "hero" | "detail";
  showCallouts?: boolean;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
};

const CALLOUTS = [
  {
    label: "Real-time narrative tracking",
    className: "left-[-14px] top-[21%]",
    lineClassName:
      "after:absolute after:right-[-48px] after:top-1/2 after:h-px after:w-12 after:-translate-y-1/2 after:bg-gradient-to-r after:from-[#77dfff] after:to-transparent",
  },
  {
    label: "Momentum-ranked memecoins",
    className: "left-[43%] top-[6%] -translate-x-1/2",
    lineClassName:
      "after:absolute after:left-1/2 after:top-full after:h-12 after:w-px after:-translate-x-1/2 after:bg-gradient-to-b after:from-[#77dfff] after:to-transparent",
  },
  {
    label: "Validation workflow",
    className: "right-[-10px] top-[22%]",
    lineClassName:
      "after:absolute after:left-[-48px] after:top-1/2 after:h-px after:w-12 after:-translate-y-1/2 after:bg-gradient-to-l after:from-[#7de0ad] after:to-transparent",
  },
] as const;

export function TerminalScreenshotFrame({
  variant = "detail",
  showCallouts = false,
  className,
  imageClassName,
  priority = false,
}: TerminalScreenshotFrameProps) {
  const isHero = variant === "hero";

  return (
    <div className={cn("relative", className)}>
      <div className="pointer-events-none absolute inset-0 rounded-[34px] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.16),transparent_34%),radial-gradient(circle_at_85%_18%,rgba(88,217,160,0.12),transparent_22%)] blur-2xl" />
      <div className="pointer-events-none absolute inset-x-[7%] bottom-[-8%] h-[28%] rounded-full bg-[rgba(0,0,0,0.45)] blur-3xl" />

      <div className="relative rounded-[30px] border border-white/[0.1] bg-[linear-gradient(180deg,rgba(10,16,24,0.98),rgba(5,8,13,0.995))] p-3 shadow-[0_38px_110px_rgba(0,0,0,0.46)]">
        <div className="rounded-[24px] border border-white/[0.08] bg-[#050912] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#f97373]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#f8be62]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#52d890]" />
              </div>
              <div className="hidden rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8fa4bd] sm:block">
                /trends
              </div>
            </div>

            <div className="text-right">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#6f849d]">
                {isHero ? "Actual Product Screenshot" : "Focused Product Crop"}
              </p>
              <p className="mt-1 text-[12px] text-[#b7c7d9]">
                Narrative to asset research terminal
              </p>
            </div>
          </div>

          <div
            className={cn(
              "relative overflow-hidden rounded-b-[24px]",
              isHero ? "" : "h-[320px] sm:h-[420px] lg:h-[560px]",
            )}
          >
            <Image
              src="/marketing/dashboard-terminal-hero.png"
              alt="Actual dashboard screenshot showing ranked narratives, momentum-ranked memecoins, and the validation workflow."
              width={1600}
              height={940}
              priority={priority}
              className={cn(
                isHero ? "h-auto w-full" : "h-full w-full object-cover object-[68%_center]",
                imageClassName,
              )}
              sizes={isHero ? "(min-width: 1024px) 58vw, 100vw" : "(min-width: 1024px) 50vw, 100vw"}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-3 text-[11px] uppercase tracking-[0.16em] text-[#8aa0b8] sm:px-3">
          <p>Real terminal UI, captured from the product preview surface</p>
          <p>Readable first. Effects kept minimal.</p>
        </div>
      </div>

      {showCallouts ? (
        <>
          <div className="pointer-events-none absolute inset-0 hidden xl:block">
            {CALLOUTS.map((callout) => (
              <div
                key={callout.label}
                className={cn(
                  "absolute rounded-full border border-white/[0.12] bg-[rgba(7,11,18,0.94)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#eef5ff] shadow-[0_18px_42px_rgba(0,0,0,0.42)]",
                  callout.className,
                  callout.lineClassName,
                )}
              >
                <span className="mr-2 inline-block h-1.5 w-1.5 bg-cyan" />
                {callout.label}
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:hidden">
            {CALLOUTS.map((callout) => (
              <div
                key={callout.label}
                className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-[12px] uppercase tracking-[0.14em] text-[#dce7f5]"
              >
                <span className="mr-2 inline-block h-1.5 w-1.5 bg-cyan" />
                {callout.label}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
