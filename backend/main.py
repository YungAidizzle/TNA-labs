from __future__ import annotations

import argparse
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FutureTimeoutError
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from typing import Any, Callable

from backend.collectors.bluesky_worker import (
    analyzeSentiment as analyzePostSentiment,
    extractTopicEntities as extractPostTopicEntities,
    normalizeIncomingEvent,
    normalize_authors_for_authors_table,
    processRawPost as buildProcessedPostFromRaw,
    run_firehose_window,
)
from backend.config import WorkerConfig
from backend.db import PostgresStore, is_lock_timeout_error
from backend.logging_setup import log_event, setup_logging
from backend.memecoin_correlation import (
    build_memecoin_correlation_runtime_config_from_env,
    run_memecoin_correlation_cycle,
)
from backend.trend_enrichment import (
    AUTHORITATIVE_TREND_TITLE_TARGET,
    build_trend_title_generation_runtime_config_from_env,
    build_trend_enrichment_runtime_config_from_env,
    run_trend_title_generation_backfill_job,
    run_trend_enrichment_cycle,
)

TITLE_WRITER_IDENTITY = "backend.main:trend_title_generation"
TITLE_WRITER_ROLE = "authoritative_title_worker"
ENRICHMENT_WRITER_IDENTITY = "backend.main:trend_enrichment"
ENRICHMENT_WRITER_ROLE = "authoritative_enrichment_worker"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_cursor(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return max(0, parsed)


def _parse_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = str(os.getenv(name, "")).strip()
    if not raw:
        return default
    try:
        parsed = int(raw)
    except ValueError:
        return default
    return max(minimum, min(maximum, parsed))


def _parse_float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = str(os.getenv(name, "")).strip()
    if not raw:
        return default
    try:
        parsed = float(raw)
    except ValueError:
        return default
    return max(minimum, min(maximum, parsed))


def _state_summary(state: dict[str, Any] | None) -> dict[str, Any]:
    state = dict(state or {})
    return {
        "status": state.get("status"),
        "healthStatus": state.get("healthStatus"),
        "connectionStatus": state.get("connectionStatus"),
        "lastError": state.get("lastError"),
        "lastEventAt": state.get("lastEventAt"),
        "lastSyncEvents": state.get("lastSyncEvents"),
        "eventsPerMinute": state.get("eventsPerMinute"),
        "reconnectCount": state.get("reconnectCount"),
        "rawPersistSuccessRate": state.get("rawPersistSuccessRate"),
        "normalizationSuccessRate": state.get("normalizationSuccessRate"),
    }


def ingestRawPost(*, store: PostgresStore, normalized_event: dict[str, Any]) -> dict[str, Any] | None:
    return store.ingest_raw_post(normalized_event)


def extractTopicEntities(*, raw_post: dict[str, Any]) -> list[dict[str, str]]:
    return extractPostTopicEntities(raw_post)


def analyzeSentiment(*, raw_post: dict[str, Any]) -> dict[str, Any]:
    clean_text = str(raw_post.get("text_content") or raw_post.get("raw_text") or "").strip()
    language = str(raw_post.get("language") or "").strip() or None
    return analyzePostSentiment(clean_text=clean_text, language=language)


def _to_iso_timestamp(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    return None


def _max_iso_timestamp(*values: Any) -> str | None:
    latest_iso: str | None = None
    latest_value: datetime | None = None
    for candidate in values:
        if not isinstance(candidate, datetime):
            continue
        if latest_value is None or candidate > latest_value:
            latest_value = candidate
            latest_iso = candidate.isoformat()
    return latest_iso


def _parse_iso_datetime(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _pipeline_lag_seconds(last_written_at: str | None) -> int | None:
    timestamp = _parse_iso_datetime(last_written_at)
    if timestamp is None:
        return None
    return max(0, int(round((_utc_now() - timestamp).total_seconds())))


def buildProcessedPostPayload(
    *,
    raw_row: dict[str, Any],
    processed_at: datetime,
) -> dict[str, Any] | None:
    processed_row = buildProcessedPostFromRaw(raw_row, processed_at=processed_at)
    if not isinstance(processed_row, dict):
        return None
    if processed_row.get("raw_post_id") in {None, 0}:
        processed_row["raw_post_id"] = raw_row.get("id")
    if not processed_row.get("source_post_id"):
        processed_row["source_post_id"] = str(
            raw_row.get("source_post_id") or raw_row.get("post_id") or ""
        ).strip()
    return processed_row


def buildPostTopicRows(
    *,
    raw_row: dict[str, Any],
    processed_row: dict[str, Any],
    created_at: datetime,
    topic_entities: list[dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    source_created_at = raw_row.get("created_at") or created_at
    bucket_minute = raw_row.get("created_at") or created_at
    try:
        if isinstance(bucket_minute, datetime):
            bucket_minute = bucket_minute.replace(second=0, microsecond=0)
    except Exception:
        bucket_minute = created_at.replace(second=0, microsecond=0)

    topic_rows: list[dict[str, Any]] = []
    topic_records = list(topic_entities or processed_row.get("topic_records") or [])
    for topic in topic_records:
        normalized_topic = str(topic.get("normalized_topic") or "").strip()
        if not normalized_topic:
            continue
        topic_text = str(topic.get("topic_text") or normalized_topic).strip() or normalized_topic
        topic_rows.append(
            {
                "raw_post_id": raw_row.get("id"),
                "processed_post_id": processed_row.get("id"),
                "platform": str(raw_row.get("platform") or "bluesky"),
                "source_post_id": str(raw_row.get("source_post_id") or raw_row.get("post_id") or "").strip(),
                "topic_text": topic_text,
                "normalized_topic": normalized_topic,
                "topic_type": str(topic.get("topic_type") or "entity"),
                "language": str(raw_row.get("language") or "").strip() or None,
                "source_created_at": source_created_at,
                "bucket_minute": bucket_minute,
                "created_at": created_at,
            }
        )
    return topic_rows


def processRawPost(
    *,
    store: PostgresStore,
    raw_row: dict[str, Any],
    processed_at: datetime,
    topic_entities: list[dict[str, str]] | None = None,
    sentiment: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    processed_row = buildProcessedPostPayload(raw_row=raw_row, processed_at=processed_at)
    if processed_row is None:
        return None
    if topic_entities:
        processed_row["topic_records"] = list(topic_entities)
    if sentiment:
        processed_row.update(dict(sentiment))
    return store.upsert_processed_post_record(processed_row)


def persistPostTopics(
    *,
    store: PostgresStore,
    raw_row: dict[str, Any],
    processed_row: dict[str, Any],
    topic_entities: list[dict[str, str]],
    created_at: datetime,
) -> int:
    topic_rows = buildPostTopicRows(
        raw_row=raw_row,
        processed_row=processed_row,
        topic_entities=topic_entities,
        created_at=created_at,
    )
    if not topic_rows:
        return 0
    return store.persist_post_topics(topic_rows)


def _build_run_notes(
    *,
    cycle: int,
    cursor_us: int | None,
    rows_inserted: int,
    shutdown_reason: str | None,
    state: dict[str, Any] | None,
    stats: dict[str, Any] | None,
    timings: dict[str, Any] | None,
    last_error: str | None,
    last_ingestion_write_at: str | None = None,
    last_aggregate_write_at: str | None = None,
    last_enrichment_write_at: str | None = None,
    enrichment_status: str | None = None,
    enrichment_backlog_size: int | None = None,
    active_stage: str | None = None,
    stage_counts: dict[str, Any] | None = None,
    latest_source_created_at: str | None = None,
    last_heartbeat_at: str | None = None,
    rows_written_this_cycle: int | None = None,
    last_successful_write_at: str | None = None,
    max_source_timestamp_seen: str | None = None,
    max_written_timestamp: str | None = None,
    max_processed_timestamp: str | None = None,
    max_aggregate_timestamp: str | None = None,
    pipeline_lag_seconds: int | None = None,
    backlog_size: int | None = None,
    unprocessed_backlog_size: int | None = None,
    last_memecoin_write_at: str | None = None,
    memecoin_status: str | None = None,
    memecoin_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "worker": "bluesky_firehose_worker",
        "cycle": cycle,
        "last_cursor_us": cursor_us or 0,
        "rows_inserted": rows_inserted,
        "state": _state_summary(state),
        "stats": dict(stats or {}),
        "timings": dict(timings or {}),
        "last_error": last_error,
        "shutdown_reason": shutdown_reason,
        "last_ingestion_write_at": last_ingestion_write_at,
        "last_aggregate_write_at": last_aggregate_write_at,
        "last_enrichment_write_at": last_enrichment_write_at,
        "enrichment_status": enrichment_status,
        "enrichment_backlog_size": enrichment_backlog_size,
        "active_stage": active_stage,
        "current_stage": active_stage,
        "stage_counts": dict(stage_counts or {}),
        "latest_source_created_at": latest_source_created_at,
        "last_heartbeat_at": last_heartbeat_at,
        "rows_written_this_cycle": rows_written_this_cycle,
        "last_successful_write_at": last_successful_write_at,
        "max_source_timestamp_seen": max_source_timestamp_seen or latest_source_created_at,
        "max_written_timestamp": max_written_timestamp or last_ingestion_write_at,
        "max_processed_timestamp": max_processed_timestamp,
        "max_aggregate_timestamp": max_aggregate_timestamp or last_aggregate_write_at,
        "pipeline_lag_seconds": pipeline_lag_seconds,
        "backlog_size": backlog_size,
        "unprocessed_backlog_size": unprocessed_backlog_size,
        "last_memecoin_write_at": last_memecoin_write_at,
        "memecoin_status": memecoin_status,
        "memecoin_summary": dict(memecoin_summary or {}) if isinstance(memecoin_summary, dict) else None,
        "updated_at": _utc_now().isoformat(),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Persistent Bluesky ingestion worker")
    parser.add_argument("--once", action="store_true", help="Run one firehose window and exit.")
    parser.add_argument(
        "--firehose-max-seconds",
        type=int,
        default=None,
        help="Max seconds to consume Jetstream per cycle.",
    )
    parser.add_argument(
        "--firehose-max-events",
        type=int,
        default=None,
        help="Max events to consume from Jetstream per cycle.",
    )
    parser.add_argument("--sleep-seconds", type=float, default=None)
    parser.add_argument("--retry-seconds", type=float, default=None)
    parser.add_argument(
        "--topic-aggregate-interval-seconds",
        type=float,
        default=None,
        help="Minimum seconds between stable topic read-model refreshes. Set 0 to disable.",
    )
    parser.add_argument(
        "--topic-cleanup-interval-seconds",
        type=float,
        default=None,
        help="Minimum seconds between topic mention cleanup passes.",
    )
    parser.add_argument("--source", type=str, default="")
    parser.add_argument(
        "--max-cycles",
        type=int,
        default=0,
        help="Stop after N cycles. 0 means run forever.",
    )
    parser.add_argument(
        "--verify-db-only",
        action="store_true",
        help="Verify DB connection/schema and exit.",
    )
    parser.add_argument(
        "--aggregate-1m",
        action="store_true",
        help="Refresh 1m metric buckets + stable topic read models once and exit.",
    )
    parser.add_argument(
        "--aggregate-1h",
        action="store_true",
        help="Aggregate raw_posts into metric_buckets_1h and exit.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        config = WorkerConfig.from_env(
            sleep_seconds=args.sleep_seconds,
            retry_seconds=args.retry_seconds,
            topic_aggregate_interval_seconds=args.topic_aggregate_interval_seconds,
            firehose_window_max_seconds=args.firehose_max_seconds,
            firehose_window_max_events=args.firehose_max_events,
        )
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2

    setup_logging(config.log_level)
    logger = logging.getLogger("backend.worker")
    source = args.source.strip() or config.source

    store = PostgresStore(
        database_url=config.database_url,
        batch_size=config.batch_size,
        logger=logger,
    )

    try:
        store.verify_connection()
        try:
            store.ensure_processed_topic_tables()
        except Exception as error:
            if not is_lock_timeout_error(error):
                raise
            log_event(
                logger,
                logging.WARNING,
                "processed_topic_schema_sync_deferred",
                source=source,
                error=str(error),
            )
        try:
            store.ensure_stable_topic_read_model_tables()
        except Exception as error:
            if not is_lock_timeout_error(error):
                raise
            log_event(
                logger,
                logging.WARNING,
                "stable_topic_schema_sync_deferred",
                source=source,
                error=str(error),
            )
        disabled_jobs = store.disable_legacy_topic_bucket_refresh_jobs()
        if disabled_jobs > 0:
            log_event(
                logger,
                logging.WARNING,
                "legacy_topic_bucket_jobs_disabled",
                source=source,
                disabled_job_count=disabled_jobs,
            )
        log_event(logger, logging.INFO, "db_connected", source=source)
    except Exception as error:
        log_event(logger, logging.ERROR, "db_connect_failed", source=source, error=str(error))
        store.close()
        return 1

    if args.verify_db_only:
        log_event(logger, logging.INFO, "db_verify_succeeded", source=source)
        store.close()
        return 0

    if args.aggregate_1m or args.aggregate_1h:
        try:
            store.ensure_metric_bucket_tables()
            store.ensure_processed_topic_tables()
            store.ensure_stable_topic_read_model_tables()
            rows_1m = 0
            rows_1h = 0
            processed_rows = 0
            stable_fact_rows = 0
            stable_cleanup_rows = 0
            stable_refresh: dict[str, Any] | None = None
            if args.aggregate_1m:
                processed_rows = store.refresh_processed_posts_from_raw_posts()
                stable_fact_rows = store.sync_post_topic_mentions_from_post_topics(
                    lookback_hours=config.topic_fact_sync_lookback_hours,
                )
                stable_cleanup_rows = store.cleanup_garbage_post_topic_mentions(
                    lookback_hours=max(
                        config.topic_fact_sync_lookback_hours,
                        config.topic_read_model_recompute_hours,
                    ),
                )
                stable_refresh = store.refresh_stable_topic_read_models(
                    lag_minutes=config.topic_read_model_lag_minutes,
                    recompute_hours=config.topic_read_model_recompute_hours,
                    series_max_topics=config.topic_read_model_series_max_topics,
                    series_min_mentions=config.topic_read_model_series_min_mentions,
                )
                rows_1m = store.aggregate_metric_buckets_1m()
                log_event(
                    logger,
                    logging.INFO,
                    "aggregation_complete_1m",
                    source=source,
                    rows_affected=rows_1m,
                    processed_rows_affected=processed_rows,
                    stable_fact_rows=stable_fact_rows,
                    stable_cleanup_rows=stable_cleanup_rows,
                    stable_refresh=stable_refresh,
                )
            if args.aggregate_1h:
                rows_1h = store.aggregate_metric_buckets_1h()
                log_event(
                    logger,
                    logging.INFO,
                    "aggregation_complete_1h",
                    source=source,
                    rows_affected=rows_1h,
                )
            log_event(
                logger,
                logging.INFO,
                "aggregation_finished",
                source=source,
                aggregate_1m=args.aggregate_1m,
                aggregate_1h=args.aggregate_1h,
                rows_1m=rows_1m,
                rows_1h=rows_1h,
                processed_rows=processed_rows,
                stable_fact_rows=stable_fact_rows,
                stable_cleanup_rows=stable_cleanup_rows,
                stable_refresh=stable_refresh,
            )
            store.close()
            return 0
        except Exception as error:
            log_event(
                logger,
                logging.ERROR,
                "aggregation_failed",
                source=source,
                error=str(error),
            )
            store.close()
            return 1

    started_at = _utc_now()
    rows_inserted_total = 0
    cycle = 0
    cursor_us = store.fetch_resume_cursor(source=source)
    shutdown_reason = "running"
    last_error: str | None = None
    last_state: dict[str, Any] = {}
    last_stats: dict[str, Any] = {}
    last_timings: dict[str, Any] = {}
    run_status = "running"
    last_raw_cleanup_at_monotonic = 0.0
    last_topic_aggregate_at_monotonic = 0.0
    last_topic_cleanup_at_monotonic = 0.0
    last_trend_title_at_monotonic = 0.0
    last_trend_enrichment_at_monotonic = 0.0
    last_memecoin_correlation_at_monotonic = 0.0
    worker_lease_acquired = False
    trend_title_config = build_trend_title_generation_runtime_config_from_env()
    trend_enrichment_config = build_trend_enrichment_runtime_config_from_env()
    memecoin_correlation_config = build_memecoin_correlation_runtime_config_from_env()
    topic_ai_writer_diagnostics_interval_seconds = _parse_float_env(
        "TOPIC_AI_WRITER_DIAGNOSTICS_INTERVAL_SECONDS",
        600.0,
        60.0,
        3600.0,
    )
    enrichment_min_cycles_between_runs = _parse_int_env(
        "BLUESKY_TREND_ENRICHMENT_MIN_CYCLES_BETWEEN_RUNS",
        2,
        0,
        1000,
    )
    enrichment_defer_backlog_lag_minutes = _parse_float_env(
        "BLUESKY_TREND_ENRICHMENT_DEFER_BACKLOG_LAG_MINUTES",
        8.0,
        0.0,
        240.0,
    )
    enrichment_defer_if_cycle_duration_ms = _parse_float_env(
        "BLUESKY_TREND_ENRICHMENT_DEFER_IF_CYCLE_DURATION_MS",
        14_000.0,
        0.0,
        300_000.0,
    )
    enrichment_defer_if_cycle_events = _parse_int_env(
        "BLUESKY_TREND_ENRICHMENT_DEFER_IF_CYCLE_EVENTS",
        8_000,
        0,
        500_000,
    )
    enrichment_defer_if_no_ingestion_seconds = _parse_float_env(
        "BLUESKY_TREND_ENRICHMENT_DEFER_IF_NO_INGESTION_SECONDS",
        45.0,
        0.0,
        3600.0,
    )
    last_ingestion_write_at_iso: str | None = None
    last_processed_write_at_iso: str | None = None
    last_aggregate_write_at_iso: str | None = None
    last_title_write_at_iso: str | None = None
    last_enrichment_write_at_iso: str | None = None
    last_memecoin_write_at_iso: str | None = None
    last_heartbeat_at_iso: str | None = None
    last_ingestion_write_at_monotonic = 0.0
    latest_source_created_at_iso: str | None = None
    last_enrichment_cycle = 0
    last_title_cycle = 0
    last_memecoin_cycle = 0
    last_title_summary: dict[str, Any] | None = None
    last_enrichment_summary: dict[str, Any] | None = None
    last_memecoin_summary: dict[str, Any] | None = None
    title_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="trend-title")
    enrichment_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="trend-enrichment")
    memecoin_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="memecoin-correlation")
    transform_executor = (
        ThreadPoolExecutor(
            max_workers=max(1, config.parse_workers),
            thread_name_prefix="worker-transform",
        )
        if config.parse_workers > 1
        else None
    )
    title_future: Future[dict[str, Any]] | None = None
    enrichment_future: Future[dict[str, Any]] | None = None
    memecoin_future: Future[dict[str, Any]] | None = None
    title_started_at_iso: str | None = None
    title_started_at_monotonic = 0.0
    title_last_reason: str | None = None
    enrichment_started_at_iso: str | None = None
    enrichment_started_at_monotonic = 0.0
    enrichment_last_reason: str | None = None
    memecoin_started_at_iso: str | None = None
    memecoin_started_at_monotonic = 0.0
    memecoin_last_reason: str | None = None
    aggregation_consecutive_failures = 0
    aggregation_backoff_until_monotonic = 0.0
    title_consecutive_failures = 0
    title_backoff_until_monotonic = 0.0
    enrichment_consecutive_failures = 0
    enrichment_backoff_until_monotonic = 0.0
    memecoin_consecutive_failures = 0
    memecoin_backoff_until_monotonic = 0.0
    last_topic_ai_writer_diagnostics_at_monotonic = 0.0

    stop_requested = False

    def handle_signal(signum: int, _frame: Any) -> None:
        nonlocal stop_requested, shutdown_reason
        stop_requested = True
        shutdown_reason = f"signal_{signum}"
        log_event(logger, logging.INFO, "shutdown_signal", signal=signum)

    signal.signal(signal.SIGINT, handle_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, handle_signal)

    def record_topic_ai_writer_heartbeat(
        *,
        writer_identity: str,
        writer_role: str,
        enabled: bool,
        model_name: str,
        prompt_version: str,
        status: str,
        last_reason: str | None = None,
        last_started_at: datetime | None = None,
        last_completed_at: datetime | None = None,
        last_write_at: datetime | None = None,
        metadata_json: dict[str, Any] | None = None,
    ) -> None:
        authoritative_writer = writer_identity in {
            TITLE_WRITER_IDENTITY,
            ENRICHMENT_WRITER_IDENTITY,
        }
        try:
            store.upsert_topic_ai_writer_heartbeat(
                {
                    "writer_identity": writer_identity,
                    "writer_role": writer_role,
                    "authoritative_writer": authoritative_writer,
                    "model_name": model_name,
                    "prompt_version": prompt_version,
                    "status": status,
                    "last_reason": last_reason,
                    "last_seen_at": _utc_now(),
                    "last_started_at": last_started_at,
                    "last_completed_at": last_completed_at,
                    "last_write_at": last_write_at,
                    "metadata_json": metadata_json or {},
                }
            )
        except Exception as heartbeat_error:
            log_event(
                logger,
                logging.WARNING,
                "topic_ai_writer_heartbeat_failed",
                writer_identity=writer_identity,
                writer_role=writer_role,
                status=status,
                error=str(heartbeat_error),
            )

    def log_topic_ai_writer_diagnostics_if_due(*, force: bool = False) -> None:
        nonlocal last_topic_ai_writer_diagnostics_at_monotonic
        now_monotonic = time.monotonic()
        if (
            not force
            and last_topic_ai_writer_diagnostics_at_monotonic > 0
            and (now_monotonic - last_topic_ai_writer_diagnostics_at_monotonic)
            < topic_ai_writer_diagnostics_interval_seconds
        ):
            return
        try:
            diagnostics = store.fetch_topic_ai_writer_diagnostics(
                lookback_hours=24,
                duplicate_write_threshold=3,
                authoritative_writer_identities=[
                    TITLE_WRITER_IDENTITY,
                    ENRICHMENT_WRITER_IDENTITY,
                ],
                expected_prompt_versions=[
                    trend_title_config.prompt_version,
                    trend_enrichment_config.prompt_version,
                ],
            )
        except Exception as diagnostics_error:
            log_event(
                logger,
                logging.WARNING,
                "topic_ai_writer_diagnostics_failed",
                error=str(diagnostics_error),
            )
            return

        last_topic_ai_writer_diagnostics_at_monotonic = now_monotonic
        anomaly_detected = bool(
            int(diagnostics.get("unknownWriterCount") or 0) > 0
            or int(diagnostics.get("nonAuthoritativeWriterCount") or 0) > 0
            or int(diagnostics.get("legacyPromptWriteCount") or 0) > 0
            or int(diagnostics.get("duplicateWriteTopicCount") or 0) > 0
            or int(diagnostics.get("nonAuthoritativeRunCount") or 0) > 0
            or int(diagnostics.get("activeWriterCount") or 0) > 2
        )
        log_event(
            logger,
            logging.WARNING if anomaly_detected else logging.INFO,
            "topic_ai_writer_diagnostics",
            diagnostics=diagnostics,
        )

    def run_raw_cleanup_if_due(*, force: bool = False) -> None:
        nonlocal last_raw_cleanup_at_monotonic
        if config.raw_retention_hours <= 0:
            return

        now_monotonic = time.monotonic()
        due = force or (
            last_raw_cleanup_at_monotonic <= 0
            or (now_monotonic - last_raw_cleanup_at_monotonic) >= config.raw_cleanup_interval_seconds
        )
        if not due:
            return

        try:
            deleted_count = store.prune_raw_posts_older_than(hours=config.raw_retention_hours)
            if deleted_count > 0:
                log_event(
                    logger,
                    logging.INFO,
                    "raw_cleanup_complete",
                    deleted_raw_posts=deleted_count,
                    retention_hours=config.raw_retention_hours,
                )
        except Exception as cleanup_error:
            log_event(
                logger,
                logging.ERROR,
                "raw_cleanup_failed",
                error=str(cleanup_error),
                retention_hours=config.raw_retention_hours,
            )
        finally:
            last_raw_cleanup_at_monotonic = now_monotonic

    def run_topic_aggregation_if_due(*, force: bool = False, reason: str) -> dict[str, Any]:
        nonlocal last_topic_aggregate_at_monotonic, last_topic_cleanup_at_monotonic, last_aggregate_write_at_iso
        nonlocal aggregation_consecutive_failures, aggregation_backoff_until_monotonic
        if config.topic_aggregate_interval_seconds <= 0:
            return {
                "executed": False,
                "status": "skipped",
                "reason": "aggregation_disabled",
            }

        now_monotonic = time.monotonic()
        since_last_seconds = (
            round(now_monotonic - last_topic_aggregate_at_monotonic, 3)
            if last_topic_aggregate_at_monotonic > 0
            else None
        )
        if not force and aggregation_backoff_until_monotonic > now_monotonic:
            return {
                "executed": False,
                "status": "deferred",
                "reason": "circuit_open",
                "retry_in_seconds": round(
                    aggregation_backoff_until_monotonic - now_monotonic,
                    3,
                ),
                "consecutive_failures": aggregation_consecutive_failures,
            }
        if (
            not force
            and last_topic_aggregate_at_monotonic > 0
            and (now_monotonic - last_topic_aggregate_at_monotonic) < config.topic_aggregate_interval_seconds
        ):
            return {
                "executed": False,
                "status": "deferred",
                "reason": "interval_guard",
                "last_run_delta_seconds": since_last_seconds,
            }

        started_monotonic = time.monotonic()
        started_at_iso = _utc_now().isoformat()
        cleanup_interval_seconds = (
            max(0.0, float(args.topic_cleanup_interval_seconds))
            if args.topic_cleanup_interval_seconds is not None
            else config.topic_cleanup_interval_seconds
        )
        cleanup_due = force or (
            last_topic_cleanup_at_monotonic <= 0
            or (started_monotonic - last_topic_cleanup_at_monotonic) >= cleanup_interval_seconds
        )
        try:
            stable_fact_rows = store.sync_post_topic_mentions_from_post_topics(
                lookback_hours=config.topic_fact_sync_lookback_hours,
                statement_timeout_seconds=config.topic_aggregate_timeout_seconds,
            )
            stable_cleanup_rows = 0
            if cleanup_due:
                stable_cleanup_rows = store.cleanup_garbage_post_topic_mentions(
                    lookback_hours=max(
                        config.topic_fact_sync_lookback_hours,
                        config.topic_read_model_recompute_hours,
                    ),
                    statement_timeout_seconds=config.topic_aggregate_timeout_seconds,
                )
                last_topic_cleanup_at_monotonic = started_monotonic
            stable_refresh = store.refresh_stable_topic_read_models(
                lag_minutes=config.topic_read_model_lag_minutes,
                recompute_hours=config.topic_read_model_recompute_hours,
                series_max_topics=config.topic_read_model_series_max_topics,
                series_min_mentions=config.topic_read_model_series_min_mentions,
                statement_timeout_seconds=config.topic_aggregate_timeout_seconds,
            )
            duration_ms = round((time.monotonic() - started_monotonic) * 1000, 1)
            aggregation_consecutive_failures = 0
            aggregation_backoff_until_monotonic = 0.0
            log_event(
                logger,
                logging.INFO,
                "topic_aggregation_complete",
                cycle=cycle,
                reason=reason,
                stable_fact_rows=stable_fact_rows,
                stable_cleanup_rows=stable_cleanup_rows,
                cleanup_due=cleanup_due,
                cleanup_interval_seconds=cleanup_interval_seconds,
                stable_refresh=stable_refresh,
                min_interval_seconds=config.topic_aggregate_interval_seconds,
                duration_ms=duration_ms,
                last_run_delta_seconds=since_last_seconds,
                started_at=started_at_iso,
            )
            refreshed_at = str(stable_refresh.get("refreshed_at") or "").strip() or _utc_now().isoformat()
            last_aggregate_write_at_iso = refreshed_at
            return {
                "executed": True,
                "status": "succeeded",
                "reason": reason,
                "duration_ms": duration_ms,
                "stable_fact_rows": stable_fact_rows,
                "stable_cleanup_rows": stable_cleanup_rows,
                "stable_refresh": stable_refresh,
                "cleanup_due": cleanup_due,
                "cleanup_interval_seconds": cleanup_interval_seconds,
                "last_run_delta_seconds": since_last_seconds,
                "started_at": started_at_iso,
                "refreshed_at": refreshed_at,
            }
        except Exception as aggregation_error:
            duration_ms = round((time.monotonic() - started_monotonic) * 1000, 1)
            aggregation_consecutive_failures += 1
            if aggregation_consecutive_failures >= config.secondary_stage_failure_threshold:
                aggregation_backoff_until_monotonic = (
                    time.monotonic() + config.secondary_stage_failure_backoff_seconds
                )
                log_event(
                    logger,
                    logging.WARNING,
                    "secondary_stage_backoff_opened",
                    cycle=cycle,
                    stage="aggregate",
                    reason=reason,
                    consecutive_failures=aggregation_consecutive_failures,
                    backoff_seconds=config.secondary_stage_failure_backoff_seconds,
                )
            log_event(
                logger,
                logging.ERROR,
                "topic_aggregation_failed",
                cycle=cycle,
                reason=reason,
                error=str(aggregation_error),
                min_interval_seconds=config.topic_aggregate_interval_seconds,
                cleanup_due=cleanup_due,
                cleanup_interval_seconds=cleanup_interval_seconds,
                duration_ms=duration_ms,
                last_run_delta_seconds=since_last_seconds,
                started_at=started_at_iso,
                consecutive_failures=aggregation_consecutive_failures,
            )
            return {
                "executed": True,
                "status": "failed",
                "reason": reason,
                "duration_ms": duration_ms,
                "error": str(aggregation_error),
                "cleanup_due": cleanup_due,
                "cleanup_interval_seconds": cleanup_interval_seconds,
                "last_run_delta_seconds": since_last_seconds,
                "started_at": started_at_iso,
                "consecutive_failures": aggregation_consecutive_failures,
            }
        finally:
            last_topic_aggregate_at_monotonic = started_monotonic

    def run_trend_title_generation_background(*, reason: str) -> dict[str, Any]:
        title_store = PostgresStore(
            database_url=config.database_url,
            batch_size=config.batch_size,
            logger=logger,
        )
        try:
            return run_trend_title_generation_backfill_job(
                store=title_store,
                logger=logger,
                config=trend_title_config,
                reason=reason,
            )
        finally:
            title_store.close()

    def poll_trend_title_generation_completion() -> None:
        nonlocal title_future
        nonlocal title_started_at_iso, title_started_at_monotonic, title_last_reason
        nonlocal last_title_write_at_iso, last_title_summary
        nonlocal title_consecutive_failures, title_backoff_until_monotonic
        if title_future is None or not title_future.done():
            return

        duration_ms = (
            round((time.monotonic() - title_started_at_monotonic) * 1000, 1)
            if title_started_at_monotonic > 0
            else None
        )
        completion_reason = title_last_reason or "background"
        try:
            summary = title_future.result()
            completed_at = _utc_now()
            if summary.get("skipped"):
                log_event(
                    logger,
                    logging.INFO,
                    "trend_title_skipped",
                    reason=completion_reason,
                    skip_reason=summary.get("reason"),
                    duration_ms=duration_ms,
                    started_at=title_started_at_iso,
                    summary=summary,
                )
                status = "skipped"
            else:
                log_event(
                    logger,
                    logging.INFO,
                    "trend_title_complete",
                    reason=completion_reason,
                    duration_ms=duration_ms,
                    started_at=title_started_at_iso,
                    summary=summary,
                )
                last_title_write_at_iso = str(summary.get("last_write_at") or _utc_now().isoformat())
                status = "succeeded"
            record_topic_ai_writer_heartbeat(
                writer_identity=TITLE_WRITER_IDENTITY,
                writer_role=TITLE_WRITER_ROLE,
                enabled=trend_title_config.enabled,
                model_name=trend_title_config.model_name,
                prompt_version=trend_title_config.prompt_version,
                status=status,
                last_reason=completion_reason,
                last_completed_at=completed_at,
                last_write_at=_parse_iso_datetime(summary.get("last_write_at")),
                metadata_json={
                    "summary": summary,
                },
            )
            title_consecutive_failures = 0
            title_backoff_until_monotonic = 0.0
            last_title_summary = {
                "status": status,
                **(summary if isinstance(summary, dict) else {}),
            }
            log_topic_ai_writer_diagnostics_if_due(force=bool(status == "succeeded"))
        except Exception as title_error:
            title_consecutive_failures += 1
            if title_consecutive_failures >= config.secondary_stage_failure_threshold:
                title_backoff_until_monotonic = (
                    time.monotonic() + config.secondary_stage_failure_backoff_seconds
                )
                log_event(
                    logger,
                    logging.WARNING,
                    "secondary_stage_backoff_opened",
                    stage="title",
                    reason=completion_reason,
                    consecutive_failures=title_consecutive_failures,
                    backoff_seconds=config.secondary_stage_failure_backoff_seconds,
                )
            log_event(
                logger,
                logging.ERROR,
                "trend_title_failed",
                reason=completion_reason,
                error=str(title_error),
                duration_ms=duration_ms,
                started_at=title_started_at_iso,
                consecutive_failures=title_consecutive_failures,
            )
            last_title_summary = {
                "status": "failed",
                "error": str(title_error),
            }
            record_topic_ai_writer_heartbeat(
                writer_identity=TITLE_WRITER_IDENTITY,
                writer_role=TITLE_WRITER_ROLE,
                enabled=trend_title_config.enabled,
                model_name=trend_title_config.model_name,
                prompt_version=trend_title_config.prompt_version,
                status="failed",
                last_reason=completion_reason,
                last_completed_at=_utc_now(),
                metadata_json={
                    "error": str(title_error),
                },
            )
        finally:
            title_future = None
            title_started_at_iso = None
            title_started_at_monotonic = 0.0
            title_last_reason = None

    def run_trend_title_generation_if_due(
        *,
        force: bool = False,
        reason: str,
    ) -> dict[str, Any]:
        nonlocal last_trend_title_at_monotonic
        nonlocal last_title_write_at_iso, last_title_cycle, last_title_summary
        nonlocal title_future
        nonlocal title_started_at_iso, title_started_at_monotonic, title_last_reason
        nonlocal title_consecutive_failures, title_backoff_until_monotonic
        now_monotonic = time.monotonic()
        now_iso = _utc_now().isoformat()
        cycles_since_last = cycle - last_title_cycle if last_title_cycle > 0 else cycle
        poll_trend_title_generation_completion()

        def deferred_outcome(reason_code: str, **extra: Any) -> dict[str, Any]:
            payload = {
                "executed": False,
                "status": "deferred",
                "reason": reason_code,
                "deferred_at": now_iso,
                "cycles_since_last": max(0, cycles_since_last),
                "last_success_at": last_title_write_at_iso,
                "last_summary": last_title_summary,
            }
            payload.update(extra)
            return payload

        if not trend_title_config.enabled:
            return deferred_outcome("disabled")
        if not trend_title_config.openai_api_key:
            return deferred_outcome("missing_openai_api_key")
        if not force and title_backoff_until_monotonic > now_monotonic:
            return deferred_outcome(
                "circuit_open",
                retry_in_seconds=round(title_backoff_until_monotonic - now_monotonic, 3),
                consecutive_failures=title_consecutive_failures,
            )
        if title_future is not None and not title_future.done():
            return {
                "executed": False,
                "status": "running",
                "reason": "already_running",
                "started_at": title_started_at_iso,
                "cycles_since_last": max(0, cycles_since_last),
                "last_success_at": last_title_write_at_iso,
                "last_summary": last_title_summary,
            }
        if (
            not force
            and last_trend_title_at_monotonic > 0
            and (now_monotonic - last_trend_title_at_monotonic) < trend_title_config.interval_seconds
        ):
            return deferred_outcome("interval_guard")

        started_monotonic = time.monotonic()
        try:
            title_started_at_iso = now_iso
            title_started_at_monotonic = now_monotonic
            title_last_reason = reason
            title_future = title_executor.submit(
                run_trend_title_generation_background,
                reason=reason,
            )
            last_title_summary = {
                "status": "running",
                "started_at": now_iso,
                "reason": reason,
            }
            last_title_cycle = cycle
            last_trend_title_at_monotonic = now_monotonic
            queue_duration_ms = round((time.monotonic() - started_monotonic) * 1000, 1)
            log_event(
                logger,
                logging.INFO,
                "trend_title_job_started",
                reason=reason,
                started_at=now_iso,
                queue_duration_ms=queue_duration_ms,
                last_success_at=last_title_write_at_iso,
            )
            record_topic_ai_writer_heartbeat(
                writer_identity=TITLE_WRITER_IDENTITY,
                writer_role=TITLE_WRITER_ROLE,
                enabled=trend_title_config.enabled,
                model_name=trend_title_config.model_name,
                prompt_version=trend_title_config.prompt_version,
                status="running",
                last_reason=reason,
                last_started_at=_parse_iso_datetime(now_iso),
                metadata_json={
                    "queue_duration_ms": queue_duration_ms,
                },
            )
            return {
                "executed": True,
                "status": "scheduled",
                "reason": reason,
                "duration_ms": queue_duration_ms,
                "started_at": now_iso,
                "last_success_at": last_title_write_at_iso,
                "summary": last_title_summary,
            }
        except Exception as title_error:
            duration_ms = round((time.monotonic() - started_monotonic) * 1000, 1)
            log_event(
                logger,
                logging.ERROR,
                "trend_title_failed",
                reason=reason,
                error=str(title_error),
                duration_ms=duration_ms,
            )
            title_future = None
            title_started_at_iso = None
            title_started_at_monotonic = 0.0
            title_last_reason = None
            last_trend_title_at_monotonic = now_monotonic
            title_consecutive_failures += 1
            if title_consecutive_failures >= config.secondary_stage_failure_threshold:
                title_backoff_until_monotonic = (
                    time.monotonic() + config.secondary_stage_failure_backoff_seconds
                )
                log_event(
                    logger,
                    logging.WARNING,
                    "secondary_stage_backoff_opened",
                    stage="title",
                    reason=reason,
                    consecutive_failures=title_consecutive_failures,
                    backoff_seconds=config.secondary_stage_failure_backoff_seconds,
                )
            last_title_summary = {
                "status": "failed",
                "error": str(title_error),
            }
            record_topic_ai_writer_heartbeat(
                writer_identity=TITLE_WRITER_IDENTITY,
                writer_role=TITLE_WRITER_ROLE,
                enabled=trend_title_config.enabled,
                model_name=trend_title_config.model_name,
                prompt_version=trend_title_config.prompt_version,
                status="failed",
                last_reason=reason,
                last_completed_at=_utc_now(),
                metadata_json={
                    "error": str(title_error),
                },
            )
            return {
                "executed": True,
                "status": "failed",
                "reason": reason,
                "duration_ms": duration_ms,
                "error": str(title_error),
            }

    def run_trend_enrichment_background(*, reason: str) -> dict[str, Any]:
        enrichment_store = PostgresStore(
            database_url=config.database_url,
            batch_size=config.batch_size,
            logger=logger,
        )
        try:
            return run_trend_enrichment_cycle(
                store=enrichment_store,
                logger=logger,
                config=trend_enrichment_config,
                reason=reason,
            )
        finally:
            enrichment_store.close()

    def poll_trend_enrichment_completion() -> None:
        nonlocal enrichment_future
        nonlocal enrichment_started_at_iso, enrichment_started_at_monotonic, enrichment_last_reason
        nonlocal last_enrichment_write_at_iso, last_enrichment_summary
        nonlocal enrichment_consecutive_failures, enrichment_backoff_until_monotonic
        if enrichment_future is None or not enrichment_future.done():
            return

        duration_ms = (
            round((time.monotonic() - enrichment_started_at_monotonic) * 1000, 1)
            if enrichment_started_at_monotonic > 0
            else None
        )
        completion_reason = enrichment_last_reason or "background"
        try:
            summary = enrichment_future.result()
            completed_at = _utc_now()
            if summary.get("skipped"):
                log_event(
                    logger,
                    logging.INFO,
                    "trend_enrichment_skipped",
                    reason=completion_reason,
                    skip_reason=summary.get("reason"),
                    duration_ms=duration_ms,
                    started_at=enrichment_started_at_iso,
                    summary=summary,
                )
                status = "skipped"
            else:
                log_event(
                    logger,
                    logging.INFO,
                    "trend_enrichment_complete",
                    reason=completion_reason,
                    duration_ms=duration_ms,
                    started_at=enrichment_started_at_iso,
                    summary=summary,
                )
                last_enrichment_write_at_iso = _utc_now().isoformat()
                status = "succeeded"
            record_topic_ai_writer_heartbeat(
                writer_identity=ENRICHMENT_WRITER_IDENTITY,
                writer_role=ENRICHMENT_WRITER_ROLE,
                enabled=trend_enrichment_config.enabled,
                model_name=trend_enrichment_config.model_name,
                prompt_version=trend_enrichment_config.prompt_version,
                status=status,
                last_reason=completion_reason,
                last_completed_at=completed_at,
                last_write_at=_parse_iso_datetime(summary.get("last_write_at")) if isinstance(summary, dict) else None,
                metadata_json={
                    "summary": summary,
                },
            )
            enrichment_consecutive_failures = 0
            enrichment_backoff_until_monotonic = 0.0
            last_enrichment_summary = {
                "status": status,
                **(summary if isinstance(summary, dict) else {}),
            }
            log_topic_ai_writer_diagnostics_if_due(force=bool(status == "succeeded"))
        except Exception as enrichment_error:
            enrichment_consecutive_failures += 1
            if enrichment_consecutive_failures >= config.secondary_stage_failure_threshold:
                enrichment_backoff_until_monotonic = (
                    time.monotonic() + config.secondary_stage_failure_backoff_seconds
                )
                log_event(
                    logger,
                    logging.WARNING,
                    "secondary_stage_backoff_opened",
                    stage="enrich",
                    reason=completion_reason,
                    consecutive_failures=enrichment_consecutive_failures,
                    backoff_seconds=config.secondary_stage_failure_backoff_seconds,
                )
            log_event(
                logger,
                logging.ERROR,
                "trend_enrichment_failed",
                reason=completion_reason,
                error=str(enrichment_error),
                duration_ms=duration_ms,
                started_at=enrichment_started_at_iso,
                consecutive_failures=enrichment_consecutive_failures,
            )
            last_enrichment_summary = {
                "status": "failed",
                "error": str(enrichment_error),
            }
            record_topic_ai_writer_heartbeat(
                writer_identity=ENRICHMENT_WRITER_IDENTITY,
                writer_role=ENRICHMENT_WRITER_ROLE,
                enabled=trend_enrichment_config.enabled,
                model_name=trend_enrichment_config.model_name,
                prompt_version=trend_enrichment_config.prompt_version,
                status="failed",
                last_reason=completion_reason,
                last_completed_at=_utc_now(),
                metadata_json={
                    "error": str(enrichment_error),
                },
            )
        finally:
            enrichment_future = None
            enrichment_started_at_iso = None
            enrichment_started_at_monotonic = 0.0
            enrichment_last_reason = None

    def run_trend_enrichment_if_due(
        *,
        force: bool = False,
        reason: str,
        cycle_duration_ms: float | None = None,
        cycle_events_processed: int | None = None,
        backlog_lag_minutes: float | None = None,
    ) -> dict[str, Any]:
        nonlocal last_trend_enrichment_at_monotonic
        nonlocal last_enrichment_write_at_iso, last_enrichment_cycle, last_enrichment_summary
        nonlocal enrichment_future
        nonlocal enrichment_started_at_iso, enrichment_started_at_monotonic, enrichment_last_reason
        nonlocal enrichment_consecutive_failures, enrichment_backoff_until_monotonic
        now_monotonic = time.monotonic()
        now_iso = _utc_now().isoformat()
        cycles_since_last = cycle - last_enrichment_cycle if last_enrichment_cycle > 0 else cycle
        poll_trend_enrichment_completion()

        def deferred_outcome(reason_code: str, **extra: Any) -> dict[str, Any]:
            payload = {
                "executed": False,
                "status": "deferred",
                "reason": reason_code,
                "deferred_at": now_iso,
                "cycles_since_last": max(0, cycles_since_last),
                "last_success_at": last_enrichment_write_at_iso,
                "last_summary": last_enrichment_summary,
            }
            payload.update(extra)
            return payload

        if not trend_enrichment_config.enabled:
            return deferred_outcome("disabled")
        if not trend_enrichment_config.openai_api_key:
            log_event(
                logger,
                logging.WARNING,
                "trend_enrichment_skipped_missing_api_key",
                reason=reason,
            )
            return deferred_outcome("missing_openai_api_key")
        if not force and enrichment_backoff_until_monotonic > now_monotonic:
            return deferred_outcome(
                "circuit_open",
                retry_in_seconds=round(enrichment_backoff_until_monotonic - now_monotonic, 3),
                consecutive_failures=enrichment_consecutive_failures,
            )
        if enrichment_future is not None and not enrichment_future.done():
            return {
                "executed": False,
                "status": "running",
                "reason": "already_running",
                "started_at": enrichment_started_at_iso,
                "cycles_since_last": max(0, cycles_since_last),
                "last_success_at": last_enrichment_write_at_iso,
                "last_summary": last_enrichment_summary,
            }
        if (
            not force
            and last_trend_enrichment_at_monotonic > 0
            and (now_monotonic - last_trend_enrichment_at_monotonic) < trend_enrichment_config.interval_seconds
        ):
            return deferred_outcome("interval_guard")
        if not force and cycles_since_last < max(0, enrichment_min_cycles_between_runs):
            return deferred_outcome("min_cycle_guard")
        if (
            not force
            and cycle_duration_ms is not None
            and cycle_duration_ms >= enrichment_defer_if_cycle_duration_ms
        ):
            return deferred_outcome(
                "cycle_duration_guard",
                cycle_duration_ms=cycle_duration_ms,
                threshold_ms=enrichment_defer_if_cycle_duration_ms,
            )
        if (
            not force
            and cycle_events_processed is not None
            and cycle_events_processed >= enrichment_defer_if_cycle_events
        ):
            return deferred_outcome(
                "cycle_events_guard",
                cycle_events_processed=cycle_events_processed,
                threshold_events=enrichment_defer_if_cycle_events,
            )
        if (
            not force
            and backlog_lag_minutes is not None
            and backlog_lag_minutes >= enrichment_defer_backlog_lag_minutes
        ):
            return deferred_outcome(
                "backlog_lag_guard",
                backlog_lag_minutes=backlog_lag_minutes,
                threshold_minutes=enrichment_defer_backlog_lag_minutes,
            )
        if (
            not force
            and last_ingestion_write_at_monotonic > 0
            and (now_monotonic - last_ingestion_write_at_monotonic) >= enrichment_defer_if_no_ingestion_seconds
        ):
            return deferred_outcome(
                "ingestion_stale_guard",
                seconds_since_last_ingestion=round(now_monotonic - last_ingestion_write_at_monotonic, 3),
                threshold_seconds=enrichment_defer_if_no_ingestion_seconds,
            )

        started_monotonic = time.monotonic()
        try:
            enrichment_started_at_iso = now_iso
            enrichment_started_at_monotonic = now_monotonic
            enrichment_last_reason = reason
            enrichment_future = enrichment_executor.submit(
                run_trend_enrichment_background,
                reason=reason,
            )
            last_enrichment_summary = {
                "status": "running",
                "started_at": now_iso,
                "reason": reason,
            }
            last_enrichment_cycle = cycle
            last_trend_enrichment_at_monotonic = now_monotonic
            queue_duration_ms = round((time.monotonic() - started_monotonic) * 1000, 1)
            log_event(
                logger,
                logging.INFO,
                "trend_enrichment_job_started",
                reason=reason,
                started_at=now_iso,
                queue_duration_ms=queue_duration_ms,
                last_success_at=last_enrichment_write_at_iso,
            )
            record_topic_ai_writer_heartbeat(
                writer_identity=ENRICHMENT_WRITER_IDENTITY,
                writer_role=ENRICHMENT_WRITER_ROLE,
                enabled=trend_enrichment_config.enabled,
                model_name=trend_enrichment_config.model_name,
                prompt_version=trend_enrichment_config.prompt_version,
                status="running",
                last_reason=reason,
                last_started_at=_parse_iso_datetime(now_iso),
                metadata_json={
                    "queue_duration_ms": queue_duration_ms,
                    "cycle_duration_ms": cycle_duration_ms,
                    "cycle_events_processed": cycle_events_processed,
                    "backlog_lag_minutes": backlog_lag_minutes,
                },
            )
            return {
                "executed": True,
                "status": "scheduled",
                "reason": reason,
                "duration_ms": queue_duration_ms,
                "started_at": now_iso,
                "last_success_at": last_enrichment_write_at_iso,
                "summary": last_enrichment_summary,
            }
        except Exception as enrichment_error:
            duration_ms = round((time.monotonic() - started_monotonic) * 1000, 1)
            log_event(
                logger,
                logging.ERROR,
                "trend_enrichment_failed",
                reason=reason,
                error=str(enrichment_error),
                duration_ms=duration_ms,
            )
            enrichment_future = None
            enrichment_started_at_iso = None
            enrichment_started_at_monotonic = 0.0
            enrichment_last_reason = None
            last_trend_enrichment_at_monotonic = now_monotonic
            enrichment_consecutive_failures += 1
            if enrichment_consecutive_failures >= config.secondary_stage_failure_threshold:
                enrichment_backoff_until_monotonic = (
                    time.monotonic() + config.secondary_stage_failure_backoff_seconds
                )
                log_event(
                    logger,
                    logging.WARNING,
                    "secondary_stage_backoff_opened",
                    stage="enrich",
                    reason=reason,
                    consecutive_failures=enrichment_consecutive_failures,
                    backoff_seconds=config.secondary_stage_failure_backoff_seconds,
                )
            last_enrichment_summary = {
                "status": "failed",
                "error": str(enrichment_error),
            }
            record_topic_ai_writer_heartbeat(
                writer_identity=ENRICHMENT_WRITER_IDENTITY,
                writer_role=ENRICHMENT_WRITER_ROLE,
                enabled=trend_enrichment_config.enabled,
                model_name=trend_enrichment_config.model_name,
                prompt_version=trend_enrichment_config.prompt_version,
                status="failed",
                last_reason=reason,
                last_completed_at=_utc_now(),
                metadata_json={
                    "error": str(enrichment_error),
                },
            )
            return {
                "executed": True,
                "status": "failed",
                "reason": reason,
                "duration_ms": duration_ms,
                "error": str(enrichment_error),
            }

    def run_memecoin_correlation_background(*, reason: str) -> dict[str, Any]:
        memecoin_store = PostgresStore(
            database_url=config.database_url,
            batch_size=config.batch_size,
            logger=logger,
        )
        try:
            return run_memecoin_correlation_cycle(
                store=memecoin_store,
                logger=logger,
                config=memecoin_correlation_config,
                reason=reason,
            )
        finally:
            memecoin_store.close()

    def poll_memecoin_completion() -> None:
        nonlocal memecoin_future
        nonlocal memecoin_started_at_iso, memecoin_started_at_monotonic, memecoin_last_reason
        nonlocal last_memecoin_write_at_iso, last_memecoin_summary
        nonlocal memecoin_consecutive_failures, memecoin_backoff_until_monotonic
        if memecoin_future is None or not memecoin_future.done():
            return

        duration_ms = (
            round((time.monotonic() - memecoin_started_at_monotonic) * 1000, 1)
            if memecoin_started_at_monotonic > 0
            else None
        )
        completion_reason = memecoin_last_reason or "background"
        try:
            summary = memecoin_future.result()
            summary_status = str(summary.get("status") or "succeeded") if isinstance(summary, dict) else "succeeded"
            if summary.get("skipped"):
                log_event(
                    logger,
                    logging.INFO,
                    "memecoin_correlation_skipped",
                    reason=completion_reason,
                    skip_reason=summary.get("reason"),
                    duration_ms=duration_ms,
                    started_at=memecoin_started_at_iso,
                    summary=summary,
                )
                status = "skipped"
            elif summary_status == "failed":
                memecoin_consecutive_failures += 1
                if memecoin_consecutive_failures >= config.secondary_stage_failure_threshold:
                    memecoin_backoff_until_monotonic = (
                        time.monotonic() + config.secondary_stage_failure_backoff_seconds
                    )
                    log_event(
                        logger,
                        logging.WARNING,
                        "secondary_stage_backoff_opened",
                        stage="memecoin_correlate",
                        reason=completion_reason,
                        consecutive_failures=memecoin_consecutive_failures,
                        backoff_seconds=config.secondary_stage_failure_backoff_seconds,
                    )
                log_event(
                    logger,
                    logging.ERROR,
                    "memecoin_correlation_failed",
                    reason=completion_reason,
                    duration_ms=duration_ms,
                    started_at=memecoin_started_at_iso,
                    summary=summary,
                    consecutive_failures=memecoin_consecutive_failures,
                )
                status = "failed"
            else:
                log_event(
                    logger,
                    logging.INFO,
                    "memecoin_correlation_complete",
                    reason=completion_reason,
                    duration_ms=duration_ms,
                    started_at=memecoin_started_at_iso,
                    summary=summary,
                )
                if summary.get("published_result_count"):
                    last_memecoin_write_at_iso = str(summary.get("updated_at") or _utc_now().isoformat())
                status = summary_status
                memecoin_consecutive_failures = 0
                memecoin_backoff_until_monotonic = 0.0
            if status == "skipped":
                memecoin_consecutive_failures = 0
                memecoin_backoff_until_monotonic = 0.0
            last_memecoin_summary = {
                "status": status,
                **(summary if isinstance(summary, dict) else {}),
            }
        except Exception as memecoin_error:
            memecoin_consecutive_failures += 1
            if memecoin_consecutive_failures >= config.secondary_stage_failure_threshold:
                memecoin_backoff_until_monotonic = (
                    time.monotonic() + config.secondary_stage_failure_backoff_seconds
                )
                log_event(
                    logger,
                    logging.WARNING,
                    "secondary_stage_backoff_opened",
                    stage="memecoin_correlate",
                    reason=completion_reason,
                    consecutive_failures=memecoin_consecutive_failures,
                    backoff_seconds=config.secondary_stage_failure_backoff_seconds,
                )
            log_event(
                logger,
                logging.ERROR,
                "memecoin_correlation_failed",
                reason=completion_reason,
                error=str(memecoin_error),
                duration_ms=duration_ms,
                started_at=memecoin_started_at_iso,
                consecutive_failures=memecoin_consecutive_failures,
            )
            last_memecoin_summary = {
                "status": "failed",
                "error": str(memecoin_error),
            }
        finally:
            memecoin_future = None
            memecoin_started_at_iso = None
            memecoin_started_at_monotonic = 0.0
            memecoin_last_reason = None

    def run_memecoin_correlation_if_due(
        *,
        force: bool = False,
        reason: str,
        cycle_duration_ms: float | None = None,
        cycle_events_processed: int | None = None,
        backlog_lag_minutes: float | None = None,
    ) -> dict[str, Any]:
        nonlocal last_memecoin_correlation_at_monotonic
        nonlocal last_memecoin_write_at_iso, last_memecoin_cycle, last_memecoin_summary
        nonlocal memecoin_future
        nonlocal memecoin_started_at_iso, memecoin_started_at_monotonic, memecoin_last_reason
        nonlocal memecoin_consecutive_failures, memecoin_backoff_until_monotonic
        now_monotonic = time.monotonic()
        now_iso = _utc_now().isoformat()
        cycles_since_last = cycle - last_memecoin_cycle if last_memecoin_cycle > 0 else cycle
        poll_memecoin_completion()

        def deferred_outcome(reason_code: str, **extra: Any) -> dict[str, Any]:
            payload = {
                "executed": False,
                "status": "deferred",
                "reason": reason_code,
                "deferred_at": now_iso,
                "cycles_since_last": max(0, cycles_since_last),
                "last_success_at": last_memecoin_write_at_iso,
                "last_summary": last_memecoin_summary,
            }
            payload.update(extra)
            return payload

        if not memecoin_correlation_config.enabled:
            return deferred_outcome("disabled")
        if not force and memecoin_backoff_until_monotonic > now_monotonic:
            return deferred_outcome(
                "circuit_open",
                retry_in_seconds=round(memecoin_backoff_until_monotonic - now_monotonic, 3),
                consecutive_failures=memecoin_consecutive_failures,
            )
        if memecoin_future is not None and not memecoin_future.done():
            return {
                "executed": False,
                "status": "running",
                "reason": "already_running",
                "started_at": memecoin_started_at_iso,
                "cycles_since_last": max(0, cycles_since_last),
                "last_success_at": last_memecoin_write_at_iso,
                "last_summary": last_memecoin_summary,
            }
        if (
            not force
            and last_memecoin_correlation_at_monotonic > 0
            and (now_monotonic - last_memecoin_correlation_at_monotonic)
            < memecoin_correlation_config.interval_seconds
        ):
            return deferred_outcome("interval_guard")
        if (
            not force
            and cycles_since_last < max(0, memecoin_correlation_config.min_cycles_between_runs)
        ):
            return deferred_outcome("min_cycle_guard")
        if (
            not force
            and cycle_duration_ms is not None
            and cycle_duration_ms >= memecoin_correlation_config.defer_if_cycle_duration_ms
        ):
            return deferred_outcome(
                "cycle_duration_guard",
                cycle_duration_ms=cycle_duration_ms,
                threshold_ms=memecoin_correlation_config.defer_if_cycle_duration_ms,
            )
        if (
            not force
            and cycle_events_processed is not None
            and cycle_events_processed >= memecoin_correlation_config.defer_if_cycle_events
        ):
            return deferred_outcome(
                "cycle_events_guard",
                cycle_events_processed=cycle_events_processed,
                threshold_events=memecoin_correlation_config.defer_if_cycle_events,
            )
        if (
            not force
            and backlog_lag_minutes is not None
            and backlog_lag_minutes >= memecoin_correlation_config.defer_backlog_lag_minutes
        ):
            return deferred_outcome(
                "backlog_lag_guard",
                backlog_lag_minutes=backlog_lag_minutes,
                threshold_minutes=memecoin_correlation_config.defer_backlog_lag_minutes,
            )
        if (
            not force
            and last_ingestion_write_at_monotonic > 0
            and (now_monotonic - last_ingestion_write_at_monotonic)
            >= memecoin_correlation_config.defer_if_no_ingestion_seconds
        ):
            return deferred_outcome(
                "ingestion_stale_guard",
                seconds_since_last_ingestion=round(now_monotonic - last_ingestion_write_at_monotonic, 3),
                threshold_seconds=memecoin_correlation_config.defer_if_no_ingestion_seconds,
            )

        started_monotonic = time.monotonic()
        try:
            memecoin_started_at_iso = now_iso
            memecoin_started_at_monotonic = now_monotonic
            memecoin_last_reason = reason
            memecoin_future = memecoin_executor.submit(
                run_memecoin_correlation_background,
                reason=reason,
            )
            last_memecoin_summary = {
                "status": "running",
                "started_at": now_iso,
                "reason": reason,
            }
            last_memecoin_cycle = cycle
            last_memecoin_correlation_at_monotonic = now_monotonic
            queue_duration_ms = round((time.monotonic() - started_monotonic) * 1000, 1)
            log_event(
                logger,
                logging.INFO,
                "memecoin_correlation_job_started",
                reason=reason,
                started_at=now_iso,
                queue_duration_ms=queue_duration_ms,
                last_success_at=last_memecoin_write_at_iso,
            )
            return {
                "executed": True,
                "status": "scheduled",
                "reason": reason,
                "duration_ms": queue_duration_ms,
                "started_at": now_iso,
                "last_success_at": last_memecoin_write_at_iso,
                "summary": last_memecoin_summary,
            }
        except Exception as memecoin_error:
            duration_ms = round((time.monotonic() - started_monotonic) * 1000, 1)
            log_event(
                logger,
                logging.ERROR,
                "memecoin_correlation_failed",
                reason=reason,
                error=str(memecoin_error),
                duration_ms=duration_ms,
            )
            memecoin_future = None
            memecoin_started_at_iso = None
            memecoin_started_at_monotonic = 0.0
            memecoin_last_reason = None
            last_memecoin_correlation_at_monotonic = now_monotonic
            memecoin_consecutive_failures += 1
            if memecoin_consecutive_failures >= config.secondary_stage_failure_threshold:
                memecoin_backoff_until_monotonic = (
                    time.monotonic() + config.secondary_stage_failure_backoff_seconds
                )
                log_event(
                    logger,
                    logging.WARNING,
                    "secondary_stage_backoff_opened",
                    stage="memecoin_correlate",
                    reason=reason,
                    consecutive_failures=memecoin_consecutive_failures,
                    backoff_seconds=config.secondary_stage_failure_backoff_seconds,
                )
            last_memecoin_summary = {
                "status": "failed",
                "error": str(memecoin_error),
            }
            return {
                "executed": True,
                "status": "failed",
                "reason": reason,
                "duration_ms": duration_ms,
                "error": str(memecoin_error),
            }

    def drain_background_stage(
        *,
        stage: str,
        future: Future[dict[str, Any]] | None,
        timeout_seconds: float,
        poll_completion: Callable[[], None],
    ) -> None:
        if future is None:
            return
        if not future.done():
            try:
                future.result(timeout=max(1.0, timeout_seconds))
            except FutureTimeoutError:
                log_event(
                    logger,
                    logging.WARNING,
                    "secondary_stage_shutdown_timeout",
                    source=source,
                    stage=stage,
                    timeout_seconds=round(max(1.0, timeout_seconds), 1),
                )
                return
            except Exception:
                # Completion polling records the failure with the existing stage-specific log shape.
                pass
        poll_completion()

    initial_notes = _build_run_notes(
        cycle=cycle,
        cursor_us=cursor_us,
        rows_inserted=rows_inserted_total,
        shutdown_reason=None,
        state=None,
        stats=None,
        timings=None,
        last_error=None,
        active_stage="startup",
        last_heartbeat_at=_utc_now().isoformat(),
        rows_written_this_cycle=0,
        last_memecoin_write_at=last_memecoin_write_at_iso,
        memecoin_status=(
            (last_memecoin_summary or {}).get("status")
            if isinstance(last_memecoin_summary, dict)
            else None
        ),
        memecoin_summary=last_memecoin_summary if isinstance(last_memecoin_summary, dict) else None,
    )

    try:
        lease = store.acquire_worker_lease(
            source=source,
            stale_after_minutes=config.worker_stale_run_minutes,
        )
        if not bool(lease.get("acquired")):
            log_event(
                logger,
                logging.WARNING,
                "worker_lease_unavailable",
                source=source,
                stale_after_minutes=config.worker_stale_run_minutes,
            )
            store.close()
            return 0

        worker_lease_acquired = True
        log_event(
            logger,
            logging.INFO,
            "worker_lease_acquired",
            source=source,
            stale_after_minutes=config.worker_stale_run_minutes,
            closed_stale_runs=int(lease.get("closed_stale_runs") or 0),
            closed_open_runs=int(lease.get("closed_open_runs") or 0),
            stale_after_seconds=int(lease.get("stale_after_seconds") or 0),
        )
        if int(lease.get("closed_stale_runs") or 0) > 0:
            log_event(
                logger,
                logging.WARNING,
                "worker_stale_run_takeover",
                source=source,
                closed_stale_runs=int(lease.get("closed_stale_runs") or 0),
                closed_open_runs=int(lease.get("closed_open_runs") or 0),
            )

        store.create_ingestion_run(
            source=source,
            started_at=started_at,
            notes=initial_notes,
            last_heartbeat_at=started_at,
            current_stage="startup",
            rows_written_this_cycle=0,
        )
    except Exception as error:
        log_event(logger, logging.ERROR, "create_ingestion_run_failed", source=source, error=str(error))
        store.close()
        return 1

    log_event(
        logger,
        logging.INFO,
        "worker_start",
        source=source,
        started_at=started_at.isoformat(),
        resumed_cursor=cursor_us or 0,
        once=args.once,
        max_cycles=args.max_cycles,
        firehose_window_max_seconds=config.firehose_window_max_seconds,
        firehose_window_max_events=config.firehose_window_max_events,
        backlog_firehose_window_max_seconds=config.backlog_firehose_window_max_seconds,
        backlog_firehose_window_max_events=config.backlog_firehose_window_max_events,
        topic_aggregate_interval_seconds=config.topic_aggregate_interval_seconds,
        topic_aggregate_timeout_seconds=config.topic_aggregate_timeout_seconds,
        topic_fact_sync_lookback_hours=config.topic_fact_sync_lookback_hours,
        topic_read_model_lag_minutes=config.topic_read_model_lag_minutes,
        topic_read_model_recompute_hours=config.topic_read_model_recompute_hours,
        topic_read_model_series_max_topics=config.topic_read_model_series_max_topics,
        topic_read_model_series_min_mentions=config.topic_read_model_series_min_mentions,
        topic_cleanup_interval_seconds=(
            max(0.0, float(args.topic_cleanup_interval_seconds))
            if args.topic_cleanup_interval_seconds is not None
            else config.topic_cleanup_interval_seconds
        ),
        trend_title_enabled=trend_title_config.enabled,
        trend_title_interval_seconds=trend_title_config.interval_seconds,
        trend_title_model=trend_title_config.model_name,
        trend_title_prompt_version=trend_title_config.prompt_version,
        trend_title_max_topics_per_pass=trend_title_config.max_topics_per_pass,
        trend_title_max_duration_seconds=trend_title_config.max_duration_seconds,
        trend_title_timeout_seconds=trend_title_config.request_timeout_seconds,
        trend_title_hash_change_cooldown_hours=trend_title_config.hash_change_cooldown_hours,
        trend_title_retry_after_minutes=trend_title_config.retry_after_minutes,
        trend_title_parallelism=trend_title_config.parallelism,
        trend_enrichment_enabled=trend_enrichment_config.enabled,
        trend_enrichment_interval_seconds=trend_enrichment_config.interval_seconds,
        trend_enrichment_model=trend_enrichment_config.model_name,
        trend_enrichment_prompt_version=trend_enrichment_config.prompt_version,
        trend_enrichment_max_topics_per_pass=trend_enrichment_config.max_topics_per_pass,
        trend_enrichment_max_duration_seconds=trend_enrichment_config.max_duration_seconds,
        trend_enrichment_timeout_seconds=trend_enrichment_config.request_timeout_seconds,
        trend_enrichment_max_retries=trend_enrichment_config.max_retries,
        trend_enrichment_hash_change_cooldown_hours=trend_enrichment_config.hash_change_cooldown_hours,
        trend_enrichment_min_cycles_between_runs=enrichment_min_cycles_between_runs,
        trend_enrichment_defer_backlog_lag_minutes=enrichment_defer_backlog_lag_minutes,
        trend_enrichment_defer_if_cycle_duration_ms=enrichment_defer_if_cycle_duration_ms,
        trend_enrichment_defer_if_cycle_events=enrichment_defer_if_cycle_events,
        trend_enrichment_defer_if_no_ingestion_seconds=enrichment_defer_if_no_ingestion_seconds,
        memecoin_correlation_enabled=memecoin_correlation_config.enabled,
        memecoin_correlation_interval_seconds=memecoin_correlation_config.interval_seconds,
        memecoin_correlation_min_cycles_between_runs=memecoin_correlation_config.min_cycles_between_runs,
        memecoin_correlation_max_results=memecoin_correlation_config.max_results,
        memecoin_correlation_target_published_results=memecoin_correlation_config.target_published_results,
        memecoin_correlation_max_theme_results_per_run=memecoin_correlation_config.max_theme_results_per_run,
        memecoin_correlation_max_seed_queries=memecoin_correlation_config.max_seed_queries,
        memecoin_correlation_max_seeds_per_trend=memecoin_correlation_config.max_seeds_per_trend,
        memecoin_correlation_discovery_expansion_depth=memecoin_correlation_config.discovery_expansion_depth,
        memecoin_correlation_max_discovery_tokens=memecoin_correlation_config.max_discovery_tokens,
        memecoin_correlation_allowed_chains=list(memecoin_correlation_config.allowed_chains),
        memecoin_correlation_min_memecoin_fit_score=memecoin_correlation_config.min_memecoin_fit_score,
        memecoin_correlation_basic_min_liquidity_usd=(
            memecoin_correlation_config.minimum_basic_liquidity_usd
        ),
        memecoin_correlation_basic_min_volume_24h_usd=(
            memecoin_correlation_config.minimum_basic_volume_24h_usd
        ),
        memecoin_correlation_basic_min_txns_24h=(
            memecoin_correlation_config.minimum_basic_txns_24h
        ),
        memecoin_correlation_min_liquidity_usd=memecoin_correlation_config.min_liquidity_usd,
        memecoin_correlation_min_volume_24h_usd=memecoin_correlation_config.min_volume_24h_usd,
        memecoin_correlation_min_txns_24h=memecoin_correlation_config.min_txns_24h,
        memecoin_correlation_new_pair_penalty_hours=memecoin_correlation_config.new_pair_penalty_hours,
        memecoin_correlation_high_confidence_threshold=memecoin_correlation_config.high_confidence_correlation_threshold,
        memecoin_correlation_medium_confidence_threshold=memecoin_correlation_config.medium_confidence_correlation_threshold,
        memecoin_correlation_exploratory_threshold=memecoin_correlation_config.exploratory_correlation_threshold,
        memecoin_correlation_medium_confidence_market_floor=(
            memecoin_correlation_config.medium_confidence_market_floor
        ),
        memecoin_correlation_medium_confidence_memecoin_floor=(
            memecoin_correlation_config.medium_confidence_memecoin_floor
        ),
        memecoin_correlation_exploratory_market_floor=(
            memecoin_correlation_config.exploratory_market_floor
        ),
        memecoin_correlation_exploratory_memecoin_floor=(
            memecoin_correlation_config.exploratory_memecoin_floor
        ),
        memecoin_correlation_recent_repeat_window_runs=memecoin_correlation_config.recent_repeat_penalty_window_runs,
        memecoin_correlation_max_recent_token_appearances=memecoin_correlation_config.max_recent_token_appearances,
        memecoin_correlation_recent_repeat_penalty_per_hit=(
            memecoin_correlation_config.recent_repeat_penalty_per_hit
        ),
        memecoin_correlation_recent_theme_penalty_per_hit=(
            memecoin_correlation_config.recent_theme_penalty_per_hit
        ),
        memecoin_correlation_request_timeout_seconds=memecoin_correlation_config.request_timeout_seconds,
        memecoin_correlation_min_request_spacing_seconds=memecoin_correlation_config.min_request_spacing_seconds,
        memecoin_correlation_max_retries=memecoin_correlation_config.max_retries,
        worker_stale_run_minutes=config.worker_stale_run_minutes,
        worker_heartbeat_interval_seconds=config.worker_heartbeat_interval_seconds,
        worker_heartbeat_stale_seconds=config.worker_heartbeat_stale_seconds,
        processing_stage_max_seconds=config.processing_stage_max_seconds,
        process_max_rows_per_cycle=config.process_max_rows_per_cycle,
        unprocessed_backlog_threshold=config.unprocessed_backlog_threshold,
        aggregate_skip_after_write_stage_seconds=config.aggregate_skip_after_write_stage_seconds,
        raw_retention_hours=config.raw_retention_hours,
        raw_cleanup_interval_seconds=config.raw_cleanup_interval_seconds,
    )
    log_event(
        logger,
        logging.INFO,
        "trend_title_worker_config",
        enabled=trend_title_config.enabled,
        model_name=trend_title_config.model_name,
        prompt_version=trend_title_config.prompt_version,
        interval_seconds=trend_title_config.interval_seconds,
        max_topics=trend_title_config.max_topics,
        max_topics_per_pass=trend_title_config.max_topics_per_pass,
        target_topic_limit=AUTHORITATIVE_TREND_TITLE_TARGET,
        posts_per_topic=trend_title_config.representative_posts,
        candidate_post_limit=trend_title_config.candidate_post_limit,
        max_post_chars=trend_title_config.max_post_chars,
        retry_after_minutes=trend_title_config.retry_after_minutes,
        hash_change_cooldown_hours=trend_title_config.hash_change_cooldown_hours,
        parallelism=trend_title_config.parallelism,
        mode="cheap_authoritative_titles",
    )
    log_event(
        logger,
        logging.WARNING if trend_enrichment_config.enabled else logging.INFO,
        "trend_enrichment_worker_config",
        enabled=trend_enrichment_config.enabled,
        model_name=trend_enrichment_config.model_name,
        prompt_version=trend_enrichment_config.prompt_version,
        interval_seconds=trend_enrichment_config.interval_seconds,
        max_topics=trend_enrichment_config.max_topics,
        max_topics_per_pass=trend_enrichment_config.max_topics_per_pass,
        posts_per_topic=trend_enrichment_config.representative_posts,
        candidate_post_limit=trend_enrichment_config.candidate_post_limit,
        max_post_chars=trend_enrichment_config.max_post_chars,
        retry_after_minutes=trend_enrichment_config.retry_after_minutes,
        hash_change_cooldown_hours=trend_enrichment_config.hash_change_cooldown_hours,
        parallelism=trend_enrichment_config.parallelism,
        mode="high_cost_opt_in" if trend_enrichment_config.enabled else "disabled",
    )
    if trend_enrichment_config.enabled:
        log_event(
            logger,
            logging.WARNING,
            "trend_enrichment_high_cost_mode_enabled",
            model_name=trend_enrichment_config.model_name,
            prompt_version=trend_enrichment_config.prompt_version,
            interval_seconds=trend_enrichment_config.interval_seconds,
            max_topics_per_pass=trend_enrichment_config.max_topics_per_pass,
        )
    record_topic_ai_writer_heartbeat(
        writer_identity=TITLE_WRITER_IDENTITY,
        writer_role=TITLE_WRITER_ROLE,
        enabled=trend_title_config.enabled,
        model_name=trend_title_config.model_name,
        prompt_version=trend_title_config.prompt_version,
        status="idle" if trend_title_config.enabled else "disabled",
        last_reason="worker_start",
    )
    record_topic_ai_writer_heartbeat(
        writer_identity=ENRICHMENT_WRITER_IDENTITY,
        writer_role=ENRICHMENT_WRITER_ROLE,
        enabled=trend_enrichment_config.enabled,
        model_name=trend_enrichment_config.model_name,
        prompt_version=trend_enrichment_config.prompt_version,
        status="idle" if trend_enrichment_config.enabled else "disabled",
        last_reason="worker_start",
    )
    log_topic_ai_writer_diagnostics_if_due(force=True)

    try:
        run_raw_cleanup_if_due(force=True)
        while not stop_requested:
            poll_trend_enrichment_completion()
            poll_memecoin_completion()
            log_topic_ai_writer_diagnostics_if_due()
            if args.max_cycles > 0 and cycle >= args.max_cycles:
                run_status = "completed"
                shutdown_reason = "max_cycles_reached"
                break

            run_raw_cleanup_if_due()

            cycle += 1
            cycle_started = time.monotonic()
            heartbeat_written_at = time.monotonic()
            progress_state: dict[str, Any] = {}
            stage_progress_logged_at = time.monotonic()
            cycle_rows_written = 0
            cycle_backlog_size = 0
            unprocessed_backlog_size: int | None = None
            latest_cycle_processed_write_at: str | None = None
            effective_firehose_max_seconds = config.firehose_window_max_seconds
            effective_firehose_max_events = config.firehose_window_max_events

            def flush_run_progress(
                *,
                force: bool = False,
                active_stage_override: str | None = None,
                stage_counts: dict[str, Any] | None = None,
                rows_inserted_override: int | None = None,
                last_ingestion_write_at_override: str | None = None,
                last_processed_write_at_override: str | None = None,
                last_aggregate_write_at_override: str | None = None,
                rows_written_this_cycle_override: int | None = None,
                latest_source_created_at_override: str | None = None,
                backlog_size_override: int | None = None,
                unprocessed_backlog_size_override: int | None = None,
            ) -> None:
                nonlocal heartbeat_written_at, last_heartbeat_at_iso

                rows_inserted_value = (
                    rows_inserted_total
                    if rows_inserted_override is None
                    else max(0, int(rows_inserted_override))
                )
                rows_written_this_cycle_value = (
                    cycle_rows_written
                    if rows_written_this_cycle_override is None
                    else max(0, int(rows_written_this_cycle_override))
                )
                last_ingestion_write_at_value = (
                    last_ingestion_write_at_iso
                    if last_ingestion_write_at_override is None
                    else last_ingestion_write_at_override
                )
                last_processed_write_at_value = (
                    last_processed_write_at_iso
                    if last_processed_write_at_override is None
                    else last_processed_write_at_override
                )
                last_aggregate_write_at_value = (
                    last_aggregate_write_at_iso
                    if last_aggregate_write_at_override is None
                    else last_aggregate_write_at_override
                )
                latest_source_created_at_value = (
                    latest_source_created_at_iso
                    if latest_source_created_at_override is None
                    else latest_source_created_at_override
                )
                backlog_size_value = (
                    cycle_backlog_size
                    if backlog_size_override is None
                    else max(0, int(backlog_size_override))
                )
                unprocessed_backlog_value = (
                    unprocessed_backlog_size
                    if unprocessed_backlog_size_override is None
                    else max(0, int(unprocessed_backlog_size_override))
                )

                elapsed = time.monotonic() - heartbeat_written_at
                if not force and elapsed < config.worker_heartbeat_interval_seconds:
                    return

                heartbeat_at = _utc_now()
                last_heartbeat_at_iso = heartbeat_at.isoformat()
                notes = _build_run_notes(
                    cycle=cycle,
                    cursor_us=cursor_us,
                    rows_inserted=rows_inserted_value,
                    shutdown_reason=None,
                    state=progress_state or last_state,
                    stats=last_stats,
                    timings=last_timings,
                    last_error=last_error,
                    last_ingestion_write_at=last_ingestion_write_at_value,
                    last_aggregate_write_at=last_aggregate_write_at_value,
                    last_enrichment_write_at=last_enrichment_write_at_iso,
                    enrichment_status=(
                        (last_enrichment_summary or {}).get("status")
                        if isinstance(last_enrichment_summary, dict)
                        else None
                    ),
                    enrichment_backlog_size=(
                        (last_enrichment_summary or {}).get("deferred_topics")
                        if isinstance(last_enrichment_summary, dict)
                        else None
                    ),
                    active_stage=active_stage_override or active_stage,
                    stage_counts=stage_counts,
                    latest_source_created_at=latest_source_created_at_value,
                    last_heartbeat_at=last_heartbeat_at_iso,
                    rows_written_this_cycle=rows_written_this_cycle_value,
                    last_successful_write_at=last_ingestion_write_at_value,
                    max_source_timestamp_seen=latest_source_created_at_value,
                    max_written_timestamp=last_ingestion_write_at_value,
                    max_processed_timestamp=last_processed_write_at_value,
                    max_aggregate_timestamp=last_aggregate_write_at_value,
                    pipeline_lag_seconds=_pipeline_lag_seconds(last_ingestion_write_at_value),
                    backlog_size=backlog_size_value,
                    unprocessed_backlog_size=unprocessed_backlog_value,
                    last_memecoin_write_at=last_memecoin_write_at_iso,
                    memecoin_status=(
                        (last_memecoin_summary or {}).get("status")
                        if isinstance(last_memecoin_summary, dict)
                        else None
                    ),
                    memecoin_summary=last_memecoin_summary if isinstance(last_memecoin_summary, dict) else None,
                )
                try:
                    store.update_ingestion_run(
                        source=source,
                        started_at=started_at,
                        status="running",
                        rows_inserted=rows_inserted_value,
                        notes=notes,
                        last_heartbeat_at=heartbeat_at,
                        current_stage=active_stage_override or active_stage,
                        rows_written_this_cycle=rows_written_this_cycle_value,
                        last_successful_write_at=_parse_iso_datetime(last_ingestion_write_at_value),
                    )
                    heartbeat_written_at = time.monotonic()
                except Exception as update_error:
                    log_event(
                        logger,
                        logging.ERROR,
                        "progress_update_failed",
                        cycle=cycle,
                        error=str(update_error),
                    )

            def write_progress(progress: dict[str, Any]) -> None:
                nonlocal cursor_us, progress_state
                progress_state = dict(progress or {})
                candidate_cursor = _parse_cursor(progress_state.get("cursor"))
                if candidate_cursor is not None:
                    cursor_us = candidate_cursor

                flush_run_progress(
                    active_stage_override="fetch",
                    stage_counts={
                        "cursor": cursor_us or 0,
                        "last_sync_events": int(progress_state.get("lastSyncEvents") or 0),
                    },
                )

            def log_cycle_stage(
                *,
                stage: str,
                status: str,
                started_monotonic: float,
                level: int = logging.INFO,
                **fields: Any,
            ) -> None:
                duration_ms = round((time.monotonic() - started_monotonic) * 1000, 1)
                log_event(
                    logger,
                    level,
                    "cycle_stage",
                    cycle=cycle,
                    stage=stage,
                    status=status,
                    duration_ms=duration_ms,
                    **fields,
                )

            def log_stage_progress(stage: str, payload: dict[str, Any]) -> None:
                nonlocal stage_progress_logged_at
                if (time.monotonic() - stage_progress_logged_at) < config.progress_update_seconds:
                    return
                log_event(
                    logger,
                    logging.INFO,
                    "cycle_stage_progress",
                    cycle=cycle,
                    stage=stage,
                    **payload,
                )
                stage_progress_logged_at = time.monotonic()

            def normalize_event_safe(
                event: dict[str, Any],
                *,
                ingested_at: datetime,
            ) -> tuple[dict[str, Any] | None, str | None]:
                try:
                    return normalizeIncomingEvent(event, ingested_at=ingested_at), None
                except Exception as parse_error:
                    return None, str(parse_error)

            def build_processed_payload_safe(
                raw_row: dict[str, Any],
            ) -> tuple[dict[str, Any] | None, str | None]:
                try:
                    return (
                        buildProcessedPostPayload(
                            raw_row=raw_row,
                            processed_at=_utc_now(),
                        ),
                        None,
                    )
                except Exception as processing_error:
                    return None, str(processing_error)

            active_stage = "idle"
            log_event(
                logger,
                logging.INFO,
                "cycle_start",
                cycle=cycle,
                cursor_us=cursor_us or 0,
            )

            try:
                backlog_count_before_fetch: int | None = None
                try:
                    backlog_count_before_fetch = store.count_unprocessed_raw_posts()
                    unprocessed_backlog_size = backlog_count_before_fetch
                except Exception as backlog_error:
                    log_event(
                        logger,
                        logging.WARNING,
                        "raw_backlog_count_failed",
                        cycle=cycle,
                        error=str(backlog_error),
                    )

                backlog_pressured = bool(
                    backlog_count_before_fetch is not None
                    and backlog_count_before_fetch >= config.unprocessed_backlog_threshold
                )
                if backlog_pressured:
                    effective_firehose_max_seconds = min(
                        config.firehose_window_max_seconds,
                        config.backlog_firehose_window_max_seconds,
                    )
                    effective_firehose_max_events = min(
                        config.firehose_window_max_events,
                        config.backlog_firehose_window_max_events,
                    )
                    log_event(
                        logger,
                        logging.WARNING,
                        "backlog_pressure_detected",
                        cycle=cycle,
                        unprocessed_backlog_size=backlog_count_before_fetch,
                        backlog_threshold=config.unprocessed_backlog_threshold,
                        fetch_max_seconds=effective_firehose_max_seconds,
                        fetch_max_events=effective_firehose_max_events,
                    )

                active_stage = "fetch"
                fetch_stage_started = time.monotonic()
                log_event(
                    logger,
                    logging.INFO,
                    "cycle_stage_start",
                    cycle=cycle,
                    stage="fetch",
                    cursor_us=cursor_us or 0,
                    max_seconds=effective_firehose_max_seconds,
                    max_events=effective_firehose_max_events,
                    backlog_pressured=backlog_pressured,
                    unprocessed_backlog_size=backlog_count_before_fetch,
                )
                flush_run_progress(
                    force=True,
                    active_stage_override="fetch",
                    stage_counts={
                        "max_seconds": effective_firehose_max_seconds,
                        "max_events": effective_firehose_max_events,
                        "backlog_pressured": backlog_pressured,
                        "unprocessed_backlog_size": backlog_count_before_fetch,
                    },
                    unprocessed_backlog_size_override=backlog_count_before_fetch,
                )
                result = run_firehose_window(
                    cursor_us=cursor_us,
                    max_seconds=effective_firehose_max_seconds,
                    max_events=effective_firehose_max_events,
                    progress_callback=write_progress,
                )
                fetch_completed_at = _utc_now()
                posts = list(result.get("posts") or [])
                profiles = list(result.get("profiles") or [])
                state = dict(result.get("state") or {})
                stats = dict(result.get("stats") or {})
                timings = dict(result.get("timings") or {})
                log_cycle_stage(
                    stage="fetch",
                    status="succeeded",
                    started_monotonic=fetch_stage_started,
                    posts_fetched=len(posts),
                    profiles_fetched=len(profiles),
                    events_processed=int(state.get("lastSyncEvents") or 0),
                    health_status=state.get("healthStatus"),
                    connection_status=state.get("connectionStatus"),
                    last_event_at=state.get("lastEventAt"),
                )

                active_stage = "parse"
                parse_stage_started = time.monotonic()
                log_event(
                    logger,
                    logging.INFO,
                    "cycle_stage_start",
                    cycle=cycle,
                    stage="parse",
                    posts_input=len(posts),
                    parallel_workers=config.parse_workers if transform_executor is not None else 1,
                )
                flush_run_progress(
                    force=True,
                    active_stage_override="parse",
                    stage_counts={
                        "posts_input": len(posts),
                    },
                    unprocessed_backlog_size_override=unprocessed_backlog_size,
                )
                parsed_events: list[dict[str, Any]] = []
                parse_dropped = 0
                parse_errors = 0
                if transform_executor is not None and len(posts) >= config.parse_parallel_min_posts:
                    parse_results = list(
                        transform_executor.map(
                            lambda event: normalize_event_safe(event, ingested_at=fetch_completed_at),
                            posts,
                        )
                    )
                else:
                    parse_results = [
                        normalize_event_safe(event, ingested_at=fetch_completed_at) for event in posts
                    ]
                for normalized_event, parse_error in parse_results:
                    if parse_error:
                        parse_errors += 1
                        log_event(
                            logger,
                            logging.ERROR,
                            "parse_event_failed",
                            cycle=cycle,
                            error=parse_error,
                        )
                    if not normalized_event:
                        parse_dropped += 1
                        continue
                    parsed_events.append(normalized_event)
                latest_source_created_at_iso = (
                    _max_iso_timestamp(*(event.get("created_at") for event in parsed_events))
                    or latest_source_created_at_iso
                )
                log_cycle_stage(
                    stage="parse",
                    status="succeeded",
                    started_monotonic=parse_stage_started,
                    posts_parsed=len(parsed_events),
                    posts_dropped=parse_dropped,
                    parse_errors=parse_errors,
                )

                active_stage = "dedupe"
                dedupe_stage_started = time.monotonic()
                log_event(
                    logger,
                    logging.INFO,
                    "cycle_stage_start",
                    cycle=cycle,
                    stage="dedupe",
                    parsed_posts=len(parsed_events),
                )
                flush_run_progress(
                    force=True,
                    active_stage_override="dedupe",
                    stage_counts={
                        "parsed_posts": len(parsed_events),
                    },
                    unprocessed_backlog_size_override=unprocessed_backlog_size,
                )
                normalized_by_source_id: dict[str, dict[str, Any]] = {}
                dedupe_dropped = 0
                dedupe_missing_source = 0
                for normalized_event in parsed_events:
                    source_id = str(
                        normalized_event.get("source_post_id")
                        or normalized_event.get("post_id")
                        or ""
                    ).strip()
                    if not source_id:
                        dedupe_missing_source += 1
                        continue
                    if source_id in normalized_by_source_id:
                        dedupe_dropped += 1
                    normalized_by_source_id[source_id] = normalized_event
                normalized_events = list(normalized_by_source_id.values())
                log_cycle_stage(
                    stage="dedupe",
                    status="succeeded",
                    started_monotonic=dedupe_stage_started,
                    input_posts=len(parsed_events),
                    output_posts=len(normalized_events),
                    duplicates_dropped=dedupe_dropped,
                    missing_source_id=dedupe_missing_source,
                )

                author_rows = normalize_authors_for_authors_table(
                    profiles=profiles,
                    posts=posts,
                    observed_at=fetch_completed_at,
                )

                active_stage = "write_raw"
                write_raw_stage_started = time.monotonic()
                log_event(
                    logger,
                    logging.INFO,
                    "cycle_stage_start",
                    cycle=cycle,
                    stage="write_raw",
                    deduped_posts=len(normalized_events),
                    author_rows=len(author_rows),
                )
                flush_run_progress(
                    force=True,
                    active_stage_override="write_raw",
                    stage_counts={
                        "deduped_posts": len(normalized_events),
                        "author_rows": len(author_rows),
                    },
                    unprocessed_backlog_size_override=unprocessed_backlog_size,
                )
                raw_rows_to_write = [
                    {
                        **normalized_event,
                        "ingested_at": _utc_now(),
                    }
                    for normalized_event in normalized_events
                ]
                ingested_raw_rows: list[dict[str, Any]] = []
                raw_write_errors = 0
                try:
                    store.upsert_raw_posts(raw_rows_to_write)
                    ingested_raw_rows = store.fetch_raw_posts_by_source_ids(
                        platform="bluesky",
                        source_post_ids=normalized_by_source_id.keys(),
                    )
                except Exception as raw_batch_error:
                    log_event(
                        logger,
                        logging.ERROR,
                        "raw_write_batch_failed",
                        cycle=cycle,
                        attempted_rows=len(raw_rows_to_write),
                        error=str(raw_batch_error),
                    )
                    for normalized_event in raw_rows_to_write:
                        try:
                            ingested_raw = ingestRawPost(
                                store=store,
                                normalized_event=normalized_event,
                            )
                            if ingested_raw:
                                ingested_raw_rows.append(ingested_raw)
                        except Exception as raw_row_error:
                            raw_write_errors += 1
                            log_event(
                                logger,
                                logging.ERROR,
                                "raw_write_row_failed",
                                cycle=cycle,
                                source_post_id=normalized_event.get("source_post_id"),
                                error=str(raw_row_error),
                            )

                raw_rows_by_id = {
                    int(row.get("id")): row
                    for row in ingested_raw_rows
                    if row.get("id") not in {None, 0}
                }
                inserted_posts = len(ingested_raw_rows)
                cycle_rows_written = inserted_posts
                rows_inserted_total += inserted_posts
                latest_cycle_ingestion_write_at = (
                    _max_iso_timestamp(*(row.get("ingested_at") for row in ingested_raw_rows))
                    or last_ingestion_write_at_iso
                )
                latest_source_created_at_iso = (
                    _max_iso_timestamp(*(row.get("created_at") for row in ingested_raw_rows))
                    or latest_source_created_at_iso
                )
                if latest_cycle_ingestion_write_at:
                    last_ingestion_write_at_iso = latest_cycle_ingestion_write_at
                    last_ingestion_write_at_monotonic = time.monotonic()

                upserted_authors = 0
                try:
                    if author_rows:
                        upserted_authors = store.upsert_authors(author_rows)
                except Exception as author_error:
                    log_event(
                        logger,
                        logging.ERROR,
                        "author_upsert_failed",
                        cycle=cycle,
                        attempted_rows=len(author_rows),
                        error=str(author_error),
                    )

                try:
                    unprocessed_backlog_size = store.count_unprocessed_raw_posts()
                except Exception as backlog_error:
                    log_event(
                        logger,
                        logging.WARNING,
                        "raw_backlog_count_failed",
                        cycle=cycle,
                        stage="write_raw",
                        error=str(backlog_error),
                    )
                cycle_backlog_size = max(0, len(normalized_events) - inserted_posts)
                flush_run_progress(
                    force=True,
                    active_stage_override="write_raw",
                    stage_counts={
                        "posts_seen": len(normalized_events),
                        "posts_inserted": inserted_posts,
                        "raw_write_errors": raw_write_errors,
                        "authors_upserted": upserted_authors,
                    },
                    rows_inserted_override=rows_inserted_total,
                    rows_written_this_cycle_override=cycle_rows_written,
                    last_ingestion_write_at_override=last_ingestion_write_at_iso,
                    latest_source_created_at_override=latest_source_created_at_iso,
                    backlog_size_override=cycle_backlog_size,
                    unprocessed_backlog_size_override=unprocessed_backlog_size,
                )
                log_cycle_stage(
                    stage="write_raw",
                    status="succeeded",
                    started_monotonic=write_raw_stage_started,
                    posts_inserted=inserted_posts,
                    raw_write_errors=raw_write_errors,
                    authors_upserted=upserted_authors,
                    unprocessed_backlog_size=unprocessed_backlog_size,
                )

                active_stage = "write_processed"
                write_processed_stage_started = time.monotonic()
                processing_limit = max(1, config.process_max_rows_per_cycle)
                log_event(
                    logger,
                    logging.INFO,
                    "cycle_stage_start",
                    cycle=cycle,
                    stage="write_processed",
                    process_limit=processing_limit,
                    newest_first=backlog_pressured,
                    unprocessed_backlog_size=unprocessed_backlog_size,
                )
                flush_run_progress(
                    force=True,
                    active_stage_override="write_processed",
                    stage_counts={
                        "process_limit": processing_limit,
                        "newest_first": backlog_pressured,
                        "unprocessed_backlog_size": unprocessed_backlog_size,
                    },
                    rows_written_this_cycle_override=cycle_rows_written,
                    last_ingestion_write_at_override=last_ingestion_write_at_iso,
                    unprocessed_backlog_size_override=unprocessed_backlog_size,
                )
                raw_rows_for_processing = store.fetch_raw_posts_for_processing(
                    limit=processing_limit,
                    newest_first=backlog_pressured,
                )
                processed_payloads: list[dict[str, Any]] = []
                processed_payload_build_errors = 0
                if (
                    transform_executor is not None
                    and len(raw_rows_for_processing) >= config.parse_parallel_min_posts
                ):
                    processed_build_results = list(transform_executor.map(build_processed_payload_safe, raw_rows_for_processing))
                else:
                    processed_build_results = [
                        build_processed_payload_safe(raw_row) for raw_row in raw_rows_for_processing
                    ]
                processing_errors = 0
                for raw_row, build_result in zip(raw_rows_for_processing, processed_build_results):
                    payload, build_error = build_result
                    if build_error:
                        processed_payload_build_errors += 1
                        processing_errors += 1
                        log_event(
                            logger,
                            logging.ERROR,
                            "build_processed_payload_failed",
                            cycle=cycle,
                            raw_post_id=raw_row.get("id"),
                            source_post_id=raw_row.get("source_post_id"),
                            error=build_error,
                        )
                        continue
                    if payload is not None:
                        processed_payloads.append(payload)

                processed_posts = 0
                post_topics_persisted = 0
                processing_deferred_reason: str | None = None
                topic_rows_buffer: list[dict[str, Any]] = []
                for offset in range(0, len(processed_payloads), config.batch_size):
                    if (time.monotonic() - write_processed_stage_started) >= config.processing_stage_max_seconds:
                        processing_deferred_reason = "write_duration_guard"
                        break

                    payload_chunk = processed_payloads[offset : offset + config.batch_size]
                    processed_chunk_rows: list[dict[str, Any]] = []
                    try:
                        processed_chunk_rows = store.upsert_processed_posts(payload_chunk)
                    except Exception as processed_batch_error:
                        log_event(
                            logger,
                            logging.ERROR,
                            "processed_write_batch_failed",
                            cycle=cycle,
                            attempted_rows=len(payload_chunk),
                            error=str(processed_batch_error),
                        )
                        for payload in payload_chunk:
                            try:
                                processed_row = store.upsert_processed_post_record(payload)
                                if processed_row:
                                    processed_row["topic_records"] = list(payload.get("topic_records") or [])
                                    processed_chunk_rows.append(processed_row)
                            except Exception as processed_row_error:
                                processing_errors += 1
                                log_event(
                                    logger,
                                    logging.ERROR,
                                    "processed_write_row_failed",
                                    cycle=cycle,
                                    raw_post_id=payload.get("raw_post_id"),
                                    source_post_id=payload.get("source_post_id"),
                                    error=str(processed_row_error),
                                )

                    processed_posts += len(processed_chunk_rows)
                    for processed_row in processed_chunk_rows:
                        latest_cycle_processed_write_at = (
                            _to_iso_timestamp(processed_row.get("processed_at"))
                            or latest_cycle_processed_write_at
                        )
                        raw_row = raw_rows_by_id.get(int(processed_row.get("raw_post_id") or 0))
                        if raw_row is None:
                            continue
                        topic_rows_buffer.extend(
                            buildPostTopicRows(
                                raw_row=raw_row,
                                processed_row=processed_row,
                                created_at=processed_row.get("processed_at") or _utc_now(),
                            )
                        )

                    if topic_rows_buffer:
                        try:
                            post_topics_persisted += store.persist_post_topics(topic_rows_buffer)
                        except Exception as topic_batch_error:
                            log_event(
                                logger,
                                logging.ERROR,
                                "post_topic_batch_failed",
                                cycle=cycle,
                                attempted_rows=len(topic_rows_buffer),
                                error=str(topic_batch_error),
                            )
                            for topic_row in topic_rows_buffer:
                                try:
                                    post_topics_persisted += store.persist_post_topics([topic_row])
                                except Exception as topic_row_error:
                                    processing_errors += 1
                                    log_event(
                                        logger,
                                        logging.ERROR,
                                        "post_topic_row_failed",
                                        cycle=cycle,
                                        raw_post_id=topic_row.get("raw_post_id"),
                                        normalized_topic=topic_row.get("normalized_topic"),
                                        error=str(topic_row_error),
                                    )
                        finally:
                            topic_rows_buffer = []

                    if latest_cycle_processed_write_at:
                        last_processed_write_at_iso = latest_cycle_processed_write_at

                    stage_progress_payload = {
                        "posts_selected": len(raw_rows_for_processing),
                        "payloads_built": len(processed_payloads),
                        "payload_build_errors": processed_payload_build_errors,
                        "posts_processed": processed_posts,
                        "post_topics_persisted": post_topics_persisted,
                        "processing_errors": processing_errors,
                        "rows_written_this_cycle": cycle_rows_written,
                        "last_ingestion_write_at": last_ingestion_write_at_iso,
                        "last_processed_write_at": last_processed_write_at_iso,
                        "backlog_size": max(0, len(normalized_events) - processed_posts),
                        "unprocessed_backlog_size": unprocessed_backlog_size,
                    }
                    log_stage_progress("write_processed", stage_progress_payload)
                    flush_run_progress(
                        active_stage_override="write_processed",
                        stage_counts=stage_progress_payload,
                        rows_inserted_override=rows_inserted_total,
                        rows_written_this_cycle_override=cycle_rows_written,
                        last_ingestion_write_at_override=last_ingestion_write_at_iso,
                        last_processed_write_at_override=last_processed_write_at_iso,
                        latest_source_created_at_override=latest_source_created_at_iso,
                        backlog_size_override=stage_progress_payload["backlog_size"],
                        unprocessed_backlog_size_override=unprocessed_backlog_size,
                    )

                try:
                    unprocessed_backlog_size = store.count_unprocessed_raw_posts()
                except Exception as backlog_error:
                    log_event(
                        logger,
                        logging.WARNING,
                        "raw_backlog_count_failed",
                        cycle=cycle,
                        stage="write_processed",
                        error=str(backlog_error),
                    )
                cycle_backlog_size = max(0, len(normalized_events) - processed_posts)
                flush_run_progress(
                    force=True,
                    active_stage_override="write_processed",
                    stage_counts={
                        "posts_selected": len(raw_rows_for_processing),
                        "payloads_built": len(processed_payloads),
                        "payload_build_errors": processed_payload_build_errors,
                        "posts_processed": processed_posts,
                        "post_topics_persisted": post_topics_persisted,
                        "processing_errors": processing_errors,
                        "processing_deferred_reason": processing_deferred_reason,
                    },
                    rows_inserted_override=rows_inserted_total,
                    rows_written_this_cycle_override=cycle_rows_written,
                    last_ingestion_write_at_override=last_ingestion_write_at_iso,
                    last_processed_write_at_override=last_processed_write_at_iso,
                    latest_source_created_at_override=latest_source_created_at_iso,
                    backlog_size_override=cycle_backlog_size,
                    unprocessed_backlog_size_override=unprocessed_backlog_size,
                )
                log_cycle_stage(
                    stage="write_processed",
                    status="deferred" if processing_deferred_reason else "succeeded",
                    started_monotonic=write_processed_stage_started,
                    posts_selected=len(raw_rows_for_processing),
                    payloads_built=len(processed_payloads),
                    payload_build_errors=processed_payload_build_errors,
                    posts_processed=processed_posts,
                    post_topics_persisted=post_topics_persisted,
                    processing_errors=processing_errors,
                    processing_deferred_reason=processing_deferred_reason,
                    unprocessed_backlog_size=unprocessed_backlog_size,
                )

                candidate_cursor = _parse_cursor(state.get("cursor"))
                if candidate_cursor is not None:
                    cursor_us = candidate_cursor

                last_state = state
                last_stats = stats
                last_timings = timings
                last_error = None

                cycle_duration_ms = round((time.monotonic() - cycle_started) * 1000, 1)
                write_stage_duration_seconds = (
                    round((time.monotonic() - write_raw_stage_started), 3)
                    if "write_raw_stage_started" in locals()
                    else 0.0
                )
                skip_aggregation_reason: str | None = None
                if processing_deferred_reason:
                    skip_aggregation_reason = processing_deferred_reason
                elif write_stage_duration_seconds >= config.aggregate_skip_after_write_stage_seconds:
                    skip_aggregation_reason = "write_duration_guard"
                elif (
                    unprocessed_backlog_size is not None
                    and unprocessed_backlog_size >= config.unprocessed_backlog_threshold
                ):
                    skip_aggregation_reason = "backlog_guard"
                active_stage = "aggregate"
                aggregate_stage_started = time.monotonic()
                if skip_aggregation_reason:
                    aggregate_outcome = {
                        "executed": False,
                        "status": "deferred",
                        "reason": skip_aggregation_reason,
                    }
                else:
                    aggregate_outcome = run_topic_aggregation_if_due(reason="cycle_complete")
                aggregate_status = str(aggregate_outcome.get("status") or "unknown")
                aggregate_level = logging.INFO if aggregate_status in {"succeeded", "deferred", "skipped"} else logging.ERROR
                flush_run_progress(
                    force=True,
                    active_stage_override="aggregate",
                    stage_counts={
                        "reason": aggregate_outcome.get("reason"),
                        "executed": bool(aggregate_outcome.get("executed")),
                    },
                    rows_written_this_cycle_override=cycle_rows_written,
                    last_ingestion_write_at_override=last_ingestion_write_at_iso,
                    last_processed_write_at_override=last_processed_write_at_iso,
                    unprocessed_backlog_size_override=unprocessed_backlog_size,
                )
                log_cycle_stage(
                    stage="aggregate",
                    status=aggregate_status,
                    started_monotonic=aggregate_stage_started,
                    level=aggregate_level,
                    reason=aggregate_outcome.get("reason"),
                    executed=bool(aggregate_outcome.get("executed")),
                    stable_fact_rows=aggregate_outcome.get("stable_fact_rows"),
                    stable_cleanup_rows=aggregate_outcome.get("stable_cleanup_rows"),
                    refreshed_at=aggregate_outcome.get("refreshed_at"),
                    error=aggregate_outcome.get("error"),
                    write_stage_duration_seconds=write_stage_duration_seconds,
                )

                backlog_lag_minutes: float | None = None
                try:
                    backlog_lag_minutes = float(state.get("backlogLagMinutes"))
                except (TypeError, ValueError):
                    backlog_lag_minutes = None
                active_stage = "title"
                title_stage_started = time.monotonic()
                title_outcome = run_trend_title_generation_if_due(
                    reason="cycle_complete",
                )
                title_status = str(title_outcome.get("status") or "unknown")
                title_level = (
                    logging.INFO
                    if title_status in {"succeeded", "deferred", "skipped", "scheduled", "running"}
                    else logging.ERROR
                )
                title_summary = title_outcome.get("summary")
                flush_run_progress(
                    force=True,
                    active_stage_override="title",
                    stage_counts={
                        "reason": title_outcome.get("reason"),
                        "status": title_status,
                    },
                    rows_written_this_cycle_override=cycle_rows_written,
                    last_ingestion_write_at_override=last_ingestion_write_at_iso,
                    last_processed_write_at_override=last_processed_write_at_iso,
                    unprocessed_backlog_size_override=unprocessed_backlog_size,
                )
                log_cycle_stage(
                    stage="title",
                    status=title_status,
                    started_monotonic=title_stage_started,
                    level=title_level,
                    reason=title_outcome.get("reason"),
                    executed=bool(title_outcome.get("executed")),
                    deferred_at=title_outcome.get("deferred_at"),
                    last_success_at=title_outcome.get("last_success_at"),
                    attempted_topics=(title_summary or {}).get("attempted_topics") if isinstance(title_summary, dict) else None,
                    deferred_topics=(title_summary or {}).get("deferred_topics") if isinstance(title_summary, dict) else None,
                    error=title_outcome.get("error"),
                )

                active_stage = "enrich"
                enrich_stage_started = time.monotonic()
                enrichment_outcome = run_trend_enrichment_if_due(
                    reason="cycle_complete",
                    cycle_duration_ms=cycle_duration_ms,
                    cycle_events_processed=int(state.get("lastSyncEvents") or 0),
                    backlog_lag_minutes=backlog_lag_minutes,
                )
                enrichment_status = str(enrichment_outcome.get("status") or "unknown")
                enrichment_level = (
                    logging.INFO
                    if enrichment_status in {"succeeded", "deferred", "skipped", "scheduled", "running"}
                    else logging.ERROR
                )
                enrichment_summary = enrichment_outcome.get("summary")
                flush_run_progress(
                    force=True,
                    active_stage_override="enrich",
                    stage_counts={
                        "reason": enrichment_outcome.get("reason"),
                        "status": enrichment_status,
                    },
                    rows_written_this_cycle_override=cycle_rows_written,
                    last_ingestion_write_at_override=last_ingestion_write_at_iso,
                    last_processed_write_at_override=last_processed_write_at_iso,
                    unprocessed_backlog_size_override=unprocessed_backlog_size,
                )
                log_cycle_stage(
                    stage="enrich",
                    status=enrichment_status,
                    started_monotonic=enrich_stage_started,
                    level=enrichment_level,
                    reason=enrichment_outcome.get("reason"),
                    executed=bool(enrichment_outcome.get("executed")),
                    deferred_at=enrichment_outcome.get("deferred_at"),
                    last_success_at=enrichment_outcome.get("last_success_at"),
                    attempted_topics=(enrichment_summary or {}).get("attempted_topics") if isinstance(enrichment_summary, dict) else None,
                    deferred_topics=(enrichment_summary or {}).get("deferred_topics") if isinstance(enrichment_summary, dict) else None,
                    error=enrichment_outcome.get("error"),
                )

                active_stage = "memecoin_correlate"
                memecoin_stage_started = time.monotonic()
                memecoin_outcome = run_memecoin_correlation_if_due(
                    reason="cycle_complete",
                    cycle_duration_ms=cycle_duration_ms,
                    cycle_events_processed=int(state.get("lastSyncEvents") or 0),
                    backlog_lag_minutes=backlog_lag_minutes,
                )
                memecoin_status = str(memecoin_outcome.get("status") or "unknown")
                memecoin_level = (
                    logging.INFO
                    if memecoin_status in {"succeeded", "deferred", "skipped", "scheduled", "running"}
                    else logging.ERROR
                )
                memecoin_summary = memecoin_outcome.get("summary")
                flush_run_progress(
                    force=True,
                    active_stage_override="memecoin_correlate",
                    stage_counts={
                        "reason": memecoin_outcome.get("reason"),
                        "status": memecoin_status,
                    },
                    rows_written_this_cycle_override=cycle_rows_written,
                    last_ingestion_write_at_override=last_ingestion_write_at_iso,
                    last_processed_write_at_override=last_processed_write_at_iso,
                    unprocessed_backlog_size_override=unprocessed_backlog_size,
                )
                log_cycle_stage(
                    stage="memecoin_correlate",
                    status=memecoin_status,
                    started_monotonic=memecoin_stage_started,
                    level=memecoin_level,
                    reason=memecoin_outcome.get("reason"),
                    executed=bool(memecoin_outcome.get("executed")),
                    deferred_at=memecoin_outcome.get("deferred_at"),
                    last_success_at=memecoin_outcome.get("last_success_at"),
                    published_result_count=(
                        (memecoin_summary or {}).get("published_result_count")
                        if isinstance(memecoin_summary, dict)
                        else memecoin_outcome.get("published_result_count")
                    ),
                    discovery_token_count=(
                        (memecoin_summary or {}).get("discovery_token_count")
                        if isinstance(memecoin_summary, dict)
                        else memecoin_outcome.get("discovery_token_count")
                    ),
                    error=memecoin_outcome.get("error"),
                )
                active_stage = "complete"
                cycle_duration_ms = round((time.monotonic() - cycle_started) * 1000, 1)
                pipeline_lag_seconds = _pipeline_lag_seconds(last_ingestion_write_at_iso)
                last_heartbeat_at_iso = _utc_now().isoformat()
                notes = _build_run_notes(
                    cycle=cycle,
                    cursor_us=cursor_us,
                    rows_inserted=rows_inserted_total,
                    shutdown_reason=None,
                    state=state,
                    stats=stats,
                    timings=timings,
                    last_error=None,
                    last_ingestion_write_at=last_ingestion_write_at_iso,
                    last_aggregate_write_at=last_aggregate_write_at_iso,
                    last_enrichment_write_at=last_enrichment_write_at_iso,
                    enrichment_status=enrichment_status,
                    enrichment_backlog_size=(
                        enrichment_summary.get("deferred_topics")
                        if isinstance(enrichment_summary, dict)
                        else None
                    ),
                    active_stage="complete",
                    stage_counts={
                        "posts_normalized": len(normalized_events),
                        "posts_inserted": inserted_posts,
                        "posts_processed": processed_posts,
                        "post_topics_persisted": post_topics_persisted,
                        "processing_errors": processing_errors,
                        "payload_build_errors": processed_payload_build_errors,
                    },
                    latest_source_created_at=latest_source_created_at_iso,
                    last_heartbeat_at=last_heartbeat_at_iso,
                    rows_written_this_cycle=cycle_rows_written,
                    last_successful_write_at=last_ingestion_write_at_iso,
                    max_source_timestamp_seen=latest_source_created_at_iso,
                    max_written_timestamp=last_ingestion_write_at_iso,
                    max_processed_timestamp=last_processed_write_at_iso,
                    max_aggregate_timestamp=last_aggregate_write_at_iso,
                    pipeline_lag_seconds=pipeline_lag_seconds,
                    backlog_size=cycle_backlog_size,
                    unprocessed_backlog_size=unprocessed_backlog_size,
                    last_memecoin_write_at=last_memecoin_write_at_iso,
                    memecoin_status=(
                        (last_memecoin_summary or {}).get("status")
                        if isinstance(last_memecoin_summary, dict)
                        else None
                    ),
                    memecoin_summary=last_memecoin_summary if isinstance(last_memecoin_summary, dict) else None,
                )
                store.update_ingestion_run(
                    source=source,
                    started_at=started_at,
                    status="running",
                    rows_inserted=rows_inserted_total,
                    notes=notes,
                    last_heartbeat_at=_parse_iso_datetime(last_heartbeat_at_iso),
                    current_stage="complete",
                    rows_written_this_cycle=cycle_rows_written,
                    last_successful_write_at=_parse_iso_datetime(last_ingestion_write_at_iso),
                )

                log_event(
                    logger,
                    logging.INFO,
                    "cycle_pipeline_metrics",
                    cycle=cycle,
                    max_source_timestamp_seen=latest_source_created_at_iso,
                    max_written_timestamp=last_ingestion_write_at_iso,
                    max_processed_timestamp=last_processed_write_at_iso,
                    max_aggregate_timestamp=last_aggregate_write_at_iso,
                    pipeline_lag_seconds=pipeline_lag_seconds,
                    backlog_size=cycle_backlog_size,
                    unprocessed_backlog_size=unprocessed_backlog_size,
                    worker_heartbeat_at=last_heartbeat_at_iso,
                )

                log_event(
                    logger,
                    logging.INFO,
                    "cycle_complete",
                    cycle=cycle,
                    events_processed=int(state.get("lastSyncEvents") or 0),
                    posts_normalized=len(normalized_events),
                    posts_inserted=inserted_posts,
                    posts_processed=processed_posts,
                    post_topics_persisted=post_topics_persisted,
                    processing_errors=processing_errors,
                    authors_upserted=upserted_authors,
                    rows_inserted_total=rows_inserted_total,
                    rows_written_this_cycle=cycle_rows_written,
                    cursor_us=cursor_us or 0,
                    health_status=state.get("healthStatus"),
                    connection_status=state.get("connectionStatus"),
                    duration_ms=cycle_duration_ms,
                    last_ingestion_write_at=last_ingestion_write_at_iso,
                    last_processed_write_at=last_processed_write_at_iso,
                    last_aggregate_write_at=last_aggregate_write_at_iso,
                    last_title_write_at=last_title_write_at_iso,
                    last_enrichment_write_at=last_enrichment_write_at_iso,
                    title_status=title_status,
                    title_deferred=not bool(title_outcome.get("executed")),
                    title_defer_reason=(
                        title_outcome.get("reason")
                        if not bool(title_outcome.get("executed"))
                        else None
                    ),
                    pipeline_lag_seconds=pipeline_lag_seconds,
                    backlog_size=cycle_backlog_size,
                    unprocessed_backlog_size=unprocessed_backlog_size,
                    enrichment_status=enrichment_status,
                    enrichment_deferred=not bool(enrichment_outcome.get("executed")),
                    enrichment_defer_reason=(
                        enrichment_outcome.get("reason")
                        if not bool(enrichment_outcome.get("executed"))
                        else None
                    ),
                    enrichment_backlog_size=(
                        enrichment_summary.get("deferred_topics")
                        if isinstance(enrichment_summary, dict)
                        else None
                    ),
                    memecoin_status=memecoin_status,
                    memecoin_deferred=not bool(memecoin_outcome.get("executed")),
                    memecoin_defer_reason=(
                        memecoin_outcome.get("reason")
                        if not bool(memecoin_outcome.get("executed"))
                        else None
                    ),
                    memecoin_published_result_count=(
                        (memecoin_summary or {}).get("published_result_count")
                        if isinstance(memecoin_summary, dict)
                        else memecoin_outcome.get("published_result_count")
                    ),
                )
            except KeyboardInterrupt:
                stop_requested = True
                run_status = "stopped"
                shutdown_reason = "keyboard_interrupt"
                break
            except Exception as error:
                last_error = str(error)
                log_event(
                    logger,
                    logging.ERROR,
                    "cycle_stage",
                    cycle=cycle,
                    stage=active_stage,
                    status="failed",
                    error=last_error,
                )
                notes = _build_run_notes(
                    cycle=cycle,
                    cursor_us=cursor_us,
                    rows_inserted=rows_inserted_total,
                    shutdown_reason=None,
                    state=progress_state or last_state,
                    stats=last_stats,
                    timings=last_timings,
                    last_error=last_error,
                    last_ingestion_write_at=last_ingestion_write_at_iso,
                    last_aggregate_write_at=last_aggregate_write_at_iso,
                    last_enrichment_write_at=last_enrichment_write_at_iso,
                    enrichment_status=(
                        (last_enrichment_summary or {}).get("status")
                        if isinstance(last_enrichment_summary, dict)
                        else None
                    ),
                    enrichment_backlog_size=(
                        (last_enrichment_summary or {}).get("deferred_topics")
                        if isinstance(last_enrichment_summary, dict)
                        else None
                    ),
                    active_stage=active_stage,
                    stage_counts=progress_state or {},
                    latest_source_created_at=latest_source_created_at_iso,
                    last_heartbeat_at=_utc_now().isoformat(),
                    rows_written_this_cycle=cycle_rows_written,
                    last_successful_write_at=last_ingestion_write_at_iso,
                    max_source_timestamp_seen=latest_source_created_at_iso,
                    max_written_timestamp=last_ingestion_write_at_iso,
                    max_processed_timestamp=last_processed_write_at_iso,
                    max_aggregate_timestamp=last_aggregate_write_at_iso,
                    pipeline_lag_seconds=_pipeline_lag_seconds(last_ingestion_write_at_iso),
                    backlog_size=cycle_backlog_size,
                    unprocessed_backlog_size=unprocessed_backlog_size,
                    last_memecoin_write_at=last_memecoin_write_at_iso,
                    memecoin_status=(
                        (last_memecoin_summary or {}).get("status")
                        if isinstance(last_memecoin_summary, dict)
                        else None
                    ),
                    memecoin_summary=last_memecoin_summary if isinstance(last_memecoin_summary, dict) else None,
                )
                try:
                    store.update_ingestion_run(
                        source=source,
                        started_at=started_at,
                        status="running",
                        rows_inserted=rows_inserted_total,
                        notes=notes,
                        last_heartbeat_at=_parse_iso_datetime(notes.get("last_heartbeat_at")),
                        current_stage=active_stage,
                        rows_written_this_cycle=cycle_rows_written,
                        last_successful_write_at=_parse_iso_datetime(last_ingestion_write_at_iso),
                    )
                except Exception as update_error:
                    log_event(
                        logger,
                        logging.ERROR,
                        "cycle_error_run_update_failed",
                        cycle=cycle,
                        error=str(update_error),
                    )

                log_event(
                    logger,
                    logging.ERROR,
                    "cycle_error",
                    cycle=cycle,
                    stage=active_stage,
                    error=last_error,
                )

                if args.once:
                    run_status = "failed"
                    shutdown_reason = "once_cycle_error"
                    break
                time.sleep(config.retry_seconds)
                continue

            if args.once:
                run_status = "completed"
                shutdown_reason = "once"
                break

            if config.loop_sleep_seconds > 0 and not stop_requested:
                time.sleep(config.loop_sleep_seconds)

        if run_status == "running":
            run_status = "stopped"
            shutdown_reason = shutdown_reason if shutdown_reason != "running" else "loop_exit"
    finally:
        if args.once:
            drain_background_stage(
                stage="title",
                future=title_future,
                timeout_seconds=(
                    trend_title_config.max_duration_seconds
                    + trend_title_config.request_timeout_seconds * max(1, trend_title_config.max_retries + 1)
                    + 5.0
                ),
                poll_completion=poll_trend_title_generation_completion,
            )
            drain_background_stage(
                stage="enrich",
                future=enrichment_future,
                timeout_seconds=(
                    trend_enrichment_config.max_duration_seconds
                    + trend_enrichment_config.request_timeout_seconds * max(1, trend_enrichment_config.max_retries + 1)
                    + 5.0
                ),
                poll_completion=poll_trend_enrichment_completion,
            )
            drain_background_stage(
                stage="memecoin_correlate",
                future=memecoin_future,
                timeout_seconds=(
                    memecoin_correlation_config.request_timeout_seconds
                    * max(1, memecoin_correlation_config.max_retries + 1)
                    + 5.0
                ),
                poll_completion=poll_memecoin_completion,
            )
        try:
            poll_trend_title_generation_completion()
        except Exception as error:
            log_event(
                logger,
                logging.ERROR,
                "trend_title_completion_poll_failed",
                source=source,
                error=str(error),
            )
        try:
            poll_trend_enrichment_completion()
        except Exception as error:
            log_event(
                logger,
                logging.ERROR,
                "trend_enrichment_completion_poll_failed",
                source=source,
                error=str(error),
            )
        try:
            poll_memecoin_completion()
        except Exception as error:
            log_event(
                logger,
                logging.ERROR,
                "memecoin_correlation_completion_poll_failed",
                source=source,
                error=str(error),
            )
        if enrichment_future is not None and not enrichment_future.done():
            log_event(
                logger,
                logging.WARNING,
                "trend_enrichment_shutdown_pending",
                source=source,
                started_at=enrichment_started_at_iso,
                reason=enrichment_last_reason,
            )
        if title_future is not None and not title_future.done():
            log_event(
                logger,
                logging.WARNING,
                "trend_title_shutdown_pending",
                source=source,
                started_at=title_started_at_iso,
                reason=title_last_reason,
            )
        if memecoin_future is not None and not memecoin_future.done():
            log_event(
                logger,
                logging.WARNING,
                "memecoin_correlation_shutdown_pending",
                source=source,
                started_at=memecoin_started_at_iso,
                reason=memecoin_last_reason,
            )
        title_executor.shutdown(wait=False, cancel_futures=False)
        enrichment_executor.shutdown(wait=False, cancel_futures=False)
        memecoin_executor.shutdown(wait=False, cancel_futures=False)
        if transform_executor is not None:
            transform_executor.shutdown(wait=False, cancel_futures=False)
        last_heartbeat_at_iso = _utc_now().isoformat()
        final_notes = _build_run_notes(
            cycle=cycle,
            cursor_us=cursor_us,
            rows_inserted=rows_inserted_total,
            shutdown_reason=shutdown_reason,
            state=last_state,
            stats=last_stats,
            timings=last_timings,
            last_error=last_error,
            last_ingestion_write_at=last_ingestion_write_at_iso,
            last_aggregate_write_at=last_aggregate_write_at_iso,
            last_enrichment_write_at=last_enrichment_write_at_iso,
            enrichment_status=(
                (last_enrichment_summary or {}).get("status")
                if isinstance(last_enrichment_summary, dict)
                else None
            ),
            enrichment_backlog_size=(
                (last_enrichment_summary or {}).get("deferred_topics")
                if isinstance(last_enrichment_summary, dict)
                else None
            ),
            active_stage="shutdown",
            latest_source_created_at=latest_source_created_at_iso,
            last_heartbeat_at=last_heartbeat_at_iso,
            rows_written_this_cycle=0,
            last_successful_write_at=last_ingestion_write_at_iso,
            max_source_timestamp_seen=latest_source_created_at_iso,
            max_written_timestamp=last_ingestion_write_at_iso,
            max_processed_timestamp=last_processed_write_at_iso,
            max_aggregate_timestamp=last_aggregate_write_at_iso,
            pipeline_lag_seconds=_pipeline_lag_seconds(last_ingestion_write_at_iso),
            last_memecoin_write_at=last_memecoin_write_at_iso,
            memecoin_status=(
                (last_memecoin_summary or {}).get("status")
                if isinstance(last_memecoin_summary, dict)
                else None
            ),
            memecoin_summary=last_memecoin_summary if isinstance(last_memecoin_summary, dict) else None,
        )
        try:
            store.update_ingestion_run(
                source=source,
                started_at=started_at,
                status=run_status,
                rows_inserted=rows_inserted_total,
                notes=final_notes,
                ended_at=_utc_now(),
                last_heartbeat_at=_parse_iso_datetime(last_heartbeat_at_iso),
                current_stage="shutdown",
                rows_written_this_cycle=0,
                last_successful_write_at=_parse_iso_datetime(last_ingestion_write_at_iso),
            )
        except Exception as error:
            log_event(
                logger,
                logging.ERROR,
                "finalize_ingestion_run_failed",
                source=source,
                error=str(error),
            )
        record_topic_ai_writer_heartbeat(
            writer_identity=TITLE_WRITER_IDENTITY,
            writer_role=TITLE_WRITER_ROLE,
            enabled=trend_title_config.enabled,
            model_name=trend_title_config.model_name,
            prompt_version=trend_title_config.prompt_version,
            status="disabled" if not trend_title_config.enabled else "idle",
            last_reason=f"shutdown:{shutdown_reason}",
            last_completed_at=_utc_now(),
            last_write_at=_parse_iso_datetime(last_title_write_at_iso),
            metadata_json={
                "last_summary": last_title_summary,
            },
        )
        record_topic_ai_writer_heartbeat(
            writer_identity=ENRICHMENT_WRITER_IDENTITY,
            writer_role=ENRICHMENT_WRITER_ROLE,
            enabled=trend_enrichment_config.enabled,
            model_name=trend_enrichment_config.model_name,
            prompt_version=trend_enrichment_config.prompt_version,
            status="disabled" if not trend_enrichment_config.enabled else "idle",
            last_reason=f"shutdown:{shutdown_reason}",
            last_completed_at=_utc_now(),
            last_write_at=_parse_iso_datetime(last_enrichment_write_at_iso),
            metadata_json={
                "last_summary": last_enrichment_summary,
            },
        )
        log_topic_ai_writer_diagnostics_if_due(force=True)
        if worker_lease_acquired:
            try:
                released = store.release_worker_lease(source=source)
                log_event(
                    logger,
                    logging.INFO,
                    "worker_lease_released",
                    source=source,
                    released=bool(released),
                )
            except Exception as error:
                log_event(
                    logger,
                    logging.ERROR,
                    "worker_lease_release_failed",
                    source=source,
                    error=str(error),
                )
        store.close()

    log_event(
        logger,
        logging.INFO,
        "worker_shutdown",
        source=source,
        status=run_status,
        rows_inserted_total=rows_inserted_total,
        shutdown_reason=shutdown_reason,
        last_error=last_error,
        last_ingestion_write_at=last_ingestion_write_at_iso,
        last_aggregate_write_at=last_aggregate_write_at_iso,
        last_enrichment_write_at=last_enrichment_write_at_iso,
        last_enrichment_summary=last_enrichment_summary,
        last_memecoin_write_at=last_memecoin_write_at_iso,
        last_memecoin_summary=last_memecoin_summary,
    )

    return 0 if run_status in {"completed", "stopped"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
