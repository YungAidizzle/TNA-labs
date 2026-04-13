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

const linkMocks = vi.hoisted(() => ({
  attachTrendMemecoinLinks: vi.fn(),
}));

vi.mock("@/lib/dashboard/service", () => serviceMocks);
vi.mock("@/lib/dashboard/correlated-memecoins", () => boardMocks);
vi.mock("@/lib/dashboard/trend-memecoin-links", () => linkMocks);

describe("cached dashboard state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decorates the cached summary state with the correlated board and trend links", async () => {
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
    const decoratedState = {
      ...baseState,
      correlatedMemecoins: board,
    };

    serviceMocks.getTrendDashboardState.mockResolvedValueOnce(baseState);
    boardMocks.fetchLatestCorrelatedMemecoinBoard.mockResolvedValueOnce(board);
    linkMocks.attachTrendMemecoinLinks.mockResolvedValueOnce(decoratedState);

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
      },
    );
    expect(boardMocks.fetchLatestCorrelatedMemecoinBoard).toHaveBeenCalledTimes(1);
    expect(linkMocks.attachTrendMemecoinLinks).toHaveBeenCalledWith(
      {
        ...baseState,
        correlatedMemecoins: board,
      },
      board,
    );
    expect(result).toEqual(decoratedState);
  });
});
