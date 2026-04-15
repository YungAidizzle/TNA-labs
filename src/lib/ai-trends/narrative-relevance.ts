import { assessMemecoinInfluence } from "./memecoin-influence";
import type { GeneratedAiTrendCandidate } from "./types";

export type AiTrendNarrativeRelevanceBand = "high" | "medium" | "low";

export type AiTrendNarrativeRelevanceAssessment = {
  band: AiTrendNarrativeRelevanceBand;
  score: number;
  reasons: string[];
};

type InternalAiTrendNarrativeRelevanceAssessment = AiTrendNarrativeRelevanceAssessment & {
  highEligible: boolean;
  mediumEligible: boolean;
};

export type AiTrendNarrativeBoardDistribution = {
  highCount: number;
  mediumCount: number;
  lowCount: number;
  highPct: number;
  mediumPct: number;
  lowPct: number;
};

export type AiTrendRerankResult = {
  trends: GeneratedAiTrendCandidate[];
  distribution: AiTrendNarrativeBoardDistribution;
  averageScore: number;
  rejectedReason: string | null;
};

const HIGH_SIGNAL_CATEGORIES = new Set([
  "animal meme",
  "catchphrase wave",
  "creator viral moment",
  "ai meme wave",
  "platform drama",
  "fandom wave",
  "gaming meme",
  "crypto spillover",
  "internet culture",
]);

