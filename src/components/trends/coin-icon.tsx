"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";

type CoinIconProps = {
  src?: string | null;
  symbol: string;
  name: string;
  className?: string;
  labelClassName?: string;
};

function fallbackLabel(symbol: string, name: string) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (normalizedSymbol) {
    return normalizedSymbol.slice(0, 2);
  }

  return name.trim().slice(0, 2).toUpperCase() || "??";
}

export function CoinIcon({
  src,
  symbol,
  name,
  className,
  labelClassName,
}: CoinIconProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const normalizedSrc = src ?? null;
  const shouldRenderImage = Boolean(normalizedSrc) && failedSrc !== normalizedSrc;

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] text-[11px] font-semibold tracking-[0.04em] text-[#cdd9e8]",
        className,
      )}
      aria-hidden="true"
    >
      {shouldRenderImage ? (
        // Runtime coin icons come from external token metadata, so Next image optimization is not a good fit here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={normalizedSrc ?? undefined}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(normalizedSrc)}
        />
      ) : (
        <span className={cn("font-mono", labelClassName)}>{fallbackLabel(symbol, name)}</span>
      )}
    </div>
  );
}
