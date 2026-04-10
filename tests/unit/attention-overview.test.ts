import { describe, expect, it } from "vitest";
import { selectAttentionOverviewSeries } from "@/lib/utils/attention-overview";

describe("selectAttentionOverviewSeries", () => {
  it("prefers trend overview series when available", () => {
    const trendSeries = [
      {
        id: "trend-1",
        name: "Trend 1",
        selected: true,
        color: "#5ee7ff",
        points: [{ timestamp: "2026-03-25T00:00:00.000Z", value: 4 }],
        window: null,
      },
    ];

    const series = selectAttentionOverviewSeries({
      overviewSeries: trendSeries,
      blueskyOverview: {
        generatedAt: "2026-03-25T00:00:00.000Z",
        firehoseLagMinutes: 0,
        attentionSharePct: 100,
        engagementIntensity: 0,
        meaningfulAttentionScore: 0,
        narrativeCount: 0,
        accountSpread: 0,
        postsPerMinute: 0,
        likesPerMinute: 0,
        repostsPerMinute: 0,
        repliesPerMinute: 0,
        quotesPerMinute: 0,
        accelerationScore: 0,
        noiseRatioPct: 0,
        leaders: [],
        emerging: [],
        topAmplifiers: [],
        cascades: [],
        clusters: [],
        network: { nodes: [], edges: [] },
        replay: [{ timestamp: "2026-03-25T00:00:00.000Z", value: 120 }],
        replayWindow: null,
      },
    });

    expect(series).toEqual(trendSeries);
  });

  it("falls back to raw replay when trend series are empty", () => {
    const replayPoint = { timestamp: "2026-03-25T00:00:00.000Z", value: 120 };
    const series = selectAttentionOverviewSeries({
      overviewSeries: [],
      blueskyOverview: {
        generatedAt: "2026-03-25T00:00:00.000Z",
        firehoseLagMinutes: 0,
        attentionSharePct: 100,
        engagementIntensity: 0,
        meaningfulAttentionScore: 0,
        narrativeCount: 0,
        accountSpread: 0,
        postsPerMinute: 0,
        likesPerMinute: 0,
        repostsPerMinute: 0,
        repliesPerMinute: 0,
        quotesPerMinute: 0,
        accelerationScore: 0,
        noiseRatioPct: 0,
        leaders: [],
        emerging: [],
        topAmplifiers: [],
        cascades: [],
        clusters: [],
        network: { nodes: [], edges: [] },
        replay: [replayPoint],
        replayWindow: null,
      },
    });

    expect(series).toHaveLength(1);
    expect(series[0]?.id).toBe("bluesky-live-replay");
    expect(series[0]?.points).toEqual([replayPoint]);
  });

  it("filters out the all-trends aggregate line from chart series", () => {
    const series = selectAttentionOverviewSeries({
      overviewSeries: [
        {
          id: "all-trends-aggregate",
          name: "All Trends Activity",
          selected: false,
          color: "#8ea2ff",
          points: [{ timestamp: "2026-03-25T00:00:00.000Z", value: 20 }],
          window: null,
        },
        {
          id: "trend-1",
          name: "Trend 1",
          selected: true,
          color: "#5ee7ff",
          points: [{ timestamp: "2026-03-25T00:00:00.000Z", value: 4 }],
          window: null,
        },
      ],
      blueskyOverview: null,
    });

    expect(series).toHaveLength(1);
    expect(series[0]?.id).toBe("trend-1");
  });

  it("returns an empty list when neither source has data", () => {
    const series = selectAttentionOverviewSeries({
      overviewSeries: [],
      blueskyOverview: null,
    });

    expect(series).toEqual([]);
  });
});
