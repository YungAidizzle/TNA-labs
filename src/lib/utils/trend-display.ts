import { TrendLifecycleStage } from "@/types/domain";
import { RedditIngestionHealth } from "@/lib/reddit/types";
import { AccentTone } from "@/types/view-models";

export function getLifecycleTone(stage: TrendLifecycleStage): AccentTone {
  if (stage === "Unknown") {
    return "violet";
  }

  if (stage === "Expanding") {
    return "emerald";
  }

  if (stage === "Established") {
    return "amber";
  }

  if (stage === "Fading") {
    return "violet";
  }

  if (stage === "Declining") {
    return "rose";
  }

  return "cyan";
}

export function getFreshnessTone(
  freshnessState: RedditIngestionHealth["freshnessState"] | null | undefined,
): AccentTone {
  if (freshnessState === "fresh") {
    return "emerald";
  }

  if (freshnessState === "delayed") {
    return "cyan";
  }

  if (freshnessState === "degraded") {
    return "amber";
  }

  if (freshnessState === "stale") {
    return "rose";
  }

  return "violet";
}
