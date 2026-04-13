CREATE TABLE IF NOT EXISTS public.trend_snapshots (
    id BIGSERIAL PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    generated_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ NULL,
    trend_count INTEGER NOT NULL DEFAULT 0 CHECK (trend_count >= 0 AND trend_count <= 100),
    model_name TEXT NULL,
    prompt_version TEXT NULL,
    error_message TEXT NULL,
    raw_response_json JSONB NULL,
    notes_json JSONB NULL
);

CREATE INDEX IF NOT EXISTS idx_trend_snapshots_latest_success
    ON public.trend_snapshots (generated_at DESC, id DESC)
    WHERE status = 'succeeded';

CREATE INDEX IF NOT EXISTS idx_trend_snapshots_status_created
    ON public.trend_snapshots (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.trend_snapshot_items (
    id BIGSERIAL PRIMARY KEY,
    snapshot_id BIGINT NOT NULL REFERENCES public.trend_snapshots(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL CHECK (rank >= 1 AND rank <= 100),
    trend_key TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    confidence_score NUMERIC(5,2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
    ai_rank_score NUMERIC(5,2) NOT NULL CHECK (ai_rank_score >= 0 AND ai_rank_score <= 100),
    importance_note TEXT NULL,
    category TEXT NULL,
    source_scope TEXT NULL,
    source_count INTEGER NULL CHECK (source_count IS NULL OR source_count >= 0),
    generated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_trend_snapshot_items_snapshot_rank UNIQUE (snapshot_id, rank),
    CONSTRAINT uq_trend_snapshot_items_snapshot_key UNIQUE (snapshot_id, trend_key)
);

CREATE INDEX IF NOT EXISTS idx_trend_snapshot_items_snapshot_rank
    ON public.trend_snapshot_items (snapshot_id, rank ASC);

CREATE INDEX IF NOT EXISTS idx_trend_snapshot_items_trend_key
    ON public.trend_snapshot_items (trend_key);
