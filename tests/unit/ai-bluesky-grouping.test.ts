import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        startedAt: "2026-03-23T10:00:00.000Z",
        completedAt: "2026-03-23T10:00:00.000Z",
        lastSuccessfulFullRegroupAt: null,
      },
    };
  },
}));

import { getTrendDashboardVM } from "@/lib/adapters/analytics";
import {
  BlueskyInteraction,
  BlueskyNormalizedPost,
  RedditIngestionSnapshot,
} from "@/lib/reddit/types";

const fetchedAt = "2026-03-23T10:00:00.000Z";
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalGroupingEnabled = process.env.OPENAI_TREND_GROUPING_ENABLED;
const originalMergeEnabled = process.env.OPENAI_TREND_MERGE_ENABLED;

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

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_TREND_GROUPING_ENABLED = "true";
  process.env.OPENAI_TREND_MERGE_ENABLED = "false";
  interpretBlueskyRootsMock.mockReset();
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

  if (originalMergeEnabled === undefined) {
    delete process.env.OPENAI_TREND_MERGE_ENABLED;
  } else {
    process.env.OPENAI_TREND_MERGE_ENABLED = originalMergeEnabled;
  }
});

function makeSnapshot(
  posts: BlueskyNormalizedPost[],
  interactions: BlueskyInteraction[],
): RedditIngestionSnapshot {
  return {
    source: "reddit",
    fetchedAt,
    error: null,
    posts: [],
    comments: [],
    blueskyPosts: posts,
    blueskyInteractions: interactions,
  };
}

