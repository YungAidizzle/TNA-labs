import "server-only";

import crypto from "node:crypto";
import os from "node:os";
import OpenAI from "openai";
import { curateAiNativeNarrativeBoard } from "@/lib/ai-native-narratives/board";
import { getAiNativeNarrativeConfig } from "@/lib/ai-native-narratives/config";
import {
  acquireAiNativeNarrativeExecutionLock,
  getLatestSuccessfulAiNativeNarrativeRun,
  getLatestSuccessfulAiNativeNarrativeRunView,
  hasAiNativeNarrativeSchema,
  insertFailedAiNativeNarrativeRun,
  storeSuccessfulAiNativeNarrativeRun,
} from "@/lib/ai-native-narratives/repository";
import { refreshStoredTrendDexscreenerMatches } from "@/lib/dashboard/trend-dexscreener-matches";
import type {
  AiNativeNarrativeCandidate,
  AiNativeNarrativeEvidence,
  AiNativeNarrativeMemeArchetype,
  GeneratedAiNativeNarrative,
} from "@/lib/ai-native-narratives/types";
import { hasDatabaseUrl } from "@/lib/db/server-postgres";

const HEADLINE_MARKER_TOKENS = new Set([
  "analysts",
  "because",
  "breaking",
  "explainer",
  "how",
  "latest",
  "report",
  "reports",
  "says",
  "watch",
  "why",
]);

const LABEL_GENERIC_TOKENS = new Set([
  "analysis",
  "board",
  "coverage",
  "debate",
  "discussion",
  "headline",
  "internet",
  "latest",
  "media",
  "moment",
  "narrative",
  "news",
  "story",
  "topic",
  "trend",
  "update",
  "viral",
  "wave",
]);

const LABEL_WEAK_TOKENS = new Set([
  "chaos",
  "crew",
  "duo",
  "energy",
  "era",
  "frenzy",
  "hype",
  "mania",
  "momentum",
  "saga",
  "storm",
  "vibes",
]);

const MEME_ARCHETYPES = [
  "personality",
  "conflict",
  "catchphrase",
  "mascot",
  "visual_absurdity",
  "pop_culture",
  "tech_drama",
  "political_meme",
  "community_joke",
] as const satisfies readonly AiNativeNarrativeMemeArchetype[];

const DISCOVERY_BATCH_FOCUSES = [
  "personalities behaving strangely, public feuds, creator meltdowns, and conflict-driven internet drama",
  "mascots, visual absurdities, weird products, screenshots, clips, and instantly imageable meme objects",
  "catchphrases, community jokes, fandom flashpoints, fan edits, remixes, and participatory joke formats",
  "pop-culture crossovers, celebrity internet moments, niche subculture spikes, and tech or political stories only when they are obviously being memed",
] as const;

type RawDiscoveryEvidence = {
  url?: unknown;
  title?: unknown;
  snippet?: unknown;
  source_domain?: unknown;
  published_at?: unknown;
  note?: unknown;
};

type RawDiscoveryCandidate = {
  candidate_key?: unknown;
  provisional_name?: unknown;
  summary?: unknown;
  confidence?: unknown;
  meme_score?: unknown;
  meme_reason?: unknown;
  meme_archetype?: unknown;
  visual_score?: unknown;
  dryness_score?: unknown;
  evidence?: unknown;
};

type RawDiscoveryPayload = {
  generated_context?: {
    as_of?: unknown;
    research_focus?: unknown;
    discovery_notes?: unknown;
  };
  candidates?: unknown;
};

type RawSelectionRow = {
  candidate_key?: unknown;
  verdict?: unknown;
  meme_score?: unknown;
  meme_reason?: unknown;
  meme_archetype?: unknown;
  visual_score?: unknown;
  dryness_score?: unknown;
};

type RawSelectionPayload = {
  generated_context?: {
    as_of?: unknown;
    selection_notes?: unknown;
  };
  selections?: unknown;
};

type RawCanonicalNarrative = {
  rank?: unknown;
  canonical_name?: unknown;
  summary?: unknown;
  research_summary?: unknown;
  confidence?: unknown;
  meme_score?: unknown;
  meme_reason?: unknown;
  meme_archetype?: unknown;
  visual_score?: unknown;
  dryness_score?: unknown;
  status?: unknown;
  candidate_keys?: unknown;
  evidence_keys?: unknown;
  key_entities?: unknown;
  source_domains?: unknown;
  evidence_count?: unknown;
  source_count?: unknown;
  first_seen_at?: unknown;
  last_seen_at?: unknown;
};

type RawCanonicalPayload = {
  generated_context?: {
    as_of?: unknown;
    clustering_notes?: unknown;
  };
  narratives?: unknown;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function asNonEmptyString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeWhitespace(value);
  return normalized || null;
}

function asStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeWhitespace(String(entry ?? "")))
    .filter((entry, index, source) => entry.length > 0 && source.indexOf(entry) === index)
    .slice(0, limit);
}

