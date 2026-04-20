import "server-only";

import type { PoolClient } from "pg";
import { assembleAiNativeNarrativeBoard, computeAiNativeNarrativeQualityScore } from "@/lib/ai-native-narratives/board";
import { getAiNativeNarrativeConfig } from "@/lib/ai-native-narratives/config";
import { getServerPostgresPool, hasDatabaseUrl } from "@/lib/db/server-postgres";
import type {
  AiNativeNarrativeCandidate,
  AiNativeNarrativeMemeArchetype,
  AiNativeNarrativeRunView,
  GeneratedAiNativeNarrativeRunPayload,
  StoredAiNativeNarrative,
  StoredAiNativeNarrativeRun,
} from "@/lib/ai-native-narratives/types";

type RunRow = {
  id: number;
  status: "succeeded" | "failed";
  trigger: string;
  generated_at: Date | string;
  completed_at: Date | string | null;
  candidate_count: number;
  evidence_count: number;
  narrative_count: number;
  model_name: string;
  prompt_version: string;
  error_message: string | null;
  notes_json: unknown;
};

type NarrativeRow = {
  id: number;
  run_id: number;
  rank: number;
  canonical_id: string;
  canonical_name: string;
  summary: string;
  research_summary: string;
  meme_score: number | string;
  meme_reason: string | null;
  meme_archetype: string | null;
  visual_score: number | string;
  dryness_score: number | string;
  evidence_count: number;
  source_count: number;
  first_seen_at: Date | string | null;
  last_seen_at: Date | string | null;
  confidence: number | string;
  status: "active" | "watch" | "discarded";
  candidate_keys_json: unknown;
  evidence_keys_json: unknown;
  source_domains_json: unknown;
  key_entities_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

type HistoricalNarrativeRow = NarrativeRow & {
  run_generated_at: Date | string;
};

function toIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry, index, source) => entry.length > 0 && source.indexOf(entry) === index);
}

function asRecord(value: unknown) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }

  return { ...(value as Record<string, unknown>) };
}

function asMemeArchetype(value: unknown): AiNativeNarrativeMemeArchetype {
  switch (String(value ?? "").trim()) {
    case "personality":
    case "conflict":
    case "catchphrase":
    case "mascot":
    case "visual_absurdity":
    case "pop_culture":
    case "tech_drama":
    case "political_meme":
      return String(value) as AiNativeNarrativeMemeArchetype;
    default:
      return "community_joke";
  }
}

function isMissingRelationError(error: unknown) {
  const databaseError = error as { code?: string; message?: string };
  const message = String(databaseError?.message ?? "").toLowerCase();
  return databaseError?.code === "42P01" || message.includes("does not exist");
}

function mapRunRow(row: RunRow): StoredAiNativeNarrativeRun {
  return {
    id: Number(row.id),
    status: row.status,
    trigger: row.trigger,
    generatedAt: toIsoString(row.generated_at) ?? new Date().toISOString(),
    completedAt: toIsoString(row.completed_at),
    candidateCount: Number(row.candidate_count ?? 0),
    evidenceCount: Number(row.evidence_count ?? 0),
    narrativeCount: Number(row.narrative_count ?? 0),
    modelName: row.model_name,
    promptVersion: row.prompt_version,
    errorMessage: row.error_message,
    notesJson: asRecord(row.notes_json),
  };
}

function mapNarrativeRow(row: NarrativeRow): StoredAiNativeNarrative {
  return {
    id: Number(row.id),
    runId: Number(row.run_id),
    rank: Number(row.rank),
    canonicalId: row.canonical_id,
    canonicalName: row.canonical_name,
    summary: row.summary,
    researchSummary: row.research_summary,
    memeScore: Number(row.meme_score ?? 0),
    memeReason: String(row.meme_reason ?? "").trim(),
    memeArchetype: asMemeArchetype(row.meme_archetype),
    visualScore: Number(row.visual_score ?? 0),
    drynessScore: Number(row.dryness_score ?? 0),
    evidenceCount: Number(row.evidence_count ?? 0),
    sourceCount: Number(row.source_count ?? 0),
    firstSeenAt: toIsoString(row.first_seen_at),
    lastSeenAt: toIsoString(row.last_seen_at),
    confidence: Number(row.confidence ?? 0),
    status: row.status,
    candidateKeys: asStringArray(row.candidate_keys_json),
    evidenceKeys: asStringArray(row.evidence_keys_json),
    sourceDomains: asStringArray(row.source_domains_json),
    keyEntities: asStringArray(row.key_entities_json),
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updated_at) ?? new Date().toISOString(),
  };
}

