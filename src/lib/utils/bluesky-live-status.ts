export const BLUESKY_LIVE_STATUS_THRESHOLDS = {
  liveSeconds: 30,
  delayedSeconds: 120,
  liveNowSeconds: 10,
} as const;

export type BlueskyLiveStatusInput = {
  lastReceivedAt?: string | null;
  lastAggregateRefreshAt?: string | null;
  detailLatestPointAt?: string | null;
  detailStaleGapMinutes?: number | null;
  workerAlive?: boolean | null;
  workerHeartbeatAt?: string | null;
  latestRunStatus?: string | null;
  lastEventAt?: string | null;
  streamLagSeconds?: number | null;
  pipelineHealthState?: "live" | "delayed" | "degraded" | "stale" | "disconnected" | null;
};

export type BlueskyLiveStatusState = "live" | "delayed" | "degraded" | "stale" | "disconnected";

export type BlueskyLiveStatus = {
  state: BlueskyLiveStatusState;
  label: string;
  ageSeconds: number | null;
  pingAgeSeconds: number | null;
  streamLagSeconds: number | null;
  lastPingAt: string | null;
  timestampSource:
    | "lastReceivedAt"
    | "lastAggregateRefreshAt"
    | "detailLatestPointAt"
    | null;
  tooltip: string;
};

