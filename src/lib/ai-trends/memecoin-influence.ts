import type { GeneratedAiTrendCandidate } from "./types";

type PhraseGroupMap = Record<string, readonly string[]>;

export type MemecoinInfluenceProfile = {
  score: number;
  preferredHits: Record<string, number>;
  deprioritizedHits: Record<string, number>;
  dominantPreferredBucket: string | null;
  memecoinReady: boolean;
  memeifiedPolitics: boolean;
  tokenizableNarrative: boolean;
  rankingSignals: string[];
};

const MEMECOIN_CATEGORY_WEIGHTS: Record<string, number> = {
  "ai meme wave": 14,
  "animal meme": 18,
  "catchphrase wave": 16,
  "celebrity meme": 12,
  creator: 10,
  "creator viral moment": 15,
  culture: 8,
  entertainment: 6,
  "fandom wave": 14,
  gaming: 8,
  "gaming meme": 14,
  internet: 9,
  "internet culture": 12,
  "memeified politics": 8,
  "platform drama": 14,
  "crypto spillover": 14,
  crypto: 6,
  politics: -12,
  world: -14,
  macro: -12,
  finance: -10,
  markets: -8,
  business: -10,
  legal: -8,
  news: -7,
  tech: 2,
};

const MEMECOIN_PREFERRED_PHRASES: PhraseGroupMap = {
  animal_meme: [
    "animal",
    "cat",
    "cats",
    "dog",
    "dogs",
    "doge",
    "frog",
    "frogs",
    "hippo",
    "penguin",
    "mascot",
    "character",
    "creature",
    "pom",
    "pomeranian",
    "shiba",
    "pepe",
    "mog",
    "wojak",
  ],
  catchphrase: [
    "catchphrase",
    "slogan",
    "nickname",
    "tagline",
    "quote",
    "one-liner",
    "copypasta",
    "chant",
    "rallying cry",
    "soundbite",
  ],
  creator_moment: [
    "creator",
    "creators",
    "influencer",
    "influencers",
    "streamer",
    "streamers",
    "youtuber",
    "tiktoker",
    "vtuber",
    "fanbase",
    "fandom",
    "podcast",
    "livestream",
    "clip farm",
  ],
  celebrity_meme: [
    "celebrity",
    "actor",
    "actress",
    "musician",
    "rapper",
    "singer",
    "athlete",
    "superstar",
    "swiftie",
    "stan",
  ],
  platform_drama: [
    "twitter",
    "x.com",
    "reddit",
    "subreddit",
    "tiktok",
    "youtube",
    "telegram",
    "discord",
    "twitch",
    "verification",
    "algorithm",
    "moderation",
    "platform backlash",
    "platform debate",
    "outage",
  ],
  ai_meme: [
    "ai companion",
    "ai girlfriend",
    "ai boyfriend",
    "deepfake",
    "parody edit",
    "image model",
    "video model",
    "ai agent",
    "agents",
    "grok",
    "chatgpt",
    "claude",
    "gemini",
    "avatar",
    "companion",
  ],
  fandom_wave: [
    "anime",
    "manga",
    "fan edit",
    "fan edits",
    "fancam",
    "fan art",
    "fandom",
    "shipping",
    "stan war",
    "k-pop",
    "cosplay",
    "roblox",
    "fortnite",
    "pokemon",
    "nintendo",
    "steam",
  ],
  crypto_spillover: [
    "memecoin",
    "memecoins",
    "meme coin",
    "solana meme",
    "base meme",
    "launchpad",
    "pump.fun",
    "letsbonk",
    "cto",
    "community takeover",
    "etf inflows",
    "spot bitcoin etf",
    "token launch",
    "listing",
    "retail speculation",
    "onchain speculation",
    "rotation",
  ],
  meme_distribution: [
    "viral",
    "meme",
    "memes",
    "remix",
    "remixes",
    "parody",
    "parodies",
    "edit",
    "edits",
    "clip",
    "clips",
    "shitpost",
    "shitposts",
    "reaction image",
    "reaction images",
    "reposts",
    "timeline",
    "brainrot",
    "quote tweet",
  ],
  tokenizable_object: [
    "mascot",
    "character",
    "companion",
    "avatar",
    "nickname",
    "catchphrase",
    "slogan",
    "clip",
    "deepfake",
    "parody",
    "frog",
    "dog",
    "cat",
    "hippo",
  ],
  memeified_politics: [
    "mugshot",
    "debate clip",
    "rally clip",
    "slogan meme",
    "campaign meme",
    "parody ad",
    "quote tweet war",
  ],
};

