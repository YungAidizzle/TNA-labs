import { describe, expect, it } from "vitest";
import { deriveBlueskyLiveStatus } from "@/lib/utils/bluesky-live-status";

describe("deriveBlueskyLiveStatus", () => {
  it("prefers lastReceivedAt and reports a live label with seconds", () => {
    const status = deriveBlueskyLiveStatus(
      {
        lastReceivedAt: "2026-03-25T12:00:12.000Z",
        lastAggregateRefreshAt: "2026-03-25T11:59:20.000Z",
        detailLatestPointAt: "2026-03-25T11:58:20.000Z",
        workerAlive: true,
        latestRunStatus: "success",
      },
      Date.parse("2026-03-25T12:00:30.000Z"),
    );

    expect(status.timestampSource).toBe("lastReceivedAt");
    expect(status.state).toBe("live");
    expect(status.label).toBe("Last ping 18s ago");
    expect(status.tooltip).toContain("2026-03-25T12:00:12.000Z");
    expect(status.tooltip).toContain("Source field: lastReceivedAt");
  });

  it("falls back to aggregate refresh time and marks delayed", () => {
    const status = deriveBlueskyLiveStatus(
      {
        lastReceivedAt: null,
        lastAggregateRefreshAt: "2026-03-25T11:59:20.000Z",
        detailLatestPointAt: "2026-03-25T11:58:00.000Z",
        workerAlive: true,
        latestRunStatus: "success",
      },
      Date.parse("2026-03-25T12:00:30.000Z"),
    );

    expect(status.timestampSource).toBe("lastAggregateRefreshAt");
    expect(status.state).toBe("delayed");
    expect(status.label).toBe("Delayed 1m");
  });

  it("falls back to detail latest point and marks stale", () => {
    const status = deriveBlueskyLiveStatus(
      {
        lastReceivedAt: null,
        lastAggregateRefreshAt: null,
        detailLatestPointAt: "2026-03-25T11:51:30.000Z",
        detailStaleGapMinutes: 8.8,
        workerAlive: true,
        latestRunStatus: "success",
      },
      Date.parse("2026-03-25T12:00:30.000Z"),
    );

    expect(status.timestampSource).toBe("detailLatestPointAt");
    expect(status.state).toBe("stale");
    expect(status.label).toBe("Stale 9m");
    expect(status.tooltip).toContain("Replay stale gap: 9m");
  });

  it("shows disconnected when worker is not alive", () => {
    const status = deriveBlueskyLiveStatus(
      {
        lastReceivedAt: "2026-03-25T12:00:20.000Z",
        workerAlive: false,
        latestRunStatus: "success",
      },
      Date.parse("2026-03-25T12:00:30.000Z"),
    );

    expect(status.state).toBe("disconnected");
    expect(status.label).toBe("Disconnected");
  });

  it("shows disconnected when latest run failed", () => {
    const status = deriveBlueskyLiveStatus(
      {
        lastReceivedAt: "2026-03-25T12:00:24.000Z",
        workerAlive: true,
        latestRunStatus: "failed",
      },
      Date.parse("2026-03-25T12:00:30.000Z"),
    );

    expect(status.state).toBe("disconnected");
    expect(status.label).toBe("Disconnected");
  });

  it("uses stream lag to avoid reporting live when backlog is delayed", () => {
    const status = deriveBlueskyLiveStatus(
      {
        lastReceivedAt: "2026-03-25T12:00:24.000Z",
        lastEventAt: "2026-03-25T11:45:24.000Z",
        streamLagSeconds: 15 * 60,
        workerAlive: true,
        latestRunStatus: "success",
      },
      Date.parse("2026-03-25T12:00:30.000Z"),
    );

    expect(status.state).toBe("stale");
    expect(status.label).toBe("Stale 15m");
    expect(status.tooltip).toContain("Stream lag: 15m");
  });

  it("keeps live status when ping and stream lag are both recent", () => {
    const status = deriveBlueskyLiveStatus(
      {
        lastReceivedAt: "2026-03-25T12:00:24.000Z",
        lastEventAt: "2026-03-25T12:00:23.000Z",
        streamLagSeconds: 7,
        workerAlive: true,
        latestRunStatus: "success",
      },
      Date.parse("2026-03-25T12:00:30.000Z"),
    );

    expect(status.state).toBe("live");
    expect(status.label).toBe("Live now");
  });

  it("shows degraded when the backend marks the pipeline degraded", () => {
    const status = deriveBlueskyLiveStatus(
      {
        lastReceivedAt: "2026-03-25T12:00:24.000Z",
        workerAlive: true,
        workerHeartbeatAt: "2026-03-25T12:00:25.000Z",
        latestRunStatus: "running",
        pipelineHealthState: "degraded",
        streamLagSeconds: 420,
      },
      Date.parse("2026-03-25T12:00:30.000Z"),
    );

    expect(status.state).toBe("degraded");
    expect(status.label).toBe("Degraded 7m");
    expect(status.tooltip).toContain("Pipeline health: degraded");
  });
});
