import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  getLatestSuccessfulAiTrendSnapshotView: vi.fn(),
}));

vi.mock("@/lib/ai-trends/repository", () => repositoryMocks);

describe("shared AI trend source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back when the stored AI snapshot is dominated by offline news filler", async () => {
    repositoryMocks.getLatestSuccessfulAiTrendSnapshotView.mockResolvedValueOnce({
      snapshot: {
        id: 42,
        status: "succeeded",
        createdAt: "2026-04-15T10:00:00.000Z",
        generatedAt: "2026-04-15T10:00:00.000Z",
        completedAt: "2026-04-15T10:00:00.000Z",
        trendCount: 2,
        modelName: "gpt-test",
        promptVersion: "test",
        errorMessage: null,
      },
      freshnessMinutes: 5,
      trends: [
        {
          id: 1,
          snapshotId: 42,
          rank: 1,
          trendKey: "global-escalation",
          title: "Global Escalation",
          summary: "Governments react to geopolitical escalation and tariff policy updates.",
          confidenceScore: 82,
          aiRankScore: 84,
          importanceNote: "Breaking policy and geopolitical coverage keeps leading bulletin cycles.",
          category: "World",
          sourceScope: "global",
          sourceCount: 40,
          generatedAt: "2026-04-15T10:00:00.000Z",
        },
        {
          id: 2,
          snapshotId: 42,
          rank: 2,
          trendKey: "macro-watch",
          title: "Macro Watch",
          summary: "Investors focus on inflation, central bank policy, and rate-cut expectations.",
          confidenceScore: 80,
          aiRankScore: 80,
          importanceNote: "Markets keep watching macro commentary and central bank policy.",
          category: "Finance",
          sourceScope: "global",
          sourceCount: 36,
          generatedAt: "2026-04-15T10:00:00.000Z",
        },
      ],
    });

    const { createZeroTrendDashboardVM } = await import("@/lib/dashboard/zero-state");
    const { getSharedAiTrendDashboardState } = await import("@/lib/dashboard/ai-trend-source");

    const baseState = createZeroTrendDashboardVM({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "posts",
    });

    const result = await getSharedAiTrendDashboardState(baseState.query, baseState);

    expect(result).toBeNull();
  });

  it("keeps internet-native snapshots active after read-time reranking", async () => {
    repositoryMocks.getLatestSuccessfulAiTrendSnapshotView.mockResolvedValueOnce({
      snapshot: {
        id: 43,
        status: "succeeded",
        createdAt: "2026-04-15T10:00:00.000Z",
        generatedAt: "2026-04-15T10:00:00.000Z",
        completedAt: "2026-04-15T10:00:00.000Z",
        trendCount: 2,
        modelName: "gpt-test",
        promptVersion: "test",
        errorMessage: null,
      },
      freshnessMinutes: 5,
      trends: [
        {
          id: 1,
          snapshotId: 43,
          rank: 1,
          trendKey: "clip-remix-cycle",
          title: "Clip Remix Cycle",
          summary: "A creator clip is getting remixed across TikTok, Reddit, X, and YouTube.",
          confidenceScore: 86,
          aiRankScore: 82,
          importanceNote: "The same clip keeps reappearing in meme edits and repost chains.",
          category: "Internet",
          sourceScope: "global",
          sourceCount: 52,
          generatedAt: "2026-04-15T10:00:00.000Z",
        },
        {
          id: 2,
          snapshotId: 43,
          rank: 2,
          trendKey: "solana-memecoin-rotation",
          title: "Solana Memecoin Rotation",
          summary: "Onchain traders keep pushing a memecoin rotation narrative across crypto feeds.",
          confidenceScore: 88,
          aiRankScore: 84,
          importanceNote: "Crypto-native accounts keep repeating the same memecoin flow today.",
          category: "Crypto",
          sourceScope: "niche",
          sourceCount: 40,
          generatedAt: "2026-04-15T10:00:00.000Z",
        },
      ],
    });

    const { createZeroTrendDashboardVM } = await import("@/lib/dashboard/zero-state");
    const { getSharedAiTrendDashboardState } = await import("@/lib/dashboard/ai-trend-source");

    const baseState = createZeroTrendDashboardVM({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "posts",
    });

    const result = await getSharedAiTrendDashboardState(baseState.query, baseState);

    expect(result).not.toBeNull();
    expect(result?.leaderboard.map((row) => row.name)).toEqual([
      "Clip Remix Cycle",
      "Solana Memecoin Rotation",
    ]);
  });

  it("rejects stale shared AI snapshots before they can override the live board", async () => {
    repositoryMocks.getLatestSuccessfulAiTrendSnapshotView.mockResolvedValueOnce({
      snapshot: {
        id: 44,
        status: "succeeded",
        createdAt: "2026-04-13T10:00:00.000Z",
        generatedAt: "2026-04-13T10:00:00.000Z",
        completedAt: "2026-04-13T10:00:00.000Z",
        trendCount: 1,
        modelName: "gpt-test",
        promptVersion: "test",
        errorMessage: null,
      },
      freshnessMinutes: 24 * 60,
      trends: [
        {
          id: 1,
          snapshotId: 44,
          rank: 1,
          trendKey: "stale-story",
          title: "Stale Story",
          summary: "A once-hot narrative that no longer reflects the live board.",
          confidenceScore: 82,
          aiRankScore: 80,
          importanceNote: "This should not replace the live board after a day-old delay.",
          category: "Internet",
          sourceScope: "global",
          sourceCount: 24,
          generatedAt: "2026-04-13T10:00:00.000Z",
        },
      ],
    });

    const { createZeroTrendDashboardVM } = await import("@/lib/dashboard/zero-state");
    const { getSharedAiTrendDashboardState } = await import("@/lib/dashboard/ai-trend-source");

    const baseState = createZeroTrendDashboardVM({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "posts",
    });

    const result = await getSharedAiTrendDashboardState(baseState.query, baseState);

    expect(result).toBeNull();
  });
});
