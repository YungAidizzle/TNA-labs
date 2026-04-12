BEGIN;

ALTER TABLE public.topic_ai_enrichments
    ADD COLUMN IF NOT EXISTS narrative_summary TEXT;

UPDATE public.topic_ai_enrichments
SET narrative_summary = COALESCE(
    NULLIF(BTRIM(narrative_summary), ''),
    NULLIF(BTRIM(context_paragraph), ''),
    NULLIF(BTRIM(short_description), '')
)
WHERE narrative_summary IS NULL
   OR BTRIM(narrative_summary) = '';

COMMIT;
