CREATE TABLE IF NOT EXISTS public.trend_memecoin_links (
    id BIGSERIAL PRIMARY KEY,
    topic_key TEXT NOT NULL,
    topic_label TEXT NOT NULL,
    rank INTEGER NOT NULL,
    chain_id TEXT NOT NULL,
    coin_address TEXT NOT NULL,
    pair_address TEXT,
    dexscreener_url TEXT,
    coin_symbol TEXT NOT NULL,
    coin_name TEXT NOT NULL,
    confidence_score DOUBLE PRECISION NOT NULL,
    mention_count INTEGER NOT NULL DEFAULT 0,
    engagement_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    age_hours DOUBLE PRECISION,
    liquidity DOUBLE PRECISION,
    volume_24h DOUBLE PRECISION,
    market_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    memecoin_fit_score DOUBLE PRECISION,
    source_run_id BIGINT REFERENCES public.memecoin_correlation_runs (run_id) ON DELETE SET NULL,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_trend_memecoin_links_topic_rank UNIQUE (topic_key, rank),
    CONSTRAINT uq_trend_memecoin_links_topic_coin UNIQUE (topic_key, chain_id, coin_address)
);

CREATE INDEX IF NOT EXISTS idx_trend_memecoin_links_topic
    ON public.trend_memecoin_links (topic_key);

CREATE INDEX IF NOT EXISTS idx_trend_memecoin_links_confidence
    ON public.trend_memecoin_links (confidence_score DESC);

CREATE INDEX IF NOT EXISTS idx_trend_memecoin_links_coin_address
    ON public.trend_memecoin_links (coin_address);

CREATE INDEX IF NOT EXISTS idx_trend_memecoin_links_topic_confidence
    ON public.trend_memecoin_links (topic_key, confidence_score DESC, rank ASC);
