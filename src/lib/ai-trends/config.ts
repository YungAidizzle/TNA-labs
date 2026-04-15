import "server-only";

const DEFAULT_TREND_COUNT = 100;
const DEFAULT_REFRESH_INTERVAL_SECONDS = 3600;
const DEFAULT_MODEL_NAME =
  process.env.AI_TREND_MODEL?.trim() ||
  process.env.OPENAI_TREND_MODEL?.trim() ||
  "gpt-5-mini";
const DEFAULT_PROMPT_VERSION = "shared-ai-trends-v4-memecoin-attention";

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

export function getAiTrendConfig() {
  return {
    enabled: readBooleanEnv("ENABLE_SHARED_AI_TRENDS", true),
    trendCount: readIntegerEnv("AI_TREND_COUNT", DEFAULT_TREND_COUNT, DEFAULT_TREND_COUNT, DEFAULT_TREND_COUNT),
    refreshIntervalSeconds: readIntegerEnv(
      "AI_TREND_REFRESH_INTERVAL_SECONDS",
      DEFAULT_REFRESH_INTERVAL_SECONDS,
      300,
      86_400,
    ),
    useWebSearch: readBooleanEnv("AI_TREND_USE_WEB_SEARCH", true),
    storeRawResponse: readBooleanEnv("AI_TREND_STORE_RAW_RESPONSE", false),
    modelName: process.env.AI_TREND_MODEL?.trim() || DEFAULT_MODEL_NAME,
    promptVersion: process.env.AI_TREND_PROMPT_VERSION?.trim() || DEFAULT_PROMPT_VERSION,
    searchContextSize:
      process.env.AI_TREND_WEB_SEARCH_CONTEXT_SIZE?.trim().toLowerCase() === "low"
        ? "low"
        : process.env.AI_TREND_WEB_SEARCH_CONTEXT_SIZE?.trim().toLowerCase() === "high"
          ? "high"
          : "medium",
    searchCountry: process.env.AI_TREND_SEARCH_COUNTRY?.trim().toUpperCase() || "US",
    searchRegion: process.env.AI_TREND_SEARCH_REGION?.trim() || null,
    searchCity: process.env.AI_TREND_SEARCH_CITY?.trim() || null,
    searchTimezone: process.env.AI_TREND_SEARCH_TIMEZONE?.trim() || "UTC",
    cronSecret: process.env.CRON_SECRET?.trim() || "",
  } as const;
}
