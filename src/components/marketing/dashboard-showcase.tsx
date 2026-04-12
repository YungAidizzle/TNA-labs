import { TerminalPanel } from "@/components/trends/terminal-panel";
import { cn } from "@/lib/utils/cn";

type DashboardShowcaseProps = {
  variant?: "hero" | "detail";
  className?: string;
  showCallouts?: boolean;
};

const STATUS_ITEMS = [
  { label: "Narratives", value: "248" },
  { label: "Linked memecoins", value: "42" },
  { label: "Posts / min", value: "11.8" },
  { label: "Last refresh", value: "19s" },
] as const;

const NARRATIVE_ROWS = [
  { rank: "01", name: "Telegram bot rotation", change: "+31%", posts: "1.3K" },
  { rank: "02", name: "Solana meme launchpads", change: "+24%", posts: "982" },
  { rank: "03", name: "Base wallet speculation", change: "+18%", posts: "764" },
  { rank: "04", name: "Exchange listing rumors", change: "+16%", posts: "603" },
  { rank: "05", name: "AI agent token revival", change: "+11%", posts: "488" },
  { rank: "06", name: "Gaming meme crossover", change: "+9%", posts: "351" },
] as const;

const MEMECOIN_ROWS = [
  { name: "BRETT", pair: "BASE", price: "$0.081", move: "+7.8%", liquidity: "$8.6M", volume: "$24M", signal: "Breakout" },
  { name: "BONK", pair: "SOL", price: "$0.000024", move: "+11.2%", liquidity: "$9.8M", volume: "$31M", signal: "Volume" },
  { name: "POPCAT", pair: "SOL", price: "$0.72", move: "+5.4%", liquidity: "$7.1M", volume: "$18M", signal: "Continue" },
  { name: "PEPE", pair: "ETH", price: "$0.000009", move: "+3.7%", liquidity: "$14M", volume: "$42M", signal: "Strength" },
  { name: "MOODENG", pair: "SOL", price: "$0.19", move: "+8.6%", liquidity: "$5.2M", volume: "$13M", signal: "Accel" },
  { name: "FARTCOIN", pair: "SOL", price: "$1.07", move: "+4.1%", liquidity: "$11M", volume: "$27M", signal: "Follow" },
] as const;

const VALIDATION_METRICS = [
  { label: "Selected asset", value: "BONK / SOL" },
  { label: "Confidence", value: "91" },
  { label: "Liquidity", value: "$9.8M" },
  { label: "24h volume", value: "$31M" },
  { label: "1h change", value: "+11.2%" },
  { label: "24h txns", value: "18.4K" },
] as const;

const VALIDATION_SIGNALS = [
  "Narrative velocity rising across Bluesky and Reddit clusters.",
  "Liquidity remains deep enough for active monitoring.",
  "Recent price expansion is holding with continued transaction flow.",
] as const;

const CHART_BARS = [28, 34, 30, 38, 45, 54, 63, 72, 88, 74, 69, 76] as const;

const CALLOUTS = [
  { label: "Trending narratives", className: "left-[-10px] top-[15%]" },
  { label: "Linked memecoins", className: "right-[12%] top-[-18px]" },
  { label: "Momentum view", className: "bottom-[16%] right-[-18px]" },
] as const;

const NARRATIVE_CONTEXT = [
  { label: "Selected narrative", value: "Solana meme launchpads" },
  { label: "Linked names", value: "14" },
  { label: "Net move", value: "+11.2%" },
  { label: "Window", value: "24h" },
] as const;

function ShowcaseCallout({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <div
      className={cn(
        "absolute z-20 hidden border border-white/[0.12] bg-[rgba(7,11,17,0.96)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#edf4fd] shadow-[0_18px_40px_rgba(0,0,0,0.45)] xl:flex",
        className,
      )}
    >
      <span className="mr-2 mt-[3px] h-1.5 w-1.5 bg-cyan" />
      {label}
      <span className="pointer-events-none absolute -bottom-6 left-1/2 h-6 w-px -translate-x-1/2 bg-gradient-to-b from-white/[0.3] to-transparent" />
    </div>
  );
}

