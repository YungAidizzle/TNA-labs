import "server-only";

const DEFAULT_MODEL_NAME =
  process.env.AI_NATIVE_NARRATIVE_MODEL?.trim() ||
  process.env.AI_TREND_MODEL?.trim() ||
  process.env.OPENAI_TREND_MODEL?.trim() ||
  "gpt-5-mini";
const DEFAULT_PROMPT_VERSION = "ai-native-canonical-narratives-memecoin-v2";

function readBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function readIntegerEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function getAiNativeNarrativeConfig() {
  return {
    enabled: readBooleanEnv("ENABLE_AI_NATIVE_NARRATIVES", true),
    refreshIntervalSeconds: readIntegerEnv(
      "AI_NATIVE_NARRATIVE_REFRESH_INTERVAL_SECONDS",
      3600,
      300,
      86_400,
    ),
    freshnessWindowMinutes: readIntegerEnv(
      "AI_NATIVE_NARRATIVE_FRESHNESS_MINUTES",
      180,
      15,
      10_080,
    ),
    discoveryCandidateCount: readIntegerEnv(
      "AI_NATIVE_NARRATIVE_DISCOVERY_CANDIDATES",
      18,
      8,
      30,
    ),
    finalNarrativeCount: readIntegerEnv(
      "AI_NATIVE_NARRATIVE_FINAL_COUNT",
      12,
      6,
      24,
    ),
    maxEvidencePerCandidate: readIntegerEnv(
      "AI_NATIVE_NARRATIVE_EVIDENCE_PER_CANDIDATE",
      4,
      2,
      6,
    ),
    modelName: DEFAULT_MODEL_NAME,
    promptVersion: process.env.AI_NATIVE_NARRATIVE_PROMPT_VERSION?.trim() || DEFAULT_PROMPT_VERSION,
    searchContextSize:
      process.env.AI_NATIVE_NARRATIVE_WEB_SEARCH_CONTEXT_SIZE?.trim().toLowerCase() === "low"
        ? "low"
        : process.env.AI_NATIVE_NARRATIVE_WEB_SEARCH_CONTEXT_SIZE?.trim().toLowerCase() === "high"
          ? "high"
          : "medium",
    searchCountry: process.env.AI_NATIVE_NARRATIVE_SEARCH_COUNTRY?.trim().toUpperCase() || "US",
    searchRegion: process.env.AI_NATIVE_NARRATIVE_SEARCH_REGION?.trim() || null,
    searchCity: process.env.AI_NATIVE_NARRATIVE_SEARCH_CITY?.trim() || null,
    searchTimezone: process.env.AI_NATIVE_NARRATIVE_SEARCH_TIMEZONE?.trim() || "UTC",
    cronSecret: process.env.CRON_SECRET?.trim() || "",
    openAiApiKey: process.env.OPENAI_API_KEY?.trim() || "",
  } as const;
}
