import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BlueskyLiveStatusBadge } from "@/components/trends/bluesky-live-status-badge";

describe("BlueskyLiveStatusBadge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:30.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders delayed status with exact timestamp tooltip", () => {
    const markup = renderToStaticMarkup(
      createElement(BlueskyLiveStatusBadge, {
        lastReceivedAt: null,
        lastAggregateRefreshAt: "2026-03-25T11:59:20.000Z",
        detailLatestPointAt: null,
        detailStaleGapMinutes: null,
        workerAlive: true,
        latestRunStatus: "success",
      }),
    );

    expect(markup).toContain("Delayed 1m");
    expect(markup).toContain("2026-03-25T11:59:20.000Z");
    expect(markup).toContain('data-status="delayed"');
  });

  it("renders disconnected when the worker is down", () => {
    const markup = renderToStaticMarkup(
      createElement(BlueskyLiveStatusBadge, {
        lastReceivedAt: "2026-03-25T12:00:24.000Z",
        lastAggregateRefreshAt: null,
        detailLatestPointAt: null,
        detailStaleGapMinutes: null,
        workerAlive: false,
        latestRunStatus: "success",
      }),
    );

    expect(markup).toContain("Disconnected");
    expect(markup).toContain('data-status="disconnected"');
  });
});
