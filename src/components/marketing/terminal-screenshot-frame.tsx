import Image from "next/image";
import { cn } from "@/lib/utils/cn";

type TerminalScreenshotFrameProps = {
  variant?: "hero" | "detail";
  showCallouts?: boolean;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
};

const MASTER_SCREENSHOT_SRC = "/marketing/dashboard-terminal-hero-hq.png";
const MASTER_SCREENSHOT_WIDTH = 1876;
const MASTER_SCREENSHOT_HEIGHT = 928;

const CALLOUTS = [
  {
    label: "Narrative tracking",
    className: "left-[-182px] top-[26%]",
    lineClassName:
      "after:absolute after:right-[-118px] after:top-1/2 after:h-px after:w-[112px] after:-translate-y-1/2 after:bg-gradient-to-r after:from-[#77dfff] after:to-transparent before:absolute before:right-[-124px] before:top-1/2 before:h-2 before:w-2 before:-translate-y-1/2 before:rounded-full before:bg-cyan before:shadow-[0_0_14px_rgba(86,217,255,0.45)]",
  },
  {
    label: "Momentum memecoins",
    className: "left-1/2 top-[-66px] -translate-x-1/2",
    lineClassName:
      "after:absolute after:left-1/2 after:top-full after:h-[58px] after:w-px after:-translate-x-1/2 after:bg-gradient-to-b after:from-[#77dfff] after:to-transparent before:absolute before:left-1/2 before:top-[calc(100%+56px)] before:h-2 before:w-2 before:-translate-x-1/2 before:rounded-full before:bg-cyan before:shadow-[0_0_14px_rgba(86,217,255,0.45)]",
  },
  {
    label: "Validation workflow",
    className: "right-[-178px] top-[26%]",
    lineClassName:
      "after:absolute after:left-[-118px] after:top-1/2 after:h-px after:w-[112px] after:-translate-y-1/2 after:bg-gradient-to-l after:from-[#7de0ad] after:to-transparent before:absolute before:left-[-124px] before:top-1/2 before:h-2 before:w-2 before:-translate-y-1/2 before:rounded-full before:bg-emerald before:shadow-[0_0_14px_rgba(77,219,147,0.42)]",
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
    <div className={cn("relative", isHero ? "lg:[perspective:3200px]" : "", className)}>
      <div className="pointer-events-none absolute inset-0 rounded-[34px] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.16),transparent_34%),radial-gradient(circle_at_85%_18%,rgba(88,217,160,0.12),transparent_22%)] blur-2xl" />
      <div
        className={cn(
          "pointer-events-none absolute inset-x-[7%] bottom-[-8%] h-[28%] rounded-full bg-[rgba(0,0,0,0.45)] blur-3xl",
          isHero ? "lg:bottom-[-10%] lg:left-[16%] lg:right-[4%] lg:h-[26%] lg:blur-[68px]" : "",
        )}
      />

      <div
        className={cn(
          "relative",
          isHero
            ? "lg:[transform-style:preserve-3d] lg:[transform-origin:20%_56%] lg:[transform:rotateY(-4.75deg)_rotateX(0.7deg)]"
            : "",
        )}
      >
        <div
          className={cn(
            "relative rounded-[30px] border border-white/[0.1] bg-[linear-gradient(180deg,rgba(10,16,24,0.98),rgba(5,8,13,0.995))] p-3 shadow-[0_38px_110px_rgba(0,0,0,0.46)]",
            isHero
              ? "lg:shadow-[18px_36px_110px_rgba(0,0,0,0.46),-14px_14px_34px_rgba(5,11,18,0.12)]"
              : "",
          )}
        >
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
                  {isHero ? "Live Terminal View" : "Linked Asset Detail"}
                </p>
                <p className="mt-1 text-[12px] text-[#b7c7d9]">
                  Ranked narratives, linked memecoins, and validation context
                </p>
              </div>
            </div>

            <div
              className={cn(
                "relative overflow-hidden rounded-b-[24px]",
                isHero ? "" : "h-[300px] sm:h-[360px] lg:h-[464px]",
              )}
            >
              <Image
                src={MASTER_SCREENSHOT_SRC}
                alt="Actual dashboard screenshot showing ranked narratives, momentum-ranked memecoins, and the validation workflow."
                width={MASTER_SCREENSHOT_WIDTH}
                height={MASTER_SCREENSHOT_HEIGHT}
                priority={priority}
                unoptimized
                className={cn(
                  isHero ? "h-auto w-full" : "h-full w-full object-cover object-[68%_center]",
                  imageClassName,
                )}
                sizes={isHero ? "(min-width: 1280px) 900px, (min-width: 1024px) 62vw, 100vw" : "(min-width: 1280px) 620px, (min-width: 1024px) 48vw, 100vw"}
              />
            </div>
          </div>

          {isHero ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-3 text-[11px] uppercase tracking-[0.16em] text-[#8aa0b8] sm:px-3">
              <p>Live ranking, linked assets, and market response in one terminal</p>
              <p>Built for narrative-first crypto research</p>
            </div>
          ) : (
            <div className="px-2 pt-3 text-[11px] uppercase tracking-[0.16em] text-[#8aa0b8] sm:px-3">
              Linked assets and validation context in one view
            </div>
          )}
        </div>
      </div>

      {showCallouts ? (
        <>
          <div className="pointer-events-none absolute inset-0 hidden 2xl:block">
            {CALLOUTS.map((callout) => (
              <div
                key={callout.label}
                className={cn(
                  "absolute rounded-full border border-white/[0.12] bg-[rgba(7,11,18,0.96)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#eef5ff] shadow-[0_18px_42px_rgba(0,0,0,0.42)]",
                  callout.className,
                  callout.lineClassName,
                )}
              >
                <span className="mr-2 inline-block h-1.5 w-1.5 bg-cyan" />
                {callout.label}
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3 2xl:hidden">
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
