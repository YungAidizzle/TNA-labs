-- Stable topic read model migration
-- Purpose:
-- 1) Store immutable topic mention facts
-- 2) Finalize minute buckets (no active-window destructive read model)
-- 3) Precompute day totals and 5m day series for deterministic frontend reads
--
-- Safe to run multiple times.

BEGIN;

-- 1) Canonical topic dimension
CREATE TABLE IF NOT EXISTS public.topics (
    topic_key TEXT PRIMARY KEY,
    canonical_label TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT 'keyword',
    aliases TEXT[] NOT NULL DEFAULT '{}'::text[],
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topics_is_active
    ON public.topics (is_active);

-- 2) Immutable fact table: one post-topic mention event
CREATE TABLE IF NOT EXISTS public.post_topic_mentions (
    mention_id BIGSERIAL PRIMARY KEY,
    raw_post_id BIGINT NOT NULL,
    processed_post_id BIGINT,
    platform TEXT NOT NULL DEFAULT 'bluesky',
    topic_key TEXT NOT NULL,
    topic_label TEXT NOT NULL,
    event_timestamp TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    author_id TEXT,
    sentiment_label TEXT NOT NULL DEFAULT 'neutral',
    quality_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_repost BOOLEAN NOT NULL DEFAULT false,
    is_reply BOOLEAN NOT NULL DEFAULT false,
    has_link BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_post_topic_mentions_raw_platform_topic
    ON public.post_topic_mentions (raw_post_id, platform, topic_key);

CREATE INDEX IF NOT EXISTS idx_post_topic_mentions_event_ts
    ON public.post_topic_mentions (event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_post_topic_mentions_topic_event
    ON public.post_topic_mentions (topic_key, event_timestamp DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'post_topic_mentions_topic_key_fkey'
          AND conrelid = 'public.post_topic_mentions'::regclass
    ) THEN
        ALTER TABLE public.post_topic_mentions
        ADD CONSTRAINT post_topic_mentions_topic_key_fkey
        FOREIGN KEY (topic_key)
        REFERENCES public.topics(topic_key)
        ON UPDATE CASCADE
        ON DELETE RESTRICT;
    END IF;
END;
$$;

DO $$
BEGIN
    IF to_regclass('public.raw_posts') IS NOT NULL
       AND NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'post_topic_mentions_raw_post_id_fkey'
              AND conrelid = 'public.post_topic_mentions'::regclass
       ) THEN
        ALTER TABLE public.post_topic_mentions
        ADD CONSTRAINT post_topic_mentions_raw_post_id_fkey
        FOREIGN KEY (raw_post_id)
        REFERENCES public.raw_posts(id)
        ON DELETE CASCADE;
    END IF;
END;
$$;

DO $$
BEGIN
    IF to_regclass('public.processed_posts') IS NOT NULL
       AND NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'post_topic_mentions_processed_post_id_fkey'
              AND conrelid = 'public.post_topic_mentions'::regclass
       ) THEN
        ALTER TABLE public.post_topic_mentions
        ADD CONSTRAINT post_topic_mentions_processed_post_id_fkey
        FOREIGN KEY (processed_post_id)
        REFERENCES public.processed_posts(id)
        ON DELETE SET NULL;
    END IF;
END;
$$;

-- 3) Finalized minute buckets
CREATE TABLE IF NOT EXISTS public.topic_buckets_1m_final (
    bucket_minute TIMESTAMPTZ NOT NULL,
    platform TEXT NOT NULL,
    topic_key TEXT NOT NULL,
    mention_count INTEGER NOT NULL,
    unique_posts INTEGER NOT NULL,
    unique_authors INTEGER NOT NULL,
    positive_count INTEGER NOT NULL DEFAULT 0,
    neutral_count INTEGER NOT NULL DEFAULT 0,
    negative_count INTEGER NOT NULL DEFAULT 0,
    finalized_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (bucket_minute, platform, topic_key)
);

CREATE INDEX IF NOT EXISTS idx_topic_buckets_1m_final_topic_bucket
    ON public.topic_buckets_1m_final (topic_key, bucket_minute DESC);

CREATE INDEX IF NOT EXISTS idx_topic_buckets_1m_final_platform_bucket
    ON public.topic_buckets_1m_final (platform, bucket_minute DESC);

-- 4) Day totals (ranked leaderboard source)
CREATE TABLE IF NOT EXISTS public.topic_day_totals (
    day DATE NOT NULL,
    topic_key TEXT NOT NULL,
    topic_label TEXT NOT NULL,
    platform_count INTEGER NOT NULL,
    total_mentions INTEGER NOT NULL,
    unique_posts INTEGER NOT NULL,
    unique_authors INTEGER NOT NULL,
    positive_count INTEGER NOT NULL DEFAULT 0,
    neutral_count INTEGER NOT NULL DEFAULT 0,
    negative_count INTEGER NOT NULL DEFAULT 0,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (day, topic_key)
);

