import { describe, expect, it, vi } from "vitest";
import {
  invalidateTrendDashboardQueries,
  trendDashboardQueryKeys,
} from "@/lib/dashboard/cache";

describe("dashboard cache helpers", () => {
  it("reuses the same dashboard view key when only the selected row changes", () => {
    const baseQuery = {
      scope: "overall" as const,
      range: "24h" as const,
      sort: "posts" as const,
      mode: "established" as const,
    };

    expect(
      trendDashboardQueryKeys.summary({
        ...baseQuery,
        selectedId: "trend-1",
      }),
    ).toEqual(
      trendDashboardQueryKeys.summary({
        ...baseQuery,
        selectedId: "trend-2",
      }),
    );
  });

  it("separates cache keys for different filter combinations", () => {
    expect(
      trendDashboardQueryKeys.memecoins({
        scope: "overall",
        range: "24h",
        sort: "posts",
        mode: "established",
      }),
    ).not.toEqual(
      trendDashboardQueryKeys.memecoins({
        scope: "overall",
        range: "6h",
        sort: "posts",
        mode: "established",
      }),
    );
  });

  it("invalidates only the active dashboard view scope for a query", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await invalidateTrendDashboardQueries(
      {
        invalidateQueries,
      } as never,
      {
        scope: "overall",
        range: "24h",
        sort: "posts",
        mode: "established",
      },
    );

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: trendDashboardQueryKeys.views({
        scope: "overall",
        range: "24h",
        sort: "posts",
        mode: "established",
      }),
      refetchType: "active",
    });
  });
});
