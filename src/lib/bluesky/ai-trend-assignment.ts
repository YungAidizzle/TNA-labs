import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import OpenAI from "openai";

export type BlueskyAiRootInput = {
  rootId: string;
  authorId: string | null;
  authorHandle: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  totalInteractions24h: number;
  rootText: string;
  evidenceText: string;
  urlLabels: string[];
  entityLabels: string[];
  phraseLabels: string[];
  hashtagLabels: string[];
};

export type BlueskyAiRootInterpretation = {
  rootId: string;
  summaryTopic: string;
  candidateLabel: string;
  shortDescription: string;
  entities: string[];
  canonicalKeywords: string[];
  contentType:
    | "news"
    | "opinion"
    | "meme"
    | "personal_update"
    | "promotion"
    | "spam"
    | "greeting_status"
    | "fandom"
    | "art_post"
    | "bot_like"
    | "other";
  trendCategory:
    | "politics"
    | "business"
    | "technology"
    | "culture"
    | "sports"
    | "fandom"
    | "personal_updates"
    | "greeting_status"
    | "spam_promo"
    | "meme"
    | "news"
    | "other";
  language: string;
  isTemplateLike: boolean;
  isLowInformation: boolean;
  spamLikelihood: number;
  templateLikelihood: number;
  contextualCoherence: number;
  semanticKey: string;
  secondaryKeys: string[];
};

export type BlueskyAiGroupingRunMode = "incremental_live" | "manual_full_regroup";

export type BlueskyAiGroupingOptions = {
  mode?: BlueskyAiGroupingRunMode;
  ignoreCache?: boolean;
  requireFullCoverage?: boolean;
  batchSize?: number;
  requestTimeoutMs?: number;
  totalBudgetMs?: number | null;
  maxBatchFailures?: number;
};

export type BlueskyAiGroupingDiagnostics = {
  mode: BlueskyAiGroupingRunMode;
  requestedRootCount: number;
  eligibleRootCount: number;
  processedRootCount: number;
  processedFreshRootCount: number;
  cacheHitCount: number;
  freshCallCount: number;
  batchCount: number;
  batchFailureCount: number;
  failedRootCount: number;
  attempted: boolean;
  clientInitialized: boolean;
  incomplete: boolean;
  incompleteReason: string | null;
  model: string | null;
  credentialSource: string | null;
  credentialFingerprint: string | null;
  ignoreCache: boolean;
  requestTimeoutMs: number;
  totalBudgetMs: number | null;
  startedAt: string;
  completedAt: string | null;
  lastSuccessfulFullRegroupAt: string | null;
};

export type BlueskyAiGroupingResult = {
  interpretations: Map<string, BlueskyAiRootInterpretation>;
  diagnostics: BlueskyAiGroupingDiagnostics;
};

type BlueskyAiInterpretationCacheEntry = {
  signature: string;
  model: string;
  updatedAt: string;
  interpretation: BlueskyAiRootInterpretation;
};

type BlueskyAiInterpretationCacheFile = {
  version: number;
  entries: Record<string, BlueskyAiInterpretationCacheEntry>;
};

type BlueskyAiGroupingRunStateFile = {
  version: number;
  lastRun: BlueskyAiGroupingDiagnostics | null;
  lastSuccessfulFullRegroupAt: string | null;
};

const DEFAULT_INCREMENTAL_MODEL =
  process.env.OPENAI_TREND_GROUPING_MODEL ||
  process.env.OPENAI_TREND_MODEL ||
  "gpt-4.1-mini";
const DEFAULT_MANUAL_MODEL =
  process.env.OPENAI_TREND_GROUPING_MANUAL_MODEL || "gpt-4.1";
const CACHE_VERSION = 2;
const RUN_STATE_VERSION = 1;
const CACHE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_engine",
  "bluesky_ai_root_interpretations.json",
);
const RUN_STATE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_engine",
  "bluesky_ai_grouping_run_state.json",
);
const DEFAULT_INCREMENTAL_BATCH_SIZE = 16;
const DEFAULT_MANUAL_BATCH_SIZE = 120;
const DEFAULT_INCREMENTAL_MAX_PROMPT_CHARS = 24_000;
const DEFAULT_MANUAL_MAX_PROMPT_CHARS = 120_000;
const DEFAULT_INCREMENTAL_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MANUAL_REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_INCREMENTAL_TOTAL_BUDGET_MS = 10 * 60_000;
const DEFAULT_INCREMENTAL_MAX_BATCH_FAILURES = 3;
const DEFAULT_MANUAL_MAX_BATCH_FAILURES = 10_000;
const DEFAULT_INCREMENTAL_CONCURRENCY = 1;
const DEFAULT_MANUAL_CONCURRENCY = 4;
const DEFAULT_REQUEST_RETRIES = 2;
const MAX_BATCH_SPLIT_DEPTH = 8;

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    roots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          rootId: { type: "string" },
          summaryTopic: { type: "string" },
          candidateLabel: { type: "string" },
          shortDescription: { type: "string" },
          entities: { type: "array", items: { type: "string" } },
          canonicalKeywords: { type: "array", items: { type: "string" } },
          contentType: {
            type: "string",
            enum: [
              "news",
              "opinion",
              "meme",
              "personal_update",
              "promotion",
              "spam",
              "greeting_status",
              "fandom",
              "art_post",
              "bot_like",
              "other",
            ],
          },
          trendCategory: {
            type: "string",
            enum: [
              "politics",
              "business",
              "technology",
              "culture",
              "sports",
              "fandom",
              "personal_updates",
              "greeting_status",
              "spam_promo",
              "meme",
              "news",
              "other",
            ],
          },
          language: { type: "string" },
          isTemplateLike: { type: "boolean" },
          isLowInformation: { type: "boolean" },
          spamLikelihood: { type: "number" },
          templateLikelihood: { type: "number" },
          contextualCoherence: { type: "number" },
          semanticKey: { type: "string" },
          secondaryKeys: { type: "array", items: { type: "string" } },
        },
        required: [
          "rootId",
          "summaryTopic",
          "candidateLabel",
          "shortDescription",
          "entities",
          "canonicalKeywords",
          "contentType",
          "trendCategory",
          "language",
          "isTemplateLike",
          "isLowInformation",
          "spamLikelihood",
          "templateLikelihood",
          "contextualCoherence",
          "semanticKey",
          "secondaryKeys",
        ],
      },
    },
  },
  required: ["roots"],
} as const;

