export type AiNativeNarrativeRunStatus = "succeeded" | "failed";

export type AiNativeNarrativeCandidateStatus = "detected" | "clustered" | "discarded";

export type AiNativeNarrativeStatus = "active" | "watch" | "discarded";

export type AiNativeNarrativeMemeArchetype =
  | "personality"
  | "conflict"
  | "catchphrase"
  | "mascot"
  | "visual_absurdity"
  | "pop_culture"
  | "tech_drama"
  | "political_meme"
  | "community_joke";

export type AiNativeNarrativeEvidence = {
  evidenceKey: string;
  url: string;
  title: string;
  snippet: string;
  sourceDomain: string;
  publishedAt: string | null;
  note: string | null;
};

export type AiNativeNarrativeCandidate = {
  candidateKey: string;
  provisionalName: string;
  summary: string;
  confidence: number;
  memeScore: number;
  memeReason: string;
  memeArchetype: AiNativeNarrativeMemeArchetype;
  visualScore: number;
  drynessScore: number;
  status: AiNativeNarrativeCandidateStatus;
  evidenceCount: number;
  sourceCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  sourceDomains: string[];
  evidence: AiNativeNarrativeEvidence[];
  rawPayloadJson?: Record<string, unknown> | null;
};

export type GeneratedAiNativeNarrative = {
  rank: number;
  canonicalId: string;
  canonicalName: string;
  summary: string;
  researchSummary: string;
  memeScore: number;
  memeReason: string;
  memeArchetype: AiNativeNarrativeMemeArchetype;
  visualScore: number;
  drynessScore: number;
  evidenceCount: number;
  sourceCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  confidence: number;
  status: AiNativeNarrativeStatus;
  candidateKeys: string[];
  evidenceKeys: string[];
  sourceDomains: string[];
  keyEntities: string[];
  rawPayloadJson?: Record<string, unknown> | null;
};

export type GeneratedAiNativeNarrativeRunPayload = {
  trigger: string;
  generatedAt: string;
  modelName: string;
  promptVersion: string;
  candidates: AiNativeNarrativeCandidate[];
  narratives: GeneratedAiNativeNarrative[];
  discoveryResponseJson?: Record<string, unknown> | null;
  canonicalizationResponseJson?: Record<string, unknown> | null;
  notesJson?: Record<string, unknown> | null;
};

export type StoredAiNativeNarrativeRun = {
  id: number;
  status: AiNativeNarrativeRunStatus;
  trigger: string;
  generatedAt: string;
  completedAt: string | null;
  candidateCount: number;
  evidenceCount: number;
  narrativeCount: number;
  modelName: string;
  promptVersion: string;
  errorMessage: string | null;
  notesJson: Record<string, unknown> | null;
};

export type StoredAiNativeNarrative = GeneratedAiNativeNarrative & {
  id: number;
  runId: number;
  createdAt: string;
  updatedAt: string;
};

export type AiNativeNarrativeRunView = {
  run: StoredAiNativeNarrativeRun | null;
  latestRun: StoredAiNativeNarrativeRun | null;
  latestFailureRun: StoredAiNativeNarrativeRun | null;
  recentRuns: StoredAiNativeNarrativeRun[];
  narratives: StoredAiNativeNarrative[];
  latestRunNarratives: StoredAiNativeNarrative[];
  boardTargetCount: number;
  boardFreshCount: number;
  boardBackfillCount: number;
  boardHistoricalRowsConsidered: number;
  boardHasFullTarget: boolean;
  freshnessMinutes: number | null;
};
