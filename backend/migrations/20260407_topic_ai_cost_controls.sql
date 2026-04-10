BEGIN;

ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS writer_identity TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS writer_role TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS authoritative_writer BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS deployment_id TEXT,
    ADD COLUMN IF NOT EXISTS instance_id TEXT,
    ADD COLUMN IF NOT EXISTS code_version TEXT,
    ADD COLUMN IF NOT EXISTS refresh_reason TEXT,
    ADD COLUMN IF NOT EXISTS usage_prompt_tokens INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS usage_completion_tokens INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS usage_total_tokens INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS duration_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS replaced_existing_title BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.topic_ai_enrichment_runs
    ADD COLUMN IF NOT EXISTS writer_identity TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS writer_role TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS authoritative_writer BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS deployment_id TEXT,
    ADD COLUMN IF NOT EXISTS instance_id TEXT,
    ADD COLUMN IF NOT EXISTS code_version TEXT,
    ADD COLUMN IF NOT EXISTS refresh_reason TEXT,
    ADD COLUMN IF NOT EXISTS usage_prompt_tokens INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS usage_completion_tokens INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS usage_total_tokens INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS duration_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS replaced_existing_title BOOLEAN NOT NULL DEFAULT false;

UPDATE public.topic_ai_enrichments
SET writer_identity = COALESCE(NULLIF(BTRIM(writer_identity), ''), NULLIF(BTRIM(metadata_json ->> 'writer_identity'), ''), ''),
    writer_role = COALESCE(NULLIF(BTRIM(writer_role), ''), NULLIF(BTRIM(metadata_json ->> 'writer_role'), ''), ''),
    authoritative_writer = COALESCE(
        authoritative_writer,
        CASE LOWER(COALESCE(metadata_json ->> 'authoritative_writer', ''))
            WHEN 'true' THEN true
            WHEN 'false' THEN false
            ELSE false
        END
    ),
    deployment_id = COALESCE(NULLIF(BTRIM(deployment_id), ''), NULLIF(BTRIM(metadata_json ->> 'deployment_id'), '')),
    instance_id = COALESCE(NULLIF(BTRIM(instance_id), ''), NULLIF(BTRIM(metadata_json ->> 'instance_id'), '')),
    code_version = COALESCE(NULLIF(BTRIM(code_version), ''), NULLIF(BTRIM(metadata_json ->> 'code_version'), '')),
    refresh_reason = COALESCE(NULLIF(BTRIM(refresh_reason), ''), NULLIF(BTRIM(metadata_json ->> 'refresh_reason'), '')),
    usage_prompt_tokens = COALESCE(
        usage_prompt_tokens,
        CASE
            WHEN COALESCE(metadata_json ->> 'usage_prompt_tokens', '') ~ '^-?[0-9]+$'
                THEN (metadata_json ->> 'usage_prompt_tokens')::integer
            ELSE 0
        END
    ),
    usage_completion_tokens = COALESCE(
        usage_completion_tokens,
        CASE
            WHEN COALESCE(metadata_json ->> 'usage_completion_tokens', '') ~ '^-?[0-9]+$'
                THEN (metadata_json ->> 'usage_completion_tokens')::integer
            ELSE 0
        END
    ),
    usage_total_tokens = COALESCE(
        usage_total_tokens,
        CASE
            WHEN COALESCE(metadata_json ->> 'usage_total_tokens', '') ~ '^-?[0-9]+$'
                THEN (metadata_json ->> 'usage_total_tokens')::integer
            ELSE 0
        END
    ),
    duration_ms = COALESCE(
        duration_ms,
        CASE
            WHEN COALESCE(metadata_json ->> 'duration_ms', '') ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
                THEN (metadata_json ->> 'duration_ms')::double precision
            ELSE 0
        END
    ),
    replaced_existing_title = COALESCE(
        replaced_existing_title,
        CASE LOWER(COALESCE(metadata_json ->> 'replaced_existing_title', ''))
            WHEN 'true' THEN true
            WHEN 'false' THEN false
            ELSE false
        END
    );

