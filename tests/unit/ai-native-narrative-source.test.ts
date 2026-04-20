import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  getLatestSuccessfulAiNativeNarrativeRunView: vi.fn(),
}));

const configMocks = vi.hoisted(() => ({
  getAiNativeNarrativeConfig: vi.fn(() => ({
    enabled: true,
    refreshIntervalSeconds: 3600,
    freshnessWindowMinutes: 180,
    discoveryBatchCount: 4,
    discoveryCandidateCount: 240,
    selectionCandidateCount: 140,
    finalNarrativeCount: 100,
    maxEvidencePerCandidate: 3,
    modelName: "gpt-test",
    promptVersion: "test",
    searchContextSize: "medium",
    searchCountry: "US",
    searchRegion: null,
    searchCity: null,
    searchTimezone: "UTC",
    cronSecret: "cron-secret",
    cronSecrets: ["cron-secret"],
    cronSecretNames: ["CRON_SECRET"],
    openAiApiKey: "test-openai-key",
  })),
}));

vi.mock("@/lib/ai-native-narratives/repository", () => repositoryMocks);
vi.mock("@/lib/ai-native-narratives/config", () => configMocks);

function createNarrative(index = 1) {
  return {
    id: index,
    runId: 11,
    rank: index,
    canonicalId: `banana-cat-${index}`,
    canonicalName: index === 1 ? "Banana Cat" : `Banana Cat ${index}`,
    summary: `A meme-native narrative ${index} spreading across public web coverage.`,
    researchSummary: `Multiple open-web sources keep citing Banana Cat ${index} remixes and catchphrases.`,
    memeScore: 88,
    memeReason: "It has a simple visual mascot and repeatable joke format.",
    memeArchetype: "mascot" as const,
    visualScore: 91,
    drynessScore: 12,
    evidenceCount: 6,
    sourceCount: 4,
    firstSeenAt: "2026-04-20T06:00:00.000Z",
    lastSeenAt: "2026-04-20T09:30:00.000Z",
    confidence: 0.84,
    status: "active" as const,
    candidateKeys: ["banana-cat"],
    evidenceKeys: ["ev-1", "ev-2"],
    sourceDomains: ["example.com", "news.example"],
    keyEntities: [`Banana Cat ${index}`],
    createdAt: "2026-04-20T09:00:00.000Z",
    updatedAt: "2026-04-20T09:10:00.000Z",
  };
}

function createRunNotes() {
  return {
    runtimePath: "railway_hourly_daemon",
    executionEnvironment: "railway",
    schedulerStrategy: "railway_worker_hourly_authoritative",
    schedulerLabel: "Railway hourly worker",
  };
}

