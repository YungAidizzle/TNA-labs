import { afterEach, beforeEach, vi } from "vitest";

const interpretBlueskyRootsMock = vi.fn();

vi.mock("@/lib/bluesky/ai-trend-assignment", () => ({
  interpretBlueskyRoots: interpretBlueskyRootsMock,
  interpretBlueskyRootsDetailed: async (
    roots: Array<{ rootId: string }>,
    options?: { mode?: string; ignoreCache?: boolean; requestTimeoutMs?: number },
  ) => {
    const interpretations = (await interpretBlueskyRootsMock(roots, options)) ?? new Map();
    const resolvedInterpretations =
      interpretations instanceof Map ? interpretations : new Map<string, never>();
    const processedRootCount = resolvedInterpretations.size;
    const requestedRootCount = Array.isArray(roots) ? roots.length : 0;
    return {
      interpretations: resolvedInterpretations,
      diagnostics: {
        mode: options?.mode ?? "incremental_live",
        requestedRootCount,
        eligibleRootCount: requestedRootCount,
        processedRootCount,
        processedFreshRootCount: processedRootCount,
        cacheHitCount: 0,
        freshCallCount: processedRootCount > 0 ? 1 : 0,
        batchCount: processedRootCount > 0 ? 1 : 0,
        batchFailureCount: 0,
        failedRootCount: Math.max(0, requestedRootCount - processedRootCount),
        attempted: true,
        clientInitialized: true,
        incomplete: processedRootCount < requestedRootCount,
        incompleteReason:
          processedRootCount < requestedRootCount
            ? "mock AI grouping did not cover every eligible root"
            : null,
        model: "test-model",
        credentialSource: "process.env.OPENAI_API_KEY",
        credentialFingerprint: "test-key",
        ignoreCache: Boolean(options?.ignoreCache),
        requestTimeoutMs: options?.requestTimeoutMs ?? 30_000,
        totalBudgetMs: null,
        startedAt: "2026-03-16T10:00:00.000Z",
        completedAt: "2026-03-16T10:00:00.000Z",
        lastSuccessfulFullRegroupAt: null,
      },
    };
  },
}));

import { getTrendDashboardVM } from "@/lib/adapters/analytics";
import {
  BlueskyInteraction,
  BlueskyNormalizedPost,
  BlueskyPostSnapshot,
  NormalizedInteractionCounts,
  PublicSourceItem,
  RedditIngestionSnapshot,
  RedditNormalizedComment,
  RedditNormalizedPost,
} from "@/lib/reddit/types";

const fetchedAt = "2026-03-16T10:00:00.000Z";
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalGroupingEnabled = process.env.OPENAI_TREND_GROUPING_ENABLED;

beforeEach(() => {
  interpretBlueskyRootsMock.mockReset();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_TREND_GROUPING_ENABLED;
});

afterEach(() => {
  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }

  if (originalGroupingEnabled === undefined) {
    delete process.env.OPENAI_TREND_GROUPING_ENABLED;
  } else {
    process.env.OPENAI_TREND_GROUPING_ENABLED = originalGroupingEnabled;
  }
});

function makePost(
  id: string,
  subreddit: string,
  title: string,
  hoursAgo: number,
  score: number,
  numComments: number,
  selftext = "",
): RedditNormalizedPost {
  return {
    id,
    source: "reddit",
    subreddit,
    title,
    selftext,
    author: `user-${id}`,
    permalink: `/r/${subreddit}/comments/${id}`,
    createdUtc: Math.floor(
      (new Date(fetchedAt).getTime() - hoursAgo * 60 * 60 * 1000) / 1000,
    ),
    score,
    numComments,
    url: `https://www.reddit.com/r/${subreddit}/comments/${id}`,
    fetchedAt,
  };
}

function makeComment(
  id: string,
  postId: string,
  subreddit: string,
  minutesAgo: number,
  score = 1,
): RedditNormalizedComment {
  return {
    id,
    source: "reddit",
    postId,
    parentId: `t3_${postId}`,
    subreddit,
    author: `commenter-${id}`,
    body: `comment-${id}`,
    permalink: `/r/${subreddit}/comments/${postId}/_/${id}`,
    createdUtc: Math.floor(
      (new Date(fetchedAt).getTime() - minutesAgo * 60 * 1000) / 1000,
    ),
    score,
    fetchedAt,
  };
}

function makePublicItem(
  id: string,
  sourceName: string,
  title: string,
  summary: string,
  hoursAgo: number,
  score: number,
  numComments: number,
  sourceType: PublicSourceItem["sourceType"] = "rss",
  interactionCounts?: NormalizedInteractionCounts,
  overrides: Partial<PublicSourceItem> = {},
): PublicSourceItem {
  return {
    id,
    source: "news",
    sourceType,
    sourceName,
    title,
    summary,
    author: `reporter-${id}`,
    url: `https://example.com/${id}`,
    createdUtc: Math.floor(
      (new Date(fetchedAt).getTime() - hoursAgo * 60 * 60 * 1000) / 1000,
    ),
    score,
    numComments,
    interactionCounts,
    fetchedAt,
    ...overrides,
  };
}

function makeBlueskyPost(
  id: string,
  text: string,
  minutesAgo: number,
  overrides: Partial<BlueskyNormalizedPost> = {},
): BlueskyNormalizedPost {
  const createdUtc = Math.floor(
    (new Date(fetchedAt).getTime() - minutesAgo * 60 * 1000) / 1000,
  );
  return {
    id,
    uri: id,
    source: "bluesky",
    sourceType: "bluesky",
    postType: "root",
    authorDid: `did:${id}`,
    authorHandle: `${id.split("/").at(-1)}.bsky.social`,
    authorDisplayName: `${text} author`,
    summary: text,
    url: `https://bsky.app/profile/${id.split("/").at(-1)}/post/${id.split("/").at(-1)}`,
    createdUtc,
    score: 10,
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
    quoteCount: 0,
    interactionCounts: {
      posts: 1,
      reposts: 0,
      comments: 0,
      likes: 0,
    },
    fetchedAt,
    ...overrides,
  };
}

function makeBlueskyInteraction(
  id: string,
  postUri: string,
  interactionType: BlueskyInteraction["interactionType"],
  minutesAgo: number,
  overrides: Partial<BlueskyInteraction> = {},
): BlueskyInteraction {
  return {
    id,
    source: "bluesky",
    sourceType: "bluesky_interaction",
    interactionType,
    postUri,
    rootUri: postUri,
    actorDid: `did:${id}`,
    actorHandle: `${id}.bsky.social`,
    actorDisplayName: id,
    createdUtc: Math.floor(
      (new Date(fetchedAt).getTime() - minutesAgo * 60 * 1000) / 1000,
    ),
    fetchedAt,
    ...overrides,
  };
}

function makeBlueskySnapshot(
  id: string,
  postUri: string,
  minutesAgo: number,
  overrides: Partial<BlueskyPostSnapshot> = {},
): BlueskyPostSnapshot {
  return {
    id,
    postUri,
    fetchedAt,
    createdUtc: Math.floor(
      (new Date(fetchedAt).getTime() - minutesAgo * 60 * 1000) / 1000,
    ),
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
    quoteCount: 0,
    deltaLikeCount: 0,
    deltaCommentCount: 0,
    deltaRepostCount: 0,
    deltaQuoteCount: 0,
    deltaWindowMinutes: 60,
    ...overrides,
  };
}

