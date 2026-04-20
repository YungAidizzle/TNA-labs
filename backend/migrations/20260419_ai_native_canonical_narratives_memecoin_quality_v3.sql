BEGIN;

ALTER TABLE public.ai_narrative_candidates
    ADD COLUMN IF NOT EXISTS meme_archetype TEXT NULL,
    ADD COLUMN IF NOT EXISTS visual_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS dryness_score DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE public.ai_narrative_candidates
    DROP CONSTRAINT IF EXISTS ai_narrative_candidates_visual_score_range;

ALTER TABLE public.ai_narrative_candidates
    ADD CONSTRAINT ai_narrative_candidates_visual_score_range
        CHECK (visual_score >= 0 AND visual_score <= 100);

ALTER TABLE public.ai_narrative_candidates
    DROP CONSTRAINT IF EXISTS ai_narrative_candidates_dryness_score_range;

ALTER TABLE public.ai_narrative_candidates
    ADD CONSTRAINT ai_narrative_candidates_dryness_score_range
        CHECK (dryness_score >= 0 AND dryness_score <= 100);

ALTER TABLE public.ai_narratives
    ADD COLUMN IF NOT EXISTS meme_archetype TEXT NULL,
    ADD COLUMN IF NOT EXISTS visual_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS dryness_score DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE public.ai_narratives
    DROP CONSTRAINT IF EXISTS ai_narratives_visual_score_range;

ALTER TABLE public.ai_narratives
    ADD CONSTRAINT ai_narratives_visual_score_range
        CHECK (visual_score >= 0 AND visual_score <= 100);

ALTER TABLE public.ai_narratives
    DROP CONSTRAINT IF EXISTS ai_narratives_dryness_score_range;

ALTER TABLE public.ai_narratives
    ADD CONSTRAINT ai_narratives_dryness_score_range
        CHECK (dryness_score >= 0 AND dryness_score <= 100);

CREATE INDEX IF NOT EXISTS idx_ai_narratives_run_board_quality
    ON public.ai_narratives (run_id, meme_score DESC, visual_score DESC, confidence DESC, dryness_score ASC);

COMMIT;
