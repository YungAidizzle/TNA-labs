ALTER TABLE public.memecoin_assets
    ADD COLUMN IF NOT EXISTS pair_address TEXT,
    ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS validation_reason TEXT,
    ADD COLUMN IF NOT EXISTS last_seen_liquidity_usd DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS last_seen_volume_h24 DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS last_seen_txns_h24 INTEGER;

UPDATE public.memecoin_assets
SET
    validation_status = COALESCE(NULLIF(validation_status, ''), 'pending'),
    is_live = COALESCE(is_live, FALSE),
    last_seen_txns_h24 = COALESCE(last_seen_txns_h24, 0)
WHERE
    validation_status IS NULL
    OR validation_status = ''
    OR is_live IS NULL
    OR last_seen_txns_h24 IS NULL;

UPDATE public.memecoin_assets AS a
SET
    pair_address = COALESCE(a.pair_address, s.pair_address),
    last_seen_liquidity_usd = COALESCE(a.last_seen_liquidity_usd, s.liquidity_usd),
    last_seen_volume_h24 = COALESCE(a.last_seen_volume_h24, s.volume_h24_usd),
    last_seen_txns_h24 = COALESCE(a.last_seen_txns_h24, s.txns_h24)
FROM (
    SELECT DISTINCT ON (asset_id)
        asset_id,
        pair_address,
        liquidity_usd,
        volume_h24_usd,
        txns_h24
    FROM public.memecoin_market_snapshots
    ORDER BY asset_id, recorded_at DESC, snapshot_id DESC
) AS s
WHERE a.asset_id = s.asset_id
  AND (
      a.pair_address IS NULL
      OR a.last_seen_liquidity_usd IS NULL
      OR a.last_seen_volume_h24 IS NULL
      OR a.last_seen_txns_h24 IS NULL
  );

CREATE INDEX IF NOT EXISTS idx_memecoin_assets_live_status
    ON public.memecoin_assets (is_live, last_validated_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memecoin_assets_validation_status
    ON public.memecoin_assets (validation_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memecoin_assets_pair_address
    ON public.memecoin_assets (chain_id, pair_address);
