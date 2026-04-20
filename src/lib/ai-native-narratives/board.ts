import type {
  AiNativeNarrativeMemeArchetype,
  GeneratedAiNativeNarrative,
} from "@/lib/ai-native-narratives/types";

const LABEL_GENERIC_TOKENS = new Set([
  "analysis",
  "board",
  "coverage",
  "debate",
  "discussion",
  "headline",
  "internet",
  "latest",
  "media",
  "moment",
  "narrative",
  "news",
  "story",
  "topic",
  "trend",
  "update",
  "viral",
  "wave",
]);

const LABEL_WEAK_TOKENS = new Set([
  "chaos",
  "crew",
  "duo",
  "energy",
  "era",
  "frenzy",
  "hype",
  "mania",
  "momentum",
  "saga",
  "storm",
  "vibes",
]);

type NarrativeBoardRow = Pick<
  GeneratedAiNativeNarrative,
  | "candidateKeys"
  | "canonicalId"
  | "canonicalName"
  | "confidence"
  | "drynessScore"
  | "evidenceCount"
  | "evidenceKeys"
  | "keyEntities"
  | "lastSeenAt"
  | "memeArchetype"
  | "memeScore"
  | "rank"
  | "sourceCount"
  | "sourceDomains"
  | "status"
  | "visualScore"
>;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeWordTokens(value: string) {
  return normalizeWhitespace(value)
    .split(" ")
    .map((token) => token.replace(/^[^a-z0-9$#]+|[^a-z0-9$#]+$/gi, "").toLowerCase())
    .filter(Boolean);
}

function computeSetOverlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let shared = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) {
      shared += 1;
    }
  }

  return shared / Math.max(leftSet.size, rightSet.size);
}

function computeLabelTokenOverlap(left: string, right: string) {
  const leftTokens = normalizeWordTokens(left).filter(
    (token) => !LABEL_GENERIC_TOKENS.has(token) && !LABEL_WEAK_TOKENS.has(token),
  );
  const rightTokens = normalizeWordTokens(right).filter(
    (token) => !LABEL_GENERIC_TOKENS.has(token) && !LABEL_WEAK_TOKENS.has(token),
  );

  return computeSetOverlap(leftTokens, rightTokens);
}

function computeKeyEntityOverlap(left: string[], right: string[]) {
  const leftTokens = left.flatMap((value) => normalizeWordTokens(value));
  const rightTokens = right.flatMap((value) => normalizeWordTokens(value));
  return computeSetOverlap(leftTokens, rightTokens);
}

function isProbablyDryNarrative(narrative: NarrativeBoardRow) {
  return (
    narrative.drynessScore >= 60 ||
    narrative.memeArchetype === "tech_drama" ||
    narrative.memeArchetype === "political_meme"
  );
}

function archetypeBonus(memeArchetype: AiNativeNarrativeMemeArchetype) {
  switch (memeArchetype) {
    case "mascot":
      return 8;
    case "visual_absurdity":
      return 7;
    case "catchphrase":
      return 5;
    case "personality":
      return 4;
    case "community_joke":
      return 3;
    case "pop_culture":
      return 2;
    case "tech_drama":
      return -2;
    case "political_meme":
      return -4;
    default:
      return 0;
  }
}

export function computeAiNativeNarrativeQualityScore(narrative: NarrativeBoardRow) {
  const evidenceSupport = Math.min(20, narrative.evidenceCount * 4 + narrative.sourceCount * 2);
  const recencyTimestamp = Date.parse(narrative.lastSeenAt ?? "");
  const recencyHours = Number.isFinite(recencyTimestamp)
    ? Math.max(0, (Date.now() - recencyTimestamp) / 3_600_000)
    : null;
  const recencyBonus =
    recencyHours === null
      ? 0
      : recencyHours <= 6
        ? 9
        : recencyHours <= 24
          ? 6
          : recencyHours <= 72
            ? 3
            : 0;

  return (
    narrative.memeScore * 0.48 +
    narrative.visualScore * 0.2 +
    narrative.confidence * 100 * 0.18 +
    evidenceSupport +
    archetypeBonus(narrative.memeArchetype) +
    recencyBonus -
    narrative.drynessScore * 0.22
  );
}

export function hasAiNativeNarrativeOverlap(
  left: NarrativeBoardRow,
  right: NarrativeBoardRow,
) {
  if (left.canonicalId === right.canonicalId) {
    return true;
  }

  const leftName = normalizeWhitespace(left.canonicalName).toLowerCase();
  const rightName = normalizeWhitespace(right.canonicalName).toLowerCase();
  if (leftName === rightName) {
    return true;
  }

  const candidateOverlap = computeSetOverlap(left.candidateKeys, right.candidateKeys);
  const evidenceOverlap = computeSetOverlap(left.evidenceKeys, right.evidenceKeys);
  const domainOverlap = computeSetOverlap(left.sourceDomains, right.sourceDomains);
  const labelOverlap = computeLabelTokenOverlap(left.canonicalName, right.canonicalName);
  const keyEntityOverlap = computeKeyEntityOverlap(left.keyEntities, right.keyEntities);

  return (
    candidateOverlap >= 0.5 ||
    evidenceOverlap >= 0.34 ||
    (labelOverlap >= 0.6 && domainOverlap >= 0.34) ||
    (labelOverlap >= 0.5 && keyEntityOverlap >= 0.5) ||
    (labelOverlap >= 0.75 && left.memeArchetype === right.memeArchetype)
  );
}