function toTimestampMs(value: string | null | undefined) {
  if (!value) {
    return Number.NaN;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function toAgeSecondsFromTimestamp(value: string | null | undefined, nowMs: number) {
  const timestampMs = toTimestampMs(value);
  if (!Number.isFinite(timestampMs) || !Number.isFinite(nowMs)) {
    return null;
  }

  return Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
}

function formatAgeShort(ageSeconds: number) {
  if (ageSeconds < 60) {
    return `${ageSeconds}s`;
  }

  if (ageSeconds < 60 * 60) {
    return `${Math.floor(ageSeconds / 60)}m`;
  }

  if (ageSeconds < 60 * 60 * 24) {
    return `${Math.floor(ageSeconds / (60 * 60))}h`;
  }

  return `${Math.floor(ageSeconds / (60 * 60 * 24))}d`;
}

function resolvePreferredTimestamp(input: BlueskyLiveStatusInput) {
  const candidates: Array<{
    source: BlueskyLiveStatus["timestampSource"];
    value: string | null | undefined;
  }> = [
    { source: "lastReceivedAt", value: input.lastReceivedAt },
    { source: "lastAggregateRefreshAt", value: input.lastAggregateRefreshAt },
    { source: "detailLatestPointAt", value: input.detailLatestPointAt },
  ];

  for (const candidate of candidates) {
    const timestampMs = toTimestampMs(candidate.value);
    if (!Number.isFinite(timestampMs)) {
      continue;
    }

    if (candidate.value) {
      return {
        timestampSource: candidate.source,
        lastPingAt: candidate.value,
      };
    }
  }

  return {
    timestampSource: null,
    lastPingAt: null,
  };
}

function resolveStreamLagSeconds(input: BlueskyLiveStatusInput, nowMs: number) {
  if (typeof input.streamLagSeconds === "number" && Number.isFinite(input.streamLagSeconds)) {
    return Math.max(0, Math.round(input.streamLagSeconds));
  }

  return toAgeSecondsFromTimestamp(input.lastEventAt, nowMs);
}

function getStatusLabel(params: {
  state: BlueskyLiveStatusState;
  ageSeconds: number | null;
  pingAgeSeconds: number | null;
}) {
  if (params.state === "disconnected") {
    return "Disconnected";
  }

  if (params.state === "live") {
    if (
      params.ageSeconds === null ||
      params.ageSeconds <= BLUESKY_LIVE_STATUS_THRESHOLDS.liveNowSeconds
    ) {
      return "Live now";
    }

    const pingAge = params.pingAgeSeconds ?? params.ageSeconds;
    return `Last ping ${formatAgeShort(pingAge)} ago`;
  }

  if (params.state === "delayed") {
    return `Delayed ${formatAgeShort(params.ageSeconds ?? 0)}`;
  }

  if (params.state === "degraded") {
    return params.ageSeconds === null ? "Degraded" : `Degraded ${formatAgeShort(params.ageSeconds)}`;
  }

  return params.ageSeconds === null ? "Stale" : `Stale ${formatAgeShort(params.ageSeconds)}`;
}

function buildTooltip(params: {
  input: BlueskyLiveStatusInput;
  timestampSource: BlueskyLiveStatus["timestampSource"];
  lastPingAt: string | null;
  streamLagSeconds: number | null;
  nowMs: number;
  state: BlueskyLiveStatusState;
}) {
  const lines: string[] = [];

  if (params.lastPingAt) {
    lines.push(`Last ping (ISO): ${params.lastPingAt}`);
    lines.push(`Last ping (local): ${new Date(params.lastPingAt).toLocaleString()}`);
  } else {
    lines.push("Last ping: unavailable");
  }

  if (params.timestampSource) {
    lines.push(`Source field: ${params.timestampSource}`);
  }

  if (params.input.lastEventAt) {
    lines.push(`Latest event at (ISO): ${params.input.lastEventAt}`);
    lines.push(`Latest event at (local): ${new Date(params.input.lastEventAt).toLocaleString()}`);
  }

  if (params.streamLagSeconds !== null) {
    lines.push(`Stream lag: ${formatAgeShort(params.streamLagSeconds)}`);
  }

  if (typeof params.input.detailStaleGapMinutes === "number") {
    lines.push(
      `Replay stale gap: ${Math.max(0, Math.round(params.input.detailStaleGapMinutes))}m`,
    );
  }

  if (params.input.workerAlive === false) {
    lines.push("Worker state: not alive");
  } else if (params.input.workerAlive === true) {
    lines.push("Worker state: alive");
  }

  if (params.input.workerHeartbeatAt) {
    const heartbeatAgeSeconds = toAgeSecondsFromTimestamp(
      params.input.workerHeartbeatAt,
      params.nowMs,
    );
    lines.push(`Worker heartbeat (ISO): ${params.input.workerHeartbeatAt}`);
    if (heartbeatAgeSeconds !== null) {
      lines.push(`Worker heartbeat age: ${formatAgeShort(heartbeatAgeSeconds)}`);
    }
  }

  if (params.input.latestRunStatus) {
    lines.push(`Latest run status: ${params.input.latestRunStatus}`);
  }

  if (params.input.pipelineHealthState) {
    lines.push(`Pipeline health: ${params.input.pipelineHealthState}`);
  }

  if (params.state === "disconnected") {
    lines.push("Status reason: worker disconnected or latest run failed");
  }

  return lines.join("\n");
}

function maxFiniteAge(...values: Array<number | null>) {
  const finiteValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (finiteValues.length === 0) {
    return null;
  }

  return Math.max(...finiteValues);
}

export function deriveBlueskyLiveStatus(
  input: BlueskyLiveStatusInput,
  nowMs = Date.now(),
): BlueskyLiveStatus {
  const runStatus = String(input.latestRunStatus ?? "").toLowerCase();
  const disconnected = input.workerAlive === false || runStatus === "failed";
  const { timestampSource, lastPingAt } = resolvePreferredTimestamp(input);
  const pingAgeSeconds = toAgeSecondsFromTimestamp(lastPingAt, nowMs);
  const streamLagSeconds = resolveStreamLagSeconds(input, nowMs);
  const ageSeconds = maxFiniteAge(pingAgeSeconds, streamLagSeconds);

  let state: BlueskyLiveStatusState = disconnected
    ? "disconnected"
    : ageSeconds === null
      ? "stale"
      : ageSeconds <= BLUESKY_LIVE_STATUS_THRESHOLDS.liveSeconds
        ? "live"
        : ageSeconds <= BLUESKY_LIVE_STATUS_THRESHOLDS.delayedSeconds
          ? "delayed"
          : "stale";

  if (input.pipelineHealthState) {
    state = input.pipelineHealthState;
  }

  return {
    state,
    label: getStatusLabel({
      state,
      ageSeconds,
      pingAgeSeconds,
    }),
    ageSeconds,
    pingAgeSeconds,
    streamLagSeconds,
    lastPingAt,
    timestampSource,
    tooltip: buildTooltip({
      input,
      timestampSource,
      lastPingAt,
      streamLagSeconds,
      nowMs,
      state,
    }),
  };
}
