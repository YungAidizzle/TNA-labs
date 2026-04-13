import "server-only";

import type { PoolClient } from "pg";
import { getServerPostgresPool, hasDatabaseUrl } from "@/lib/db/server-postgres";
import type {
  GeneratedTrendSnapshotPayload,
  SharedTrendSnapshot,
  SharedTrendSnapshotItem,
  SharedTrendSnapshotView,
} from "@/lib/gpt-trends/types";

type SnapshotRow = {
  id: number;
  status: "pending" | "succeeded" | "failed";
  created_at: Date | string;
  generated_at: Date | string;
  completed_at: Date | string | null;
  trend_count: number;
  model_name: string | null;
  prompt_version: string | null;
  error_message: string | null;
};

type SnapshotItemRow = {
  id: number;
  snapshot_id: number;
  rank: number;
  trend_key: string;
  title: string;
  summary: string;
  confidence_score: number | string | null;
  ai_rank_score: number | string | null;
  importance_note: string | null;
  category: string | null;
  source_scope: string | null;
  source_count: number | null;
  generated_at: Date | string;
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

function mapSnapshotRow(row: SnapshotRow): SharedTrendSnapshot {
  return {
    id: row.id,
    status: row.status,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    generatedAt: toIsoString(row.generated_at) ?? new Date().toISOString(),
    completedAt: toIsoString(row.completed_at),
    trendCount: Number(row.trend_count ?? 0),
    modelName: row.model_name,
    promptVersion: row.prompt_version,
    errorMessage: row.error_message,
  };
}

function mapSnapshotItemRow(row: SnapshotItemRow): SharedTrendSnapshotItem {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    rank: Number(row.rank ?? 0),
    trendKey: row.trend_key,
    title: row.title,
    summary: row.summary,
    confidenceScore: Number(row.confidence_score ?? 0),
    aiRankScore: Number(row.ai_rank_score ?? 0),
    importanceNote: row.importance_note,
    category: row.category,
    sourceScope: row.source_scope,
    sourceCount: row.source_count,
    generatedAt: toIsoString(row.generated_at) ?? new Date().toISOString(),
  };
}

function isMissingRelationError(error: unknown) {
  const databaseError = error as { code?: string; message?: string };
  const message = String(databaseError?.message ?? "").toLowerCase();
  return databaseError?.code === "42P01" || message.includes("does not exist");
}

export async function getLatestSuccessfulTrendSnapshotView(): Promise<SharedTrendSnapshotView> {
  if (!hasDatabaseUrl()) {
    return {
      snapshot: null,
      trends: [],
      freshnessMinutes: null,
    };
  }

  const pool = getServerPostgresPool();
  try {
    const snapshotResult = await pool.query<SnapshotRow>(
      `
        SELECT
          id,
          status,
          created_at,
          generated_at,
          completed_at,
          trend_count,
          model_name,
          prompt_version,
          error_message
        FROM public.trend_snapshots
        WHERE status = 'succeeded'
        ORDER BY generated_at DESC, id DESC
        LIMIT 1
      `,
    );

    const snapshotRow = snapshotResult.rows[0];
    if (!snapshotRow) {
      return {
        snapshot: null,
        trends: [],
        freshnessMinutes: null,
      };
    }

    const snapshot = mapSnapshotRow(snapshotRow);
    const itemsResult = await pool.query<SnapshotItemRow>(
      `
        SELECT
          id,
          snapshot_id,
          rank,
          trend_key,
          title,
          summary,
          confidence_score,
          ai_rank_score,
          importance_note,
          category,
          source_scope,
          source_count,
          generated_at
        FROM public.trend_snapshot_items
        WHERE snapshot_id = $1
        ORDER BY rank ASC
      `,
      [snapshot.id],
    );
    const trends = itemsResult.rows.map(mapSnapshotItemRow);
    const generatedTimestamp = Date.parse(snapshot.generatedAt);
    const freshnessMinutes = Number.isFinite(generatedTimestamp)
      ? Math.max(0, Math.round((Date.now() - generatedTimestamp) / 60_000))
      : null;

    return {
      snapshot,
      trends,
      freshnessMinutes,
    };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        snapshot: null,
        trends: [],
        freshnessMinutes: null,
      };
    }
    throw error;
  }
}

export async function getLatestSuccessfulTrendSnapshot(): Promise<SharedTrendSnapshot | null> {
  const view = await getLatestSuccessfulTrendSnapshotView();
  return view.snapshot;
}

export async function insertFailedTrendSnapshot(params: {
  modelName: string;
  promptVersion: string;
  generatedAt: string;
  errorMessage: string;
}) {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const pool = getServerPostgresPool();
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO public.trend_snapshots (
        status,
        trend_count,
        model_name,
        prompt_version,
        generated_at,
        completed_at,
        error_message
      ) VALUES (
        'failed',
        0,
        $1,
        $2,
        $3::timestamptz,
        now(),
        $4
      )
      RETURNING id
    `,
    [params.modelName, params.promptVersion, params.generatedAt, params.errorMessage],
  );

  return result.rows[0]?.id ?? null;
}

async function insertSnapshotItems(
  client: PoolClient,
  snapshotId: number,
  payload: GeneratedTrendSnapshotPayload,
) {
  const values: Array<string | number | null> = [];
  const placeholders: string[] = [];

  payload.trends.forEach((trend, index) => {
    const offset = index * 12;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12})`,
    );
    values.push(
      snapshotId,
      trend.rank,
      trend.trendKey,
      trend.title,
      trend.summary,
      trend.confidenceScore,
      trend.aiRankScore,
      trend.importanceNote,
      trend.category,
      trend.sourceScope ?? null,
      trend.sourceCount,
      payload.generatedAt,
    );
  });

  await client.query(
    `
      INSERT INTO public.trend_snapshot_items (
        snapshot_id,
        rank,
        trend_key,
        title,
        summary,
        confidence_score,
        ai_rank_score,
        importance_note,
        category,
        source_scope,
        source_count,
        generated_at
      ) VALUES ${placeholders.join(", ")}
    `,
    values,
  );
}

export async function storeSuccessfulTrendSnapshot(payload: GeneratedTrendSnapshotPayload) {
  if (!hasDatabaseUrl()) {
    throw new Error("Missing DATABASE_URL for GPT trend snapshot storage.");
  }

  const pool = getServerPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const snapshotResult = await client.query<{ id: number }>(
      `
        INSERT INTO public.trend_snapshots (
          status,
          trend_count,
          model_name,
          prompt_version,
          generated_at,
          completed_at,
          raw_response_json,
          notes_json
        ) VALUES (
          'succeeded',
          $1,
          $2,
          $3,
          $4::timestamptz,
          now(),
          $5::jsonb,
          $6::jsonb
        )
        RETURNING id
      `,
      [
        payload.trends.length,
        payload.modelName,
        payload.promptVersion,
        payload.generatedAt,
        payload.rawResponseJson ? JSON.stringify(payload.rawResponseJson) : null,
        payload.notesJson ? JSON.stringify(payload.notesJson) : null,
      ],
    );
    const snapshotId = snapshotResult.rows[0]?.id;
    if (!snapshotId) {
      throw new Error("Failed to create trend snapshot row.");
    }

    await insertSnapshotItems(client, snapshotId, payload);
    await client.query("COMMIT");
    return snapshotId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
