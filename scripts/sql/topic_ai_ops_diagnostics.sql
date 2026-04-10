-- Topic AI diagnostics pack.
-- Paste individual queries into your SQL console as needed.

-- Active writers in the last 24 hours
SELECT
  COALESCE(NULLIF(BTRIM(writer_identity), ''), 'unknown') AS writer_identity,
  COALESCE(authoritative_writer, false) AS authoritative_writer,
  COUNT(*) AS run_count,
  MAX(generated_at) AS latest_write_at,
  SUM(COALESCE(usage_total_tokens, 0)) AS usage_total_tokens
FROM public.topic_ai_enrichment_runs
WHERE generated_at >= NOW() - INTERVAL '24 hours'
GROUP BY 1, 2
ORDER BY latest_write_at DESC, run_count DESC;

-- Active writers in the last 7 days
SELECT
  COALESCE(NULLIF(BTRIM(writer_identity), ''), 'unknown') AS writer_identity,
  COALESCE(authoritative_writer, false) AS authoritative_writer,
  COUNT(*) AS run_count,
  MAX(generated_at) AS latest_write_at,
  SUM(COALESCE(usage_total_tokens, 0)) AS usage_total_tokens
FROM public.topic_ai_enrichment_runs
WHERE generated_at >= NOW() - INTERVAL '7 days'
GROUP BY 1, 2
ORDER BY latest_write_at DESC, run_count DESC;

-- Unknown writer rows in the last 24 hours
SELECT
  id,
  topic_key,
  generated_at,
  model_name,
  prompt_version,
  refresh_reason,
  usage_total_tokens,
  metadata_json
FROM public.topic_ai_enrichment_runs
WHERE generated_at >= NOW() - INTERVAL '24 hours'
  AND COALESCE(NULLIF(BTRIM(writer_identity), ''), 'unknown') = 'unknown'
ORDER BY generated_at DESC
LIMIT 200;

-- Writes by model and prompt version in the last 7 days
SELECT
  model_name,
  prompt_version,
  COALESCE(NULLIF(BTRIM(writer_identity), ''), 'unknown') AS writer_identity,
  COUNT(*) AS run_count,
  SUM(COALESCE(usage_prompt_tokens, 0)) AS prompt_tokens,
  SUM(COALESCE(usage_completion_tokens, 0)) AS completion_tokens,
  SUM(COALESCE(usage_total_tokens, 0)) AS total_tokens
FROM public.topic_ai_enrichment_runs
WHERE generated_at >= NOW() - INTERVAL '7 days'
GROUP BY 1, 2, 3
ORDER BY total_tokens DESC, run_count DESC;

-- Refresh reasons in the last 24 hours
SELECT
  COALESCE(NULLIF(BTRIM(refresh_reason), ''), 'unknown') AS refresh_reason,
  COUNT(*) AS run_count,
  SUM(COALESCE(usage_total_tokens, 0)) AS total_tokens
FROM public.topic_ai_enrichment_runs
WHERE generated_at >= NOW() - INTERVAL '24 hours'
GROUP BY 1
ORDER BY run_count DESC, total_tokens DESC;

-- Topics with repeated title/enrichment runs in the last 24 hours
SELECT
  topic_key,
  COUNT(*) AS run_count,
  MAX(generated_at) AS latest_write_at,
  SUM(COALESCE(usage_total_tokens, 0)) AS total_tokens
FROM public.topic_ai_enrichment_runs
WHERE generated_at >= NOW() - INTERVAL '24 hours'
GROUP BY 1
HAVING COUNT(*) >= 3
ORDER BY run_count DESC, total_tokens DESC, topic_key ASC
LIMIT 100;

-- Duplicate exact run fingerprints that should be rare after hardening
SELECT
  topic_key,
  as_of_window_end,
  writer_identity,
  prompt_version,
  model_name,
  input_hash,
  COALESCE(refresh_reason, '') AS refresh_reason,
  COUNT(*) AS duplicate_count
FROM public.topic_ai_enrichment_runs
GROUP BY 1, 2, 3, 4, 5, 6, 7
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, topic_key ASC, as_of_window_end DESC;

-- Authoritative vs non-authoritative run counts in the last 24 hours
SELECT
  COALESCE(authoritative_writer, false) AS authoritative_writer,
  COUNT(*) AS run_count,
  SUM(COALESCE(usage_total_tokens, 0)) AS total_tokens
FROM public.topic_ai_enrichment_runs
WHERE generated_at >= NOW() - INTERVAL '24 hours'
GROUP BY 1
ORDER BY 1 DESC;

-- Daily token usage by writer
SELECT
  DATE_TRUNC('day', generated_at) AS day_utc,
  COALESCE(NULLIF(BTRIM(writer_identity), ''), 'unknown') AS writer_identity,
  SUM(COALESCE(usage_prompt_tokens, 0)) AS prompt_tokens,
  SUM(COALESCE(usage_completion_tokens, 0)) AS completion_tokens,
  SUM(COALESCE(usage_total_tokens, 0)) AS total_tokens
