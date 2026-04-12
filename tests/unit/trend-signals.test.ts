import { getIsEarlyTrend, getTrendStrengthScore } from "@/lib/utils/trend-scoring";
import {
  getAttentionAcceleration,
  getGrowthRateFromHistory,
  getPersistenceScore,
  getSpikeSignal,
  getTrendLifecycleStage,
} from "@/lib/utils/trend-signals";
import { TimeSeriesPoint } from "@/types/domain";

function makeSeries(values: number[]): TimeSeriesPoint[] {
  return values.map((value, index) => ({
    timestamp: new Date(Date.UTC(2026, 2, 16, 0, index * 5)).toISOString(),
    value,
  }));
}

describe("trend signal helpers", () => {
  it("derives positive growth and acceleration from steepening histories", () => {
    const points = makeSeries([12, 13, 14, 15, 16, 18, 22, 29, 38, 50, 66, 84]);

    expect(getGrowthRateFromHistory(points)).toBeGreaterThan(0);
    expect(getAttentionAcceleration(points)).toBeGreaterThan(0);
  });

  it("classifies lifecycle stages from simple histories", () => {
    const declining = makeSeries([88, 84, 81, 76, 68, 60, 54, 48, 41, 36, 30, 26]);
    const accelerating = makeSeries([10, 10, 11, 12, 14, 17, 22, 30, 42, 58, 79, 104]);

    expect(
      getTrendLifecycleStage(
        declining,
        getGrowthRateFromHistory(declining),
        getAttentionAcceleration(declining),
      ),
    ).toBe("Declining");
    expect(
      getTrendLifecycleStage(
        accelerating,
        getGrowthRateFromHistory(accelerating),
        getAttentionAcceleration(accelerating),
      ),
    ).toBe("Expanding");
  });

  it("detects spikes and computes persistence from nonlinear histories", () => {
    const spikeSeries = makeSeries([18, 19, 18, 20, 21, 20, 22, 21, 22, 24, 25, 39]);
    const steadySeries = makeSeries([40, 41, 40, 42, 43, 42, 41, 42, 43, 42, 41, 42]);

    expect(getSpikeSignal(spikeSeries).hasSpike).toBe(true);
    expect(getSpikeSignal(spikeSeries).spikeMagnitude).toBeGreaterThan(20);
    expect(getPersistenceScore(steadySeries)).toBeGreaterThan(55);
  });

  it("computes trend strength and early-trend detection with transparent thresholds", () => {
    const strength = getTrendStrengthScore({
      attentionScore: 61,
      confidenceScore: 72,
      growthRate: 8.4,
      attentionAcceleration: 2.6,
      platformSpread: 3,
      persistenceScore: 58,
    });

    expect(strength).toBeGreaterThan(0);
    expect(strength).toBeLessThanOrEqual(100);
    expect(
      getIsEarlyTrend({
        attentionScore: 54,
        growthRate: 9.2,
        attentionAcceleration: 3.2,
        platformSpread: 3,
        persistenceScore: 60,
        lifecycleStage: "Expanding",
      }),
    ).toBe(true);
  });
});