function NarrativePanel() {
  return (
    <TerminalPanel
      title="Narratives"
      subtitle="Cross-platform attention ranking"
      tone="cyan"
      className="min-h-[280px] border-white/[0.08]"
      bodyClassName="overflow-hidden"
      action={
        <span className="border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-[#a4b5c8]">
          248 tracked
        </span>
      }
    >
      <div className="grid grid-cols-[42px_minmax(0,1fr)_68px_56px] border-b border-white/[0.06] bg-[#090e15] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#71859e]">
        <span>#</span>
        <span>Narrative</span>
        <span className="text-right">24h</span>
        <span className="text-right">Posts</span>
      </div>
      <div>
        {NARRATIVE_ROWS.map((item, index) => (
          <div
            key={item.name}
            className={cn(
              "grid grid-cols-[42px_minmax(0,1fr)_68px_56px] items-center border-b border-white/[0.05] px-3 py-3",
              index === 0
                ? "bg-[linear-gradient(90deg,rgba(18,48,63,0.92),rgba(8,13,20,0.98))] shadow-[inset_2px_0_0_rgba(86,217,255,0.95)]"
                : "bg-transparent",
            )}
          >
            <span className={cn("font-mono text-[13px] font-semibold", index === 0 ? "text-cyan" : "text-[#8ea3bd]")}>
              {item.rank}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold tracking-[-0.02em] text-[#eef4fd]">
                {item.name}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-[#7286a0]">
                Attention building before broad price discovery.
              </p>
            </div>
            <span className="text-right font-mono text-[12px] font-semibold text-emerald">
              {item.change}
            </span>
            <span className="text-right font-mono text-[12px] font-semibold text-[#d8e2ee]">
              {item.posts}
            </span>
          </div>
        ))}
      </div>
    </TerminalPanel>
  );
}

function MemecoinPanel() {
  return (
    <TerminalPanel
      title="Linked Memecoins"
      subtitle="Momentum-ranked board"
      tone="neutral"
      className="min-h-[280px] border-white/[0.08]"
      bodyClassName="overflow-hidden"
      action={
        <div className="flex gap-1 text-[11px] font-medium">
          <span className="border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[#8fa4bd]">
            Trend
          </span>
          <span className="border border-cyan/28 bg-cyan/10 px-2 py-1 text-cyan">
            Momentum
          </span>
        </div>
      }
    >
      <div className="grid grid-cols-[minmax(0,1.3fr)_72px_66px_72px_72px_78px] border-b border-white/[0.06] bg-[#090e15] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#71859e]">
        <span>Coin</span>
        <span className="text-right">Price</span>
        <span className="text-right">1h</span>
        <span className="text-right">Liq</span>
        <span className="text-right">Vol</span>
        <span className="text-right">Signal</span>
      </div>
      <div>
        {MEMECOIN_ROWS.map((item, index) => (
          <div
            key={`${item.name}-${item.pair}`}
            className={cn(
              "grid grid-cols-[minmax(0,1.3fr)_72px_66px_72px_72px_78px] items-center border-b border-white/[0.05] px-3 py-3",
              index === 1
                ? "bg-[linear-gradient(90deg,rgba(22,51,66,0.92),rgba(8,13,20,0.98))] shadow-[inset_2px_0_0_rgba(77,219,147,0.92)]"
                : index < 3
                  ? "bg-[linear-gradient(90deg,rgba(11,22,31,0.82),rgba(8,13,20,0.96))]"
                  : "bg-transparent",
            )}
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 shrink-0 bg-white/[0.3]" />
                <p className="truncate text-[14px] font-semibold text-[#eef4fd]">{item.name}</p>
                <span className="font-mono text-[11px] text-cyan">{item.pair}</span>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-[#7286a0]">
                Linked to rising narrative cluster
              </p>
            </div>
            <span className="text-right font-mono text-[12px] font-semibold text-[#eef4fd]">
              {item.price}
            </span>
            <span className="text-right font-mono text-[12px] font-semibold text-emerald">
              {item.move}
            </span>
            <span className="text-right font-mono text-[12px] font-semibold text-[#d8e2ee]">
              {item.liquidity}
            </span>
            <span className="text-right font-mono text-[12px] font-semibold text-[#d8e2ee]">
              {item.volume}
            </span>
            <span className="text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9fb4cb]">
              {item.signal}
            </span>
          </div>
        ))}
      </div>
    </TerminalPanel>
  );
}

function ValidationPanel() {
  return (
    <TerminalPanel
      title="Validation"
      subtitle="Selected asset market context"
      tone="emerald"
      className="min-h-[280px] border-white/[0.08]"
      bodyClassName="overflow-hidden"
      action={
        <span className="border border-emerald/25 bg-emerald/10 px-2 py-1 font-mono text-[11px] text-emerald">
          BONK
        </span>
      }
    >
      <div className="space-y-4 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium text-[#70839d]">Selected asset</p>
            <p className="mt-1 text-[20px] font-semibold tracking-[-0.03em] text-[#eef4fd]">
              BONK
            </p>
            <p className="mt-1 font-mono text-[12px] text-[#7f93ac]">SOL / Meme rotation</p>
          </div>
          <p className="font-mono text-[22px] font-semibold tracking-[-0.03em] text-[#eef4fd]">
            $0.000024
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {VALIDATION_METRICS.map((item) => (
            <div key={item.label} className="border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.14em] text-[#6d819a]">
                {item.label}
              </p>
              <p className="mt-1 text-[13px] font-semibold text-[#eef4fd]">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="border border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,12,18,0.98),rgba(4,7,11,0.98))] px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#6d819a]">
                Momentum view
              </p>
              <p className="mt-1 text-[13px] text-[#cbd8e6]">
                Price response holding while narrative participation expands.
              </p>
            </div>
            <span className="font-mono text-[12px] font-semibold text-emerald">+11.2%</span>
          </div>
          <div className="mt-4 flex h-[128px] items-end gap-1.5">
            {CHART_BARS.map((height, index) => (
              <span
                key={`${height}-${index}`}
                className={cn(
                  "w-full border-t",
                  index >= 7
                    ? "border-cyan/50 bg-[linear-gradient(180deg,rgba(86,217,255,0.24),rgba(86,217,255,0.82))]"
                    : "border-white/[0.16] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.2))]",
                )}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2 border-t border-white/[0.06] pt-3">
          {VALIDATION_SIGNALS.map((signal) => (
            <div key={signal} className="flex items-start gap-2">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 bg-emerald" />
              <p className="text-[12px] leading-5 text-[#a9bbcf]">{signal}</p>
            </div>
          ))}
        </div>
      </div>
    </TerminalPanel>
  );
}

export function DashboardShowcase({
  variant = "detail",
  className,
  showCallouts = false,
}: DashboardShowcaseProps) {
  const isHero = variant === "hero";
  const isDetail = variant === "detail";

  return (
    <div className={cn("relative", className)}>
      {showCallouts
        ? CALLOUTS.map((item) => (
            <ShowcaseCallout key={item.label} label={item.label} className={item.className} />
          ))
        : null}

      <div
        className={cn(
          "relative overflow-hidden border border-white/[0.08] bg-[linear-gradient(180deg,rgba(8,12,18,0.98),rgba(4,7,11,0.995))] shadow-[0_28px_80px_rgba(0,0,0,0.52)]",
          isHero &&
            "transform-gpu lg:origin-top-left lg:[transform:perspective(2400px)_rotateY(-10deg)_rotateX(4deg)]",
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(86,217,255,0.09),transparent_28%),radial-gradient(circle_at_82%_20%,rgba(115,150,255,0.08),transparent_24%)]" />

        <div className="relative flex items-center justify-between border-b border-white/[0.08] px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-[#6f849c]">
          <span>{isHero ? "Live terminal workflow" : "Focused validation view"}</span>
          <span className="font-mono text-[#cfd9e5]">
            {isHero ? "Narrative to asset monitoring" : "Selected narrative workspace"}
          </span>
        </div>

        <div className="relative grid grid-cols-2 border-b border-white/[0.08] sm:grid-cols-4">
          {STATUS_ITEMS.map((item, index) => (
            <div
              key={item.label}
              className={cn(
                "px-4 py-3",
                index % 2 === 1 ? "border-l border-white/[0.08]" : "",
                index >= 2 ? "border-t border-white/[0.08] sm:border-t-0" : "",
                index >= 1 && index < 4 ? "sm:border-l sm:border-white/[0.08]" : "",
              )}
            >
              <p className="text-[11px] uppercase tracking-[0.14em] text-[#6f849c]">
                {item.label}
              </p>
              <p className="mt-1 text-[20px] font-semibold tracking-[-0.03em] text-[#f2f7fd]">
                {item.value}
              </p>
            </div>
          ))}
        </div>

        {isDetail ? (
          <>
            <div className="grid gap-0 border-b border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] md:grid-cols-4">
              {NARRATIVE_CONTEXT.map((item, index) => (
                <div
                  key={item.label}
                  className={cn(
                    "px-4 py-3",
                    index > 0 ? "border-t border-white/[0.06] md:border-l md:border-t-0" : "",
                  )}
                >
                  <p className="text-[10px] uppercase tracking-[0.14em] text-[#6f849c]">
                    {item.label}
                  </p>
                  <p className="mt-1 text-[14px] font-semibold text-[#eef4fd]">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="relative grid gap-3 p-3 xl:grid-cols-[1.16fr_0.84fr]">
              <MemecoinPanel />
              <ValidationPanel />
            </div>
          </>
        ) : (
          <div className="relative grid gap-3 p-3 lg:grid-cols-[0.94fr_1.16fr_0.92fr]">
            <NarrativePanel />
            <MemecoinPanel />
            <ValidationPanel />
          </div>
        )}
      </div>
    </div>
  );
}
