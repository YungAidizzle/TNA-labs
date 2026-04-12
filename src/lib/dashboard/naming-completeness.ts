import {
  TREND_NAME_PLACEHOLDER,
  getTrendDisplayNameOrPlaceholder,
  hasTrustedTrendDisplayName,
  resolveTrendNameStatus,
} from "@/lib/dashboard/trend-name-state";
import { RankedTrend, TrendDashboardVM } from "@/types/view-models";

function collectVisibleTrends(vm: TrendDashboardVM | null | undefined) {
  if (!vm) {
    return [] as RankedTrend[];
  }

  const ordered = [...vm.leaderboard];
  if (vm.detail?.trend) {
    ordered.push(vm.detail.trend);
  }

  const seen = new Set<string>();
  return ordered.filter((trend) => {
    if (!trend?.id || seen.has(trend.id)) {
      return false;
    }
    seen.add(trend.id);
    return true;
  });
}

function hasRecordedNamingFailure(trend: RankedTrend) {
  return resolveTrendNameStatus(trend) === "failed";
}

export function dashboardStateHasUnresolvedTrendNaming(vm: TrendDashboardVM | null | undefined) {
  const visibleTrends = collectVisibleTrends(vm);
  if (visibleTrends.length === 0) {
    return false;
  }

  return visibleTrends.some(
    (trend) => !hasTrustedTrendDisplayName(trend) && !hasRecordedNamingFailure(trend),
  );
}

export function summarizeVisibleTrendNaming(vm: TrendDashboardVM | null | undefined) {
  const visibleTrends = collectVisibleTrends(vm);
  let aiNamed = 0;
  let aiFailed = 0;
  let unresolved = 0;
  let fallbackDisplayCount = 0;
  let missingDisplayCount = 0;

  for (const trend of visibleTrends) {
    const visibleDisplayName = getTrendDisplayNameOrPlaceholder(trend);
    if (hasTrustedTrendDisplayName(trend)) {
      aiNamed += 1;
      continue;
    }
    if (hasRecordedNamingFailure(trend)) {
      aiFailed += 1;
    } else {
      unresolved += 1;
    }
    if (visibleDisplayName === TREND_NAME_PLACEHOLDER) {
      missingDisplayCount += 1;
      continue;
    }
    fallbackDisplayCount += 1;
  }

  return {
    visibleTrendCount: visibleTrends.length,
    aiNamedCount: aiNamed,
    aiFailedCount: aiFailed,
    unresolvedCount: unresolved,
    fallbackDisplayCount,
    missingDisplayCount,
  };
}
