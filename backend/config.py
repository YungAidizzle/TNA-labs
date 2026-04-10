from __future__ import annotations

import os
from dataclasses import dataclass

from backend.env import load_repo_env

load_repo_env()

MIN_RAW_RETENTION_HOURS_FOR_24H_TRENDS = 30.0


def _parse_int_env(name: str, default: int, *, minimum: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError:
        value = default
    return max(minimum, value)


def _parse_float_env(name: str, default: float, *, minimum: float) -> float:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = float(raw)
    except ValueError:
        value = default
    return max(minimum, value)


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    source: str
    batch_size: int
    firehose_window_max_seconds: int
    firehose_window_max_events: int
    backlog_firehose_window_max_seconds: int
    backlog_firehose_window_max_events: int
    loop_sleep_seconds: float
    retry_seconds: float
    topic_aggregate_interval_seconds: float
    topic_aggregate_timeout_seconds: float
    topic_cleanup_interval_seconds: float
    topic_fact_sync_lookback_hours: int
    topic_read_model_lag_minutes: int
    topic_read_model_recompute_hours: int
    topic_read_model_series_max_topics: int
    topic_read_model_series_min_mentions: int
    worker_stale_run_minutes: int
    worker_heartbeat_interval_seconds: float
    worker_heartbeat_stale_seconds: int
    progress_update_seconds: float
    processing_stage_max_seconds: float
    process_max_rows_per_cycle: int
    unprocessed_backlog_threshold: int
    aggregate_skip_after_write_stage_seconds: float
    secondary_stage_failure_backoff_seconds: float
    secondary_stage_failure_threshold: int
    parse_workers: int
    parse_parallel_min_posts: int
    raw_retention_hours: float
    raw_cleanup_interval_seconds: float
    log_level: str

    @classmethod
    def from_env(
        cls,
        *,
        sleep_seconds: float | None = None,
        retry_seconds: float | None = None,
        topic_aggregate_interval_seconds: float | None = None,
        firehose_window_max_seconds: int | None = None,
        firehose_window_max_events: int | None = None,
    ) -> "WorkerConfig":
        database_url = os.getenv("DATABASE_URL", "").strip()
        if not database_url:
            raise ValueError("DATABASE_URL is required")

        source = os.getenv("BLUESKY_WORKER_SOURCE", "bluesky_firehose_worker").strip()
        if not source:
            source = "bluesky_firehose_worker"

        batch_size = _parse_int_env("BLUESKY_DB_BATCH_SIZE", 200, minimum=1)
        configured_firehose_window_max_seconds = _parse_int_env(
            "BLUESKY_WORKER_FIREHOSE_MAX_SECONDS_PER_CYCLE",
            8,
            minimum=1,
        )
        configured_firehose_window_max_events = _parse_int_env(
            "BLUESKY_WORKER_FIREHOSE_MAX_EVENTS_PER_CYCLE",
            12000,
            minimum=1,
        )
        backlog_firehose_window_max_seconds = _parse_int_env(
            "BLUESKY_WORKER_BACKLOG_FIREHOSE_MAX_SECONDS_PER_CYCLE",
            3,
            minimum=1,
        )
        backlog_firehose_window_max_events = _parse_int_env(
            "BLUESKY_WORKER_BACKLOG_FIREHOSE_MAX_EVENTS_PER_CYCLE",
            3000,
            minimum=1,
        )
        configured_sleep_seconds = _parse_float_env(
            "BLUESKY_WORKER_LOOP_SLEEP_SECONDS",
            2.0,
            minimum=0.0,
        )
        configured_retry_seconds = _parse_float_env(
            "BLUESKY_WORKER_RETRY_SECONDS",
            5.0,
            minimum=0.5,
        )
        configured_topic_aggregate_interval_seconds = _parse_float_env(
            "BLUESKY_TOPIC_AGGREGATE_INTERVAL_SECONDS",
            20.0,
            minimum=0.0,
        )
        configured_topic_aggregate_timeout_seconds = _parse_float_env(
            "BLUESKY_TOPIC_AGGREGATE_TIMEOUT_SECONDS",
            20.0,
            minimum=1.0,
        )
        configured_topic_cleanup_interval_seconds = _parse_float_env(
            "BLUESKY_TOPIC_CLEANUP_INTERVAL_SECONDS",
            300.0,
            minimum=20.0,
        )
        topic_fact_sync_lookback_hours = _parse_int_env(
            "BLUESKY_TOPIC_FACT_SYNC_LOOKBACK_HOURS",
            72,
            minimum=1,
        )
        topic_read_model_lag_minutes = _parse_int_env(
            "BLUESKY_TOPIC_READ_MODEL_LAG_MINUTES",
            3,
            minimum=1,
        )
        topic_read_model_recompute_hours = _parse_int_env(
            "BLUESKY_TOPIC_READ_MODEL_RECOMPUTE_HOURS",
            48,
            minimum=1,
        )
        topic_read_model_series_max_topics = _parse_int_env(
            "BLUESKY_TOPIC_READ_MODEL_SERIES_MAX_TOPICS",
            300,
            minimum=25,
        )
        topic_read_model_series_min_mentions = _parse_int_env(
            "BLUESKY_TOPIC_READ_MODEL_SERIES_MIN_MENTIONS",
            2,
            minimum=1,
        )
        worker_stale_run_minutes = _parse_int_env(
            "BLUESKY_WORKER_STALE_RUN_MINUTES",
            30,
            minimum=5,
        )
        worker_heartbeat_interval_seconds = _parse_float_env(
            "BLUESKY_WORKER_HEARTBEAT_INTERVAL_SECONDS",
            5.0,
            minimum=1.0,
        )
        worker_heartbeat_stale_seconds = _parse_int_env(
            "BLUESKY_WORKER_HEARTBEAT_STALE_SECONDS",
            60,
            minimum=15,
        )
        progress_update_seconds = _parse_float_env(
            "BLUESKY_WORKER_PROGRESS_UPDATE_SECONDS",
            5.0,
            minimum=1.0,
        )
        processing_stage_max_seconds = _parse_float_env(
            "BLUESKY_WORKER_PROCESSING_STAGE_MAX_SECONDS",
            20.0,
            minimum=1.0,
        )
        process_max_rows_per_cycle = _parse_int_env(
            "BLUESKY_WORKER_PROCESS_MAX_ROWS_PER_CYCLE",
            max(200, batch_size * 2),
            minimum=1,
        )
        unprocessed_backlog_threshold = _parse_int_env(
            "BLUESKY_WORKER_UNPROCESSED_BACKLOG_THRESHOLD",
            1000,
            minimum=1,
        )
        aggregate_skip_after_write_stage_seconds = _parse_float_env(
            "BLUESKY_WORKER_AGGREGATE_SKIP_AFTER_WRITE_STAGE_SECONDS",
            12.0,
            minimum=1.0,
        )
        secondary_stage_failure_backoff_seconds = _parse_float_env(
            "BLUESKY_WORKER_SECONDARY_STAGE_FAILURE_BACKOFF_SECONDS",
            120.0,
            minimum=5.0,
        )
        secondary_stage_failure_threshold = _parse_int_env(
            "BLUESKY_WORKER_SECONDARY_STAGE_FAILURE_THRESHOLD",
            3,
            minimum=1,
        )
        parse_workers = _parse_int_env(
            "BLUESKY_WORKER_PARSE_WORKERS",
            4,
            minimum=1,
        )
        parse_parallel_min_posts = _parse_int_env(
            "BLUESKY_WORKER_PARSE_PARALLEL_MIN_POSTS",
            150,
            minimum=1,
        )
        raw_retention_hours = _parse_float_env(
            "BLUESKY_RAW_RETENTION_HOURS",
            MIN_RAW_RETENTION_HOURS_FOR_24H_TRENDS,
            minimum=0.0,
        )
        raw_cleanup_interval_seconds = _parse_float_env(
            "BLUESKY_RAW_CLEANUP_INTERVAL_SECONDS",
            60.0,
            minimum=5.0,
        )
        log_level = os.getenv("BLUESKY_WORKER_LOG_LEVEL", "INFO").strip().upper() or "INFO"

        return cls(
            database_url=database_url,
            source=source,
            batch_size=batch_size,
            firehose_window_max_seconds=max(
                1,
                int(
                    firehose_window_max_seconds
                    if firehose_window_max_seconds is not None
                    else configured_firehose_window_max_seconds
                ),
            ),
            firehose_window_max_events=max(
                1,
                int(
                    firehose_window_max_events
                    if firehose_window_max_events is not None
                    else configured_firehose_window_max_events
                ),
            ),
            backlog_firehose_window_max_seconds=max(
                1,
                min(
                    backlog_firehose_window_max_seconds,
                    int(
                        firehose_window_max_seconds
                        if firehose_window_max_seconds is not None
                        else configured_firehose_window_max_seconds
                    ),
                ),
            ),
            backlog_firehose_window_max_events=max(
                1,
                min(
                    backlog_firehose_window_max_events,
                    int(
                        firehose_window_max_events
                        if firehose_window_max_events is not None
                        else configured_firehose_window_max_events
                    ),
                ),
            ),
            loop_sleep_seconds=max(0.0, sleep_seconds if sleep_seconds is not None else configured_sleep_seconds),
            retry_seconds=max(0.5, retry_seconds if retry_seconds is not None else configured_retry_seconds),
            topic_aggregate_interval_seconds=max(
                0.0,
                topic_aggregate_interval_seconds
                if topic_aggregate_interval_seconds is not None
                else configured_topic_aggregate_interval_seconds,
            ),
            topic_aggregate_timeout_seconds=configured_topic_aggregate_timeout_seconds,
            topic_cleanup_interval_seconds=configured_topic_cleanup_interval_seconds,
            topic_fact_sync_lookback_hours=topic_fact_sync_lookback_hours,
            topic_read_model_lag_minutes=topic_read_model_lag_minutes,
            topic_read_model_recompute_hours=topic_read_model_recompute_hours,
            topic_read_model_series_max_topics=topic_read_model_series_max_topics,
            topic_read_model_series_min_mentions=topic_read_model_series_min_mentions,
            worker_stale_run_minutes=worker_stale_run_minutes,
            worker_heartbeat_interval_seconds=worker_heartbeat_interval_seconds,
            worker_heartbeat_stale_seconds=worker_heartbeat_stale_seconds,
            progress_update_seconds=progress_update_seconds,
            processing_stage_max_seconds=processing_stage_max_seconds,
            process_max_rows_per_cycle=process_max_rows_per_cycle,
            unprocessed_backlog_threshold=unprocessed_backlog_threshold,
            aggregate_skip_after_write_stage_seconds=aggregate_skip_after_write_stage_seconds,
            secondary_stage_failure_backoff_seconds=secondary_stage_failure_backoff_seconds,
            secondary_stage_failure_threshold=secondary_stage_failure_threshold,
            parse_workers=parse_workers,
            parse_parallel_min_posts=parse_parallel_min_posts,
            raw_retention_hours=max(
                MIN_RAW_RETENTION_HOURS_FOR_24H_TRENDS,
                raw_retention_hours,
            ),
            raw_cleanup_interval_seconds=raw_cleanup_interval_seconds,
            log_level=log_level,
        )
