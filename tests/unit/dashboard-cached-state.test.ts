import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>) => fn,
}));

const serviceMocks = vi.hoisted(() => ({
  getTrendDashboardState: vi.fn(),
}));

const boardMocks = vi.hoisted(() => ({
  fetchLatestCorrelatedMemecoinBoard: vi.fn(),
}));

const matcherMocks = vi.hoisted(() => ({
  buildStrictTrendsPageCorrelatedBoard: vi.fn(),
}));

vi.mock("@/lib/dashboard/service", () => serviceMocks);
vi.mock("@/lib/dashboard/correlated-memecoins", () => boardMocks);
vi.mock("@/lib/dashboard/trends-page-memecoin-matcher", () => matcherMocks);

describe("cached dashboard state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the cached summary state without memecoin decoration", async () => {
    const baseState = {
      query: {
        scope: "overall",
        range: "24h",
        sort: "posts",
        mode: "established",
      },
      ingestionHealth: null,
      dataStatus: null,
      correlatedMemecoins: null,
      leaderboards: {
        established: [],
        emerging: [],
      },
      leaderboard: [],
      overviewSeries: [],
      detail: null,
    };

    serviceMocks.getTrendDashboardState.mockResolvedValueOnce(baseState);

    const { getSharedTrendDashboardSummaryState } = await import("@/lib/dashboard/cached-state");
    const result = await getSharedTrendDashboardSummaryState({
      scope: "overall",
      range: "24h",
      sort: "posts",
      mode: "established",
    });

    expect(serviceMocks.getTrendDashboardState).toHaveBeenCalledWith(
      {
        scope: "overall",
        range: "24h",
        sort: "posts",
        mode: "established",
      },
      {
        readProfile: "summary",
        includeFreshnessProbe: false,
      },
    );
    expect(boardMocks.fetchLatestCorrelatedMemecoinBoard).not.toHaveBeenCalled();
    expect(matcherMocks.buildStrictTrendsPageCorrelatedBoard).not.toHaveBeenCalled();
    expect(result).toEqual(baseState);
  });

  it("builds the cached memecoin state from the cached base state and live market board", async () => {
    const baseState = {
      query: {
        scope: "overall",
        range: "24h",
        sort: "posts",
        mode: "established",
      },
      ingestionHealth: null,
      dataStatus: null,
      correlatedMemecoins: null,
      leaderboards: {
        established: [],
        emerging: [],
      },
      leaderboard: [],
      overviewSeries: [],
      detail: null,
    };
    const board = {
      runId: 88,
      updatedAt: "2026-04-13T12:00:00.000Z",
      rows: [],
      diagnostics: null,
    };
    const strictBoard = {
      ...board,
      rows: [],
    };

    serviceMocks.getTrendDashboardState.mockResolvedValueOnce(baseState);
    boardMocks.fetchLatestCorrelatedMemecoinBoard.mockResolvedValueOnce(board);
    matcherMocks.buildStrictTrendsPageCorrelatedBoard.mockReturnValueOnce(strictBoard);

    const { getSharedTrendDashboardMemecoinState } = await import("@/lib/dashboard/cached-state");
    const result = await getSharedTrendDashboardMemecoinState({
      scope: "overall",
      range: "24h",
      sort: "posts",
      mode: "established",
    });

    expect(serviceMocks.getTrendDashboardState).toHaveBeenCalledWith(
      {
        scope: "overall",
        range: "24h",
        sort: "posts",
        mode: "established",
      },
      {
        readProfile: "summary",
        includeFreshnessProbe: false,
      },
    );
    expect(boardMocks.fetchLatestCorrelatedMemecoinBoard).toHaveBeenCalledWith();
    expect(matcherMocks.buildStrictTrendsPageCorrelatedBoard).toHaveBeenCalledWith(
      baseState,
      board,
    );
    expect(result).toEqual({
      ...baseState,
      marketMemecoins: board,
      correlatedMemecoins: strictBoard,
    });
  });
});
