import "server-only";

import crypto from "node:crypto";
import OpenAI from "openai";
import { getAiNativeNarrativeConfig } from "@/lib/ai-native-narratives/config";
import {
  getLatestSuccessfulAiNativeNarrativeRun,
  hasAiNativeNarrativeSchema,
  insertFailedAiNativeNarrativeRun,
  storeSuccessfulAiNativeNarrativeRun,
} from "@/lib/ai-native-narratives/repository";
import type {
  AiNativeNarrativeCandidate,
  AiNativeNarrativeEvidence,
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
  if (normalizedLabel.length > 60) {
    errors.push("label exceeds 60 characters");
  }
  if (informativeTokens.length < 2) {
    errors.push("label is too generic");
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
        minItems: Math.max(8, Math.min(candidateCount, 12)),
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
        minItems: Math.max(4, Math.min(keptCount, 8)),
        maxItems: Math.min(candidateCount, keptCount + 4),
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            candidate_key: { type: "string", minLength: 3, maxLength: 80 },
            verdict: { type: "string", enum: ["keep", "discard"] },
            meme_score: { type: "number", minimum: 0, maximum: 100 },
            meme_reason: { type: "string", minLength: 12, maxLength: 220 },
          },
          required: ["candidate_key", "verdict", "meme_score", "meme_reason"],
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
        minItems: Math.max(4, Math.min(finalNarrativeCount, 8)),
        maxItems: finalNarrativeCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            rank: { type: "integer", minimum: 1, maximum: 100 },
            canonical_name: { type: "string", minLength: 4, maxLength: 80 },
            summary: { type: "string", minLength: 24, maxLength: 360 },
            research_summary: { type: "string", minLength: 40, maxLength: 700 },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            meme_score: { type: "number", minimum: 0, maximum: 100 },
            meme_reason: { type: "string", minLength: 12, maxLength: 220 },
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

function buildDiscoveryPrompt(candidateCount: number, maxEvidencePerCandidate: number) {
  const nowIso = new Date().toISOString();
  return [
    "Discover current web-native narratives with high memecoin potential for a production dashboard.",
    "You must use OpenAI web search as the upstream evidence source.",
    "Do not use social-media firehose assumptions, hashtag shards, fragment keys, heuristic topic aliases, or historical repair labels.",
    `Return up to ${candidateCount} candidate narratives.`,
    `Each candidate must include ${Math.max(2, maxEvidencePerCandidate - 1)} to ${maxEvidencePerCandidate} evidence items from the open web.`,
    "Every candidate must be a specific narrative object with a coherent subject, not a keyword shard.",
    "A valid candidate must feel emotionally charged, funny, controversial, absurd, visually memetic, or culturally striking.",
    "Prioritize personalities behaving unusually, viral clips, weird products, strange events, slogans, jokes, catchphrases, mascots, fandom flashpoints, internet drama, and stories people would parody or tokenize.",
    "Reject dry political analysis, routine policy coverage, capex, regulation, institutional finance, enterprise software, legal process, and macro stories unless the evidence clearly shows they are being memed or sloganized.",
    "Candidate labels must be punchy memecoin-ready handles, not headlines. Use 2 to 6 words, slogan-like, easy to meme, easy to visualize.",
    "Evidence must include url, title, snippet, source_domain, published_at, and a short note describing why the page supports the narrative.",
    "Prefer fresh evidence and diverse domains.",
    "For each candidate, assign meme_score from 0 to 100 based on virality, emotional intensity, simplicity, visualizability, and slogan potential.",
    "meme_reason must explain why the narrative could spread as a meme or memecoin.",
    "The dashboard should feel explainable, memetic, and auditable from cited evidence bundles.",
    `Generate the discovery set as of ${nowIso}.`,
  ].join("\n");
}

function buildSelectionPrompt(candidates: AiNativeNarrativeCandidate[], keptCount: number) {
  const candidateLines = candidates.flatMap((candidate, index) => [
    `Candidate ${index + 1}: ${candidate.candidateKey}`,
    `Name: ${candidate.provisionalName}`,
    `Summary: ${candidate.summary}`,
    `Confidence: ${candidate.confidence}`,
    `Meme score: ${candidate.memeScore}`,
    `Meme reason: ${candidate.memeReason}`,
    `Domains: ${candidate.sourceDomains.join(", ") || "unknown"}`,
  ]);

  return [
    "Select only the narratives with strong memecoin potential.",
    "Keep candidates that are viral, emotionally intense, simple, slogan-like, easy to visualize, joke-worthy, absurd, controversial, or culturally sticky.",
    "Discard candidates that feel too serious, too institutional, too policy-heavy, too technical, too complex, or too boring to meme.",
    `Return at most ${keptCount + 4} selections and mark each as keep or discard.`,
    "Use meme_score from 0 to 100 to reflect memecoin potential, not importance.",
    "",
    ...candidateLines,
  ].join("\n");
}

function buildCanonicalizationPrompt(candidates: AiNativeNarrativeCandidate[], finalNarrativeCount: number) {
  const candidateLines = candidates.flatMap((candidate, candidateIndex) => {
    const header = [
      `Candidate ${candidateIndex + 1}: ${candidate.candidateKey}`,
      `Name: ${candidate.provisionalName}`,
      `Summary: ${candidate.summary}`,
      `Confidence: ${candidate.confidence}`,
      `Meme score: ${candidate.memeScore}`,
      `Meme reason: ${candidate.memeReason}`,
      `First seen: ${candidate.firstSeenAt ?? "unknown"}`,
      `Last seen: ${candidate.lastSeenAt ?? "unknown"}`,
      `Domains: ${candidate.sourceDomains.join(", ") || "unknown"}`,
      "Evidence:",
    ];

    const evidenceLines = candidate.evidence.map((evidence, evidenceIndex) => {
      return [
        `  ${evidenceIndex + 1}. evidence_key=${evidence.evidenceKey}`,
        `     title=${evidence.title}`,
        `     source_domain=${evidence.sourceDomain}`,
        `     published_at=${evidence.publishedAt ?? "unknown"}`,
        `     url=${evidence.url}`,
        `     snippet=${evidence.snippet}`,
        `     note=${evidence.note ?? ""}`,
      ].join("\n");
    });

    return [...header, ...evidenceLines];
  });

  return [
    "Cluster the candidate narratives below into canonical memecoin-ready dashboard narratives.",
    "Use only the provided candidate bundle and cited evidence.",
    "Merge near-duplicates into one canonical narrative when they clearly describe the same narrative object.",
    "Do not emit fragment keys, keyword shards, hashtags, or alias-repair labels.",
    "Every canonical_name must already be the final dashboard label and must be 2 to 6 words.",
    "Canonical names must feel punchy, memetic, slogan-like, and tokenizable rather than descriptive or analyst-written.",
    "Every narrative must cite the candidate_keys and evidence_keys it used.",
    "Set status to active when the evidence supports a strong memecoin narrative, watch when it is weaker but still memetic, and discarded only when it should not appear on the board.",
    "For each final narrative, assign meme_score from 0 to 100 and meme_reason describing why people would remix, sloganize, parody, or tokenize it.",
    "Rank final narratives by meme_score multiplied by confidence, not by institutional importance.",
    `Return up to ${finalNarrativeCount} final canonical narratives.`,
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
  const candidates = parsed.candidates.slice(0, candidateLimit).map((row, index) => {
    const rawRow = row as RawDiscoveryCandidate;
    const provisionalName = toCanonicalNarrativeLabel(
      asNonEmptyString(rawRow.provisional_name) || `Narrative ${index + 1}`,
      index,
    );
    const summary = asNonEmptyString(rawRow.summary);
    if (!summary) {
      throw new Error(`Discovery candidate ${index + 1} is missing a summary.`);
    }

    const evidenceRows = Array.isArray(rawRow.evidence) ? (rawRow.evidence as RawDiscoveryEvidence[]) : [];
    if (evidenceRows.length < 2) {
      throw new Error(`Discovery candidate ${index + 1} does not have enough evidence.`);
    }

    const evidence: AiNativeNarrativeEvidence[] = evidenceRows.map((evidenceRow, evidenceIndex) => {
      const url = asNonEmptyString(evidenceRow.url);
      const title = asNonEmptyString(evidenceRow.title);
      const snippet = asNonEmptyString(evidenceRow.snippet);
      if (!url || !title || !snippet) {
        throw new Error(
          `Discovery candidate ${index + 1} evidence ${evidenceIndex + 1} is missing url/title/snippet.`,
        );
      }

      const explicitDomain = asNonEmptyString(evidenceRow.source_domain);
      const sourceDomain = resolveSourceDomain(url, explicitDomain);
      return {
        evidenceKey: buildEvidenceKey(url, title, snippet),
        url,
        title,
        snippet,
        sourceDomain,
        publishedAt: parseOptionalIsoString(evidenceRow.published_at),
        note: asNonEmptyString(evidenceRow.note),
      };
    });

    const sourceDomains = [...new Set(evidence.map((entry) => entry.sourceDomain))];
    const publishedTimestamps = evidence
      .map((entry) => Date.parse(entry.publishedAt ?? ""))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);

    return {
      candidateKey: uniqueSlug(
        asNonEmptyString(rawRow.candidate_key) || provisionalName,
        seenCandidateKeys,
      ),
      provisionalName,
      summary,
      confidence: clampConfidence(rawRow.confidence, 0.5),
      memeScore: clampMemeScore(rawRow.meme_score, 50),
      memeReason: asNonEmptyString(rawRow.meme_reason) ?? "Model did not explain meme potential.",
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
    } satisfies AiNativeNarrativeCandidate;
  });

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
      } satisfies AiNativeNarrativeCandidate;
    })
    .filter((candidate): candidate is AiNativeNarrativeCandidate => Boolean(candidate))
    .sort(
      (left, right) =>
        right.memeScore - left.memeScore ||
        right.confidence - left.confidence ||
        right.evidenceCount - left.evidenceCount,
    )
    .slice(0, params.keptCount);

  if (selectedCandidates.length < Math.max(4, Math.min(params.keptCount, 6))) {
    throw new Error("Memecoin selection pass retained too few candidates.");
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

  const narratives = parsed.narratives.slice(0, params.finalNarrativeCount).map((row, index) => {
    const rawRow = row as RawCanonicalNarrative;
    const canonicalName = toCanonicalNarrativeLabel(
      asNonEmptyString(rawRow.canonical_name) || `Narrative ${index + 1}`,
      index,
    );
    const candidateKeys = asStringArray(rawRow.candidate_keys, 12).filter((candidateKey) =>
      candidateByKey.has(candidateKey),
    );
    const evidenceKeys = asStringArray(rawRow.evidence_keys, 18).filter((evidenceKey) =>
      evidenceByKey.has(evidenceKey),
    );
    if (candidateKeys.length === 0) {
      throw new Error(`Canonical narrative "${canonicalName}" did not cite any valid candidate keys.`);
    }
    if (evidenceKeys.length < 2) {
      throw new Error(`Canonical narrative "${canonicalName}" did not cite enough valid evidence keys.`);
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
      throw new Error(`Canonical narrative "${canonicalName}" is missing summary text.`);
    }

    return {
      rank: Number.isFinite(Number(rawRow.rank)) ? Math.max(1, Math.round(Number(rawRow.rank))) : index + 1,
      canonicalId: uniqueSlug(canonicalName, seenCanonicalIds),
      canonicalName,
      summary,
      researchSummary,
      memeScore: clampMemeScore(rawRow.meme_score, 50),
      memeReason: asNonEmptyString(rawRow.meme_reason) ?? "Model did not explain meme potential.",
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
    } satisfies GeneratedAiNativeNarrative;
  });

  return narratives
    .sort(
      (left, right) =>
        right.memeScore * right.confidence - left.memeScore * left.confidence ||
        right.memeScore - left.memeScore ||
        right.confidence - left.confidence ||
        left.rank - right.rank ||
        left.canonicalId.localeCompare(right.canonicalId),
    )
    .map((narrative, index) => ({
      ...narrative,
      rank: index + 1,
    }));
}

