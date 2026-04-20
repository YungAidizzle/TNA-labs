import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postgresMocks = vi.hoisted(() => {
  const query = vi.fn();
  const pool = { query };
  return {
    query,
    pool,
    getServerPostgresPool: vi.fn(() => pool),
    hasDatabaseUrl: vi.fn(() => true),
  };
});

const configMocks = vi.hoisted(() => ({
  getAiNativeNarrativeConfig: vi.fn(() => ({
    finalNarrativeCount: 100,
  })),
}));

vi.mock("@/lib/db/server-postgres", () => postgresMocks);
vi.mock("@/lib/ai-native-narratives/config", () => configMocks);

function createNarrativeRow(params: {
  runId: number;
  rank: number;
  canonicalId: string;
  canonicalName?: string;
  lastSeenAt?: string;
  createdAt?: string;
  runGeneratedAt?: string;
  runModelName?: string;
  runPromptVersion?: string;
  runNotesJson?: Record<string, unknown> | null;
}) {
  return {
    id: params.runId * 1_000 + params.rank,
    run_id: params.runId,
    rank: params.rank,
    canonical_id: params.canonicalId,
    canonical_name: params.canonicalName ?? params.canonicalId.replace(/-/g, " "),
    summary: `Summary for ${params.canonicalId}.`,
    research_summary: `Research summary for ${params.canonicalId}.`,
    meme_score: 80 - (params.rank % 9),
    meme_reason: "Highly remixable",
    meme_archetype: "visual_absurdity",
    visual_score: 78,
    dryness_score: 12,
    evidence_count: 6,
    source_count: 4,
    first_seen_at: "2026-04-19T21:00:00.000Z",
    last_seen_at: params.lastSeenAt ?? "2026-04-20T07:50:00.000Z",
    confidence: 0.86,
    status: "active",
    candidate_keys_json: [params.canonicalId],
    evidence_keys_json: [`${params.canonicalId}-evidence`],
    source_domains_json: ["example.com"],
    key_entities_json: [params.canonicalName ?? params.canonicalId.replace(/-/g, " ")],
    created_at: params.createdAt ?? "2026-04-20T08:05:00.000Z",
    updated_at: params.createdAt ?? "2026-04-20T08:05:00.000Z",
    run_generated_at: params.runGeneratedAt ?? null,
    run_model_name: params.runModelName ?? null,
    run_prompt_version: params.runPromptVersion ?? null,
    run_notes_json: params.runNotesJson ?? null,
  };
}

