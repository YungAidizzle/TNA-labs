import { RankedTrend } from "@/types/view-models";

export type NarrativeSignalState = "Emerging" | "Accelerating" | "Peaking" | "Fading";

export function resolveNarrativeSignalState(row: Pick<
  RankedTrend,
  "lifecycleStage" | "attentionAcceleration" | "growthRate" | "velocityScore"
>): NarrativeSignalState {
  if (row.lifecycleStage === "Declining" || row.lifecycleStage === "Fading" || row.growthRate < -10) {
    return "Fading";
  }

  if (row.lifecycleStage === "Emerging") {
    return "Emerging";
  }

  if (
    row.lifecycleStage === "Expanding" ||
    row.attentionAcceleration >= 10 ||
    (row.growthRate >= 15 && (row.velocityScore ?? 0) >= 40)
  ) {
    return "Accelerating";
  }

  return "Peaking";
}
