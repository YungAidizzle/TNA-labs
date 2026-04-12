CREATE TABLE IF NOT EXISTS public.memecoin_assets (
    asset_id BIGSERIAL PRIMARY KEY,
    chain_id TEXT NOT NULL,
    token_address TEXT NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    icon_url TEXT,
    header_url TEXT,
    description TEXT,
    dexscreener_url TEXT,
    websites_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    socials_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    holder_count INTEGER,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_memecoin_assets_chain_token UNIQUE (chain_id, token_address)
);

CREATE INDEX IF NOT EXISTS idx_memecoin_assets_chain_symbol
    ON public.memecoin_assets (chain_id, symbol);

CREATE INDEX IF NOT EXISTS idx_memecoin_assets_updated_at
    ON public.memecoin_assets (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.memecoin_correlation_runs (
    run_id BIGSERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    source TEXT NOT NULL DEFAULT 'dexscreener',
    active_trend_count INTEGER NOT NULL DEFAULT 0,
    discovery_token_count INTEGER NOT NULL DEFAULT 0,
    eligible_token_count INTEGER NOT NULL DEFAULT 0,
    published_result_count INTEGER NOT NULL DEFAULT 0,
    request_count INTEGER NOT NULL DEFAULT 0,
    cache_hit_count INTEGER NOT NULL DEFAULT 0,
    stale_cache_hit_count INTEGER NOT NULL DEFAULT 0,
    search_query_count INTEGER NOT NULL DEFAULT 0,
    token_batch_count INTEGER NOT NULL DEFAULT 0,
    notes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memecoin_correlation_runs_completed_at
    ON public.memecoin_correlation_runs (completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_memecoin_correlation_runs_latest_success
    ON public.memecoin_correlation_runs (completed_at DESC)
    WHERE status = 'succeeded' AND published_result_count > 0;

CREATE TABLE IF NOT EXISTS public.memecoin_market_snapshots (
    snapshot_id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES public.memecoin_correlation_runs (run_id) ON DELETE CASCADE,
    asset_id BIGINT NOT NULL REFERENCES public.memecoin_assets (asset_id) ON DELETE CASCADE,
    pair_address TEXT NOT NULL,
    pair_url TEXT,
    quote_symbol TEXT,
    quote_token_address TEXT,
    quote_token_name TEXT,
    price_usd DOUBLE PRECISION,
    liquidity_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    volume_h24_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    volume_h6_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    volume_h1_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    price_change_h24_pct DOUBLE PRECISION,
    price_change_h6_pct DOUBLE PRECISION,
    price_change_h1_pct DOUBLE PRECISION,
    buys_h24 INTEGER NOT NULL DEFAULT 0,
    sells_h24 INTEGER NOT NULL DEFAULT 0,
    txns_h24 INTEGER NOT NULL DEFAULT 0,
    txns_h6 INTEGER NOT NULL DEFAULT 0,
    txns_h1 INTEGER NOT NULL DEFAULT 0,
    fdv_usd DOUBLE PRECISION,
    market_cap_usd DOUBLE PRECISION,
    pair_created_at TIMESTAMPTZ,
    market_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_memecoin_market_snapshots_run_asset UNIQUE (run_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_memecoin_market_snapshots_asset_recorded
    ON public.memecoin_market_snapshots (asset_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_memecoin_market_snapshots_pair_address
    ON public.memecoin_market_snapshots (pair_address);

CREATE TABLE IF NOT EXISTS public.memecoin_correlation_results (
    result_id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES public.memecoin_correlation_runs (run_id) ON DELETE CASCADE,
    asset_id BIGINT NOT NULL REFERENCES public.memecoin_assets (asset_id) ON DELETE CASCADE,
    market_snapshot_id BIGINT REFERENCES public.memecoin_market_snapshots (snapshot_id) ON DELETE SET NULL,
    rank INTEGER NOT NULL,
    correlation_score DOUBLE PRECISION NOT NULL,
    correlation_label TEXT NOT NULL,
    strongest_topic_key TEXT NOT NULL,
    strongest_topic_label TEXT NOT NULL,
    strongest_trend_category TEXT,
    strongest_narrative_summary TEXT,
    market_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    lexical_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    mention_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    timing_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    culture_fit_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    support_post_count INTEGER NOT NULL DEFAULT 0,
    support_interaction_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_political_dominant BOOLEAN NOT NULL DEFAULT FALSE,
    dexscreener_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_memecoin_correlation_results_run_rank UNIQUE (run_id, rank),
    CONSTRAINT uq_memecoin_correlation_results_run_asset UNIQUE (run_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_memecoin_correlation_results_run_rank
    ON public.memecoin_correlation_results (run_id, rank ASC);

CREATE INDEX IF NOT EXISTS idx_memecoin_correlation_results_asset
    ON public.memecoin_correlation_results (asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.memecoin_correlation_links (
    link_id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES public.memecoin_correlation_runs (run_id) ON DELETE CASCADE,
    asset_id BIGINT NOT NULL REFERENCES public.memecoin_assets (asset_id) ON DELETE CASCADE,
    topic_key TEXT NOT NULL,
    topic_label TEXT NOT NULL,
    trend_category TEXT,
    narrative_summary TEXT,
    lexical_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    mention_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    timing_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    culture_fit_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    link_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    support_post_count INTEGER NOT NULL DEFAULT 0,
    support_interaction_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_memecoin_correlation_links_run_asset_topic UNIQUE (run_id, asset_id, topic_key)
);

CREATE INDEX IF NOT EXISTS idx_memecoin_correlation_links_run_asset
    ON public.memecoin_correlation_links (run_id, asset_id, is_primary DESC, link_score DESC);

CREATE INDEX IF NOT EXISTS idx_memecoin_correlation_links_topic
    ON public.memecoin_correlation_links (topic_key, created_at DESC);
