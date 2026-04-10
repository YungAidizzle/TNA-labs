import "server-only";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import OpenAI from "openai";

export type NarrativeMergeDocument = {
  id: string;
  candidateId: string;
  title: string;
  excerpt: string;
  platformId: string;
  sourceLabel: string;
  interactionCount: number;
  createdAt: string;
};

export type NarrativeMergeCandidate = {
  id: string;
  label: string;
  labelSource: "named_phrase" | "phrase" | "fallback" | "ai";
  labelQualityScore: number;
  keywords: string[];
  topAliases: string[];
  sampleTitles: string[];
  supportingSignalCount: number;
  commentCount: number;
  sourceDiversity: number;
  namedPhraseSupport: number;
  firstSeenAt: string;
  lastSeenAt: string;
  platforms: string[];
  sourceLabels: string[];
  referenceWindowEnd?: string;
  documents: NarrativeMergeDocument[];
};

export type NarrativeResolutionResult = {
  narratives: Array<{
    id: string;
    label: string;
    summary: string;
    aliases: string[];
    candidateIds: string[];
    documentIds: string[];
  }>;
  ignoredCandidateIds: string[];
};

const DEFAULT_MODEL = process.env.OPENAI_TREND_MODEL || "gpt-5-mini";
const NARRATIVE_RESOLUTION_CACHE_VERSION = 2;
const CACHE_PATH = path.join(
  process.cwd(),
  "data",
  "reddit_engine",
  "ai_narrative_resolution.json",
);
const MAX_CANDIDATES = 60;
const MAX_DOCUMENTS_PER_CANDIDATE = 10;
const inflightResolutions = new Map<string, Promise<NarrativeResolutionResult | null>>();
const BLOCKING_AI_RESOLUTION = process.env.OPENAI_TREND_BLOCKING === "true";

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    narratives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          summary: { type: "string" },
          aliases: {
            type: "array",
            items: { type: "string" },
          },
          candidateIds: {
            type: "array",
            items: { type: "string" },
          },
          documentIds: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "label", "summary", "aliases", "candidateIds", "documentIds"],
      },
    },
    ignoredCandidateIds: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["narratives", "ignoredCandidateIds"],
} as const;

function getCacheKey(
  _generatedAt: string | null | undefined,
  model: string,
  candidates: NarrativeMergeCandidate[],
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: NARRATIVE_RESOLUTION_CACHE_VERSION,
        model,
        candidates,
      }),
    )
    .digest("hex");
}

function isNarrativeResolutionResult(value: unknown): value is NarrativeResolutionResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.narratives) || !Array.isArray(record.ignoredCandidateIds)) {
    return false;
  }

  const narrativesValid = record.narratives.every((narrative) => {
    if (!narrative || typeof narrative !== "object") {
      return false;
    }

    const row = narrative as Record<string, unknown>;
    return (
      typeof row.id === "string" &&
      typeof row.label === "string" &&
      typeof row.summary === "string" &&
      Array.isArray(row.aliases) &&
      row.aliases.every((alias) => typeof alias === "string") &&
      Array.isArray(row.candidateIds) &&
      row.candidateIds.every((candidateId) => typeof candidateId === "string") &&
      Array.isArray(row.documentIds) &&
      row.documentIds.every((documentId) => typeof documentId === "string")
    );
  });

  return (
    narrativesValid &&
    record.ignoredCandidateIds.every((candidateId) => typeof candidateId === "string")
  );
}

async function readCache(cacheKey: string) {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { cacheKey?: string; result?: unknown };
    if (parsed.cacheKey !== cacheKey || !isNarrativeResolutionResult(parsed.result)) {
      return null;
    }

    return parsed.result;
  } catch {
    return null;
  }
}