function clampUnitValue(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeFreeformField(value: string | null | undefined, fallback: string) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
}

function deriveCanonicalKeywords(label: string) {
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 3)
    .slice(0, 5);
}

function buildRootSignature(input: BlueskyAiRootInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        rootId: input.rootId,
        authorId: input.authorId,
        authorHandle: input.authorHandle,
        createdAt: input.createdAt,
        lastSeenAt: input.lastSeenAt,
        totalInteractions24h: input.totalInteractions24h,
        rootText: input.rootText,
        evidenceText: input.evidenceText,
        urlLabels: input.urlLabels,
        entityLabels: input.entityLabels,
        phraseLabels: input.phraseLabels,
        hashtagLabels: input.hashtagLabels,
      }),
    )
    .digest("hex");
}

function getGroupingModel(mode: BlueskyAiGroupingRunMode) {
  if (mode === "manual_full_regroup") {
    return process.env.OPENAI_TREND_GROUPING_MANUAL_MODEL || DEFAULT_MANUAL_MODEL;
  }

  return (
    process.env.OPENAI_TREND_GROUPING_MODEL ||
    process.env.OPENAI_TREND_MODEL ||
    DEFAULT_INCREMENTAL_MODEL
  );
}

function getModelVerbosity(model: string): "low" | "medium" | "high" {
  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith("gpt-4.1")) {
    return "medium";
  }

  return "low";
}

function resolveConfiguredBatchSize(options: BlueskyAiGroupingOptions) {
  if (typeof options.batchSize === "number" && Number.isFinite(options.batchSize) && options.batchSize > 0) {
    return Math.floor(options.batchSize);
  }

  if (options.mode === "manual_full_regroup") {
    const manualParsed = Number.parseInt(
      process.env.OPENAI_TREND_GROUPING_MANUAL_BATCH_SIZE ?? "",
      10,
    );
    if (Number.isFinite(manualParsed) && manualParsed > 0) {
      return Math.floor(manualParsed);
    }

    return DEFAULT_MANUAL_BATCH_SIZE;
  }

  const parsed = Number.parseInt(process.env.OPENAI_TREND_GROUPING_BATCH_SIZE ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }

  return DEFAULT_INCREMENTAL_BATCH_SIZE;
}

function scoreBlueskyAiRootForProcessing(root: BlueskyAiRootInput) {
  const text = `${root.rootText ?? ""} ${root.evidenceText ?? ""}`.trim();
  const normalizedTokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  const evidenceCount =
    root.urlLabels.length + root.entityLabels.length + root.phraseLabels.length + root.hashtagLabels.length;
  const tokenDiversity = new Set(normalizedTokens).size;
  const informativeTextScore = Math.min(24, Math.log2(tokenDiversity + 1) * 5);
  const evidenceScore =
    root.entityLabels.length * 10 +
    root.phraseLabels.length * 12 +
    root.hashtagLabels.length * 8 +
    root.urlLabels.length * 6;
  const interactionScore = Math.min(120, Math.log2(Math.max(1, root.totalInteractions24h) + 1) * 22);
  const highAttentionBonus =
    root.totalInteractions24h >= 48
      ? 60
      : root.totalInteractions24h >= 24
        ? 40
        : root.totalInteractions24h >= 12
          ? 24
          : root.totalInteractions24h >= 6
            ? 12
            : 0;
  const lengthScore = Math.min(18, Math.log2(text.length + 1) * 2.5);
  const richnessBonus = evidenceCount > 0 ? 10 : 0;

  return (
    interactionScore +
    highAttentionBonus +
    evidenceScore +
    informativeTextScore +
    lengthScore +
    richnessBonus
  );
}

