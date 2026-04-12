import { applyChartMovingAverage, applyMovingAverage, buildSortedAxisTooltip } from "@/lib/utils/chart";

describe("chart tooltip helpers", () => {
  it("sorts hovered series rows from highest to lowest value", () => {
    const tooltip = buildSortedAxisTooltip("interactions");
    const html = tooltip.formatter([
      {
        axisValueLabel: "9:30 AM",
        color: "#5ee7ff",
        marker: '<span class="m1"></span>',
        seriesName: "Alpha",
        value: 12,
      },
      {
        axisValueLabel: "9:30 AM",
        color: "#64f0a9",
        marker: '<span class="m2"></span>',
        seriesName: "Beta",
        value: 19,
      },
      {
        axisValueLabel: "9:30 AM",
        color: "#ffbe64",
        marker: '<span class="m3"></span>',
        seriesName: "Gamma",
        value: 7,
      },
    ]);

    expect(html.indexOf("Beta")).toBeLessThan(html.indexOf("Alpha"));
    expect(html.indexOf("Alpha")).toBeLessThan(html.indexOf("Gamma"));
  });

  it("applies a trailing moving average without changing timestamps", () => {
    const smoothed = applyMovingAverage(
      [
        { timestamp: "2026-03-18T00:00:00.000Z", value: 3 },
        { timestamp: "2026-03-18T00:05:00.000Z", value: 9 },
        { timestamp: "2026-03-18T00:10:00.000Z", value: 6 },
        { timestamp: "2026-03-18T00:15:00.000Z", value: 12 },
      ],
      3,
    );

    expect(smoothed.map((point) => point.timestamp)).toEqual([
      "2026-03-18T00:00:00.000Z",
      "2026-03-18T00:05:00.000Z",
      "2026-03-18T00:10:00.000Z",
      "2026-03-18T00:15:00.000Z",
    ]);
    expect(smoothed.map((point) => point.value)).toEqual([3, 6, 6, 9]);
  });

  it("auto-applies a 20s trailing average when Raw mode is selected", () => {
    const smoothed = applyChartMovingAverage(
      [
        { timestamp: "2026-03-18T00:00:00.000Z", value: 10 },
        { timestamp: "2026-03-18T00:00:10.000Z", value: 30 },
        { timestamp: "2026-03-18T00:00:20.000Z", value: 20 },
        { timestamp: "2026-03-18T00:00:30.000Z", value: 40 },
      ],
      1,
    );

    expect(smoothed.map((point) => point.value)).toEqual([10, 20, 20, 30]);
  });

  it("can limit tooltip rows and highlight the top trend", () => {
    const tooltip = buildSortedAxisTooltip("interactions", {
      maxRows: 2,
      showTopSummary: true,
      topSummaryLabel: "Top trend",
    });
    const html = tooltip.formatter([
      {
        axisValueLabel: "9:30 AM",
        color: "#5ee7ff",
        marker: '<span class="m1"></span>',
        seriesName: "Alpha",
        value: 12,
      },
      {
        axisValueLabel: "9:30 AM",
        color: "#64f0a9",
        marker: '<span class="m2"></span>',
        seriesName: "Beta",
        value: 19,
      },
      {
        axisValueLabel: "9:30 AM",
        color: "#ffbe64",
        marker: '<span class="m3"></span>',
        seriesName: "Gamma",
        value: 7,
      },
    ]);

    expect(html).toContain("Top trend: Beta");
    expect(html).toContain("Alpha");
    expect(html).not.toContain("Gamma");
  });
});
