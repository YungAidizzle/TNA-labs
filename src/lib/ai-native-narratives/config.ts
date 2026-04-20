import "server-only";
import { AI_NATIVE_NARRATIVE_CRON_SECRET_NAMES } from "@/lib/ai-native-narratives/scheduler";

const AI_NATIVE_NARRATIVE_BOARD_TARGET = 100;
const DEFAULT_MODEL_NAME =
  process.env.AI_NATIVE_NARRATIVE_MODEL?.trim() ||
  process.env.AI_TREND_MODEL?.trim() ||
  process.env.OPENAI_TREND_MODEL?.trim() ||
  "gpt-5-mini";
const DEFAULT_PROMPT_VERSION = "ai-native-canonical-narratives-memecoin-v4-board100";

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
  const configuredCronSecrets = AI_NATIVE_NARRATIVE_CRON_SECRET_NAMES.flatMap((name) => {
    const value = process.env[name]?.trim();
    return value ? [{ name, value }] : [];
  }).filter(
    (entry, index, entries) =>
      entries.findIndex((candidate) => candidate.value === entry.value) === index,
  );

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
    discoveryBatchCount: readIntegerEnv(
      "AI_NATIVE_NARRATIVE_DISCOVERY_BATCHES",
      4,
      1,
      8,
    ),
    discoveryCandidateCount: readIntegerEnv(
      "AI_NATIVE_NARRATIVE_DISCOVERY_CANDIDATES",
      240,
      AI_NATIVE_NARRATIVE_BOARD_TARGET,
      480,
    ),
    selectionCandidateCount: readIntegerEnv(
      "AI_NATIVE_NARRATIVE_SELECTION_CANDIDATES",
      140,
      AI_NATIVE_NARRATIVE_BOARD_TARGET,
      320,
    ),
    finalNarrativeCount: readIntegerEnv(
      "AI_NATIVE_NARRATIVE_FINAL_COUNT",
      AI_NATIVE_NARRATIVE_BOARD_TARGET,
      AI_NATIVE_NARRATIVE_BOARD_TARGET,
      200,
    ),
    maxEvidencePerCandidate: readIntegerEnv(
      "AI_NATIVE_NARRATIVE_EVIDENCE_PER_CANDIDATE",
      3,
      2,
      4,
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
    cronSecret: configuredCronSecrets[0]?.value ?? "",
    cronSecrets: configuredCronSecrets.map((entry) => entry.value),
    cronSecretNames: configuredCronSecrets.map((entry) => entry.name),
    openAiApiKey: process.env.OPENAI_API_KEY?.trim() || "",
  } as const;
}