function resolveBatchSize(options: BlueskyAiGroupingOptions, pendingRoots: BlueskyAiRootInput[]) {
  const maxPromptChars = resolveMaxPromptChars(options);
  const sampleRoots = pendingRoots.slice(0, Math.min(24, pendingRoots.length));
  const averagePromptChars =
    sampleRoots.length > 0
      ? sampleRoots.reduce((sum, root) => sum + estimateRootPromptChars(root), 0) / sampleRoots.length
      : 0;
  const promptLimitedBatchSize =
    averagePromptChars > 0
      ? Math.max(1, Math.floor((maxPromptChars - 512) / Math.max(1, averagePromptChars)))
      : DEFAULT_INCREMENTAL_BATCH_SIZE;
  const configuredBatchSize = resolveConfiguredBatchSize(options);
  const scaleAwareFloor =
    options.mode === "manual_full_regroup"
      ? 48
      : pendingRoots.length >= 5_000
        ? 32
        : pendingRoots.length >= 1_000
          ? 24
          : pendingRoots.length >= 250
            ? 16
            : 8;
  const requestTimeoutMs = resolveRequestTimeoutMs(options);
  const targetBatchSize = Math.max(configuredBatchSize, scaleAwareFloor);
  const timeoutAwareCap =
    options.mode === "manual_full_regroup"
      ? Number.POSITIVE_INFINITY
      : requestTimeoutMs <= 15_000
        ? Math.min(Math.max(1, configuredBatchSize), 4)
        : requestTimeoutMs <= 20_000
          ? Math.min(Math.max(2, configuredBatchSize), 6)
          : requestTimeoutMs <= 30_000
            ? Math.min(Math.max(4, configuredBatchSize), 10)
            : targetBatchSize;

  return Math.max(1, Math.min(promptLimitedBatchSize, targetBatchSize, timeoutAwareCap));
}

function resolveMaxPromptChars(options: BlueskyAiGroupingOptions) {
  if (options.mode === "manual_full_regroup") {
    const manualParsed = Number.parseInt(
      process.env.OPENAI_TREND_GROUPING_MANUAL_MAX_PROMPT_CHARS ?? "",
      10,
    );
    if (Number.isFinite(manualParsed) && manualParsed >= 20_000) {
      return manualParsed;
    }

    return DEFAULT_MANUAL_MAX_PROMPT_CHARS;
  }

  const parsed = Number.parseInt(process.env.OPENAI_TREND_GROUPING_MAX_PROMPT_CHARS ?? "", 10);
  if (Number.isFinite(parsed) && parsed >= 10_000) {
    return parsed;
  }

  return DEFAULT_INCREMENTAL_MAX_PROMPT_CHARS;
}

