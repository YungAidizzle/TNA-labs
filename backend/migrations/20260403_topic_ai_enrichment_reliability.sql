ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS why_attention TEXT;

ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ok';

ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS evidence_post_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS mixed_signals JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS abstain_reason TEXT;

ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS validator_errors JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS validated_output_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS raw_response_text TEXT;

UPDATE public.topic_ai_enrichments
SET narrative_summary = COALESCE(
        NULLIF(BTRIM(narrative_summary), ''),
        NULLIF(BTRIM(context_paragraph), ''),
        NULLIF(BTRIM(short_description), ''),
        'Narrative enrichment is unavailable for this trend window.'
    ),
    status = COALESCE(NULLIF(BTRIM(status), ''), 'ok'),
    evidence_post_ids = CASE
        WHEN evidence_post_ids IS NULL OR jsonb_typeof(evidence_post_ids) <> 'array'
            THEN COALESCE(supporting_post_ids, '[]'::jsonb)
        ELSE evidence_post_ids
    END,
    mixed_signals = CASE
        WHEN mixed_signals IS NULL OR jsonb_typeof(mixed_signals) <> 'array'
            THEN '[]'::jsonb
        ELSE mixed_signals
    END,
    validator_errors = CASE
        WHEN validator_errors IS NULL OR jsonb_typeof(validator_errors) <> 'array'
            THEN '[]'::jsonb
        ELSE validator_errors
    END,
    validated_output_json = CASE
        WHEN validated_output_json IS NULL OR jsonb_typeof(validated_output_json) <> 'object'
            THEN jsonb_build_object(
                'status', COALESCE(NULLIF(BTRIM(status), ''), 'ok'),
                'canonical_name', NULLIF(BTRIM(canonical_name), ''),
                'summary', NULLIF(BTRIM(narrative_summary), ''),
                'why_attention', NULL,
                'confidence', COALESCE(summary_confidence, 0),
                'evidence_post_ids', COALESCE(evidence_post_ids, supporting_post_ids, '[]'::jsonb),
                'evidence_entities', COALESCE(key_entities, '[]'::jsonb),
                'mixed_signals', COALESCE(mixed_signals, '[]'::jsonb),
                'abstain_reason', NULLIF(BTRIM(abstain_reason), '')
            )
        ELSE validated_output_json
    END
WHERE narrative_summary IS NULL
   OR BTRIM(narrative_summary) = ''
   OR status IS NULL
   OR BTRIM(status) = ''
   OR evidence_post_ids IS NULL
   OR mixed_signals IS NULL
   OR validator_errors IS NULL
   OR validated_output_json IS NULL;

CREATE TABLE IF NOT EXISTS public.topic_ai_enrichment_runs (
    id BIGSERIAL PRIMARY KEY,
    topic_key TEXT NOT NULL,
    as_of_window_end TIMESTAMPTZ NOT NULL,
    raw_label TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    short_description TEXT NOT NULL,
    context_paragraph TEXT NOT NULL,
    narrative_summary TEXT,
    why_attention TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    key_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
    trend_category TEXT,
    summary_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    evidence_post_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    mixed_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
    abstain_reason TEXT,
    validator_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    validated_output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    raw_response_text TEXT,
    supporting_post_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    supporting_sample JSONB NOT NULL DEFAULT '[]'::jsonb,
    representative_post_count INTEGER NOT NULL DEFAULT 0,
    model_name TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT topic_ai_enrichment_runs_summary_confidence_range
        CHECK (summary_confidence >= 0 AND summary_confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichment_runs_topic_generated
    ON public.topic_ai_enrichment_runs (topic_key, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichment_runs_generated
    ON public.topic_ai_enrichment_runs (generated_at DESC);
