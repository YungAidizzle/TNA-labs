import { RankedTrend } from "@/types/view-models";

function sanitizeCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

export function getTrendPostCount(row: RankedTrend) {
  const postCountCandidates = [
    row.supportingThreadCount,
    row.rootsCount24h,
    row.blueskySummary?.postCount,
  ];

  for (const candidate of postCountCandidates) {
    const normalized = sanitizeCount(candidate);
    if (normalized > 0) {
      return normalized;
    }
  }

  return sanitizeCount(
    row.mentions ?? row.totalInteractions24h ?? row.attentionInteractions,
  );
}

export function compareTrendsByPosts(left: RankedTrend, right: RankedTrend) {
  return getTrendPostCount(right) - getTrendPostCount(left) ||
    (right.trendStrengthScore ?? 0) - (left.trendStrengthScore ?? 0) ||
    (right.velocityScore ?? 0) - (left.velocityScore ?? 0) ||
    left.id.localeCompare(right.id);
}
