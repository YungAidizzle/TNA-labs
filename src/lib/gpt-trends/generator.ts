import "server-only";

import crypto from "node:crypto";
import OpenAI from "openai";
import { getGptTrendConfig } from "@/lib/gpt-trends/config";
import {
  getLatestSuccessfulTrendSnapshot,
  insertFailedTrendSnapshot,
  storeSuccessfulTrendSnapshot,
} from "@/lib/gpt-trends/repository";
import type {
  GeneratedTrendCandidate,
  GeneratedTrendSnapshotPayload,
} from "@/lib/gpt-trends/types";

type RawModelTrend = {
  rank?: unknown;
  trend_key?: unknown;
  title?: unknown;
  summary?: unknown;
  confidence_score?: unknown;
  ai_rank_score?: unknown;
  importance_note?: unknown;
  category?: unknown;
  source_scope?: unknown;
  source_count?: unknown;
};

type RawModelPayload = {
  generated_context?: {
    as_of?: unknown;
    summary?: unknown;
  };
  trends?: unknown;
};

const GENERATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    generated_context: {
      type: "object",
      additionalProperties: false,
      properties: {
        as_of: { type: "string" },
        summary: { type: "string" },
      },
      required: ["as_of", "summary"],
    },
    trends: {
      type: "array",
      minItems: 100,
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          rank: { type: "integer", minimum: 1, maximum: 100 },
          trend_key: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          confidence_score: { type: "number", minimum: 0, maximum: 100 },
          ai_rank_score: { type: "number", minimum: 0, maximum: 100 },
          importance_note: { type: "string" },
          category: { type: "string" },
          source_scope: { type: "string" },
          source_count: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: [
          "rank",
          "trend_key",
          "title",
          "summary",
          "confidence_score",
          "ai_rank_score",
          "importance_note",
          "category",
          "source_scope",
          "source_count",
        ],
      },
    },
  },
  required: ["generated_context", "trends"],
} as const;

function clampScore(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(100, Math.max(0, value));
}

function normalizeModelScore(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const scaled = numeric > 0 && numeric < 1 ? numeric * 100 : numeric;
  return clampScore(scaled, fallback);
}

function slugifyTrendKey(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || crypto.randomUUID().slice(0, 8);
}

function asNonEmptyString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeTrendCandidate(raw: RawModelTrend, index: number): GeneratedTrendCandidate {
  const title = asNonEmptyString(raw.title);
  const summary = asNonEmptyString(raw.summary);
  if (!title || !summary) {
    throw new Error(`Model trend ${index + 1} is missing a title or summary.`);
  }

  const rank = Number(raw.rank ?? index + 1);
  const confidenceScore = normalizeModelScore(raw.confidence_score ?? 0, 0);
  const aiRankScore = normalizeModelScore(raw.ai_rank_score ?? confidenceScore, confidenceScore);

  return {
    rank: Number.isFinite(rank) ? Math.max(1, Math.round(rank)) : index + 1,
    trendKey: slugifyTrendKey(asNonEmptyString(raw.trend_key) || title),
    title,
    summary,
    confidenceScore,
    aiRankScore,
    importanceNote: asNonEmptyString(raw.importance_note),
    category: asNonEmptyString(raw.category),
    sourceScope: asNonEmptyString(raw.source_scope),
    sourceCount: (() => {
      const value = Number(raw.source_count ?? 0);
      return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
    })(),
  };
}

function normalizeModelPayload(content: string, expectedTrendCount: number): GeneratedTrendSnapshotPayload {
  const parsed = JSON.parse(content) as RawModelPayload;
  if (!Array.isArray(parsed.trends)) {
    throw new Error("Model payload is missing a trends array.");
  }

  const normalized = parsed.trends.map((row, index) => normalizeTrendCandidate(row as RawModelTrend, index));
  normalized.sort((left, right) => left.rank - right.rank);

  const seenRanks = new Set<number>();
  const seenKeys = new Set<string>();
  const trends = normalized.map((trend, index) => {
    const nextRank = index + 1;
    const key = seenKeys.has(trend.trendKey) ? `${trend.trendKey}-${nextRank}` : trend.trendKey;
    seenKeys.add(key);
    seenRanks.add(nextRank);
    return {
      ...trend,
      rank: nextRank,
      trendKey: key,
      aiRankScore: clampScore(trend.aiRankScore || 100 - index, 100 - index),
    };
  });

  if (trends.length !== expectedTrendCount) {
    throw new Error(`Expected exactly ${expectedTrendCount} trends but received ${trends.length}.`);
  }

  if (seenRanks.size !== expectedTrendCount) {
    throw new Error("Generated trend ranks were not unique.");
  }

  return {
    generatedAt: asNonEmptyString(parsed.generated_context?.as_of) || new Date().toISOString(),
    modelName: "",
    promptVersion: "",
    trends,
    notesJson: {
      generation_summary: asNonEmptyString(parsed.generated_context?.summary),
    },
  };
}

