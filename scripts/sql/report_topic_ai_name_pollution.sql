WITH suspicious AS (
    SELECT
        id,
        topic_key,
        as_of_window_end,
        raw_label,
        canonical_name,
        fallback_label,
        status,
        name_status,
        name_source,
        narrative_summary,
        abstain_reason,
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
)
SELECT
    suspicious_reason,
    COUNT(*) AS row_count
FROM suspicious
WHERE suspicious_reason IS NOT NULL
GROUP BY suspicious_reason
ORDER BY row_count DESC, suspicious_reason ASC;

WITH suspicious AS (
    SELECT
        topic_key,
        as_of_window_end,
        raw_label,
        canonical_name,
        fallback_label,
        status,
        name_status,
        name_source,
        narrative_summary,
        abstain_reason,
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
)
SELECT
    suspicious_reason,
    topic_key,
    as_of_window_end,
    raw_label,
    canonical_name,
    fallback_label,
    status,
    name_status,
    name_source,
    LEFT(COALESCE(narrative_summary, abstain_reason, ''), 160) AS diagnostic_excerpt
FROM suspicious
WHERE suspicious_reason IS NOT NULL
ORDER BY as_of_window_end DESC, topic_key ASC
LIMIT 200;

SELECT
    COALESCE(NULLIF(BTRIM(metadata_json ->> 'writer_identity'), ''), 'unknown') AS writer_identity,
    COALESCE(NULLIF(BTRIM(metadata_json ->> 'writer_role'), ''), 'unknown') AS writer_role,
    COUNT(*) AS row_count,
    MAX(COALESCE(refreshed_at, generated_at)) AS latest_write_at
FROM public.topic_ai_enrichments
GROUP BY 1, 2
ORDER BY latest_write_at DESC NULLS LAST, row_count DESC, writer_identity ASC;