function normalizeWordTokens(value: string) {
  return normalizeWhitespace(value)
    .split(" ")
    .map((token) => token.replace(/^[^a-z0-9$#]+|[^a-z0-9$#]+$/gi, "").toLowerCase())
    .filter(Boolean);
}

function clampConfidence(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  if (numeric > 1) {
    return Math.min(1, Math.max(0, numeric / 100));
  }

  return Math.min(1, Math.max(0, numeric));
}

function clampMemeScore(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const scaled = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
  return Math.min(100, Math.max(0, scaled));
}

function clampHundredPointScore(value: unknown, fallback: number) {
  return clampMemeScore(value, fallback);
}

function asMemeArchetype(
  value: unknown,
  fallback: AiNativeNarrativeMemeArchetype = "community_joke",
): AiNativeNarrativeMemeArchetype {
  return MEME_ARCHETYPES.includes(String(value ?? "").trim() as AiNativeNarrativeMemeArchetype)
    ? (String(value).trim() as AiNativeNarrativeMemeArchetype)
    : fallback;
}

function parseOptionalIsoString(value: unknown) {
  const normalized = asNonEmptyString(value);
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function slugify(value: string) {
  const slug = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || crypto.randomUUID().slice(0, 8);
}

function sanitizeCanonicalLabelCandidate(value: string) {
  const sanitized = normalizeWhitespace(
    value
      .replace(/[\u2018\u2019\u201c\u201d"']/g, "")
      .replace(/[,:;?!]/g, " ")
      .replace(/[\u2013\u2014-]/g, " ")
      .replace(/\u2026/g, " ")
      .replace(/[()]/g, " ")
      .replace(/\s+/g, " "),
  );

  const filteredTokens = sanitized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token, index) => !(index === 0 && HEADLINE_MARKER_TOKENS.has(token.toLowerCase())))
    .filter((token) => token.toLowerCase() !== "breaking");

  return filteredTokens.slice(0, 8).join(" ");
}

function validateMemecoinNarrativeLabel(value: string) {
  const normalizedLabel = sanitizeCanonicalLabelCandidate(value);
  const tokens = normalizeWordTokens(normalizedLabel);
  const informativeTokens = tokens.filter((token) => !LABEL_GENERIC_TOKENS.has(token));
  const anchorTokens = informativeTokens.filter((token) => !LABEL_WEAK_TOKENS.has(token));
  const errors: string[] = [];

  if (!normalizedLabel) {
    errors.push("label is empty");
  }
  if (tokens.length < 2) {
    errors.push("label must contain at least 2 words");
  }
  if (tokens.length > 6) {
    errors.push("label must contain at most 6 words");
  }
  if (normalizedLabel.length > 42) {
    errors.push("label exceeds 42 characters");
  }
  if (informativeTokens.length < 2) {
    errors.push("label is too generic");
  }
  if (anchorTokens.length < 1) {
    errors.push("label lacks a concrete anchor token");
  }

  return {
    normalizedLabel,
    errors,
  };
}

function toCanonicalNarrativeLabel(value: string, index: number) {
  const primary = validateMemecoinNarrativeLabel(value);
  if (primary.errors.length === 0) {
    return primary.normalizedLabel;
  }

  const shortened = validateMemecoinNarrativeLabel(
    sanitizeCanonicalLabelCandidate(value)
      .split(" ")
      .filter(Boolean)
      .slice(0, 5)
      .join(" "),
  );
  if (shortened.errors.length === 0) {
    return shortened.normalizedLabel;
  }

  throw new Error(
    `Model trend ${index + 1} has an invalid memecoin label "${primary.normalizedLabel}": ${primary.errors.join("; ")}.`,
  );
}

function tryCanonicalNarrativeLabel(value: string, index: number) {
  try {
    return {
      canonicalLabel: toCanonicalNarrativeLabel(value, index),
      error: null,
    } as const;
  } catch (error) {
    return {
      canonicalLabel: null,
      error: error as Error,
    } as const;
  }
}

function uniqueSlug(value: string, seen: Set<string>) {
  const base = slugify(value);
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }

  let attempt = 2;
  while (seen.has(`${base}-${attempt}`)) {
    attempt += 1;
  }

  const slug = `${base}-${attempt}`;
  seen.add(slug);
  return slug;
}

function buildEvidenceKey(url: string, title: string, snippet: string) {
  return crypto
    .createHash("sha1")
    .update(`${url}\n${title}\n${snippet}`)
    .digest("hex")
    .slice(0, 16);
}

function truncateForPrompt(value: string | null | undefined, limit: number) {
  const normalized = normalizeWhitespace(value ?? "");
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function resolveSourceDomain(url: string, explicitDomain: string | null) {
  if (explicitDomain) {
    return explicitDomain.toLowerCase();
  }

  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "unknown";
  }
}

function buildDiscoverySchema(candidateCount: number, maxEvidencePerCandidate: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      generated_context: {
        type: "object",
        additionalProperties: false,
        properties: {
          as_of: { type: "string" },
          research_focus: { type: "string" },
          discovery_notes: { type: "string" },
        },
        required: ["as_of", "research_focus", "discovery_notes"],
      },
      candidates: {
        type: "array",
        minItems: Math.min(candidateCount, 4),
        maxItems: candidateCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            candidate_key: { type: "string", minLength: 4, maxLength: 80 },
            provisional_name: { type: "string", minLength: 4, maxLength: 80 },
            summary: { type: "string", minLength: 30, maxLength: 360 },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            meme_score: { type: "number", minimum: 0, maximum: 100 },
            meme_reason: { type: "string", minLength: 12, maxLength: 220 },
            meme_archetype: { type: "string", enum: [...MEME_ARCHETYPES] },
            visual_score: { type: "number", minimum: 0, maximum: 100 },
            dryness_score: { type: "number", minimum: 0, maximum: 100 },
            evidence: {
              type: "array",
              minItems: 2,
              maxItems: maxEvidencePerCandidate,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  url: { type: "string", minLength: 8, maxLength: 500 },
                  title: { type: "string", minLength: 4, maxLength: 220 },
                  snippet: { type: "string", minLength: 12, maxLength: 420 },
                  source_domain: { type: "string", minLength: 3, maxLength: 120 },
                  published_at: { type: "string", maxLength: 64 },
                  note: { type: "string", maxLength: 220 },
                },
                required: ["url", "title", "snippet", "source_domain", "published_at", "note"],
              },
            },
          },
          required: [
            "candidate_key",
            "provisional_name",
            "summary",
            "confidence",
            "meme_score",
            "meme_reason",
            "meme_archetype",
            "visual_score",
            "dryness_score",
            "evidence",
          ],
        },
      },
    },
    required: ["generated_context", "candidates"],
  } as const;
}

function buildSelectionSchema(candidateCount: number, keptCount: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      generated_context: {
        type: "object",
        additionalProperties: false,
        properties: {
          as_of: { type: "string" },
          selection_notes: { type: "string" },
        },
        required: ["as_of", "selection_notes"],
      },
      selections: {
        type: "array",
        minItems: Math.min(candidateCount, 4),
        maxItems: candidateCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            candidate_key: { type: "string", minLength: 3, maxLength: 80 },
            verdict: { type: "string", enum: ["keep", "discard"] },
            meme_score: { type: "number", minimum: 0, maximum: 100 },
            meme_reason: { type: "string", minLength: 12, maxLength: 220 },
            meme_archetype: { type: "string", enum: [...MEME_ARCHETYPES] },
            visual_score: { type: "number", minimum: 0, maximum: 100 },
            dryness_score: { type: "number", minimum: 0, maximum: 100 },
          },
          required: [
            "candidate_key",
            "verdict",
            "meme_score",
            "meme_reason",
            "meme_archetype",
            "visual_score",
            "dryness_score",
          ],
        },
      },
    },
    required: ["generated_context", "selections"],
  } as const;
}

