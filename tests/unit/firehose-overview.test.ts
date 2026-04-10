import { describe, expect, it } from "vitest";
import { buildBlueskyReplaySeries } from "@/lib/bluesky/firehose-overview";

describe("buildBlueskyReplaySeries", () => {
  it("keeps a live bucket anchored to the current reference time", () => {
    const referenceTime = new Date("2026-03-25T12:00:00.000Z");
    const windowMs = 24 * 60 * 60 * 1000;
    const bucketCount = 288;

    const replay = buildBlueskyReplaySeries({
      posts: [],
      interactions: [],
      referenceTime,
      windowMs,
      bucketCount,
    });

    expect(replay).toHaveLength(bucketCount);
    expect(replay.at(-1)?.timestamp).toBe(referenceTime.toISOString());
    expect(Date.parse(replay[0].timestamp)).toBe(
      referenceTime.getTime() - windowMs + windowMs / bucketCount,
    );
  });
});
