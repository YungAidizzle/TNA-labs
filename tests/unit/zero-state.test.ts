import {
  createZeroTimeSeries,
  createZeroTrendDashboardVM,
  createZeroTrendDetail,
} from "@/lib/dashboard/zero-state";

describe("dashboard zero-state", () => {
  it("creates zero-valued time series for each supported range", () => {
    expect(createZeroTimeSeries("1h")).toHaveLength(12);
    expect(createZeroTimeSeries("24h")).toHaveLength(288);
    expect(createZeroTimeSeries("7d").every((point) => point.value === 0)).toBe(true);
  });

  it("returns empty dashboard and detail defaults without fake rows", () => {
    const vm = createZeroTrendDashboardVM({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "attention",
    });
    const detail = createZeroTrendDetail("overall", "24h");

    expect(vm.leaderboard).toHaveLength(0);
    expect(vm.leaderboards.established).toHaveLength(0);
    expect(vm.leaderboards.emerging).toHaveLength(0);
    expect(vm.detail).toBeNull();
    expect(detail.trend.attentionScore).toBe(0);
    expect(detail.trend.attentionInteractions).toBe(0);
    expect(detail.trend.lifecycleStage).toBe("Unknown");
    expect(detail.topPosts).toHaveLength(0);
  });
});