function buildCanonicalSchema(finalNarrativeCount: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      generated_context: {
        type: "object",
        additionalProperties: false,
        properties: {
          as_of: { type: "string" },
          clustering_notes: { type: "string" },
        },
        required: ["as_of", "clustering_notes"],
      },
      narratives: {
        type: "array",
        minItems: 1,
        maxItems: finalNarrativeCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            rank: { type: "integer", minimum: 1, maximum: 500 },
            canonical_name: { type: "string", minLength: 4, maxLength: 80 },
            summary: { type: "string", minLength: 24, maxLength: 260 },
            research_summary: { type: "string", minLength: 40, maxLength: 420 },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            meme_score: { type: "number", minimum: 0, maximum: 100 },
            meme_reason: { type: "string", minLength: 12, maxLength: 220 },
            meme_archetype: { type: "string", enum: [...MEME_ARCHETYPES] },
            visual_score: { type: "number", minimum: 0, maximum: 100 },
            dryness_score: { type: "number", minimum: 0, maximum: 100 },
            status: { type: "string", enum: ["active", "watch", "discarded"] },
            candidate_keys: {
              type: "array",
              minItems: 1,
              maxItems: 12,
              items: { type: "string", minLength: 3, maxLength: 80 },
            },
            evidence_keys: {
              type: "array",
              minItems: 2,
              maxItems: 18,
              items: { type: "string", minLength: 6, maxLength: 64 },
            },
            key_entities: {
              type: "array",
              maxItems: 12,
              items: { type: "string", minLength: 2, maxLength: 80 },
            },
            source_domains: {
              type: "array",
              maxItems: 12,
              items: { type: "string", minLength: 3, maxLength: 120 },
            },
            evidence_count: { type: "integer", minimum: 1, maximum: 100 },
            source_count: { type: "integer", minimum: 1, maximum: 100 },
            first_seen_at: { type: "string", maxLength: 64 },
            last_seen_at: { type: "string", maxLength: 64 },
          },
          required: [
            "rank",
            "canonical_name",
            "summary",
            "research_summary",
            "confidence",
            "meme_score",
            "meme_reason",
            "meme_archetype",
            "visual_score",
            "dryness_score",
            "status",
            "candidate_keys",
            "evidence_keys",
            "key_entities",
            "source_domains",
            "evidence_count",
            "source_count",
            "first_seen_at",
            "last_seen_at",
          ],
        },
      },
    },
    required: ["generated_context", "narratives"],
  } as const;
}

function buildDiscoveryPrompt(
  candidateCount: number,
  maxEvidencePerCandidate: number,
  focus: string,
) {
  const nowIso = new Date().toISOString();
  return [
    "Discover current internet-native narratives with high memecoin creation potential for a production dashboard.",
    "You must use OpenAI web search as the upstream evidence source.",
    "Do not use social-media firehose assumptions, hashtag shards, fragment keys, heuristic topic aliases, or historical repair labels.",
    `This batch focus is: ${focus}.`,
    `Return up to ${candidateCount} candidate narratives for this focus area.`,
    `Each candidate must include ${Math.max(2, maxEvidencePerCandidate - 1)} to ${maxEvidencePerCandidate} evidence items from the open web.`,
    "Every candidate must be a specific narrative object with a coherent subject, not a keyword shard.",
    "A valid candidate must feel emotionally charged, funny, controversial, absurd, visually memetic, mascot-friendly, or culturally striking.",
    "Prioritize personalities behaving unusually, viral clips, weird products, mascots, fandom flashpoints, catchphrases, joke formats, internet drama, fan edits, visual reaction images, and stories people would parody, remix, or tokenize.",
    "Avoid turning broad news events into candidates unless there is a clear meme object, mascot, slogan, or internet behavior attached to them.",
    "Reject dry political analysis, routine policy coverage, capex, regulation, institutional finance, enterprise software, legal process, and macro stories unless the evidence clearly shows they are being memed or sloganized.",
    "Candidate labels must be punchy memecoin-ready handles, not headlines. Use 2 to 5 words, slogan-like, easy to meme, easy to visualize, and anchored to the person/object/phrase people would actually post.",
    "Bad labels: internet discourse, media storm, unhinged duo, corporate trend, policy backlash. Good labels: fruit love island, sad horse, nihilist penguin.",
    "Evidence must include url, title, snippet, source_domain, published_at, and a short note describing why the page supports the narrative.",
    "Prefer fresh evidence and diverse domains.",
    "For each candidate, assign meme_score from 0 to 100 based on virality, emotional intensity, simplicity, visualizability, and slogan potential.",
    "Assign meme_archetype as one of: personality, conflict, catchphrase, mascot, visual_absurdity, pop_culture, tech_drama, political_meme, community_joke.",
    "Assign visual_score from 0 to 100 based on how instantly imageable, mascot-like, or screenshotable the narrative is.",
    "Assign dryness_score from 0 to 100 where low is good and high means the narrative feels too institutional, analytical, or newsy for memecoin behavior.",
    "meme_reason must explain why the narrative could spread as a meme or memecoin.",
    "The dashboard should feel explainable, memetic, auditable from cited evidence bundles, and closer to internet culture than to a news briefing.",
    `Generate the discovery set as of ${nowIso}.`,
  ].join("\n");
}

function buildSelectionPrompt(candidates: AiNativeNarrativeCandidate[], keptCount: number) {
  const candidateLines = candidates.flatMap((candidate, index) => {
    const summary = truncateForPrompt(candidate.summary, 180);
    const reason = truncateForPrompt(candidate.memeReason, 120);
    return [
      `Candidate ${index + 1} | key=${candidate.candidateKey} | name=${candidate.provisionalName} | confidence=${candidate.confidence.toFixed(2)} | meme=${candidate.memeScore} | visual=${candidate.visualScore} | dryness=${candidate.drynessScore} | archetype=${candidate.memeArchetype} | domains=${candidate.sourceDomains.join(",") || "unknown"} | evidence=${candidate.evidenceCount}`,
      `Summary: ${summary}`,
      `Why memeable: ${reason}`,
    ];
  });

  return [
    "Select only the narratives with strong memecoin potential.",
    "Keep candidates that are viral, emotionally intense, simple, slogan-like, easy to visualize, joke-worthy, absurd, controversial, or culturally sticky.",
    "Discard candidates that feel too serious, too institutional, too policy-heavy, too technical, too complex, too broad, or too boring to meme.",
    "The retained set must feel balanced and curated. Aim for a spread across personalities, absurd visual objects, drama/conflict, catchphrases/community jokes, pop culture, and mascots.",
    "Do not let tech or political meme candidates dominate the set unless they are unmistakably meme-first rather than news-first.",
    `Return at most ${candidates.length} selections and mark each as keep or discard.`,
    "Use meme_score from 0 to 100 to reflect memecoin potential, not importance.",
    "Re-score visual_score and dryness_score if needed. Lower dryness is better.",
    "If a label is vague or generic, keep the candidate only if you can still justify a strong memecoin case from the evidence.",
    "",
    ...candidateLines,
  ].join("\n");
}

