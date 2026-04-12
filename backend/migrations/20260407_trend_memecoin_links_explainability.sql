ALTER TABLE IF EXISTS public.trend_memecoin_links
    ADD COLUMN IF NOT EXISTS confidence_band TEXT NOT NULL DEFAULT 'coverage';

ALTER TABLE IF EXISTS public.trend_memecoin_links
    ADD COLUMN IF NOT EXISTS why_linked TEXT;

ALTER TABLE IF EXISTS public.trend_memecoin_links
    ADD COLUMN IF NOT EXISTS match_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE IF EXISTS public.trend_memecoin_links
    ADD COLUMN IF NOT EXISTS raw_match_signals_json JSONB NOT NULL DEFAULT '{}'::jsonb;
