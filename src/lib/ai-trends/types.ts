export type SharedAiTrendSnapshotStatus = "pending" | "succeeded" | "failed";

export type SharedAiTrendSnapshot = {
  id: number;
  status: SharedAiTrendSnapshotStatus;
  createdAt: string;
  generatedAt: string;
  completedAt: string | null;
  trendCount: number;
  modelName: string | null;
  promptVersion: string | null;
  errorMessage: string | null;
};

export type SharedAiTrendSnapshotItem = {
  id: number;
  snapshotId: number;
  rank: number;
  trendKey: string;
  title: string;
  summary: string;
  confidenceScore: number;
  aiRankScore: number;
  importanceNote: string | null;
  category: string | null;
  sourceScope: string | null;
  sourceCount: number | null;
  generatedAt: string;
};

export type SharedAiTrendSnapshotView = {
  snapshot: SharedAiTrendSnapshot | null;
  trends: SharedAiTrendSnapshotItem[];
  freshnessMinutes: number | null;
};

export type GeneratedAiTrendCandidate = {
  rank: number;
  trendKey: string;
  title: string;
  summary: string;
  confidenceScore: number;
  aiRankScore: number;
  importanceNote: string | null;
  category: string | null;
  sourceScope: string | null;
  sourceCount: number | null;
  narrativeRelevance?: "high" | "medium" | "low" | null;
  narrativeScore?: number | null;
  rankingSignals?: string[] | null;
};

export type GeneratedAiTrendSnapshotPayload = {
  generatedAt: string;
  modelName: string;
  promptVersion: string;
  trends: GeneratedAiTrendCandidate[];
  rawResponseJson?: Record<string, unknown> | null;
  notesJson?: Record<string, unknown> | null;
};
