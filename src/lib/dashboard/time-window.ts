import { DateRangePreset, TimeSeriesPoint } from "@/types/domain";
import { TimeSeriesWindow } from "@/types/view-models";

export const RANGE_WINDOW_MS: Record<DateRangePreset, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const RANGE_FALLBACK_BUCKET_INTERVAL_MS: Record<DateRangePreset, number> = {
  "1h": 5 * 60 * 1000,
  "6h": 5 * 60 * 1000,
  "24h": 5 * 60 * 1000,
  "7d": 30 * 60 * 1000,
};

function toFiniteTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.NaN;
  }

  return Date.parse(value);
}

function inferBucketIntervalMs(points: TimeSeriesPoint[], range: DateRangePreset) {
  const deltas: number[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const previousMs = toFiniteTimestamp(points[index - 1]?.timestamp);
    const currentMs = toFiniteTimestamp(points[index]?.timestamp);
    const deltaMs = currentMs - previousMs;

    if (Number.isFinite(deltaMs) && deltaMs > 0) {
      deltas.push(deltaMs);
    }
  }

  if (deltas.length === 0) {
    return RANGE_FALLBACK_BUCKET_INTERVAL_MS[range];
  }

  deltas.sort((left, right) => left - right);
  return deltas[Math.floor(deltas.length / 2)] ?? RANGE_FALLBACK_BUCKET_INTERVAL_MS[range];
}

function buildWindowMeta(params: {
  points: TimeSeriesPoint[];
  range: DateRangePreset;
  now: Date;
}): TimeSeriesWindow {
  const { points, range, now } = params;
  const bucketIntervalMs = inferBucketIntervalMs(points, range);
  const windowEndMs = now.getTime();
  const latestPoint = [...points]
    .reverse()
    .find((point) => Number.isFinite(toFiniteTimestamp(point.timestamp))) ?? null;
  const latestData = [...points]
    .reverse()
    .find(
      (point) =>
        Number.isFinite(toFiniteTimestamp(point.timestamp)) &&
        typeof point.value === "number" &&
        Number.isFinite(point.value) &&
        point.value > 0,
    ) ?? null;
  const latestPointMs = latestPoint ? toFiniteTimestamp(latestPoint.timestamp) : Number.NaN;
  const staleGapMinutes = Number.isFinite(latestPointMs)
    ? Math.max(0, Math.round((windowEndMs - latestPointMs) / 60_000))
    : null;
  const trailingGapBucketCount = Number.isFinite(latestPointMs)
    ? Math.max(0, Math.ceil((windowEndMs - latestPointMs) / bucketIntervalMs))
    : Math.ceil(RANGE_WINDOW_MS[range] / bucketIntervalMs);

  return {
    range,
    windowStart: new Date(windowEndMs - RANGE_WINDOW_MS[range]).toISOString(),
    windowEnd: now.toISOString(),
    latestPointAt: latestPoint?.timestamp ?? null,
    latestDataAt: latestData?.timestamp ?? null,
    staleGapMinutes,
    trailingGapBucketCount,
    hasTrailingGap: trailingGapBucketCount > 0,
    bucketIntervalMinutes: Math.max(1, Math.round(bucketIntervalMs / 60_000)),
  };
}

export function clipTimeSeriesToLiveWindow(params: {
  points: TimeSeriesPoint[];
  range: DateRangePreset;
  now: Date;
}) {
  const { points, range, now } = params;
  const windowMeta = buildWindowMeta({ points, range, now });
  const windowStartMs = toFiniteTimestamp(windowMeta.windowStart);
  const windowEndMs = toFiniteTimestamp(windowMeta.windowEnd);

  const clippedPoints = points.filter((point) => {
    const pointMs = toFiniteTimestamp(point.timestamp);

    return Number.isFinite(pointMs) && pointMs >= windowStartMs && pointMs <= windowEndMs;
  });

  return {
    points: clippedPoints,
    window: windowMeta,
  };
}

export function timeSeriesCoversWindow(
  points: TimeSeriesPoint[],
  range: DateRangePreset,
  coverageThreshold = 0.9,
) {
  if (points.length === 0) {
    return false;
  }

  const bucketIntervalMs = inferBucketIntervalMs(points, range);
  const firstPointMs = toFiniteTimestamp(points[0]?.timestamp);
  const lastPointMs = toFiniteTimestamp(points.at(-1)?.timestamp);

  if (!Number.isFinite(firstPointMs) || !Number.isFinite(lastPointMs)) {
    return false;
  }

  const coverageMs = Math.max(bucketIntervalMs, lastPointMs - firstPointMs + bucketIntervalMs);
  return coverageMs >= RANGE_WINDOW_MS[range] * coverageThreshold;
}