describe("ai-native narrative repository", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T10:00:00.000Z"));
    vi.clearAllMocks();
    postgresMocks.hasDatabaseUrl.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("assembles a 100-row board by backfilling the latest successful run from recent historical narratives", async () => {
    const latestRunRows = Array.from({ length: 63 }, (_, index) =>
      createNarrativeRow({
        runId: 77,
        rank: index + 1,
        canonicalId: `fresh-${index + 1}`,
        canonicalName: `Fresh${index + 1} Echo${index + 1}`,
      }),
    );
    const historicalRows = [
      {
        ...createNarrativeRow({
          runId: 76,
          rank: 1,
          canonicalId: "fresh-1",
          canonicalName: "Fresh1 Echo1",
          createdAt: "2026-04-20T07:00:00.000Z",
        }),
        run_generated_at: "2026-04-20T07:00:00.000Z",
      },
      ...Array.from({ length: 80 }, (_, index) => ({
        ...createNarrativeRow({
          runId: 76,
          rank: index + 2,
          canonicalId: `historical-${index + 1}`,
          canonicalName: `Historical${index + 1} Nova${index + 1}`,
          createdAt: "2026-04-20T07:00:00.000Z",
          runGeneratedAt: "2026-04-20T07:00:00.000Z",
          runModelName: "gpt-test",
          runPromptVersion: "test-v1",
          runNotesJson: { discoveryMode: "openai_web_search_memecoin_board_v4_board100" },
        }),
      })),
    ];

    postgresMocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 77,
            status: "succeeded",
            trigger: "hourly",
            generated_at: "2026-04-20T08:00:00.000Z",
            completed_at: "2026-04-20T08:05:00.000Z",
            candidate_count: 140,
            evidence_count: 420,
            narrative_count: 63,
            model_name: "gpt-test",
            prompt_version: "test-v1",
            error_message: null,
            notes_json: { runtimePath: "railway_hourly_daemon" },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 78,
            status: "failed",
            trigger: "hourly",
            generated_at: "2026-04-20T09:00:00.000Z",
            completed_at: "2026-04-20T09:01:00.000Z",
            candidate_count: 0,
            evidence_count: 0,
            narrative_count: 0,
            model_name: "gpt-test",
            prompt_version: "test-v1",
            error_message: "upstream timeout",
            notes_json: { runtimePath: "railway_hourly_daemon" },
          },
          {
            id: 77,
            status: "succeeded",
            trigger: "hourly",
            generated_at: "2026-04-20T08:00:00.000Z",
            completed_at: "2026-04-20T08:05:00.000Z",
            candidate_count: 140,
            evidence_count: 420,
            narrative_count: 63,
            model_name: "gpt-test",
            prompt_version: "test-v1",
            error_message: null,
            notes_json: { runtimePath: "railway_hourly_daemon" },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: latestRunRows,
      })
      .mockResolvedValueOnce({
        rows: historicalRows,
      });

    const { getLatestSuccessfulAiNativeNarrativeRunView } = await import(
      "@/lib/ai-native-narratives/repository"
    );
    const result = await getLatestSuccessfulAiNativeNarrativeRunView();

    expect(postgresMocks.query).toHaveBeenCalledTimes(4);
    expect(String(postgresMocks.query.mock.calls[0]?.[0] ?? "")).toContain("EXISTS");
    expect(String(postgresMocks.query.mock.calls[0]?.[0] ?? "")).toContain("FROM public.ai_narratives");
    expect(result.run?.id).toBe(77);
    expect(result.latestRun?.id).toBe(78);
    expect(result.latestFailureRun?.id).toBe(78);
    expect(result.latestRunNarratives).toHaveLength(63);
    expect(result.narratives).toHaveLength(100);
    expect(result.boardTargetCount).toBe(100);
    expect(result.boardFreshCount).toBe(63);
    expect(result.boardBackfillCount).toBe(37);
    expect(result.boardHasFullTarget).toBe(true);
    expect(result.narratives[0]?.canonicalId).toBe("fresh-1");
    expect(result.narratives[62]?.canonicalId).toBe("fresh-63");
    expect(result.narratives[63]?.canonicalId.startsWith("historical-")).toBe(true);
    expect(new Set(result.narratives.map((row) => row.canonicalId)).size).toBe(100);
    expect(result.freshnessMinutes).toBe(120);
  });

  it("filters incompatible historical backfill rows from legacy non-memecoin prompt families", async () => {
    const latestRunRows = Array.from({ length: 23 }, (_, index) =>
      createNarrativeRow({
        runId: 77,
        rank: index + 1,
        canonicalId: `fresh-${index + 1}`,
        canonicalName: `Fresh${index + 1} Echo${index + 1}`,
      }),
    );
    const historicalRows = [
      ...Array.from({ length: 8 }, (_, index) => ({
        ...createNarrativeRow({
          runId: 76,
          rank: index + 1,
          canonicalId: `compatible-${index + 1}`,
          canonicalName: `Compatible${index + 1} Meme${index + 1}`,
          createdAt: "2026-04-20T07:00:00.000Z",
          runGeneratedAt: "2026-04-20T07:00:00.000Z",
          runModelName: "gpt-test",
          runPromptVersion: "ai-native-canonical-narratives-memecoin-v3",
          runNotesJson: { discoveryMode: "openai_web_search_memecoin_board_v3" },
        }),
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        ...createNarrativeRow({
          runId: 75,
          rank: index + 1,
          canonicalId: `legacy-${index + 1}`,
          canonicalName: `Legacy${index + 1} Analyst${index + 1}`,
          createdAt: "2026-04-20T06:00:00.000Z",
          runGeneratedAt: "2026-04-20T06:00:00.000Z",
          runModelName: "gpt-test",
          runPromptVersion: "ai-native-canonical-narratives-v1",
          runNotesJson: { discoveryMode: "openai_web_search_only" },
        }),
      })),
    ];

    postgresMocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 77,
            status: "succeeded",
            trigger: "hourly",
            generated_at: "2026-04-20T08:00:00.000Z",
            completed_at: "2026-04-20T08:05:00.000Z",
            candidate_count: 140,
            evidence_count: 420,
            narrative_count: 23,
            model_name: "gpt-test",
            prompt_version: "ai-native-canonical-narratives-memecoin-v4-board100",
            error_message: null,
            notes_json: { discoveryMode: "openai_web_search_memecoin_board_v4_board100" },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 77,
            status: "succeeded",
            trigger: "hourly",
            generated_at: "2026-04-20T08:00:00.000Z",
            completed_at: "2026-04-20T08:05:00.000Z",
            candidate_count: 140,
            evidence_count: 420,
            narrative_count: 23,
            model_name: "gpt-test",
            prompt_version: "ai-native-canonical-narratives-memecoin-v4-board100",
            error_message: null,
            notes_json: { discoveryMode: "openai_web_search_memecoin_board_v4_board100" },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: latestRunRows,
      })
      .mockResolvedValueOnce({
        rows: historicalRows,
      });

    const { getLatestSuccessfulAiNativeNarrativeRunView } = await import(
      "@/lib/ai-native-narratives/repository"
    );
    const result = await getLatestSuccessfulAiNativeNarrativeRunView();

    expect(result.boardFreshCount).toBe(23);
    expect(result.boardBackfillCount).toBe(8);
    expect(result.boardHistoricalRowsConsidered).toBe(8);
    expect(result.narratives).toHaveLength(31);
    expect(result.narratives.some((row) => row.canonicalId.startsWith("legacy-"))).toBe(false);
    expect(result.narratives.filter((row) => row.canonicalId.startsWith("compatible-"))).toHaveLength(8);
  });

  it("returns an empty view when no successful run has persisted narratives", async () => {
    postgresMocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 90,
            status: "failed",
            trigger: "hourly",
            generated_at: "2026-04-20T09:30:00.000Z",
            completed_at: "2026-04-20T09:31:00.000Z",
            candidate_count: 0,
            evidence_count: 0,
            narrative_count: 0,
            model_name: "gpt-test",
            prompt_version: "test-v1",
            error_message: "upstream timeout",
            notes_json: { runtimePath: "railway_hourly_daemon" },
          },
        ],
      });

    const { getLatestSuccessfulAiNativeNarrativeRunView } = await import(
      "@/lib/ai-native-narratives/repository"
    );
    const result = await getLatestSuccessfulAiNativeNarrativeRunView();

    expect(result).toEqual({
      run: null,
      latestRun: {
        id: 90,
        status: "failed",
        trigger: "hourly",
        generatedAt: "2026-04-20T09:30:00.000Z",
        completedAt: "2026-04-20T09:31:00.000Z",
        candidateCount: 0,
        evidenceCount: 0,
        narrativeCount: 0,
        modelName: "gpt-test",
        promptVersion: "test-v1",
        errorMessage: "upstream timeout",
        notesJson: { runtimePath: "railway_hourly_daemon" },
      },
      latestFailureRun: {
        id: 90,
        status: "failed",
        trigger: "hourly",
        generatedAt: "2026-04-20T09:30:00.000Z",
        completedAt: "2026-04-20T09:31:00.000Z",
        candidateCount: 0,
        evidenceCount: 0,
        narrativeCount: 0,
        modelName: "gpt-test",
        promptVersion: "test-v1",
        errorMessage: "upstream timeout",
        notesJson: { runtimePath: "railway_hourly_daemon" },
      },
      recentRuns: [
        {
          id: 90,
          status: "failed",
          trigger: "hourly",
          generatedAt: "2026-04-20T09:30:00.000Z",
          completedAt: "2026-04-20T09:31:00.000Z",
          candidateCount: 0,
          evidenceCount: 0,
          narrativeCount: 0,
          modelName: "gpt-test",
          promptVersion: "test-v1",
          errorMessage: "upstream timeout",
          notesJson: { runtimePath: "railway_hourly_daemon" },
        },
      ],
      narratives: [],
      latestRunNarratives: [],
      boardTargetCount: 100,
      boardFreshCount: 0,
      boardBackfillCount: 0,
      boardHistoricalRowsConsidered: 0,
      boardHasFullTarget: false,
      freshnessMinutes: null,
    });
  });
});
