import { DateRangePreset, TimeSeriesPoint } from "@/types/domain";
import { TimeSeriesWindow } from "@/types/view-models";

const RANGE_FALLBACK_WINDOW_MS: Record<DateRangePreset, number> = {
  "1h": 60 * 60 * 1_000,
  "6h": 6 * 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
};

const RANGE_FALLBACK_BUCKET_MS: Record<DateRangePreset, number> = {
  "1h": 5 * 60 * 1_000,
  "6h": 5 * 60 * 1_000,
  "24h": 5 * 60 * 1_000,
  "7d": 30 * 60 * 1_000,
};

type TrendSignalPipelineInput = {
  points: TimeSeriesPoint[];
  seriesWindow: TimeSeriesWindow | null;
  rollingWindowBuckets: number;
  movingAverageWindowBuckets: number;
  persistenceHalfLifeBuckets: number;
};

export type TrendSignalPipelineResult = {
  rawBuckets: TimeSeriesPoint[];
  rollingSum: TimeSeriesPoint[];
  persistedRollingSum: TimeSeriesPoint[];
  movingAverage: TimeSeriesPoint[];
  windowStartIso: string;
  windowEndIso: string;
  bucketIntervalMs: number;
  rollingWindowBuckets: number;
  movingAverageWindowBuckets: number;
  persistenceHalfLifeBuckets: number;
};

function clampPositiveInteger(value: number, fallback: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function toFiniteTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.NaN;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function inferBucketIntervalMs(points: TimeSeriesPoint[], fallbackMs: number) {
  if (points.length < 2) {
    return fallbackMs;
  }

  const deltas: number[] = [];
  const ordered = [...points]
    .map((point) => ({
      timestampMs: toFiniteTimestamp(point.timestamp),
      value: point.value,
    }))
    .filter((point) => Number.isFinite(point.timestampMs))
    .sort((left, right) => left.timestampMs - right.timestampMs);

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current) {
      continue;
    }

    const deltaMs = current.timestampMs - previous.timestampMs;
    if (Number.isFinite(deltaMs) && deltaMs > 0) {
      deltas.push(deltaMs);
    }
  }

  if (deltas.length === 0) {
    return fallbackMs;
  }

  deltas.sort((left, right) => left - right);
  return deltas[Math.floor(deltas.length / 2)] ?? fallbackMs;
}

function resolveWindowRange(params: {
  points: TimeSeriesPoint[];
  seriesWindow: TimeSeriesWindow | null;
}) {
  const range = params.seriesWindow?.range ?? "24h";
  const fallbackWindowMs = RANGE_FALLBACK_WINDOW_MS[range];
  const nowMs = Date.now();
  const fallbackEndMs = nowMs;
  const fallbackStartMs = fallbackEndMs - fallbackWindowMs;

  const configuredStartMs = toFiniteTimestamp(params.seriesWindow?.windowStart);
  const configuredEndMs = toFiniteTimestamp(params.seriesWindow?.windowEnd);
  const pointTimestamps = params.points
    .map((point) => toFiniteTimestamp(point.timestamp))
    .filter((value) => Number.isFinite(value));
  const firstPointMs = pointTimestamps.length > 0 ? Math.min(...pointTimestamps) : Number.NaN;
  const lastPointMs = pointTimestamps.length > 0 ? Math.max(...pointTimestamps) : Number.NaN;

  const startMs = Number.isFinite(configuredStartMs)
    ? configuredStartMs
    : Number.isFinite(firstPointMs)
      ? firstPointMs
      : fallbackStartMs;
  const endMs = Number.isFinite(configuredEndMs)
    ? configuredEndMs
    : Number.isFinite(lastPointMs)
      ? lastPointMs
      : fallbackEndMs;

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return {
      range,
      windowStartMs: fallbackStartMs,
      windowEndMs: fallbackEndMs,
      fallbackBucketMs: RANGE_FALLBACK_BUCKET_MS[range],
    };
  }

  if (endMs <= startMs) {
    return {
      range,
      windowStartMs: startMs,
      windowEndMs: startMs,
      fallbackBucketMs: RANGE_FALLBACK_BUCKET_MS[range],
    };
  }

  return {
    range,
    windowStartMs: startMs,
    windowEndMs: endMs,
    fallbackBucketMs: RANGE_FALLBACK_BUCKET_MS[range],
  };
}