function buildCanonicalizationPrompt(candidates: AiNativeNarrativeCandidate[], finalNarrativeCount: number) {
  const candidateLines = candidates.flatMap((candidate, candidateIndex) => {
    const header = [
      `Candidate ${candidateIndex + 1} | key=${candidate.candidateKey} | name=${candidate.provisionalName} | confidence=${candidate.confidence.toFixed(2)} | meme=${candidate.memeScore} | visual=${candidate.visualScore} | dryness=${candidate.drynessScore} | archetype=${candidate.memeArchetype} | first_seen=${candidate.firstSeenAt ?? "unknown"} | last_seen=${candidate.lastSeenAt ?? "unknown"} | domains=${candidate.sourceDomains.join(",") || "unknown"}`,
      `Summary: ${truncateForPrompt(candidate.summary, 180)}`,
      `Why memeable: ${truncateForPrompt(candidate.memeReason, 120)}`,
      "Evidence hints:",
    ];

    const evidenceLines = candidate.evidence.map((evidence, evidenceIndex) => {
      return [
        `  ${evidenceIndex + 1}. evidence_key=${evidence.evidenceKey} | domain=${evidence.sourceDomain} | published_at=${evidence.publishedAt ?? "unknown"} | title=${truncateForPrompt(evidence.title, 120)} | note=${truncateForPrompt(evidence.note ?? evidence.snippet, 140)}`,
      ].join("");
    });

    return [...header, ...evidenceLines];
  });

  return [
    "Cluster the candidate narratives below into canonical memecoin-ready dashboard narratives.",
    "Use only the provided candidate bundle and cited evidence.",
    "Merge near-duplicates into one canonical narrative when they clearly describe the same narrative object.",
    "Do not emit fragment keys, keyword shards, hashtags, or alias-repair labels.",
    "Every canonical_name must already be the final dashboard label and must be 2 to 5 words.",
    "Canonical names must feel punchy, memetic, slogan-like, and tokenizable rather than descriptive or analyst-written.",
    "Avoid vague labels such as Unhinged Duo, Culture War, Media Storm, Corporate Trend, or Viral Moment when the evidence provides a stronger anchor noun, mascot, person, or catchphrase.",
    "Prefer labels that contain the concrete object/person/phrase the internet would actually latch onto.",
    "Every narrative must cite the candidate_keys and evidence_keys it used.",
    "Set status to active when the evidence supports a strong memecoin narrative, watch when it is weaker but still memetic, and discarded only when it should not appear on the board.",
    "For each final narrative, assign meme_score from 0 to 100 and meme_reason describing why people would remix, sloganize, parody, or tokenize it.",
    "Assign meme_archetype, visual_score, and dryness_score. Lower dryness is better.",
    "The final board should include a healthy spread of personalities, mascots, visual absurdities, drama/conflict, and catchphrase/community-joke style narratives when the evidence supports them.",
    "Rank final narratives by memecoin potential, not by institutional importance.",
    `Return up to ${finalNarrativeCount} final canonical narratives. If the evidence only supports fewer distinct narratives, return only the valid distinct narratives.`,
    "The final board must feel like internet culture with tradable meme energy, not analyst coverage.",
    "",
    ...candidateLines,
  ].join("\n");
}

function normalizeDiscoveryPayload(
  content: string,
  candidateLimit: number,
): { generatedAt: string; candidates: AiNativeNarrativeCandidate[] } {
  const parsed = JSON.parse(content) as RawDiscoveryPayload;
  if (!Array.isArray(parsed.candidates)) {
    throw new Error("AI-native narrative discovery payload is missing a candidates array.");
  }

  const seenCandidateKeys = new Set<string>();
  const candidates: AiNativeNarrativeCandidate[] = [];
  for (const [index, row] of parsed.candidates.slice(0, candidateLimit).entries()) {
    const rawRow = row as RawDiscoveryCandidate;
    const provisionalLabel = tryCanonicalNarrativeLabel(
      asNonEmptyString(rawRow.provisional_name) || `Narrative ${index + 1}`,
      index,
    );
    if (!provisionalLabel.canonicalLabel) {
      continue;
    }
    const provisionalName = provisionalLabel.canonicalLabel;
    const summary = asNonEmptyString(rawRow.summary);
    if (!summary) {
      continue;
    }

    const evidenceRows = Array.isArray(rawRow.evidence) ? (rawRow.evidence as RawDiscoveryEvidence[]) : [];
    if (evidenceRows.length < 2) {
      continue;
    }
    const evidence: AiNativeNarrativeEvidence[] = [];
    for (const evidenceRow of evidenceRows) {
      const url = asNonEmptyString(evidenceRow.url);
      const title = asNonEmptyString(evidenceRow.title);
      const snippet = asNonEmptyString(evidenceRow.snippet);
      if (!url || !title || !snippet) {
        continue;
      }

      const explicitDomain = asNonEmptyString(evidenceRow.source_domain);
      const sourceDomain = resolveSourceDomain(url, explicitDomain);
      evidence.push({
        evidenceKey: buildEvidenceKey(url, title, snippet),
        url,
        title,
        snippet,
        sourceDomain,
        publishedAt: parseOptionalIsoString(evidenceRow.published_at),
        note: asNonEmptyString(evidenceRow.note),
      });
    }
    if (evidence.length < 2) {
      continue;
    }

    const sourceDomains = [...new Set(evidence.map((entry) => entry.sourceDomain))];
    const publishedTimestamps = evidence
      .map((entry) => Date.parse(entry.publishedAt ?? ""))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);

    candidates.push({
      candidateKey: uniqueSlug(
        asNonEmptyString(rawRow.candidate_key) || provisionalName,
        seenCandidateKeys,
      ),
      provisionalName,
      summary,
      confidence: clampConfidence(rawRow.confidence, 0.5),
      memeScore: clampMemeScore(rawRow.meme_score, 50),
      memeReason: asNonEmptyString(rawRow.meme_reason) ?? "Model did not explain meme potential.",
      memeArchetype: asMemeArchetype(rawRow.meme_archetype),
      visualScore: clampHundredPointScore(rawRow.visual_score, 60),
      drynessScore: clampHundredPointScore(rawRow.dryness_score, 30),
      status: "detected",
      evidenceCount: evidence.length,
      sourceCount: sourceDomains.length,
      firstSeenAt:
        publishedTimestamps.length > 0 ? new Date(publishedTimestamps[0]).toISOString() : null,
      lastSeenAt:
        publishedTimestamps.length > 0
          ? new Date(publishedTimestamps[publishedTimestamps.length - 1]).toISOString()
          : null,
      sourceDomains,
      evidence,
      rawPayloadJson: {
        candidateKey: asNonEmptyString(rawRow.candidate_key),
      },
    } satisfies AiNativeNarrativeCandidate);
  }

  if (candidates.length === 0) {
    throw new Error("AI-native narrative discovery retained no valid candidates.");
  }

  return {
    generatedAt: parseOptionalIsoString(parsed.generated_context?.as_of) ?? new Date().toISOString(),
    candidates,
  };
}