CREATE INDEX IF NOT EXISTS idx_topic_day_totals_day_mentions
    ON public.topic_day_totals (day, total_mentions DESC);

-- 5) Day 5m series (chart source)
CREATE TABLE IF NOT EXISTS public.topic_day_series_5m (
    day DATE NOT NULL,
    bucket_5m TIMESTAMPTZ NOT NULL,
    topic_key TEXT NOT NULL,
    topic_label TEXT NOT NULL,
    interactions INTEGER NOT NULL,
    cumulative_interactions INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (day, bucket_5m, topic_key)
);

CREATE INDEX IF NOT EXISTS idx_topic_day_series_5m_day_topic_bucket
    ON public.topic_day_series_5m (day, topic_key, bucket_5m);

-- 6) Backfill topic dimension from existing extracted topics
DO $$
BEGIN
    IF to_regclass('public.post_topics') IS NOT NULL THEN
        INSERT INTO public.topics (topic_key, canonical_label)
        SELECT DISTINCT
            normalized_topic AS topic_key,
            CASE
                WHEN normalized_topic = 'no kings' THEN 'No Kings'
                ELSE INITCAP(normalized_topic)
            END AS canonical_label
        FROM (
            SELECT
                LOWER(
                    BTRIM(
                        REGEXP_REPLACE(
                            REGEXP_REPLACE(COALESCE(pt.normalized_topic, pt.topic_text, ''), '[^a-zA-Z0-9$#\s]+', ' ', 'g'),
                            '\s+',
                            ' ',
                            'g'
                        )
                    )
                ) AS normalized_topic
            FROM public.post_topics pt
        ) src
        WHERE normalized_topic <> ''
        ON CONFLICT (topic_key) DO UPDATE
        SET canonical_label = EXCLUDED.canonical_label,
            updated_at = now();
    END IF;
END;
$$;

-- 7) Backfill immutable mention facts from existing post_topics + processed_posts
DO $$
BEGIN
    IF to_regclass('public.post_topics') IS NOT NULL AND to_regclass('public.processed_posts') IS NOT NULL THEN
        INSERT INTO public.post_topic_mentions (
            raw_post_id,
            processed_post_id,
            platform,
            topic_key,
            topic_label,
            event_timestamp,
            ingested_at,
            author_id,
            sentiment_label,
            quality_score,
            is_repost,
            is_reply,
            has_link
        )
        SELECT DISTINCT ON (pt.raw_post_id, COALESCE(NULLIF(pt.platform, ''), 'bluesky'), normalized_topic)
            pt.raw_post_id,
            pt.processed_post_id,
            COALESCE(NULLIF(pt.platform, ''), 'bluesky') AS platform,
            normalized_topic AS topic_key,
            COALESCE(
                t.canonical_label,
                NULLIF(TRIM(pt.topic_text), ''),
                CASE
                    WHEN normalized_topic = 'no kings' THEN 'No Kings'
                    ELSE INITCAP(normalized_topic)
                END
            ) AS topic_label,
            COALESCE(
                pt.source_created_at,
                pt.bucket_minute,
                pp.source_created_at,
                pp.created_at,
                pp.processed_at,
                now()
            ) AS event_timestamp,
            COALESCE(pp.processed_at, now()) AS ingested_at,
            NULLIF(pp.author_id, '') AS author_id,
            CASE
                WHEN COALESCE(pp.sentiment_label, '') IN ('positive', 'negative', 'neutral')
                    THEN pp.sentiment_label
                ELSE 'neutral'
            END AS sentiment_label,
            COALESCE(pp.quality_score, 0)::double precision AS quality_score,
            COALESCE(pp.is_repost, false) AS is_repost,
            COALESCE(pp.is_reply, false) AS is_reply,
            (COALESCE(array_length(pp.urls, 1), 0) > 0) AS has_link
        FROM (
            SELECT
                pt.*,
                LOWER(
                    BTRIM(
                        REGEXP_REPLACE(
                            REGEXP_REPLACE(COALESCE(pt.normalized_topic, pt.topic_text, ''), '[^a-zA-Z0-9$#\s]+', ' ', 'g'),
                            '\s+',
                            ' ',
                            'g'
                        )
                    )
                ) AS normalized_topic
            FROM public.post_topics pt
        ) pt
        LEFT JOIN public.processed_posts pp
            ON pp.id = pt.processed_post_id
        LEFT JOIN public.topics t
            ON t.topic_key = pt.normalized_topic
        WHERE pt.normalized_topic <> ''
        ORDER BY pt.raw_post_id, COALESCE(NULLIF(pt.platform, ''), 'bluesky'), pt.normalized_topic
        ON CONFLICT (raw_post_id, platform, topic_key) DO NOTHING;
    END IF;