function resolveRequestTimeoutMs(options: BlueskyAiGroupingOptions) {
  if (
    typeof options.requestTimeoutMs === "number" &&
    Number.isFinite(options.requestTimeoutMs) &&
    options.requestTimeoutMs >= 5_000
  ) {
    return Math.floor(options.requestTimeoutMs);
  }

  if (options.mode === "manual_full_regroup") {
    const manualParsed = Number.parseInt(
      process.env.OPENAI_TREND_GROUPING_MANUAL_TIMEOUT_MS ?? "",
      10,
    );
    if (Number.isFinite(manualParsed) && manualParsed >= 5_000) {
      return manualParsed;
    }

    return DEFAULT_MANUAL_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(process.env.OPENAI_TREND_GROUPING_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(parsed) && parsed >= 5_000) {
    return parsed;
  }

  return DEFAULT_INCREMENTAL_REQUEST_TIMEOUT_MS;
}

function resolveTotalBudgetMs(options: BlueskyAiGroupingOptions) {
  if (options.totalBudgetMs === null) {
    return null;
  }

  if (
    typeof options.totalBudgetMs === "number" &&
    Number.isFinite(options.totalBudgetMs) &&
    options.totalBudgetMs >= 10_000
  ) {
    return Math.floor(options.totalBudgetMs);
  }

  if (options.mode === "manual_full_regroup") {
    const manualParsed = Number.parseInt(
      process.env.OPENAI_TREND_GROUPING_MANUAL_MAX_TOTAL_MS ?? "",
      10,
    );
    if (Number.isFinite(manualParsed) && manualParsed >= 10_000) {
      return manualParsed;
    }

    return null;
  }

  const parsed = Number.parseInt(process.env.OPENAI_TREND_GROUPING_MAX_TOTAL_MS ?? "", 10);
  if (Number.isFinite(parsed) && parsed >= 10_000) {
    return parsed;
  }

  return DEFAULT_INCREMENTAL_TOTAL_BUDGET_MS;
}

function resolveMaxBatchFailures(options: BlueskyAiGroupingOptions) {
  if (
    typeof options.maxBatchFailures === "number" &&
    Number.isFinite(options.maxBatchFailures) &&
    options.maxBatchFailures >= 0
  ) {
    return Math.floor(options.maxBatchFailures);
  }

  if (options.mode === "manual_full_regroup") {
    const manualParsed = Number.parseInt(
      process.env.OPENAI_TREND_GROUPING_MANUAL_MAX_BATCH_FAILURES ?? "",
      10,
    );
    if (Number.isFinite(manualParsed) && manualParsed >= 0) {
      return manualParsed;
    }

    return DEFAULT_MANUAL_MAX_BATCH_FAILURES;
  }

  const parsed = Number.parseInt(process.env.OPENAI_TREND_GROUPING_MAX_BATCH_FAILURES ?? "", 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }

  return DEFAULT_INCREMENTAL_MAX_BATCH_FAILURES;
}

function resolveBatchConcurrency(options: BlueskyAiGroupingOptions) {
  if (options.mode === "manual_full_regroup") {
    const manualParsed = Number.parseInt(
      process.env.OPENAI_TREND_GROUPING_MANUAL_CONCURRENCY ?? "",
      10,
    );
    if (Number.isFinite(manualParsed) && manualParsed > 0) {
      return manualParsed;
    }

    return DEFAULT_MANUAL_CONCURRENCY;
  }

  const parsed = Number.parseInt(process.env.OPENAI_TREND_GROUPING_CONCURRENCY ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return DEFAULT_INCREMENTAL_CONCURRENCY;
}

function resolveIgnoreCache(options: BlueskyAiGroupingOptions) {
  if (typeof options.ignoreCache === "boolean") {
    return options.ignoreCache;
  }

  const value = String(process.env.OPENAI_TREND_GROUPING_IGNORE_CACHE ?? "")
    .trim()
    .toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<BlueskyAiInterpretationCacheFile>;
    if (parsed.version !== CACHE_VERSION || !parsed.entries || typeof parsed.entries !== "object") {
      return {
        version: CACHE_VERSION,
        entries: {},
      } satisfies BlueskyAiInterpretationCacheFile;
    }

    return {
      version: CACHE_VERSION,
      entries: parsed.entries as Record<string, BlueskyAiInterpretationCacheEntry>,
    } satisfies BlueskyAiInterpretationCacheFile;
  } catch {
    return {
      version: CACHE_VERSION,
      entries: {},
    } satisfies BlueskyAiInterpretationCacheFile;
  }
}

async function writeCache(cache: BlueskyAiInterpretationCacheFile) {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

async function readRunState() {
  try {
    const raw = await fs.readFile(RUN_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<BlueskyAiGroupingRunStateFile>;
    if (parsed.version !== RUN_STATE_VERSION) {
      return {
        version: RUN_STATE_VERSION,
        lastRun: null,
        lastSuccessfulFullRegroupAt: null,
      } satisfies BlueskyAiGroupingRunStateFile;
    }

    return {
      version: RUN_STATE_VERSION,
      lastRun: parsed.lastRun ?? null,
      lastSuccessfulFullRegroupAt: parsed.lastSuccessfulFullRegroupAt ?? null,
    } satisfies BlueskyAiGroupingRunStateFile;
  } catch {
    return {
      version: RUN_STATE_VERSION,
      lastRun: null,
      lastSuccessfulFullRegroupAt: null,
    } satisfies BlueskyAiGroupingRunStateFile;
  }
}

async function writeRunState(state: BlueskyAiGroupingRunStateFile) {
  await fs.mkdir(path.dirname(RUN_STATE_PATH), { recursive: true });
  await fs.writeFile(RUN_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function buildPrompt(batch: BlueskyAiRootInput[]) {
  return JSON.stringify(
    {
      task:
        "Interpret each Bluesky root for AI-first trend grouping. Return strict JSON only. Every root must receive one coherent topic interpretation and one stable semanticKey for clustering.",
      rules: [
        "Identify the underlying event, narrative, meme, or recurring template, not the first few words.",
        "candidateLabel must be a readable leaderboard row, never a clipped fragment or raw id.",
        "Keep summaryTopic and candidateLabel concise, ideally under 6 words each.",
        "Keep shortDescription concise, ideally under 12 words.",
        "semanticKey must be a stable grouping key for same-topic roots across wording variants.",
        "secondaryKeys should contain at most 3 short alternate semantic handles or aliases when they materially help merge obvious variants.",
        "canonicalKeywords should contain at most 5 short keywords.",
        "entities should contain at most 4 concise entities.",
        "Use empty arrays when entities, canonicalKeywords, or secondaryKeys are not highly confident.",
        "Use a very short shortDescription, or repeat candidateLabel when extra detail is unnecessary.",
        "Mark generic greetings, idle status chatter, repeated promo asks, and bot-like templates clearly.",
        "If a root is low-information or spammy, still return the best readable label while classifying it correctly.",
        "Prefer exact people, entities, laws, products, or events over vague umbrella phrasing.",
        "Do not invent narratives not supported by the root text or evidence.",
      ],
      roots: batch.map((root) => ({
        rootId: root.rootId,
        authorId: root.authorId,
        authorHandle: root.authorHandle,
        createdAt: root.createdAt,
        lastSeenAt: root.lastSeenAt,
        totalInteractions24h: root.totalInteractions24h,
        rootText: root.rootText,
        evidenceText: root.evidenceText,
        urlLabels: root.urlLabels,
        entityLabels: root.entityLabels,
        phraseLabels: root.phraseLabels,
        hashtagLabels: root.hashtagLabels,
      })),
    },
    null,
    2,
  );
}

function estimateRootPromptChars(root: BlueskyAiRootInput) {
  return JSON.stringify(root).length + 32;
}

function buildPendingBatches(pending: BlueskyAiRootInput[], options: BlueskyAiGroupingOptions) {
  const orderedPending = [...pending].sort((left, right) => {
    const scoreDelta = scoreBlueskyAiRootForProcessing(right) - scoreBlueskyAiRootForProcessing(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    if (right.totalInteractions24h !== left.totalInteractions24h) {
      return right.totalInteractions24h - left.totalInteractions24h;
    }

    return left.rootId.localeCompare(right.rootId);
  });
  const maxBatchSize = resolveBatchSize(options, orderedPending);
  const maxPromptChars = resolveMaxPromptChars(options);
  const batches: BlueskyAiRootInput[][] = [];
  let currentBatch: BlueskyAiRootInput[] = [];
  let currentPromptChars = 512;

  orderedPending.forEach((root) => {
    const rootPromptChars = estimateRootPromptChars(root);
    const nextBatchWouldOverflow =
      currentBatch.length > 0 &&
      (currentBatch.length >= maxBatchSize || currentPromptChars + rootPromptChars > maxPromptChars);

    if (nextBatchWouldOverflow) {
      batches.push(currentBatch);
      currentBatch = [];
      currentPromptChars = 512;
    }

    currentBatch.push(root);
    currentPromptChars += rootPromptChars;
  });

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  console.info("[bluesky-ai-grouping] batch planner", {
    rootCount: orderedPending.length,
    configuredBatchSize: resolveConfiguredBatchSize(options),
    effectiveBatchSize: maxBatchSize,
    maxPromptChars,
    batchCount: batches.length,
    topPrioritizedRootIds: orderedPending.slice(0, 5).map((root) => root.rootId),
  });

  return batches;
}

function estimateMaxOutputTokens(batch: BlueskyAiRootInput[]) {
  return Math.min(32_000, Math.max(4_000, batch.length * 220));
}

type PendingInterpretationBatch = {
  roots: BlueskyAiRootInput[];
  retryDepth: number;
};

function splitPendingBatchForRetry(
  batch: PendingInterpretationBatch,
  options: BlueskyAiGroupingOptions,
) {
  const nextBatchSize = Math.max(1, Math.floor(batch.roots.length / 2));
  return buildPendingBatches(batch.roots, {
    ...options,
    batchSize: nextBatchSize,
  }).map(
    (roots) =>
      ({
        roots,
        retryDepth: batch.retryDepth + 1,
      }) satisfies PendingInterpretationBatch,
  );
}

function isInterpretationRecord(value: unknown): value is BlueskyAiRootInterpretation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.rootId === "string" &&
    (record.summaryTopic === undefined || typeof record.summaryTopic === "string") &&
    typeof record.candidateLabel === "string" &&
    (record.shortDescription === undefined || typeof record.shortDescription === "string") &&
    (record.entities === undefined || Array.isArray(record.entities)) &&
    (record.canonicalKeywords === undefined || Array.isArray(record.canonicalKeywords)) &&
    typeof record.contentType === "string" &&
    typeof record.trendCategory === "string" &&
    (record.language === undefined || typeof record.language === "string") &&
    typeof record.isTemplateLike === "boolean" &&
    typeof record.isLowInformation === "boolean" &&
    typeof record.spamLikelihood === "number" &&
    typeof record.templateLikelihood === "number" &&
    typeof record.contextualCoherence === "number" &&
    typeof record.semanticKey === "string" &&
    (record.secondaryKeys === undefined || Array.isArray(record.secondaryKeys))
  );
}

function sanitizeInterpretation(value: BlueskyAiRootInterpretation): BlueskyAiRootInterpretation {
  const fallbackTopic = normalizeFreeformField(
    value.summaryTopic ?? value.candidateLabel,
    "bluesky topic",
  );
  const fallbackLabel = normalizeFreeformField(value.candidateLabel, fallbackTopic || "Bluesky topic");
  const canonicalKeywords =
    Array.isArray(value.canonicalKeywords) && value.canonicalKeywords.length > 0
      ? value.canonicalKeywords
      : deriveCanonicalKeywords(fallbackLabel);

  return {
    ...value,
    summaryTopic: fallbackTopic,
    candidateLabel: fallbackLabel,
    shortDescription: normalizeFreeformField(value.shortDescription ?? fallbackLabel, fallbackLabel),
    entities: (Array.isArray(value.entities) ? value.entities : [])
      .map((entry) => normalizeFreeformField(entry, ""))
      .filter(Boolean)
      .slice(0, 6),
    canonicalKeywords: canonicalKeywords
      .map((entry) => normalizeFreeformField(entry, ""))
      .filter(Boolean)
      .slice(0, 8),
    language: normalizeFreeformField(value.language ?? "unknown", "unknown"),
    spamLikelihood: clampUnitValue(value.spamLikelihood),
    templateLikelihood: clampUnitValue(value.templateLikelihood),
    contextualCoherence: clampUnitValue(value.contextualCoherence),
    semanticKey: normalizeFreeformField(value.semanticKey, fallbackLabel),
    secondaryKeys: (Array.isArray(value.secondaryKeys) ? value.secondaryKeys : [])
      .map((entry) => normalizeFreeformField(entry, ""))
      .filter(Boolean)
      .slice(0, 6),
  };
}

function buildCredentialFingerprint(apiKey: string) {
  return `sha256:${createHash("sha256").update(apiKey).digest("hex").slice(0, 12)}`;
}

async function persistDiagnostics(
  diagnostics: BlueskyAiGroupingDiagnostics,
  previousState?: BlueskyAiGroupingRunStateFile | null,
) {
  const currentState = previousState ?? (await readRunState());
  const nextLastFullRegroupAt =
    diagnostics.mode === "manual_full_regroup" &&
    !diagnostics.incomplete &&
    diagnostics.processedRootCount >= diagnostics.eligibleRootCount
      ? diagnostics.completedAt
      : currentState.lastSuccessfulFullRegroupAt;

  const nextState: BlueskyAiGroupingRunStateFile = {
    version: RUN_STATE_VERSION,
    lastRun: {
      ...diagnostics,
      lastSuccessfulFullRegroupAt: nextLastFullRegroupAt,
    },
    lastSuccessfulFullRegroupAt: nextLastFullRegroupAt ?? null,
  };
  await writeRunState(nextState);
  return nextState;
}

async function requestInterpretationBatch(params: {
  client: OpenAI;
  batch: BlueskyAiRootInput[];
  model: string;
  batchNumber: number;
  maxOutputTokens: number;
}) {
  const response = await params.client.responses.create({
    model: params.model,
    instructions:
      "You are a precise Bluesky trend-classification engine. Return strict JSON only.",
    input: buildPrompt(params.batch),
    store: false,
    max_output_tokens: params.maxOutputTokens,
    text: {
      format: {
        type: "json_schema",
        name: "bluesky_root_interpretations",
        strict: true,
        schema: RESULT_SCHEMA,
      },
      verbosity: getModelVerbosity(params.model),
    },
  });
  const parsed = JSON.parse(response.output_text) as { roots?: unknown[] };
  const rows = Array.isArray(parsed.roots) ? parsed.roots : [];

  console.info("[bluesky-ai-grouping] batch complete", {
    batchNumber: params.batchNumber,
    returnedRootCount: rows.length,
    maxOutputTokens: params.maxOutputTokens,
  });

  return rows;
}

export async function interpretBlueskyRootsDetailed(
  roots: BlueskyAiRootInput[],
  options: BlueskyAiGroupingOptions = {},
): Promise<BlueskyAiGroupingResult> {
  const mode = options.mode ?? "incremental_live";
  const ignoreCache = resolveIgnoreCache(options);
  const startedAt = new Date().toISOString();
  const previousRunState = await readRunState();
  const initialRequestTimeoutMs = resolveRequestTimeoutMs({ ...options, mode });
  const initialTotalBudgetMs = resolveTotalBudgetMs({ ...options, mode });
  const diagnostics: BlueskyAiGroupingDiagnostics = {
    mode,
    requestedRootCount: roots.length,
    eligibleRootCount: roots.length,
    processedRootCount: 0,
    processedFreshRootCount: 0,
    cacheHitCount: 0,
    freshCallCount: 0,
    batchCount: 0,
    batchFailureCount: 0,
    failedRootCount: 0,
    attempted: false,
    clientInitialized: false,
    incomplete: false,
    incompleteReason: null,
    model: null,
    credentialSource: null,
    credentialFingerprint: null,
    ignoreCache,
    requestTimeoutMs: initialRequestTimeoutMs,
    totalBudgetMs: initialTotalBudgetMs,
    startedAt,
    completedAt: null,
    lastSuccessfulFullRegroupAt: previousRunState.lastSuccessfulFullRegroupAt ?? null,
  };

  if (roots.length === 0) {
    diagnostics.completedAt = new Date().toISOString();
    await persistDiagnostics(diagnostics, previousRunState);
    return {
      interpretations: new Map(),
      diagnostics,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    diagnostics.incomplete = true;
    diagnostics.incompleteReason = "OPENAI_API_KEY is not configured in process.env";
    diagnostics.completedAt = new Date().toISOString();
    console.warn("[bluesky-ai-grouping] missing OpenAI credential", {
      credentialSource: "process.env.OPENAI_API_KEY",
      rootCount: roots.length,
    });
    await persistDiagnostics(diagnostics, previousRunState);
    return {
      interpretations: new Map(),
      diagnostics,
    };
  }

  const model = getGroupingModel(mode);
  const normalizedModel = model.trim().toLowerCase();
  const tunedOptions =
    mode === "manual_full_regroup" && normalizedModel === "gpt-4.1"
      ? {
          ...options,
          batchSize: options.batchSize ?? 40,
        }
      : options;
  const requestTimeoutMs = resolveRequestTimeoutMs({ ...tunedOptions, mode });
  const totalBudgetMs = resolveTotalBudgetMs({ ...tunedOptions, mode });
  diagnostics.attempted = true;
  diagnostics.clientInitialized = true;
  diagnostics.model = model;
  diagnostics.credentialSource = "process.env.OPENAI_API_KEY";
  diagnostics.credentialFingerprint = buildCredentialFingerprint(apiKey);
  diagnostics.requestTimeoutMs = requestTimeoutMs;
  diagnostics.totalBudgetMs = totalBudgetMs;

  console.info("[bluesky-ai-grouping] client initialized", {
    mode,
    credentialSource: diagnostics.credentialSource,
    credentialFingerprint: diagnostics.credentialFingerprint,
    hasApiKey: true,
    model,
    ignoreCache,
    requestTimeoutMs,
    totalBudgetMs,
    rootCount: roots.length,
  });

  const cache = await readCache();
  const results = new Map<string, BlueskyAiRootInterpretation>();
  const pending: BlueskyAiRootInput[] = [];

  roots.forEach((root) => {
    const signature = buildRootSignature(root);
    const cached = cache.entries[root.rootId];
    if (!ignoreCache && cached && cached.signature === signature && cached.model === model) {
      results.set(root.rootId, sanitizeInterpretation(cached.interpretation));
      diagnostics.cacheHitCount += 1;
      return;
    }

    pending.push(root);
  });

  diagnostics.processedRootCount = results.size;

  if (pending.length === 0) {
    diagnostics.completedAt = new Date().toISOString();
    console.info("[bluesky-ai-grouping] cache satisfied full run", {
      mode,
      rootCount: roots.length,
      cacheHitCount: diagnostics.cacheHitCount,
      model,
    });
    await persistDiagnostics(diagnostics, previousRunState);
    return {
      interpretations: results,
      diagnostics,
    };
  }

  const client = new OpenAI({
    apiKey,
    timeout: requestTimeoutMs,
    maxRetries: 1,
  });
  const batchQueue = buildPendingBatches(pending, { ...tunedOptions, mode }).map(
    (batch) =>
      ({
        roots: batch,
        retryDepth: 0,
      }) satisfies PendingInterpretationBatch,
  );
  const maxBatchFailures = resolveMaxBatchFailures({ ...tunedOptions, mode });
  const batchConcurrency =
    mode === "manual_full_regroup" && normalizedModel === "gpt-4.1"
      ? 1
      : resolveBatchConcurrency({ ...tunedOptions, mode });
  const startedAtMs = Date.now();
  let cacheDirty = false;
  let incompleteReason: string | null = null;

  while (batchQueue.length > 0) {
    if (totalBudgetMs !== null && Date.now() - startedAtMs >= totalBudgetMs) {
      incompleteReason = `AI grouping budget exhausted after ${totalBudgetMs}ms`;
      console.warn("[bluesky-ai-grouping] budget exhausted", {
        mode,
        processedRootCount: results.size,
        remainingRootCount: roots.length - results.size,
        totalBudgetMs,
      });
      break;
    }

    const wave = batchQueue.splice(0, Math.max(1, batchConcurrency));
    let nextBatchNumber = diagnostics.batchCount;
    const scheduledWave = wave.map((batch) => {
      nextBatchNumber += 1;
      return {
        batch,
        batchNumber: nextBatchNumber,
      };
    });
    diagnostics.batchCount = nextBatchNumber;

    const waveResults = await Promise.all(
      scheduledWave.map(async ({ batch, batchNumber }) => {
        let rows: unknown[] | null = null;
        let lastError: unknown = null;
        const maxOutputTokens = estimateMaxOutputTokens(batch.roots);
        const pendingRootCount =
          batchQueue.reduce((sum, entry) => sum + entry.roots.length, 0) + batch.roots.length;

        console.info("[bluesky-ai-grouping] batch start", {
          batchNumber,
          batchSize: batch.roots.length,
          retryDepth: batch.retryDepth,
          pendingRootCount,
          processedRootCount: results.size,
          maxOutputTokens,
        });

        for (let attempt = 0; attempt <= DEFAULT_REQUEST_RETRIES; attempt += 1) {
          diagnostics.freshCallCount += 1;
          try {
            rows = await requestInterpretationBatch({
              client,
              batch: batch.roots,
              model,
              batchNumber,
              maxOutputTokens,
            });
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            console.warn("[bluesky-ai-grouping] batch attempt failed", {
              batchNumber,
              attempt: attempt + 1,
              maxAttempts: DEFAULT_REQUEST_RETRIES + 1,
              batchSize: batch.roots.length,
              retryDepth: batch.retryDepth,
              error: error instanceof Error ? error.message : String(error),
            });
            if (attempt >= DEFAULT_REQUEST_RETRIES) {
              break;
            }
          }
        }

        return {
          batch,
          batchNumber,
          rows,
          lastError,
        };
      }),
    );

    for (const waveResult of waveResults) {
      const { batch, batchNumber, rows, lastError } = waveResult;

      if (!rows) {
        diagnostics.batchFailureCount += 1;
        if (batch.roots.length > 1 && batch.retryDepth < MAX_BATCH_SPLIT_DEPTH) {
          const retryBatches = splitPendingBatchForRetry(batch, { ...tunedOptions, mode });
          batchQueue.unshift(...retryBatches);
          console.warn("[bluesky-ai-grouping] requeued failed batch at smaller size", {
            batchNumber,
            previousBatchSize: batch.roots.length,
            retryDepth: batch.retryDepth,
            retryBatchSizes: retryBatches.map((entry) => entry.roots.length),
            error: lastError instanceof Error ? lastError.message : String(lastError),
          });
          continue;
        }

        incompleteReason = `batch ${batchNumber} failed`;
        console.warn("[bluesky-ai-grouping] batch dropped from active leaderboard routing", {
          batchNumber,
          batchSize: batch.roots.length,
          retryDepth: batch.retryDepth,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        });
      } else {
        const matchedRootIds = new Set<string>();
        rows.forEach((row) => {
          if (!isInterpretationRecord(row)) {
            return;
          }

          const sanitized = sanitizeInterpretation(row);
          const root = batch.roots.find((entry) => entry.rootId === sanitized.rootId);
          if (!root) {
            return;
          }

          matchedRootIds.add(sanitized.rootId);
          results.set(sanitized.rootId, sanitized);
          cache.entries[sanitized.rootId] = {
            signature: buildRootSignature(root),
            model,
            updatedAt: new Date().toISOString(),
            interpretation: sanitized,
          };
          cacheDirty = true;
        });

        diagnostics.processedFreshRootCount += matchedRootIds.size;
        diagnostics.processedRootCount = results.size;

        const unmatchedRoots = batch.roots.filter((root) => !matchedRootIds.has(root.rootId));
        if (unmatchedRoots.length > 0) {
          diagnostics.batchFailureCount += 1;
          console.warn("[bluesky-ai-grouping] batch returned incomplete results", {
            batchNumber,
            returnedRootCount: matchedRootIds.size,
            expectedRootCount: batch.roots.length,
            unmatchedRootCount: unmatchedRoots.length,
            retryDepth: batch.retryDepth,
          });

          if (unmatchedRoots.length > 1 && batch.retryDepth < MAX_BATCH_SPLIT_DEPTH) {
            const retryBatches = splitPendingBatchForRetry(
              {
                roots: unmatchedRoots,
                retryDepth: batch.retryDepth,
              },
              { ...tunedOptions, mode },
            );
            batchQueue.unshift(...retryBatches);
            console.warn("[bluesky-ai-grouping] requeued unmatched roots at smaller size", {
              batchNumber,
              previousBatchSize: batch.roots.length,
              unmatchedRootCount: unmatchedRoots.length,
              retryDepth: batch.retryDepth,
              retryBatchSizes: retryBatches.map((entry) => entry.roots.length),
            });
          } else {
            incompleteReason = `batch ${batchNumber} returned incomplete results`;
          }
        }
      }

      if (diagnostics.batchFailureCount > maxBatchFailures && results.size < roots.length) {
        incompleteReason = incompleteReason ?? `batch failure limit exceeded after batch ${batchNumber}`;
        console.warn("[bluesky-ai-grouping] aborting after batch failure limit", {
          batchFailureCount: diagnostics.batchFailureCount,
          maxBatchFailures,
          processedRootCount: results.size,
          requestedRootCount: roots.length,
        });
        batchQueue.length = 0;
        break;
      }
    }

    if (cacheDirty) {
      await writeCache(cache);
      cacheDirty = false;
    }

    await persistDiagnostics(
      {
        ...diagnostics,
        failedRootCount: Math.max(0, roots.length - results.size),
        completedAt: null,
        incomplete: Boolean(incompleteReason),
        incompleteReason,
      },
      previousRunState,
    );
  }

  if (results.size < roots.length) {
    diagnostics.incomplete = true;
    diagnostics.failedRootCount = roots.length - results.size;
    diagnostics.incompleteReason =
      incompleteReason ?? "AI grouping completed without full root coverage";
  } else {
    diagnostics.failedRootCount = 0;
  }

  diagnostics.processedRootCount = results.size;
  diagnostics.completedAt = new Date().toISOString();
  await persistDiagnostics(diagnostics, previousRunState);

  console.info("[bluesky-ai-grouping] run complete", {
    mode,
    requestedRootCount: diagnostics.requestedRootCount,
    processedRootCount: diagnostics.processedRootCount,
    processedFreshRootCount: diagnostics.processedFreshRootCount,
    cacheHitCount: diagnostics.cacheHitCount,
    freshCallCount: diagnostics.freshCallCount,
    batchCount: diagnostics.batchCount,
    batchFailureCount: diagnostics.batchFailureCount,
    failedRootCount: diagnostics.failedRootCount,
    incomplete: diagnostics.incomplete,
    incompleteReason: diagnostics.incompleteReason,
    model,
  });

  return {
    interpretations: results,
    diagnostics,
  };
}

export async function interpretBlueskyRoots(
  roots: BlueskyAiRootInput[],
  options: BlueskyAiGroupingOptions = {},
): Promise<Map<string, BlueskyAiRootInterpretation> | null> {
  const result = await interpretBlueskyRootsDetailed(roots, options);
  return result.interpretations;
}
