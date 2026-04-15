const TITLE_GENERIC_TOKENS = new Set([
  "attention",
  "analysis",
  "board",
  "breaking",
  "coverage",
  "debate",
  "debates",
  "dashboard",
  "discussion",
  "discourse",
  "headline",
  "headlines",
  "internet",
  "latest",
  "media",
  "narrative",
  "narratives",
  "news",
  "online",
  "speculation",
  "story",
  "stories",
  "today",
  "topic",
  "topics",
  "trend",
  "trends",
  "update",
  "updates",
  "viral",
]);

const DISALLOWED_TITLE_PUNCTUATION = /[:;?!]|\.{2,}|…|["“”]/;
const HEADLINE_STYLE_MARKERS = /\b(analysts|because|breaking|explainer|how|latest|report|reports|says|watch|why)\b/i;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function tokenizeTitle(value: string) {
  return normalizeWhitespace(value)
    .split(" ")
    .map((token) => token.replace(/^[^a-z0-9$#]+|[^a-z0-9$#]+$/gi, "").toLowerCase())
    .filter(Boolean);
}

export type AiTrendTitleValidationResult = {
  normalizedTitle: string;
  wordCount: number;
  informativeWordCount: number;
  errors: string[];
};

export function validateAiTrendCanonicalTitle(value: string): AiTrendTitleValidationResult {
  const normalizedTitle = normalizeWhitespace(value);
  const tokens = tokenizeTitle(normalizedTitle);
  const informativeTokens = tokens.filter((token) => !TITLE_GENERIC_TOKENS.has(token));
  const errors: string[] = [];

  if (!normalizedTitle) {
    errors.push("title is empty");
  }
  if (tokens.length < 4) {
    errors.push("title must contain at least 4 words");
  }
  if (tokens.length > 14) {
    errors.push("title must be 14 words or fewer");
  }
  if (normalizedTitle.length > 140) {
    errors.push("title exceeds 140 characters");
  }
  if (DISALLOWED_TITLE_PUNCTUATION.test(normalizedTitle)) {
    errors.push("title uses headline punctuation or quotes");
  }
  if (HEADLINE_STYLE_MARKERS.test(normalizedTitle)) {
    errors.push("title reads like a headline instead of a narrative label");
  }
  if (informativeTokens.length < 3) {
    errors.push("title is too generic");
  }

  return {
    normalizedTitle,
    wordCount: tokens.length,
    informativeWordCount: informativeTokens.length,
    errors,
  };
}

export function assertAiTrendCanonicalTitle(value: string, index: number) {
  const result = validateAiTrendCanonicalTitle(value);
  if (result.errors.length > 0) {
    throw new Error(
      `Model trend ${index + 1} has an invalid canonical title "${result.normalizedTitle}": ${result.errors.join("; ")}.`,
    );
  }

  return result.normalizedTitle;
}
