import { getTrendDashboardVM } from "@/lib/adapters/analytics";
import { PublicSourceItem, RedditIngestionSnapshot } from "@/lib/reddit/types";

const fetchedAt = "2026-03-18T12:10:00.000Z";

function makeTelegramItem(
  id: string,
  title: string,
  summary: string,
  hoursAgo: number,
  score: number,
  numComments: number,
): PublicSourceItem {
  return {
    id,
    source: "news",
    sourceType: "telegram",
    sourceName: "Telegram",
    title,
    summary,
    author: "Watcher Guru",
    url: `https://t.me/example/${id}`,
    createdUtc: Math.floor(
      (new Date(fetchedAt).getTime() - hoursAgo * 60 * 60 * 1000) / 1000,
    ),
    score,
    numComments,
    interactionCounts: {
      posts: 1,
      reposts: Math.max(8, numComments * 3),
      comments: Math.max(3, numComments),
      likes: score,
    },
    fetchedAt,
  };
}

describe("telegram dashboard integration", () => {
  it("surfaces telegram public items as ranked trends", async () => {
    const snapshot: RedditIngestionSnapshot = {
      source: "reddit",
      fetchedAt,
      error: null,
      posts: [],
      comments: [],
      publicItems: [
        makeTelegramItem(
          "tg-1",
          "SEC/CFTC crypto guidance",
          "Telegram channels converge on SEC and CFTC guidance saying most crypto assets are not securities.",
          2,
          2200,
          5,
        ),
        makeTelegramItem(
          "tg-2",
          "SEC/CFTC crypto guidance",
          "Watcher Guru and unfolded both pushed the same SEC/CFTC crypto guidance story within the last hour.",
          1,
          1800,
          4,
        ),
      ],
    };

    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      snapshot,
    );

    expect(vm.leaderboard.length).toBeGreaterThan(0);
    expect(vm.leaderboard[0].name.toLowerCase()).toContain("sec");
    expect(vm.leaderboard[0].name.toLowerCase()).toContain("crypto");
    expect(vm.leaderboard[0].platforms).toContain("telegram");
    expect(vm.detail?.platformBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platformId: "telegram",
        }),
      ]),
    );
    expect(vm.detail?.topPosts[0]?.platformId).toBe("telegram");
  });
});
