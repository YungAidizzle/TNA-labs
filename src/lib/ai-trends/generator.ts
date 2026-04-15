import "server-only";

import crypto from "node:crypto";
import OpenAI from "openai";
import { getAiTrendConfig } from "@/lib/ai-trends/config";
import {
  getLatestSuccessfulAiTrendSnapshot,
  insertFailedAiTrendSnapshot,
  storeSuccessfulAiTrendSnapshot,
} from "@/lib/ai-trends/repository";
import { assertAiTrendCanonicalTitle } from "@/lib/ai-trends/title-validation";
import { rerankAiTrendsForNarrativeRelevance } from "@/lib/ai-trends/narrative-relevance";
import type {
  GeneratedAiTrendCandidate,
  GeneratedAiTrendSnapshotPayload,
} from "@/lib/ai-trends/types";

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
          title: { type: "string", minLength: 4, maxLength: 96 },
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

function normalizeTrendCandidate(raw: RawModelTrend, index: number): GeneratedAiTrendCandidate {
  const rawTitle = asNonEmptyString(raw.title);
  const summary = asNonEmptyString(raw.summary);
  if (!rawTitle || !summary) {
    throw new Error(`Model trend ${index + 1} is missing a title or summary.`);
  }
  const title = assertAiTrendCanonicalTitle(rawTitle, index);

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

function normalizeModelPayload(content: string, expectedTrendCount: number): GeneratedAiTrendSnapshotPayload {
  const parsed = JSON.parse(content) as RawModelPayload;
  if (!Array.isArray(parsed.trends)) {
    throw new Error("Model payload is missing a trends array.");
  }

  const normalized = parsed.trends.map((row, index) => normalizeTrendCandidate(row as RawModelTrend, index));
  const reranked = rerankAiTrendsForNarrativeRelevance(normalized);
  if (reranked.rejectedReason) {
    throw new Error(
      `Generated board failed internet-native relevance quality gate: ${reranked.rejectedReason}. ` +
        `Distribution was high=${reranked.distribution.highCount}, medium=${reranked.distribution.mediumCount}, low=${reranked.distribution.lowCount}.`,
    );
  }

  const seenKeys = new Set<string>();
  const trends = reranked.trends.map((trend, index) => {
    const key = seenKeys.has(trend.trendKey) ? `${trend.trendKey}-${index + 1}` : trend.trendKey;
    seenKeys.add(key);
    return {
      ...trend,
      rank: index + 1,
      trendKey: key,
      aiRankScore: clampScore(trend.aiRankScore || 100 - index, 100 - index),
    };
  });

  if (trends.length !== expectedTrendCount) {
    throw new Error(`Expected exactly ${expectedTrendCount} trends but received ${trends.length}.`);
  }

  return {
    generatedAt: asNonEmptyString(parsed.generated_context?.as_of) || new Date().toISOString(),
    modelName: "",
    promptVersion: "",
    trends,
    notesJson: {
      generation_summary: asNonEmptyString(parsed.generated_context?.summary),
      narrative_relevance_distribution: reranked.distribution,
      narrative_relevance_average_score: reranked.averageScore,
      ranking_focus: "internet_native_narrative_propagation",
    },
  };
}

function buildGenerationPrompt(trendCount: number) {
  const nowIso = new Date().toISOString();
  return [
    "Generate the current top internet-native narrative trends for a shared dashboard leaderboard.",
    `Return exactly ${trendCount} trends ranked from 1 to ${trendCount}.`,
    "Use current web-grounded information and optimize for narratives that are most likely to propagate through highly online attention ecosystems today.",
    "This is one shared global board for all users. Do not personalize for a user segment.",
    "Prioritize narratives that people would meme, repeat, argue about, turn into slogans, attach identity to, or create tokens around.",
    "Strongly favor narratives with named entities, symbolic events, controversy, virality potential, cultural hooks, platform shifts, or retail-speculation spillover.",
    "A trend only belongs high on this board if highly online communities would keep talking about it repeatedly today.",
    "Primary ranking factor: memetic potential and narrative propagation likelihood. Secondary ranking factor: general importance.",
    "Every selected trend must be anchored to a specific current narrative object: a named person, company, product, clip, hashtag, slogan, lawsuit, launch, leak, ban, platform shift, controversy, or flashpoint event.",
    "Avoid duplicates, near-duplicates, and minor variants of the same story.",
    "Exclude or push to the bottom routine process news, vague institutional developments, generic enterprise trends, abstract sector movements, B2B internal changes, and long-term structural themes with no current cultural spike.",
    "Do not pad the board with evergreen internet behavior patterns, broad creator-economy themes, generic youth-culture shifts, or abstract meme categories unless they are tied to a specific current flashpoint.",
    "Downrank vague actors such as companies, governments, institutions, enterprises, regulators, banks, vendors, and providers when the narrative lacks a specific named person, company, product, slogan, event, or object.",
    "If a macro, political, or geopolitical story is included, it must have clear public-attention spillover, symbolic force, or meme potential right now.",
    "Prefer concrete current objects over broad discussion umbrellas.",
    "The final board should feel like what the internet is talking about, not a generic world-news digest.",
    "Aim for roughly 35 to 45 high-relevance internet-native narratives, 35 to 45 medium-relevance spillover narratives, and no more than 20 low-relevance fallback stories.",
    "Do not treat every named-entity story as a top-tier memetic narrative. Use the middle ranks for real spillover stories that are important online but not direct meme objects.",
    "The title field is the canonical stored dashboard title and must already be the final compact narrative label.",
    "Do not generate a long title first. Do not return a long title plus a shorter variant. The title field itself must be short.",
    "Titles should usually be 3 to 6 words and must never exceed 8 words.",
    "Titles must sound like clean narrative labels, not newspaper headlines or full sentences.",
    "Keep the exact subject of the trend in the title, including the specific person, company, event, slogan, meme, policy, or object.",
    "Do not use ellipses, quotation marks, colons, semicolons, or headline-style framing in titles.",
    "Good title style examples: Anthropic Mythos Leak, OpenAI Media Push, TikTok Ban Flashpoint, Trump MAGA Push, Iran Escalation Risk, Bitcoin ETF Surge.",
    "Bad title examples to avoid: Viral Food Trend, Creator Drama, Meme Culture Shift, Platform Update Buzz, Internet Debate Topic.",
    "Each summary must be concise and factual.",
    "importance_note should explain why highly online communities would keep talking about this right now in one short sentence.",
    "confidence_score should reflect confidence that the trend is real, current, and well-supported.",
    "ai_rank_score should reflect internet-native narrative propagation likelihood, memetic force, and speculative-attention spillover potential.",
    "category should be a concise label such as AI, Tech, Crypto, Markets, Politics, Business, World, Culture, Entertainment, Sports, or Internet.",
    "source_scope should describe the breadth briefly, such as global, regional, niche, mainstream, or mixed.",
    "source_count should be the approximate number of distinct web sources materially supporting the topic.",
    `Generate the board as of ${nowIso}.`,
  ].join("\n");
}

async function requestGeneratedAiTrendSnapshot(attempt: number) {
  const config = getAiTrendConfig();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY for shared AI trend generation.");
  }

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: config.modelName,
    input: buildGenerationPrompt(config.trendCount),
    text: {
      format: {
        type: "json_schema",
        name: "shared_ai_trend_snapshot",
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

export async function generateSharedAiTrendSnapshot(options: {
  force?: boolean;
  trigger?: string;
} = {}) {
  const config = getAiTrendConfig();
  if (!config.enabled) {
    return {
      skipped: true,
      reason: "disabled",
    } as const;
  }

  const latestSnapshot = await getLatestSuccessfulAiTrendSnapshot();
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
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      console.info("[ai-trends] generation attempt start", {
        attempt,
        trigger: options.trigger ?? "manual",
        model: config.modelName,
        useWebSearch: config.useWebSearch,
      });
      const generated = await requestGeneratedAiTrendSnapshot(attempt);
      const snapshotId = await storeSuccessfulAiTrendSnapshot({
        ...generated,
        notesJson: {
          ...(generated.notesJson ?? {}),
          trigger: options.trigger ?? "manual",
          refresh_interval_seconds: config.refreshIntervalSeconds,
          used_web_search: config.useWebSearch,
        },
      });
      console.info("[ai-trends] generation stored", {
        snapshotId,
        trendCount: generated.trends.length,
        generatedAt: generated.generatedAt,
      });
      return {
        skipped: false,
        snapshotId,
        trendCount: generated.trends.length,
        generatedAt: generated.generatedAt,
      } as const;
    } catch (error) {
      lastError = error as Error;
      console.error("[ai-trends] generation attempt failed", {
        attempt,
        trigger: options.trigger ?? "manual",
        error: String(lastError?.message ?? error),
      });
    }
  }

  await insertFailedAiTrendSnapshot({
    modelName: config.modelName,
    promptVersion: config.promptVersion,
    generatedAt: new Date().toISOString(),
    errorMessage: String(lastError?.message ?? "Shared AI trend generation failed."),
  });
  throw lastError ?? new Error("Shared AI trend generation failed.");
}
