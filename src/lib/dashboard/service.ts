import "server-only";

import { getAiNativeNarrativeDashboardState } from "@/lib/dashboard/ai-native-narrative-source";
import { attachStoredTrendDexscreenerMatches } from "@/lib/dashboard/trend-dexscreener-matches";
import { createZeroTrendDashboardVM } from "@/lib/dashboard/zero-state";
import type { DashboardDataStatus, TrendDashboardQuery, TrendDashboardVM } from "@/types/view-models";

type DashboardStateOptions = {
  forceRebuild?: boolean;
  readProfile?: "summary" | "detail";
  includeFreshnessProbe?: boolean;
};

export async function getTrendDashboardState(
  query: TrendDashboardQuery,
  _options: DashboardStateOptions = {},
): Promise<TrendDashboardVM> {
  void _options;

  try {
    const state = await getAiNativeNarrativeDashboardState(query);
    return attachStoredTrendDexscreenerMatches(state);
  } catch (error) {
    console.error("[dashboard] failed to load AI-native narrative dashboard state", {
      query,
      error,
    });

    const dataStatus: DashboardDataStatus = {
      stateSource: "zero_state",
      bundleOrigin: null,
      servingMode: "empty",
      showing: "zero_state",
      serverNow: new Date().toISOString(),
      runtimeSnapshotGeneratedAt: null,
      sourceSnapshotGeneratedAt: null,
      latestFetchedAt: null,
      runtimeSnapshotAvailable: false,
      localRawDataAvailable: false,
      runtimeSnapshotStale: false,
      sourceFreshness: [],
      refresh: null,
      timings: null,
    };

    return {
      ...createZeroTrendDashboardVM(query),
      dataStatus,
    };
  }
}
