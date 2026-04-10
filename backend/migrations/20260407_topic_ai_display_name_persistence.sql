BEGIN;

ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS ai_display_name TEXT,
    ADD COLUMN IF NOT EXISTS ai_name_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS ai_name_generated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ai_name_refreshed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ai_name_source_version TEXT;

ALTER TABLE public.topic_ai_enrichment_runs
    ADD COLUMN IF NOT EXISTS ai_display_name TEXT,
    ADD COLUMN IF NOT EXISTS ai_name_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS ai_name_generated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ai_name_refreshed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ai_name_source_version TEXT;

UPDATE public.topic_ai_enrichments
SET ai_display_name = CASE
        WHEN COALESCE(NULLIF(BTRIM(name_status), ''), '') = 'ready'
         AND COALESCE(NULLIF(BTRIM(name_source), ''), '') IN (
            'ai_exact',
            'historical_exact',
            'historical_alias'
         )
         AND NULLIF(BTRIM(canonical_name), '') IS NOT NULL
            THEN NULLIF(BTRIM(canonical_name), '')
        ELSE NULL
    END,
    ai_name_status = COALESCE(NULLIF(BTRIM(name_status), ''), 'pending'),
    ai_name_generated_at = CASE
        WHEN COALESCE(NULLIF(BTRIM(name_status), ''), '') = 'ready'
         AND COALESCE(NULLIF(BTRIM(name_source), ''), '') IN (
            'ai_exact',
            'historical_exact',
            'historical_alias'
         )
         AND NULLIF(BTRIM(canonical_name), '') IS NOT NULL
            THEN COALESCE(generated_at, refreshed_at)
        ELSE NULL
    END,
    ai_name_refreshed_at = CASE
        WHEN COALESCE(NULLIF(BTRIM(name_status), ''), '') = 'ready'
         AND COALESCE(NULLIF(BTRIM(name_source), ''), '') IN (
            'ai_exact',
            'historical_exact',
            'historical_alias'
         )
         AND NULLIF(BTRIM(canonical_name), '') IS NOT NULL
            THEN COALESCE(refreshed_at, generated_at)
        ELSE NULL
    END,
    ai_name_source_version = CASE
        WHEN COALESCE(NULLIF(BTRIM(name_status), ''), '') = 'ready'
         AND COALESCE(NULLIF(BTRIM(name_source), ''), '') IN (
            'ai_exact',
            'historical_exact',
            'historical_alias'
         )
         AND NULLIF(BTRIM(canonical_name), '') IS NOT NULL
            THEN NULLIF(BTRIM(prompt_version), '')
        ELSE NULL
    END,
    authoritative_writer = (
        COALESCE(authoritative_writer, false)
        OR COALESCE(NULLIF(BTRIM(writer_identity), ''), '') IN (
            'backend.main:trend_title_generation',
            'backend.main:trend_enrichment'
        )
        OR LOWER(COALESCE(metadata_json ->> 'authoritative_writer', 'false')) = 'true'
    );

UPDATE public.topic_ai_enrichment_runs
SET ai_display_name = CASE
        WHEN COALESCE(NULLIF(BTRIM(name_status), ''), '') = 'ready'
         AND COALESCE(NULLIF(BTRIM(name_source), ''), '') IN (
            'ai_exact',
            'historical_exact',
            'historical_alias'
         )
         AND NULLIF(BTRIM(canonical_name), '') IS NOT NULL
            THEN NULLIF(BTRIM(canonical_name), '')
        ELSE NULL
    END,
    ai_name_status = COALESCE(NULLIF(BTRIM(name_status), ''), 'pending'),
    ai_name_generated_at = CASE
        WHEN COALESCE(NULLIF(BTRIM(name_status), ''), '') = 'ready'
         AND COALESCE(NULLIF(BTRIM(name_source), ''), '') IN (
            'ai_exact',
            'historical_exact',
            'historical_alias'
         )
         AND NULLIF(BTRIM(canonical_name), '') IS NOT NULL
            THEN COALESCE(generated_at, expires_at)
        ELSE NULL
    END,
    ai_name_refreshed_at = CASE
        WHEN COALESCE(NULLIF(BTRIM(name_status), ''), '') = 'ready'
         AND COALESCE(NULLIF(BTRIM(name_source), ''), '') IN (
            'ai_exact',
            'historical_exact',
            'historical_alias'
         )
         AND NULLIF(BTRIM(canonical_name), '') IS NOT NULL
            THEN generated_at
        ELSE NULL
    END,
    ai_name_source_version = CASE
        WHEN COALESCE(NULLIF(BTRIM(name_status), ''), '') = 'ready'
         AND COALESCE(NULLIF(BTRIM(name_source), ''), '') IN (
            'ai_exact',
            'historical_exact',
            'historical_alias'
         )
         AND NULLIF(BTRIM(canonical_name), '') IS NOT NULL
            THEN NULLIF(BTRIM(prompt_version), '')
        ELSE NULL
    END,
    authoritative_writer = (
        COALESCE(authoritative_writer, false)
        OR COALESCE(NULLIF(BTRIM(writer_identity), ''), '') IN (
            'backend.main:trend_title_generation',
            'backend.main:trend_enrichment'
        )
        OR LOWER(COALESCE(metadata_json ->> 'authoritative_writer', 'false')) = 'true'
    );

CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_ai_name_status
    ON public.topic_ai_enrichments (ai_name_status, ai_name_refreshed_at DESC);

CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_ai_display_name
    ON public.topic_ai_enrichments (ai_display_name, ai_name_refreshed_at DESC);

COMMIT;