END;
$$;

-- 8) Refresh finalized 1m buckets (only finalized buckets older than lag)
CREATE OR REPLACE FUNCTION public.refresh_topic_buckets_1m_final(
    p_lag_minutes INTEGER DEFAULT 3,
    p_recompute_hours INTEGER DEFAULT 48
)
RETURNS BIGINT
LANGUAGE sql
AS $$
WITH bounds AS (
    SELECT
        date_trunc('minute', now() - make_interval(mins => GREATEST(1, p_lag_minutes))) AS finalize_before,
        date_trunc('minute', now() - make_interval(hours => GREATEST(1, p_recompute_hours))) AS recompute_from
),
deleted AS (
    DELETE FROM public.topic_buckets_1m_final t
    USING bounds b
    WHERE t.bucket_minute >= b.recompute_from
      AND t.bucket_minute < b.finalize_before
    RETURNING 1
),
aggregated AS (
    SELECT
        date_trunc('minute', m.event_timestamp) AS bucket_minute,
        m.platform,
        m.topic_key,
        COUNT(*)::int AS mention_count,
        COUNT(DISTINCT m.raw_post_id)::int AS unique_posts,
        COUNT(DISTINCT NULLIF(m.author_id, ''))::int AS unique_authors,
        SUM(CASE WHEN m.sentiment_label = 'positive' THEN 1 ELSE 0 END)::int AS positive_count,
        SUM(CASE WHEN m.sentiment_label = 'neutral' THEN 1 ELSE 0 END)::int AS neutral_count,
        SUM(CASE WHEN m.sentiment_label = 'negative' THEN 1 ELSE 0 END)::int AS negative_count
    FROM public.post_topic_mentions m
    JOIN bounds b
      ON date_trunc('minute', m.event_timestamp) >= b.recompute_from
     AND date_trunc('minute', m.event_timestamp) < b.finalize_before
    GROUP BY 1, 2, 3
),
upserted AS (
    INSERT INTO public.topic_buckets_1m_final (
        bucket_minute,
        platform,
        topic_key,
        mention_count,
        unique_posts,
        unique_authors,
        positive_count,
        neutral_count,
        negative_count,
        finalized_at
    )
    SELECT
        bucket_minute,
        platform,
        topic_key,
        mention_count,
        unique_posts,
        unique_authors,
        positive_count,
        neutral_count,
        negative_count,
        now()
    FROM aggregated
    ON CONFLICT (bucket_minute, platform, topic_key) DO UPDATE
    SET mention_count = EXCLUDED.mention_count,
        unique_posts = EXCLUDED.unique_posts,
        unique_authors = EXCLUDED.unique_authors,
        positive_count = EXCLUDED.positive_count,
        neutral_count = EXCLUDED.neutral_count,
        negative_count = EXCLUDED.negative_count,
        finalized_at = EXCLUDED.finalized_at
    RETURNING 1
)
SELECT COUNT(*)::bigint
FROM upserted;
$$;

