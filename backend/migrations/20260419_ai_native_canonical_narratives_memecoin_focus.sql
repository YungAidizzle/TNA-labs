BEGIN;

ALTER TABLE public.ai_narrative_candidates
    ADD COLUMN IF NOT EXISTS meme_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS meme_reason TEXT NULL;

ALTER TABLE public.ai_narrative_candidates
    DROP CONSTRAINT IF EXISTS ai_narrative_candidates_meme_score_range;

ALTER TABLE public.ai_narrative_candidates
    ADD CONSTRAINT ai_narrative_candidates_meme_score_range
        CHECK (meme_score >= 0 AND meme_score <= 100);

ALTER TABLE public.ai_narratives
    ADD COLUMN IF NOT EXISTS meme_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS meme_reason TEXT NULL;

ALTER TABLE public.ai_narratives
    DROP CONSTRAINT IF EXISTS ai_narratives_meme_score_range;

ALTER TABLE public.ai_narratives
    ADD CONSTRAINT ai_narratives_meme_score_range
        CHECK (meme_score >= 0 AND meme_score <= 100);

CREATE INDEX IF NOT EXISTS idx_ai_narratives_run_meme_score
    ON public.ai_narratives (run_id, meme_score DESC, confidence DESC);

COMMIT;