function buildGenerationPrompt(trendCount: number) {
  const nowIso = new Date().toISOString();
  return [
    "Generate the current top internet narrative trends for a shared product leaderboard.",
    `Return exactly ${trendCount} trends ranked from 1 to ${trendCount}.`,
    "Use current web-grounded information and prioritize trends that are important now, widely discussed now, or narratively significant now.",
    "Do not personalize the output for a user segment. This is one shared global trend board.",
    "Do not rank by social post counts. Rank by overall current importance, narrative significance, breadth of coverage, and confidence.",
    "Avoid duplicates, near-duplicates, and micro-variants of the same story.",
    "Each title should read like a clean trend headline, not a fragment.",
    "Each summary should be concise and factual.",
    "importance_note should explain why the trend matters right now in one short sentence.",
    "category should be a concise label such as AI, Tech, Crypto, Markets, Politics, Business, World, Culture, Entertainment, Sports, or Internet.",
    "source_scope should describe the breadth briefly, such as global, regional, niche, mainstream, or mixed.",
    "source_count should be the approximate number of distinct web sources materially supporting the trend.",
    `Generate the board as of ${nowIso}.`,
  ].join("\n");
}

async function requestGeneratedTrendSnapshot(attempt: number) {
  const config = getGptTrendConfig();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY for GPT trend generation.");
  }

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: config.modelName,
    input: buildGenerationPrompt(config.trendCount),
    text: {
      format: {
        type: "json_schema",
        name: "shared_hourly_trend_snapshot",
        strict: true,
        schema: GENERATION_SCHEMA,
      },
      verbosity: "low",
    },
    tool_choice: config.useWebSearch ? { type: "web_search_preview" } : "none",
    tools: config.useWebSearch
      ? [
          {
            type: "web_search_preview",
            search_context_size: config.searchContextSize,
            user_location: {
              type: "approximate",
              country: config.searchCountry,
              region: config.searchRegion,
              city: config.searchCity,
              timezone: config.searchTimezone,
            },
          },
        ]
      : [],
  });

  const normalized = normalizeModelPayload(response.output_text, config.trendCount);
  return {
    ...normalized,
    modelName: config.modelName,
    promptVersion: config.promptVersion,
    rawResponseJson: config.storeRawResponse
      ? ({
          id: response.id,
          model: response.model,
          output_text: response.output_text,
          usage: response.usage ?? null,
          attempt,
        } satisfies Record<string, unknown>)
      : null,
  };
}

export async function generateSharedTrendSnapshot(options: {
  force?: boolean;
  trigger?: string;
} = {}) {
  const config = getGptTrendConfig();
  if (!config.enabled) {
    return {
      skipped: true,
      reason: "disabled",
    } as const;
  }

  const latestSnapshot = await getLatestSuccessfulTrendSnapshot();
  if (!options.force && latestSnapshot?.generatedAt) {
    const latestTimestamp = Date.parse(latestSnapshot.generatedAt);
    if (Number.isFinite(latestTimestamp)) {
      const elapsedSeconds = (Date.now() - latestTimestamp) / 1000;
      if (elapsedSeconds < config.refreshIntervalSeconds) {
        return {
          skipped: true,
          reason: "interval_guard",
          snapshotId: latestSnapshot.id,
          generatedAt: latestSnapshot.generatedAt,
        } as const;
      }
    }
  }

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const generated = await requestGeneratedTrendSnapshot(attempt);
      const snapshotId = await storeSuccessfulTrendSnapshot({
        ...generated,
        notesJson: {
          ...(generated.notesJson ?? {}),
          trigger: options.trigger ?? "manual",
          refresh_interval_seconds: config.refreshIntervalSeconds,
          used_web_search: config.useWebSearch,
        },
      });
      return {
        skipped: false,
        snapshotId,
        trendCount: generated.trends.length,
        generatedAt: generated.generatedAt,
      } as const;
    } catch (error) {
      lastError = error as Error;
    }
  }

  await insertFailedTrendSnapshot({
    modelName: config.modelName,
    promptVersion: config.promptVersion,
    generatedAt: new Date().toISOString(),
    errorMessage: String(lastError?.message ?? "GPT trend generation failed."),
  });
  throw lastError ?? new Error("GPT trend generation failed.");
}