UPDATE public.topic_ai_enrichment_runs
SET writer_identity = COALESCE(NULLIF(BTRIM(writer_identity), ''), NULLIF(BTRIM(metadata_json ->> 'writer_identity'), ''), ''),
    writer_role = COALESCE(NULLIF(BTRIM(writer_role), ''), NULLIF(BTRIM(metadata_json ->> 'writer_role'), ''), ''),
    authoritative_writer = COALESCE(
        authoritative_writer,
        CASE LOWER(COALESCE(metadata_json ->> 'authoritative_writer', ''))
            WHEN 'true' THEN true
            WHEN 'false' THEN false
            ELSE false
        END
    ),
    deployment_id = COALESCE(NULLIF(BTRIM(deployment_id), ''), NULLIF(BTRIM(metadata_json ->> 'deployment_id'), '')),
    instance_id = COALESCE(NULLIF(BTRIM(instance_id), ''), NULLIF(BTRIM(metadata_json ->> 'instance_id'), '')),
    code_version = COALESCE(NULLIF(BTRIM(code_version), ''), NULLIF(BTRIM(metadata_json ->> 'code_version'), '')),
    refresh_reason = COALESCE(NULLIF(BTRIM(refresh_reason), ''), NULLIF(BTRIM(metadata_json ->> 'refresh_reason'), '')),
    usage_prompt_tokens = COALESCE(
        usage_prompt_tokens,
        CASE
            WHEN COALESCE(metadata_json ->> 'usage_prompt_tokens', '') ~ '^-?[0-9]+$'
                THEN (metadata_json ->> 'usage_prompt_tokens')::integer
            ELSE 0
        END
    ),
    usage_completion_tokens = COALESCE(
        usage_completion_tokens,
        CASE
            WHEN COALESCE(metadata_json ->> 'usage_completion_tokens', '') ~ '^-?[0-9]+$'
                THEN (metadata_json ->> 'usage_completion_tokens')::integer
            ELSE 0
        END
    ),
    usage_total_tokens = COALESCE(
        usage_total_tokens,
        CASE
            WHEN COALESCE(metadata_json ->> 'usage_total_tokens', '') ~ '^-?[0-9]+$'
                THEN (metadata_json ->> 'usage_total_tokens')::integer
            ELSE 0
        END
    ),
    duration_ms = COALESCE(
        duration_ms,
        CASE
            WHEN COALESCE(metadata_json ->> 'duration_ms', '') ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
                THEN (metadata_json ->> 'duration_ms')::double precision
            ELSE 0
        END
    ),
    replaced_existing_title = COALESCE(
        replaced_existing_title,
        CASE LOWER(COALESCE(metadata_json ->> 'replaced_existing_title', ''))
            WHEN 'true' THEN true
            WHEN 'false' THEN false
            ELSE false
        END
    );

CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_writer_generated
    ON public.topic_ai_enrichments (writer_identity, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_refresh_reason_generated
    ON public.topic_ai_enrichments (refresh_reason, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichment_runs_writer_generated
    ON public.topic_ai_enrichment_runs (writer_identity, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichment_runs_refresh_generated
    ON public.topic_ai_enrichment_runs (refresh_reason, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichment_runs_model_prompt_generated
    ON public.topic_ai_enrichment_runs (model_name, prompt_version, generated_at DESC);

WITH ranked_duplicates AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY
                topic_key,
                as_of_window_end,
                writer_identity,
                prompt_version,
                model_name,
                input_hash,
                COALESCE(refresh_reason, '')
            ORDER BY generated_at DESC, id DESC
        ) AS duplicate_rank
    FROM public.topic_ai_enrichment_runs
    WHERE generated_at >= TIMESTAMPTZ '2026-04-07 00:00:00+00'
)
DELETE FROM public.topic_ai_enrichment_runs runs
USING ranked_duplicates duplicates
WHERE runs.id = duplicates.id
  AND duplicates.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_topic_ai_enrichment_runs_run_fingerprint
    ON public.topic_ai_enrichment_runs (
        topic_key,
        as_of_window_end,
        writer_identity,
        prompt_version,
        model_name,
        input_hash,
        COALESCE(refresh_reason, '')
    )
    WHERE generated_at >= TIMESTAMPTZ '2026-04-07 00:00:00+00';

CREATE TABLE IF NOT EXISTS public.topic_ai_writer_heartbeats (
    writer_identity TEXT NOT NULL,
    deployment_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    writer_role TEXT NOT NULL,
    authoritative_writer BOOLEAN NOT NULL DEFAULT false,
    model_name TEXT,
    prompt_version TEXT,
    code_version TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    last_reason TEXT,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_started_at TIMESTAMPTZ,
    last_completed_at TIMESTAMPTZ,
    last_write_at TIMESTAMPTZ,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (writer_identity, deployment_id, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_ai_writer_heartbeats_seen
    ON public.topic_ai_writer_heartbeats (last_seen_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_topic_ai_enrichments_writer_identity_present'
    ) THEN
        ALTER TABLE public.topic_ai_enrichments
            ADD CONSTRAINT ck_topic_ai_enrichments_writer_identity_present
            CHECK (BTRIM(writer_identity) <> '' AND LOWER(BTRIM(writer_identity)) <> 'unknown')
            NOT VALID;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_topic_ai_enrichments_writer_role_present'
    ) THEN
        ALTER TABLE public.topic_ai_enrichments
            ADD CONSTRAINT ck_topic_ai_enrichments_writer_role_present
            CHECK (BTRIM(writer_role) <> '' AND LOWER(BTRIM(writer_role)) <> 'unknown')
            NOT VALID;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_topic_ai_enrichment_runs_writer_identity_present'
    ) THEN
        ALTER TABLE public.topic_ai_enrichment_runs
            ADD CONSTRAINT ck_topic_ai_enrichment_runs_writer_identity_present
            CHECK (BTRIM(writer_identity) <> '' AND LOWER(BTRIM(writer_identity)) <> 'unknown')
            NOT VALID;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_topic_ai_enrichment_runs_writer_role_present'
    ) THEN
        ALTER TABLE public.topic_ai_enrichment_runs
            ADD CONSTRAINT ck_topic_ai_enrichment_runs_writer_role_present
            CHECK (BTRIM(writer_role) <> '' AND LOWER(BTRIM(writer_role)) <> 'unknown')
            NOT VALID;
    END IF;
END
$$;

COMMIT;
