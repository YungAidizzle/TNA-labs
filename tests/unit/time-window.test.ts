import { describe, expect, it } from "vitest";
import { clipTimeSeriesToLiveWindow } from "@/lib/dashboard/time-window";

describe("clipTimeSeriesToLiveWindow", () => {
  it("anchors the window end to now and preserves trailing gap metadata", () => {
    const now = new Date("2026-03-25T12:00:00.000Z");
    const result = clipTimeSeriesToLiveWindow({
      range: "24h",
      now,
      points: [
        { timestamp: "2026-03-25T11:35:00.000Z", value: 8 },
        { timestamp: "2026-03-25T11:40:00.000Z", value: 4 },
      ],
    });

    expect(result.window.windowEnd).toBe(now.toISOString());
    expect(result.window.latestPointAt).toBe("2026-03-25T11:40:00.000Z");
    expect(result.window.staleGapMinutes).toBe(20);
    expect(result.window.hasTrailingGap).toBe(true);
    expect(result.window.trailingGapBucketCount).toBeGreaterThan(0);
  });

  it("keeps the freshest point at the right edge when data includes now", () => {
    const now = new Date("2026-03-25T12:00:00.000Z");
    const result = clipTimeSeriesToLiveWindow({
      range: "24h",
      now,
      points: [
        { timestamp: "2026-03-25T11:55:00.000Z", value: 6 },
        { timestamp: "2026-03-25T12:00:00.000Z", value: 3 },
      ],
    });

    expect(result.window.windowEnd).toBe(now.toISOString());
    expect(result.window.latestPointAt).toBe(now.toISOString());
    expect(result.window.staleGapMinutes).toBe(0);
    expect(result.window.hasTrailingGap).toBe(false);
  });

  it("clips out points older than the live 24h window", () => {
    const now = new Date("2026-03-25T12:00:00.000Z");
    const result = clipTimeSeriesToLiveWindow({
      range: "24h",
      now,
      points: [
        { timestamp: "2026-03-24T11:00:00.000Z", value: 10 },
        { timestamp: "2026-03-25T11:00:00.000Z", value: 5 },
      ],
    });

    expect(result.points).toHaveLength(1);
    expect(result.points[0]?.timestamp).toBe("2026-03-25T11:00:00.000Z");
    expect(result.window.windowStart).toBe("2026-03-24T12:00:00.000Z");
    expect(result.window.windowEnd).toBe(now.toISOString());
  });
});