async function requestDiscovery(params: {
  client: OpenAI;
  modelName: string;
  candidateCount: number;
  maxEvidencePerCandidate: number;
  searchContextSize: "low" | "medium" | "high";
  searchCountry: string;
  searchRegion: string | null;
  searchCity: string | null;
  searchTimezone: string;
}) {
  const response = await params.client.responses.create({
    model: params.modelName,
    input: buildDiscoveryPrompt(params.candidateCount, params.maxEvidencePerCandidate),
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
} = {}) {
  const config = getAiNativeNarrativeConfig();
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
      "Missing AI-native narrative schema. Apply backend/migrations/20260419_ai_native_canonical_narratives.sql first.",
    );
  }

  const latestRun = await getLatestSuccessfulAiNativeNarrativeRun();
  if (!options.force && latestRun?.generatedAt) {
    const elapsedSeconds = (Date.now() - Date.parse(latestRun.generatedAt)) / 1000;
    if (Number.isFinite(elapsedSeconds) && elapsedSeconds < config.refreshIntervalSeconds) {
      return {
        skipped: true,
        reason: "interval_guard",
        runId: latestRun.id,
        generatedAt: latestRun.generatedAt,
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
      const discovery = await requestDiscovery({
        client,
        modelName: config.modelName,
        candidateCount: config.discoveryCandidateCount,
        maxEvidencePerCandidate: config.maxEvidencePerCandidate,
        searchContextSize: config.searchContextSize,
        searchCountry: config.searchCountry,
        searchRegion: config.searchRegion,
        searchCity: config.searchCity,
        searchTimezone: config.searchTimezone,
      });
      lastDiscoveryResponse = {
        ...(discovery.rawResponseJson ?? {}),
        attempt,
      };
      const normalizedDiscovery = normalizeDiscoveryPayload(
        discovery.outputText,
        config.discoveryCandidateCount,
      );

      const keptCount = Math.max(
        config.finalNarrativeCount,
        Math.min(config.discoveryCandidateCount, 14),
      );
      const selection = await requestMemecoinSelection({
        client,
        modelName: config.modelName,
        candidates: normalizedDiscovery.candidates,
        keptCount,
      });
      lastSelectionResponse = {
        ...(selection.rawResponseJson ?? {}),
        attempt,
      };
      const selectedCandidates = normalizeSelectionPayload({
        content: selection.outputText,
        candidates: normalizedDiscovery.candidates,
        keptCount,
      });

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

      const runId = await storeSuccessfulAiNativeNarrativeRun({
        trigger: options.trigger ?? "manual",
        generatedAt: normalizedDiscovery.generatedAt,
        modelName: config.modelName,
        promptVersion: config.promptVersion,
        candidates: normalizedDiscovery.candidates,
        narratives,
        discoveryResponseJson: lastDiscoveryResponse,
        canonicalizationResponseJson: {
          selection: lastSelectionResponse,
          canonicalization: lastCanonicalizationResponse,
        },
        notesJson: {
          trigger: options.trigger ?? "manual",
          refreshIntervalSeconds: config.refreshIntervalSeconds,
          freshnessWindowMinutes: config.freshnessWindowMinutes,
          discoveryCandidateCount: config.discoveryCandidateCount,
          finalNarrativeCount: config.finalNarrativeCount,
          maxEvidencePerCandidate: config.maxEvidencePerCandidate,
          discoveryMode: "openai_web_search_memecoin_focus",
          selectedCandidateCount: selectedCandidates.length,
        },
      });

      return {
        skipped: false,
        runId,
        generatedAt: normalizedDiscovery.generatedAt,
        candidateCount: normalizedDiscovery.candidates.length,
        narrativeCount: narratives.length,
        evidenceCount: normalizedDiscovery.candidates.reduce(
          (total, candidate) => total + candidate.evidence.length,
          0,
        ),
      } as const;
    } catch (error) {
      lastError = error as Error;
      console.error("[ai-native-narratives] attempt failed", {
        attempt,
        trigger: options.trigger ?? "manual",
        error: String(lastError?.message ?? error),
      });
    }
  }

  await insertFailedAiNativeNarrativeRun({
    trigger: options.trigger ?? "manual",
    modelName: config.modelName,
    promptVersion: config.promptVersion,
    generatedAt: new Date().toISOString(),
    errorMessage: String(lastError?.message ?? "AI-native narrative pipeline failed."),
    discoveryResponseJson: lastDiscoveryResponse,
    canonicalizationResponseJson: {
      selection: lastSelectionResponse,
      canonicalization: lastCanonicalizationResponse,
    },
  });
  throw lastError ?? new Error("AI-native narrative pipeline failed.");
}
