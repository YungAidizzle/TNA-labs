WITH suspicious AS (
    SELECT
        id,
        CASE
            WHEN COALESCE(LOWER(narrative_summary), '') LIKE '%safe fallback because ai enrichment was unavailable%'
                THEN 'fallback_narrative'
            WHEN COALESCE(LOWER(narrative_summary), '') LIKE '%using the cleaned fallback label%'
                THEN 'fallback_narrative'
            WHEN COALESCE(LOWER(abstain_reason), '') LIKE '%visible runtime ai naming failed%'
                THEN 'runtime_failure'
            WHEN EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(COALESCE(mixed_signals, '[]'::jsonb)) AS signal(value)
                WHERE LOWER(signal.value) = 'visible_runtime_openai_failure'
            )
                THEN 'runtime_failure'
            WHEN
                COALESCE(NULLIF(BTRIM(status), ''), '') IN ('ok', 'mixed')
                AND NULLIF(BTRIM(canonical_name), '') IS NOT NULL
                AND LOWER(BTRIM(canonical_name)) = LOWER(COALESCE(NULLIF(BTRIM(raw_label), ''), ''))
                THEN 'canonical_equals_raw'
            WHEN
                COALESCE(NULLIF(BTRIM(status), ''), '') IN ('ok', 'mixed')
                AND (evidence_post_ids IS NULL OR jsonb_array_length(COALESCE(evidence_post_ids, '[]'::jsonb)) = 0)
                THEN 'missing_evidence'
            WHEN
                COALESCE(NULLIF(BTRIM(status), ''), '') IN ('ok', 'mixed')
                AND LOWER(REGEXP_REPLACE(COALESCE(raw_label, ''), '[^a-z0-9]+', '', 'g'))
                    ~ '(?:apital|eneral|etting|hased|arket|tion|ment|ally|ized)$'
                THEN 'fragment_like_raw_label'
            ELSE NULL
        END AS suspicious_reason
    FROM public.topic_ai_enrichments
),
quarantined AS (
    SELECT
        id,
        suspicious_reason
    FROM suspicious
    WHERE suspicious_reason IS NOT NULL
)
UPDATE public.topic_ai_enrichments AS target
SET fallback_label = COALESCE(
        NULLIF(BTRIM(target.fallback_label), ''),
        NULLIF(BTRIM(target.raw_label), '')
    ),
    canonical_name = NULL,
    name_status = CASE
        WHEN quarantined.suspicious_reason = 'runtime_failure' THEN 'pending'
        ELSE 'failed'
    END,
    name_source = CASE
        WHEN NULLIF(BTRIM(target.raw_label), '') IS NOT NULL THEN 'fallback_cleaned'
        ELSE 'none'
    END,
    metadata_json = jsonb_set(
        jsonb_set(
            jsonb_set(
                COALESCE(target.metadata_json, '{}'::jsonb),
                '{cleanup,previousCanonicalName}',
                to_jsonb(target.canonical_name),
                true
            ),
            '{cleanup,reason}',
            to_jsonb(quarantined.suspicious_reason),
            true
        ),
        '{cleanup,quarantinedAt}',
        to_jsonb((now() AT TIME ZONE 'utc')::text),
        true
    )
FROM quarantined
WHERE target.id = quarantined.id;