function normalizeSelectionPayload(params: {
  content: string;
  candidates: AiNativeNarrativeCandidate[];
  keptCount: number;
}) {
  const parsed = JSON.parse(params.content) as RawSelectionPayload;
  if (!Array.isArray(parsed.selections)) {
    throw new Error("AI-native narrative selection payload is missing a selections array.");
  }

  const candidateByKey = new Map(
    params.candidates.map((candidate) => [candidate.candidateKey, candidate] as const),
  );

  const selectedCandidates = parsed.selections
    .map((selection) => {
      const rawSelection = selection as RawSelectionRow;
      const candidateKey = asNonEmptyString(rawSelection.candidate_key);
      if (!candidateKey || !candidateByKey.has(candidateKey)) {
        return null;
      }
      if (asNonEmptyString(rawSelection.verdict) !== "keep") {
        return null;
      }

      const existing = candidateByKey.get(candidateKey)!;
      return {
        ...existing,
        memeScore: clampMemeScore(rawSelection.meme_score, existing.memeScore),
        memeReason: asNonEmptyString(rawSelection.meme_reason) ?? existing.memeReason,
        memeArchetype: asMemeArchetype(rawSelection.meme_archetype, existing.memeArchetype),
        visualScore: clampHundredPointScore(rawSelection.visual_score, existing.visualScore),
        drynessScore: clampHundredPointScore(rawSelection.dryness_score, existing.drynessScore),
      } satisfies AiNativeNarrativeCandidate;
    })
    .filter((candidate): candidate is AiNativeNarrativeCandidate => Boolean(candidate))
    .sort(
      (left, right) =>
        right.memeScore - left.memeScore ||
        right.visualScore - left.visualScore ||
        left.drynessScore - right.drynessScore ||
        right.confidence - left.confidence ||
        right.evidenceCount - left.evidenceCount,
    )
    .slice(0, params.keptCount);

  if (selectedCandidates.length === 0) {
    throw new Error("Memecoin selection pass retained no candidates.");
  }

  return selectedCandidates;
}

function normalizeCanonicalPayload(params: {
  content: string;
  candidates: AiNativeNarrativeCandidate[];
  finalNarrativeCount: number;
}) {
  const parsed = JSON.parse(params.content) as RawCanonicalPayload;
  if (!Array.isArray(parsed.narratives)) {
    throw new Error("AI-native narrative canonicalization payload is missing a narratives array.");
  }

  const candidateByKey = new Map(params.candidates.map((candidate) => [candidate.candidateKey, candidate]));
  const evidenceByKey = new Map(
    params.candidates.flatMap((candidate) =>
      candidate.evidence.map((evidence) => [evidence.evidenceKey, evidence] as const),
    ),
  );
  const seenCanonicalIds = new Set<string>();
  const narratives: GeneratedAiNativeNarrative[] = [];
  for (const [index, row] of parsed.narratives.slice(0, params.finalNarrativeCount).entries()) {
    const rawRow = row as RawCanonicalNarrative;
    const canonicalLabel = tryCanonicalNarrativeLabel(
      asNonEmptyString(rawRow.canonical_name) || `Narrative ${index + 1}`,
      index,
    );
    if (!canonicalLabel.canonicalLabel) {
      continue;
    }
    const canonicalName = canonicalLabel.canonicalLabel;
    const candidateKeys = asStringArray(rawRow.candidate_keys, 12).filter((candidateKey) =>
      candidateByKey.has(candidateKey),
    );
    const evidenceKeys = asStringArray(rawRow.evidence_keys, 18).filter((evidenceKey) =>
      evidenceByKey.has(evidenceKey),
    );
    if (candidateKeys.length === 0) {
      continue;
    }
    if (evidenceKeys.length < 2) {
      continue;
    }

    const resolvedEvidence = evidenceKeys
      .map((evidenceKey) => evidenceByKey.get(evidenceKey))
      .filter((entry): entry is AiNativeNarrativeEvidence => Boolean(entry));
    const inferredDomains = [...new Set(resolvedEvidence.map((entry) => entry.sourceDomain))];
    const inferredTimestamps = resolvedEvidence
      .map((entry) => Date.parse(entry.publishedAt ?? ""))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
    const summary = asNonEmptyString(rawRow.summary);
    const researchSummary = asNonEmptyString(rawRow.research_summary);
    if (!summary || !researchSummary) {
      continue;
    }

    narratives.push({
      rank: Number.isFinite(Number(rawRow.rank)) ? Math.max(1, Math.round(Number(rawRow.rank))) : index + 1,
      canonicalId: uniqueSlug(canonicalName, seenCanonicalIds),
      canonicalName,
      summary,
      researchSummary,
      memeScore: clampMemeScore(rawRow.meme_score, 50),
      memeReason: asNonEmptyString(rawRow.meme_reason) ?? "Model did not explain meme potential.",
      memeArchetype: asMemeArchetype(rawRow.meme_archetype),
      visualScore: clampHundredPointScore(rawRow.visual_score, 60),
      drynessScore: clampHundredPointScore(rawRow.dryness_score, 30),
      evidenceCount: Math.max(evidenceKeys.length, Number(rawRow.evidence_count ?? 0) || 0),
      sourceCount: Math.max(inferredDomains.length, Number(rawRow.source_count ?? 0) || 0),
      firstSeenAt:
        parseOptionalIsoString(rawRow.first_seen_at) ??
        (inferredTimestamps.length > 0 ? new Date(inferredTimestamps[0]).toISOString() : null),
      lastSeenAt:
        parseOptionalIsoString(rawRow.last_seen_at) ??
        (inferredTimestamps.length > 0
          ? new Date(inferredTimestamps[inferredTimestamps.length - 1]).toISOString()
          : null),
      confidence: clampConfidence(rawRow.confidence, 0.5),
      status:
        asNonEmptyString(rawRow.status) === "watch"
          ? "watch"
          : asNonEmptyString(rawRow.status) === "discarded"
            ? "discarded"
            : "active",
      candidateKeys,
      evidenceKeys,
      sourceDomains:
        asStringArray(rawRow.source_domains, 12).length > 0
          ? asStringArray(rawRow.source_domains, 12)
          : inferredDomains,
      keyEntities: asStringArray(rawRow.key_entities, 12),
      rawPayloadJson: {
        modelRank: rawRow.rank ?? null,
        clusteringNotes: asNonEmptyString(parsed.generated_context?.clustering_notes),
      },
    } satisfies GeneratedAiNativeNarrative);
  }

  if (narratives.length === 0) {
    throw new Error("AI-native narrative canonicalization retained no valid narratives.");
  }

  return narratives
    .sort(
      (left, right) =>
        right.memeScore * right.confidence +
          right.visualScore * 0.2 -
          right.drynessScore * 0.18 -
          (left.memeScore * left.confidence + left.visualScore * 0.2 - left.drynessScore * 0.18) ||
        right.memeScore - left.memeScore ||
        right.visualScore - left.visualScore ||
        left.drynessScore - right.drynessScore ||
        right.confidence - left.confidence ||
        left.rank - right.rank ||
        left.canonicalId.localeCompare(right.canonicalId),
    )
    .map((narrative, index) => ({
      ...narrative,
      rank: index + 1,
    }));
}

function computeSetOverlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let shared = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) {
      shared += 1;
    }
  }

  return shared / Math.max(leftSet.size, rightSet.size);
}

function computeCandidateLabelOverlap(left: string, right: string) {
  const leftTokens = normalizeWordTokens(left).filter(
    (token) => !LABEL_GENERIC_TOKENS.has(token) && !LABEL_WEAK_TOKENS.has(token),
  );
  const rightTokens = normalizeWordTokens(right).filter(
    (token) => !LABEL_GENERIC_TOKENS.has(token) && !LABEL_WEAK_TOKENS.has(token),
  );

  return computeSetOverlap(leftTokens, rightTokens);
}

function computeCandidateQualityScore(candidate: AiNativeNarrativeCandidate) {
  const evidenceSupport = Math.min(20, candidate.evidenceCount * 4 + candidate.sourceCount * 2);
  const recencyTimestamp = Date.parse(candidate.lastSeenAt ?? "");
  const recencyHours = Number.isFinite(recencyTimestamp)
    ? Math.max(0, (Date.now() - recencyTimestamp) / 3_600_000)
    : null;
  const recencyBonus =
    recencyHours === null
      ? 0
      : recencyHours <= 6
        ? 8
        : recencyHours <= 24
          ? 5
          : recencyHours <= 72
            ? 2
            : 0;

  return (
    candidate.memeScore * 0.48 +
    candidate.visualScore * 0.18 +
    candidate.confidence * 100 * 0.16 +
    evidenceSupport +
    recencyBonus -
    candidate.drynessScore * 0.2
  );
}

function hasCandidateOverlap(
  left: AiNativeNarrativeCandidate,
  right: AiNativeNarrativeCandidate,
) {
  const labelOverlap = computeCandidateLabelOverlap(left.provisionalName, right.provisionalName);
  const evidenceOverlap = computeSetOverlap(
    left.evidence.map((entry) => entry.evidenceKey),
    right.evidence.map((entry) => entry.evidenceKey),
  );
  const domainOverlap = computeSetOverlap(left.sourceDomains, right.sourceDomains);

  return (
    left.candidateKey === right.candidateKey ||
    evidenceOverlap >= 0.34 ||
    (labelOverlap >= 0.6 && domainOverlap >= 0.34) ||
    (labelOverlap >= 0.75 && left.memeArchetype === right.memeArchetype)
  );
}

function mergeDiscoveryCandidatePool(
  candidates: AiNativeNarrativeCandidate[],
  limit: number,
) {
  const rankedPool = [...candidates].sort(
    (left, right) =>
      computeCandidateQualityScore(right) - computeCandidateQualityScore(left) ||
      right.memeScore - left.memeScore ||
      right.visualScore - left.visualScore ||
      left.drynessScore - right.drynessScore ||
      right.confidence - left.confidence,
  );
  const merged: AiNativeNarrativeCandidate[] = [];

  for (const candidate of rankedPool) {
    if (merged.length >= limit) {
      break;
    }
    if (merged.some((existing) => hasCandidateOverlap(existing, candidate))) {
      continue;
    }
    merged.push(candidate);
  }

  if (merged.length < Math.min(limit, candidates.length)) {
    for (const candidate of rankedPool) {
      if (merged.length >= limit) {
        break;
      }
      if (merged.some((existing) => existing.candidateKey === candidate.candidateKey)) {
        continue;
      }
      merged.push(candidate);
    }
  }

  return merged;
}

function backfillSelectedCandidates(
  selectedCandidates: AiNativeNarrativeCandidate[],
  fallbackCandidates: AiNativeNarrativeCandidate[],
  targetCount: number,
) {
  const filled = [...selectedCandidates];

  for (const candidate of fallbackCandidates) {
    if (filled.length >= targetCount) {
      break;
    }
    if (filled.some((existing) => existing.candidateKey === candidate.candidateKey)) {
      continue;
    }
    if (filled.some((existing) => hasCandidateOverlap(existing, candidate))) {
      continue;
    }
    filled.push(candidate);
  }

  return filled;
}

function planDiscoveryBatches(totalCandidateCount: number, batchCount: number) {
  const actualBatchCount = Math.max(1, Math.min(batchCount, DISCOVERY_BATCH_FOCUSES.length));
  const baseSize = Math.floor(totalCandidateCount / actualBatchCount);
  const remainder = totalCandidateCount % actualBatchCount;

  return Array.from({ length: actualBatchCount }, (_, index) => ({
    focus: DISCOVERY_BATCH_FOCUSES[index] ?? DISCOVERY_BATCH_FOCUSES.at(-1)!,
    candidateCount: baseSize + (index < remainder ? 1 : 0),
  })).filter((batch) => batch.candidateCount > 0);
}

async function requestDiscovery(params: {
  client: OpenAI;
  modelName: string;
  candidateCount: number;
  focus: string;
  maxEvidencePerCandidate: number;
  searchContextSize: "low" | "medium" | "high";
  searchCountry: string;
  searchRegion: string | null;
  searchCity: string | null;
  searchTimezone: string;
}) {
  const response = await params.client.responses.create({
    model: params.modelName,
    input: buildDiscoveryPrompt(
      params.candidateCount,
      params.maxEvidencePerCandidate,
      params.focus,
    ),
    text: {
      format: {
        type: "json_schema",
        name: "ai_native_narrative_discovery",
        strict: true,
        schema: buildDiscoverySchema(params.candidateCount, params.maxEvidencePerCandidate),
      },
      verbosity: "low",
    },
    tool_choice: { type: "web_search_preview" },
    tools: [
      {
        type: "web_search_preview",
        search_context_size: params.searchContextSize,
        user_location: {
          type: "approximate",
          country: params.searchCountry,
          region: params.searchRegion,
          city: params.searchCity,
          timezone: params.searchTimezone,
        },
      },
    ],
  });

  return {
    outputText: response.output_text,
    rawResponseJson: {
      id: response.id,
      model: response.model,
      output_text: response.output_text,
      usage: response.usage ?? null,
    } satisfies Record<string, unknown>,
  };
}