const MEMECOIN_DEPRIORITIZED_PHRASES: PhraseGroupMap = {
  geopolitics_macro: [
    "ceasefire",
    "tariff",
    "tariffs",
    "inflation",
    "interest rates",
    "rate cut",
    "rate hike",
    "federal reserve",
    "senate",
    "parliament",
    "sanction",
    "sanctions",
    "missile",
    "missiles",
    "war",
    "wars",
  ],
  dry_business: [
    "enterprise",
    "enterprises",
    "earnings",
    "board meeting",
    "procurement",
    "partnership framework",
    "pricing update",
    "api pricing",
    "internal rollout",
    "b2b",
    "quarterly",
  ],
  dry_crypto: [
    "committee hearing",
    "compliance",
    "governance",
    "validator update",
    "consensus upgrade",
    "infrastructure release",
    "audit",
    "framework",
    "interoperability",
  ],
  hard_news: [
    "attack",
    "attacks",
    "earthquake",
    "wildfire",
    "evacuation",
    "fatalities",
    "police",
    "court filing",
    "indictment",
  ],
  generic_noise: [
    "internet debate",
    "creator drama",
    "celebrity drama",
    "platform update",
    "policy development",
    "market update",
    "trend update",
    "news update",
  ],
};

const TITLE_GENERIC_TOKENS = new Set([
  "attention",
  "board",
  "culture",
  "debate",
  "discussion",
  "internet",
  "narrative",
  "news",
  "online",
  "speculation",
  "story",
  "trend",
  "trends",
  "update",
  "updates",
  "viral",
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

function tokenize(value: string) {
  return normalizeWhitespace(value)
    .split(" ")
    .map((token) => token.replace(/^[^a-z0-9$#]+|[^a-z0-9$#]+$/gi, "").toLowerCase())
    .filter(Boolean);
}

function countPhraseMatches(text: string, phrases: readonly string[]) {
  return phrases.reduce((count, phrase) => (text.includes(phrase) ? count + 1 : count), 0);
}

function normalizeCategory(category: string | null | undefined) {
  return normalizeLower(category);
}

function titleSpecificityBonus(title: string) {
  const tokens = tokenize(title);
  const informativeTokens = tokens.filter((token) => !TITLE_GENERIC_TOKENS.has(token));
  if (tokens.length >= 5 && tokens.length <= 12 && informativeTokens.length >= 4) {
    return 12;
  }
  if (tokens.length >= 4 && informativeTokens.length >= 3) {
    return 7;
  }
  if (informativeTokens.length >= 3) {
    return 3;
  }
  return 0;
}

export function assessMemecoinInfluence(
  candidate: Pick<
    GeneratedAiTrendCandidate,
    "title" | "summary" | "importanceNote" | "trendKey" | "category" | "sourceCount"
  >,
): MemecoinInfluenceProfile {
  const title = normalizeWhitespace(candidate.title);
  const combined = normalizeLower([title, candidate.summary, candidate.importanceNote, candidate.trendKey].join(" "));
  const category = normalizeCategory(candidate.category);
  const preferredHits = Object.fromEntries(
    Object.entries(MEMECOIN_PREFERRED_PHRASES).map(([bucket, phrases]) => [bucket, countPhraseMatches(combined, phrases)]),
  ) as Record<string, number>;
  const deprioritizedHits = Object.fromEntries(
    Object.entries(MEMECOIN_DEPRIORITIZED_PHRASES).map(([bucket, phrases]) => [bucket, countPhraseMatches(combined, phrases)]),
  ) as Record<string, number>;

  const dominantPreferredEntry = Object.entries(preferredHits).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0];
  const dominantPreferredBucket = dominantPreferredEntry && dominantPreferredEntry[1] > 0 ? dominantPreferredEntry[0] : null;

  const memeDistributionHits = preferredHits.meme_distribution ?? 0;
  const creatorHits = preferredHits.creator_moment ?? 0;
  const aiHits = preferredHits.ai_meme ?? 0;
  const animalHits = preferredHits.animal_meme ?? 0;
  const platformHits = preferredHits.platform_drama ?? 0;
  const fandomHits = preferredHits.fandom_wave ?? 0;
  const cryptoSpilloverHits = preferredHits.crypto_spillover ?? 0;
  const tokenizableHits = preferredHits.tokenizable_object ?? 0;
  const catchphraseHits = preferredHits.catchphrase ?? 0;
  const memeifiedPoliticsHits = preferredHits.memeified_politics ?? 0;
  const negativeHits = Object.values(deprioritizedHits).reduce((sum, value) => sum + value, 0);

  const tokenizableNarrative =
    tokenizableHits > 0 ||
    animalHits > 0 ||
    catchphraseHits > 0 ||
    creatorHits > 0 ||
    aiHits > 0 ||
    fandomHits > 0 ||
    cryptoSpilloverHits > 0;

  const memeifiedPolitics =
    memeifiedPoliticsHits > 0 || (deprioritizedHits.geopolitics_macro ?? 0) > 0 && memeDistributionHits > 0;

  let score = 18;
  score += MEMECOIN_CATEGORY_WEIGHTS[category] ?? 0;
  score += animalHits * 8;
  score += catchphraseHits * 7;
  score += creatorHits * 6;
  score += platformHits * 6;
  score += aiHits * 7;
  score += fandomHits * 6;
  score += cryptoSpilloverHits * 7;
  score += memeDistributionHits * 6;
  score += tokenizableHits * 6;
  score += preferredHits.celebrity_meme ? preferredHits.celebrity_meme * 5 : 0;
  score += titleSpecificityBonus(title);

  if (tokenizableNarrative) {
    score += 10;
  } else {
    score -= 14;
  }

  if (memeDistributionHits <= 0 && cryptoSpilloverHits <= 0) {
    score -= 10;
  }

  if ((deprioritizedHits.geopolitics_macro ?? 0) > 0 && !memeifiedPolitics && memeDistributionHits <= 0) {
    score -= 18;
  }
  score -= (deprioritizedHits.dry_business ?? 0) * 10;
  score -= (deprioritizedHits.dry_crypto ?? 0) * 8;
  score -= (deprioritizedHits.hard_news ?? 0) * 12;
  score -= (deprioritizedHits.generic_noise ?? 0) * 9;

  if ((candidate.sourceCount ?? 0) < 10 && memeDistributionHits <= 0 && cryptoSpilloverHits <= 0) {
    score -= 6;
  }

  const rankingSignals = [
    animalHits > 0 ? "animal_or_character_hook" : null,
    catchphraseHits > 0 ? "catchphrase_or_nickname_hook" : null,
    creatorHits > 0 ? "creator_or_influencer_hook" : null,
    platformHits > 0 ? "platform_distribution_hook" : null,
    aiHits > 0 ? "ai_meme_hook" : null,
    fandomHits > 0 ? "fandom_or_gaming_hook" : null,
    cryptoSpilloverHits > 0 ? "crypto_spillover_hook" : null,
    memeDistributionHits > 0 ? "meme_distribution_hook" : null,
    tokenizableNarrative ? "tokenizable_object_hook" : null,
    memeifiedPolitics ? "memeified_political_hook" : null,
    negativeHits > 0 ? "generic_news_penalty" : null,
  ].filter((value): value is string => Boolean(value));

  return {
    score: clamp(score, 0, 100),
    preferredHits,
    deprioritizedHits,
    dominantPreferredBucket,
    memecoinReady:
      tokenizableNarrative && (memeDistributionHits > 0 || cryptoSpilloverHits > 0 || creatorHits > 0 || aiHits > 0),
    memeifiedPolitics,
    tokenizableNarrative,
    rankingSignals,
  };
}
