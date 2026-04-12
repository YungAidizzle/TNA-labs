import { afterEach, beforeEach, vi } from "vitest";

const resolveNarrativeClustersMock = vi.fn();

vi.mock("@/lib/narratives/ai-clustering", () => ({
  resolveNarrativeClusters: resolveNarrativeClustersMock,
}));

import { getTrendDashboardVM } from "@/lib/adapters/analytics";
import {
  PublicSourceItem,
  RedditIngestionSnapshot,
  RedditNormalizedComment,
  RedditNormalizedPost,
} from "@/lib/reddit/types";

const fetchedAt = "2026-03-16T10:00:00.000Z";
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalTrendMergeEnabled = process.env.OPENAI_TREND_MERGE_ENABLED;

type MockNarrativeCandidate = {
  id: string;
  sampleTitles: string[];
  documents: Array<{
    id: string;
    title: string;
  }>;
};

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
): PublicSourceItem {
  return {
    id,
    source: "news",
    sourceType: "rss",
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
    fetchedAt,
  };
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_TREND_MERGE_ENABLED = "true";
  resolveNarrativeClustersMock.mockReset();
});

afterEach(() => {
  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }

  if (originalTrendMergeEnabled === undefined) {
    delete process.env.OPENAI_TREND_MERGE_ENABLED;
  } else {
    process.env.OPENAI_TREND_MERGE_ENABLED = originalTrendMergeEnabled;
  }
});

