BEGIN;

CREATE OR REPLACE FUNCTION public.topic_ai_name_is_fragment_variant(candidate TEXT, other_value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    left_value TEXT := REGEXP_REPLACE(LOWER(COALESCE(candidate, '')), '[^a-z0-9]+', '', 'g');
    right_value TEXT := REGEXP_REPLACE(LOWER(COALESCE(other_value, '')), '[^a-z0-9]+', '', 'g');
    shorter_value TEXT;
    longer_value TEXT;
    left_index INTEGER := 1;
    right_index INTEGER := 1;
    edits INTEGER := 0;
BEGIN
    IF left_value = '' OR right_value = '' OR left_value = right_value THEN
        RETURN FALSE;
    END IF;

    IF LENGTH(left_value) <= LENGTH(right_value) THEN
        shorter_value := left_value;
        longer_value := right_value;
    ELSE
        shorter_value := right_value;
        longer_value := left_value;
    END IF;

    IF LENGTH(shorter_value) < 4 OR LENGTH(longer_value) < 5 THEN
        RETURN FALSE;
    END IF;
    IF shorter_value = SUBSTRING(longer_value FROM 2)
       OR shorter_value = LEFT(longer_value, LENGTH(longer_value) - 1) THEN
        RETURN TRUE;
    END IF;
    IF POSITION(shorter_value IN longer_value) > 0
       AND LENGTH(longer_value) - LENGTH(shorter_value) <= 2 THEN
        RETURN TRUE;
    END IF;
    IF ABS(LENGTH(left_value) - LENGTH(right_value)) > 1 THEN
        RETURN FALSE;
    END IF;

    WHILE left_index <= LENGTH(left_value) AND right_index <= LENGTH(right_value) LOOP
        IF SUBSTRING(left_value FROM left_index FOR 1) = SUBSTRING(right_value FROM right_index FOR 1) THEN
            left_index := left_index + 1;
            right_index := right_index + 1;
            CONTINUE;
        END IF;

        edits := edits + 1;
        IF edits > 1 THEN
            RETURN FALSE;
        END IF;

        IF LENGTH(left_value) > LENGTH(right_value) THEN
            left_index := left_index + 1;
        ELSIF LENGTH(right_value) > LENGTH(left_value) THEN
            right_index := right_index + 1;
        ELSE
            left_index := left_index + 1;
            right_index := right_index + 1;
        END IF;
    END LOOP;

    edits := edits + (LENGTH(left_value) - left_index + 1) + (LENGTH(right_value) - right_index + 1);
    RETURN edits <= 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.topic_ai_name_has_narrative_shape(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    WITH normalized AS (
        SELECT REGEXP_REPLACE(LOWER(COALESCE(value, '')), '[^a-z0-9]+', ' ', 'g') AS text_value
    ),
    tokenized AS (
        SELECT ARRAY_REMOVE(REGEXP_SPLIT_TO_ARRAY(BTRIM(text_value), '\s+'), '') AS tokens
        FROM normalized
    )
    SELECT
        COALESCE(ARRAY_LENGTH(tokens, 1), 0) >= 2
        OR EXISTS (
            SELECT 1
            FROM UNNEST(tokens) AS token(value_token)
            WHERE token.value_token IN (
                'appeals',
                'backlash',
                'campaign',
                'controversy',
                'criticism',
                'debate',
                'discourse',
                'escalation',
                'fallout',
                'holiday',
                'mentions',
                'mission',
                'movie',
                'policy',
                'reactions',
                'rhetoric',
                'speculation',
                'trial'
            )
        )
    FROM tokenized;
$$;

CREATE OR REPLACE FUNCTION public.topic_ai_sanitize_fallback_label(
    fallback_label_value TEXT,
    raw_label_value TEXT,
    canonical_name_value TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    candidates TEXT[] := ARRAY[
        NULLIF(BTRIM(fallback_label_value), ''),
        NULLIF(BTRIM(raw_label_value), ''),
        NULLIF(BTRIM(canonical_name_value), '')
    ];
    candidate TEXT;
    other_candidate TEXT;
    compact_candidate TEXT;
BEGIN
    FOREACH candidate IN ARRAY candidates LOOP
        IF candidate IS NULL THEN
            CONTINUE;
        END IF;

        compact_candidate := REGEXP_REPLACE(LOWER(candidate), '[^a-z0-9]+', '', 'g');
        IF compact_candidate = ''
           OR compact_candidate ~ '(?:apital|eneral|etting|hased|arket|tion|ment|ally|ized)$'
           OR LOWER(candidate) ~ '\m(cluster|content|conversation|discussion|mixed|narrative|posts?|topic|trend|updates?)\M' THEN
            CONTINUE;
        END IF;

        FOREACH other_candidate IN ARRAY candidates LOOP
            IF other_candidate IS NULL OR other_candidate = candidate THEN
                CONTINUE;
            END IF;
            IF LENGTH(REGEXP_REPLACE(LOWER(other_candidate), '[^a-z0-9]+', '', 'g')) > LENGTH(compact_candidate)
               AND public.topic_ai_name_is_fragment_variant(candidate, other_candidate) THEN
                candidate := NULL;
                EXIT;
            END IF;
        END LOOP;

        IF candidate IS NOT NULL THEN
            RETURN candidate;
        END IF;
    END LOOP;

    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_topic_ai_enrichment_name_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    raw_label_value TEXT;
    canonical_name_value TEXT;
    fallback_label_value TEXT;
    status_value TEXT;
    incoming_name_source TEXT;
    writer_identity TEXT;
    writer_role TEXT;
    narrative_text TEXT;
    used_fallback BOOLEAN;
    has_runtime_failure BOOLEAN;
    canonical_trustworthy BOOLEAN;
    old_trusted BOOLEAN := false;
    old_authoritative BOOLEAN := false;
    incoming_authoritative BOOLEAN := false;
    preserving_authoritative_row BOOLEAN := false;
BEGIN
    raw_label_value := NULLIF(BTRIM(COALESCE(NEW.raw_label, NEW.topic_key)), '');
    canonical_name_value := NULLIF(BTRIM(NEW.canonical_name), '');
    IF canonical_name_value IS NOT NULL
       AND raw_label_value IS NOT NULL
       AND LOWER(canonical_name_value) = LOWER(raw_label_value) THEN
        canonical_name_value := NULL;
    END IF;

    fallback_label_value := public.topic_ai_sanitize_fallback_label(
        NEW.fallback_label,
        raw_label_value,
        canonical_name_value
    );
    status_value := COALESCE(NULLIF(LOWER(BTRIM(NEW.status)), ''), 'ok');
    incoming_name_source := COALESCE(NULLIF(LOWER(BTRIM(NEW.name_source)), ''), '');
    writer_identity := COALESCE(
        NULLIF(BTRIM(COALESCE(NEW.metadata_json ->> 'writer_identity', '')), ''),
        'unknown'
    );
    writer_role := COALESCE(
        NULLIF(BTRIM(COALESCE(NEW.metadata_json ->> 'writer_role', '')), ''),
        'unknown'
    );
    incoming_authoritative := writer_identity IN ('backend.main:trend_title_generation', 'backend.main:trend_enrichment');
    narrative_text := LOWER(
        CONCAT_WS(' ', COALESCE(NEW.narrative_summary, ''), COALESCE(NEW.abstain_reason, ''))
    );
    used_fallback := COALESCE((NEW.metadata_json ->> 'used_fallback')::boolean, false);
    has_runtime_failure := (
        narrative_text LIKE '%safe fallback because ai enrichment was unavailable%'
        OR narrative_text LIKE '%using the cleaned fallback label%'
        OR narrative_text LIKE '%visible runtime ai naming failed%'
        OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(NEW.mixed_signals, '[]'::jsonb)) AS signal(value)
            WHERE LOWER(signal.value) = 'visible_runtime_openai_failure'
        )
    );

    canonical_trustworthy := (
        canonical_name_value IS NOT NULL
        AND status_value IN ('ok', 'mixed')
        AND NOT used_fallback
        AND NOT has_runtime_failure
        AND LOWER(BTRIM(canonical_name_value)) !~ '\m(cluster|content|conversation|discussion|mixed|narrative|posts?|topic|trend|updates?)\M'
        AND LOWER(REGEXP_REPLACE(canonical_name_value, '[^a-z0-9]+', '', 'g'))
            !~ '(?:apital|eneral|etting|hased|arket|tion|ment|ally|ized)$'
        AND public.topic_ai_name_has_narrative_shape(canonical_name_value)
    );

    IF TG_OP = 'UPDATE' THEN
        old_trusted := (
            COALESCE(NULLIF(LOWER(BTRIM(OLD.name_status)), ''), '') = 'ready'
            AND COALESCE(NULLIF(LOWER(BTRIM(OLD.name_source)), ''), '') IN (
                'ai_exact',
                'historical_exact',
                'historical_alias'
            )
            AND NULLIF(BTRIM(OLD.canonical_name), '') IS NOT NULL
        );
        old_authoritative := COALESCE(OLD.metadata_json ->> 'authoritative_writer', 'false') = 'true';
    END IF;

    IF canonical_trustworthy THEN
        NEW.canonical_name := canonical_name_value;
        NEW.name_status := 'ready';
        NEW.name_source := CASE
            WHEN incoming_name_source IN ('ai_exact', 'historical_exact', 'historical_alias')
                THEN incoming_name_source
            WHEN incoming_authoritative
                THEN 'ai_exact'
            ELSE 'historical_alias'
        END;
    ELSE
        NEW.canonical_name := NULL;
        NEW.name_status := CASE
            WHEN status_value IN ('insufficient_evidence', 'junk') AND NOT has_runtime_failure
                THEN 'failed'
            ELSE 'pending'
        END;
        NEW.name_source := CASE
            WHEN fallback_label_value IS NOT NULL THEN 'fallback_cleaned'
            ELSE 'none'
        END;
    END IF;

    IF old_trusted
       AND old_authoritative
       AND NOT (
            NEW.name_status = 'ready'
            AND NEW.name_source IN ('ai_exact', 'historical_exact', 'historical_alias')
            AND NULLIF(BTRIM(NEW.canonical_name), '') IS NOT NULL
            AND incoming_authoritative
       ) THEN
        preserving_authoritative_row := true;
        NEW.raw_label := COALESCE(NULLIF(BTRIM(OLD.raw_label), ''), raw_label_value, NEW.raw_label);
        NEW.canonical_name := NULLIF(BTRIM(OLD.canonical_name), '');
        NEW.name_status := COALESCE(NULLIF(LOWER(BTRIM(OLD.name_status)), ''), 'ready');
        NEW.name_source := COALESCE(NULLIF(LOWER(BTRIM(OLD.name_source)), ''), 'historical_alias');
        fallback_label_value := COALESCE(
            public.topic_ai_sanitize_fallback_label(OLD.fallback_label, OLD.raw_label, OLD.canonical_name),
            fallback_label_value,
            NULLIF(BTRIM(OLD.fallback_label), ''),
            raw_label_value,
            NULLIF(BTRIM(OLD.canonical_name), '')
        );
        NEW.short_description := COALESCE(NULLIF(BTRIM(OLD.short_description), ''), NEW.short_description);
        NEW.context_paragraph := COALESCE(NULLIF(BTRIM(OLD.context_paragraph), ''), NEW.context_paragraph);
        NEW.narrative_summary := COALESCE(NULLIF(BTRIM(OLD.narrative_summary), ''), NEW.narrative_summary);
        NEW.why_attention := COALESCE(NULLIF(BTRIM(OLD.why_attention), ''), NEW.why_attention);
        NEW.status := COALESCE(NULLIF(BTRIM(OLD.status), ''), NEW.status);
        NEW.key_entities := COALESCE(OLD.key_entities, NEW.key_entities);
        NEW.trend_category := COALESCE(NULLIF(BTRIM(OLD.trend_category), ''), NEW.trend_category);
        NEW.summary_confidence := COALESCE(OLD.summary_confidence, NEW.summary_confidence);
        NEW.evidence_post_ids := COALESCE(OLD.evidence_post_ids, NEW.evidence_post_ids);
        NEW.mixed_signals := COALESCE(OLD.mixed_signals, NEW.mixed_signals);
        NEW.abstain_reason := COALESCE(NULLIF(BTRIM(OLD.abstain_reason), ''), NEW.abstain_reason);
        NEW.model_name := COALESCE(NULLIF(BTRIM(OLD.model_name), ''), NEW.model_name);
        NEW.prompt_version := COALESCE(NULLIF(BTRIM(OLD.prompt_version), ''), NEW.prompt_version);
        NEW.generated_at := COALESCE(OLD.generated_at, NEW.generated_at);
        NEW.refreshed_at := COALESCE(OLD.refreshed_at, NEW.refreshed_at);
        NEW.expires_at := COALESCE(OLD.expires_at, NEW.expires_at);
        NEW.metadata_json := COALESCE(OLD.metadata_json, NEW.metadata_json);
        writer_identity := COALESCE(NULLIF(BTRIM(COALESCE(OLD.metadata_json ->> 'writer_identity', '')), ''), writer_identity);
        writer_role := COALESCE(NULLIF(BTRIM(COALESCE(OLD.metadata_json ->> 'writer_role', '')), ''), writer_role);
        incoming_authoritative := true;
    END IF;

    NEW.fallback_label := fallback_label_value;
    NEW.metadata_json := COALESCE(NEW.metadata_json, '{}'::jsonb);
    NEW.metadata_json := jsonb_set(
        jsonb_set(
            jsonb_set(
                jsonb_set(
                    NEW.metadata_json,
                    '{writer_identity}',
                    to_jsonb(writer_identity),
                    true
                ),
                '{writer_role}',
                to_jsonb(writer_role),
                true
            ),
            '{authoritative_writer}',
            to_jsonb(CASE WHEN preserving_authoritative_row THEN true ELSE incoming_authoritative END),
            true
        ),
        '{resolved_name_status}',
        to_jsonb(NEW.name_status),
        true
    );
    NEW.metadata_json := jsonb_set(
        NEW.metadata_json,
        '{resolved_name_source}',
        to_jsonb(NEW.name_source),
        true
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_topic_ai_enrichments_normalize_name_fields
ON public.topic_ai_enrichments;

CREATE TRIGGER trg_topic_ai_enrichments_normalize_name_fields
BEFORE INSERT OR UPDATE
ON public.topic_ai_enrichments
FOR EACH ROW
EXECUTE FUNCTION public.normalize_topic_ai_enrichment_name_fields();

UPDATE public.topic_ai_enrichments
SET raw_label = COALESCE(raw_label, topic_key),
    fallback_label = public.topic_ai_sanitize_fallback_label(
        fallback_label,
        raw_label,
        canonical_name
    );

CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_writer_identity_refreshed
    ON public.topic_ai_enrichments (
        (COALESCE(NULLIF(BTRIM(metadata_json ->> 'writer_identity'), ''), 'unknown')),
        refreshed_at DESC
    );

COMMIT;