async function requestMemecoinSelection(params: {
  client: OpenAI;
  modelName: string;
  candidates: AiNativeNarrativeCandidate[];
  keptCount: number;
}) {
  const response = await params.client.responses.create({
    model: params.modelName,
    input: buildSelectionPrompt(params.candidates, params.keptCount),
    text: {
      format: {
        type: "json_schema",
        name: "ai_native_narrative_memecoin_selection",
        strict: true,
        schema: buildSelectionSchema(params.candidates.length, params.keptCount),
      },
      verbosity: "low",
    },
  });

  return {
    outputText: response.output_text,
    rawResponseJson: {
      id: response.id,
      model: response.model,
      output_text: response.output_text,
      usage: response.usage ?? null,
    } satisfies Record<string, unknown>,
  };
}

async function requestCanonicalization(params: {
  client: OpenAI;
  modelName: string;
  candidates: AiNativeNarrativeCandidate[];
  finalNarrativeCount: number;
}) {
  const response = await params.client.responses.create({
    model: params.modelName,
    input: buildCanonicalizationPrompt(params.candidates, params.finalNarrativeCount),
    text: {
      format: {
        type: "json_schema",
        name: "ai_native_narrative_canonicalization",
        strict: true,
        schema: buildCanonicalSchema(params.finalNarrativeCount),
      },
      verbosity: "low",
    },
  });

  return {
    outputText: response.output_text,
    rawResponseJson: {
      id: response.id,
      model: response.model,
      output_text: response.output_text,
      usage: response.usage ?? null,
    } satisfies Record<string, unknown>,
  };
}