async function withClient<T>(callback: (client: PoolClient) => Promise<T>) {
  const pool = getServerPostgresPool();
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function hasAiNativeNarrativeSchema() {
  if (!hasDatabaseUrl()) {
    return false;
  }

  const pool = getServerPostgresPool();
  try {
    const result = await pool.query<{ ready: boolean }>(`
      SELECT
        to_regclass('public.ai_narrative_runs') IS NOT NULL
        AND to_regclass('public.ai_narrative_candidates') IS NOT NULL
        AND to_regclass('public.ai_narrative_evidence') IS NOT NULL
        AND to_regclass('public.ai_narratives') IS NOT NULL
        AND to_regclass('public.ai_narrative_evidence_links') IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_narrative_candidates'
            AND column_name = 'meme_score'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_narrative_candidates'
            AND column_name = 'meme_reason'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_narrative_candidates'
            AND column_name = 'meme_archetype'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_narrative_candidates'
            AND column_name = 'visual_score'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_narrative_candidates'
            AND column_name = 'dryness_score'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_narratives'
            AND column_name = 'meme_score'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_narratives'
            AND column_name = 'meme_reason'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_narratives'
            AND column_name = 'meme_archetype'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_narratives'
            AND column_name = 'visual_score'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_narratives'
            AND column_name = 'dryness_score'
        ) AS ready
    `);
    return Boolean(result.rows[0]?.ready);
  } catch (error) {
    if (isMissingRelationError(error)) {
      return false;
    }
    throw error;
  }
}

export async function getLatestSuccessfulAiNativeNarrativeRunView(): Promise<AiNativeNarrativeRunView> {
  const { finalNarrativeCount: boardTargetCount } = getAiNativeNarrativeConfig();
  if (!hasDatabaseUrl()) {
    return {
      run: null,
      latestRun: null,
      latestFailureRun: null,
      recentRuns: [],
      narratives: [],
      latestRunNarratives: [],
      boardTargetCount,
      boardFreshCount: 0,
      boardBackfillCount: 0,
      boardHistoricalRowsConsidered: 0,
      boardHasFullTarget: false,
      freshnessMinutes: null,
    };
  }

  const pool = getServerPostgresPool();
  try {
    const runResult = await pool.query<RunRow>(
      `
        SELECT
          id,
          status,
          trigger,
          generated_at,
          completed_at,
          candidate_count,
          evidence_count,
          narrative_count,
          model_name,
          prompt_version,
          error_message,
          notes_json
        FROM public.ai_narrative_runs
        WHERE status = 'succeeded'
          AND EXISTS (
            SELECT 1
            FROM public.ai_narratives
            WHERE run_id = public.ai_narrative_runs.id
          )
        ORDER BY generated_at DESC, id DESC
        LIMIT 1
      `,
    );

    const runRow = runResult.rows[0];
    const recentRunsResult = await pool.query<RunRow>(
      `
        SELECT
          id,
          status,
          trigger,
          generated_at,
          completed_at,
          candidate_count,
          evidence_count,
          narrative_count,
          model_name,
          prompt_version,
          error_message,
          notes_json
        FROM public.ai_narrative_runs
        ORDER BY generated_at DESC, id DESC
        LIMIT 8
      `,
    );
    const recentRuns = recentRunsResult.rows.map(mapRunRow);
    const latestRun = recentRuns[0] ?? null;
    const latestFailureRun =
      recentRuns.find((candidate) => candidate.status === "failed") ?? null;

    if (!runRow) {
      return {
        run: null,
        latestRun,
        latestFailureRun,
        recentRuns,
        narratives: [],
        latestRunNarratives: [],
        boardTargetCount,
        boardFreshCount: 0,
        boardBackfillCount: 0,
        boardHistoricalRowsConsidered: 0,
        boardHasFullTarget: false,
        freshnessMinutes: null,
      };
    }

    const run = mapRunRow(runRow);
    const narrativeResult = await pool.query<NarrativeRow>(
      `
        SELECT
          id,
          run_id,
          rank,
          canonical_id,
          canonical_name,
          summary,
          research_summary,
          meme_score,
          meme_reason,
          meme_archetype,
          visual_score,
          dryness_score,
          evidence_count,
          source_count,
          first_seen_at,
          last_seen_at,
          confidence,
          status,
          candidate_keys_json,
          evidence_keys_json,
          source_domains_json,
          key_entities_json,
          created_at,
          updated_at
        FROM public.ai_narratives
        WHERE run_id = $1
        ORDER BY rank ASC, id ASC
      `,
      [run.id],
    );
    const latestRunNarratives = narrativeResult.rows.map(mapNarrativeRow);
    const historicalNarrativesResult =
      latestRunNarratives.length >= boardTargetCount
        ? { rows: [] as HistoricalNarrativeRow[] }
        : await pool.query<HistoricalNarrativeRow>(
            `
              SELECT
                narrative.id,
                narrative.run_id,
                narrative.rank,
                narrative.canonical_id,
                narrative.canonical_name,
                narrative.summary,
                narrative.research_summary,
                narrative.meme_score,
                narrative.meme_reason,
                narrative.meme_archetype,
                narrative.visual_score,
                narrative.dryness_score,
                narrative.evidence_count,
                narrative.source_count,
                narrative.first_seen_at,
                narrative.last_seen_at,
                narrative.confidence,
                narrative.status,
                narrative.candidate_keys_json,
                narrative.evidence_keys_json,
                narrative.source_domains_json,
                narrative.key_entities_json,
                narrative.created_at,
                narrative.updated_at,
                run.generated_at AS run_generated_at
              FROM public.ai_narratives AS narrative
              INNER JOIN public.ai_narrative_runs AS run
                ON run.id = narrative.run_id
              WHERE run.status = 'succeeded'
                AND narrative.status <> 'discarded'
                AND narrative.run_id <> $1
              ORDER BY run.generated_at DESC, narrative.rank ASC, narrative.id ASC
              LIMIT $2
            `,
            [run.id, Math.max(boardTargetCount * 20, 400)],
          );
    const historicalNarratives = historicalNarrativesResult.rows
      .map((row) => ({
        narrative: mapNarrativeRow(row),
        runGeneratedAt: toIsoString(row.run_generated_at),
      }))
      .sort(
        (left, right) =>
          Date.parse(right.runGeneratedAt ?? "") - Date.parse(left.runGeneratedAt ?? "") ||
          computeAiNativeNarrativeQualityScore(right.narrative) -
            computeAiNativeNarrativeQualityScore(left.narrative) ||
          left.narrative.rank - right.narrative.rank,
      )
      .map((entry) => entry.narrative);
    const assembledBoard = assembleAiNativeNarrativeBoard(
      latestRunNarratives,
      historicalNarratives,
      boardTargetCount,
    );
    const generatedTimestamp = Date.parse(run.generatedAt);
    const freshnessMinutes = Number.isFinite(generatedTimestamp)
      ? Math.max(0, Math.round((Date.now() - generatedTimestamp) / 60_000))
      : null;

    return {
      run,
      latestRun,
      latestFailureRun,
      recentRuns,
      narratives: assembledBoard.narratives,
      latestRunNarratives,
      boardTargetCount,
      boardFreshCount: assembledBoard.freshCount,
      boardBackfillCount: assembledBoard.backfillCount,
      boardHistoricalRowsConsidered: assembledBoard.historicalRowsConsidered,
      boardHasFullTarget: assembledBoard.hasFullTarget,
      freshnessMinutes,
    };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        run: null,
        latestRun: null,
        latestFailureRun: null,
        recentRuns: [],
        narratives: [],
        latestRunNarratives: [],
        boardTargetCount,
        boardFreshCount: 0,
        boardBackfillCount: 0,
        boardHistoricalRowsConsidered: 0,
        boardHasFullTarget: false,
        freshnessMinutes: null,
      };
    }
    throw error;
  }
}