export function curateAiNativeNarrativeBoard<T extends GeneratedAiNativeNarrative>(
  narratives: T[],
  finalNarrativeCount: number,
) {
  const rankedPool = [...narratives]
    .filter((narrative) => narrative.status !== "discarded")
    .sort(
      (left, right) =>
        computeAiNativeNarrativeQualityScore(right) - computeAiNativeNarrativeQualityScore(left) ||
        right.memeScore - left.memeScore ||
        right.visualScore - left.visualScore ||
        left.drynessScore - right.drynessScore ||
        left.rank - right.rank,
    );

  const kept: T[] = [];
  const archetypeCounts = new Map<AiNativeNarrativeMemeArchetype, number>();
  let dryCount = 0;

  while (rankedPool.length > 0 && kept.length < finalNarrativeCount) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const [index, narrative] of rankedPool.entries()) {
      if (kept.some((existing) => hasAiNativeNarrativeOverlap(existing, narrative))) {
        continue;
      }

      const archetypePenalty = (archetypeCounts.get(narrative.memeArchetype) ?? 0) * 10;
      const drynessPenalty =
        isProbablyDryNarrative(narrative) && dryCount >= 2 ? 18 + dryCount * 6 : 0;
      const watchPenalty = narrative.status === "watch" ? 4 : 0;
      const lowVisualPenalty = narrative.visualScore < 55 ? 6 : 0;
      const adjustedScore =
        computeAiNativeNarrativeQualityScore(narrative) -
        archetypePenalty -
        drynessPenalty -
        watchPenalty -
        lowVisualPenalty;

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestIndex = index;
      }
    }

    const [chosen] = rankedPool.splice(bestIndex, 1);
    if (!chosen) {
      break;
    }
    if (kept.some((existing) => hasAiNativeNarrativeOverlap(existing, chosen))) {
      continue;
    }

    kept.push(chosen);
    archetypeCounts.set(
      chosen.memeArchetype,
      (archetypeCounts.get(chosen.memeArchetype) ?? 0) + 1,
    );
    if (isProbablyDryNarrative(chosen)) {
      dryCount += 1;
    }
  }

  const minimumTarget = Math.min(finalNarrativeCount, Math.max(8, Math.min(10, narratives.length)));
  if (kept.length < minimumTarget) {
    for (const narrative of narratives) {
      if (kept.length >= minimumTarget) {
        break;
      }
      if (kept.some((existing) => existing.canonicalId === narrative.canonicalId)) {
        continue;
      }
      if (kept.some((existing) => hasAiNativeNarrativeOverlap(existing, narrative))) {
        continue;
      }
      kept.push(narrative);
    }
  }

  return kept
    .sort(
      (left, right) =>
        computeAiNativeNarrativeQualityScore(right) - computeAiNativeNarrativeQualityScore(left) ||
        right.memeScore - left.memeScore ||
        right.visualScore - left.visualScore ||
        left.drynessScore - right.drynessScore ||
        left.canonicalId.localeCompare(right.canonicalId),
    )
    .slice(0, finalNarrativeCount)
    .map((narrative, index) => ({
      ...narrative,
      rank: index + 1,
    }));
}

export function assembleAiNativeNarrativeBoard<T extends GeneratedAiNativeNarrative>(
  freshNarratives: T[],
  historicalNarratives: T[],
  targetCount: number,
) {
  const board: T[] = [];
  const addUniqueNarratives = (rows: T[]) => {
    for (const narrative of rows) {
      if (board.length >= targetCount) {
        break;
      }
      if (narrative.status === "discarded") {
        continue;
      }
      if (board.some((existing) => hasAiNativeNarrativeOverlap(existing, narrative))) {
        continue;
      }
      board.push({
        ...narrative,
        rank: board.length + 1,
      });
    }
  };

  addUniqueNarratives(
    [...freshNarratives].sort(
      (left, right) => left.rank - right.rank || left.canonicalId.localeCompare(right.canonicalId),
    ),
  );
  const freshCount = board.length;

  addUniqueNarratives(historicalNarratives);

  return {
    narratives: board.map((narrative, index) => ({
      ...narrative,
      rank: index + 1,
    })),
    freshCount,
    backfillCount: Math.max(0, board.length - freshCount),
    historicalRowsConsidered: historicalNarratives.length,
    hasFullTarget: board.length >= targetCount,
  };
}