const MEDIUM_SIGNAL_CATEGORIES = new Set([
  "celebrity meme",
  "creator",
  "culture",
  "entertainment",
  "gaming",
  "internet",
  "tech",
  "crypto",
  "memeified politics",
]);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeWhitespace(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLower(value: string | null | undefined) {
  return normalizeWhitespace(value).toLowerCase();
}

function buildAssessment(candidate: GeneratedAiTrendCandidate): InternalAiTrendNarrativeRelevanceAssessment {
  const category = normalizeLower(candidate.category);
  const profile = assessMemecoinInfluence(candidate);
  const reasons = [...profile.rankingSignals];

  let score = profile.score;
  if (HIGH_SIGNAL_CATEGORIES.has(category)) {
    score += 6;
    reasons.push("high_signal_category");
  } else if (MEDIUM_SIGNAL_CATEGORIES.has(category)) {
    score += 2;
    reasons.push("medium_signal_category");
  }

  if (!profile.memecoinReady && !profile.memeifiedPolitics && (profile.preferredHits.crypto_spillover ?? 0) <= 0) {
    score -= 8;
    reasons.push("not_memecoin_translatable");
  }

  const finalScore = clamp(score, 0, 100);
  const highEligible =
    profile.memecoinReady ||
    (profile.memeifiedPolitics && (profile.preferredHits.meme_distribution ?? 0) > 0) ||
    ((profile.preferredHits.crypto_spillover ?? 0) > 0 && profile.tokenizableNarrative);
  const mediumEligible =
    highEligible ||
    profile.tokenizableNarrative ||
    (profile.preferredHits.platform_drama ?? 0) > 0 ||
    (profile.preferredHits.fandom_wave ?? 0) > 0;
  const band: AiTrendNarrativeRelevanceBand =
    finalScore >= 68 && highEligible ? "high" : finalScore >= 46 && mediumEligible ? "medium" : "low";

  return {
    band,
    score: finalScore,
    reasons,
    highEligible,
    mediumEligible,
  };
}

function buildDistribution(assessments: AiTrendNarrativeRelevanceAssessment[]) {
  const highCount = assessments.filter((assessment) => assessment.band === "high").length;
  const mediumCount = assessments.filter((assessment) => assessment.band === "medium").length;
  const lowCount = assessments.length - highCount - mediumCount;
  const denominator = Math.max(1, assessments.length);

  return {
    highCount,
    mediumCount,
    lowCount,
    highPct: Math.round((highCount / denominator) * 100),
    mediumPct: Math.round((mediumCount / denominator) * 100),
    lowPct: Math.round((lowCount / denominator) * 100),
  } satisfies AiTrendNarrativeBoardDistribution;
}

function rejectedReason(distribution: AiTrendNarrativeBoardDistribution, totalCount: number) {
  const minHighCount = totalCount >= 100 ? 30 : Math.max(1, Math.round(totalCount * 0.25));
  const maxHighCount = totalCount >= 100 ? 48 : Math.max(minHighCount, Math.round(totalCount * 0.52));
  const minMediumCount = totalCount >= 100 ? 32 : Math.max(0, Math.round(totalCount * 0.25));
  const maxLowCount = totalCount >= 100 ? 25 : Math.ceil(totalCount * 0.25);

  if (distribution.highCount < minHighCount) {
    return `high relevance count too low (${distribution.highCount}/${totalCount})`;
  }
  if (distribution.highCount > maxHighCount) {
    return `high relevance count too high (${distribution.highCount}/${totalCount})`;
  }
  if (distribution.mediumCount < minMediumCount) {
    return `medium relevance count too low (${distribution.mediumCount}/${totalCount})`;
  }
  if (distribution.lowCount > maxLowCount) {
    return `low relevance count too high (${distribution.lowCount}/${totalCount})`;
  }
  return null;
}

function assignBoardBands(
  assessments: InternalAiTrendNarrativeRelevanceAssessment[],
): {
  bands: AiTrendNarrativeRelevanceBand[];
  distribution: AiTrendNarrativeBoardDistribution;
  rejectedReason: string | null;
} {
  const totalCount = assessments.length;
  const maxLowCount = totalCount >= 100 ? 25 : Math.ceil(totalCount * 0.25);
  const desiredHighMin = totalCount >= 100 ? 30 : Math.max(1, Math.round(totalCount * 0.25));
  const desiredHighMax = totalCount >= 100 ? 48 : Math.max(desiredHighMin, Math.round(totalCount * 0.52));
  const desiredMediumMin = totalCount >= 100 ? 32 : Math.max(0, totalCount - desiredHighMin - maxLowCount);
  const desiredMediumMax = totalCount >= 100 ? 45 : Math.max(desiredMediumMin, totalCount - desiredHighMin);
  const highFloor = 50;
  const mediumFloor = 34;

  const highCandidateIndexes = assessments
    .map((assessment, index) => ({ assessment, index }))
    .filter(({ assessment }) => assessment.highEligible && assessment.score >= highFloor)
    .map(({ index }) => index);
  const highCount = Math.min(desiredHighMax, highCandidateIndexes.length);

  const mediumTarget = Math.max(desiredMediumMin, totalCount - highCount - maxLowCount);
  const assignedBands = Array<AiTrendNarrativeRelevanceBand>(totalCount).fill("low");

  highCandidateIndexes.slice(0, highCount).forEach((index) => {
    assignedBands[index] = "high";
  });

  const mediumCandidateIndexes = assessments
    .map((assessment, index) => ({ assessment, index }))
    .filter(({ assessment, index }) => assignedBands[index] === "low" && assessment.mediumEligible && assessment.score >= mediumFloor)
    .map(({ index }) => index);
  const mediumCount = Math.min(desiredMediumMax, mediumCandidateIndexes.length);

  mediumCandidateIndexes.slice(0, mediumCount).forEach((index) => {
    assignedBands[index] = "medium";
  });

  const distribution = buildDistribution(
    assessments.map((assessment, index) => ({
      ...assessment,
      band: assignedBands[index] ?? "low",
    })),
  );

  const distributionRejectedReason =
    highCount < desiredHighMin
      ? `high relevance count too low (${highCount}/${totalCount})`
      : mediumCount < mediumTarget
        ? `medium relevance count too low (${mediumCount}/${totalCount})`
        : rejectedReason(distribution, totalCount);

  return {
    bands: assignedBands,
    distribution,
    rejectedReason: distributionRejectedReason,
  };
}

export function assessAiTrendNarrativeRelevance(candidate: GeneratedAiTrendCandidate) {
  return buildAssessment(candidate);
}

export function rerankAiTrendsForNarrativeRelevance(trends: GeneratedAiTrendCandidate[]): AiTrendRerankResult {
  const scored = [...trends]
    .sort((left, right) => left.rank - right.rank)
    .map((trend, index) => {
      const assessment = buildAssessment(trend);
      const rankingScore = clamp(
        assessment.score * 0.65 + trend.aiRankScore * 0.22 + trend.confidenceScore * 0.08 + (100 - index) * 0.05,
        0,
        100,
      );

      return {
        trend,
        assessment,
        rankingScore: Number(rankingScore.toFixed(2)),
        originalRank: index + 1,
      };
    })
    .sort((left, right) => {
      if (right.rankingScore !== left.rankingScore) {
        return right.rankingScore - left.rankingScore;
      }
      return left.originalRank - right.originalRank;
    });

  const bandAssignment = assignBoardBands(scored.map((entry) => entry.assessment));
  const ranked = scored.map((entry, index) => ({
    ...entry.trend,
    rank: index + 1,
    aiRankScore: entry.rankingScore,
    narrativeRelevance: bandAssignment.bands[index] ?? "low",
    narrativeScore: entry.assessment.score,
    rankingSignals: entry.assessment.reasons,
  }));

  const distribution = bandAssignment.distribution;
  const averageScore =
    scored.length > 0
      ? Number((scored.reduce((sum, entry) => sum + entry.assessment.score, 0) / scored.length).toFixed(2))
      : 0;

  return {
    trends: ranked,
    distribution,
    averageScore,
    rejectedReason: bandAssignment.rejectedReason,
  };
}
