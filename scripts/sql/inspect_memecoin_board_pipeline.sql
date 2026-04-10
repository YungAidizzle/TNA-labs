SELECT
  column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'memecoin_assets'
ORDER BY ordinal_position;

SELECT
  run_id,
  status,
  completed_at,
  published_result_count,
  eligible_token_count,
  notes_json -> 'funnel_counts' AS funnel_counts,
  notes_json -> 'reject_counts' AS reject_counts,
  notes_json -> 'db_write_counts' AS db_write_counts,
  notes_json -> 'live_validation_thresholds' AS live_validation_thresholds
FROM public.memecoin_correlation_runs
ORDER BY completed_at DESC NULLS LAST, run_id DESC
LIMIT 10;

SELECT
  COUNT(*) AS total_assets,
  COUNT(*) FILTER (WHERE pair_address IS NULL OR pair_address = '') AS missing_pair_address,
  COUNT(*) FILTER (WHERE dexscreener_url IS NULL OR dexscreener_url = '') AS missing_dexscreener_url,
  COUNT(*) FILTER (WHERE validation_status = 'live') AS live_status_assets,
  COUNT(*) FILTER (WHERE validation_status = 'invalid') AS invalid_status_assets,
  COUNT(*) FILTER (WHERE last_validated_at IS NULL) AS missing_last_validated_at
FROM public.memecoin_assets;

SELECT
  COALESCE(validation_status, '<null>') AS validation_status,
  COALESCE(validation_reason, '<null>') AS validation_reason,
  COUNT(*) AS asset_count
FROM public.memecoin_assets
GROUP BY 1, 2
ORDER BY asset_count DESC, validation_status ASC, validation_reason ASC
LIMIT 25;

WITH recent_runs AS (
  SELECT run_id, completed_at
  FROM public.memecoin_correlation_runs
  WHERE status = 'succeeded'
    AND published_result_count > 0
  ORDER BY completed_at DESC, run_id DESC
  LIMIT 4
)
SELECT
  r.run_id,
  run.completed_at,
  a.asset_id,
  a.chain_id,
  a.token_address,
  a.pair_address AS asset_pair_address,
  s.pair_address AS snapshot_pair_address,
  COALESCE(r.dexscreener_url, s.pair_url, a.dexscreener_url) AS resolved_dexscreener_url,
  a.symbol,
  a.name,
  a.is_live,
  a.validation_status,
  a.validation_reason,
  a.last_validated_at,
  a.last_seen_liquidity_usd,
  a.last_seen_volume_h24,
  a.last_seen_txns_h24,
  s.liquidity_usd,
  s.volume_h24_usd,
  s.txns_h24
FROM public.memecoin_correlation_results r
JOIN recent_runs run
  ON run.run_id = r.run_id
JOIN public.memecoin_assets a
  ON a.asset_id = r.asset_id
LEFT JOIN public.memecoin_market_snapshots s
  ON s.snapshot_id = r.market_snapshot_id
ORDER BY run.completed_at DESC, r.rank ASC, r.result_id DESC
LIMIT 50;

WITH recent_runs AS (
  SELECT run_id
  FROM public.memecoin_correlation_runs
  WHERE status = 'succeeded'
    AND published_result_count > 0
  ORDER BY completed_at DESC, run_id DESC
  LIMIT 4
)
SELECT
  COUNT(*) AS rows_returned_by_query,
  COUNT(*) FILTER (
    WHERE COALESCE(r.dexscreener_url, s.pair_url, a.dexscreener_url) IS NOT NULL
      AND COALESCE(s.pair_address, a.pair_address) IS NOT NULL
      AND a.symbol IS NOT NULL
      AND a.name IS NOT NULL
  ) AS rows_with_required_fields,
  COUNT(*) FILTER (WHERE COALESCE(a.validation_status, 'pending') <> 'invalid') AS rows_after_status_filter
FROM public.memecoin_correlation_results r
JOIN public.memecoin_assets a
  ON a.asset_id = r.asset_id
LEFT JOIN public.memecoin_market_snapshots s
  ON s.snapshot_id = r.market_snapshot_id
WHERE r.run_id = ANY(ARRAY(SELECT run_id FROM recent_runs));
