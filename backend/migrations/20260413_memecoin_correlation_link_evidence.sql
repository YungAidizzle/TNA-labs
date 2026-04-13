ALTER TABLE IF EXISTS public.memecoin_correlation_links
    ADD COLUMN IF NOT EXISTS why_linked TEXT;

ALTER TABLE IF EXISTS public.memecoin_correlation_links
    ADD COLUMN IF NOT EXISTS match_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE IF EXISTS public.memecoin_correlation_links
    ADD COLUMN IF NOT EXISTS raw_match_signals_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_memecoin_correlation_links_match_type
    ON public.memecoin_correlation_links ((raw_match_signals_json ->> 'match_type'));

CREATE INDEX IF NOT EXISTS idx_memecoin_correlation_links_raw_signals_gin
    ON public.memecoin_correlation_links
    USING GIN (raw_match_signals_json jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_trend_memecoin_links_match_type
    ON public.trend_memecoin_links ((raw_match_signals_json ->> 'match_type'));

CREATE INDEX IF NOT EXISTS idx_trend_memecoin_links_raw_signals_gin
    ON public.trend_memecoin_links
    USING GIN (raw_match_signals_json jsonb_path_ops);
