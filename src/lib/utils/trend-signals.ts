import { clamp } from "@/lib/formatters";
import {
  PlatformId,
  TimeSeriesPoint,
  TrendLifecycleStage,
  TrendPlatformTimeline,
} from "@/types/domain";
import { TrendAttentionDriver } from "@/types/view-models";

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function values(points: TimeSeriesPoint[]) {
  return points.map((point) => point.value);
}

function average(input: number[]) {
  if (input.length === 0) {
    return 0;
  }

  return input.reduce((sum, value) => sum + value, 0) / input.length;
}

function stdDev(input: number[]) {
  if (input.length === 0) {
    return 0;
  }

  const mean = average(input);
  const variance =
    input.reduce((sum, value) => sum + (value - mean) ** 2, 0) / input.length;
  return Math.sqrt(variance);
}

function percentChange(current: number, previous: number) {
  return ((current - previous) / Math.max(previous, 1)) * 100;
}

function windowSize(length: number, fraction: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.floor(length * fraction)));
}

export function getGrowthRateFromHistory(points: TimeSeriesPoint[]) {
  const series = values(points);
  if (series.length < 4) {
    return 0;
  }

  const recentWindow = windowSize(series.length, 0.14, 4, 18);
  const baselineWindow = windowSize(series.length, 0.28, recentWindow + 2, 32);
  const recentAverage = average(series.slice(-recentWindow));
  const baselineAverage = average(
    series.slice(-(recentWindow + baselineWindow), -recentWindow),
  );

  return round1(percentChange(recentAverage, baselineAverage));
}

export function getAttentionAcceleration(points: TimeSeriesPoint[]) {
  const series = values(points);
  if (series.length < 6) {
    return 0;
  }

  const interval = windowSize(series.length, 0.12, 3, 14);
  const recentAverage = average(series.slice(-interval));
  const previousAverage = average(series.slice(-interval * 2, -interval));
  const olderAverage = average(series.slice(-interval * 3, -interval * 2));

  const recentGrowth = percentChange(recentAverage, previousAverage);
  const priorGrowth = percentChange(previousAverage, olderAverage);

  return round1(recentGrowth - priorGrowth);
}

export function getSpikeSignal(points: TimeSeriesPoint[]) {
  const series = values(points);
  if (series.length < 8) {
    return {
      hasSpike: false,
      spikeMagnitude: 0,
    };
  }

  const recentWindow = windowSize(series.length, 0.08, 3, 8);
  const trailingWindow = windowSize(series.length, 0.2, recentWindow + 3, 24);
  const latestValue = series.at(-1) ?? 0;
  const trailingBaseline = average(
    series.slice(-(recentWindow + trailingWindow), -recentWindow),
  );
  const recentAverage = average(series.slice(-recentWindow));
  const spikeMagnitude = round1(percentChange(latestValue, trailingBaseline));

  return {
    hasSpike: spikeMagnitude >= 22 && latestValue > recentAverage * 1.06,
    spikeMagnitude,
  };
}

export function getPersistenceScore(points: TimeSeriesPoint[]) {
  const series = values(points);
  if (series.length < 3) {
    return 0;
  }

  const mean = average(series);
  const stability = 1 - clamp(stdDev(series) / Math.max(mean, 1), 0, 1.35) / 1.35;
  const sustainedRatio =
    series.filter((value) => value >= mean * 0.72).length / Math.max(series.length, 1);
  const floorRatio = clamp(Math.min(...series) / Math.max(mean, 1), 0, 1);

  return round1(clamp((stability * 0.38 + sustainedRatio * 0.4 + floorRatio * 0.22) * 100, 0, 100));
}

