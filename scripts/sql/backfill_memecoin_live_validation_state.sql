ALTER TABLE public.memecoin_assets
  ADD COLUMN IF NOT EXISTS pair_address TEXT,
  ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS validation_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_liquidity_usd DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_seen_volume_h24 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_seen_txns_h24 INTEGER;

WITH latest_snapshots AS (
  SELECT DISTINCT ON (s.asset_id)
    s.asset_id,
    s.pair_address,
    s.liquidity_usd,
    s.volume_h24_usd,
    s.txns_h24,
    run.completed_at AS snapshot_completed_at
  FROM public.memecoin_market_snapshots s
  JOIN public.memecoin_correlation_runs run
    ON run.run_id = s.run_id
  ORDER BY s.asset_id, run.completed_at DESC NULLS LAST, s.snapshot_id DESC
)
UPDATE public.memecoin_assets AS a
SET pair_address = COALESCE(a.pair_address, latest_snapshots.pair_address),
    last_seen_liquidity_usd = COALESCE(a.last_seen_liquidity_usd, latest_snapshots.liquidity_usd),
    last_seen_volume_h24 = COALESCE(a.last_seen_volume_h24, latest_snapshots.volume_h24_usd),
    last_seen_txns_h24 = COALESCE(a.last_seen_txns_h24, latest_snapshots.txns_h24),
    last_validated_at = COALESCE(a.last_validated_at, a.updated_at, latest_snapshots.snapshot_completed_at),
    validation_status = COALESCE(NULLIF(a.validation_status, ''), 'pending'),
    is_live = COALESCE(a.is_live, FALSE)
FROM latest_snapshots
WHERE latest_snapshots.asset_id = a.asset_id;