export async function runAiNativeNarrativePipeline(options: {
  force?: boolean;
  trigger?: string;
  runtimePath?: string;
  executionEnvironment?: string;
  schedulerStrategy?: string;
  schedulerLabel?: string;
} = {}) {
  const config = getAiNativeNarrativeConfig();
  const trigger = options.trigger ?? "manual";
  const runtimePath = options.runtimePath ?? null;
  const executionEnvironment = options.executionEnvironment ?? null;
  const schedulerStrategy = options.schedulerStrategy ?? null;
  const schedulerLabel = options.schedulerLabel ?? null;
  const baseRunNotes = {
    trigger,
    runtimePath,
    executionEnvironment,
    schedulerStrategy,
    schedulerLabel,
    hostname: os.hostname(),
    pid: process.pid,
    nodeVersion: process.version,
    deploymentId:
      process.env.RAILWAY_DEPLOYMENT_ID?.trim() ||
      process.env.VERCEL_DEPLOYMENT_ID?.trim() ||
      null,
    serviceInstanceId:
      process.env.RAILWAY_REPLICA_ID?.trim() ||
      process.env.HOSTNAME?.trim() ||
      null,
    gitCommitSha:
      process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
      process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
      null,
  } satisfies Record<string, unknown>;
  if (!config.enabled) {
    return {
      skipped: true,
      reason: "disabled",
    } as const;
  }

  if (!hasDatabaseUrl()) {
    throw new Error("Missing DATABASE_URL for AI-native narrative worker.");
  }

  if (!config.openAiApiKey) {
    throw new Error("Missing OPENAI_API_KEY for AI-native narrative worker.");
  }

  if (!(await hasAiNativeNarrativeSchema())) {
    throw new Error(
      "Missing AI-native narrative schema. Apply backend/migrations/20260419_ai_native_canonical_narratives.sql, backend/migrations/20260419_ai_native_canonical_narratives_memecoin_focus.sql, and backend/migrations/20260419_ai_native_canonical_narratives_memecoin_quality_v3.sql first.",
    );
  }

  const executionLock = await acquireAiNativeNarrativeExecutionLock();
  if (!executionLock) {
    console.warn("[ai-native-narratives] execution skipped because another worker holds the lock", {
      trigger,
      runtimePath,
    });
    return {
      skipped: true,
      reason: "execution_lock",
      trigger,
      runtimePath,
    } as const;
  }

  try {
    const latestRun = await getLatestSuccessfulAiNativeNarrativeRun();
    if (!options.force && latestRun?.generatedAt) {
      const elapsedSeconds = (Date.now() - Date.parse(latestRun.generatedAt)) / 1000;
      if (Number.isFinite(elapsedSeconds) && elapsedSeconds < config.refreshIntervalSeconds) {
        return {
          skipped: true,
          reason: "interval_guard",
          runId: latestRun.id,
          generatedAt: latestRun.generatedAt,
          trigger,
          runtimePath,
        } as const;
      }
    }

    const client = new OpenAI({ apiKey: config.openAiApiKey });
    let lastError: Error | null = null;
    let lastDiscoveryResponse: Record<string, unknown> | null = null;
    let lastSelectionResponse: Record<string, unknown> | null = null;
    let lastCanonicalizationResponse: Record<string, unknown> | null = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const discoveryPlan = planDiscoveryBatches(
          config.discoveryCandidateCount,
          config.discoveryBatchCount,
        );
        const discoveryBatchResponses: Array<Record<string, unknown>> = [];
        const rawDiscoveredCandidates: AiNativeNarrativeCandidate[] = [];
        let discoveryGeneratedAt: string | null = null;

        for (const [batchIndex, batch] of discoveryPlan.entries()) {
          try {
            const discovery = await requestDiscovery({
              client,
              modelName: config.modelName,
              candidateCount: batch.candidateCount,
              focus: batch.focus,
              maxEvidencePerCandidate: config.maxEvidencePerCandidate,
              searchContextSize: config.searchContextSize,
              searchCountry: config.searchCountry,
              searchRegion: config.searchRegion,
              searchCity: config.searchCity,
              searchTimezone: config.searchTimezone,
            });
            const normalizedDiscovery = normalizeDiscoveryPayload(
              discovery.outputText,
              batch.candidateCount,
            );
            rawDiscoveredCandidates.push(...normalizedDiscovery.candidates);
            const generatedAtTimestamp = Date.parse(normalizedDiscovery.generatedAt);
            if (
              Number.isFinite(generatedAtTimestamp) &&
              (!discoveryGeneratedAt ||
                generatedAtTimestamp > Date.parse(discoveryGeneratedAt))
            ) {
              discoveryGeneratedAt = normalizedDiscovery.generatedAt;
            }

            discoveryBatchResponses.push({
              ...(discovery.rawResponseJson ?? {}),
              batchIndex,
              focus: batch.focus,
              candidateCountRequested: batch.candidateCount,
              candidateCountRetained: normalizedDiscovery.candidates.length,
              generatedAt: normalizedDiscovery.generatedAt,
            });
          } catch (error) {
            discoveryBatchResponses.push({
              batchIndex,
              focus: batch.focus,
              candidateCountRequested: batch.candidateCount,
              error: String((error as Error)?.message ?? error ?? "unknown discovery batch failure"),
            });
            console.error("[ai-native-narratives] discovery batch failed", {
              attempt,
              batchIndex,
              focus: batch.focus,
              error: String((error as Error)?.message ?? error),
            });
          }
        }

        lastDiscoveryResponse = {
          attempt,
          batches: discoveryBatchResponses,
        };

        // The board read path can backfill to the 100-row target from historical successful runs.
        // The worker only needs a viable fresh pool here, not a board-sized pool, before moving
        // into selection and canonicalization.
        const minimumViableCandidatePool = Math.max(
          12,
          Math.min(24, Math.ceil(config.finalNarrativeCount * 0.12)),
        );
        if (rawDiscoveredCandidates.length < minimumViableCandidatePool) {
          throw new Error(
            `AI-native narrative discovery retained ${rawDiscoveredCandidates.length} valid candidates across ${discoveryPlan.length} batches; need at least ${minimumViableCandidatePool}.`,
          );
        }

        const mergedCandidates = mergeDiscoveryCandidatePool(
          rawDiscoveredCandidates,
          Math.max(config.selectionCandidateCount, config.finalNarrativeCount + 40),
        );
        if (mergedCandidates.length < minimumViableCandidatePool) {
          throw new Error(
            `AI-native narrative discovery deduped down to ${mergedCandidates.length} candidates; need at least ${minimumViableCandidatePool}.`,
          );
        }

        const selectionInputCandidates = mergedCandidates.slice(
          0,
          Math.min(mergedCandidates.length, config.selectionCandidateCount),
        );
        const keptCount = Math.min(
          selectionInputCandidates.length,
          Math.max(config.finalNarrativeCount + 24, Math.ceil(config.finalNarrativeCount * 1.24)),
        );
        const selection = await requestMemecoinSelection({
          client,
          modelName: config.modelName,
          candidates: selectionInputCandidates,
          keptCount,
        });
        lastSelectionResponse = {
          ...(selection.rawResponseJson ?? {}),
          attempt,
        };
        const selectedCandidates = backfillSelectedCandidates(
          normalizeSelectionPayload({
            content: selection.outputText,
            candidates: selectionInputCandidates,
            keptCount,
          }),
          selectionInputCandidates,
          keptCount,
        );

        const canonicalization = await requestCanonicalization({
          client,
          modelName: config.modelName,
          candidates: selectedCandidates,
          finalNarrativeCount: config.finalNarrativeCount,
        });
        lastCanonicalizationResponse = {
          ...(canonicalization.rawResponseJson ?? {}),
          attempt,
        };
        const narratives = normalizeCanonicalPayload({
          content: canonicalization.outputText,
          candidates: selectedCandidates,
          finalNarrativeCount: config.finalNarrativeCount,
        });
        const curatedNarratives = curateAiNativeNarrativeBoard(
          narratives,
          config.finalNarrativeCount,
        );

        const runId = await storeSuccessfulAiNativeNarrativeRun({
          trigger,
          generatedAt: discoveryGeneratedAt ?? new Date().toISOString(),
          modelName: config.modelName,
          promptVersion: config.promptVersion,
          candidates: selectionInputCandidates,
          narratives: curatedNarratives,
          discoveryResponseJson: lastDiscoveryResponse,
          canonicalizationResponseJson: {
            selection: lastSelectionResponse,
            canonicalization: lastCanonicalizationResponse,
          },
          notesJson: {
            ...baseRunNotes,
            refreshIntervalSeconds: config.refreshIntervalSeconds,
            freshnessWindowMinutes: config.freshnessWindowMinutes,
            discoveryBatchCount: config.discoveryBatchCount,
            discoveryCandidateCount: config.discoveryCandidateCount,
            selectionCandidateCount: config.selectionCandidateCount,
            finalNarrativeCount: config.finalNarrativeCount,
            maxEvidencePerCandidate: config.maxEvidencePerCandidate,
            discoveryMode: "openai_web_search_memecoin_board_v4_board100",
            rawDiscoveredCandidateCount: rawDiscoveredCandidates.length,
            mergedCandidateCount: mergedCandidates.length,
            selectionInputCandidateCount: selectionInputCandidates.length,
            selectedCandidateCount: selectedCandidates.length,
            curatedNarrativeCount: curatedNarratives.length,
          },
        });
        try {
          const latestView = await getLatestSuccessfulAiNativeNarrativeRunView();
          await refreshStoredTrendDexscreenerMatches({
            narratives: latestView.narratives.map((narrative) => ({
              topicKey: narrative.canonicalId,
              topicLabel: narrative.canonicalName,
              summary: narrative.summary,
              keyEntities: narrative.keyEntities,
              sourceRunId: narrative.runId,
              sourceNarrativeId: narrative.id,
            })),
          });
        } catch (trendDexMatchError) {
          console.error("[ai-native-narratives] stored DexScreener trend matching failed", {
            runId,
            trigger,
            runtimePath,
            error: String((trendDexMatchError as Error)?.message ?? trendDexMatchError),
          });
        }

        return {
          skipped: false,
          runId,
          generatedAt: discoveryGeneratedAt ?? new Date().toISOString(),
          candidateCount: selectionInputCandidates.length,
          narrativeCount: curatedNarratives.length,
          evidenceCount: selectionInputCandidates.reduce(
            (total, candidate) => total + candidate.evidence.length,
            0,
          ),
          trigger,
          runtimePath,
        } as const;
      } catch (error) {
        lastError = error as Error;
        console.error("[ai-native-narratives] attempt failed", {
          attempt,
          trigger,
          runtimePath,
          error: String(lastError?.message ?? error),
        });
      }
    }

    await insertFailedAiNativeNarrativeRun({
      trigger,
      modelName: config.modelName,
      promptVersion: config.promptVersion,
      generatedAt: new Date().toISOString(),
      errorMessage: String(lastError?.message ?? "AI-native narrative pipeline failed."),
      discoveryResponseJson: lastDiscoveryResponse,
      canonicalizationResponseJson: {
        selection: lastSelectionResponse,
        canonicalization: lastCanonicalizationResponse,
      },
      notesJson: {
        ...baseRunNotes,
        refreshIntervalSeconds: config.refreshIntervalSeconds,
        freshnessWindowMinutes: config.freshnessWindowMinutes,
        failureRecordedAt: new Date().toISOString(),
      },
    });
    throw lastError ?? new Error("AI-native narrative pipeline failed.");
  } finally {
    await executionLock.release();
  }
}