export function getTrendLifecycleStage(
  points: TimeSeriesPoint[],
  growthRate: number,
  attentionAcceleration: number,
): TrendLifecycleStage {
  const series = values(points);
  if (series.length < 4) {
    return "Emerging";
  }

  const latestValue = series.at(-1) ?? 0;
  const peakValue = Math.max(...series);
  const recentWindow = windowSize(series.length, 0.1, 3, 10);
  const recentAverage = average(series.slice(-recentWindow));
  const previousAverage = average(series.slice(-recentWindow * 2, -recentWindow));
  const nearPeak = latestValue >= peakValue * 0.94;
  const trendingDown = recentAverage < previousAverage * 0.985;
  const breakoutRatio = latestValue / Math.max(previousAverage, 1);

  if (
    growthRate <= -5 ||
    (attentionAcceleration <= -2.2 && trendingDown && latestValue < peakValue * 0.88)
  ) {
    return "Declining";
  }

  if (
    (growthRate >= 8 && attentionAcceleration >= 0.9 && latestValue < peakValue * 0.985) ||
    (growthRate >= 5 && breakoutRatio >= 1.35 && recentAverage > previousAverage * 1.2)
  ) {
    return "Expanding";
  }

  if (nearPeak && growthRate >= -1.5 && growthRate <= 5.5 && Math.abs(attentionAcceleration) <= 2.2) {
    return "Established";
  }

  if ((nearPeak && attentionAcceleration < -0.7) || (growthRate >= 0 && attentionAcceleration < -1.6)) {
    return "Fading";
  }

  if (growthRate > 1.5 || attentionAcceleration > 0.5) {
    return "Emerging";
  }

  return trendingDown ? "Declining" : "Established";
}

export function getOriginPlatform(platformTimelines: TrendPlatformTimeline[]): PlatformId {
  if (platformTimelines.length === 0) {
    return "x";
  }

  const scored = platformTimelines.map((timeline) => {
    const series = values(timeline.points);
    const earlyWindow = windowSize(series.length, 0.2, 4, 20);
    const earlyAverage = average(series.slice(0, earlyWindow));
    const earlyPeak = Math.max(...series.slice(0, earlyWindow));

    return {
      platformId: timeline.platformId,
      score: earlyAverage * 0.72 + earlyPeak * 0.28,
    };
  });

  return scored.sort((left, right) => right.score - left.score)[0]?.platformId ?? "x";
}

export function getPlatformMigrationPath(platformTimelines: TrendPlatformTimeline[]) {
  return platformTimelines
    .map((timeline) => {
      const series = values(timeline.points);
      const maxValue = Math.max(...series);
      const threshold = maxValue * 0.62;
      const thresholdIndex = series.findIndex((value) => value >= threshold);
      const firstStrongIndex = thresholdIndex >= 0 ? thresholdIndex : series.length;

      return {
        platformId: timeline.platformId,
        firstStrongIndex,
        peakValue: maxValue,
      };
    })
    .sort((left, right) => {
      if (left.firstStrongIndex !== right.firstStrongIndex) {
        return left.firstStrongIndex - right.firstStrongIndex;
      }

      return right.peakValue - left.peakValue;
    })
    .map((entry) => entry.platformId);
}

export function getAttentionDrivers(
  platformTimelines: TrendPlatformTimeline[],
): TrendAttentionDriver[] {
  const metrics = platformTimelines.map((timeline) => {
    const series = values(timeline.points);
    const recentWindow = windowSize(series.length, 0.12, 3, 14);
    const recentAverage = average(series.slice(-recentWindow));
    const previousAverage = average(series.slice(-recentWindow * 2, -recentWindow));
    const delta = recentAverage - previousAverage;

    return {
      platformId: timeline.platformId,
      delta,
      deltaPct: round1(percentChange(recentAverage, previousAverage)),
    };
  });

  const positiveDrivers = metrics.filter((metric) => metric.delta > 0);
  const source = positiveDrivers.length > 0 ? positiveDrivers : metrics;
  const totalDelta = source.reduce((sum, metric) => sum + Math.max(metric.delta, 0.01), 0);

  return source
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 3)
    .map((driver) => ({
      platformId: driver.platformId,
      contributionPct: round1((Math.max(driver.delta, 0.01) / totalDelta) * 100),
      deltaPct: driver.deltaPct,
    }));
}
