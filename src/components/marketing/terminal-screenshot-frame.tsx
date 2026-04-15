import Image from "next/image";
import masterScreenshot from "../../../public/marketing/dashboard-terminal-hero-hq.png";
import { cn } from "@/lib/utils/cn";

type TerminalScreenshotFrameProps = {
  variant?: "hero" | "detail";
  showCallouts?: boolean;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
};

const HERO_CALLOUTS = [
  {
    label: "Narrative List",
    alignmentClassName: "justify-start",
    markerClassName: "left-[18px]",
    toneClassName: "border-cyan/18 bg-[rgba(8,18,28,0.9)] text-[#e4f8ff]",
    accentClassName: "bg-cyan",
  },
  {
    label: "Memecoin Table",
    alignmentClassName: "justify-center",
    markerClassName: "left-1/2 -translate-x-1/2",
    toneClassName: "border-cyan/18 bg-[rgba(8,18,28,0.9)] text-[#e4f8ff]",
    accentClassName: "bg-cyan",
  },
  {
    label: "Validation Panel",
    alignmentClassName: "justify-end",
    markerClassName: "right-[18px]",
    toneClassName: "border-emerald/18 bg-[rgba(8,18,28,0.9)] text-[#ddf5e7]",
    accentClassName: "bg-emerald",
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
      <div className="pointer-events-none absolute inset-0 rounded-[34px] bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.12),transparent_34%),radial-gradient(circle_at_85%_18%,rgba(88,217,160,0.08),transparent_22%)] blur-xl" />
      <div
        className={cn(
          "pointer-events-none absolute inset-x-[7%] bottom-[-8%] h-[28%] rounded-full bg-[rgba(0,0,0,0.45)] blur-3xl",
          isHero ? "xl:bottom-[-10%] xl:left-[10%] xl:right-[7%] xl:h-[24%] xl:blur-[56px]" : "",
        )}
      />

      <div className="relative">
        {isHero && showCallouts ? (
          <div className="mb-3 hidden grid-cols-[0.96fr_1fr_0.78fr] gap-3 px-3 xl:grid">
            {HERO_CALLOUTS.map((callout) => (
              <div
                key={callout.label}
                className={cn(
                  "relative flex min-w-0 pb-4",
                  callout.alignmentClassName,
                )}
              >
                <div
                  className={cn(
                    "inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] shadow-[0_12px_28px_rgba(0,0,0,0.18)]",
                    callout.toneClassName,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 shrink-0", callout.accentClassName)} />
                  <span className="truncate">{callout.label}</span>
                </div>

                <span
                  className={cn(
                    "pointer-events-none absolute bottom-0 h-4 w-px bg-white/[0.18]",
                    callout.markerClassName,
                  )}
                />
                <span
                  className={cn(
                    "pointer-events-none absolute -bottom-0.5 h-1.5 w-1.5 rounded-full",
                    callout.accentClassName,
                    callout.markerClassName,
                  )}
                />
              </div>
            ))}
          </div>
        ) : null}

        <div
          className={cn(
            "relative rounded-[30px] border border-white/[0.1] bg-[linear-gradient(180deg,rgba(10,16,24,0.98),rgba(5,8,13,0.995))] p-3 shadow-[0_38px_110px_rgba(0,0,0,0.46)]",
            isHero
              ? "border-white/[0.12] lg:shadow-[18px_36px_110px_rgba(0,0,0,0.46),-14px_14px_34px_rgba(5,11,18,0.12)]"
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
                src={masterScreenshot}
                alt="Actual dashboard screenshot showing ranked narratives, momentum-ranked memecoins, and the validation workflow."
                width={masterScreenshot.width}
                height={masterScreenshot.height}
                priority={priority}
                quality={100}
                className={cn(
                  isHero ? "block h-auto w-full" : "block h-full w-full object-cover object-[68%_center]",
                  imageClassName,
                )}
                sizes={
                  isHero
                    ? "(min-width: 1536px) 760px, (min-width: 1280px) 700px, (min-width: 1024px) 52vw, 100vw"
                    : "(min-width: 1280px) 620px, (min-width: 1024px) 48vw, 100vw"
                }
              />
            </div>
          </div>

          {isHero ? (
            <div className="space-y-3 px-2 pt-3 sm:px-3">
              <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e4f3]">
                Detect the narrative. Match the coin. Validate the move.
              </p>
              {showCallouts ? (
                <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em] text-[#93a8bf] xl:hidden">
                  {HERO_CALLOUTS.map((callout) => (
                    <span
                      key={callout.label}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5",
                        callout.toneClassName,
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5", callout.accentClassName)} />
                      {callout.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="px-2 pt-3 text-[11px] uppercase tracking-[0.16em] text-[#8aa0b8] sm:px-3">
              Linked assets and validation context in one view
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
