"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  BlueskyLiveStatusInput,
  BlueskyLiveStatusState,
  deriveBlueskyLiveStatus,
} from "@/lib/utils/bluesky-live-status";

const STATUS_CLASSES: Record<BlueskyLiveStatusState, string> = {
  live: "border-emerald/30 bg-emerald/8 text-emerald",
  delayed: "border-amber/30 bg-amber/8 text-amber",
  degraded: "border-orange-400/35 bg-orange-400/10 text-orange-300",
  stale: "border-rose/30 bg-rose/8 text-rose",
  disconnected: "border-rose/40 bg-rose/14 text-rose",
};

const STATUS_DOT_CLASSES: Record<BlueskyLiveStatusState, string> = {
  live: "bg-emerald",
  delayed: "bg-amber",
  degraded: "bg-orange-300",
  stale: "bg-rose",
  disconnected: "bg-rose",
};

type BlueskyLiveStatusBadgeProps = BlueskyLiveStatusInput & {
  className?: string;
  updateIntervalMs?: number;
};

export function BlueskyLiveStatusBadge({
  className,
  updateIntervalMs = 5_000,
  ...input
}: BlueskyLiveStatusBadgeProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalMs = Math.max(2_000, updateIntervalMs);
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [updateIntervalMs]);

  const status = deriveBlueskyLiveStatus(input, nowMs);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        STATUS_CLASSES[status.state],
        className,
      )}
      title={status.tooltip}
      aria-live="polite"
      aria-label={`Bluesky stream status ${status.label}`}
      data-status={status.state}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT_CLASSES[status.state])}
      />
      {status.label}
    </span>
  );
}
