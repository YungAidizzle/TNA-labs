import { clamp } from "@/lib/formatters";
import { TrendLifecycleStage } from "@/types/domain";

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function normalizeGrowthRate(value: number) {
  return clamp(50 + value * 2.4, 0, 100);
}

function normalizeAcceleration(value: number) {
  return clamp(50 + value * 7.5, 0, 100);
}

function normalizePlatformSpread(value: number) {
  return clamp((value / 6) * 100, 0, 100);
}

function normalizeVelocity(value: number) {
  return clamp(value, 0, 100);
}

function normalizeNovelty(value: number) {
  return clamp(value, 0, 100);
}

type TrendStrengthInputs = {
  attentionScore: number;
  confidenceScore: number;
  growthRate: number;
  attentionAcceleration: number;
  platformSpread: number;
  persistenceScore: number;
  blueskyShare?: number;
};

type EarlyTrendInputs = {
  attentionScore: number;
  growthRate: number;
  attentionAcceleration: number;
  platformSpread: number;
  persistenceScore: number;
  lifecycleStage: TrendLifecycleStage;
  blueskyShare?: number;
};

type EmergingBreakoutInputs = {
  velocityScore: number;
  noveltyScore: number;
  confirmationScore: number;
  freshnessScore: number;
  confidenceScore: number;
  growthRate: number;
  attentionAcceleration: number;
  mainstreamPenalty?: number;
  spamPenalty?: number;
  spikeBonus?: number;
};

export function getTrendStrengthScore({
  attentionScore,
  confidenceScore,
  growthRate,
  attentionAcceleration,
  platformSpread,
  persistenceScore,
  blueskyShare = 0,
}: TrendStrengthInputs) {
  const blueskyDominanceBoost = clamp((blueskyShare - 35) * 0.18, 0, 8);
  const score =
    attentionScore * 0.3 +
    confidenceScore * 0.18 +
    normalizeGrowthRate(growthRate) * 0.18 +
    normalizeAcceleration(attentionAcceleration) * 0.14 +
    normalizePlatformSpread(platformSpread) * 0.08 +
    persistenceScore * 0.12 +
    blueskyDominanceBoost;

  return round1(clamp(score, 0, 100));
}

export function getIsEarlyTrend({
  attentionScore,
  growthRate,
  attentionAcceleration,
  platformSpread,
  persistenceScore,
  lifecycleStage,
  blueskyShare = 0,
}: EarlyTrendInputs) {
  const platformSpreadFloor = blueskyShare >= 45 ? 1 : 2;
  return (
    attentionScore >= 14 &&
    attentionScore <= 62 &&
    growthRate >= -4 &&
    attentionAcceleration >= 1.8 &&
    platformSpread >= platformSpreadFloor &&
    platformSpread <= 4 &&
    persistenceScore >= 14 &&
    persistenceScore <= 92 &&
    (lifecycleStage === "Emerging" || lifecycleStage === "Expanding")
  );
}

export function getEmergingBreakoutScore({
  velocityScore,
  noveltyScore,
  confirmationScore,
  freshnessScore,
  confidenceScore,
  growthRate,
  attentionAcceleration,
  mainstreamPenalty = 0,
  spamPenalty = 0,
  spikeBonus = 0,
}: EmergingBreakoutInputs) {
  const score =
    normalizeVelocity(velocityScore) * 0.3 +
    normalizeNovelty(noveltyScore) * 0.24 +
    clamp(confirmationScore, 0, 100) * 0.16 +
    clamp(freshnessScore, 0, 100) * 0.1 +
    clamp(confidenceScore, 0, 100) * 0.08 +
    normalizeGrowthRate(growthRate) * 0.07 +
    normalizeAcceleration(attentionAcceleration) * 0.05 +
    spikeBonus -
    mainstreamPenalty -
    spamPenalty;

  return round1(clamp(score, 0, 100));
}

export function getFreshnessRankFactor(freshnessScore: number, aggressive = false) {
  const minimum = aggressive ? 0.42 : 0.55;
  const spread = aggressive ? 0.58 : 0.45;
  return round1(clamp(minimum + clamp(freshnessScore, 0, 100) / 100 * spread, minimum, 1));
}
