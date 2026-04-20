# Bluesky Persistent Worker

This worker runs independently from the frontend and continuously ingests Bluesky firehose events into Supabase Postgres.

## What It Does

- Reuses `backend.bluesky_firehose.sync_bluesky_firehose` for Jetstream ingestion and normalization.
- Runs one internal two-stage pipeline inside the same worker service:
  - `ingestRawPost(...)`: persist validated/normalized records into `raw_posts`.
  - `processRawPost(...)`: derive reusable text features/tags/topics/sentiment and persist into `processed_posts`.
- Writes normalized posts into `raw_posts` first, then writes derived rows into `processed_posts` with `raw_post_id`, then fans out multi-topic mentions into `post_topics`.
- Upserts author records into `authors`.
- Tracks worker lifecycle in `ingestion_runs` (one row per process lifecycle).
- Resumes from the last cursor stored in `ingestion_runs.notes`.

## Required Env Vars

- `DATABASE_URL` (Supabase Postgres connection string)
- `OPENAI_API_KEY` when `BLUESKY_TREND_TITLE_ENABLED=true` or `BLUESKY_TREND_ENRICHMENT_ENABLED=true`

The title worker is enabled by default, so a normal production `backend.main` deployment needs `OPENAI_API_KEY`.

## Optional Worker Env Vars

- `BLUESKY_WORKER_SOURCE` (default: `bluesky_firehose_worker`)
- `BLUESKY_DB_BATCH_SIZE` (default: `200`)
- `BLUESKY_WORKER_FIREHOSE_MAX_SECONDS_PER_CYCLE` (default: `8`)
- `BLUESKY_WORKER_FIREHOSE_MAX_EVENTS_PER_CYCLE` (default: `12000`)
- `BLUESKY_WORKER_LOOP_SLEEP_SECONDS` (default: `2`)
- `BLUESKY_WORKER_RETRY_SECONDS` (default: `5`)
- `BLUESKY_TOPIC_AGGREGATE_INTERVAL_SECONDS` (default: `20`; set `0` to disable periodic stable topic read-model refresh)
- `BLUESKY_TOPIC_FACT_SYNC_LOOKBACK_HOURS` (default: `72`; max lookback window used to upsert `post_topic_mentions`)
- `BLUESKY_TOPIC_READ_MODEL_LAG_MINUTES` (default: `3`; finalized-bucket lag for stable read models)
- `BLUESKY_TOPIC_READ_MODEL_RECOMPUTE_HOURS` (default: `48`; recompute horizon for finalized minute buckets)
- `BLUESKY_TOPIC_READ_MODEL_SERIES_MAX_TOPICS` (default: `300`; caps chart-series fanout per day)
- `BLUESKY_TOPIC_READ_MODEL_SERIES_MIN_MENTIONS` (default: `2`; min day mentions required for series table inclusion)
- `BLUESKY_WORKER_PROGRESS_UPDATE_SECONDS` (default: `15`)
- `BLUESKY_RAW_RETENTION_HOURS` (default: `30`; values below `30` are clamped to preserve rolling 24h trend history)
- `BLUESKY_RAW_CLEANUP_INTERVAL_SECONDS` (default: `60`)
- `BLUESKY_WORKER_LOG_LEVEL` (default: `INFO`)
- `BLUESKY_TREND_TITLE_ENABLED` (default: `true`; disable only if you intentionally do not want AI-generated topic names)
- `BLUESKY_TREND_ENRICHMENT_ENABLED` (default: `false`; expensive richer summaries/research path)

The existing firehose env vars from `backend/bluesky_config.py` also apply.

## Local Run

```bash
python -m pip install -r backend/requirements.txt
python -m backend.main
```

One-cycle run:

```bash
python -m backend.main --once
```

DB/schema verification only:

```bash
python -m backend.main --verify-db-only
```

Time-bucket aggregation runs:

```bash
python -m backend.main --aggregate-1m
python -m backend.main --aggregate-1h
```

## Railway Deploy

Use `backend/Dockerfile` for the worker service.

This Python worker is not the authoritative AI-native narrative generator. The AI-native hourly trend pipeline now runs from the Node/Railway worker documented in `docs/ai-native-railway-worker.md`, which calls `runAiNativeNarrativePipeline()` directly instead of going through `/api/cron/ai-native-narratives`.

Suggested Railway service settings:

- Build context: repo root
- Dockerfile path: `backend/Dockerfile`
- Start command override: not required (Dockerfile `CMD` already starts worker)
- Required env var: `DATABASE_URL`
- Required env var in normal title-writer mode: `OPENAI_API_KEY`

`backend/Dockerfile` only copies `backend/` into the worker image. Repo-root `.env.local` is not present inside the deployed container, so Railway service env vars must include any required OpenAI credentials explicitly.

The worker is frontend-independent and can run continuously as a dedicated background service.

## Processed Layer Shape

`processed_posts` is now a generic derived layer designed for future niche filters without changing ingestion:

- `raw_post_id` (FK to `raw_posts.id`)
- core identifiers: `platform`, `source_post_id`
- text/features: `clean_text`, `language`, `tokens`, `hashtags`, `mentions`, `urls`, `domains`
- multi-topic fields: `topic_entities`, `topic_key_candidate`, `tags`
- sentiment fields: `sentiment_label`, `sentiment_positive_score`, `sentiment_negative_score`, `sentiment_neutral_score`
- timing fields: `source_created_at`, `processed_at`, `bucket_minute`

`post_topics` stores one row per `(post, topic)` mention to support multi-topic trend aggregation.
