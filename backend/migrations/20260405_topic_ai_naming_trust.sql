BEGIN;

ALTER TABLE public.topic_ai_enrichments
    ALTER COLUMN canonical_name DROP NOT NULL;

ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS fallback_label TEXT;

ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS name_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS name_source TEXT NOT NULL DEFAULT 'none';

ALTER TABLE public.topic_ai_enrichments
    DROP CONSTRAINT IF EXISTS topic_ai_enrichments_name_status_check;

ALTER TABLE public.topic_ai_enrichments
    ADD CONSTRAINT topic_ai_enrichments_name_status_check
    CHECK (name_status IN ('ready', 'pending', 'failed'));

ALTER TABLE public.topic_ai_enrichments
    DROP CONSTRAINT IF EXISTS topic_ai_enrichments_name_source_check;

ALTER TABLE public.topic_ai_enrichments
    ADD CONSTRAINT topic_ai_enrichments_name_source_check
    CHECK (name_source IN (
        'ai_exact',
        'historical_exact',
        'historical_alias',
        'fallback_cleaned',
        'raw',
        'none'
    ));

UPDATE public.topic_ai_enrichments
SET fallback_label = COALESCE(
        NULLIF(BTRIM(fallback_label), ''),
        NULLIF(BTRIM(raw_label), '')
    )
WHERE fallback_label IS NULL
   OR BTRIM(fallback_label) = '';

WITH classified AS (
    SELECT
        id,
        CASE
            WHEN COALESCE(NULLIF(BTRIM(name_status), ''), '') IN ('ready', 'pending', 'failed')
                THEN BTRIM(name_status)
            WHEN
                NULLIF(BTRIM(canonical_name), '') IS NOT NULL
                AND LOWER(BTRIM(canonical_name)) <> LOWER(COALESCE(NULLIF(BTRIM(raw_label), ''), ''))
                AND COALESCE(NULLIF(BTRIM(status), ''), '') IN ('ok', 'mixed')
                AND COALESCE(NULLIF(BTRIM(name_source), ''), '') NOT IN ('fallback_cleaned', 'raw')
                AND COALESCE(LOWER(narrative_summary), '') NOT LIKE '%safe fallback because ai enrichment was unavailable%'
                AND COALESCE(LOWER(narrative_summary), '') NOT LIKE '%using the cleaned fallback label%'
                AND COALESCE(LOWER(abstain_reason), '') NOT LIKE '%visible runtime ai naming failed%'
                AND NOT EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(COALESCE(mixed_signals, '[]'::jsonb)) AS signal(value)
                    WHERE LOWER(signal.value) = 'visible_runtime_openai_failure'
                )
                THEN 'ready'
            WHEN
                COALESCE(LOWER(narrative_summary), '') LIKE '%safe fallback because ai enrichment was unavailable%'
                OR COALESCE(LOWER(narrative_summary), '') LIKE '%using the cleaned fallback label%'
                OR COALESCE(LOWER(abstain_reason), '') LIKE '%visible runtime ai naming failed%'
                OR EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(COALESCE(mixed_signals, '[]'::jsonb)) AS signal(value)
                    WHERE LOWER(signal.value) = 'visible_runtime_openai_failure'
                )
                THEN 'pending'
            WHEN COALESCE(NULLIF(BTRIM(status), ''), '') IN ('insufficient_evidence', 'junk')
                THEN 'failed'
            ELSE 'pending'
        END AS resolved_name_status,
        CASE
            WHEN COALESCE(NULLIF(BTRIM(name_source), ''), '') IN (
                'ai_exact',
                'historical_exact',
                'historical_alias',
                'fallback_cleaned',
                'raw',
                'none'
            )
                THEN BTRIM(name_source)
            WHEN
                NULLIF(BTRIM(canonical_name), '') IS NOT NULL
                AND LOWER(BTRIM(canonical_name)) <> LOWER(COALESCE(NULLIF(BTRIM(raw_label), ''), ''))
                AND COALESCE(NULLIF(BTRIM(status), ''), '') IN ('ok', 'mixed')
                AND COALESCE(LOWER(narrative_summary), '') NOT LIKE '%safe fallback because ai enrichment was unavailable%'
                AND COALESCE(LOWER(narrative_summary), '') NOT LIKE '%using the cleaned fallback label%'
                AND COALESCE(LOWER(abstain_reason), '') NOT LIKE '%visible runtime ai naming failed%'
                AND NOT EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(COALESCE(mixed_signals, '[]'::jsonb)) AS signal(value)
                    WHERE LOWER(signal.value) = 'visible_runtime_openai_failure'
                )
                THEN 'ai_exact'
            WHEN NULLIF(BTRIM(raw_label), '') IS NOT NULL
                THEN 'fallback_cleaned'
            ELSE 'none'
        END AS resolved_name_source
    FROM public.topic_ai_enrichments
)
UPDATE public.topic_ai_enrichments AS target
SET name_status = classified.resolved_name_status,
    name_source = classified.resolved_name_source
FROM classified
WHERE classified.id = target.id
  AND (
      target.name_status IS DISTINCT FROM classified.resolved_name_status
      OR target.name_source IS DISTINCT FROM classified.resolved_name_source
  );

CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_name_status
    ON public.topic_ai_enrichments (name_status, refreshed_at DESC);

CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_name_source
    ON public.topic_ai_enrichments (name_source, refreshed_at DESC);

COMMIT;