function buildCanonicalBuckets(params: {
  points: TimeSeriesPoint[];
  seriesWindow: TimeSeriesWindow | null;
}) {
  const resolvedWindow = resolveWindowRange(params);
  const configuredIntervalMs = params.seriesWindow?.bucketIntervalMinutes
    ? Math.max(1, Math.round(params.seriesWindow.bucketIntervalMinutes * 60_000))
    : Number.NaN;
  const inferredIntervalMs = inferBucketIntervalMs(params.points, resolvedWindow.fallbackBucketMs);
  const bucketIntervalMs = Number.isFinite(configuredIntervalMs)
    ? configuredIntervalMs
    : inferredIntervalMs;
  const safeBucketIntervalMs = Math.max(1, Math.round(bucketIntervalMs));
  const bucketCount = Math.max(
    1,
    Math.floor((resolvedWindow.windowEndMs - resolvedWindow.windowStartMs) / safeBucketIntervalMs) + 1,
  );

  const bucketTimestampMs = Array.from({ length: bucketCount }, (_, index) => (
    resolvedWindow.windowStartMs + index * safeBucketIntervalMs
  ));
  const rawValues = new Array<number>(bucketCount).fill(0);

  for (const point of params.points) {
    const timestampMs = toFiniteTimestamp(point.timestamp);
    if (!Number.isFinite(timestampMs)) {
      continue;
    }

    if (timestampMs < resolvedWindow.windowStartMs || timestampMs > resolvedWindow.windowEndMs) {
      continue;
    }

    const bucketIndex = Math.floor((timestampMs - resolvedWindow.windowStartMs) / safeBucketIntervalMs);
    if (bucketIndex < 0 || bucketIndex >= bucketCount) {
      continue;
    }

    const value = Number.isFinite(point.value) ? Math.max(0, point.value) : 0;
    rawValues[bucketIndex] = (rawValues[bucketIndex] ?? 0) + value;
  }

  return {
    bucketTimestampMs,
    rawValues,
    bucketIntervalMs: safeBucketIntervalMs,
    windowStartMs: resolvedWindow.windowStartMs,
    windowEndMs: resolvedWindow.windowEndMs,
  };
}

function buildRollingSum(values: number[], windowBuckets: number) {
  if (values.length === 0) {
    return [];
  }

  const safeWindow = clampPositiveInteger(windowBuckets, 1);
  const rolling = new Array<number>(values.length).fill(0);
  let runningSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    runningSum += values[index] ?? 0;
    if (index >= safeWindow) {
      runningSum -= values[index - safeWindow] ?? 0;
    }
    rolling[index] = Math.max(0, runningSum);
  }

  return rolling;
}

function buildDecayPersistence(values: number[], halfLifeBuckets: number) {
  if (values.length === 0) {
    return [];
  }

  const safeHalfLife = clampPositiveInteger(halfLifeBuckets, 1);
  const decayFactor = Math.exp(Math.log(0.5) / safeHalfLife);
  const persisted = new Array<number>(values.length).fill(0);

  persisted[0] = Math.max(0, values[0] ?? 0);
  for (let index = 1; index < values.length; index += 1) {
    const baseline = Math.max(0, values[index] ?? 0);
    const carry = Math.max(0, (persisted[index - 1] ?? 0) * decayFactor);
    persisted[index] = Math.max(baseline, carry);
  }

  return persisted;
}

function buildMovingAverage(values: number[], windowBuckets: number) {
  if (values.length === 0) {
    return [];
  }

  const safeWindow = clampPositiveInteger(windowBuckets, 1);
  const movingAverage = new Array<number>(values.length).fill(0);
  let runningSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    runningSum += values[index] ?? 0;
    if (index >= safeWindow) {
      runningSum -= values[index - safeWindow] ?? 0;
    }
    const denominator = Math.min(index + 1, safeWindow);
    movingAverage[index] = denominator > 0 ? runningSum / denominator : 0;
  }

  return movingAverage;
}

function toPoints(timestamps: number[], values: number[]) {
  return timestamps.map((timestamp, index) => ({
    timestamp: new Date(timestamp).toISOString(),
    value: values[index] ?? 0,
  }));
}

export function buildTrendSignalPipeline(
  params: TrendSignalPipelineInput,
): TrendSignalPipelineResult {
  const canonical = buildCanonicalBuckets({
    points: params.points,
    seriesWindow: params.seriesWindow,
  });

  const rollingWindowBuckets = clampPositiveInteger(params.rollingWindowBuckets, 12);
  const movingAverageWindowBuckets = clampPositiveInteger(params.movingAverageWindowBuckets, 6);
  const persistenceHalfLifeBuckets = clampPositiveInteger(params.persistenceHalfLifeBuckets, 8);

  const rollingSum = buildRollingSum(canonical.rawValues, rollingWindowBuckets);
  const persistedRollingSum = buildDecayPersistence(rollingSum, persistenceHalfLifeBuckets);
  const movingAverage = buildMovingAverage(persistedRollingSum, movingAverageWindowBuckets);

  return {
    rawBuckets: toPoints(canonical.bucketTimestampMs, canonical.rawValues),
    rollingSum: toPoints(canonical.bucketTimestampMs, rollingSum),
    persistedRollingSum: toPoints(canonical.bucketTimestampMs, persistedRollingSum),
    movingAverage: toPoints(canonical.bucketTimestampMs, movingAverage),
    windowStartIso: new Date(canonical.windowStartMs).toISOString(),
    windowEndIso: new Date(canonical.windowEndMs).toISOString(),
    bucketIntervalMs: canonical.bucketIntervalMs,
    rollingWindowBuckets,
    movingAverageWindowBuckets,
    persistenceHalfLifeBuckets,
  };
}