-- 9) Refresh day totals (UTC day)
CREATE OR REPLACE FUNCTION public.refresh_topic_day_totals(
    p_day DATE DEFAULT (now() AT TIME ZONE 'utc')::date
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_count BIGINT;
BEGIN
    DELETE FROM public.topic_day_totals
    WHERE day = p_day;

    INSERT INTO public.topic_day_totals (
        day,
        topic_key,
        topic_label,
        platform_count,
        total_mentions,
        unique_posts,
        unique_authors,
        positive_count,
        neutral_count,
        negative_count,
        first_seen_at,
        last_seen_at,
        updated_at
    )
    SELECT
        p_day AS day,
        b.topic_key,
        COALESCE(t.canonical_label, INITCAP(b.topic_key)) AS topic_label,
        COUNT(DISTINCT b.platform)::int AS platform_count,
        SUM(b.mention_count)::int AS total_mentions,
        SUM(b.unique_posts)::int AS unique_posts,
        SUM(b.unique_authors)::int AS unique_authors,
        SUM(b.positive_count)::int AS positive_count,
        SUM(b.neutral_count)::int AS neutral_count,
        SUM(b.negative_count)::int AS negative_count,
        MIN(b.bucket_minute) AS first_seen_at,
        MAX(b.bucket_minute) AS last_seen_at,
        now() AS updated_at
    FROM public.topic_buckets_1m_final b
    LEFT JOIN public.topics t
      ON t.topic_key = b.topic_key
    WHERE (b.bucket_minute AT TIME ZONE 'utc')::date = p_day
    GROUP BY b.topic_key, COALESCE(t.canonical_label, INITCAP(b.topic_key));

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- 10) Refresh day 5m zero-filled series (UTC day)
CREATE OR REPLACE FUNCTION public.refresh_topic_day_series_5m(
    p_day DATE DEFAULT (now() AT TIME ZONE 'utc')::date
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_count BIGINT;
BEGIN
    DELETE FROM public.topic_day_series_5m
    WHERE day = p_day;

    WITH day_bounds AS (
        SELECT
            (p_day::text || ' 00:00:00+00')::timestamptz AS day_start,
            ((p_day + 1)::text || ' 00:00:00+00')::timestamptz AS day_end
    ),
    buckets AS (
        SELECT
            generate_series(day_start, day_end - interval '5 minute', interval '5 minute') AS bucket_5m
        FROM day_bounds
    ),
    topics_of_day AS (
        SELECT
            d.topic_key,
            d.topic_label
        FROM public.topic_day_totals d
        WHERE d.day = p_day
    ),
    aggregated AS (
        SELECT
            to_timestamp(floor(extract(epoch FROM b.bucket_minute) / 300) * 300)::timestamptz AS bucket_5m,
            b.topic_key,
            SUM(b.mention_count)::int AS interactions
        FROM public.topic_buckets_1m_final b
        JOIN day_bounds db
          ON b.bucket_minute >= db.day_start
         AND b.bucket_minute < db.day_end
        GROUP BY 1, 2
    ),
    filled AS (
        SELECT
            p_day AS day,
            bk.bucket_5m,
            td.topic_key,
            td.topic_label,
            COALESCE(ag.interactions, 0)::int AS interactions
        FROM topics_of_day td
        CROSS JOIN buckets bk
        LEFT JOIN aggregated ag
          ON ag.topic_key = td.topic_key
         AND ag.bucket_5m = bk.bucket_5m
    )
    INSERT INTO public.topic_day_series_5m (
        day,
        bucket_5m,
        topic_key,
        topic_label,
        interactions,
        cumulative_interactions,
        updated_at
    )
    SELECT
        day,
        bucket_5m,
        topic_key,
        topic_label,
        interactions,
        SUM(interactions) OVER (
            PARTITION BY topic_key
            ORDER BY bucket_5m
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )::int AS cumulative_interactions,
        now() AS updated_at
    FROM filled;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- 11) Orchestrator function for worker/cron usage
CREATE OR REPLACE FUNCTION public.refresh_topic_read_models(
    p_lag_minutes INTEGER DEFAULT 3,
    p_recompute_hours INTEGER DEFAULT 48
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_today DATE := (now() AT TIME ZONE 'utc')::date;
    v_yesterday DATE := ((now() AT TIME ZONE 'utc')::date - 1);
    v_buckets BIGINT;
    v_totals_today BIGINT;
    v_totals_yesterday BIGINT;
    v_series_today BIGINT;
    v_series_yesterday BIGINT;
BEGIN
    v_buckets := public.refresh_topic_buckets_1m_final(p_lag_minutes, p_recompute_hours);
    v_totals_today := public.refresh_topic_day_totals(v_today);
    v_totals_yesterday := public.refresh_topic_day_totals(v_yesterday);
    v_series_today := public.refresh_topic_day_series_5m(v_today);
    v_series_yesterday := public.refresh_topic_day_series_5m(v_yesterday);

    RETURN jsonb_build_object(
        'finalized_bucket_rows', v_buckets,
        'day_totals_today_rows', v_totals_today,
        'day_totals_yesterday_rows', v_totals_yesterday,
        'day_series_today_rows', v_series_today,
        'day_series_yesterday_rows', v_series_yesterday,
        'refreshed_at', now()
    );
END;
$$;

-- 12) Frontend read views expected by src/lib/dashboard/supabase-trends.ts
CREATE OR REPLACE VIEW public.v_topic_leaderboard_day AS
SELECT
    day,
    topic_key,
    topic_label,
    platform_count,
    total_mentions,
    unique_posts,
    unique_authors,
    positive_count,
    neutral_count,
    negative_count,
    first_seen_at,
    last_seen_at,
    updated_at
FROM public.topic_day_totals;

CREATE OR REPLACE VIEW public.v_topic_series_day_5m AS
SELECT
    day,
    bucket_5m,
    topic_key,
    topic_label,
    interactions,
    cumulative_interactions,
    updated_at
FROM public.topic_day_series_5m;

COMMIT;

-- Run after migration/backfill:
-- SELECT public.refresh_topic_read_models(3, 48);
--
-- Suggested schedule:
-- every 20s -> SELECT public.refresh_topic_read_models(3, 48);
