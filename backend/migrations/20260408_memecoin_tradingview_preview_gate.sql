ALTER TABLE public.memecoin_assets
    ADD COLUMN IF NOT EXISTS tradingview_symbol TEXT,
    ADD COLUMN IF NOT EXISTS tradingview_exchange TEXT,
    ADD COLUMN IF NOT EXISTS tradingview_embed_symbol TEXT,
    ADD COLUMN IF NOT EXISTS tv_resolution_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS tv_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS tv_last_checked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS tv_failure_reason TEXT,
    ADD COLUMN IF NOT EXISTS tv_search_evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS has_verified_tradingview_preview BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.memecoin_assets
SET
    tv_resolution_status = COALESCE(NULLIF(tv_resolution_status, ''), 'pending'),
    tv_search_evidence_json = COALESCE(tv_search_evidence_json, '{}'::jsonb),
    has_verified_tradingview_preview = COALESCE(has_verified_tradingview_preview, FALSE)
WHERE
    tv_resolution_status IS NULL
    OR tv_resolution_status = ''
    OR tv_search_evidence_json IS NULL
    OR has_verified_tradingview_preview IS NULL;

CREATE INDEX IF NOT EXISTS idx_memecoin_assets_tv_verified
    ON public.memecoin_assets (has_verified_tradingview_preview, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memecoin_assets_tv_last_checked
    ON public.memecoin_assets (tv_last_checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_memecoin_assets_tv_status
    ON public.memecoin_assets (tv_resolution_status, updated_at DESC);