describe("AI-native narrative dashboard source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces stale source diagnostics with the latest failed hourly attempt", async () => {
    const boardRows = Array.from({ length: 100 }, (_, index) => createNarrative(index + 1));
    repositoryMocks.getLatestSuccessfulAiNativeNarrativeRunView.mockResolvedValueOnce({
      run: {
        id: 11,
        status: "succeeded",
        trigger: "railway-hourly-worker",
        generatedAt: "2026-04-20T06:00:00.000Z",
        completedAt: "2026-04-20T06:08:00.000Z",
        candidateCount: 140,
        evidenceCount: 420,
        narrativeCount: 63,
        modelName: "gpt-test",
        promptVersion: "test",
        errorMessage: null,
        notesJson: createRunNotes(),
      },
      latestRun: {
        id: 12,
        status: "failed",
        trigger: "railway-hourly-worker",
        generatedAt: "2026-04-20T10:00:00.000Z",
        completedAt: "2026-04-20T10:04:00.000Z",
        candidateCount: 0,
        evidenceCount: 0,
        narrativeCount: 0,
        modelName: "gpt-test",
        promptVersion: "test",
        errorMessage: "worker timed out",
        notesJson: createRunNotes(),
      },
      latestFailureRun: {
        id: 12,
        status: "failed",
        trigger: "railway-hourly-worker",
        generatedAt: "2026-04-20T10:00:00.000Z",
        completedAt: "2026-04-20T10:04:00.000Z",
        candidateCount: 0,
        evidenceCount: 0,
        narrativeCount: 0,
        modelName: "gpt-test",
        promptVersion: "test",
        errorMessage: "worker timed out",
        notesJson: createRunNotes(),
      },
      recentRuns: [],
      narratives: boardRows,
      latestRunNarratives: boardRows.slice(0, 63),
      boardTargetCount: 100,
      boardFreshCount: 63,
      boardBackfillCount: 37,
      boardHistoricalRowsConsidered: 144,
      boardHasFullTarget: true,
      freshnessMinutes: 240,
    });

    const { getAiNativeNarrativeDashboardState } = await import(
      "@/lib/dashboard/ai-native-narrative-source"
    );
    const {
      buildTrendDashboardStatusStripItems,
      buildTrendDashboardStatusStripSystemDetails,
    } = await import("@/lib/dashboard/status-strip");

    const vm = await getAiNativeNarrativeDashboardState({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "posts",
    });
    const diagnostics = vm.dataStatus?.freshnessDiagnostics;
    const items = buildTrendDashboardStatusStripItems(vm);
    const systemDetails = buildTrendDashboardStatusStripSystemDetails(vm);

    expect(vm.dataStatus?.sourceFreshness[0]?.sourceStatus).toBe("stale");
    expect(vm.leaderboard).toHaveLength(100);
    expect(diagnostics?.latestRunStatus).toBe("failed");
    expect(diagnostics?.latestFailureErrorMessage).toBe("worker timed out");
    expect(diagnostics?.latestSuccessfulRunAt).toBe("2026-04-20T06:00:00.000Z");
    expect(diagnostics?.boardTargetCount).toBe(100);
    expect(diagnostics?.boardServedNarrativeCount).toBe(100);
    expect(diagnostics?.boardBackfillNarrativeCount).toBe(37);
    expect(diagnostics?.chainBreakStage).toBe("read_model_refresh");
    expect(diagnostics?.pipelineHealthState).toBe("stale");
    expect(items.some((item) => item.label === "Status" && item.value === "Stale")).toBe(true);
    expect(
      systemDetails.some((item) => item.label === "Run state" && item.value === "Failed"),
    ).toBe(true);
    expect(
      systemDetails.some(
        (item) => item.label === "Trigger" && item.value === "Railway hourly worker",
      ),
    ).toBe(true);
    expect(
      systemDetails.some(
        (item) => item.label === "Scheduler" && item.value === "Railway hourly worker",
      ),
    ).toBe(true);
    expect(
      systemDetails.some((item) => item.label === "Runtime" && item.value === "Railway hourly daemon"),
    ).toBe(true);
  });

  it("marks the pipeline degraded instead of stale when the latest success is still fresh", async () => {
    const boardRows = Array.from({ length: 100 }, (_, index) => createNarrative(index + 1));
    repositoryMocks.getLatestSuccessfulAiNativeNarrativeRunView.mockResolvedValueOnce({
      run: {
        id: 21,
        status: "succeeded",
        trigger: "railway-hourly-worker",
        generatedAt: "2026-04-20T10:30:00.000Z",
        completedAt: "2026-04-20T10:36:00.000Z",
        candidateCount: 140,
        evidenceCount: 420,
        narrativeCount: 95,
        modelName: "gpt-test",
        promptVersion: "test",
        errorMessage: null,
        notesJson: createRunNotes(),
      },
      latestRun: {
        id: 22,
        status: "failed",
        trigger: "railway-hourly-worker",
        generatedAt: "2026-04-20T11:00:00.000Z",
        completedAt: "2026-04-20T11:02:00.000Z",
        candidateCount: 0,
        evidenceCount: 0,
        narrativeCount: 0,
        modelName: "gpt-test",
        promptVersion: "test",
        errorMessage: "temporary upstream error",
        notesJson: createRunNotes(),
      },
      latestFailureRun: {
        id: 22,
        status: "failed",
        trigger: "railway-hourly-worker",
        generatedAt: "2026-04-20T11:00:00.000Z",
        completedAt: "2026-04-20T11:02:00.000Z",
        candidateCount: 0,
        evidenceCount: 0,
        narrativeCount: 0,
        modelName: "gpt-test",
        promptVersion: "test",
        errorMessage: "temporary upstream error",
        notesJson: createRunNotes(),
      },
      recentRuns: [],
      narratives: boardRows,
      latestRunNarratives: boardRows.slice(0, 95),
      boardTargetCount: 100,
      boardFreshCount: 95,
      boardBackfillCount: 5,
      boardHistoricalRowsConsidered: 48,
      boardHasFullTarget: true,
      freshnessMinutes: 25,
    });

    const { getAiNativeNarrativeDashboardState } = await import(
      "@/lib/dashboard/ai-native-narrative-source"
    );

    const vm = await getAiNativeNarrativeDashboardState({
      scope: "overall",
      range: "24h",
      mode: "established",
      sort: "posts",
    });
    const diagnostics = vm.dataStatus?.freshnessDiagnostics;

    expect(vm.dataStatus?.sourceFreshness[0]?.sourceStatus).toBe("fresh");
    expect(vm.leaderboard).toHaveLength(100);
    expect(diagnostics?.latestRunStatus).toBe("failed");
    expect(diagnostics?.pipelineHealthState).toBe("degraded");
    expect(diagnostics?.chainBreakStage).toBe("none");
  });
});
