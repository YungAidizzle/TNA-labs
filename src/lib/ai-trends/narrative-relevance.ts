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

const SPECIFIC_ENTITY_PHRASES = [
  "openai",
  "chatgpt",
  "sam altman",
  "anthropic",
  "claude",
  "mythos",
  "google",
  "gemini",
  "meta",
  "llama",
  "nvidia",
  "apple",
  "vision pro",
  "tesla",
  "elon musk",
  "musk",
  "xai",
  "grok",
  "bitcoin",
  "btc",
  "ethereum",
  "eth",
  "solana",
  "doge",
  "memecoin",
  "spotify",
  "netflix",
  "taylor",
  "swift",
];

const INTERNET_NATIVE_PHRASES = [
  "creator",
  "creators",
  "influencer",
  "influencers",
  "streamer",
  "streamers",
  "social app",
  "social apps",
  "platform shift",
  "platform changes",
  "viral",
  "meme",
  "backlash",
  "controversy",
  "online attention",
  "fanbase",
  "fandom",
  "podcast",
  "deepfake",
  "media push",
  "content moderation",
];

const INTERNET_PLATFORM_PHRASES = [
  "twitter",
  "x ",
  "x.com",
  "reddit",
  "subreddit",
  "tiktok",
  "youtube",
  "shorts",
  "twitch",
  "telegram",
  "discord",
];

const MEME_CULTURE_PHRASES = [
  "meme",
  "memes",
  "memecoin",
  "memecoins",
  "viral",
  "virality",
  "clip",
  "clips",
  "remix",
  "remixes",
  "template",
  "templates",
  "fancam",
  "fan edit",
  "fan edits",
  "shitpost",
  "shitposts",
  "catchphrase",
  "reaction image",
  "reaction images",
];

const CRYPTO_NATIVE_PHRASES = [
  "crypto",
  "token",
  "tokens",
  "memecoin",
  "memecoins",
  "bitcoin",
  "ethereum",
  "solana",
  "etf",
  "onchain",
  "defi",
];

const SYMBOLIC_EVENT_PHRASES = [
  "leak",
  "preview",
  "launch",
  "ban",
  "outage",
  "probe",
  "lawsuit",
  "boycott",
  "strike",
  "flashpoint",
  "hack",
  "acquisition",
  "slogan",
];

const HARD_NEWS_PHRASES = [
  "geopolitics",
  "geopolitical",
  "ceasefire",
  "tariff",
  "tariffs",
  "escalation",
  "attack",
  "attacks",
  "war",
  "wars",
  "missile",
  "missiles",
  "sanction",
  "sanctions",
  "inflation",
  "interest rate",
  "interest rates",
  "rate cut",
  "rate cuts",
  "rate hike",
  "rate hikes",
  "fed",
  "federal reserve",
  "jerome powell",
  "powell",
  "macro",
  "economy",
  "economic",
  "policy",
  "policies",
  "election",
  "elections",
  "congress",
  "senate",
  "parliament",
  "government",
  "governments",
  "iran",
  "israel",
  "ukraine",
  "russia",
  "china",
];

const GENERIC_ACTOR_PHRASES = [
  "companies",
  "company",
  "governments",
  "government",
  "institutions",
  "institution",
  "enterprises",
  "enterprise",
  "firms",
  "firm",
  "vendors",
  "vendor",
  "providers",
  "provider",
  "banks",
  "bank",
  "regulators",
  "regulator",
  "agencies",
  "agency",
  "boards",
  "investors",
  "schools",
  "universities",
  "retailers",
];

const ROUTINE_PROCESS_PHRASES = [
  "framework",
  "frameworks",
  "governance",
  "compliance",
  "monitor",
  "monitoring",
  "audit",
  "auditing",
  "certification",
  "standards",
  "interoperability",
  "pilot",
  "pilots",
  "initiative",
  "initiatives",
  "program",
  "programs",
  "approval pathways",
  "procurement",
  "transparency",
];

const B2B_INTERNAL_PHRASES = [
  "llmops",
  "toolchains",
  "pricing and packaging",
  "cloud deals",
  "workforce redesign",
  "data governance",
  "data mesh",
  "packaged ai tools",
  "return-to-office",
  "hybrid",
  "upskilling",
  "supply-chain resilience",
  "post-cookie identity",
  "trade finance",
];

const STRUCTURAL_THEME_PHRASES = [
  "resilience",
  "inclusion",
  "reproducibility",
  "open science",
  "long-term",
  "structural",
  "recovery",
  "portability",
  "commercialization",
  "digital transformation",
  "expands affordable access",
  "sustainability",
  "supplier audits",
];

const GENERIC_INTERNET_FILLER_PHRASES = [
  "meme culture",
  "viral hits",
  "viral clips",
  "viral plays",
  "template memes",
  "rediscovery cycles",
  "niche obsessions",
  "creator economics",
  "local trends",
  "callouts",
  "wins",
  "moments",
  "hot-take",
  "formats",
  "culture rediscovery",
  "trend virality",
];