const snapshot: RedditIngestionSnapshot = {
  source: "reddit",
  fetchedAt,
  error: null,
  posts: [
    makePost("1", "technology", "AI agent browser use is getting weird", 2, 420, 60),
    makePost("2", "artificial", "Open source AI agent debate heats up", 6, 300, 40),
    makePost("3", "MachineLearning", "Researchers compare AI agent memory stacks", 20, 180, 24),
    makePost("4", "worldnews", "Tariff shock spreads through shipping routes", 3, 260, 41),
    makePost("5", "economics", "Tariff shock hits consumer prices again", 10, 210, 33),
    makePost("6", "news", "Retail reacts to tariff shock warnings", 28, 110, 17),
    makePost("7", "CryptoCurrency", "Memecoin rotation on Solana starts again", 1, 510, 88),
    makePost("8", "wallstreetbets", "Memecoin rotation catches traders off guard", 5, 300, 55),
    makePost("9", "memes", "This memecoin rotation meme is everywhere", 8, 220, 34),
    makePost("10", "memes", "Viral meme format turns into memecoin rotation joke", 32, 95, 12),
    makePost("11", "gaming", "Patch day meltdown meme spreads fast", 4, 190, 26),
    makePost("12", "dankmemes", "Patch day meltdown posts take over", 9, 140, 18),
    makePost("13", "OutOfTheLoop", "Why is patch day meltdown trending", 18, 120, 17),
    makePost("14", "politics", "Election clip remix cycle returns", 6, 150, 23),
    makePost("15", "worldnews", "Election clip remix spills into global feeds", 14, 118, 19),
    makePost("16", "news", "Election clip remix drives morning coverage", 29, 75, 11),
    makePost("17", "economics", "Rate cut panic returns to the market", 4, 170, 27),
    makePost("18", "investing", "Rate cut panic shows up in positioning", 16, 102, 14),
  ],
  comments: [
    makeComment("c1", "1", "technology", 18, 14),
    makeComment("c2", "1", "technology", 33, 8),
    makeComment("c3", "2", "artificial", 51, 6),
    makeComment("c4", "2", "artificial", 95, 3),
    makeComment("c5", "3", "MachineLearning", 215, 5),
    makeComment("c6", "4", "worldnews", 9, 17),
    makeComment("c7", "4", "worldnews", 24, 12),
    makeComment("c8", "5", "economics", 38, 7),
    makeComment("c9", "5", "economics", 74, 4),
    makeComment("c10", "7", "CryptoCurrency", 6, 22),
    makeComment("c11", "7", "CryptoCurrency", 11, 15),
    makeComment("c12", "7", "CryptoCurrency", 17, 10),
    makeComment("c13", "8", "wallstreetbets", 29, 18),
    makeComment("c14", "8", "wallstreetbets", 45, 12),
    makeComment("c15", "9", "memes", 70, 8),
    makeComment("c16", "9", "memes", 91, 6),
    makeComment("c17", "11", "gaming", 54, 5),
    makeComment("c18", "12", "dankmemes", 118, 3),
    makeComment("c19", "13", "OutOfTheLoop", 160, 4),
    makeComment("c20", "14", "politics", 14, 16),
    makeComment("c21", "14", "politics", 22, 14),
    makeComment("c22", "15", "worldnews", 49, 8),
    makeComment("c23", "15", "worldnews", 88, 5),
    makeComment("c24", "17", "economics", 26, 9),
    makeComment("c25", "17", "economics", 40, 6),
    makeComment("c26", "18", "investing", 96, 3),
  ],
};