describe("AI-assisted Bluesky grouping", () => {
  it("keeps full coverage while grouping same-topic wording variants into one trend", async () => {
    const alphaRoot = "at://did:plc:save/app.bsky.feed.post/save-alpha";
    const betaRoot = "at://did:plc:save/app.bsky.feed.post/save-beta";

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
      { scope: "overall", range: "24h", sort: "attention" },
      makeSnapshot(
        [
          makeBlueskyPost(alphaRoot, "President Trump pushes SAVE Act vote this week", 90),
          makeBlueskyPost(betaRoot, "SAVE Act vote gains steam after Trump backing", 80),
        ],
        [
          makeBlueskyInteraction("save-like-1", alphaRoot, "like", 70),
          makeBlueskyInteraction("save-like-2", alphaRoot, "repost", 68),
          makeBlueskyInteraction("save-like-3", betaRoot, "like", 66),
          makeBlueskyInteraction("save-like-4", betaRoot, "reply", 64, {
            text: "SAVE Act is the real story",
          }),
        ],
      ),
    );

    expect(vm.trendCoverage).toMatchObject({
      totalInteractionsInWindow: 4,
      totalInteractionsAssignedToTrends: 4,
      unassignedInteractionsCount: 0,
      aiLabeledCount: 1,
    });
    expect(vm.leaderboard[0]?.name).toMatch(/save act vote/i);
    expect(vm.leaderboard[0]?.labelType).toBe("ai_generated");
    expect(vm.leaderboard[0]?.rootsCount24h).toBe(2);
    expect(vm.leaderboard[0]?.totalInteractions24h).toBe(4);
  });

  it("clusters semantically related roots even when the AI path is unavailable", async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalGroupingEnabled = process.env.OPENAI_TREND_GROUPING_ENABLED;
    process.env.OPENAI_API_KEY = "";
    process.env.OPENAI_TREND_GROUPING_ENABLED = "false";

    try {
      const alphaRoot = "at://did:plc:atlas/app.bsky.feed.post/atlas-alpha";
      const betaRoot = "at://did:plc:atlas/app.bsky.feed.post/atlas-beta";

      const vm = await getTrendDashboardVM(
        { scope: "overall", range: "24h", sort: "attention" },
        makeSnapshot(
          [
          makeBlueskyPost(
            alphaRoot,
            "Atlas chip export controls today https://example.com/a",
            90,
          ),
          makeBlueskyPost(
            betaRoot,
            "Atlas chip export controls now https://example.com/b",
            80,
          ),
          ],
          [
            makeBlueskyInteraction("atlas-like-1", alphaRoot, "like", 70),
            makeBlueskyInteraction("atlas-reply-1", betaRoot, "reply", 66, {
              text: "Atlas chip rules keep changing",
            }),
          ],
        ),
      );

      expect(interpretBlueskyRootsMock).not.toHaveBeenCalled();
      expect(vm.trendCoverage?.aiAttempted).toBe(false);
      expect(vm.trendCoverage?.groupedRootsCount).toBe(2);
      expect(vm.trendCoverage?.singletonRootsCount).toBe(0);
      expect(vm.leaderboard[0]?.rootsCount24h).toBe(2);
      expect(vm.leaderboard[0]?.groupingSource).toBe("ai_semantic_cluster");
      expect(vm.leaderboard[0]?.name).toMatch(/atlas chip/i);
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
      if (originalGroupingEnabled === undefined) {
        delete process.env.OPENAI_TREND_GROUPING_ENABLED;
      } else {
        process.env.OPENAI_TREND_GROUPING_ENABLED = originalGroupingEnabled;
      }
    }
  });

  it("keeps grouped narratives above singleton URL anchors on the leaderboard", async () => {
    const groupedAlpha = "at://did:plc:atlas/app.bsky.feed.post/atlas-alpha";
    const groupedBeta = "at://did:plc:atlas/app.bsky.feed.post/atlas-beta";
    const singletonUrlRoot = "at://did:plc:link/app.bsky.feed.post/link-1";

    interpretBlueskyRootsMock.mockResolvedValue(
      new Map([
        [
          groupedAlpha,
          {
            rootId: groupedAlpha,
            summaryTopic: "Atlas chip export controls",
            candidateLabel: "Atlas chip export controls",
            shortDescription: "Export controls chatter about Atlas chips",
            entities: ["Atlas"],
            canonicalKeywords: ["atlas", "chips", "export"],
            contentType: "news",
            trendCategory: "technology",
            language: "en",
            isTemplateLike: false,
            isLowInformation: false,
            spamLikelihood: 0.01,
            templateLikelihood: 0.01,
            contextualCoherence: 0.94,
            semanticKey: "atlas chip export controls",
            secondaryKeys: ["atlas ai chips"],
          },
        ],
        [
          groupedBeta,
          {
            rootId: groupedBeta,
            summaryTopic: "Atlas chip export controls",
            candidateLabel: "Atlas chip export controls",
            shortDescription: "Export controls chatter about Atlas chips",
            entities: ["Atlas"],
            canonicalKeywords: ["atlas", "chips", "export"],
            contentType: "news",
            trendCategory: "technology",
            language: "en",
            isTemplateLike: false,
            isLowInformation: false,
            spamLikelihood: 0.01,
            templateLikelihood: 0.01,
            contextualCoherence: 0.94,
            semanticKey: "atlas chip export controls",
            secondaryKeys: ["atlas ai chips"],
          },
        ],
      ]),
    );

    const vm = await getTrendDashboardVM(
      { scope: "overall", range: "24h", sort: "attention" },
      makeSnapshot(
        [
          makeBlueskyPost(groupedAlpha, "Atlas chip export controls hit AI labs", 90),
          makeBlueskyPost(groupedBeta, "Atlas chip export controls reach cloud builders", 88),
          makeBlueskyPost(
            singletonUrlRoot,
            "Fresh article: Atlas chip export controls shake suppliers https://example.com/atlas",
            80,
          ),
        ],
        [
          makeBlueskyInteraction("atlas-like-1", groupedAlpha, "like", 70),
          makeBlueskyInteraction("atlas-repost-1", groupedAlpha, "repost", 68),
          makeBlueskyInteraction("atlas-reply-1", groupedBeta, "reply", 66),
          makeBlueskyInteraction("atlas-url-like-1", singletonUrlRoot, "like", 64),
          makeBlueskyInteraction("atlas-url-like-2", singletonUrlRoot, "like", 63),
          makeBlueskyInteraction("atlas-url-like-3", singletonUrlRoot, "repost", 62),
        ],
      ),
    );

    expect(vm.leaderboard[0]?.rootsCount24h).toBe(2);
    expect(vm.leaderboard[0]?.groupingSource).toBe("ai_semantic_cluster");
    const singletonRow = vm.leaderboard.find((trend) => trend.rootsCount24h === 1);
    expect(singletonRow?.rank ?? 0).toBeGreaterThan(1);
    expect(vm.trendCoverage?.displayedSingletonRowsCount ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("does not false-merge superficially similar posts when AI says the topics differ", async () => {
    const alphaRoot = "at://did:plc:nyc/app.bsky.feed.post/nyc-alpha";
    const betaRoot = "at://did:plc:york/app.bsky.feed.post/york-beta";

    interpretBlueskyRootsMock.mockResolvedValue(
      new Map([
        [
          alphaRoot,
          {
            rootId: alphaRoot,
            summaryTopic: "New York City mayor race",
            candidateLabel: "NYC mayor race",
            shortDescription: "Discussion of New York City mayor politics",
            entities: ["New York City", "Mayor"],
            canonicalKeywords: ["nyc", "mayor race"],
            contentType: "news",
            trendCategory: "politics",
            language: "en",
            isTemplateLike: false,
            isLowInformation: false,
            spamLikelihood: 0.03,
            templateLikelihood: 0.01,
            contextualCoherence: 0.88,
            semanticKey: "nyc mayor race",
            secondaryKeys: ["new york city mayor"],
          },
        ],
        [
          betaRoot,
          {
            rootId: betaRoot,
            summaryTopic: "York City football match",
            candidateLabel: "York City FC",
            shortDescription: "York City football chatter",
            entities: ["York City FC"],
            canonicalKeywords: ["york city", "football"],
            contentType: "news",
            trendCategory: "sports",
            language: "en",
            isTemplateLike: false,
            isLowInformation: false,
            spamLikelihood: 0.02,
            templateLikelihood: 0.01,
            contextualCoherence: 0.86,
            semanticKey: "york city fc",
            secondaryKeys: ["york football"],
          },
        ],
      ]),
    );

    const vm = await getTrendDashboardVM(
      { scope: "overall", range: "24h", sort: "attention" },
      makeSnapshot(
        [
          makeBlueskyPost(alphaRoot, "York City is a disaster says NYC mayor rival", 100),
          makeBlueskyPost(betaRoot, "York City take all three points tonight", 90),
        ],
        [
          makeBlueskyInteraction("nyc-1", alphaRoot, "like", 70),
          makeBlueskyInteraction("nyc-2", alphaRoot, "reply", 69),
          makeBlueskyInteraction("york-1", betaRoot, "like", 68),
        ],
      ),
    );

    expect(vm.leaderboard[0]?.name).toMatch(/nyc mayor race/i);
    expect(vm.leaderboard[1]?.name).toMatch(/york city fc/i);
    expect(vm.leaderboard.slice(0, 2).every((row) => row.rootsCount24h === 1)).toBe(true);
  });

  it("classifies repetitive single-author phrase farms as a template series", async () => {
    const roots = [
      "at://did:plc:spam/app.bsky.feed.post/spam-1",
      "at://did:plc:spam/app.bsky.feed.post/spam-2",
      "at://did:plc:spam/app.bsky.feed.post/spam-3",
    ];

    interpretBlueskyRootsMock.mockResolvedValue(
      new Map(
        roots.map((rootId) => [
          rootId,
          {
            rootId,
            summaryTopic: "daily donation reminder",
            candidateLabel: "Donation reminder",
            shortDescription: "Repeated promotional donation asks from one account",
            entities: [],
            canonicalKeywords: ["donation", "reminder"],
            contentType: "promotion",
            trendCategory: "spam_promo",
            language: "en",
            isTemplateLike: true,
            isLowInformation: false,
            spamLikelihood: 0.88,
            templateLikelihood: 0.94,
            contextualCoherence: 0.62,
            semanticKey: "donation reminder",
            secondaryKeys: ["daily donation ask"],
          },
        ]),
      ),
    );

    const vm = await getTrendDashboardVM(
      { scope: "overall", range: "24h", sort: "attention" },
      makeSnapshot(
        roots.map((rootId, index) =>
          makeBlueskyPost(rootId, `D0nation save day ${index + 1}`, 120 - index * 5, {
            authorDid: "did:plc:spam-author",
            authorHandle: "spam-author.bsky.social",
          }),
        ),
        roots.flatMap((rootId, index) => [
          makeBlueskyInteraction(`spam-like-${index}-1`, rootId, "like", 80 - index),
          makeBlueskyInteraction(`spam-like-${index}-2`, rootId, "repost", 78 - index),
        ]),
      ),
    );

    expect(vm.leaderboard[0]?.templateSeries).toBe(true);
    expect(vm.leaderboard[0]?.trendCategory).toBe("spam_promo");
    expect(vm.leaderboard[0]?.name).toMatch(/Promotional template series|Donation reminder/i);
    expect(vm.trendCoverage?.templateSeriesCount).toBeGreaterThanOrEqual(1);
  });

  it("classifies generic greeting chatter as low-information instead of a strong narrative", async () => {
    const rootUri = "at://did:plc:greeting/app.bsky.feed.post/greeting-root";

    interpretBlueskyRootsMock.mockResolvedValue(
      new Map([
        [
          rootUri,
          {
            rootId: rootUri,
            summaryTopic: "morning greeting",
            candidateLabel: "Morning greeting",
            shortDescription: "Generic greeting/status post",
            entities: [],
            canonicalKeywords: ["good morning"],
            contentType: "greeting_status",
            trendCategory: "greeting_status",
            language: "de",
            isTemplateLike: false,
            isLowInformation: true,
            spamLikelihood: 0.12,
            templateLikelihood: 0.22,
            contextualCoherence: 0.41,
            semanticKey: "morning greeting",
            secondaryKeys: ["guten morgen"],
          },
        ],
      ]),
    );

    const vm = await getTrendDashboardVM(
      { scope: "overall", range: "24h", sort: "attention" },
      makeSnapshot(
        [makeBlueskyPost(rootUri, "Guten Morgen everyone", 60)],
        [makeBlueskyInteraction("gm-like-1", rootUri, "like", 55)],
      ),
    );

    expect(vm.leaderboard[0]?.name).toMatch(/morning greeting/i);
    expect(vm.leaderboard[0]?.lowInformation).toBe(true);
    expect(vm.leaderboard[0]?.trendCategory).toBe("greeting_status");
    expect(vm.trendCoverage?.lowInformationTrendCount).toBeGreaterThanOrEqual(1);
  });

  it("uses AI labels to clean up current junk-fragment failure cases", async () => {
    const roots = [
      "at://did:plc:bad/app.bsky.feed.post/bad-1",
      "at://did:plc:bad/app.bsky.feed.post/bad-2",
      "at://did:plc:bad/app.bsky.feed.post/bad-3",
    ];

    interpretBlueskyRootsMock.mockResolvedValue(
      new Map([
        [
          roots[0],
          {
            rootId: roots[0],
            summaryTopic: "bank withdrawal rumor",
            candidateLabel: "Bank withdrawal rumor",
            shortDescription: "Rumor about cash withdrawals spreading online",
            entities: ["Bank"],
            canonicalKeywords: ["withdrawal rumor"],
            contentType: "news",
            trendCategory: "business",
            language: "en",
            isTemplateLike: false,
            isLowInformation: false,
            spamLikelihood: 0.05,
            templateLikelihood: 0.03,
            contextualCoherence: 0.82,
            semanticKey: "bank withdrawal rumor",
            secondaryKeys: ["cash withdrawal rumor"],
          },
        ],
        [
          roots[1],
          {
            rootId: roots[1],
            summaryTopic: "urban drug crisis meme",
            candidateLabel: "Urban drug crisis meme",
            shortDescription: "Dark-humor meme around urban drug crisis discourse",
            entities: [],
            canonicalKeywords: ["drug crisis meme"],
            contentType: "meme",
            trendCategory: "culture",
            language: "en",
            isTemplateLike: false,
            isLowInformation: false,
            spamLikelihood: 0.08,
            templateLikelihood: 0.04,
            contextualCoherence: 0.78,
            semanticKey: "urban drug crisis meme",
            secondaryKeys: ["crack haven meme"],
          },
        ],
        [
          roots[2],
          {
            rootId: roots[2],
            summaryTopic: "charity appeal template series",
            candidateLabel: "Charity appeal series",
            shortDescription: "Repeated template-style charity asks from one account",
            entities: [],
            canonicalKeywords: ["charity appeal"],
            contentType: "promotion",
            trendCategory: "spam_promo",
            language: "en",
            isTemplateLike: true,
            isLowInformation: false,
            spamLikelihood: 0.82,
            templateLikelihood: 0.9,
            contextualCoherence: 0.64,
            semanticKey: "charity appeal",
            secondaryKeys: ["donation save"],
          },
        ],
      ]),
    );

    const vm = await getTrendDashboardVM(
      { scope: "overall", range: "24h", sort: "attention" },
      makeSnapshot(
        [
          makeBlueskyPost(roots[0], "Guess Withdraw", 80),
          makeBlueskyPost(roots[1], "Crack Haven", 75),
          makeBlueskyPost(roots[2], "D0nation Save", 70, {
            authorDid: "did:plc:charity",
            authorHandle: "charity.bsky.social",
          }),
        ],
        [
          makeBlueskyInteraction("bad-1-like", roots[0], "like", 60),
          makeBlueskyInteraction("bad-2-like", roots[1], "like", 58),
          makeBlueskyInteraction("bad-3-like", roots[2], "like", 56),
        ],
      ),
    );

    expect(vm.leaderboard[0]?.name).toMatch(/bank withdrawal rumor/i);
    expect(vm.leaderboard[1]?.name).toMatch(/urban drug crisis meme/i);
    expect(vm.leaderboard[2]?.name).toMatch(/promotional template series|charity appeal series/i);
    expect(vm.leaderboard.slice(0, 3).every((row) => row.labelType === "ai_generated")).toBe(true);
    expect(vm.leaderboard.slice(0, 3).every((row) => !/^Bluesky /i.test(row.name))).toBe(true);
  });
});