FROM public.topic_ai_enrichment_runs
WHERE generated_at >= NOW() - INTERVAL '30 days'
GROUP BY 1, 2
ORDER BY day_utc DESC, total_tokens DESC;

-- Daily token usage by model and prompt
SELECT
  DATE_TRUNC('day', generated_at) AS day_utc,
  model_name,
  prompt_version,
  SUM(COALESCE(usage_total_tokens, 0)) AS total_tokens,
  COUNT(*) AS run_count
FROM public.topic_ai_enrichment_runs
WHERE generated_at >= NOW() - INTERVAL '30 days'
GROUP BY 1, 2, 3
ORDER BY day_utc DESC, total_tokens DESC;

-- Daily token usage by refresh reason
SELECT
  DATE_TRUNC('day', generated_at) AS day_utc,
  COALESCE(NULLIF(BTRIM(refresh_reason), ''), 'unknown') AS refresh_reason,
  SUM(COALESCE(usage_total_tokens, 0)) AS total_tokens,
  COUNT(*) AS run_count
FROM public.topic_ai_enrichment_runs
WHERE generated_at >= NOW() - INTERVAL '30 days'
GROUP BY 1, 2
ORDER BY day_utc DESC, total_tokens DESC;

-- Top 100 most expensive topics over the last 30 days
SELECT
  topic_key,
  COUNT(*) AS run_count,
  SUM(COALESCE(usage_total_tokens, 0)) AS total_tokens,
  MAX(generated_at) AS latest_write_at
FROM public.topic_ai_enrichment_runs
WHERE generated_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY total_tokens DESC, run_count DESC
LIMIT 100;

-- Title/enrichment writes per hour over the last 48 hours
SELECT
  DATE_TRUNC('hour', generated_at) AS hour_utc,
  COUNT(*) AS run_count,
  SUM(COALESCE(usage_total_tokens, 0)) AS total_tokens
FROM public.topic_ai_enrichment_runs
WHERE generated_at >= NOW() - INTERVAL '48 hours'
GROUP BY 1
ORDER BY hour_utc DESC;

-- Current latest authoritative title per topic
SELECT DISTINCT ON (topic_key)
  topic_key,
  canonical_name,
  fallback_label,
  name_status,
  name_source,
  writer_identity,
  prompt_version,
  model_name,
  refreshed_at
FROM public.topic_ai_enrichments
WHERE COALESCE(NULLIF(BTRIM(name_status), ''), '') = 'ready'
  AND COALESCE(NULLIF(BTRIM(name_source), ''), '') IN ('ai_exact', 'historical_exact', 'historical_alias')
  AND NULLIF(BTRIM(canonical_name), '') IS NOT NULL
ORDER BY topic_key, refreshed_at DESC, generated_at DESC, id DESC;

-- Latest row per topic, including non-authoritative rows, for pollution inspection
SELECT DISTINCT ON (topic_key)
  topic_key,
  canonical_name,
  fallback_label,
  name_status,
  name_source,
  writer_identity,
  authoritative_writer,
  prompt_version,
  model_name,
  refresh_reason,
  refreshed_at
FROM public.topic_ai_enrichments
ORDER BY topic_key, refreshed_at DESC, generated_at DESC, id DESC;

-- Current writer heartbeats
SELECT
  writer_identity,
  deployment_id,
  instance_id,
  writer_role,
  authoritative_writer,
  status,
  model_name,
  prompt_version,
  code_version,
  last_reason,
  last_seen_at,
  last_started_at,
  last_completed_at,
  last_write_at
FROM public.topic_ai_writer_heartbeats
ORDER BY last_seen_at DESC, writer_identity ASC;

-- Writers producing recent runs without a matching fresh heartbeat
WITH recent_writes AS (
  SELECT
    COALESCE(NULLIF(BTRIM(writer_identity), ''), 'unknown') AS writer_identity,
    MAX(generated_at) AS latest_write_at,
    COUNT(*) AS run_count
  FROM public.topic_ai_enrichment_runs
  WHERE generated_at >= NOW() - INTERVAL '24 hours'
  GROUP BY 1
),
recent_heartbeats AS (
  SELECT
    writer_identity,
    MAX(last_seen_at) AS latest_heartbeat_at
  FROM public.topic_ai_writer_heartbeats
  WHERE last_seen_at >= NOW() - INTERVAL '24 hours'
  GROUP BY 1
)
SELECT
  w.writer_identity,
  w.latest_write_at,
  w.run_count,
  h.latest_heartbeat_at
FROM recent_writes w
LEFT JOIN recent_heartbeats h
  ON h.writer_identity = w.writer_identity
WHERE h.latest_heartbeat_at IS NULL
   OR h.latest_heartbeat_at < w.latest_write_at - INTERVAL '15 minutes'
ORDER BY w.latest_write_at DESC, w.run_count DESC;
