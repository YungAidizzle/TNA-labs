export type SharedTrendSnapshotStatus = "pending" | "succeeded" | "failed";

export type SharedTrendSnapshot = {
  id: number;
  status: SharedTrendSnapshotStatus;
  createdAt: string;
  generatedAt: string;
  completedAt: string | null;
  trendCount: number;
  modelName: string | null;
  promptVersion: string | null;
  errorMessage: string | null;
};

export type SharedTrendSnapshotItem = {
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

export type SharedTrendSnapshotView = {
  snapshot: SharedTrendSnapshot | null;
  trends: SharedTrendSnapshotItem[];
  freshnessMinutes: number | null;
};

export type GeneratedTrendCandidate = {
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
};

export type GeneratedTrendSnapshotPayload = {
  generatedAt: string;
  modelName: string;
  promptVersion: string;
  trends: GeneratedTrendCandidate[];
  rawResponseJson?: Record<string, unknown> | null;
  notesJson?: Record<string, unknown> | null;
};