export async function getLatestSuccessfulAiNativeNarrativeRun() {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const pool = getServerPostgresPool();
  try {
    const runResult = await pool.query<RunRow>(
      `
        SELECT
          id,
          status,
          trigger,
          generated_at,
          completed_at,
          candidate_count,
          evidence_count,
          narrative_count,
          model_name,
          prompt_version,
          error_message,
          notes_json
        FROM public.ai_narrative_runs
        WHERE status = 'succeeded'
          AND EXISTS (
            SELECT 1
            FROM public.ai_narratives
            WHERE run_id = public.ai_narrative_runs.id
          )
        ORDER BY generated_at DESC, id DESC
        LIMIT 1
      `,
    );

    const row = runResult.rows[0];
    return row ? mapRunRow(row) : null;
  } catch (error) {
    if (isMissingRelationError(error)) {
      return null;
    }
    throw error;
  }
}

export async function insertFailedAiNativeNarrativeRun(params: {
  trigger: string;
  modelName: string;
  promptVersion: string;
  generatedAt: string;
  errorMessage: string;
  discoveryResponseJson?: Record<string, unknown> | null;
  canonicalizationResponseJson?: Record<string, unknown> | null;
  notesJson?: Record<string, unknown> | null;
}) {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const pool = getServerPostgresPool();
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO public.ai_narrative_runs (
        status,
        trigger,
        model_name,
        prompt_version,
        generated_at,
        completed_at,
        candidate_count,
        evidence_count,
        narrative_count,
        error_message,
        discovery_response_json,
        canonicalization_response_json,
        notes_json
      ) VALUES (
        'failed',
        $1,
        $2,
        $3,
        $4::timestamptz,
        now(),
        0,
        0,
        0,
        $5,
        $6::jsonb,
        $7::jsonb,
        $8::jsonb
      )
      RETURNING id
    `,
    [
      params.trigger,
      params.modelName,
      params.promptVersion,
      params.generatedAt,
      params.errorMessage,
      params.discoveryResponseJson ? JSON.stringify(params.discoveryResponseJson) : null,
      params.canonicalizationResponseJson ? JSON.stringify(params.canonicalizationResponseJson) : null,
      JSON.stringify(params.notesJson ?? {}),
    ],
  );

  return result.rows[0]?.id ?? null;
}

const AI_NATIVE_NARRATIVE_EXECUTION_LOCK_KEY = 9_146_204;

export async function acquireAiNativeNarrativeExecutionLock() {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const pool = getServerPostgresPool();
  const client = await pool.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [AI_NATIVE_NARRATIVE_EXECUTION_LOCK_KEY],
    );
    if (!result.rows[0]?.acquired) {
      client.release();
      return null;
    }

    return {
      async release() {
        try {
          await client.query("SELECT pg_advisory_unlock($1)", [AI_NATIVE_NARRATIVE_EXECUTION_LOCK_KEY]);
        } finally {
          client.release();
        }
      },
    };
  } catch (error) {
    client.release();
    throw error;
  }
}

async function insertCandidateRows(
  client: PoolClient,
  runId: number,
  candidates: AiNativeNarrativeCandidate[],
) {
  const candidateIdByKey = new Map<string, number>();

  for (const candidate of candidates) {
    const result = await client.query<{ id: number }>(
      `
        INSERT INTO public.ai_narrative_candidates (
          run_id,
          candidate_key,
          provisional_name,
          summary,
          confidence,
          meme_score,
          meme_reason,
          meme_archetype,
          visual_score,
          dryness_score,
          status,
          evidence_count,
          source_count,
          first_seen_at,
          last_seen_at,
          source_domains_json,
          raw_payload_json
        ) VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14::timestamptz,
          $15::timestamptz,
          $16::jsonb,
          $17::jsonb
        )
        RETURNING id
      `,
      [
        runId,
        candidate.candidateKey,
        candidate.provisionalName,
        candidate.summary,
        candidate.confidence,
        candidate.memeScore,
        candidate.memeReason,
        candidate.memeArchetype,
        candidate.visualScore,
        candidate.drynessScore,
        "detected",
        candidate.evidenceCount,
        candidate.sourceCount,
        candidate.firstSeenAt,
        candidate.lastSeenAt,
        JSON.stringify(candidate.sourceDomains),
        JSON.stringify(candidate.rawPayloadJson ?? {}),
      ],
    );
    const candidateId = Number(result.rows[0]?.id ?? 0);
    if (!candidateId) {
      throw new Error(`Failed to persist ai narrative candidate ${candidate.candidateKey}.`);
    }
    candidateIdByKey.set(candidate.candidateKey, candidateId);
  }

  return candidateIdByKey;
}

async function insertEvidenceRows(
  client: PoolClient,
  runId: number,
  candidates: AiNativeNarrativeCandidate[],
  candidateIdByKey: Map<string, number>,
) {
  const evidenceIdByKey = new Map<string, number>();

  for (const candidate of candidates) {
    const candidateId = candidateIdByKey.get(candidate.candidateKey) ?? null;
    for (const evidence of candidate.evidence) {
      const result = await client.query<{ id: number }>(
        `
          INSERT INTO public.ai_narrative_evidence (
            run_id,
            candidate_id,
            evidence_key,
            url,
            title,
            snippet,
            source_domain,
            published_at,
            note,
            raw_payload_json
          ) VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8::timestamptz,
            $9,
            $10::jsonb
          )
          ON CONFLICT (run_id, evidence_key) DO UPDATE
          SET
            url = EXCLUDED.url,
            title = EXCLUDED.title,
            snippet = EXCLUDED.snippet,
            source_domain = EXCLUDED.source_domain,
            published_at = EXCLUDED.published_at,
            note = EXCLUDED.note,
            raw_payload_json = EXCLUDED.raw_payload_json,
            updated_at = now()
          RETURNING id
        `,
        [
          runId,
          candidateId,
          evidence.evidenceKey,
          evidence.url,
          evidence.title,
          evidence.snippet,
          evidence.sourceDomain,
          evidence.publishedAt,
          evidence.note,
          JSON.stringify({
            candidateKey: candidate.candidateKey,
          }),
        ],
      );
      const evidenceId = Number(result.rows[0]?.id ?? 0);
      if (!evidenceId) {
        throw new Error(`Failed to persist ai narrative evidence ${evidence.evidenceKey}.`);
      }
      evidenceIdByKey.set(evidence.evidenceKey, evidenceId);
    }
  }

  return evidenceIdByKey;
}

export async function storeSuccessfulAiNativeNarrativeRun(
  payload: GeneratedAiNativeNarrativeRunPayload,
) {
  if (!hasDatabaseUrl()) {
    throw new Error("Missing DATABASE_URL for ai-native narrative persistence.");
  }

  return withClient(async (client) => {
    await client.query("BEGIN");

    try {
      const evidenceCount = payload.candidates.reduce(
        (total, candidate) => total + candidate.evidence.length,
        0,
      );
      const runResult = await client.query<{ id: number }>(
        `
          INSERT INTO public.ai_narrative_runs (
            status,
            trigger,
            model_name,
            prompt_version,
            generated_at,
            completed_at,
            candidate_count,
            evidence_count,
            narrative_count,
            discovery_response_json,
            canonicalization_response_json,
            notes_json
          ) VALUES (
            'succeeded',
            $1,
            $2,
            $3,
            $4::timestamptz,
            now(),
            $5,
            $6,
            $7,
            $8::jsonb,
            $9::jsonb,
            $10::jsonb
          )
          RETURNING id
        `,
        [
          payload.trigger,
          payload.modelName,
          payload.promptVersion,
          payload.generatedAt,
          payload.candidates.length,
          evidenceCount,
          payload.narratives.length,
          payload.discoveryResponseJson ? JSON.stringify(payload.discoveryResponseJson) : null,
          payload.canonicalizationResponseJson ? JSON.stringify(payload.canonicalizationResponseJson) : null,
          JSON.stringify(payload.notesJson ?? {}),
        ],
      );
      const runId = Number(runResult.rows[0]?.id ?? 0);
      if (!runId) {
        throw new Error("Failed to create ai-native narrative run row.");
      }

      const candidateIdByKey = await insertCandidateRows(client, runId, payload.candidates);
      const evidenceIdByKey = await insertEvidenceRows(client, runId, payload.candidates, candidateIdByKey);
      const usedCandidateKeys = new Set<string>();

      for (const narrative of payload.narratives) {
        const narrativeResult = await client.query<{ id: number }>(
          `
            INSERT INTO public.ai_narratives (
              run_id,
              rank,
              canonical_id,
              canonical_name,
              summary,
              research_summary,
              meme_score,
              meme_reason,
              meme_archetype,
              visual_score,
              dryness_score,
              evidence_count,
              source_count,
              first_seen_at,
              last_seen_at,
              confidence,
              status,
              candidate_keys_json,
              evidence_keys_json,
              source_domains_json,
              key_entities_json,
              raw_payload_json
            ) VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              $10,
              $11,
              $12,
              $13,
              $14::timestamptz,
              $15::timestamptz,
              $16,
              $17,
              $18::jsonb,
              $19::jsonb,
              $20::jsonb,
              $21::jsonb,
              $22::jsonb
            )
            RETURNING id
          `,
          [
            runId,
            narrative.rank,
            narrative.canonicalId,
            narrative.canonicalName,
            narrative.summary,
            narrative.researchSummary,
            narrative.memeScore,
            narrative.memeReason,
            narrative.memeArchetype,
            narrative.visualScore,
            narrative.drynessScore,
            narrative.evidenceCount,
            narrative.sourceCount,
            narrative.firstSeenAt,
            narrative.lastSeenAt,
            narrative.confidence,
            narrative.status,
            JSON.stringify(narrative.candidateKeys),
            JSON.stringify(narrative.evidenceKeys),
            JSON.stringify(narrative.sourceDomains),
            JSON.stringify(narrative.keyEntities),
            JSON.stringify(narrative.rawPayloadJson ?? {}),
          ],
        );
        const narrativeId = Number(narrativeResult.rows[0]?.id ?? 0);
        if (!narrativeId) {
          throw new Error(`Failed to persist ai-native narrative ${narrative.canonicalId}.`);
        }

        for (const candidateKey of narrative.candidateKeys) {
          usedCandidateKeys.add(candidateKey);
        }

        for (const [index, evidenceKey] of narrative.evidenceKeys.entries()) {
          const evidenceId = evidenceIdByKey.get(evidenceKey);
          if (!evidenceId) {
            throw new Error(
              `Narrative ${narrative.canonicalId} referenced missing evidence key ${evidenceKey}.`,
            );
          }
          await client.query(
            `
              INSERT INTO public.ai_narrative_evidence_links (
                narrative_id,
                evidence_id,
                relation_order,
                is_primary
              ) VALUES (
                $1,
                $2,
                $3,
                $4
              )
            `,
            [narrativeId, evidenceId, index + 1, index === 0],
          );
        }
      }

      await client.query(
        `
          UPDATE public.ai_narrative_candidates
          SET
            status = CASE
              WHEN candidate_key = ANY($2::text[]) THEN 'clustered'
              ELSE 'discarded'
            END,
            updated_at = now()
          WHERE run_id = $1
        `,
        [runId, [...usedCandidateKeys]],
      );

      await client.query("COMMIT");
      return runId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
