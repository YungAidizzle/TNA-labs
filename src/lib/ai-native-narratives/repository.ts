import "server-only";

import type { PoolClient } from "pg";
import { getServerPostgresPool, hasDatabaseUrl } from "@/lib/db/server-postgres";
import type {
  AiNativeNarrativeCandidate,
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
        AND to_regclass('public.ai_narrative_evidence_links') IS NOT NULL AS ready
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
  if (!hasDatabaseUrl()) {
    return {
      run: null,
      narratives: [],
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
          error_message
        FROM public.ai_narrative_runs
        WHERE status = 'succeeded'
        ORDER BY generated_at DESC, id DESC
        LIMIT 1
      `,
    );

    const runRow = runResult.rows[0];
    if (!runRow) {
      return {
        run: null,
        narratives: [],
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
    const narratives = narrativeResult.rows.map(mapNarrativeRow);
    const generatedTimestamp = Date.parse(run.generatedAt);
    const freshnessMinutes = Number.isFinite(generatedTimestamp)
      ? Math.max(0, Math.round((Date.now() - generatedTimestamp) / 60_000))
      : null;

    return {
      run,
      narratives,
      freshnessMinutes,
    };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        run: null,
        narratives: [],
        freshnessMinutes: null,
      };
    }
    throw error;
  }
}

export async function getLatestSuccessfulAiNativeNarrativeRun() {
  const view = await getLatestSuccessfulAiNativeNarrativeRunView();
  return view.run;
}

export async function insertFailedAiNativeNarrativeRun(params: {
  trigger: string;
  modelName: string;
  promptVersion: string;
  generatedAt: string;
  errorMessage: string;
  discoveryResponseJson?: Record<string, unknown> | null;
  canonicalizationResponseJson?: Record<string, unknown> | null;
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
        '{}'::jsonb
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
    ],
  );

  return result.rows[0]?.id ?? null;
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
          $11::timestamptz,
          $12::timestamptz,
          $13::jsonb,
          $14::jsonb
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
              $11::timestamptz,
              $12::timestamptz,
              $13,
              $14,
              $15::jsonb,
              $16::jsonb,
              $17::jsonb,
              $18::jsonb,
              $19::jsonb
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