const GENERIC_TITLE_TOKENS = new Set([
  "accelerates",
  "adapts",
  "advance",
  "advances",
  "adoption",
  "banks",
  "businesses",
  "companies",
  "debates",
  "demands",
  "drives",
  "firms",
  "frameworks",
  "governments",
  "initiatives",
  "institutions",
  "invest",
  "investment",
  "investments",
  "makers",
  "monitor",
  "pilots",
  "platforms",
  "policies",
  "providers",
  "push",
  "regulators",
  "reshape",
  "services",
  "strategies",
  "tools",
  "vendors",
]);

const CATEGORY_WEIGHTS: Record<string, number> = {
  ai: 5,
  business: -6,
  culture: 6,
  crypto: 10,
  entertainment: 3,
  finance: -8,
  health: -8,
  internet: 8,
  legal: -7,
  markets: -4,
  politics: -8,
  science: -10,
  sports: 0,
  tech: 1,
  world: -10,
};

const OFFLINE_NEWS_CATEGORIES = new Set(["business", "finance", "markets", "politics", "world"]);

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

function tokenize(value: string) {
  return normalizeWhitespace(value)
    .split(" ")
    .map((token) => token.replace(/^[^a-z0-9$#]+|[^a-z0-9$#]+$/gi, "").toLowerCase())
    .filter(Boolean);
}

function countPhraseMatches(text: string, phrases: readonly string[]) {
  return phrases.reduce((count, phrase) => (text.includes(phrase) ? count + 1 : count), 0);
}

function titleSpecificityBonus(title: string) {
  const tokens = tokenize(title);
  const informative = tokens.filter((token) => !GENERIC_TITLE_TOKENS.has(token));
  if (tokens.length >= 3 && tokens.length <= 6 && informative.length >= 3) {
    return 8;
  }
  if (informative.length >= 2) {
    return 4;
  }
  return 0;
}

function hasSpecificEntitySignal(text: string) {
  return countPhraseMatches(text, SPECIFIC_ENTITY_PHRASES) > 0;
}

function buildAssessment(candidate: GeneratedAiTrendCandidate): InternalAiTrendNarrativeRelevanceAssessment {
  const title = normalizeWhitespace(candidate.title);
  const summary = normalizeWhitespace(candidate.summary);
  const importanceNote = normalizeWhitespace(candidate.importanceNote);
  const combined = normalizeLower([title, summary, importanceNote, candidate.trendKey].join(" "));
  const category = normalizeLower(candidate.category);
  const reasons: string[] = [];

  let score = 26;
  score += CATEGORY_WEIGHTS[category] ?? 0;

  const entityMatches = countPhraseMatches(combined, SPECIFIC_ENTITY_PHRASES);
  const hasEntitySignal = entityMatches > 0;
  if (entityMatches > 0) {
    score += 10 + Math.min(4, entityMatches * 2);
    reasons.push("specific_named_entity");
  }

  const internetMatches = countPhraseMatches(combined, INTERNET_NATIVE_PHRASES);
  const platformMatches = countPhraseMatches(combined, INTERNET_PLATFORM_PHRASES);
  const memeCultureMatches = countPhraseMatches(combined, MEME_CULTURE_PHRASES);
  const hasPlatformSignal = platformMatches > 0;
  const hasMemeCultureSignal = memeCultureMatches > 0;
  const hasInternetNativeContext = internetMatches > 0 || hasPlatformSignal || hasMemeCultureSignal;
  if (internetMatches > 0) {
    score += 6 + Math.min(3, internetMatches * 2);
    reasons.push("internet_native_hook");
  }
  if (platformMatches > 0) {
    score += 8 + Math.min(4, platformMatches * 2);
    reasons.push("platform_distribution_hook");
  }
  if (memeCultureMatches > 0) {
    score += 10 + Math.min(4, memeCultureMatches * 2);
    reasons.push("meme_culture_hook");
  }

  const cryptoMatches = countPhraseMatches(combined, CRYPTO_NATIVE_PHRASES);
  const hasCryptoSignal = cryptoMatches > 0;
  if (cryptoMatches > 0) {
    score += 10 + Math.min(4, cryptoMatches * 2);
    reasons.push("crypto_native_hook");
  }

  const symbolicMatches = countPhraseMatches(combined, SYMBOLIC_EVENT_PHRASES);
  const hasSymbolicSignal = symbolicMatches > 0;
  if (symbolicMatches > 0) {
    score += 7 + Math.min(3, symbolicMatches * 2);
    reasons.push("symbolic_flashpoint");
  }

  score += titleSpecificityBonus(title);

  const hardNewsMatches = countPhraseMatches(combined, HARD_NEWS_PHRASES);
  if (hardNewsMatches > 0 && !hasInternetNativeContext && !hasCryptoSignal) {
    score -= 16 + Math.min(8, hardNewsMatches * 2);
    reasons.push("hard_news_penalty");
  }
  if (OFFLINE_NEWS_CATEGORIES.has(category) && !hasInternetNativeContext && !hasCryptoSignal) {
    score -= 12;
    reasons.push("offline_news_category_penalty");
  }

  const genericActorMatches = countPhraseMatches(combined, GENERIC_ACTOR_PHRASES);
  if (genericActorMatches > 0 && !hasSpecificEntitySignal(combined)) {
    score -= 14 + Math.min(6, genericActorMatches * 2);
    reasons.push("generic_actor_penalty");
  }

  const routineProcessMatches = countPhraseMatches(combined, ROUTINE_PROCESS_PHRASES);
  if (routineProcessMatches > 0) {
    score -= 10 + Math.min(5, routineProcessMatches * 2);
    reasons.push("routine_process_penalty");
  }

  const b2bMatches = countPhraseMatches(combined, B2B_INTERNAL_PHRASES);
  if (b2bMatches > 0) {
    score -= 9 + Math.min(5, b2bMatches * 2);
    reasons.push("b2b_internal_penalty");
  }

  const structuralMatches = countPhraseMatches(combined, STRUCTURAL_THEME_PHRASES);
  if (structuralMatches > 0) {
    score -= 9 + Math.min(5, structuralMatches * 2);
    reasons.push("structural_theme_penalty");
  }

  const genericInternetFillerMatches = countPhraseMatches(combined, GENERIC_INTERNET_FILLER_PHRASES);
  if (genericInternetFillerMatches > 0 && !hasEntitySignal && !hasCryptoSignal) {
    score -= 10 + Math.min(5, genericInternetFillerMatches * 2);
    reasons.push("generic_internet_filler_penalty");
  }

  if (!hasInternetNativeContext && !hasCryptoSignal) {
    score -= 14;
    reasons.push("missing_internet_native_distribution_penalty");
  }

  if (!hasEntitySignal && !hasCryptoSignal && !hasSymbolicSignal) {
    score -= 12;
    reasons.push("no_concrete_narrative_object_penalty");
  }

  if ((candidate.sourceCount ?? 0) < 15 && !hasEntitySignal && !hasCryptoSignal) {
    score -= 7;
    reasons.push("weak_current_evidence_penalty");
  }

  if ((candidate.sourceScope ?? "").toLowerCase() === "niche" && hasInternetNativeContext) {
    score += 4;
    reasons.push("niche_attention_bonus");
  }

  const finalScore = clamp(score, 0, 100);
  const highEligible =
    hasCryptoSignal ||
    (hasInternetNativeContext && (hasEntitySignal || hasSymbolicSignal || hasMemeCultureSignal));
  const mediumEligible =
    highEligible ||
    hasCryptoSignal ||
    hasInternetNativeContext ||
    (hasMemeCultureSignal && (hasEntitySignal || hasSymbolicSignal));
  const band: AiTrendNarrativeRelevanceBand =
    finalScore >= 62 && highEligible ? "high" : finalScore >= 40 && mediumEligible ? "medium" : "low";

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
  const minHighCount = totalCount >= 100 ? 35 : Math.max(1, Math.round(totalCount * 0.3));
  const maxHighCount = totalCount >= 100 ? 45 : Math.max(minHighCount, Math.round(totalCount * 0.5));
  const minMediumCount = totalCount >= 100 ? 35 : Math.max(0, Math.round(totalCount * 0.2));
  const maxLowCount = totalCount >= 100 ? 20 : Math.ceil(totalCount * 0.2);

  if (distribution.highCount < minHighCount) {
    return `high relevance count too low (${distribution.highCount}/100)`;
  }
  if (distribution.highCount > maxHighCount) {
    return `high relevance count too high (${distribution.highCount}/100)`;
  }
  if (distribution.mediumCount < minMediumCount) {
    return `medium relevance count too low (${distribution.mediumCount}/100)`;
  }
  if (distribution.lowCount > maxLowCount) {
    return `low relevance count too high (${distribution.lowCount}/100)`;
  }
  if (distribution.highCount + distribution.mediumCount < totalCount - maxLowCount) {
    return `combined high+medium relevance count too low (${distribution.highCount + distribution.mediumCount}/100)`;
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
  const maxLowCount = totalCount >= 100 ? 20 : Math.ceil(totalCount * 0.2);
  const desiredHighMin = totalCount >= 100 ? 35 : Math.max(1, Math.round(totalCount * 0.3));
  const desiredHighMax = totalCount >= 100 ? 45 : Math.max(desiredHighMin, Math.round(totalCount * 0.5));
  const desiredMediumMin = totalCount >= 100 ? 35 : Math.max(0, totalCount - desiredHighMin - maxLowCount);
  const desiredMediumMax = totalCount >= 100 ? 45 : Math.max(desiredMediumMin, totalCount - desiredHighMin);
  const highFloor = 48;
  const mediumFloor = 28;

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
    .filter(({ assessment, index }) => {
      return assignedBands[index] === "low" && assessment.mediumEligible && assessment.score >= mediumFloor;
    })
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
        assessment.score * 0.55 + trend.aiRankScore * 0.3 + trend.confidenceScore * 0.1 + (100 - index) * 0.05,
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