describe("AI narrative resolution", () => {
  it("keeps heuristic trend building active when the AI merge flag is disabled", async () => {
    process.env.OPENAI_TREND_MERGE_ENABLED = "false";

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
            "atlas-1",
            "technology",
            "Atlas chip export controls hit AI labs",
            2,
            320,
            24,
          ),
          makePost(
            "atlas-2",
            "artificial",
            "Atlas chip restrictions reach more cloud builders",
            4,
            270,
            18,
          ),
        ],
        comments: [
          makeComment("c1", "atlas-1", "technology", 12, 8),
          makeComment("c2", "atlas-2", "artificial", 33, 5),
        ],
        publicItems: [
          makePublicItem(
            "atlas-news-1",
            "BBC World",
            "New export rules tighten on Atlas AI chips",
            "Governments tighten export controls around Atlas AI chips and related compute.",
            6,
            85,
            22,
          ),
          makePublicItem(
            "atlas-news-2",
            "NPR",
            "Atlas chip rule expands to more suppliers",
            "Suppliers adjust roadmaps after new Atlas chip rule changes.",
            8,
            74,
            19,
          ),
        ],
      },
    );

    expect(resolveNarrativeClustersMock).not.toHaveBeenCalled();
    expect(vm.leaderboard.some((trend) => /atlas/i.test(trend.name))).toBe(true);
  });

  it("uses AI document assignment to unify wording variants across sources", async () => {
    resolveNarrativeClustersMock.mockImplementation(async (candidates: MockNarrativeCandidate[]) => {
      const atlasCandidates = candidates.filter((candidate) =>
        candidate.sampleTitles.some((title: string) => /atlas/i.test(title)),
      );
      const memeCandidates = candidates.filter((candidate) =>
        candidate.sampleTitles.some((title: string) => /banana cat/i.test(title)),
      );

      return {
        narratives: [
          {
            id: "atlas-chip-export-controls",
            label: "Atlas chip export controls",
            summary: "Export restrictions and developer reaction around Atlas AI chips.",
            aliases: ["Atlas chip restrictions", "Atlas export rules"],
            candidateIds: atlasCandidates.map((candidate) => candidate.id),
            documentIds: atlasCandidates.flatMap((candidate) =>
              candidate.documents.map((document) => document.id),
            ),
          },
          {
            id: "banana-cat-meme",
            label: "Banana Cat meme",
            summary: "A Banana Cat meme remix cycle spreading across culture channels.",
            aliases: ["Banana Cat remix"],
            candidateIds: memeCandidates.map((candidate) => candidate.id),
            documentIds: memeCandidates.flatMap((candidate) =>
              candidate.documents.map((document) => document.id),
            ),
          },
        ],
        ignoredCandidateIds: [],
      };
    });

    const snapshot: RedditIngestionSnapshot = {
      source: "reddit",
      fetchedAt,
      error: null,
      posts: [
        makePost(
          "atlas-1",
          "technology",
          "Atlas chip export controls hit AI labs",
          2,
          320,
          24,
        ),
        makePost(
          "atlas-2",
          "artificial",
          "Developers react to Atlas chip restrictions",
          4,
          270,
          18,
        ),
        makePost(
          "banana-1",
          "memes",
          "Banana Cat meme spreads across every feed",
          3,
          210,
          15,
        ),
        makePost(
          "banana-2",
          "gaming",
          "Banana Cat remix takes over Discord servers",
          5,
          160,
          11,
        ),
      ],
      comments: [
        makeComment("c1", "atlas-1", "technology", 12, 8),
        makeComment("c2", "atlas-1", "technology", 19, 6),
        makeComment("c3", "atlas-2", "artificial", 44, 5),
        makeComment("c4", "banana-1", "memes", 18, 7),
        makeComment("c5", "banana-2", "gaming", 33, 4),
      ],
      publicItems: [
        makePublicItem(
          "atlas-news-1",
          "BBC World",
          "New export rules tighten on Atlas AI chips",
          "Governments tighten export controls around Atlas AI chips and related compute.",
          6,
          85,
          22,
        ),
        makePublicItem(
          "atlas-news-2",
          "NPR",
          "Startups brace for Atlas chip rule",
          "Startups adjust roadmaps after new Atlas chip rule changes.",
          8,
          74,
          19,
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

    expect(resolveNarrativeClustersMock).toHaveBeenCalledTimes(1);
    expect(resolveNarrativeClustersMock.mock.calls[0]?.[0]?.[0]?.documents).toBeDefined();

    const atlasTrend = vm.leaderboard.find((trend) =>
      /atlas chip export controls|atlas chip restrictions|atlas chip/i.test(trend.name),
    );
    expect(atlasTrend).toBeDefined();
    expect(atlasTrend?.platforms).toEqual(expect.arrayContaining(["reddit", "news"]));
    expect(atlasTrend?.supportingThreadCount).toBe(4);
  });

  it("suppresses fragment-like candidate groups when AI marks them as noise", async () => {
    resolveNarrativeClustersMock.mockImplementation(async (candidates: MockNarrativeCandidate[]) => {
      const orionCandidates = candidates.filter((candidate) =>
        candidate.documents.some((document) => /orion/i.test(document.title)),
      );
      const ignoredCandidateIds = candidates
        .filter((candidate) =>
          candidate.documents.every((document) => !/orion/i.test(document.title)),
        )
        .map((candidate) => candidate.id);

      return {
        narratives: [
          {
            id: "orion-merger-talks",
            label: "Orion merger talks",
            summary: "Coverage around the Orion merger negotiations.",
            aliases: ["Orion deal talks"],
            candidateIds: orionCandidates.map((candidate) => candidate.id),
            documentIds: orionCandidates.flatMap((candidate) =>
              candidate.documents
                .filter((document) => /orion/i.test(document.title))
                .map((document) => document.id),
            ),
          },
        ],
        ignoredCandidateIds,
      };
    });

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
            "orion-1",
            "BBC World",
            "Orion merger talks intensify",
            "Merger negotiations around Orion intensified overnight.",
            3,
            64,
            14,
          ),
          makePublicItem(
            "orion-2",
            "Reuters",
            "Orion merger talks enter final round",
            "The Orion merger talks moved into a final negotiation round.",
            6,
            57,
            11,
          ),
          makePublicItem(
            "noise-1",
            "NPR",
            "Can you explain what is going on today",
            "A generic explainer headline without a concrete topic label.",
            2,
            22,
            5,
          ),
          makePublicItem(
            "noise-2",
            "TechCrunch",
            "Can you explain what is going on right now",
            "Another low-quality fragment-like headline with the same filler phrasing.",
            5,
            18,
            4,
          ),
        ],
      },
    );

    expect(vm.leaderboard).toHaveLength(1);
    expect(vm.leaderboard[0]?.name).toMatch(/orion (merger|deal) talks/i);
    expect(vm.leaderboard.some((trend) => /can you explain|what is going on/i.test(trend.name))).toBe(
      false,
    );
  });

  it("rejects fragmentary AI labels and falls back to a stronger narrative name", async () => {
    resolveNarrativeClustersMock.mockImplementation(async (candidates: MockNarrativeCandidate[]) => {
      const atlasCandidates = candidates.filter((candidate) =>
        candidate.documents.some((document) => /atlas/i.test(document.title)),
      );

      return {
        narratives: [
          {
            id: "atlas-fragment-label",
            label: "Last year",
            summary: "A bad fragment label that should not survive the local quality gate.",
            aliases: ["Atlas chip export controls", "Atlas chip restrictions"],
            candidateIds: atlasCandidates.map((candidate) => candidate.id),
            documentIds: atlasCandidates.flatMap((candidate) =>
              candidate.documents.map((document) => document.id),
            ),
          },
        ],
        ignoredCandidateIds: [],
      };
    });

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
            "atlas-1",
            "technology",
            "Atlas chip export controls hit AI labs",
            2,
            320,
            24,
          ),
          makePost(
            "atlas-2",
            "artificial",
            "Atlas chip restrictions reach more cloud builders",
            4,
            270,
            18,
          ),
        ],
        comments: [
          makeComment("c1", "atlas-1", "technology", 12, 8),
          makeComment("c2", "atlas-2", "artificial", 33, 5),
        ],
        publicItems: [
          makePublicItem(
            "atlas-news-1",
            "BBC World",
            "New export rules tighten on Atlas AI chips",
            "Governments tighten export controls around Atlas AI chips and related compute.",
            6,
            85,
            22,
          ),
          makePublicItem(
            "atlas-news-2",
            "NPR",
            "Atlas chip rule expands to more suppliers",
            "Suppliers adjust roadmaps after new Atlas chip rule changes.",
            8,
            74,
            19,
          ),
        ],
      },
    );

    expect(vm.leaderboard.some((trend) => /^last year$/i.test(trend.name))).toBe(false);
    expect(vm.leaderboard.some((trend) => /atlas/i.test(trend.name))).toBe(true);
  });
});