async function writeCache(cacheKey: string, result: NarrativeResolutionResult) {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(
    CACHE_PATH,
    JSON.stringify(
      {
        cacheKey,
        result,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function normalizeCandidates(candidates: NarrativeMergeCandidate[]) {
  return [...candidates]
    .sort((left, right) => {
      const leftWeight = left.commentCount + left.supportingSignalCount * 4;
      const rightWeight = right.commentCount + right.supportingSignalCount * 4;
      return rightWeight - leftWeight;
    })
    .slice(0, MAX_CANDIDATES)
    .map((candidate) => ({
      ...candidate,
      documents: [...(Array.isArray(candidate.documents) ? candidate.documents : [])]
        .sort((left, right) => {
          if (right.interactionCount !== left.interactionCount) {
            return right.interactionCount - left.interactionCount;
          }

          return right.createdAt.localeCompare(left.createdAt);
        })
        .slice(0, MAX_DOCUMENTS_PER_CANDIDATE)
        .map((document) => ({
          ...document,
          excerpt: document.excerpt.slice(0, 220),
        })),
    }));
}

function buildPrompt(candidates: NarrativeMergeCandidate[]) {
  return JSON.stringify(
    {
      task:
        "Resolve candidate clusters into concrete internet narratives and assign the supplied source documents to the right final narratives.",
      rules: [
        "Treat the supplied documents as evidence for what the real topic is.",
        "Merge different wording, aliases, fragments, and paraphrases that refer to the same real-world topic.",
        "Prefer specific named narratives tied to events, people, companies, memes, products, conflicts, policies, or public debates.",
        "Do not produce labels that are connective language, sentence fragments, generic filler, gratitude, time markers, or vague reaction phrasing.",
        "A final label must be interpretable on its own without the source post around it.",
        "Use 2-6 words for labels unless a single unmistakable entity name is clearly the right narrative.",
        "If labelSource is fallback or labelQualityScore is low, treat the candidate label as weak and use the documents to relabel it or ignore it.",
        "If namedPhraseSupport or sourceDiversity is high, prefer the concrete named topic those documents point to.",
        "Bad labels include examples like 'last year', 'thank you', 'been building', or 'now but'.",
        "Create a new narrative only when the topic is materially different from all existing candidates.",
        "Use candidateIds to show which heuristic clusters supported a final narrative.",
        "Use documentIds to show which supplied source documents belong to each final narrative.",
        "Only put a documentId in one final narrative.",
        "If a candidate is mostly generic noise, filler, or broken fragment language, put its id in ignoredCandidateIds.",
      ],
      candidates,
    },
    null,
    2,
  );
}

export async function resolveNarrativeClusters(
  candidates: NarrativeMergeCandidate[],
  generatedAt?: string | null,
  options: {
    blocking?: boolean;
  } = {},
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || candidates.length === 0) {
    return null;
  }

  const model = process.env.OPENAI_TREND_MODEL || DEFAULT_MODEL;
  const normalizedCandidates = normalizeCandidates(candidates);
  const cacheKey = getCacheKey(generatedAt, model, normalizedCandidates);
  const blocking = options.blocking ?? BLOCKING_AI_RESOLUTION;
  const cached = await readCache(cacheKey);
  if (cached) {
    return cached;
  }

  const existingResolution = inflightResolutions.get(cacheKey);
  if (existingResolution) {
    return blocking ? await existingResolution : null;
  }

  const resolutionPromise: Promise<NarrativeResolutionResult | null> = (async () => {
    const client = new OpenAI({ apiKey });
    const response = await client.responses.create({
      model,
      instructions:
        "You are a precise narrative classification engine for a trend dashboard. Return strict JSON only.",
      input: buildPrompt(normalizedCandidates),
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "narrative_resolution",
          strict: true,
          schema: RESULT_SCHEMA,
        },
        verbosity: "low",
      },
    });
    const parsed = JSON.parse(response.output_text);
    if (!isNarrativeResolutionResult(parsed)) {
      throw new Error("OpenAI narrative resolution returned an invalid payload.");
    }

    await writeCache(cacheKey, parsed);
    return parsed;
  })();

  inflightResolutions.set(cacheKey, resolutionPromise);

  if (!blocking) {
    void resolutionPromise.finally(() => {
      inflightResolutions.delete(cacheKey);
    });
    return null;
  }

  try {
    return await resolutionPromise;
  } finally {
    inflightResolutions.delete(cacheKey);
  }
}
