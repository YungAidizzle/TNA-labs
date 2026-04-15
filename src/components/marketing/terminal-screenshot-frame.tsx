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

const HERO_REGIONS = [
  {
    label: "Narrative list",
    boxClassName: "left-[14.2%] top-[6.8%] h-[72%] w-[28.6%]",
  },
  {
    label: "Memecoin table",
    boxClassName: "left-[44.8%] top-[6.8%] h-[72%] w-[31.4%]",
  },
  {
    label: "Validation panel",
    boxClassName: "left-[78.3%] top-[6.8%] h-[72%] w-[17.5%]",
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

              {isHero && showCallouts ? (
                <div className="pointer-events-none absolute inset-0 hidden lg:block">
                  {HERO_REGIONS.map((region, index) => (
                    <div
                      key={region.label}
                      className={cn(
                        "absolute rounded-[18px] border backdrop-blur-[1px]",
                        index === HERO_REGIONS.length - 1
                          ? "border-emerald/40 bg-[radial-gradient(circle_at_top,rgba(77,219,147,0.09),transparent_72%)] shadow-[0_0_0_1px_rgba(77,219,147,0.16),0_0_34px_rgba(77,219,147,0.14)]"
                          : "border-cyan/38 bg-[radial-gradient(circle_at_top,rgba(86,217,255,0.08),transparent_72%)] shadow-[0_0_0_1px_rgba(86,217,255,0.16),0_0_34px_rgba(86,217,255,0.12)]",
                        region.boxClassName,
                      )}
                    >
                      <span className="absolute left-3 top-3 inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-white/[0.14] bg-[rgba(5,11,18,0.88)] px-2 font-mono text-[10px] tracking-[0.16em] text-[#eef7ff]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {isHero ? (
            <div className="space-y-3 px-2 pt-3 sm:px-3">
              <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-[#d6e4f3]">
                Detect the narrative. Match the coin. Validate the move.
              </p>
              {showCallouts ? (
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] uppercase tracking-[0.16em] text-[#93a8bf]">
                  {HERO_REGIONS.map((region, index) => (
                    <span key={region.label} className="inline-flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 font-mono text-[10px] tracking-[0.14em]",
                          index === HERO_REGIONS.length - 1
                            ? "border-emerald/26 text-[#d8f3e3]"
                            : "border-cyan/22 text-[#e3f7ff]",
                        )}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {region.label}
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
