CREATE TABLE IF NOT EXISTS public.trend_dexscreener_matches (
    id BIGSERIAL PRIMARY KEY,
    topic_key TEXT NOT NULL,
    topic_label TEXT NOT NULL,
    rank INTEGER NOT NULL,
    search_query TEXT NOT NULL,
    query_aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    chain_id TEXT NOT NULL,
    coin_address TEXT NOT NULL,
    pair_address TEXT,
    dexscreener_url TEXT,
    dex_id TEXT,
    coin_symbol TEXT NOT NULL,
    coin_name TEXT NOT NULL,
    quote_symbol TEXT,
    quote_token_name TEXT,
    price_usd DOUBLE PRECISION,
    price_change_1h_pct DOUBLE PRECISION,
    price_change_6h_pct DOUBLE PRECISION,
    price_change_24h_pct DOUBLE PRECISION,
    liquidity_usd DOUBLE PRECISION,
    volume_24h_usd DOUBLE PRECISION,
    fdv_usd DOUBLE PRECISION,
    market_cap_usd DOUBLE PRECISION,
    pair_created_at TIMESTAMPTZ,
    market_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    relevance_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    match_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_match_signals_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    websites_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    socials_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    icon_url TEXT,
    source_run_id BIGINT REFERENCES public.ai_narrative_runs (id) ON DELETE SET NULL,
    source_narrative_id BIGINT REFERENCES public.ai_narratives (id) ON DELETE SET NULL,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_live BOOLEAN,
    last_validated_at TIMESTAMPTZ,
    validation_status TEXT,
    validation_reason TEXT,
    last_seen_liquidity_usd DOUBLE PRECISION,
    last_seen_volume_h24 DOUBLE PRECISION,
    last_seen_txns_h24 INTEGER,
    CONSTRAINT uq_trend_dexscreener_matches_topic_rank UNIQUE (topic_key, rank),
    CONSTRAINT uq_trend_dexscreener_matches_topic_coin UNIQUE (topic_key, chain_id, coin_address)
);

CREATE INDEX IF NOT EXISTS idx_trend_dexscreener_matches_topic
    ON public.trend_dexscreener_matches (topic_key);

CREATE INDEX IF NOT EXISTS idx_trend_dexscreener_matches_run
    ON public.trend_dexscreener_matches (source_run_id);

CREATE INDEX IF NOT EXISTS idx_trend_dexscreener_matches_topic_relevance
    ON public.trend_dexscreener_matches (topic_key, relevance_score DESC, rank ASC);
