import "server-only";

import { TrendNameSource, TrendNameStatus } from "@/types/view-models";

export type VisibleTopicCandidate = {
  topicKey: string;
  rawTopicKeys: string[];
  rawLabel: string;
  totalMentions: number;
  uniquePosts: number;
  uniqueAuthors: number;
  platformCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  windowStartIso?: string | null;
  windowEndIso: string;
};

export type VisibleTopicEnrichment = {
  topicKey: string;
  rawLabel: string;
  status: "ok" | "mixed" | "insufficient_evidence" | "junk";
  canonicalName: string | null;
  fallbackLabel: string | null;
  nameStatus: TrendNameStatus;
  nameSource: TrendNameSource;
  shortDescription: string | null;
  contextParagraph: string | null;
  narrativeSummary: string | null;
  whyAttention: string | null;
  evidencePostIds: string[];
  keyEntities: string[];
  trendCategory: string | null;
  mixedSignals: string[];
  abstainReason: string | null;
  summaryConfidence: number;
  modelName: string | null;
  promptVersion: string | null;
  generatedAt: string | null;
  refreshedAt: string | null;
  asOfWindowEnd: string | null;
  inputHash?: string | null;
  expiresAt?: string | null;
};

const REQUEST_TIME_ENRICHMENT_ERROR =
  "Request-path visible topic enrichment is permanently disabled. Trend naming must be generated upstream by the authoritative background worker.";

export function canRunVisibleTopicEnrichment() {
  return false;
}

export function canRunLiveVisibleTopicEnrichment() {
  return false;
}

export async function ensureVisibleTopicEnrichments(
  _candidates: VisibleTopicCandidate[],
): Promise<Map<string, VisibleTopicEnrichment>> {
  throw new Error(REQUEST_TIME_ENRICHMENT_ERROR);
}