describe("trend dashboard adapters", () => {
  it("returns zero-state when no Reddit posts are available", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt: null,
        error: null,
        posts: [],
        comments: [],
      },
    );

    expect(vm.leaderboard).toHaveLength(0);
    expect(vm.leaderboards.emerging).toHaveLength(0);
    expect(vm.detail).toBeNull();
  });

  it("builds ranked subreddit trends from Reddit posts and filters meme scope", async () => {
    const overall = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      snapshot,
    );
    const memes = await getTrendDashboardVM(
      {
        scope: "memes",
        range: "24h",
        sort: "mentions",
      },
      snapshot,
    );

    expect(overall.leaderboard.length).toBeGreaterThan(3);
    expect(overall.leaderboard.every((trend) => trend.platforms[0] === "reddit")).toBe(true);
    expect(overall.leaderboard[0].attentionInteractions).toBeGreaterThan(0);
    expect(overall.leaderboard[0].confidenceScore).toBeGreaterThan(0);
    expect(overall.leaderboard[0].topPosts[0]?.engagement).toBeGreaterThan(0);
    expect(overall.leaderboard.every((trend) => !trend.name.startsWith("r/"))).toBe(true);
    expect(overall.detail?.platformBreakdown).toEqual([
      expect.objectContaining({
        platformId: "reddit",
        sharePct: 100,
      }),
    ]);
    expect(memes.leaderboard.length).toBeGreaterThan(0);
    expect(memes.leaderboard.every((trend) => trend.scope === "memes")).toBe(true);
    expect(memes.leaderboard[0].mentions).toBeGreaterThanOrEqual(memes.leaderboard[1].mentions);
  });

  it("keeps the dashboard stable when posts exist but comments are sparse", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        ...snapshot,
        comments: [],
      },
    );

    expect(vm.leaderboard.length).toBeGreaterThan(0);
    expect(vm.leaderboard.every((trend) => trend.attentionInteractions > 0)).toBe(true);
    expect(vm.leaderboard.some((trend) => trend.lowDataWarning)).toBe(true);
    expect(vm.detail?.attentionGraph.every((point) => Number.isFinite(point.value))).toBe(true);
    expect(vm.detail?.attentionGraph.some((point) => point.value > 0)).toBe(true);
  });

  it("prioritizes post creation over low-signal likes in weighted interaction scoring", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [
          makePost("orion-1", "technology", "Orion Launch reaches milestone", 2, 12, 0),
          makePost("orion-2", "technology", "Orion Launch briefing expands", 4, 8, 0),
        ],
        comments: [],
        publicItems: [
          makePublicItem(
            "yt-like-heavy",
            "Clip Watch",
            "Galaxy meme recap",
            "Likes 1.2M. Comments 0.",
            1,
            95,
            0,
            "youtube",
            {
              posts: 1,
              reposts: 0,
              comments: 0,
              likes: 1_200_000,
            },
          ),
        ],
      },
    );

    expect(vm.leaderboard[0]?.name).toContain("Orion Launch");
    expect(vm.leaderboard[0]?.attentionInteractions).toBeGreaterThan(
      vm.leaderboard.find((trend) => trend.name.includes("Galaxy meme"))?.attentionInteractions ?? 0,
    );
  });

  it("keeps a selected non-top-five trend visible in the overview graph", async () => {
    const baseline = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      snapshot,
    );
    const selected = baseline.leaderboard[5] ?? baseline.leaderboard.at(-1);
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
        selectedId: selected.id,
      },
      snapshot,
    );

    expect(vm.overviewSeries.length).toBeGreaterThanOrEqual(2);
    expect(vm.overviewSeries.some((series) => series.id === "all-trends-aggregate")).toBe(true);
    expect(vm.overviewSeries.some((series) => series.id === selected.id)).toBe(true);
    expect(vm.detail?.trend.id).toBe(selected.id);
  });

  it("keeps historically dominant narratives in the overview even after they fade", async () => {
    const earlyCommentMinutes = [1320, 1290, 1260, 1230, 1200, 1170, 1140, 1110];
    const lateCommentMinutes = [70, 65, 60, 55, 50, 45, 40, 35, 30, 25];
    const trendDefinitions = [
      {
        key: "aurora",
        label: "Aurora Signal",
        tag: "Meridian",
        subreddit: "technology",
        postHours: [23, 21],
        comments: earlyCommentMinutes,
      },
      {
        key: "beacon",
        label: "Beacon Pulse",
        tag: "Lantern",
        subreddit: "worldnews",
        postHours: [3, 2],
        comments: lateCommentMinutes,
      },
      {
        key: "cipher",
        label: "Cipher Leak",
        tag: "Harbor",
        subreddit: "economics",
        postHours: [3, 2],
        comments: lateCommentMinutes,
      },
      {
        key: "delta",
        label: "Delta Rumor",
        tag: "Circuit",
        subreddit: "news",
        postHours: [3, 2],
        comments: lateCommentMinutes,
      },
      {
        key: "ember",
        label: "Ember Cycle",
        tag: "Forge",
        subreddit: "politics",
        postHours: [3, 2],
        comments: lateCommentMinutes,
      },
      {
        key: "fable",
        label: "Fable Wave",
        tag: "Current",
        subreddit: "gaming",
        postHours: [3, 2],
        comments: lateCommentMinutes,
      },
    ];
    const posts = trendDefinitions.flatMap((trend) => [
      makePost(
        `${trend.key}-1`,
        trend.subreddit,
        `${trend.label} ${trend.tag} expands`,
        trend.postHours[0],
        180,
        Math.ceil(trend.comments.length / 2),
      ),
      makePost(
        `${trend.key}-2`,
        trend.subreddit,
        `${trend.label} ${trend.tag} cools`,
        trend.postHours[1],
        140,
        Math.floor(trend.comments.length / 2),
      ),
    ]);
    const comments = trendDefinitions.flatMap((trend) =>
      trend.comments.map((minutesAgo, index) =>
        makeComment(
          `${trend.key}-c${index + 1}`,
          `${trend.key}-${index % 2 === 0 ? 1 : 2}`,
          trend.subreddit,
          minutesAgo,
        ),
      ),
    );
    const rotationSnapshot: RedditIngestionSnapshot = {
      source: "reddit",
      fetchedAt,
      error: null,
      posts,
      comments,
    };
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      rotationSnapshot,
    );
    const earlyTrend = vm.leaderboard.find(
      (trend) => trend.id.includes("aurora") || trend.name.includes("Aurora Signal"),
    );

    expect(earlyTrend).toBeDefined();
    expect(earlyTrend?.rank).toBeGreaterThan(5);
    expect(vm.overviewSeries.length).toBeGreaterThanOrEqual(2);
    expect(vm.overviewSeries.some((series) => series.id === "all-trends-aggregate")).toBe(true);
    expect(vm.overviewSeries.some((series) => series.id === earlyTrend?.id)).toBe(true);
  });

  it("supports strength sorting and emerging ranking", async () => {
    const strength = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "strength",
      },
      snapshot,
    );
    const fastest = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        mode: "emerging",
        sort: "breakout",
      },
      snapshot,
    );

    expect(strength.leaderboard[0].trendStrengthScore).toBeGreaterThanOrEqual(
      strength.leaderboard[1].trendStrengthScore,
    );
    expect(fastest.leaderboard[0].emergingScore ?? 0).toBeGreaterThanOrEqual(
      fastest.leaderboard[1].emergingScore ?? 0,
    );
    expect(fastest.leaderboards.emerging[0].emergingScore ?? 0).toBeGreaterThanOrEqual(
      fastest.leaderboards.emerging[1].emergingScore ?? 0,
    );
    expect(typeof fastest.leaderboards.emerging[0].positionChange24h).toBe("number");
  });

  it("builds narratives from public-source items even without Reddit posts", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        publicItems: [
          makePublicItem(
            "n1",
            "BBC World",
            "Atlas chip export controls tighten",
            "New export controls tighten around Atlas chips and related AI hardware.",
            2,
            80,
            24,
          ),
          makePublicItem(
            "n2",
            "NPR",
            "Atlas chip restrictions hit cloud builders",
            "Cloud builders react as Atlas chip restrictions expand.",
            5,
            65,
            18,
          ),
          makePublicItem(
            "n3",
            "TechCrunch",
            "Atlas chip rule sparks startup scramble",
            "Startups are scrambling to respond to the Atlas chip rule.",
            7,
            58,
            12,
          ),
        ],
      },
    );

    expect(vm.leaderboard.length).toBeGreaterThan(0);
    expect(vm.overviewSeries.length).toBeGreaterThan(0);
    expect(vm.detail?.trend.platforms).toContain("news");
    expect(vm.detail?.platformBreakdown).toEqual([
      expect.objectContaining({
        platformId: "news",
      }),
    ]);
  });

  it("preserves google trends items as google platform signals in ranked trends", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        publicItems: [
          makePublicItem(
            "g1",
            "Google Trends US",
            "AWS outage",
            "Approx traffic 200K+. Related coverage: Fortune: Amazon retail site outages continue.",
            1,
            80,
            4,
            "googletrends",
          ),
          makePublicItem(
            "g2",
            "Google Trends US",
            "AWS outage hits retail traffic",
            "Approx traffic 200K+. Related coverage: Reuters: AWS service disruption expands.",
            2,
            70,
            4,
            "googletrends",
          ),
        ],
      },
    );

    expect(vm.leaderboard.length).toBeGreaterThan(0);
    expect(vm.detail?.trend.platforms).toContain("google");
    expect(vm.detail?.platformBreakdown).toEqual([
      expect.objectContaining({
        platformId: "google",
      }),
    ]);
    expect(vm.detail?.trend.googleSearchInterest).toEqual(
      expect.objectContaining({
        approxTrafficLabel: "200K+",
        matchedQueries: expect.arrayContaining(["AWS outage", "AWS outage hits retail traffic"]),
        queryCount: 2,
      }),
    );
    expect(vm.detail?.topPosts[0]?.platformId).toBe("google");
    expect(vm.detail?.topPosts[0]?.title).toContain("Google Trends US");
  });

  it("preserves youtube items as youtube platform signals in ranked trends", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        publicItems: [
          makePublicItem(
            "yt1",
            "Infra Watch",
            "AWS outage explained",
            "Likes 34K. Comments 5.4K. Views 1.2M. Channel breaks down the outage.",
            2,
            96,
            5400,
            "youtube",
            undefined,
            {
              description: "Channel breaks down the outage.",
              viewCount: 1_200_000,
              likeCount: 34_000,
              commentCount: 5_400,
              channelHandle: "@infrawatch",
            },
          ),
          makePublicItem(
            "yt2",
            "Global Desk",
            "AWS outage timeline explained",
            "Likes 18K. Comments 2.7K. Views 800K. Follow-up analysis.",
            4,
            88,
            2700,
            "youtube",
            undefined,
            {
              description: "Follow-up analysis.",
              viewCount: 800_000,
              likeCount: 18_000,
              commentCount: 2_700,
              channelHandle: "@globaldesk",
            },
          ),
        ],
      },
    );

    expect(vm.leaderboard.length).toBeGreaterThan(0);
    expect(vm.detail?.trend.platforms).toContain("youtube");
    expect(vm.detail?.platformBreakdown).toEqual([
      expect.objectContaining({
        platformId: "youtube",
      }),
    ]);
    expect(vm.detail?.trend.supportingThreadCount).toBeGreaterThanOrEqual(2);
    expect(vm.detail?.topPosts[0]?.platformId).toBe("youtube");
    expect(vm.detail?.topPosts[0]?.title).toMatch(/Infra Watch|Global Desk/);
  });

  it("suppresses one-off youtube videos and keeps repeated cross-channel title clusters", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        publicItems: [
          makePublicItem(
            "yt-cluster-1",
            "World Brief",
            "Red Sea shipping crisis explained",
            "Likes 11K. Comments 1.9K. Views 420K. Analysis from World Brief.",
            2,
            82,
            1900,
            "youtube",
            undefined,
            {
              description: "Analysis from World Brief.",
              viewCount: 420_000,
              likeCount: 11_000,
              commentCount: 1_900,
            },
          ),
          makePublicItem(
            "yt-cluster-2",
            "Global Desk",
            "Red Sea shipping crisis timeline",
            "Likes 9K. Comments 1.4K. Views 360K. Timeline from Global Desk.",
            3,
            78,
            1400,
            "youtube",
            undefined,
            {
              description: "Timeline from Global Desk.",
              viewCount: 360_000,
              likeCount: 9_000,
              commentCount: 1_400,
            },
          ),
          makePublicItem(
            "yt-cluster-3",
            "Frontline Now",
            "Red Sea shipping crisis hits insurers",
            "Likes 8K. Comments 1.1K. Views 310K. Insurance angle.",
            5,
            74,
            1100,
            "youtube",
            undefined,
            {
              description: "Insurance angle.",
              viewCount: 310_000,
              likeCount: 8_000,
              commentCount: 1_100,
            },
          ),
          makePublicItem(
            "yt-oneoff",
            "Solo Desk",
            "Cabinet drama full interview",
            "Likes 42K. Comments 900. Views 1.4M. One-off interview.",
            1,
            91,
            900,
            "youtube",
            undefined,
            {
              description: "One-off interview.",
              viewCount: 1_400_000,
              likeCount: 42_000,
              commentCount: 900,
            },
          ),
        ],
      },
    );

    expect(vm.leaderboard.length).toBeGreaterThan(0);
    expect(vm.leaderboard.some((trend) => /cabinet drama/i.test(trend.name))).toBe(false);
    expect(vm.leaderboard[0]?.name).toMatch(/Red Sea/i);
    expect(vm.leaderboard[0]?.supportingThreadCount).toBeGreaterThanOrEqual(3);
  });

  it("uses youtube comments and snapshot deltas as time-aware narrative signals", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        publicItems: [
          makePublicItem(
            "youtube:yt-delta-1",
            "Infra Watch",
            "AWS outage explained",
            "Likes 140. Comments 18. Views 1.5K. Channel breaks down the outage.",
            2,
            88,
            18,
            "youtube",
            undefined,
            {
              description: "Channel breaks down the outage.",
              viewCount: 1_500,
              likeCount: 140,
              commentCount: 18,
              initialViewCount: 1_000,
              initialLikeCount: 100,
              initialCommentCount: 10,
              deltaViewCount: 500,
              deltaLikeCount: 40,
              deltaCommentCount: 8,
              deltaWindowMinutes: 60,
              channelHandle: "@infrawatch",
            },
          ),
        ],
        youtubeComments: [
          {
            id: "youtube-comment:top-1",
            source: "youtube",
            sourceType: "youtube_comment",
            postId: "youtube:yt-delta-1",
            parentId: "youtube:yt-delta-1",
            videoId: "yt-delta-1",
            sourceName: "Infra Watch",
            videoTitle: "AWS outage explained",
            author: "Top Commenter",
            body: "Everyone is talking about the AWS outage",
            createdUtc: Math.floor(
              (new Date(fetchedAt).getTime() - 30 * 60 * 1000) / 1000,
            ),
            score: 14,
            likeCount: 14,
            replyCount: 1,
            isReply: false,
            url: "https://www.youtube.com/watch?v=yt-delta-1&lc=top-1",
            fetchedAt,
          },
          {
            id: "youtube-comment:reply-1",
            source: "youtube",
            sourceType: "youtube_comment",
            postId: "youtube:yt-delta-1",
            parentId: "youtube-comment:top-1",
            videoId: "yt-delta-1",
            sourceName: "Infra Watch",
            videoTitle: "AWS outage explained",
            author: "Reply Person",
            body: "This is spreading fast",
            createdUtc: Math.floor(
              (new Date(fetchedAt).getTime() - 20 * 60 * 1000) / 1000,
            ),
            score: 4,
            likeCount: 4,
            replyCount: 0,
            isReply: true,
            url: "https://www.youtube.com/watch?v=yt-delta-1&lc=reply-1",
            fetchedAt,
          },
        ],
        youtubeVideoSnapshots: [
          {
            id: "youtube-snapshot:yt-delta-1:one",
            videoId: "yt-delta-1",
            fetchedAt: "2026-03-16T09:00:00.000Z",
            createdUtc: Math.floor(
              (new Date(fetchedAt).getTime() - 60 * 60 * 1000) / 1000,
            ),
            viewCount: 1_500,
            likeCount: 140,
            commentCount: 18,
            deltaViewCount: 500,
            deltaLikeCount: 40,
            deltaCommentCount: 8,
            deltaWindowMinutes: 60,
          },
        ],
      },
    );

    expect(vm.leaderboard.length).toBeGreaterThan(0);
    expect(vm.detail?.trend.platforms).toContain("youtube");
    expect(vm.detail?.trend.supportingThreadCount).toBe(1);
    expect(vm.detail?.trend.attentionInteractions).toBeGreaterThan(20);
    expect(vm.detail?.trend.growthRate).toBeGreaterThanOrEqual(0);
    expect(vm.detail?.attentionGraph.some((point) => point.value > 0)).toBe(true);
    expect(vm.detail?.topPosts[0]?.platformId).toBe("youtube");
  });

  it("drops fallback fragment labels when the documents do not resolve into a real narrative", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        publicItems: [
          makePublicItem(
            "noise-1",
            "NPR",
            "Thank you for being here right now",
            "A vague filler headline with no concrete topic anchor.",
            2,
            20,
            4,
          ),
          makePublicItem(
            "noise-2",
            "TechCrunch",
            "Been building this for last year",
            "Another broken fragment that should not become a dashboard narrative.",
            3,
            18,
            3,
          ),
          makePublicItem(
            "noise-3",
            "BBC World",
            "Now but thank you again",
            "Yet another low-quality phrase fragment without a real topic.",
            4,
            16,
            2,
          ),
        ],
      },
    );

    expect(vm.leaderboard).toHaveLength(0);
    expect(vm.detail).toBeNull();
  });

  it("prefers concrete labels over fragment-like phrases for real low-volume narratives", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        publicItems: [
          makePublicItem(
            "switch-1",
            "Polygon",
            "Need Help with Switch 2 preorder cancellation emails",
            "Retailers start sending cancellation notices for Switch 2 preorders.",
            3,
            34,
            5,
          ),
          makePublicItem(
            "switch-2",
            "IGN",
            "Switch 2 preorder cancellation wave hits major retailers",
            "Target and Walmart shoppers report new Switch 2 preorder cancellations.",
            2,
            48,
            8,
          ),
          makePublicItem(
            "switch-3",
            "The Verge",
            "Need Advice on Switch 2 preorder refunds as queues expand",
            "Australia preorder queues and refund questions rise around Switch 2 launch stock.",
            1,
            29,
            4,
          ),
        ],
      },
    );

    expect(vm.leaderboard.length).toBeGreaterThan(0);
    expect(
      vm.leaderboard.some((trend) => /need help|need advice|even though|his own|done all|was hard/i.test(trend.name)),
    ).toBe(false);
    expect(
      vm.leaderboard.some((trend) => /switch 2|preorder|cancellation/i.test(trend.name)),
    ).toBe(true);
  });

  it("relabels boilerplate teaser clusters and suppresses only-one scaffolding", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        publicItems: [
          makePublicItem(
            "dune-1",
            "Variety",
            "Dune: Part Three | Official Teaser Trailer",
            "The first Dune: Part Three teaser trailer starts circulating.",
            3,
            52,
            8,
          ),
          makePublicItem(
            "dune-2",
            "Deadline",
            "Dune: Part Three | Official Teaser",
            "Studios release a short Dune: Part Three teaser clip.",
            2,
            48,
            7,
          ),
          makePublicItem(
            "dune-3",
            "Empire",
            "Dune Part Three teaser sparks casting speculation",
            "Named cast discussion grows around Dune Part Three.",
            1,
            36,
            5,
          ),
          makePublicItem(
            "only-1",
            "Reddit Wire",
            "Am I the only one who still buys mini discs?",
            "A conversational one-off question without a durable narrative anchor.",
            2,
            22,
            3,
          ),
          makePublicItem(
            "only-2",
            "Bluesky Digest",
            "Tell me I'm not the only one who thinks this keyboard sounds haunted",
            "Another conversational fragment that should not survive as a trend label.",
            2,
            18,
            2,
          ),
          makePublicItem(
            "only-3",
            "Meme Monitor",
            "Mood rn, am I the only one?",
            "Low-quality social phrasing with no real topic label.",
            1,
            16,
            2,
          ),
          makePublicItem(
            "xbox-1",
            "The Verge",
            "Xbox handheld prototype leaks into developer chats",
            "Developers start discussing a new Xbox handheld prototype leak.",
            2,
            44,
            6,
          ),
          makePublicItem(
            "xbox-2",
            "Windows Central",
            "Xbox handheld prototype leak gains supply-chain detail",
            "Supply-chain detail starts firming up around the Xbox handheld prototype.",
            1,
            41,
            5,
          ),
        ],
      },
    );

    expect(
      vm.leaderboard.some((trend) => /official teaser|only one/i.test(trend.name)),
    ).toBe(false);
    expect(vm.leaderboard.length).toBeGreaterThan(0);
  });

  it("does not promote conversational question scaffolding as a ranked narrative", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [
          makePost(
            "q1",
            "AskReddit",
            "What do you think of NYC trying to get the minimum wage to $30/hour?",
            2,
            520,
            22,
          ),
          makePost(
            "q2",
            "Overwatch",
            "Are there any perks, minor or major, that you think should be a part of a heroes base kit?",
            3,
            420,
            16,
          ),
          makePost(
            "q3",
            "NoStupidQuestions",
            "What is a backshot",
            4,
            470,
            19,
          ),
          makePost(
            "iran-1",
            "politics",
            "Top US counterterrorism official resigns over Iran war",
            1,
            840,
            28,
          ),
          makePost(
            "iran-2",
            "news",
            "Trump faces backlash over Iran war comments",
            3,
            780,
            24,
          ),
          makePost(
            "hormuz-1",
            "worldnews",
            "Trump calls on UK and others to send warships to Strait of Hormuz",
            1,
            1040,
            31,
          ),
          makePost(
            "hormuz-2",
            "worldnews",
            "France rules out operations to unblock Strait of Hormuz",
            5,
            910,
            22,
          ),
        ],
        comments: [
          ...Array.from({ length: 12 }, (_, index) =>
            makeComment(`q1-c${index + 1}`, "q1", "AskReddit", 10 + index * 2, 4),
          ),
          ...Array.from({ length: 10 }, (_, index) =>
            makeComment(`q2-c${index + 1}`, "q2", "Overwatch", 16 + index * 3, 3),
          ),
          ...Array.from({ length: 11 }, (_, index) =>
            makeComment(`q3-c${index + 1}`, "q3", "NoStupidQuestions", 22 + index * 3, 3),
          ),
          ...Array.from({ length: 14 }, (_, index) =>
            makeComment(`iran-1-c${index + 1}`, "iran-1", "politics", 8 + index * 2, 5),
          ),
          ...Array.from({ length: 12 }, (_, index) =>
            makeComment(`iran-2-c${index + 1}`, "iran-2", "news", 14 + index * 2, 4),
          ),
          ...Array.from({ length: 16 }, (_, index) =>
            makeComment(`hormuz-1-c${index + 1}`, "hormuz-1", "worldnews", 6 + index * 2, 6),
          ),
          ...Array.from({ length: 13 }, (_, index) =>
            makeComment(`hormuz-2-c${index + 1}`, "hormuz-2", "worldnews", 18 + index * 2, 4),
          ),
        ],
      },
    );

    expect(
      vm.leaderboard.some((trend) =>
        /you think|are you|you can|you ever|are not|those who|real time/i.test(trend.name),
      ),
    ).toBe(false);
    expect(
      vm.leaderboard.some((trend) => /iran war|strait hormuz|minimum wage|backshot/i.test(trend.name)),
    ).toBe(true);
  });

  it("surfaces smaller emerging breakouts without mostly duplicating the main attention board", async () => {
    const publicItems = [
      makePublicItem(
        "tariff-1",
        "Reuters",
        "Tariff shock hits Asia shipping routes again",
        "Shipping insurers react to another tariff shock update.",
        20,
        540,
        72,
      ),
      makePublicItem(
        "tariff-2",
        "Bloomberg",
        "Tariff shock widens as freight rates jump",
        "Freight and shipping lanes keep repricing around tariff risk.",
        10,
        510,
        69,
      ),
      makePublicItem(
        "tariff-3",
        "CNBC",
        "Tariff shock drives another retail warning cycle",
        "Retail earnings warnings keep referencing the tariff shock.",
        2,
        470,
        61,
      ),
      makePublicItem(
        "memecoin-1",
        "CoinDesk",
        "Memecoin rotation takes over Solana desks",
        "Large traders lean back into the memecoin rotation theme.",
        18,
        520,
        66,
      ),
      makePublicItem(
        "memecoin-2",
        "The Block",
        "Memecoin rotation expands beyond Solana majors",
        "The rotation broadens across meme-heavy crypto pairs.",
        7,
        500,
        63,
      ),
      makePublicItem(
        "memecoin-3",
        "Decrypt",
        "Memecoin rotation dominates crypto chatter again",
        "Crypto desks keep calling out the same memecoin rotation theme.",
        1,
        450,
        58,
      ),
      makePublicItem(
        "election-1",
        "BBC",
        "Election clip remix floods morning feeds",
        "Campaign teams respond as the election clip remix spreads.",
        19,
        430,
        54,
      ),
      makePublicItem(
        "election-2",
        "AP",
        "Election clip remix returns to mainstream coverage",
        "Broad media coverage tracks the election clip remix cycle.",
        8,
        410,
        51,
      ),
      makePublicItem(
        "election-3",
        "CBS",
        "Election clip remix keeps trending across broadcast segments",
        "The remix cycle remains large and visible across broadcast coverage.",
        2,
        395,
        47,
      ),
      makePublicItem(
        "switch2-1",
        "IGN",
        "Switch 2 preorder queues start spilling into Australia",
        "Retail queues and allocation caps are starting to spread.",
        5,
        96,
        10,
      ),
      makePublicItem(
        "switch2-2",
        "The Verge",
        "Switch 2 preorder allocation caps spread to more retailers",
        "More stores are adding caps and queue limits for Switch 2 preorders.",
        1,
        122,
        13,
      ),
      makePublicItem(
        "operator-1",
        "TechCrunch",
        "OpenAI Operator browser benchmark starts circulating",
        "Early benchmark screenshots for Operator browser use are spreading.",
        6,
        88,
        9,
      ),
      makePublicItem(
        "operator-2",
        "The Information",
        "OpenAI Operator browser benchmark reaches developer feeds",
        "Developer communities start sharing the same Operator benchmark result.",
        1,
        116,
        12,
      ),
      makePublicItem(
        "vpn-1",
        "Rest of World",
        "Telegram VPN block reports rise in regional channels",
        "Regional channels start warning about a fresh Telegram VPN block.",
        4,
        74,
        8,
      ),
      makePublicItem(
        "vpn-2",
        "Wired",
        "Telegram VPN block alerts spread across messaging communities",
        "Messaging communities begin sharing Telegram VPN block workarounds.",
        1,
        110,
        11,
      ),
      makePublicItem(
        "chip-1",
        "Nikkei",
        "Quantum chip export rule draft appears in policy circles",
        "A draft export rule for quantum chips starts circulating.",
        7,
        82,
        7,
      ),
      makePublicItem(
        "chip-2",
        "Financial Times",
        "Quantum chip export rule leaks into semiconductor chats",
        "Semiconductor policy watchers start picking up the export rule draft.",
        1,
        118,
        10,
      ),
      makePublicItem(
        "rareearth-1",
        "Reuters",
        "Rare earth export list starts circulating through supply-chain desks",
        "Supply-chain desks are beginning to share a new rare earth export list.",
        5,
        84,
        8,
      ),
      makePublicItem(
        "rareearth-2",
        "Nikkei",
        "Rare earth export list reaches battery and EV communities",
        "Battery and EV communities begin reacting to the same export list.",
        1,
        114,
        11,
      ),
      makePublicItem(
        "satellite-1",
        "Ars Technica",
        "Satellite text beta outage reports begin clustering",
        "Users begin sharing the same satellite text beta outage symptoms.",
        4,
        78,
        7,
      ),
      makePublicItem(
        "satellite-2",
        "The Verge",
        "Satellite text beta outage reports spread to carrier channels",
        "Carrier watchers start picking up the satellite text beta outage chatter.",
        1,
        109,
        10,
      ),
    ];
    const attention = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        publicItems,
      },
    );
    const emerging = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        mode: "emerging",
        sort: "breakout",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        publicItems,
      },
    );
    const topAttentionIds = attention.leaderboard.slice(0, 5).map((trend) => trend.id);
    const emergingIds = emerging.leaderboard.slice(0, 5).map((trend) => trend.id);
    const overlap = emergingIds.filter((id) => topAttentionIds.includes(id)).length;

    expect(
      emerging.leaderboard.some((trend) =>
        /switch 2|openai operator|telegram vpn|quantum chip/i.test(trend.name),
      ),
    ).toBe(true);
    expect(overlap).toBeLessThan(3);
    expect(
      emerging.leaderboard.some(
        (trend) => trend.attentionInteractions < attention.leaderboard[0].attentionInteractions,
      ),
    ).toBe(true);
  });

  it("drops recurring market-moves thread prompts instead of ranking them as narratives", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "6h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [
          makePost("move-1", "wallstreetbets", "What Are Your Moves Tomorrow, March 16, 2026", 5, 820, 44),
          makePost("move-2", "wallstreetbets", "What Are Your Moves Tomorrow, March 17, 2026", 3, 880, 47),
          makePost("move-3", "wallstreetbets", "What Are Your Moves Tomorrow, March 18, 2026", 1, 940, 52),
        ],
        comments: [
          ...Array.from({ length: 18 }, (_, index) =>
            makeComment(`move-1-c${index + 1}`, "move-1", "wallstreetbets", 160 - index * 3, 3),
          ),
          ...Array.from({ length: 19 }, (_, index) =>
            makeComment(`move-2-c${index + 1}`, "move-2", "wallstreetbets", 95 - index * 2, 3),
          ),
          ...Array.from({ length: 20 }, (_, index) =>
            makeComment(`move-3-c${index + 1}`, "move-3", "wallstreetbets", 55 - index * 2, 4),
          ),
        ],
        publicItems: [],
      },
    );

    expect(vm.leaderboard).toHaveLength(0);
    expect(vm.detail).toBeNull();
  });

  it("normalizes diacritics into readable narrative labels instead of broken fragments", async () => {
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "6h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [
          makePost(
            "poke-1",
            "nintendo",
            "Pokemon XD: Gale of Darkness, available now on Nintendo Switch 2 with GameCube - Nintendo Classics!",
            3,
            420,
            18,
          ),
          makePost(
            "poke-2",
            "Games",
            "Pokemon Go players unknowingly trained delivery robots with 30 billion images",
            2,
            360,
            15,
          ),
        ],
        comments: [
          makeComment("poke-1-c1", "poke-1", "nintendo", 50, 5),
          makeComment("poke-2-c1", "poke-2", "Games", 38, 4),
        ],
        publicItems: [
          makePublicItem(
            "poke-news-1",
            "Hacker News Best",
            "Pokemon Go players unknowingly trained delivery robots with 30B images",
            "Pokemon Go players generated image data used to train delivery robots.",
            1,
            52,
            8,
          ),
        ],
      },
    );

    expect(vm.leaderboard.some((trend) => /pok mon/i.test(trend.name))).toBe(false);
    expect(vm.leaderboard.some((trend) => /pokemon|nintendo switch/i.test(trend.name))).toBe(true);
  });

  it("builds a Bluesky firehose overview with leaders, cascades, and propagation data", async () => {
    const rootUri = "at://did:plc:root/app.bsky.feed.post/root";
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        blueskyPosts: [
          makeBlueskyPost(rootUri, "AI agent routing stack is breaking out", 90, {
            authorDid: "did:plc:root",
            authorHandle: "root.bsky.social",
            authorDisplayName: "Root",
          }),
          makeBlueskyPost("at://did:plc:quote/app.bsky.feed.post/q1", "Quoting the AI agent routing stack", 60, {
            postType: "quote",
            authorDid: "did:plc:quote",
            authorHandle: "quote.bsky.social",
            authorDisplayName: "Quote",
            quotedUri: rootUri,
          }),
        ],
        blueskyInteractions: [
          makeBlueskyInteraction("reply-1", rootUri, "reply", 45, {
            actorDid: "did:plc:reply1",
            actorHandle: "reply1.bsky.social",
            actorDisplayName: "Reply One",
            text: "This is spreading quickly",
          }),
          makeBlueskyInteraction("repost-1", rootUri, "repost", 30, {
            actorDid: "did:plc:amp1",
            actorHandle: "amp1.bsky.social",
            actorDisplayName: "Amplifier One",
          }),
          makeBlueskyInteraction("like-1", rootUri, "like", 20, {
            actorDid: "did:plc:like1",
            actorHandle: "like1.bsky.social",
            actorDisplayName: "Like One",
          }),
        ],
        blueskyPostSnapshots: [
          makeBlueskySnapshot("snap-1", rootUri, 10, {
            likeCount: 12,
            replyCount: 3,
            repostCount: 4,
            quoteCount: 1,
            deltaLikeCount: 6,
            deltaCommentCount: 2,
            deltaRepostCount: 3,
            deltaQuoteCount: 1,
          }),
        ],
      },
    );

    expect(vm.blueskyOverview).toBeTruthy();
    expect(vm.blueskyOverview?.leaders.length).toBeGreaterThan(0);
    expect(vm.blueskyOverview?.cascades.length).toBeGreaterThan(0);
    expect(vm.blueskyOverview?.topAmplifiers.length).toBeGreaterThan(0);
    expect(vm.blueskyOverview?.network.nodes.length).toBeGreaterThan(0);
    expect(vm.detail?.blueskyDetail?.cascadeLeaders?.length).toBeGreaterThan(0);
  });

  it("reports raw 24h Bluesky interactions on trend rows instead of weighted scores", async () => {
    const rootUri = "at://did:plc:root/app.bsky.feed.post/raw-count-root";
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        blueskyPosts: [
          makeBlueskyPost(rootUri, "Save Act vote is moving fast", 90, {
            authorDid: "did:plc:root",
            authorHandle: "root.bsky.social",
            authorDisplayName: "Root",
            likeCount: 40,
            replyCount: 10,
            repostCount: 8,
            quoteCount: 2,
          }),
          makeBlueskyPost("at://did:plc:quote/app.bsky.feed.post/raw-count-q1", "Save Act quote", 60, {
            postType: "quote",
            rootUri,
            quotedUri: rootUri,
            authorDid: "did:plc:quote",
            authorHandle: "quote.bsky.social",
            authorDisplayName: "Quote",
          }),
        ],
        blueskyInteractions: [
          makeBlueskyInteraction("reply-1", rootUri, "reply", 45, { text: "Need this passed" }),
          makeBlueskyInteraction("reply-2", rootUri, "reply", 40, { text: "Watching closely" }),
          makeBlueskyInteraction("repost-1", rootUri, "repost", 35),
          makeBlueskyInteraction("repost-2", rootUri, "repost", 30),
          makeBlueskyInteraction("like-1", rootUri, "like", 25),
        ],
        blueskyPostSnapshots: [
          makeBlueskySnapshot("snap-1", rootUri, 10, {
            deltaLikeCount: 12,
            deltaCommentCount: 4,
            deltaRepostCount: 3,
            deltaQuoteCount: 1,
          }),
        ],
      },
    );

    const trend = vm.leaderboard.find((row) => /save act/i.test(row.name));
    expect(trend).toBeDefined();
    expect(trend?.attentionInteractions).toBe(5);
    expect(trend?.totalInteractions24h).toBe(5);
    expect(trend?.sampleSize).toBe(5);
  });

  it("assigns every 24h Bluesky interaction to exactly one trend bucket", async () => {
    const alphaRoot = "at://did:plc:alpha/app.bsky.feed.post/coverage-alpha";
    const betaRoot = "at://did:plc:beta/app.bsky.feed.post/coverage-beta";
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        blueskyPosts: [
          makeBlueskyPost(alphaRoot, "Alpha launch goes live", 80, {
            authorDid: "did:plc:alpha",
            authorHandle: "alpha.bsky.social",
          }),
          makeBlueskyPost(betaRoot, "Beta outage spreads", 70, {
            authorDid: "did:plc:beta",
            authorHandle: "beta.bsky.social",
          }),
        ],
        blueskyInteractions: [
          makeBlueskyInteraction("alpha-like-1", alphaRoot, "like", 60),
          makeBlueskyInteraction("alpha-like-2", alphaRoot, "like", 58),
          makeBlueskyInteraction("alpha-repost-1", alphaRoot, "repost", 56),
          makeBlueskyInteraction("alpha-reply-1", alphaRoot, "reply", 54, {
            text: "Alpha is moving",
          }),
          makeBlueskyInteraction("beta-like-1", betaRoot, "like", 50),
          makeBlueskyInteraction("beta-like-2", betaRoot, "like", 48),
          makeBlueskyInteraction("beta-like-3", betaRoot, "like", 46),
          makeBlueskyInteraction("beta-reply-1", betaRoot, "reply", 44, {
            text: "Beta issue confirmed",
          }),
        ],
      },
    );

    expect(vm.trendCoverage).toMatchObject({
      totalInteractionsInWindow: 8,
      totalInteractionsAssignedToTrends: 8,
      unassignedInteractionsCount: 0,
      totalRootsInWindow: 2,
      assignedRootsCount: 2,
      unassignedRootCount: 0,
      source: "bluesky",
      rankingSource: "ai_grouped_clusters",
    });
    expect(
      vm.leaderboards.established.reduce(
        (sum, row) => sum + (row.totalInteractions24h ?? row.attentionInteractions),
        0,
      ),
    ).toBe(8);
  });

  it("keeps singleton Bluesky roots as valid trend rows", async () => {
    const rootUri = "at://did:plc:solo/app.bsky.feed.post/singleton-root";
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        blueskyPosts: [
          makeBlueskyPost(rootUri, "Solo investigation thread", 50, {
            authorDid: "did:plc:solo",
            authorHandle: "solo.bsky.social",
          }),
        ],
        blueskyInteractions: [
          makeBlueskyInteraction("solo-like-1", rootUri, "like", 40),
          makeBlueskyInteraction("solo-repost-1", rootUri, "repost", 35),
          makeBlueskyInteraction("solo-reply-1", rootUri, "reply", 30, {
            text: "Tracking this",
          }),
        ],
      },
    );

    expect(vm.leaderboard[0]?.isSingleton).toBe(true);
    expect(vm.leaderboard[0]?.rootsCount24h).toBe(1);
    expect(vm.leaderboard[0]?.totalInteractions24h).toBe(3);
  });

  it("does not suppress raw interaction totals for high-activity Bluesky roots or repeated actors", async () => {
    const rootUri = "at://did:plc:heavy/app.bsky.feed.post/heavy-root";
    const repeatedActor = "did:plc:one-actor";
    const interactions = Array.from({ length: 12 }, (_, index) =>
      makeBlueskyInteraction(`heavy-like-${index + 1}`, rootUri, "like", 20 - index, {
        actorDid: repeatedActor,
        actorHandle: "same-actor.bsky.social",
      }),
    );
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        blueskyPosts: [
          makeBlueskyPost(rootUri, "Heavy activity root", 30, {
            authorDid: "did:plc:heavy",
            authorHandle: "heavy.bsky.social",
          }),
        ],
        blueskyInteractions: interactions,
      },
    );

    expect(vm.leaderboard[0]?.totalInteractions24h).toBe(12);
    expect(vm.trendCoverage?.totalInteractionsAssignedToTrends).toBe(12);
  });

  it("groups Bluesky roots that share the same canonical URL into one trend", async () => {
    const alphaRoot = "at://did:plc:url/app.bsky.feed.post/url-alpha";
    const betaRoot = "at://did:plc:url/app.bsky.feed.post/url-beta";
    const sharedUrl = "https://example.com/story/ai-policy?utm_source=test";
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        blueskyPosts: [
          makeBlueskyPost(alphaRoot, `Big AI policy writeup ${sharedUrl}`, 70, {
            title: "AI policy fight intensifies",
          }),
          makeBlueskyPost(betaRoot, `Read this ${sharedUrl}`, 65, {
            title: "AI policy fight intensifies again",
          }),
        ],
        blueskyInteractions: [
          makeBlueskyInteraction("url-like-1", alphaRoot, "like", 55),
          makeBlueskyInteraction("url-like-2", alphaRoot, "repost", 53),
          makeBlueskyInteraction("url-like-3", betaRoot, "like", 51),
          makeBlueskyInteraction("url-like-4", betaRoot, "reply", 49, {
            text: "Same article is everywhere",
          }),
        ],
      },
    );

    expect(vm.leaderboard[0]?.rootsCount24h).toBe(2);
    expect(vm.leaderboard[0]?.totalInteractions24h).toBe(4);
    expect(vm.leaderboard[0]?.labelType).toBe("canonical_url_title");
    expect(vm.leaderboard[0]?.name).toMatch(/AI policy/i);
  });

  it("groups strong repeated entity and phrase narratives with slightly different wording", async () => {
    const alphaRoot = "at://did:plc:save/app.bsky.feed.post/save-alpha";
    const betaRoot = "at://did:plc:save/app.bsky.feed.post/save-beta";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_TREND_GROUPING_ENABLED = "true";
    interpretBlueskyRootsMock.mockResolvedValue(
      new Map([
        [
          alphaRoot,
          {
            rootId: alphaRoot,
            summaryTopic: "SAVE Act vote",
            candidateLabel: "SAVE Act vote",
            shortDescription: "Trump-backed SAVE Act vote chatter",
            entities: ["SAVE Act", "Trump"],
            canonicalKeywords: ["save act", "trump", "vote"],
            contentType: "news",
            trendCategory: "politics",
            language: "en",
            isTemplateLike: false,
            isLowInformation: false,
            spamLikelihood: 0.04,
            templateLikelihood: 0.02,
            contextualCoherence: 0.91,
            semanticKey: "save act vote",
            secondaryKeys: ["trump save act"],
          },
        ],
        [
          betaRoot,
          {
            rootId: betaRoot,
            summaryTopic: "SAVE Act vote",
            candidateLabel: "SAVE Act vote",
            shortDescription: "Trump-backed SAVE Act vote chatter",
            entities: ["SAVE Act", "Trump"],
            canonicalKeywords: ["save act", "vote"],
            contentType: "news",
            trendCategory: "politics",
            language: "en",
            isTemplateLike: false,
            isLowInformation: false,
            spamLikelihood: 0.04,
            templateLikelihood: 0.02,
            contextualCoherence: 0.9,
            semanticKey: "save act vote",
            secondaryKeys: ["save act"],
          },
        ],
      ]),
    );
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        blueskyPosts: [
          makeBlueskyPost(alphaRoot, "President Trump pushes SAVE Act vote this week", 80, {
            title: "President Trump pushes SAVE Act vote",
          }),
          makeBlueskyPost(betaRoot, "SAVE Act vote gains steam after Trump backing", 74, {
            title: "SAVE Act vote gains steam",
          }),
        ],
        blueskyInteractions: [
          makeBlueskyInteraction("save-like-1", alphaRoot, "like", 60),
          makeBlueskyInteraction("save-like-2", alphaRoot, "repost", 58),
          makeBlueskyInteraction("save-like-3", betaRoot, "like", 56),
          makeBlueskyInteraction("save-like-4", betaRoot, "reply", 54, {
            text: "SAVE Act is the story here",
          }),
        ],
      },
    );

    expect(vm.leaderboard[0]?.rootsCount24h).toBe(2);
    expect(vm.leaderboard[0]?.totalInteractions24h).toBe(4);
    expect(vm.leaderboard[0]?.name).toMatch(/save act vote/i);
    expect(vm.leaderboard[0]?.labelType).toBe("ai_generated");
    expect(vm.leaderboard[0]?.groupingSource).toBe("ai_semantic_cluster");
  });

  it("does not over-merge unrelated roots that only share a broad single entity", async () => {
    const alphaRoot = "at://did:plc:trump/app.bsky.feed.post/trump-alpha";
    const betaRoot = "at://did:plc:trump/app.bsky.feed.post/trump-beta";
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        blueskyPosts: [
          makeBlueskyPost(alphaRoot, "Trump rally schedule for Michigan released", 80),
          makeBlueskyPost(betaRoot, "Trump tariff proposal hits shipping shares", 78),
        ],
        blueskyInteractions: [
          makeBlueskyInteraction("trump-like-1", alphaRoot, "like", 60),
          makeBlueskyInteraction("trump-like-2", alphaRoot, "like", 58),
          makeBlueskyInteraction("trump-like-3", betaRoot, "like", 56),
          makeBlueskyInteraction("trump-like-4", betaRoot, "like", 54),
        ],
      },
    );

    expect(vm.leaderboard.slice(0, 2).map((row) => row.rootsCount24h)).toEqual([1, 1]);
    expect(
      vm.leaderboard
        .slice(0, 2)
        .every((row) => !/Bluesky topic|Bluesky thread/i.test(row.name)),
    ).toBe(true);
  });

  it("gives singleton Bluesky roots readable labels instead of raw fallback ids when text is usable", async () => {
    const rootUri = "at://did:plc:rates/app.bsky.feed.post/rates-root";
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        blueskyPosts: [
          makeBlueskyPost(rootUri, "Federal Reserve rate cut odds spike again", 50, {
            title: "Federal Reserve rate cut odds spike again",
          }),
        ],
        blueskyInteractions: [
          makeBlueskyInteraction("rates-like-1", rootUri, "like", 30),
        ],
      },
    );

    expect(vm.leaderboard[0]?.isSingleton).toBe(true);
    expect(vm.leaderboard[0]?.labelType).not.toBe("fallback_generated");
    expect(vm.leaderboard[0]?.name).toMatch(/Federal Reserve|Rate Cut Odds/i);
    expect(vm.leaderboard[0]?.name).not.toMatch(/Bluesky topic|Bluesky thread/i);
  });

  it("minimizes fallback generated labels when roots contain extractable topic text", async () => {
    const alphaRoot = "at://did:plc:labels/app.bsky.feed.post/labels-alpha";
    const betaRoot = "at://did:plc:labels/app.bsky.feed.post/labels-beta";
    const gammaRoot = "at://did:plc:labels/app.bsky.feed.post/labels-gamma";
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        blueskyPosts: [
          makeBlueskyPost(alphaRoot, "Lake Garda travel photos go viral on Bluesky", 70),
          makeBlueskyPost(betaRoot, "Final investment decision looms for LNG build", 68),
          makeBlueskyPost(gammaRoot, "Jeffrey Epstein files hearing sparks new debate", 66),
        ],
        blueskyInteractions: [
          makeBlueskyInteraction("labels-like-1", alphaRoot, "like", 55),
          makeBlueskyInteraction("labels-like-2", betaRoot, "like", 53),
          makeBlueskyInteraction("labels-like-3", gammaRoot, "like", 51),
        ],
      },
    );

    expect(vm.leaderboard.slice(0, 3).every((row) => row.labelType !== "fallback_generated")).toBe(true);
    expect(vm.leaderboard.slice(0, 3).every((row) => !/^Bluesky (topic|thread)\b/i.test(row.name))).toBe(true);
  });

  it("ranks Bluesky trends by full 24h interaction totals descending", async () => {
    const alphaRoot = "at://did:plc:rank/app.bsky.feed.post/rank-alpha";
    const betaRoot = "at://did:plc:rank/app.bsky.feed.post/rank-beta";
    const gammaRoot = "at://did:plc:rank/app.bsky.feed.post/rank-gamma";
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        error: null,
        posts: [],
        comments: [],
        blueskyPosts: [
          makeBlueskyPost(alphaRoot, "Alpha summit", 80),
          makeBlueskyPost(betaRoot, "Beta product recall", 75),
          makeBlueskyPost(gammaRoot, "Gamma market structure", 70),
        ],
        blueskyInteractions: [
          ...Array.from({ length: 9 }, (_, index) =>
            makeBlueskyInteraction(`alpha-${index + 1}`, alphaRoot, "like", 60 - index),
          ),
          ...Array.from({ length: 5 }, (_, index) =>
            makeBlueskyInteraction(`beta-${index + 1}`, betaRoot, "like", 40 - index),
          ),
          ...Array.from({ length: 2 }, (_, index) =>
            makeBlueskyInteraction(`gamma-${index + 1}`, gammaRoot, "like", 20 - index),
          ),
        ],
      },
    );

    const totals = vm.leaderboard.slice(0, 3).map((row) => row.totalInteractions24h);
    expect(totals).toEqual([9, 5, 2]);
  });

  it("exposes Bluesky coverage and lag debug metadata on the dashboard VM", async () => {
    const rootUri = "at://did:plc:lag/app.bsky.feed.post/lag-root";
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "24h",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        generatedAt: fetchedAt,
        error: null,
        posts: [],
        comments: [],
        blueskyPosts: [makeBlueskyPost(rootUri, "Lag check thread", 40)],
        blueskyInteractions: [
          makeBlueskyInteraction("lag-like-1", rootUri, "like", 30),
          makeBlueskyInteraction("lag-like-2", rootUri, "like", 20),
        ],
        blueskyFirehoseState: {
          backlogLagMinutes: 42,
          rawReplay: [],
        },
      },
    );

    expect(vm.trendCoverage).toMatchObject({
      totalInteractionsInWindow: 2,
      totalInteractionsAssignedToTrends: 2,
      unassignedInteractionsCount: 0,
      groupedRootsCount: 0,
      singletonRootsCount: 1,
      groupedTrendCount: 0,
      singletonTrendCount: 1,
      fallbackLabelCount: 1,
      firehoseLagMinutes: 42,
      totalTrendsReturned: vm.leaderboards.established.length,
    });
  });

  it("keeps the 7d Bluesky overview anchored to the full selected window instead of a 24h raw replay slice", async () => {
    const rootUri = "at://did:plc:seven/app.bsky.feed.post/seven-day-root";
    const vm = await getTrendDashboardVM(
      {
        scope: "overall",
        range: "7d",
        sort: "attention",
      },
      {
        source: "reddit",
        fetchedAt,
        generatedAt: fetchedAt,
        error: null,
        posts: [],
        comments: [],
        blueskyPosts: [
          makeBlueskyPost(rootUri, "Seven day window trend", 60 * 24 * 6),
          makeBlueskyPost(`${rootUri}-followup`, "Seven day window follow-up", 90, {
            rootUri,
            postType: "quote",
          }),
        ],
        blueskyInteractions: [
          makeBlueskyInteraction("seven-like-1", rootUri, "like", 60 * 24 * 5),
          makeBlueskyInteraction("seven-like-2", rootUri, "repost", 60 * 24 * 2),
          makeBlueskyInteraction("seven-like-3", rootUri, "reply", 45, {
            text: "Still active",
          }),
        ],
        blueskyFirehoseState: {
          backlogLagMinutes: 30,
          rawReplay: [
            {
              timestamp: "2026-03-15T10:00:00.000Z",
              value: 4,
            },
            {
              timestamp: "2026-03-16T10:00:00.000Z",
              value: 2,
            },
          ],
        },
      },
    );

    expect(vm.blueskyOverview).toBeTruthy();
    expect(vm.blueskyOverview?.replay).toHaveLength(24);
    expect(Date.parse(vm.blueskyOverview?.replay[0]?.timestamp ?? "")).toBeLessThanOrEqual(
      Date.parse("2026-03-10T10:00:00.000Z"),
    );
  });
});
