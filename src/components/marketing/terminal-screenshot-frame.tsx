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
  { label: "Narrative tracking" },
  { label: "Momentum memecoins" },
  { label: "Validation workflow" },
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
    <div className={cn("relative", isHero ? "xl:[perspective:2800px]" : "", className)}>
      <div className="pointer-events-none absolute inset-0 rounded-[34px] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.16),transparent_34%),radial-gradient(circle_at_85%_18%,rgba(88,217,160,0.12),transparent_22%)] blur-2xl" />
      <div
        className={cn(
          "pointer-events-none absolute inset-x-[7%] bottom-[-8%] h-[28%] rounded-full bg-[rgba(0,0,0,0.45)] blur-3xl",
          isHero ? "xl:bottom-[-10%] xl:left-[10%] xl:right-[7%] xl:h-[24%] xl:blur-[56px]" : "",
        )}
      />

      <div
        className={cn(
          "relative",
          isHero
            ? "xl:[transform-style:preserve-3d] xl:[transform-origin:48%_54%] xl:[transform:rotateY(-2.4deg)_rotateX(0.45deg)]"
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
                isHero ? "bg-[#040810]" : "h-[300px] bg-[#040810] sm:h-[360px] lg:h-[464px]",
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
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {CALLOUTS.map((callout, index) => (
            <div
              key={callout.label}
              className={cn(
                "rounded-[16px] border px-3 py-3 text-[12px] uppercase tracking-[0.14em] shadow-[0_16px_34px_rgba(0,0,0,0.24)]",
                index === CALLOUTS.length - 1
                  ? "border-emerald/14 bg-[linear-gradient(180deg,rgba(77,219,147,0.08),rgba(255,255,255,0.03))] text-[#dcf4e7]"
                  : "border-white/[0.08] bg-white/[0.03] text-[#dce7f5]",
              )}
            >
              <span
                className={cn(
                  "mr-2 inline-block h-1.5 w-1.5",
                  index === CALLOUTS.length - 1 ? "bg-emerald" : "bg-cyan",
                )}
              />
              {callout.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
