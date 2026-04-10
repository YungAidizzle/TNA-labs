import {
  canRunLiveVisibleTopicEnrichment,
  canRunVisibleTopicEnrichment,
  ensureVisibleTopicEnrichments,
} from "@/lib/dashboard/visible-topic-enrichment";

describe("visible topic enrichment runtime guard", () => {
  it("is permanently disabled in request paths", () => {
    expect(canRunVisibleTopicEnrichment()).toBe(false);
    expect(canRunLiveVisibleTopicEnrichment()).toBe(false);
  });

  it("throws if any runtime code tries to invoke request-path naming", async () => {
    await expect(
      ensureVisibleTopicEnrichments([
        {
          topicKey: "example",
          rawTopicKeys: ["example"],
          rawLabel: "Example",
          totalMentions: 10,
          uniquePosts: 8,
          uniqueAuthors: 6,
          platformCount: 1,
          positiveCount: 2,
          neutralCount: 6,
          negativeCount: 2,
          windowStartIso: "2026-04-07T00:00:00.000Z",
          windowEndIso: "2026-04-07T01:00:00.000Z",
        },
      ]),
    ).rejects.toThrow(/permanently disabled/i);
  });
});
