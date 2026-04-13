from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from collections.abc import Callable, Iterable, Iterator, Sequence
from datetime import date, datetime, timedelta, timezone
from typing import Any

import psycopg
from psycopg.pq import TransactionStatus
from psycopg.types.json import Jsonb

from backend.topic_rules import (
    TOPIC_ACRONYM_ALLOWLIST,
    TOPIC_GENERIC_WEAK_TOKENS,
    TOPIC_NOISE_TOKENS,
    TOPIC_NUMBER_WORD_TOKENS,
    TOPIC_URL_DEBRIS_TOKENS,
    seed_topic_alias_rows,
)


def _chunked(rows: Sequence[dict[str, Any]], size: int) -> Iterator[Sequence[dict[str, Any]]]:
    for index in range(0, len(rows), size):
        yield rows[index : index + size]


def _normalize_text_list(values: Any) -> list[str]:
    if values is None:
        return []
    if isinstance(values, str):
        candidates = [values]
    elif isinstance(values, (list, tuple, set)):
        candidates = list(values)
    else:
        candidates = [values]

    normalized: list[str] = []
    seen: set[str] = set()
    for value in candidates:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized


_TRUSTED_TOPIC_AI_NAME_SOURCES = {"ai_exact", "historical_exact", "historical_alias"}
_AUTHORITATIVE_TOPIC_AI_WRITER_IDENTITIES = {
    "backend.main:trend_title_generation",
    "backend.main:trend_enrichment",
}
_GENERIC_TOPIC_AI_NAME_PHRASES = {
    "broad discussion",
    "general conversation",
    "general discussion",
    "generic discussion",
    "mixed discussion",
    "mixed discussion cluster",
    "online conversation",
    "recent posts",
    "social discussion",
    "social media discussion",
    "trend discussion",
}
_GENERIC_TOPIC_AI_NAME_TOKENS = {
    "about",
    "broad",
    "cluster",
    "content",
    "conversation",
    "discussion",
    "event",
    "general",
    "mixed",
    "miscellaneous",
    "narrative",
    "online",
    "posts",
    "recent",
    "social",
    "topic",
    "trend",
    "update",
    "updates",
}
_NARRATIVE_TOPIC_AI_NAME_TOKENS = {
    "appeals",
    "backlash",
    "campaign",
    "controversy",
    "debate",
    "discourse",
    "escalation",
    "fallout",
    "fight",
    "fundraising",
    "movie",
    "policy",
    "reactions",
    "response",
    "responses",
    "rhetoric",
    "rumor",
    "rumors",
    "speculation",
    "trial",
    "vote",
}
_FRAGMENTARY_TOPIC_AI_NAME_PATTERN = re.compile(
    r"(?:apital|eneral|etting|hased|arket|tion|ment|ally|ized)$"
)


def _normalize_topic_ai_name_identity(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _compact_topic_ai_name_identity(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _is_generic_topic_ai_name(value: str | None) -> bool:
    normalized = _normalize_topic_ai_name_identity(value)
    if not normalized:
        return True
    if normalized in _GENERIC_TOPIC_AI_NAME_PHRASES:
        return True
    tokens = normalized.split()
    generic_token_count = sum(1 for token in tokens if token in _GENERIC_TOPIC_AI_NAME_TOKENS)
    return generic_token_count >= max(2, len(tokens))


def _is_fragment_like_topic_ai_name(value: str | None) -> bool:
    compact = _compact_topic_ai_name_identity(value)
    if not compact:
        return True
    if len(compact) < 3 and compact not in {"ai", "uk", "us", "eu"}:
        return True
    return bool(_FRAGMENTARY_TOPIC_AI_NAME_PATTERN.search(compact))


def _is_fragment_variant_topic_ai_name(candidate: str | None, other: str | None) -> bool:
    left = _compact_topic_ai_name_identity(candidate)
    right = _compact_topic_ai_name_identity(other)
    if not left or not right or left == right:
        return False
    shorter, longer = (left, right) if len(left) <= len(right) else (right, left)
    if len(shorter) < 4 or len(longer) < 5:
        return False
    if shorter == longer[1:] or shorter == longer[:-1]:
        return True
    if shorter in longer and len(longer) - len(shorter) <= 2:
        return True

    if abs(len(left) - len(right)) > 1:
        return False
    edits = 0
    left_index = 0
    right_index = 0
    while left_index < len(left) and right_index < len(right):
        if left[left_index] == right[right_index]:
            left_index += 1
            right_index += 1
            continue
        edits += 1
        if edits > 1:
            return False
        if len(left) > len(right):
            left_index += 1
            continue
        if len(right) > len(left):
            right_index += 1
            continue
        left_index += 1
        right_index += 1
    edits += (len(left) - left_index) + (len(right) - right_index)
    return edits <= 1


def _has_narrative_topic_ai_shape(value: str | None) -> bool:
    normalized = _normalize_topic_ai_name_identity(value)
    if not normalized:
        return False
    tokens = [token for token in normalized.split() if token]
    if len(tokens) >= 2:
        return True
    return any(token in _NARRATIVE_TOPIC_AI_NAME_TOKENS for token in tokens)


def _sanitize_topic_ai_fallback_label(*values: str | None) -> str | None:
    normalized_values = [str(value or "").strip() or None for value in values]
    for index, value in enumerate(normalized_values):
        candidate = str(value or "").strip() or None
        if not candidate:
            continue
        if _is_generic_topic_ai_name(candidate) or _is_fragment_like_topic_ai_name(candidate):
            continue
        if any(
            other
            and len(_compact_topic_ai_name_identity(other)) > len(_compact_topic_ai_name_identity(candidate))
            and _is_fragment_variant_topic_ai_name(candidate, other)
            for other in normalized_values[index + 1 :]
        ):
            continue
        return candidate
    return None


def _resolve_topic_ai_name_fields(
    *,
    raw_label: str | None,
    canonical_name: str | None,
    fallback_label: str | None,
    status: str,
    name_status: str | None,
    name_source: str | None,
    narrative_summary: str | None,
    abstain_reason: str | None,
    mixed_signals: list[str],
    metadata_json: dict[str, Any],
    writer_identity: str,
) -> tuple[str | None, str | None, str, str]:
    raw_label_value = str(raw_label or "").strip() or None
    canonical_name_value = str(canonical_name or "").strip() or None
    if (
        canonical_name_value
        and raw_label_value
        and canonical_name_value.lower() == raw_label_value.lower()
    ):
        canonical_name_value = None
    fallback_label_value = _sanitize_topic_ai_fallback_label(
        fallback_label,
        raw_label_value,
        canonical_name_value,
    )

    normalized_mixed_signals = {
        str(value or "").strip().lower()
        for value in mixed_signals
        if str(value or "").strip()
    }
    narrative_text = " ".join(
        part
        for part in (
            str(narrative_summary or "").strip(),
            str(abstain_reason or "").strip(),
        )
        if part
    ).lower()
    used_fallback = bool(metadata_json.get("used_fallback"))
    has_runtime_failure = (
        "visible_runtime_openai_failure" in normalized_mixed_signals
        or "safe fallback because ai enrichment was unavailable" in narrative_text
        or "using the cleaned fallback label" in narrative_text
        or "visible runtime ai naming failed" in narrative_text
    )
    canonical_is_trustworthy = bool(
        canonical_name_value
        and status in {"ok", "mixed"}
        and not used_fallback
        and not has_runtime_failure
        and not _is_generic_topic_ai_name(canonical_name_value)
        and not _is_fragment_like_topic_ai_name(canonical_name_value)
        and _has_narrative_topic_ai_shape(canonical_name_value)
    )
    normalized_name_status = str(name_status or "").strip().lower()
    normalized_name_source = str(name_source or "").strip().lower()

    if canonical_is_trustworthy:
        resolved_status = "ready"
        if normalized_name_source in _TRUSTED_TOPIC_AI_NAME_SOURCES:
            resolved_source = normalized_name_source
        elif writer_identity in _AUTHORITATIVE_TOPIC_AI_WRITER_IDENTITIES:
            resolved_source = "ai_exact"
        else:
            resolved_source = "historical_alias"
    elif status in {"insufficient_evidence", "junk"} and not has_runtime_failure:
        canonical_name_value = None
        resolved_status = "failed"
        resolved_source = "fallback_cleaned" if fallback_label_value else "none"
    else:
        canonical_name_value = None
        resolved_status = "pending"
        resolved_source = "fallback_cleaned" if fallback_label_value else "none"

    return canonical_name_value, fallback_label_value, resolved_status, resolved_source


def _worker_lock_key(source: str) -> int:
    digest = hashlib.sha1(str(source or "worker").encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=False) & 0x7FFFFFFFFFFFFFFF


def is_lock_timeout_error(error: Exception) -> bool:
    sqlstate = str(getattr(error, "sqlstate", "") or "").strip()
    if sqlstate == "55P03":
        return True

    message = str(error or "").strip().lower()
    return "lock timeout" in message or "canceling statement due to lock timeout" in message


class PostgresStore:
    def __init__(
        self,
        *,
        database_url: str,
        batch_size: int,
        schema_lock_timeout_ms: int = 5_000,
        logger: logging.Logger | None = None,
    ) -> None:
        self._database_url = database_url
        self._batch_size = max(1, int(batch_size))
        self._schema_lock_timeout_ms = max(0, int(schema_lock_timeout_ms))
        self._logger = logger or logging.getLogger("backend.db")
        self._conn: psycopg.Connection[Any] | None = None
        self._column_types: dict[tuple[str, str], tuple[str, str]] = {}
        self._schema_verified = False

    def connect(self) -> None:
        if self._conn is not None and not self._conn.closed:
            return
        self._conn = psycopg.connect(self._database_url)
        self._conn.autocommit = False
        try:
            self._ensure_core_tables()
        except Exception as error:
            if not is_lock_timeout_error(error):
                self.close()
                raise
            self._logger.warning(
                "core_schema_sync_skipped_lock_timeout timeout_ms=%s error=%s",
                self._schema_lock_timeout_ms,
                error,
            )
            if self._conn is not None:
                self._conn.rollback()
        self._load_column_metadata()
        self._verify_required_schema()

    def close(self) -> None:
        if self._conn is None:
            return
        try:
            self._conn.close()
        finally:
            self._conn = None

    def verify_connection(self) -> None:
        def operation(connection: psycopg.Connection[Any]) -> None:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()

        self._run_with_retry("verify_connection", operation)

    def disable_legacy_topic_bucket_refresh_jobs(self) -> int:
        def operation(connection: psycopg.Connection[Any]) -> int:
            with connection.cursor() as cursor:
                cursor.execute("SELECT to_regclass('cron.job')")
                cron_job_relation = cursor.fetchone()
                if not cron_job_relation or cron_job_relation[0] is None:
                    return 0

                cursor.execute(
                    """
                    SELECT jobid
                    FROM cron.job
                    WHERE active = TRUE
                      AND (
                          jobname = 'topic_buckets_refresh_every_minute'
                          OR jobname = 'refresh_topic_read_models'
                          OR jobname = 'refresh_topic_buckets_1m_final'
                          OR jobname = 'refresh_topic_day_series_5m'
                          OR command ILIKE '%%run_topic_bucket_refresh_job%%'
                          OR command ILIKE '%%refresh_topic_buckets_1m%%'
                          OR command ILIKE '%%refresh_topic_read_models%%'
                          OR command ILIKE '%%refresh_topic_buckets_1m_final%%'
                          OR command ILIKE '%%refresh_topic_day_series_5m%%'
                          OR command ILIKE '%%refresh_topic_day_totals%%'
                      )
                    ORDER BY jobid ASC
                    """
                )
                job_ids = [int(row[0]) for row in cursor.fetchall() if row and row[0] is not None]
                for job_id in job_ids:
                    cursor.execute("SELECT cron.unschedule(%s)", (job_id,))
                return len(job_ids)

        return self._execute_write("disable_legacy_topic_bucket_refresh_jobs", operation)

    def fetch_resume_cursor(self, *, source: str) -> int | None:
        def operation(connection: psycopg.Connection[Any]) -> int | None:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT notes
                    FROM public.ingestion_runs
                    WHERE source = %s
                    ORDER BY started_at DESC
                    LIMIT 1
                    """,
                    (source,),
                )
                row = cursor.fetchone()
            if not row:
                return None
            notes = self._decode_notes(row[0])
            candidate = notes.get("last_cursor_us", notes.get("cursor"))
            try:
                parsed = int(candidate)
            except (TypeError, ValueError):
                return None
            return parsed if parsed > 0 else None

        return self._run_with_retry("fetch_resume_cursor", operation)

    def create_ingestion_run(
        self,
        *,
        source: str,
        started_at: datetime,
        notes: dict[str, Any],
        last_heartbeat_at: datetime | None = None,
        current_stage: str | None = None,
        rows_written_this_cycle: int = 0,
        last_successful_write_at: datetime | None = None,
    ) -> None:
        def operation(connection: psycopg.Connection[Any]) -> None:
            columns = [
                "source",
                "started_at",
                "status",
                "rows_inserted",
                "notes",
            ]
            values: list[Any] = [
                source,
                started_at,
                "running",
                0,
                self._adapt_notes(notes),
            ]
            if self._has_column("ingestion_runs", "last_heartbeat_at"):
                columns.append("last_heartbeat_at")
                values.append(last_heartbeat_at or started_at)
            if self._has_column("ingestion_runs", "current_stage"):
                columns.append("current_stage")
                values.append(str(current_stage or "startup").strip() or "startup")
            if self._has_column("ingestion_runs", "rows_written_this_cycle"):
                columns.append("rows_written_this_cycle")
                values.append(max(0, int(rows_written_this_cycle)))
            if self._has_column("ingestion_runs", "last_successful_write_at"):
                columns.append("last_successful_write_at")
                values.append(last_successful_write_at)
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    INSERT INTO public.ingestion_runs (
                        {", ".join(columns)}
                    ) VALUES ({", ".join(["%s"] * len(columns))})
                    """,
                    tuple(values),
                )

        self._execute_write("create_ingestion_run", operation)

    def update_ingestion_run(
        self,
        *,
        source: str,
        started_at: datetime,
        status: str,
        rows_inserted: int,
        notes: dict[str, Any],
        ended_at: datetime | None = None,
        last_heartbeat_at: datetime | None = None,
        current_stage: str | None = None,
        rows_written_this_cycle: int | None = None,
        last_successful_write_at: datetime | None = None,
    ) -> None:
        def operation(connection: psycopg.Connection[Any]) -> None:
            assignments = [
                "status = %s",
                "rows_inserted = %s",
                "notes = %s",
            ]
            params: list[Any] = [
                status,
                max(0, int(rows_inserted)),
                self._adapt_notes(notes),
            ]
            if ended_at is not None:
                assignments.insert(0, "ended_at = %s")
                params.insert(0, ended_at)
            if self._has_column("ingestion_runs", "last_heartbeat_at"):
                assignments.append("last_heartbeat_at = %s")
                params.append(last_heartbeat_at)
            if self._has_column("ingestion_runs", "current_stage"):
                assignments.append("current_stage = %s")
                params.append(str(current_stage or "").strip() or None)
            if self._has_column("ingestion_runs", "rows_written_this_cycle"):
                assignments.append("rows_written_this_cycle = %s")
                params.append(
                    None if rows_written_this_cycle is None else max(0, int(rows_written_this_cycle))
                )
            if self._has_column("ingestion_runs", "last_successful_write_at"):
                assignments.append("last_successful_write_at = %s")
                params.append(last_successful_write_at)
            params.extend([source, started_at])
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    UPDATE public.ingestion_runs
                    SET {", ".join(assignments)}
                    WHERE source = %s
                      AND started_at = %s
                    """,
                    tuple(params),
                )

                if cursor.rowcount <= 0:
                    raise RuntimeError(
                        "Could not update ingestion_runs row. Check table keys and started_at precision."
                    )

        self._execute_write("update_ingestion_run", operation)

    def acquire_worker_lease(
        self,
        *,
        source: str,
        stale_after_minutes: int = 30,
    ) -> dict[str, Any]:
        stale_after_minutes = max(5, int(stale_after_minutes))
        source_value = str(source or "").strip() or "bluesky_firehose_worker"
        lock_key = _worker_lock_key(source_value)
        global_lock_key = _worker_lock_key("bluesky_firehose_worker_singleton")

        def operation(connection: psycopg.Connection[Any]) -> dict[str, Any]:
            heartbeat_cutoff_seconds = max(30, stale_after_minutes * 60)
            heartbeat_expression = "r.started_at"
            if self._has_column("ingestion_runs", "last_heartbeat_at"):
                heartbeat_expression = "COALESCE(r.last_heartbeat_at, r.started_at)"
            notes_value_expression = (
                "r.notes"
                if self._expects_json("ingestion_runs", "notes")
                else "r.notes::jsonb"
            )
            notes_heartbeat_expression = (
                f"NULLIF(TRIM(COALESCE({notes_value_expression}->>'last_heartbeat_at', '')), '')::timestamptz"
            )
            heartbeat_expression = f"COALESCE({heartbeat_expression}, {notes_heartbeat_expression}, r.started_at)"
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_try_advisory_lock(%s)", (global_lock_key,))
                global_acquired = bool((cursor.fetchone() or [False])[0])
                if not global_acquired:
                    return {
                        "acquired": False,
                        "lock_key": lock_key,
                        "global_lock_key": global_lock_key,
                        "closed_stale_runs": 0,
                        "closed_open_runs": 0,
                    }

                cursor.execute("SELECT pg_try_advisory_lock(%s)", (lock_key,))
                acquired = bool((cursor.fetchone() or [False])[0])
                if not acquired:
                    cursor.execute("SELECT pg_advisory_unlock(%s)", (global_lock_key,))
                    return {
                        "acquired": False,
                        "lock_key": lock_key,
                        "global_lock_key": global_lock_key,
                        "closed_stale_runs": 0,
                        "closed_open_runs": 0,
                    }

                cursor.execute(
                    f"""
                    WITH stale AS (
                        UPDATE public.ingestion_runs r
                        SET ended_at = now(),
                            status = CASE
                                WHEN COALESCE(NULLIF(TRIM(r.status), ''), 'running') = 'running'
                                    THEN 'abandoned'
                                ELSE r.status
                            END
                        WHERE r.source = %s
                          AND r.ended_at IS NULL
                          AND {heartbeat_expression} < now() - (%s * interval '1 second')
                        RETURNING 1
                    )
                    SELECT COUNT(*)::bigint FROM stale
                    """,
                    (source_value, heartbeat_cutoff_seconds),
                )
                closed_stale_runs = int((cursor.fetchone() or [0])[0] or 0)

                cursor.execute(
                    """
                    WITH open_runs AS (
                        UPDATE public.ingestion_runs r
                        SET ended_at = now(),
                            status = CASE
                                WHEN COALESCE(NULLIF(TRIM(r.status), ''), 'running') = 'running'
                                    THEN 'abandoned'
                                ELSE r.status
                            END
                        WHERE r.source = %s
                          AND r.ended_at IS NULL
                        RETURNING 1
                    )
                    SELECT COUNT(*)::bigint FROM open_runs
                    """,
                    (source_value,),
                )
                closed_open_runs = int((cursor.fetchone() or [0])[0] or 0)

                return {
                        "acquired": True,
                        "lock_key": lock_key,
                        "global_lock_key": global_lock_key,
                        "closed_stale_runs": closed_stale_runs,
                        "closed_open_runs": closed_open_runs,
                        "stale_after_seconds": heartbeat_cutoff_seconds,
                    }

        return self._execute_write("acquire_worker_lease", operation)

    def release_worker_lease(self, *, source: str) -> bool:
        source_value = str(source or "").strip() or "bluesky_firehose_worker"
        lock_key = _worker_lock_key(source_value)
        global_lock_key = _worker_lock_key("bluesky_firehose_worker_singleton")

        def operation(connection: psycopg.Connection[Any]) -> bool:
            with connection.cursor() as cursor:
                released_any = False
                cursor.execute("SELECT pg_advisory_unlock(%s)", (lock_key,))
                released_any = released_any or bool((cursor.fetchone() or [False])[0])
                cursor.execute("SELECT pg_advisory_unlock(%s)", (global_lock_key,))
                released_any = released_any or bool((cursor.fetchone() or [False])[0])
                return released_any

        return self._execute_write("release_worker_lease", operation)

    def upsert_raw_posts(self, rows: Iterable[dict[str, Any]]) -> int:
        payload = [self._prepare_raw_post_row(row) for row in rows]
        payload = [row for row in payload if row.get("post_id")]
        if not payload:
            return 0

        def operation(connection: psycopg.Connection[Any]) -> int:
            inserted_total = 0
            with connection.cursor() as cursor:
                for chunk in _chunked(payload, self._batch_size):
                    cursor.executemany(
                        """
                        INSERT INTO public.raw_posts (
                            platform,
                            source_post_id,
                            source_uri,
                            source_cid,
                            author_did,
                            post_id,
                            author_id,
                            author_handle,
                            root_post_id,
                            reply_parent_id,
                            created_at,
                            inserted_at,
                            ingested_at,
                            raw_text,
                            text_content,
                            language,
                            urls,
                            hashtags,
                            like_count,
                            repost_count,
                            reply_count,
                            reply_to_uri,
                            repost_of_uri,
                            processed,
                            metrics_json,
                            raw_json
                        ) VALUES (
                            %(platform)s,
                            %(source_post_id)s,
                            %(source_uri)s,
                            %(source_cid)s,
                            %(author_did)s,
                            %(post_id)s,
                            %(author_id)s,
                            %(author_handle)s,
                            %(root_post_id)s,
                            %(reply_parent_id)s,
                            %(created_at)s,
                            %(inserted_at)s,
                            %(ingested_at)s,
                            %(raw_text)s,
                            %(text_content)s,
                            %(language)s,
                            %(urls)s,
                            %(hashtags)s,
                            %(like_count)s,
                            %(repost_count)s,
                            %(reply_count)s,
                            %(reply_to_uri)s,
                            %(repost_of_uri)s,
                            %(processed)s,
                            %(metrics_json)s,
                            %(raw_json)s
                        )
                        ON CONFLICT (platform, source_post_id) DO UPDATE
                        SET source_uri = COALESCE(EXCLUDED.source_uri, public.raw_posts.source_uri),
                            source_cid = COALESCE(EXCLUDED.source_cid, public.raw_posts.source_cid),
                            author_did = COALESCE(EXCLUDED.author_did, public.raw_posts.author_did),
                            author_id = COALESCE(EXCLUDED.author_id, public.raw_posts.author_id),
                            author_handle = COALESCE(EXCLUDED.author_handle, public.raw_posts.author_handle),
                            root_post_id = COALESCE(EXCLUDED.root_post_id, public.raw_posts.root_post_id),
                            reply_parent_id = COALESCE(EXCLUDED.reply_parent_id, public.raw_posts.reply_parent_id),
                            created_at = COALESCE(EXCLUDED.created_at, public.raw_posts.created_at),
                            ingested_at = COALESCE(EXCLUDED.ingested_at, public.raw_posts.ingested_at),
                            inserted_at = COALESCE(EXCLUDED.inserted_at, public.raw_posts.inserted_at),
                            raw_text = COALESCE(EXCLUDED.raw_text, public.raw_posts.raw_text),
                            text_content = COALESCE(EXCLUDED.text_content, public.raw_posts.text_content),
                            language = COALESCE(EXCLUDED.language, public.raw_posts.language),
                            urls = COALESCE(EXCLUDED.urls, public.raw_posts.urls),
                            hashtags = COALESCE(EXCLUDED.hashtags, public.raw_posts.hashtags),
                            like_count = COALESCE(EXCLUDED.like_count, public.raw_posts.like_count),
                            repost_count = COALESCE(EXCLUDED.repost_count, public.raw_posts.repost_count),
                            reply_count = COALESCE(EXCLUDED.reply_count, public.raw_posts.reply_count),
                            reply_to_uri = COALESCE(EXCLUDED.reply_to_uri, public.raw_posts.reply_to_uri),
                            repost_of_uri = COALESCE(EXCLUDED.repost_of_uri, public.raw_posts.repost_of_uri),
                            processed = (public.raw_posts.processed OR COALESCE(EXCLUDED.processed, false)),
                            metrics_json = COALESCE(EXCLUDED.metrics_json, public.raw_posts.metrics_json),
                            raw_json = COALESCE(EXCLUDED.raw_json, public.raw_posts.raw_json),
                            post_id = COALESCE(EXCLUDED.post_id, public.raw_posts.post_id)
                        """,
                        list(chunk),
                    )
                    if cursor.rowcount and cursor.rowcount > 0:
                        inserted_total += int(cursor.rowcount)
            return inserted_total

        return self._execute_write("upsert_raw_posts", operation)

    def fetch_raw_posts_by_source_ids(
        self,
        *,
        platform: str,
        source_post_ids: Iterable[str],
    ) -> list[dict[str, Any]]:
        normalized_ids = [
            str(source_post_id or "").strip()
            for source_post_id in source_post_ids
            if str(source_post_id or "").strip()
        ]
        if not normalized_ids:
            return []

        def operation(connection: psycopg.Connection[Any]) -> list[dict[str, Any]]:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        id,
                        platform,
                        source_post_id,
                        post_id,
                        author_id,
                        author_handle,
                        root_post_id,
                        reply_parent_id,
                        created_at,
                        inserted_at,
                        ingested_at,
                        raw_text,
                        text_content,
                        language,
                        urls,
                        hashtags,
                        reply_to_uri,
                        repost_of_uri,
                        metrics_json,
                        raw_json,
                        processed
                    FROM public.raw_posts
                    WHERE platform = %s
                      AND source_post_id = ANY(%s)
                    ORDER BY COALESCE(ingested_at, inserted_at, created_at) DESC, id DESC
                    """,
                    (str(platform or "bluesky").strip() or "bluesky", normalized_ids),
                )
                return [self._decode_ingested_raw_post_row(row) for row in cursor.fetchall()]

        return self._run_with_retry("fetch_raw_posts_by_source_ids", operation)

    def count_unprocessed_raw_posts(self) -> int:
        def operation(connection: psycopg.Connection[Any]) -> int:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT COUNT(*)::bigint
                    FROM public.raw_posts
                    WHERE COALESCE(processed, false) = false
                    """
                )
                row = cursor.fetchone()
                return int((row or [0])[0] or 0)

        return self._run_with_retry("count_unprocessed_raw_posts", operation)

    def fetch_raw_posts_for_processing(
        self,
        *,
        limit: int,
        newest_first: bool = False,
    ) -> list[dict[str, Any]]:
        requested_limit = max(1, int(limit))
        ordering = "DESC" if newest_first else "ASC"

        def operation(connection: psycopg.Connection[Any]) -> list[dict[str, Any]]:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    SELECT
                        id,
                        platform,
                        source_post_id,
                        post_id,
                        author_id,
                        author_handle,
                        root_post_id,
                        reply_parent_id,
                        created_at,
                        inserted_at,
                        ingested_at,
                        raw_text,
                        text_content,
                        language,
                        urls,
                        hashtags,
                        reply_to_uri,
                        repost_of_uri,
                        metrics_json,
                        raw_json,
                        processed
                    FROM public.raw_posts
                    WHERE COALESCE(processed, false) = false
                    ORDER BY COALESCE(created_at, ingested_at, inserted_at) {ordering}, id {ordering}
                    LIMIT %s
                    """,
                    (requested_limit,),
                )
                return [self._decode_ingested_raw_post_row(row) for row in cursor.fetchall()]

        return self._run_with_retry("fetch_raw_posts_for_processing", operation)

    def ingest_raw_post(self, row: dict[str, Any]) -> dict[str, Any] | None:
        payload = self._prepare_raw_post_row(row)
        if not payload.get("post_id"):
            return None

        def operation(connection: psycopg.Connection[Any]) -> dict[str, Any] | None:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.raw_posts (
                        platform,
                        source_post_id,
                        source_uri,
                        source_cid,
                        author_did,
                        post_id,
                        author_id,
                        author_handle,
                        root_post_id,
                        reply_parent_id,
                        created_at,
                        inserted_at,
                        ingested_at,
                        raw_text,
                        text_content,
                        language,
                        urls,
                        hashtags,
                        like_count,
                        repost_count,
                        reply_count,
                        reply_to_uri,
                        repost_of_uri,
                        processed,
                        metrics_json,
                        raw_json
                    ) VALUES (
                        %(platform)s,
                        %(source_post_id)s,
                        %(source_uri)s,
                        %(source_cid)s,
                        %(author_did)s,
                        %(post_id)s,
                        %(author_id)s,
                        %(author_handle)s,
                        %(root_post_id)s,
                        %(reply_parent_id)s,
                        %(created_at)s,
                        %(inserted_at)s,
                        %(ingested_at)s,
                        %(raw_text)s,
                        %(text_content)s,
                        %(language)s,
                        %(urls)s,
                        %(hashtags)s,
                        %(like_count)s,
                        %(repost_count)s,
                        %(reply_count)s,
                        %(reply_to_uri)s,
                        %(repost_of_uri)s,
                        %(processed)s,
                        %(metrics_json)s,
                        %(raw_json)s
                    )
                    ON CONFLICT (platform, source_post_id) DO UPDATE
                    SET source_uri = COALESCE(EXCLUDED.source_uri, public.raw_posts.source_uri),
                        source_cid = COALESCE(EXCLUDED.source_cid, public.raw_posts.source_cid),
                        author_did = COALESCE(EXCLUDED.author_did, public.raw_posts.author_did),
                        author_id = COALESCE(EXCLUDED.author_id, public.raw_posts.author_id),
                        author_handle = COALESCE(EXCLUDED.author_handle, public.raw_posts.author_handle),
                        root_post_id = COALESCE(EXCLUDED.root_post_id, public.raw_posts.root_post_id),
                        reply_parent_id = COALESCE(EXCLUDED.reply_parent_id, public.raw_posts.reply_parent_id),
                        created_at = COALESCE(EXCLUDED.created_at, public.raw_posts.created_at),
                        ingested_at = COALESCE(EXCLUDED.ingested_at, public.raw_posts.ingested_at),
                        inserted_at = COALESCE(EXCLUDED.inserted_at, public.raw_posts.inserted_at),
                        raw_text = COALESCE(EXCLUDED.raw_text, public.raw_posts.raw_text),
                        text_content = COALESCE(EXCLUDED.text_content, public.raw_posts.text_content),
                        language = COALESCE(EXCLUDED.language, public.raw_posts.language),
                        urls = COALESCE(EXCLUDED.urls, public.raw_posts.urls),
                        hashtags = COALESCE(EXCLUDED.hashtags, public.raw_posts.hashtags),
                        like_count = COALESCE(EXCLUDED.like_count, public.raw_posts.like_count),
                        repost_count = COALESCE(EXCLUDED.repost_count, public.raw_posts.repost_count),
                        reply_count = COALESCE(EXCLUDED.reply_count, public.raw_posts.reply_count),
                        reply_to_uri = COALESCE(EXCLUDED.reply_to_uri, public.raw_posts.reply_to_uri),
                        repost_of_uri = COALESCE(EXCLUDED.repost_of_uri, public.raw_posts.repost_of_uri),
                        processed = (public.raw_posts.processed OR COALESCE(EXCLUDED.processed, false)),
                        metrics_json = COALESCE(EXCLUDED.metrics_json, public.raw_posts.metrics_json),
                        raw_json = COALESCE(EXCLUDED.raw_json, public.raw_posts.raw_json),
                        post_id = COALESCE(EXCLUDED.post_id, public.raw_posts.post_id)
                    RETURNING
                        id,
                        platform,
                        source_post_id,
                        post_id,
                        author_id,
                        author_handle,
                        root_post_id,
                        reply_parent_id,
                        created_at,
                        inserted_at,
                        ingested_at,
                        raw_text,
                        text_content,
                        language,
                        urls,
                        hashtags,
                        reply_to_uri,
                        repost_of_uri,
                        metrics_json,
                        raw_json
                    """,
                    payload,
                )
                row_result = cursor.fetchone()
                if not row_result:
                    return None
                return self._decode_ingested_raw_post_row(row_result)

        return self._execute_write("ingest_raw_post", operation)

    def upsert_processed_post_record(self, row: dict[str, Any]) -> dict[str, Any] | None:
        payload = self._prepare_processed_post_row(row)
        raw_post_id = payload.get("raw_post_id")
        if raw_post_id in {None, 0}:
            return None
        source_post_id = str(payload.get("source_post_id") or "").strip()
        if not source_post_id:
            return None

        def operation(connection: psycopg.Connection[Any]) -> dict[str, Any] | None:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.processed_posts (
                        raw_post_id,
                        platform,
                        source_post_id,
                        post_id,
                        author_id,
                        source_created_at,
                        created_at,
                        processed_at,
                        bucket_minute,
                        clean_text,
                        normalized_text,
                        language,
                        has_media,
                        is_reply,
                        is_repost,
                        is_quote,
                        author_hash,
                        token_count,
                        fingerprint,
                        tokens,
                        hashtags,
                        cashtags,
                        mentions,
                        domains,
                        urls,
                        key_phrases,
                        topic_seeds,
                        topic_key_candidate,
                        tags,
                        spam_score,
                        quality_score,
                        topic_entities,
                        sentiment_label,
                        sentiment_positive_score,
                        sentiment_negative_score,
                        sentiment_neutral_score,
                        topic
                    ) VALUES (
                        %(raw_post_id)s,
                        %(platform)s,
                        %(source_post_id)s,
                        %(post_id)s,
                        %(author_id)s,
                        %(source_created_at)s,
                        %(created_at)s,
                        %(processed_at)s,
                        %(bucket_minute)s,
                        %(clean_text)s,
                        %(normalized_text)s,
                        %(language)s,
                        %(has_media)s,
                        %(is_reply)s,
                        %(is_repost)s,
                        %(is_quote)s,
                        %(author_hash)s,
                        %(token_count)s,
                        %(fingerprint)s,
                        %(tokens)s,
                        %(hashtags)s,
                        %(cashtags)s,
                        %(mentions)s,
                        %(domains)s,
                        %(urls)s,
                        %(key_phrases)s,
                        %(topic_seeds)s,
                        %(topic_key_candidate)s,
                        %(tags)s,
                        %(spam_score)s,
                        %(quality_score)s,
                        %(topic_entities)s,
                        %(sentiment_label)s,
                        %(sentiment_positive_score)s,
                        %(sentiment_negative_score)s,
                        %(sentiment_neutral_score)s,
                        %(topic)s
                    )
                    ON CONFLICT (raw_post_id) DO UPDATE
                    SET platform = EXCLUDED.platform,
                        source_post_id = EXCLUDED.source_post_id,
                        post_id = EXCLUDED.post_id,
                        author_id = EXCLUDED.author_id,
                        source_created_at = COALESCE(EXCLUDED.source_created_at, public.processed_posts.source_created_at),
                        created_at = COALESCE(EXCLUDED.created_at, public.processed_posts.created_at),
                        processed_at = COALESCE(EXCLUDED.processed_at, public.processed_posts.processed_at),
                        bucket_minute = COALESCE(EXCLUDED.bucket_minute, public.processed_posts.bucket_minute),
                        clean_text = COALESCE(EXCLUDED.clean_text, public.processed_posts.clean_text),
                        normalized_text = COALESCE(EXCLUDED.normalized_text, public.processed_posts.normalized_text),
                        language = COALESCE(EXCLUDED.language, public.processed_posts.language),
                        has_media = COALESCE(EXCLUDED.has_media, public.processed_posts.has_media),
                        is_reply = COALESCE(EXCLUDED.is_reply, public.processed_posts.is_reply),
                        is_repost = COALESCE(EXCLUDED.is_repost, public.processed_posts.is_repost),
                        is_quote = COALESCE(EXCLUDED.is_quote, public.processed_posts.is_quote),
                        author_hash = COALESCE(EXCLUDED.author_hash, public.processed_posts.author_hash),
                        token_count = COALESCE(EXCLUDED.token_count, public.processed_posts.token_count),
                        fingerprint = COALESCE(EXCLUDED.fingerprint, public.processed_posts.fingerprint),
                        tokens = COALESCE(EXCLUDED.tokens, public.processed_posts.tokens),
                        hashtags = COALESCE(EXCLUDED.hashtags, public.processed_posts.hashtags),
                        cashtags = COALESCE(EXCLUDED.cashtags, public.processed_posts.cashtags),
                        mentions = COALESCE(EXCLUDED.mentions, public.processed_posts.mentions),
                        domains = COALESCE(EXCLUDED.domains, public.processed_posts.domains),
                        urls = COALESCE(EXCLUDED.urls, public.processed_posts.urls),
                        key_phrases = COALESCE(EXCLUDED.key_phrases, public.processed_posts.key_phrases),
                        topic_seeds = COALESCE(EXCLUDED.topic_seeds, public.processed_posts.topic_seeds),
                        topic_key_candidate = COALESCE(EXCLUDED.topic_key_candidate, public.processed_posts.topic_key_candidate),
                        tags = COALESCE(EXCLUDED.tags, public.processed_posts.tags),
                        spam_score = COALESCE(EXCLUDED.spam_score, public.processed_posts.spam_score),
                        quality_score = COALESCE(EXCLUDED.quality_score, public.processed_posts.quality_score),
                        topic_entities = COALESCE(EXCLUDED.topic_entities, public.processed_posts.topic_entities),
                        sentiment_label = COALESCE(EXCLUDED.sentiment_label, public.processed_posts.sentiment_label),
                        sentiment_positive_score = COALESCE(EXCLUDED.sentiment_positive_score, public.processed_posts.sentiment_positive_score),
                        sentiment_negative_score = COALESCE(EXCLUDED.sentiment_negative_score, public.processed_posts.sentiment_negative_score),
                        sentiment_neutral_score = COALESCE(EXCLUDED.sentiment_neutral_score, public.processed_posts.sentiment_neutral_score),
                        topic = COALESCE(EXCLUDED.topic, public.processed_posts.topic)
                    RETURNING id, raw_post_id, processed_at
                    """,
                    payload,
                )
                processed_row = cursor.fetchone()
                if not processed_row:
                    return None
                cursor.execute(
                    """
                    UPDATE public.raw_posts
                    SET processed = TRUE
                    WHERE id = %s
                    """,
                    (raw_post_id,),
                )
                topic_entities_payload = payload.get("topic_entities")
                if isinstance(topic_entities_payload, (list, tuple)):
                    topic_entities_value = [
                        str(value).strip()
                        for value in topic_entities_payload
                        if str(value or "").strip()
                    ]
                else:
                    topic_entities_value = (
                        [str(topic_entities_payload).strip()]
                        if str(topic_entities_payload or "").strip()
                        else []
                    )
                return {
                    "id": int(processed_row[0]),
                    "raw_post_id": int(processed_row[1]),
                    "source_post_id": source_post_id,
                    "platform": str(payload.get("platform") or ""),
                    "processed_at": processed_row[2],
                    "topic_entities": topic_entities_value,
                    "language": payload.get("language"),
                    "source_created_at": payload.get("source_created_at"),
                    "bucket_minute": payload.get("bucket_minute"),
                }

        return self._execute_write("upsert_processed_post_record", operation)

    def upsert_processed_post(self, row: dict[str, Any]) -> int:
        processed = self.upsert_processed_post_record(row)
        return 1 if processed else 0

    def upsert_processed_posts(self, rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        payload: list[dict[str, Any]] = []
        for row in rows:
            prepared = self._prepare_processed_post_row(row)
            prepared["topic_records"] = list(row.get("topic_records") or [])
            payload.append(prepared)
        payload = [
            row
            for row in payload
            if row.get("raw_post_id") not in {None, 0}
            and str(row.get("source_post_id") or "").strip()
        ]
        if not payload:
            return []

        def operation(connection: psycopg.Connection[Any]) -> list[dict[str, Any]]:
            collected_rows: list[dict[str, Any]] = []
            with connection.cursor() as cursor:
                for chunk in _chunked(payload, self._batch_size):
                    chunk_payload = list(chunk)
                    cursor.executemany(
                        """
                        INSERT INTO public.processed_posts (
                            raw_post_id,
                            platform,
                            source_post_id,
                            post_id,
                            author_id,
                            source_created_at,
                            created_at,
                            processed_at,
                            bucket_minute,
                            clean_text,
                            normalized_text,
                            language,
                            has_media,
                            is_reply,
                            is_repost,
                            is_quote,
                            author_hash,
                            token_count,
                            fingerprint,
                            tokens,
                            hashtags,
                            cashtags,
                            mentions,
                            domains,
                            urls,
                            key_phrases,
                            topic_seeds,
                            topic_key_candidate,
                            tags,
                            spam_score,
                            quality_score,
                            topic_entities,
                            sentiment_label,
                            sentiment_positive_score,
                            sentiment_negative_score,
                            sentiment_neutral_score,
                            topic
                        ) VALUES (
                            %(raw_post_id)s,
                            %(platform)s,
                            %(source_post_id)s,
                            %(post_id)s,
                            %(author_id)s,
                            %(source_created_at)s,
                            %(created_at)s,
                            %(processed_at)s,
                            %(bucket_minute)s,
                            %(clean_text)s,
                            %(normalized_text)s,
                            %(language)s,
                            %(has_media)s,
                            %(is_reply)s,
                            %(is_repost)s,
                            %(is_quote)s,
                            %(author_hash)s,
                            %(token_count)s,
                            %(fingerprint)s,
                            %(tokens)s,
                            %(hashtags)s,
                            %(cashtags)s,
                            %(mentions)s,
                            %(domains)s,
                            %(urls)s,
                            %(key_phrases)s,
                            %(topic_seeds)s,
                            %(topic_key_candidate)s,
                            %(tags)s,
                            %(spam_score)s,
                            %(quality_score)s,
                            %(topic_entities)s,
                            %(sentiment_label)s,
                            %(sentiment_positive_score)s,
                            %(sentiment_negative_score)s,
                            %(sentiment_neutral_score)s,
                            %(topic)s
                        )
                        ON CONFLICT (raw_post_id) DO UPDATE
                        SET platform = EXCLUDED.platform,
                            source_post_id = EXCLUDED.source_post_id,
                            post_id = EXCLUDED.post_id,
                            author_id = EXCLUDED.author_id,
                            source_created_at = COALESCE(EXCLUDED.source_created_at, public.processed_posts.source_created_at),
                            created_at = COALESCE(EXCLUDED.created_at, public.processed_posts.created_at),
                            processed_at = COALESCE(EXCLUDED.processed_at, public.processed_posts.processed_at),
                            bucket_minute = COALESCE(EXCLUDED.bucket_minute, public.processed_posts.bucket_minute),
                            clean_text = COALESCE(EXCLUDED.clean_text, public.processed_posts.clean_text),
                            normalized_text = COALESCE(EXCLUDED.normalized_text, public.processed_posts.normalized_text),
                            language = COALESCE(EXCLUDED.language, public.processed_posts.language),
                            has_media = COALESCE(EXCLUDED.has_media, public.processed_posts.has_media),
                            is_reply = COALESCE(EXCLUDED.is_reply, public.processed_posts.is_reply),
                            is_repost = COALESCE(EXCLUDED.is_repost, public.processed_posts.is_repost),
                            is_quote = COALESCE(EXCLUDED.is_quote, public.processed_posts.is_quote),
                            author_hash = COALESCE(EXCLUDED.author_hash, public.processed_posts.author_hash),
                            token_count = COALESCE(EXCLUDED.token_count, public.processed_posts.token_count),
                            fingerprint = COALESCE(EXCLUDED.fingerprint, public.processed_posts.fingerprint),
                            tokens = COALESCE(EXCLUDED.tokens, public.processed_posts.tokens),
                            hashtags = COALESCE(EXCLUDED.hashtags, public.processed_posts.hashtags),
                            cashtags = COALESCE(EXCLUDED.cashtags, public.processed_posts.cashtags),
                            mentions = COALESCE(EXCLUDED.mentions, public.processed_posts.mentions),
                            domains = COALESCE(EXCLUDED.domains, public.processed_posts.domains),
                            urls = COALESCE(EXCLUDED.urls, public.processed_posts.urls),
                            key_phrases = COALESCE(EXCLUDED.key_phrases, public.processed_posts.key_phrases),
                            topic_seeds = COALESCE(EXCLUDED.topic_seeds, public.processed_posts.topic_seeds),
                            topic_key_candidate = COALESCE(EXCLUDED.topic_key_candidate, public.processed_posts.topic_key_candidate),
                            tags = COALESCE(EXCLUDED.tags, public.processed_posts.tags),
                            spam_score = COALESCE(EXCLUDED.spam_score, public.processed_posts.spam_score),
                            quality_score = COALESCE(EXCLUDED.quality_score, public.processed_posts.quality_score),
                            topic_entities = COALESCE(EXCLUDED.topic_entities, public.processed_posts.topic_entities),
                            sentiment_label = COALESCE(EXCLUDED.sentiment_label, public.processed_posts.sentiment_label),
                            sentiment_positive_score = COALESCE(EXCLUDED.sentiment_positive_score, public.processed_posts.sentiment_positive_score),
                            sentiment_negative_score = COALESCE(EXCLUDED.sentiment_negative_score, public.processed_posts.sentiment_negative_score),
                            sentiment_neutral_score = COALESCE(EXCLUDED.sentiment_neutral_score, public.processed_posts.sentiment_neutral_score),
                            topic = COALESCE(EXCLUDED.topic, public.processed_posts.topic)
                        """,
                        chunk_payload,
                    )
                    raw_post_ids = [
                        int(row.get("raw_post_id"))
                        for row in chunk_payload
                        if row.get("raw_post_id") not in {None, 0}
                    ]
                    if raw_post_ids:
                        cursor.execute(
                            """
                            UPDATE public.raw_posts
                            SET processed = TRUE
                            WHERE id = ANY(%s)
                            """,
                            (raw_post_ids,),
                        )
                        cursor.execute(
                            """
                            SELECT
                                id,
                                raw_post_id,
                                source_post_id,
                                platform,
                                processed_at,
                                topic_entities,
                                language,
                                source_created_at,
                                bucket_minute
                            FROM public.processed_posts
                            WHERE raw_post_id = ANY(%s)
                            ORDER BY raw_post_id ASC
                            """,
                            (raw_post_ids,),
                        )
                        payload_by_raw_id = {
                            int(row.get("raw_post_id")): row
                            for row in chunk_payload
                            if row.get("raw_post_id") not in {None, 0}
                        }
                        collected_rows.extend(
                            self._decode_processed_post_summary_row(
                                row,
                                payload_by_raw_id=payload_by_raw_id,
                            )
                            for row in cursor.fetchall()
                        )
            return collected_rows

        return self._execute_write("upsert_processed_posts", operation)

    def persist_post_topics(self, rows: Iterable[dict[str, Any]]) -> int:
        payload = [self._prepare_post_topic_row(row) for row in rows]
        payload = [
            row
            for row in payload
            if row.get("raw_post_id")
            and row.get("source_post_id")
            and row.get("normalized_topic")
            and row.get("topic_type")
        ]
        if not payload:
            return 0

        def operation(connection: psycopg.Connection[Any]) -> int:
            with connection.cursor() as cursor:
                cursor.executemany(
                    """
                    INSERT INTO public.post_topics (
                        raw_post_id,
                        processed_post_id,
                        platform,
                        source_post_id,
                        topic_text,
                        normalized_topic,
                        topic_type,
                        language,
                        source_created_at,
                        bucket_minute,
                        created_at
                    ) VALUES (
                        %(raw_post_id)s,
                        %(processed_post_id)s,
                        %(platform)s,
                        %(source_post_id)s,
                        %(topic_text)s,
                        %(normalized_topic)s,
                        %(topic_type)s,
                        %(language)s,
                        %(source_created_at)s,
                        %(bucket_minute)s,
                        %(created_at)s
                    )
                    ON CONFLICT (raw_post_id, normalized_topic, topic_type) DO UPDATE
                    SET processed_post_id = COALESCE(EXCLUDED.processed_post_id, public.post_topics.processed_post_id),
                        platform = COALESCE(EXCLUDED.platform, public.post_topics.platform),
                        source_post_id = COALESCE(EXCLUDED.source_post_id, public.post_topics.source_post_id),
                        topic_text = COALESCE(EXCLUDED.topic_text, public.post_topics.topic_text),
                        language = COALESCE(EXCLUDED.language, public.post_topics.language),
                        source_created_at = COALESCE(EXCLUDED.source_created_at, public.post_topics.source_created_at),
                        bucket_minute = COALESCE(EXCLUDED.bucket_minute, public.post_topics.bucket_minute)
                    """,
                    payload,
                )
                return int(cursor.rowcount or 0)

        return self._execute_write("persist_post_topics", operation)

    def ensure_stable_topic_read_model_tables(self) -> None:
        def operation(connection: psycopg.Connection[Any]) -> None:
            alias_rows = seed_topic_alias_rows()
            with connection.cursor() as cursor:
                self._apply_schema_lock_timeout(cursor)
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.topics (
                        topic_key TEXT PRIMARY KEY,
                        canonical_label TEXT NOT NULL,
                        entity_type TEXT NOT NULL DEFAULT 'keyword',
                        aliases TEXT[] NOT NULL DEFAULT '{}'::text[],
                        is_active BOOLEAN NOT NULL DEFAULT true,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.topic_alias_rules (
                        alias_key TEXT PRIMARY KEY,
                        canonical_key TEXT NOT NULL,
                        canonical_label TEXT NOT NULL,
                        entity_type TEXT NOT NULL DEFAULT 'entity',
                        confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
                        is_active BOOLEAN NOT NULL DEFAULT true,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_alias_rules_canonical_key
                    ON public.topic_alias_rules (canonical_key)
                    """
                )
                if alias_rows:
                    cursor.executemany(
                        """
                        INSERT INTO public.topic_alias_rules (
                            alias_key,
                            canonical_key,
                            canonical_label,
                            entity_type,
                            confidence,
                            is_active,
                            updated_at
                        ) VALUES (%s, %s, %s, %s, %s, true, now())
                        ON CONFLICT (alias_key) DO UPDATE
                        SET canonical_key = EXCLUDED.canonical_key,
                            canonical_label = EXCLUDED.canonical_label,
                            entity_type = EXCLUDED.entity_type,
                            confidence = EXCLUDED.confidence,
                            is_active = true,
                            updated_at = now()
                        """,
                        alias_rows,
                    )
                    cursor.executemany(
                        """
                        INSERT INTO public.topics (
                            topic_key,
                            canonical_label,
                            entity_type,
                            aliases,
                            is_active,
                            updated_at
                        ) VALUES (%s, %s, %s, ARRAY[%s]::text[], true, now())
                        ON CONFLICT (topic_key) DO UPDATE
                        SET canonical_label = EXCLUDED.canonical_label,
                            entity_type = EXCLUDED.entity_type,
                            aliases = (
                                SELECT ARRAY(
                                    SELECT DISTINCT a
                                    FROM unnest(public.topics.aliases || EXCLUDED.aliases) AS a
                                )
                            ),
                            is_active = true,
                            updated_at = now()
                        """,
                        [
                            (
                                canonical_key,
                                canonical_label,
                                entity_type,
                                alias_key,
                            )
                            for alias_key, canonical_key, canonical_label, entity_type, _confidence in alias_rows
                        ],
                    )
                cursor.execute(
                    """
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
                        topic_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                        is_repost BOOLEAN NOT NULL DEFAULT false,
                        is_reply BOOLEAN NOT NULL DEFAULT false,
                        has_link BOOLEAN NOT NULL DEFAULT false
                    )
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.post_topic_mentions
                    ADD COLUMN IF NOT EXISTS topic_confidence DOUBLE PRECISION NOT NULL DEFAULT 0
                    """
                )
                cursor.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_post_topic_mentions_raw_platform_topic
                    ON public.post_topic_mentions (raw_post_id, platform, topic_key)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_post_topic_mentions_event_ts
                    ON public.post_topic_mentions (event_timestamp DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_post_topic_mentions_topic_event
                    ON public.post_topic_mentions (topic_key, event_timestamp DESC)
                    """
                )
                cursor.execute(
                    """
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
                        avg_topic_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                        finalized_at TIMESTAMPTZ NOT NULL,
                        PRIMARY KEY (bucket_minute, platform, topic_key)
                    )
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_buckets_1m_final
                    ADD COLUMN IF NOT EXISTS avg_topic_confidence DOUBLE PRECISION NOT NULL DEFAULT 0
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_buckets_1m_final_topic_bucket
                    ON public.topic_buckets_1m_final (topic_key, bucket_minute DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_buckets_1m_final_platform_bucket
                    ON public.topic_buckets_1m_final (platform, bucket_minute DESC)
                    """
                )
                cursor.execute(
                    """
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
                        avg_topic_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                        first_seen_at TIMESTAMPTZ NOT NULL,
                        last_seen_at TIMESTAMPTZ NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        PRIMARY KEY (day, topic_key)
                    )
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_day_totals
                    ADD COLUMN IF NOT EXISTS avg_topic_confidence DOUBLE PRECISION NOT NULL DEFAULT 0
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_day_totals_day_mentions
                    ON public.topic_day_totals (day, total_mentions DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.topic_read_model_state (
                        id SMALLINT PRIMARY KEY CHECK (id = 1),
                        last_finalize_before TIMESTAMPTZ,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.topic_rolling_24h (
                        topic_key TEXT PRIMARY KEY,
                        topic_label TEXT NOT NULL,
                        platform_count INTEGER NOT NULL,
                        total_mentions INTEGER NOT NULL,
                        unique_posts INTEGER NOT NULL,
                        unique_authors INTEGER NOT NULL,
                        positive_count INTEGER NOT NULL DEFAULT 0,
                        neutral_count INTEGER NOT NULL DEFAULT 0,
                        negative_count INTEGER NOT NULL DEFAULT 0,
                        avg_topic_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                        first_seen_at TIMESTAMPTZ NOT NULL,
                        last_seen_at TIMESTAMPTZ NOT NULL,
                        window_start TIMESTAMPTZ NOT NULL,
                        window_end TIMESTAMPTZ NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_rolling_24h_mentions
                    ON public.topic_rolling_24h (total_mentions DESC, topic_key)
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.topic_ai_enrichments (
                        id BIGSERIAL PRIMARY KEY,
                        topic_key TEXT NOT NULL,
                        as_of_window_end TIMESTAMPTZ NOT NULL,
                        raw_label TEXT NOT NULL,
                        canonical_name TEXT,
                        ai_display_name TEXT,
                        fallback_label TEXT,
                        name_status TEXT NOT NULL DEFAULT 'pending',
                        ai_name_status TEXT NOT NULL DEFAULT 'pending',
                        name_source TEXT NOT NULL DEFAULT 'none',
                        short_description TEXT NOT NULL,
                        context_paragraph TEXT NOT NULL,
                        narrative_summary TEXT,
                        why_attention TEXT,
                        status TEXT NOT NULL DEFAULT 'ok',
                        key_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
                        trend_category TEXT,
                        summary_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                        evidence_post_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                        mixed_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
                        abstain_reason TEXT,
                        validator_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
                        validated_output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        raw_response_text TEXT,
                        supporting_post_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                        supporting_sample JSONB NOT NULL DEFAULT '[]'::jsonb,
                        representative_post_count INTEGER NOT NULL DEFAULT 0,
                        model_name TEXT NOT NULL,
                        prompt_version TEXT NOT NULL,
                        input_hash TEXT NOT NULL,
                        generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        ai_name_generated_at TIMESTAMPTZ,
                        refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        ai_name_refreshed_at TIMESTAMPTZ,
                        expires_at TIMESTAMPTZ,
                        ai_name_source_version TEXT,
                        writer_identity TEXT NOT NULL DEFAULT '',
                        writer_role TEXT NOT NULL DEFAULT '',
                        authoritative_writer BOOLEAN NOT NULL DEFAULT false,
                        deployment_id TEXT,
                        instance_id TEXT,
                        code_version TEXT,
                        refresh_reason TEXT,
                        usage_prompt_tokens INTEGER NOT NULL DEFAULT 0,
                        usage_completion_tokens INTEGER NOT NULL DEFAULT 0,
                        usage_total_tokens INTEGER NOT NULL DEFAULT 0,
                        duration_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
                        replaced_existing_title BOOLEAN NOT NULL DEFAULT false,
                        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        CONSTRAINT topic_ai_enrichments_summary_confidence_range
                            CHECK (summary_confidence >= 0 AND summary_confidence <= 1)
                    )
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS narrative_summary TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS why_attention TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ok'
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ALTER COLUMN canonical_name DROP NOT NULL
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS fallback_label TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS name_status TEXT NOT NULL DEFAULT 'pending'
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS ai_display_name TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS ai_name_status TEXT NOT NULL DEFAULT 'pending'
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS name_source TEXT NOT NULL DEFAULT 'none'
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS evidence_post_ids JSONB NOT NULL DEFAULT '[]'::jsonb
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS mixed_signals JSONB NOT NULL DEFAULT '[]'::jsonb
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS abstain_reason TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS validator_errors JSONB NOT NULL DEFAULT '[]'::jsonb
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS validated_output_json JSONB NOT NULL DEFAULT '{}'::jsonb
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS raw_response_text TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS ai_name_generated_at TIMESTAMPTZ
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS ai_name_refreshed_at TIMESTAMPTZ
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS ai_name_source_version TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS writer_identity TEXT NOT NULL DEFAULT ''
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS writer_role TEXT NOT NULL DEFAULT ''
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS authoritative_writer BOOLEAN NOT NULL DEFAULT false
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS deployment_id TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS instance_id TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS code_version TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS refresh_reason TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS usage_prompt_tokens INTEGER NOT NULL DEFAULT 0
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS usage_completion_tokens INTEGER NOT NULL DEFAULT 0
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS usage_total_tokens INTEGER NOT NULL DEFAULT 0
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS duration_ms DOUBLE PRECISION NOT NULL DEFAULT 0
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichments
                    ADD COLUMN IF NOT EXISTS replaced_existing_title BOOLEAN NOT NULL DEFAULT false
                    """
                )
                cursor.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_topic_ai_enrichments_topic_window
                    ON public.topic_ai_enrichments (topic_key, as_of_window_end)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_topic_generated
                    ON public.topic_ai_enrichments (topic_key, generated_at DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_refreshed
                    ON public.topic_ai_enrichments (refreshed_at DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_window_end
                    ON public.topic_ai_enrichments (as_of_window_end DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_writer_generated
                    ON public.topic_ai_enrichments (writer_identity, generated_at DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_refresh_reason_generated
                    ON public.topic_ai_enrichments (refresh_reason, generated_at DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_ai_name_status
                    ON public.topic_ai_enrichments (ai_name_status, ai_name_refreshed_at DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichments_ai_display_name
                    ON public.topic_ai_enrichments (ai_display_name, ai_name_refreshed_at DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.topic_ai_enrichment_runs (
                        id BIGSERIAL PRIMARY KEY,
                        topic_key TEXT NOT NULL,
                        as_of_window_end TIMESTAMPTZ NOT NULL,
                        raw_label TEXT NOT NULL,
                        canonical_name TEXT,
                        ai_display_name TEXT,
                        fallback_label TEXT,
                        name_status TEXT NOT NULL DEFAULT 'pending',
                        ai_name_status TEXT NOT NULL DEFAULT 'pending',
                        name_source TEXT NOT NULL DEFAULT 'none',
                        short_description TEXT NOT NULL,
                        context_paragraph TEXT NOT NULL,
                        narrative_summary TEXT,
                        why_attention TEXT,
                        status TEXT NOT NULL DEFAULT 'ok',
                        key_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
                        trend_category TEXT,
                        summary_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                        evidence_post_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                        mixed_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
                        abstain_reason TEXT,
                        validator_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
                        validated_output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        raw_response_text TEXT,
                        supporting_post_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                        supporting_sample JSONB NOT NULL DEFAULT '[]'::jsonb,
                        representative_post_count INTEGER NOT NULL DEFAULT 0,
                        model_name TEXT NOT NULL,
                        prompt_version TEXT NOT NULL,
                        input_hash TEXT NOT NULL,
                        generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        ai_name_generated_at TIMESTAMPTZ,
                        ai_name_refreshed_at TIMESTAMPTZ,
                        expires_at TIMESTAMPTZ,
                        ai_name_source_version TEXT,
                        writer_identity TEXT NOT NULL DEFAULT '',
                        writer_role TEXT NOT NULL DEFAULT '',
                        authoritative_writer BOOLEAN NOT NULL DEFAULT false,
                        deployment_id TEXT,
                        instance_id TEXT,
                        code_version TEXT,
                        refresh_reason TEXT,
                        usage_prompt_tokens INTEGER NOT NULL DEFAULT 0,
                        usage_completion_tokens INTEGER NOT NULL DEFAULT 0,
                        usage_total_tokens INTEGER NOT NULL DEFAULT 0,
                        duration_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
                        replaced_existing_title BOOLEAN NOT NULL DEFAULT false,
                        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        CONSTRAINT topic_ai_enrichment_runs_summary_confidence_range
                            CHECK (summary_confidence >= 0 AND summary_confidence <= 1)
                    )
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ALTER COLUMN canonical_name DROP NOT NULL
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS fallback_label TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS name_status TEXT NOT NULL DEFAULT 'pending'
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS ai_display_name TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS ai_name_status TEXT NOT NULL DEFAULT 'pending'
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS name_source TEXT NOT NULL DEFAULT 'none'
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS ai_name_generated_at TIMESTAMPTZ
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS ai_name_refreshed_at TIMESTAMPTZ
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS ai_name_source_version TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS writer_identity TEXT NOT NULL DEFAULT ''
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS writer_role TEXT NOT NULL DEFAULT ''
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS authoritative_writer BOOLEAN NOT NULL DEFAULT false
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS deployment_id TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS instance_id TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS code_version TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS refresh_reason TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS usage_prompt_tokens INTEGER NOT NULL DEFAULT 0
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS usage_completion_tokens INTEGER NOT NULL DEFAULT 0
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS usage_total_tokens INTEGER NOT NULL DEFAULT 0
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS duration_ms DOUBLE PRECISION NOT NULL DEFAULT 0
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.topic_ai_enrichment_runs
                    ADD COLUMN IF NOT EXISTS replaced_existing_title BOOLEAN NOT NULL DEFAULT false
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichment_runs_topic_generated
                    ON public.topic_ai_enrichment_runs (topic_key, generated_at DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichment_runs_generated
                    ON public.topic_ai_enrichment_runs (generated_at DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichment_runs_writer_generated
                    ON public.topic_ai_enrichment_runs (writer_identity, generated_at DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichment_runs_refresh_generated
                    ON public.topic_ai_enrichment_runs (refresh_reason, generated_at DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_ai_enrichment_runs_model_prompt_generated
                    ON public.topic_ai_enrichment_runs (model_name, prompt_version, generated_at DESC)
                    """
                )
                cursor.execute(
                    """
                    WITH ranked_duplicates AS (
                        SELECT
                            id,
                            ROW_NUMBER() OVER (
                                PARTITION BY
                                    topic_key,
                                    as_of_window_end,
                                    writer_identity,
                                    prompt_version,
                                    model_name,
                                    input_hash,
                                    COALESCE(refresh_reason, '')
                                ORDER BY generated_at DESC, id DESC
                            ) AS duplicate_rank
                        FROM public.topic_ai_enrichment_runs
                        WHERE generated_at >= TIMESTAMPTZ '2026-04-07 00:00:00+00'
                    )
                    DELETE FROM public.topic_ai_enrichment_runs runs
                    USING ranked_duplicates duplicates
                    WHERE runs.id = duplicates.id
                      AND duplicates.duplicate_rank > 1
                    """
                )
                cursor.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_topic_ai_enrichment_runs_run_fingerprint
                    ON public.topic_ai_enrichment_runs (
                        topic_key,
                        as_of_window_end,
                        writer_identity,
                        prompt_version,
                        model_name,
                        input_hash,
                        COALESCE(refresh_reason, '')
                    )
                    WHERE generated_at >= TIMESTAMPTZ '2026-04-07 00:00:00+00'
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.topic_ai_writer_heartbeats (
                        writer_identity TEXT NOT NULL,
                        deployment_id TEXT NOT NULL,
                        instance_id TEXT NOT NULL,
                        writer_role TEXT NOT NULL,
                        authoritative_writer BOOLEAN NOT NULL DEFAULT false,
                        model_name TEXT,
                        prompt_version TEXT,
                        code_version TEXT,
                        status TEXT NOT NULL DEFAULT 'idle',
                        last_reason TEXT,
                        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        last_started_at TIMESTAMPTZ,
                        last_completed_at TIMESTAMPTZ,
                        last_write_at TIMESTAMPTZ,
                        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        PRIMARY KEY (writer_identity, deployment_id, instance_id)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_ai_writer_heartbeats_seen
                    ON public.topic_ai_writer_heartbeats (last_seen_at DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.topic_day_series_5m (
                        day DATE NOT NULL,
                        bucket_5m TIMESTAMPTZ NOT NULL,
                        topic_key TEXT NOT NULL,
                        topic_label TEXT NOT NULL,
                        interactions INTEGER NOT NULL,
                        cumulative_interactions INTEGER NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        PRIMARY KEY (day, bucket_5m, topic_key)
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_day_series_5m_day_topic_bucket
                    ON public.topic_day_series_5m (day, topic_key, bucket_5m)
                    """
                )
                view_definitions = (
                    (
                        "v_topic_leaderboard_day",
                        """
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
                            avg_topic_confidence,
                            first_seen_at,
                            last_seen_at,
                            updated_at
                        FROM public.topic_day_totals
                        """,
                    ),
                    (
                        "v_topic_series_day_5m",
                        """
                        SELECT
                            day,
                            bucket_5m,
                            topic_key,
                            topic_label,
                            interactions,
                            cumulative_interactions,
                            updated_at
                        FROM public.topic_day_series_5m
                        """,
                    ),
                    (
                        "v_topic_leaderboard_rolling_24h",
                        """
                        SELECT
                            topic_key,
                            topic_label,
                            platform_count,
                            total_mentions,
                            unique_posts,
                            unique_authors,
                            positive_count,
                            neutral_count,
                            negative_count,
                            avg_topic_confidence,
                            first_seen_at,
                            last_seen_at,
                            window_start,
                            window_end,
                            updated_at
                        FROM public.topic_rolling_24h
                        """,
                    ),
                )
                for view_index, (view_name, select_query) in enumerate(view_definitions):
                    savepoint_name = f"topic_view_replace_{view_index}"
                    create_or_replace_view_sql = (
                        f"CREATE OR REPLACE VIEW public.{view_name} AS {select_query}"
                    )
                    cursor.execute(f"SAVEPOINT {savepoint_name}")
                    try:
                        cursor.execute(create_or_replace_view_sql)
                    except psycopg.Error as error:
                        cursor.execute(f"ROLLBACK TO SAVEPOINT {savepoint_name}")
                        if "cannot change name of view column" in str(error).lower():
                            self._logger.warning(
                                "recreating_view_after_column_rename_error view=%s error=%s",
                                view_name,
                                error,
                            )
                            cursor.execute(f"DROP VIEW IF EXISTS public.{view_name}")
                            cursor.execute(f"CREATE VIEW public.{view_name} AS {select_query}")
                        else:
                            raise
                    finally:
                        cursor.execute(f"RELEASE SAVEPOINT {savepoint_name}")

        self._execute_write("ensure_stable_topic_read_model_tables", operation)

    def reset_stable_topic_read_models(self) -> None:
        def operation(connection: psycopg.Connection[Any]) -> None:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    TRUNCATE TABLE
                        public.topic_rolling_24h,
                        public.topic_day_series_5m,
                        public.topic_day_totals,
                        public.topic_buckets_1m_final,
                        public.post_topic_mentions
                    RESTART IDENTITY
                    """
                )
                cursor.execute(
                    """
                    DELETE FROM public.topic_read_model_state WHERE id = 1
                    """
                )

        self._execute_write("reset_stable_topic_read_models", operation)

    def sync_post_topic_mentions_from_post_topics(
        self,
        *,
        lookback_hours: int = 72,
        statement_timeout_seconds: float | None = None,
    ) -> int:
        lookback_hours = max(1, int(lookback_hours))
        weak_tokens = sorted(set(TOPIC_GENERIC_WEAK_TOKENS))
        noise_tokens = sorted(set(TOPIC_NOISE_TOKENS))
        number_tokens = sorted(set(TOPIC_NUMBER_WORD_TOKENS))
        url_debris_tokens = sorted(set(TOPIC_URL_DEBRIS_TOKENS))
        acronym_tokens = sorted(set(TOPIC_ACRONYM_ALLOWLIST))

        def operation(connection: psycopg.Connection[Any]) -> int:
            with connection.cursor() as cursor:
                self._apply_statement_timeout(cursor, statement_timeout_seconds)
                cursor.execute(
                    """
                    SELECT
                        to_regclass('public.post_topic_mentions'),
                        to_regclass('public.post_topics'),
                        to_regclass('public.processed_posts'),
                        to_regclass('public.topic_alias_rules')
                    """
                )
                tables = cursor.fetchone() or (None, None, None, None)
                if not tables[0] or not tables[1] or not tables[3]:
                    return 0

                cursor.execute(
                    """
                    WITH sync_bounds AS (
                        SELECT
                            GREATEST(
                                now() - make_interval(hours => %s),
                                COALESCE(
                                    (
                                        SELECT MAX(event_timestamp) - interval '3 hour'
                                        FROM public.post_topic_mentions
                                    ),
                                    now() - make_interval(hours => %s)
                                )
                            ) AS sync_from
                    ),
                    weak_topic_tokens(token) AS (SELECT unnest(%s::text[])),
                    topic_noise_tokens(token) AS (SELECT unnest(%s::text[])),
                    number_word_tokens(token) AS (SELECT unnest(%s::text[])),
                    url_debris_tokens(token) AS (SELECT unnest(%s::text[])),
                    acronym_allowlist(token) AS (SELECT unnest(%s::text[])),
                    mention_candidates_raw AS (
                        SELECT
                            pt.raw_post_id,
                            pt.processed_post_id,
                            COALESCE(NULLIF(TRIM(pt.platform), ''), 'bluesky') AS platform,
                            normalized_topic_base AS normalized_topic,
                            COALESCE(NULLIF(TRIM(pt.topic_text), ''), INITCAP(normalized_topic_base)) AS topic_text,
                            LOWER(COALESCE(NULLIF(TRIM(pt.topic_text), ''), '')) AS topic_text_lc,
                            COALESCE(
                                pt.source_created_at,
                                pt.bucket_minute,
                                pp.source_created_at,
                                pp.created_at,
                                pp.processed_at,
                                now()
                            ) AS event_timestamp,
                            COALESCE(pp.processed_at, pt.created_at, now()) AS ingested_at,
                            NULLIF(TRIM(COALESCE(pp.author_id, '')), '') AS author_id,
                            CASE
                                WHEN COALESCE(pp.sentiment_label, '') IN ('positive', 'negative', 'neutral')
                                    THEN pp.sentiment_label
                                ELSE 'neutral'
                            END AS sentiment_label,
                            LEAST(1.0, GREATEST(0.0, COALESCE(pp.quality_score, 0)::double precision)) AS quality_score,
                            COALESCE(pp.is_repost, false) AS is_repost,
                            COALESCE(pp.is_reply, false) AS is_reply,
                            (COALESCE(array_length(pp.urls, 1), 0) > 0) AS has_link,
                            LOWER(COALESCE(pt.topic_type, 'entity')) AS topic_type
                        FROM (
                            SELECT
                                pt.*,
                                LOWER(
                                    BTRIM(
                                        REGEXP_REPLACE(
                                            REGEXP_REPLACE(
                                                REGEXP_REPLACE(
                                                    REPLACE(REPLACE(COALESCE(pt.normalized_topic, pt.topic_text, ''), 'â€™', ''''), '’', ''''),
                                                    '([a-z0-9])''([a-z0-9])',
                                                    '\\1\\2',
                                                    'gi'
                                                ),
                                                '[^a-z0-9$#\\s-]+',
                                                ' ',
                                                'g'
                                            ),
                                            '\\s+',
                                            ' ',
                                            'g'
                                        )
                                    )
                                ) AS normalized_topic_base
                            FROM public.post_topics pt
                            WHERE COALESCE(pt.source_created_at, pt.created_at, now())
                                >= (SELECT sync_from FROM sync_bounds)
                        ) pt
                        LEFT JOIN public.processed_posts pp
                          ON pp.id = pt.processed_post_id
                    ),
                    canonicalized AS (
                        SELECT
                            r.raw_post_id,
                            r.processed_post_id,
                            r.platform,
                            COALESCE(a.canonical_key, r.normalized_topic) AS topic_key,
                            COALESCE(
                                a.canonical_label,
                                CASE
                                    WHEN r.normalized_topic IN (SELECT token FROM acronym_allowlist)
                                        THEN UPPER(r.normalized_topic)
                                    ELSE COALESCE(NULLIF(TRIM(r.topic_text), ''), INITCAP(r.normalized_topic))
                                END
                            ) AS topic_label,
                            r.topic_text_lc,
                            r.event_timestamp,
                            r.ingested_at,
                            r.author_id,
                            r.sentiment_label,
                            r.quality_score,
                            COALESCE(a.confidence, 0.0)::double precision AS alias_confidence,
                            r.is_repost,
                            r.is_reply,
                            r.has_link,
                            r.topic_type
                        FROM mention_candidates_raw r
                        LEFT JOIN public.topic_alias_rules a
                          ON a.alias_key = r.normalized_topic
                         AND a.is_active = true
                    ),
                    scored AS (
                        SELECT
                            c.*,
                            tok.token_count,
                            tok.weak_count,
                            tok.noise_count,
                            tok.number_count,
                            tok.url_count,
                            tok.informative_count,
                            LEAST(
                                1.0,
                                GREATEST(
                                    0.0,
                                    (
                                        CASE c.topic_type
                                            WHEN 'cashtag' THEN 0.74
                                            WHEN 'hashtag' THEN 0.67
                                            WHEN 'entity' THEN 0.56
                                            ELSE 0.40
                                        END
                                        + (c.quality_score * 0.20)
                                        + (c.alias_confidence * 0.18)
                                        + CASE WHEN tok.token_count >= 2 THEN 0.12 ELSE 0 END
                                        + CASE
                                            WHEN c.topic_key IN (SELECT token FROM acronym_allowlist) THEN 0.12
                                            ELSE 0
                                          END
                                        - ((tok.weak_count::double precision / NULLIF(tok.token_count, 0)) * 0.48)
                                        - ((tok.noise_count::double precision / NULLIF(tok.token_count, 0)) * 0.70)
                                        - ((tok.url_count::double precision / NULLIF(tok.token_count, 0)) * 1.00)
                                        - CASE
                                            WHEN tok.token_count = 1
                                              AND c.topic_key NOT IN (SELECT token FROM acronym_allowlist)
                                              AND LENGTH(c.topic_key) < 4
                                                THEN 0.32
                                            ELSE 0
                                          END
                                    )
                                )
                            ) AS topic_confidence
                        FROM canonicalized c
                        CROSS JOIN LATERAL (
                            SELECT
                                COALESCE(ARRAY_LENGTH(string_to_array(c.topic_key, ' '), 1), 0)::int AS token_count,
                                COALESCE((
                                    SELECT COUNT(*)
                                    FROM unnest(string_to_array(c.topic_key, ' ')) AS t(token)
                                    WHERE t.token IN (SELECT token FROM weak_topic_tokens)
                                ), 0)::int AS weak_count,
                                COALESCE((
                                    SELECT COUNT(*)
                                    FROM unnest(string_to_array(c.topic_key, ' ')) AS t(token)
                                    WHERE t.token IN (SELECT token FROM topic_noise_tokens)
                                ), 0)::int AS noise_count,
                                COALESCE((
                                    SELECT COUNT(*)
                                    FROM unnest(string_to_array(c.topic_key, ' ')) AS t(token)
                                    WHERE t.token IN (SELECT token FROM number_word_tokens)
                                ), 0)::int AS number_count,
                                COALESCE((
                                    SELECT COUNT(*)
                                    FROM unnest(string_to_array(c.topic_key, ' ')) AS t(token)
                                    WHERE t.token IN (SELECT token FROM url_debris_tokens)
                                ), 0)::int AS url_count,
                                COALESCE((
                                    SELECT COUNT(*)
                                    FROM unnest(string_to_array(c.topic_key, ' ')) AS t(token)
                                    WHERE t.token <> ''
                                      AND t.token NOT IN (SELECT token FROM weak_topic_tokens)
                                      AND t.token NOT IN (SELECT token FROM topic_noise_tokens)
                                      AND t.token NOT IN (SELECT token FROM number_word_tokens)
                                      AND t.token NOT IN (SELECT token FROM url_debris_tokens)
                                      AND (
                                          LENGTH(t.token) >= 4
                                          OR t.token IN (SELECT token FROM acronym_allowlist)
                                      )
                                ), 0)::int AS informative_count
                        ) tok
                    ),
                    mention_candidates AS (
                        SELECT
                            *
                        FROM scored
                        WHERE topic_key <> ''
                          AND topic_key NOT IN ('all', 'general', 'digit')
                          AND NOT (topic_text_lc LIKE 'digit:%%in words:%%')
                          AND length(replace(topic_key, ' ', '')) >= 2
                          AND topic_key !~ '^[0-9]+$'
                          AND topic_key !~* '(^| )(https?|www|com|co|t|ly|amp)( |$)'
                          AND topic_key !~* '(^| )([a-z0-9]+bot)( |$)'
                          AND topic_key !~* '(area|forecast|discussion).*(afd|airnow|aqi)'
                          AND topic_key !~* '(additional|details) here'
                          AND number_count < token_count
                          AND informative_count >= 1
                          AND url_count = 0
                          AND topic_confidence >= CASE
                              WHEN topic_type = 'cashtag' THEN 0.34
                              WHEN topic_type = 'hashtag' THEN 0.38
                              WHEN topic_type = 'entity' THEN 0.45
                              ELSE 0.62
                          END
                    ),
                    deduped AS (
                        SELECT DISTINCT ON (raw_post_id, platform, topic_key)
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
                            topic_confidence,
                            is_repost,
                            is_reply,
                            has_link
                        FROM mention_candidates
                        ORDER BY raw_post_id, platform, topic_key, topic_confidence DESC, quality_score DESC, event_timestamp DESC
                    )
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
                        topic_confidence,
                        is_repost,
                        is_reply,
                        has_link
                    )
                    SELECT
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
                        topic_confidence,
                        is_repost,
                        is_reply,
                        has_link
                    FROM deduped
                    ON CONFLICT (raw_post_id, platform, topic_key) DO UPDATE
                    SET processed_post_id = COALESCE(EXCLUDED.processed_post_id, public.post_topic_mentions.processed_post_id),
                        topic_label = COALESCE(EXCLUDED.topic_label, public.post_topic_mentions.topic_label),
                        event_timestamp = GREATEST(public.post_topic_mentions.event_timestamp, EXCLUDED.event_timestamp),
                        ingested_at = GREATEST(public.post_topic_mentions.ingested_at, EXCLUDED.ingested_at),
                        author_id = COALESCE(EXCLUDED.author_id, public.post_topic_mentions.author_id),
                        sentiment_label = EXCLUDED.sentiment_label,
                        quality_score = EXCLUDED.quality_score,
                        topic_confidence = GREATEST(public.post_topic_mentions.topic_confidence, EXCLUDED.topic_confidence),
                        is_repost = EXCLUDED.is_repost,
                        is_reply = EXCLUDED.is_reply,
                        has_link = EXCLUDED.has_link
                    """
                    ,
                    (
                        lookback_hours,
                        lookback_hours,
                        weak_tokens,
                        noise_tokens,
                        number_tokens,
                        url_debris_tokens,
                        acronym_tokens,
                    ),
                )
                return int(cursor.rowcount or 0)

        return self._execute_write("sync_post_topic_mentions_from_post_topics", operation)

    def refresh_stable_topic_read_models(
        self,
        *,
        lag_minutes: int = 3,
        recompute_hours: int = 48,
        series_max_topics: int = 300,
        series_min_mentions: int = 2,
        statement_timeout_seconds: float | None = None,
    ) -> dict[str, Any]:
        lag_minutes = max(1, int(lag_minutes))
        recompute_hours = max(1, int(recompute_hours))
        series_max_topics = max(25, int(series_max_topics))
        series_min_mentions = max(1, int(series_min_mentions))

        def refresh_day_totals(cursor: Any, day_value: date) -> int:
            cursor.execute(
                """
                DELETE FROM public.topic_day_totals
                WHERE day = %s
                """,
                (day_value,),
            )
            cursor.execute(
                """
                WITH mention_labels AS (
                    SELECT topic_key, topic_label
                    FROM (
                        SELECT
                            m.topic_key,
                            NULLIF(BTRIM(m.topic_label), '') AS topic_label,
                            ROW_NUMBER() OVER (
                                PARTITION BY m.topic_key
                                ORDER BY COUNT(*) DESC, LENGTH(NULLIF(BTRIM(m.topic_label), '')) DESC, NULLIF(BTRIM(m.topic_label), '') ASC
                            ) AS label_rank
                        FROM public.post_topic_mentions m
                        WHERE (m.event_timestamp AT TIME ZONE 'utc')::date = %s::date
                          AND COALESCE(m.topic_confidence, 0) >= 0.34
                          AND NULLIF(BTRIM(m.topic_label), '') IS NOT NULL
                        GROUP BY m.topic_key, NULLIF(BTRIM(m.topic_label), '')
                    ) ranked
                    WHERE label_rank = 1
                )
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
                    avg_topic_confidence,
                    first_seen_at,
                    last_seen_at,
                    updated_at
                )
                SELECT
                    %s::date AS day,
                    b.topic_key,
                    COALESCE(t.canonical_label, ml.topic_label, INITCAP(b.topic_key)) AS topic_label,
                    COUNT(DISTINCT b.platform)::int AS platform_count,
                    SUM(b.mention_count)::int AS total_mentions,
                    SUM(b.unique_posts)::int AS unique_posts,
                    SUM(b.unique_authors)::int AS unique_authors,
                    SUM(b.positive_count)::int AS positive_count,
                    SUM(b.neutral_count)::int AS neutral_count,
                    SUM(b.negative_count)::int AS negative_count,
                    CASE
                        WHEN SUM(b.mention_count) > 0
                            THEN SUM(b.avg_topic_confidence * b.mention_count)::double precision
                                 / SUM(b.mention_count)::double precision
                        ELSE 0::double precision
                    END AS avg_topic_confidence,
                    MIN(b.bucket_minute) AS first_seen_at,
                    MAX(b.bucket_minute) AS last_seen_at,
                    now() AS updated_at
                FROM public.topic_buckets_1m_final b
                LEFT JOIN public.topics t
                  ON t.topic_key = b.topic_key
                LEFT JOIN mention_labels ml
                  ON ml.topic_key = b.topic_key
                WHERE (b.bucket_minute AT TIME ZONE 'utc')::date = %s::date
                GROUP BY b.topic_key, COALESCE(t.canonical_label, ml.topic_label, INITCAP(b.topic_key))
                HAVING SUM(b.mention_count) >= 2
                """,
                (day_value, day_value, day_value),
            )
            return int(cursor.rowcount or 0)

        def refresh_day_series(cursor: Any, day_value: date) -> int:
            cursor.execute(
                """
                DELETE FROM public.topic_day_series_5m
                WHERE day = %s
                """,
                (day_value,),
            )
            cursor.execute(
                """
                WITH day_bounds AS (
                    SELECT
                        (%s::date::text || ' 00:00:00+00')::timestamptz AS day_start,
                        ((%s::date + 1)::text || ' 00:00:00+00')::timestamptz AS day_end
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
                    WHERE d.day = %s::date
                      AND d.total_mentions >= %s
                    ORDER BY d.total_mentions DESC, d.topic_key ASC
                    LIMIT %s
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
                    JOIN topics_of_day td
                      ON td.topic_key = b.topic_key
                    GROUP BY 1, 2
                ),
                filled AS (
                    SELECT
                        %s::date AS day,
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
                FROM filled
                """,
                (
                    day_value,
                    day_value,
                    day_value,
                    series_min_mentions,
                    series_max_topics,
                    day_value,
                ),
            )
            return int(cursor.rowcount or 0)

        def refresh_rolling_24h(cursor: Any, *, window_start: datetime, window_end: datetime) -> int:
            cursor.execute("DELETE FROM public.topic_rolling_24h")
            cursor.execute(
                """
                WITH mention_labels AS (
                    SELECT topic_key, topic_label
                    FROM (
                        SELECT
                            m.topic_key,
                            NULLIF(BTRIM(m.topic_label), '') AS topic_label,
                            ROW_NUMBER() OVER (
                                PARTITION BY m.topic_key
                                ORDER BY COUNT(*) DESC, LENGTH(NULLIF(BTRIM(m.topic_label), '')) DESC, NULLIF(BTRIM(m.topic_label), '') ASC
                            ) AS label_rank
                        FROM public.post_topic_mentions m
                        WHERE m.event_timestamp >= %s::timestamptz
                          AND m.event_timestamp < %s::timestamptz
                          AND COALESCE(m.topic_confidence, 0) >= 0.34
                          AND NULLIF(BTRIM(m.topic_label), '') IS NOT NULL
                        GROUP BY m.topic_key, NULLIF(BTRIM(m.topic_label), '')
                    ) ranked
                    WHERE label_rank = 1
                )
                INSERT INTO public.topic_rolling_24h (
                    topic_key,
                    topic_label,
                    platform_count,
                    total_mentions,
                    unique_posts,
                    unique_authors,
                    positive_count,
                    neutral_count,
                    negative_count,
                    avg_topic_confidence,
                    first_seen_at,
                    last_seen_at,
                    window_start,
                    window_end,
                    updated_at
                )
                SELECT
                    m.topic_key,
                    COALESCE(t.canonical_label, ml.topic_label, INITCAP(m.topic_key)) AS topic_label,
                    COUNT(DISTINCT m.platform)::int AS platform_count,
                    COUNT(*)::int AS total_mentions,
                    COUNT(DISTINCT m.raw_post_id)::int AS unique_posts,
                    COUNT(DISTINCT NULLIF(m.author_id, ''))::int AS unique_authors,
                    SUM(CASE WHEN m.sentiment_label = 'positive' THEN 1 ELSE 0 END)::int AS positive_count,
                    SUM(CASE WHEN m.sentiment_label = 'neutral' THEN 1 ELSE 0 END)::int AS neutral_count,
                    SUM(CASE WHEN m.sentiment_label = 'negative' THEN 1 ELSE 0 END)::int AS negative_count,
                    AVG(COALESCE(m.topic_confidence, 0))::double precision AS avg_topic_confidence,
                    MIN(m.event_timestamp) AS first_seen_at,
                    MAX(m.event_timestamp) AS last_seen_at,
                    %s::timestamptz AS window_start,
                    %s::timestamptz AS window_end,
                    now() AS updated_at
                FROM public.post_topic_mentions m
                LEFT JOIN public.topics t
                  ON t.topic_key = m.topic_key
                LEFT JOIN mention_labels ml
                  ON ml.topic_key = m.topic_key
                WHERE m.event_timestamp >= %s::timestamptz
                  AND m.event_timestamp < %s::timestamptz
                  AND COALESCE(m.topic_confidence, 0) >= 0.34
                GROUP BY m.topic_key, t.canonical_label, ml.topic_label
                HAVING COUNT(*) >= 2
                """,
                (window_start, window_end, window_start, window_end, window_start, window_end),
            )
            return int(cursor.rowcount or 0)

        def operation(connection: psycopg.Connection[Any]) -> dict[str, Any]:
            with connection.cursor() as cursor:
                self._apply_statement_timeout(cursor, statement_timeout_seconds)
                cursor.execute(
                    """
                    SELECT
                        to_regclass('public.post_topic_mentions'),
                        to_regclass('public.topic_buckets_1m_final'),
                        to_regclass('public.topic_day_totals'),
                        to_regclass('public.topic_day_series_5m'),
                        to_regclass('public.topic_rolling_24h'),
                        to_regclass('public.topic_read_model_state')
                    """
                )
                tables = cursor.fetchone() or (None, None, None, None, None, None)
                if not all(tables):
                    return {
                        "skipped": True,
                        "reason": "missing_stable_read_model_tables",
                        "refreshed_at": datetime.now(timezone.utc).isoformat(),
                    }

                cursor.execute(
                    """
                    WITH computed AS (
                        SELECT
                            date_trunc('minute', now() - make_interval(mins => %s)) AS finalize_before,
                            date_trunc('minute', now() - make_interval(hours => %s)) AS hard_recompute_from,
                            (
                                SELECT last_finalize_before
                                FROM public.topic_read_model_state
                                WHERE id = 1
                            ) AS last_finalize_before
                    ),
                    bounded AS (
                        SELECT
                            finalize_before,
                            GREATEST(
                                hard_recompute_from,
                                COALESCE(last_finalize_before - interval '45 minute', hard_recompute_from)
                            ) AS recompute_from
                        FROM computed
                    )
                    SELECT finalize_before, recompute_from
                    FROM bounded
                    """,
                    (lag_minutes, recompute_hours),
                )
                bounds_row = cursor.fetchone() or (None, None)
                finalize_before = bounds_row[0]
                recompute_from = bounds_row[1]
                if not isinstance(finalize_before, datetime) or not isinstance(recompute_from, datetime):
                    return {
                        "skipped": True,
                        "reason": "missing_refresh_bounds",
                        "refreshed_at": datetime.now(timezone.utc).isoformat(),
                    }
                if recompute_from >= finalize_before:
                    recompute_from = finalize_before - timedelta(minutes=1)

                cursor.execute(
                    """
                    DELETE FROM public.topic_buckets_1m_final
                    WHERE bucket_minute >= %s::timestamptz
                      AND bucket_minute < %s::timestamptz
                    """,
                    (recompute_from, finalize_before),
                )
                cursor.execute(
                    """
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
                        avg_topic_confidence,
                        finalized_at
                    )
                    SELECT
                        date_trunc('minute', m.event_timestamp) AS bucket_minute,
                        m.platform,
                        m.topic_key,
                        COUNT(*)::int AS mention_count,
                        COUNT(DISTINCT m.raw_post_id)::int AS unique_posts,
                        COUNT(DISTINCT NULLIF(m.author_id, ''))::int AS unique_authors,
                        SUM(CASE WHEN m.sentiment_label = 'positive' THEN 1 ELSE 0 END)::int AS positive_count,
                        SUM(CASE WHEN m.sentiment_label = 'neutral' THEN 1 ELSE 0 END)::int AS neutral_count,
                        SUM(CASE WHEN m.sentiment_label = 'negative' THEN 1 ELSE 0 END)::int AS negative_count,
                        AVG(COALESCE(m.topic_confidence, 0))::double precision AS avg_topic_confidence,
                        now() AS finalized_at
                    FROM public.post_topic_mentions m
                    WHERE date_trunc('minute', m.event_timestamp) >= %s::timestamptz
                      AND date_trunc('minute', m.event_timestamp) < %s::timestamptz
                      AND COALESCE(m.topic_confidence, 0) >= 0.34
                    GROUP BY 1, 2, 3
                    ON CONFLICT (bucket_minute, platform, topic_key) DO UPDATE
                    SET mention_count = EXCLUDED.mention_count,
                        unique_posts = EXCLUDED.unique_posts,
                        unique_authors = EXCLUDED.unique_authors,
                        positive_count = EXCLUDED.positive_count,
                        neutral_count = EXCLUDED.neutral_count,
                        negative_count = EXCLUDED.negative_count,
                        avg_topic_confidence = EXCLUDED.avg_topic_confidence,
                        finalized_at = EXCLUDED.finalized_at
                    """,
                    (recompute_from, finalize_before),
                )
                finalized_rows = int(cursor.rowcount or 0)

                cursor.execute(
                    """
                    INSERT INTO public.topic_read_model_state (id, last_finalize_before, updated_at)
                    VALUES (1, %s::timestamptz, now())
                    ON CONFLICT (id) DO UPDATE
                    SET last_finalize_before = EXCLUDED.last_finalize_before,
                        updated_at = now()
                    """,
                    (finalize_before,),
                )

                today_utc = datetime.now(timezone.utc).date()
                yesterday_utc = today_utc - timedelta(days=1)
                totals_today = refresh_day_totals(cursor, today_utc)
                totals_yesterday = refresh_day_totals(cursor, yesterday_utc)
                series_today = refresh_day_series(cursor, today_utc)
                series_yesterday = refresh_day_series(cursor, yesterday_utc)
                rolling_window_end = finalize_before
                rolling_window_start = rolling_window_end - timedelta(hours=24)
                rolling_rows = refresh_rolling_24h(
                    cursor,
                    window_start=rolling_window_start,
                    window_end=rolling_window_end,
                )

                return {
                    "finalized_bucket_rows": finalized_rows,
                    "day_totals_today_rows": totals_today,
                    "day_totals_yesterday_rows": totals_yesterday,
                    "day_series_today_rows": series_today,
                    "day_series_yesterday_rows": series_yesterday,
                    "rolling_24h_rows": rolling_rows,
                    "rolling_window_start": rolling_window_start.isoformat(),
                    "rolling_window_end": rolling_window_end.isoformat(),
                    "refreshed_at": datetime.now(timezone.utc).isoformat(),
                }

        return self._execute_write("refresh_stable_topic_read_models", operation)

    def verify_memecoin_correlation_tables(self) -> dict[str, Any]:
        required_tables = [
            "public.memecoin_assets",
            "public.memecoin_correlation_runs",
            "public.memecoin_market_snapshots",
            "public.memecoin_correlation_results",
            "public.memecoin_correlation_links",
            "public.trend_memecoin_links",
        ]
        required_columns = {
            "memecoin_assets": {
                "pair_address",
                "is_live",
                "last_validated_at",
                "validation_status",
                "validation_reason",
                "last_seen_liquidity_usd",
                "last_seen_volume_h24",
                "last_seen_txns_h24",
                "tradingview_symbol",
                "tradingview_exchange",
                "tradingview_embed_symbol",
                "tv_resolution_status",
                "tv_verified_at",
                "tv_last_checked_at",
                "tv_failure_reason",
                "tv_search_evidence_json",
                "has_verified_tradingview_preview",
            }
        }

        def operation(connection: psycopg.Connection[Any]) -> dict[str, Any]:
            missing: list[str] = []
            missing_columns: dict[str, list[str]] = {}
            with connection.cursor() as cursor:
                for table_name in required_tables:
                    cursor.execute("SELECT to_regclass(%s)", (table_name,))
                    row = cursor.fetchone()
                    if not row or row[0] is None:
                        missing.append(table_name)
                if not missing:
                    for table_name, columns in required_columns.items():
                        cursor.execute(
                            """
                            SELECT column_name
                            FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name = %s
                            """,
                            (table_name,),
                        )
                        available = {str(row[0] or "").strip() for row in cursor.fetchall()}
                        missing_for_table = sorted(columns - available)
                        if missing_for_table:
                            missing_columns[table_name] = missing_for_table
            return {
                "available": len(missing) == 0 and len(missing_columns) == 0,
                "missing_tables": missing,
                "missing_columns": missing_columns,
            }

        return self._run_with_retry("verify_memecoin_correlation_tables", operation)

    def fetch_memecoin_candidate_trends(self, *, limit: int = 80) -> list[dict[str, Any]]:
        normalized_limit = max(1, int(limit))

        def operation(connection: psycopg.Connection[Any]) -> list[dict[str, Any]]:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        to_regclass('public.topic_rolling_24h'),
                        to_regclass('public.topic_ai_enrichments')
                    """
                )
                relations = cursor.fetchone() or (None, None)
                if not relations[0]:
                    return []

                if relations[1]:
                    key_entities_expression = "COALESCE(e.key_entities, '{}'::text[])"
                    if self._expects_json("topic_ai_enrichments", "key_entities"):
                        key_entities_expression = """
                            CASE
                                WHEN jsonb_typeof(COALESCE(e.key_entities, '[]'::jsonb)) = 'array'
                                    THEN COALESCE(
                                        ARRAY(
                                            SELECT jsonb_array_elements_text(
                                                COALESCE(e.key_entities, '[]'::jsonb)
                                            )
                                        ),
                                        ARRAY[]::text[]
                                    )
                                ELSE ARRAY[]::text[]
                            END
                        """
                    fallback_label_select = "NULL::text AS fallback_label"
                    if self._has_column("topic_ai_enrichments", "fallback_label"):
                        fallback_label_select = "fallback_label"
                    name_status_select = "NULL::text AS name_status"
                    if self._has_column("topic_ai_enrichments", "name_status"):
                        name_status_select = "name_status"
                    name_source_select = "NULL::text AS name_source"
                    if self._has_column("topic_ai_enrichments", "name_source"):
                        name_source_select = "name_source"
                    representative_post_count_select = "0::integer AS representative_post_count"
                    if self._has_column("topic_ai_enrichments", "representative_post_count"):
                        representative_post_count_select = "representative_post_count"
                    cursor.execute(
                        f"""
                        SELECT
                            r.topic_key,
                            COALESCE(
                                CASE
                                    WHEN COALESCE(NULLIF(TRIM(e.name_status), ''), '') = 'ready'
                                     AND COALESCE(NULLIF(TRIM(e.name_source), ''), '') IN (
                                        'ai_exact',
                                        'historical_exact',
                                        'historical_alias'
                                     )
                                     AND NULLIF(TRIM(e.canonical_name), '') IS NOT NULL
                                        THEN NULLIF(TRIM(e.canonical_name), '')
                                    ELSE NULL
                                END,
                                NULLIF(TRIM(e.fallback_label), ''),
                                NULLIF(TRIM(e.raw_label), ''),
                                NULLIF(TRIM(r.topic_label), ''),
                                r.topic_key
                            ) AS display_label,
                            NULLIF(TRIM(e.canonical_name), '') AS canonical_name,
                            COALESCE(
                                NULLIF(TRIM(e.raw_label), ''),
                                NULLIF(TRIM(r.topic_label), ''),
                                r.topic_key
                            ) AS raw_label,
                            NULLIF(TRIM(e.fallback_label), '') AS fallback_label,
                            NULLIF(TRIM(e.trend_category), '') AS trend_category,
                            NULLIF(TRIM(e.narrative_summary), '') AS narrative_summary,
                            NULLIF(TRIM(e.context_paragraph), '') AS context_paragraph,
                            {key_entities_expression} AS key_entities,
                            NULLIF(TRIM(e.status), '') AS enrichment_status,
                            COALESCE(e.summary_confidence, 0)::double precision AS summary_confidence,
                            NULLIF(TRIM(e.name_status), '') AS name_status,
                            NULLIF(TRIM(e.name_source), '') AS name_source,
                            COALESCE(e.representative_post_count, 0)::integer AS representative_post_count,
                            r.total_mentions,
                            r.unique_posts,
                            r.unique_authors,
                            r.updated_at,
                            r.window_end
                        FROM public.topic_rolling_24h r
                        LEFT JOIN LATERAL (
                            SELECT
                                canonical_name,
                                raw_label,
                                trend_category,
                                narrative_summary,
                                context_paragraph,
                                key_entities,
                                status,
                                summary_confidence,
                                {fallback_label_select},
                                {name_status_select},
                                {name_source_select},
                                {representative_post_count_select}
                            FROM public.topic_ai_enrichments e
                            WHERE e.topic_key = r.topic_key
                            ORDER BY e.as_of_window_end DESC, e.generated_at DESC, e.id DESC
                            LIMIT 1
                        ) e ON TRUE
                        ORDER BY r.total_mentions DESC, r.unique_posts DESC, r.topic_key ASC
                        LIMIT %s
                        """,
                        (normalized_limit,),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT
                            r.topic_key,
                            COALESCE(
                                NULLIF(TRIM(r.topic_label), ''),
                                r.topic_key
                            ) AS display_label,
                            NULL::text AS canonical_name,
                            COALESCE(
                                NULLIF(TRIM(r.topic_label), ''),
                                r.topic_key
                            ) AS raw_label,
                            NULL::text AS fallback_label,
                            NULL::text AS trend_category,
                            NULL::text AS narrative_summary,
                            NULL::text AS context_paragraph,
                            '{}'::text[] AS key_entities,
                            NULL::text AS enrichment_status,
                            0::double precision AS summary_confidence,
                            NULL::text AS name_status,
                            NULL::text AS name_source,
                            0::integer AS representative_post_count,
                            r.total_mentions,
                            r.unique_posts,
                            r.unique_authors,
                            r.updated_at,
                            r.window_end
                        FROM public.topic_rolling_24h r
                        ORDER BY r.total_mentions DESC, r.unique_posts DESC, r.topic_key ASC
                        LIMIT %s
                        """,
                        (normalized_limit,),
                    )
                rows = cursor.fetchall()

                output: list[dict[str, Any]] = []
                for row in rows:
                    output.append(
                        {
                            "topic_key": str(row[0] or "").strip(),
                            "display_label": str(row[1] or "").strip(),
                            "canonical_name": str(row[2] or "").strip() or None,
                            "raw_label": str(row[3] or "").strip(),
                            "fallback_label": str(row[4] or "").strip() or None,
                            "trend_category": str(row[5] or "").strip() or None,
                            "narrative_summary": str(row[6] or "").strip() or None,
                            "context_paragraph": str(row[7] or "").strip() or None,
                            "key_entities": _normalize_text_list(row[8]),
                            "enrichment_status": str(row[9] or "").strip() or None,
                            "summary_confidence": float(row[10] or 0.0),
                            "name_status": str(row[11] or "").strip() or None,
                            "name_source": str(row[12] or "").strip() or None,
                            "representative_post_count": int(row[13] or 0),
                            "total_mentions": int(row[14] or 0),
                            "unique_posts": int(row[15] or 0),
                            "unique_authors": int(row[16] or 0),
                            "last_seen_at": row[17],
                            "window_end": row[18],
                        }
                    )
            return [row for row in output if row.get("topic_key") and row.get("display_label")]

        return self._run_with_retry("fetch_memecoin_candidate_trends", operation)

    def fetch_memecoin_recent_posts_for_topics(
        self,
        *,
        topic_keys: Sequence[str],
        lookback_hours: int = 36,
        per_topic_limit: int = 60,
    ) -> list[dict[str, Any]]:
        normalized_topic_keys = [
            str(topic_key or "").strip()
            for topic_key in topic_keys
            if str(topic_key or "").strip()
        ]
        if not normalized_topic_keys:
            return []
        normalized_lookback_hours = max(1, int(lookback_hours))
        normalized_per_topic_limit = max(1, int(per_topic_limit))

        def operation(connection: psycopg.Connection[Any]) -> list[dict[str, Any]]:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        to_regclass('public.post_topic_mentions'),
                        to_regclass('public.processed_posts'),
                        to_regclass('public.raw_posts')
                    """
                )
                relations = cursor.fetchone() or (None, None, None)
                if not relations[0]:
                    return []

                cursor.execute(
                    """
                    WITH ranked_posts AS (
                        SELECT
                            m.topic_key,
                            COALESCE(
                                NULLIF(TRIM(pp.normalized_text), ''),
                                NULLIF(TRIM(pp.clean_text), ''),
                                NULLIF(TRIM(rp.text_content), ''),
                                NULLIF(TRIM(rp.raw_text), '')
                            ) AS text_content,
                            COALESCE(pp.cashtags, '{}'::text[]) AS cashtags,
                            COALESCE(pp.hashtags, '{}'::text[]) AS hashtags,
                            COALESCE(pp.key_phrases, '{}'::text[]) AS key_phrases,
                            COALESCE(pp.topic_seeds, '{}'::text[]) AS topic_seeds,
                            COALESCE(pp.tags, '{}'::text[]) AS tags,
                            m.event_timestamp,
                            COALESCE(pp.quality_score, m.quality_score, 0)::double precision AS quality_score,
                            COALESCE(rp.like_count, 0)::int AS like_count,
                            COALESCE(rp.repost_count, 0)::int AS repost_count,
                            COALESCE(rp.reply_count, 0)::int AS reply_count,
                            ROW_NUMBER() OVER (
                                PARTITION BY m.topic_key
                                ORDER BY
                                    m.event_timestamp DESC,
                                    COALESCE(pp.quality_score, m.quality_score, 0) DESC,
                                    m.raw_post_id DESC
                            ) AS topic_row_number
                        FROM public.post_topic_mentions m
                        LEFT JOIN public.processed_posts pp
                          ON pp.id = m.processed_post_id
                        LEFT JOIN public.raw_posts rp
                          ON rp.id = m.raw_post_id
                        WHERE m.topic_key = ANY(%s::text[])
                          AND m.event_timestamp >= now() - make_interval(hours => %s)
                    )
                    SELECT
                        topic_key,
                        text_content,
                        cashtags,
                        hashtags,
                        key_phrases,
                        topic_seeds,
                        tags,
                        event_timestamp,
                        quality_score,
                        like_count,
                        repost_count,
                        reply_count
                    FROM ranked_posts
                    WHERE topic_row_number <= %s
                      AND COALESCE(TRIM(text_content), '') <> ''
                    ORDER BY topic_key ASC, event_timestamp DESC
                    """,
                    (
                        normalized_topic_keys,
                        normalized_lookback_hours,
                        normalized_per_topic_limit,
                    ),
                )
                rows = cursor.fetchall()

            output: list[dict[str, Any]] = []
            for row in rows:
                output.append(
                    {
                        "topic_key": str(row[0] or "").strip(),
                        "text": str(row[1] or "").strip(),
                        "cashtags": list(row[2] or []),
                        "hashtags": list(row[3] or []),
                        "key_phrases": list(row[4] or []),
                        "topic_seeds": list(row[5] or []),
                        "tags": list(row[6] or []),
                        "created_at": row[7],
                        "quality_score": float(row[8] or 0.0),
                        "like_count": int(row[9] or 0),
                        "repost_count": int(row[10] or 0),
                        "reply_count": int(row[11] or 0),
                    }
                )
            return output

        return self._run_with_retry("fetch_memecoin_recent_posts_for_topics", operation)

    def record_memecoin_correlation_run(
        self,
        *,
        run_row: dict[str, Any],
        asset_rows: Sequence[dict[str, Any]],
        market_snapshot_rows: Sequence[dict[str, Any]],
        result_rows: Sequence[dict[str, Any]],
        link_rows: Sequence[dict[str, Any]],
        selected_topic_keys: Sequence[str],
        trend_memecoin_rows: Sequence[dict[str, Any]],
    ) -> dict[str, Any]:
        def operation(connection: psycopg.Connection[Any]) -> dict[str, Any]:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.memecoin_correlation_runs (
                        started_at,
                        completed_at,
                        status,
                        reason,
                        source,
                        active_trend_count,
                        discovery_token_count,
                        eligible_token_count,
                        published_result_count,
                        request_count,
                        cache_hit_count,
                        stale_cache_hit_count,
                        search_query_count,
                        token_batch_count,
                        notes_json
                    ) VALUES (
                        %(started_at)s,
                        %(completed_at)s,
                        %(status)s,
                        %(reason)s,
                        %(source)s,
                        %(active_trend_count)s,
                        %(discovery_token_count)s,
                        %(eligible_token_count)s,
                        %(published_result_count)s,
                        %(request_count)s,
                        %(cache_hit_count)s,
                        %(stale_cache_hit_count)s,
                        %(search_query_count)s,
                        %(token_batch_count)s,
                        %(notes_json)s
                    )
                    RETURNING run_id
                    """,
                    {
                        **run_row,
                        "notes_json": Jsonb(dict(run_row.get("notes_json") or {})),
                    },
                )
                run_id_row = cursor.fetchone()
                if not run_id_row:
                    raise RuntimeError("Failed to insert memecoin correlation run")
                run_id = int(run_id_row[0])

                asset_id_by_key: dict[tuple[str, str], int] = {}
                for row in asset_rows:
                    cursor.execute(
                        """
                        INSERT INTO public.memecoin_assets (
                            chain_id,
                            token_address,
                            pair_address,
                            symbol,
                            name,
                            icon_url,
                            header_url,
                            description,
                            dexscreener_url,
                            is_live,
                            last_validated_at,
                            validation_status,
                            validation_reason,
                            last_seen_liquidity_usd,
                            last_seen_volume_h24,
                            last_seen_txns_h24,
                            websites_json,
                            socials_json,
                            holder_count,
                            metadata_json,
                            tradingview_symbol,
                            tradingview_exchange,
                            tradingview_embed_symbol,
                            tv_resolution_status,
                            tv_verified_at,
                            tv_last_checked_at,
                            tv_failure_reason,
                            tv_search_evidence_json,
                            has_verified_tradingview_preview
                        ) VALUES (
                            %(chain_id)s,
                            %(token_address)s,
                            %(pair_address)s,
                            %(symbol)s,
                            %(name)s,
                            %(icon_url)s,
                            %(header_url)s,
                            %(description)s,
                            %(dexscreener_url)s,
                            %(is_live)s,
                            %(last_validated_at)s,
                            %(validation_status)s,
                            %(validation_reason)s,
                            %(last_seen_liquidity_usd)s,
                            %(last_seen_volume_h24)s,
                            %(last_seen_txns_h24)s,
                            %(websites_json)s,
                            %(socials_json)s,
                            %(holder_count)s,
                            %(metadata_json)s,
                            %(tradingview_symbol)s,
                            %(tradingview_exchange)s,
                            %(tradingview_embed_symbol)s,
                            %(tv_resolution_status)s,
                            %(tv_verified_at)s,
                            %(tv_last_checked_at)s,
                            %(tv_failure_reason)s,
                            %(tv_search_evidence_json)s,
                            %(has_verified_tradingview_preview)s
                        )
                        ON CONFLICT (chain_id, token_address) DO UPDATE
                        SET symbol = EXCLUDED.symbol,
                            name = EXCLUDED.name,
                            pair_address = COALESCE(EXCLUDED.pair_address, public.memecoin_assets.pair_address),
                            icon_url = COALESCE(EXCLUDED.icon_url, public.memecoin_assets.icon_url),
                            header_url = COALESCE(EXCLUDED.header_url, public.memecoin_assets.header_url),
                            description = COALESCE(EXCLUDED.description, public.memecoin_assets.description),
                            dexscreener_url = COALESCE(EXCLUDED.dexscreener_url, public.memecoin_assets.dexscreener_url),
                            is_live = EXCLUDED.is_live,
                            last_validated_at = EXCLUDED.last_validated_at,
                            validation_status = EXCLUDED.validation_status,
                            validation_reason = EXCLUDED.validation_reason,
                            last_seen_liquidity_usd = EXCLUDED.last_seen_liquidity_usd,
                            last_seen_volume_h24 = EXCLUDED.last_seen_volume_h24,
                            last_seen_txns_h24 = EXCLUDED.last_seen_txns_h24,
                            websites_json = EXCLUDED.websites_json,
                            socials_json = EXCLUDED.socials_json,
                            holder_count = EXCLUDED.holder_count,
                            metadata_json = EXCLUDED.metadata_json,
                            tradingview_symbol = EXCLUDED.tradingview_symbol,
                            tradingview_exchange = EXCLUDED.tradingview_exchange,
                            tradingview_embed_symbol = EXCLUDED.tradingview_embed_symbol,
                            tv_resolution_status = EXCLUDED.tv_resolution_status,
                            tv_verified_at = EXCLUDED.tv_verified_at,
                            tv_last_checked_at = EXCLUDED.tv_last_checked_at,
                            tv_failure_reason = EXCLUDED.tv_failure_reason,
                            tv_search_evidence_json = EXCLUDED.tv_search_evidence_json,
                            has_verified_tradingview_preview = EXCLUDED.has_verified_tradingview_preview,
                            updated_at = now()
                        RETURNING asset_id
                        """,
                        {
                            **row,
                            "websites_json": Jsonb(list(row.get("websites_json") or [])),
                            "socials_json": Jsonb(list(row.get("socials_json") or [])),
                            "metadata_json": Jsonb(dict(row.get("metadata_json") or {})),
                            "tv_search_evidence_json": Jsonb(
                                dict(row.get("tv_search_evidence_json") or {})
                            ),
                        },
                    )
                    asset_row = cursor.fetchone()
                    if not asset_row:
                        raise RuntimeError("Failed to upsert memecoin asset")
                    asset_id_by_key[(str(row["chain_id"]), str(row["token_address"]))] = int(asset_row[0])

                snapshot_id_by_key: dict[tuple[str, str, str], int] = {}
                for row in market_snapshot_rows:
                    asset_id = asset_id_by_key.get((str(row["chain_id"]), str(row["token_address"])))
                    if asset_id is None:
                        continue
                    cursor.execute(
                        """
                        INSERT INTO public.memecoin_market_snapshots (
                            run_id,
                            asset_id,
                            pair_address,
                            pair_url,
                            quote_symbol,
                            quote_token_address,
                            quote_token_name,
                            price_usd,
                            liquidity_usd,
                            volume_h24_usd,
                            volume_h6_usd,
                            volume_h1_usd,
                            price_change_h24_pct,
                            price_change_h6_pct,
                            price_change_h1_pct,
                            buys_h24,
                            sells_h24,
                            txns_h24,
                            txns_h6,
                            txns_h1,
                            fdv_usd,
                            market_cap_usd,
                            pair_created_at,
                            market_score,
                            metadata_json
                        ) VALUES (
                            %(run_id)s,
                            %(asset_id)s,
                            %(pair_address)s,
                            %(pair_url)s,
                            %(quote_symbol)s,
                            %(quote_token_address)s,
                            %(quote_token_name)s,
                            %(price_usd)s,
                            %(liquidity_usd)s,
                            %(volume_h24_usd)s,
                            %(volume_h6_usd)s,
                            %(volume_h1_usd)s,
                            %(price_change_h24_pct)s,
                            %(price_change_h6_pct)s,
                            %(price_change_h1_pct)s,
                            %(buys_h24)s,
                            %(sells_h24)s,
                            %(txns_h24)s,
                            %(txns_h6)s,
                            %(txns_h1)s,
                            %(fdv_usd)s,
                            %(market_cap_usd)s,
                            %(pair_created_at)s,
                            %(market_score)s,
                            %(metadata_json)s
                        )
                        RETURNING snapshot_id
                        """,
                        {
                            **row,
                            "run_id": run_id,
                            "asset_id": asset_id,
                            "metadata_json": Jsonb(dict(row.get("metadata_json") or {})),
                        },
                    )
                    snapshot_row = cursor.fetchone()
                    if not snapshot_row:
                        raise RuntimeError("Failed to insert memecoin market snapshot")
                    snapshot_id_by_key[
                        (str(row["chain_id"]), str(row["token_address"]), str(row["pair_address"]))
                    ] = int(snapshot_row[0])

                for row in result_rows:
                    asset_id = asset_id_by_key.get((str(row["chain_id"]), str(row["token_address"])))
                    snapshot_id = snapshot_id_by_key.get(
                        (str(row["chain_id"]), str(row["token_address"]), str(row["pair_address"]))
                    )
                    if asset_id is None:
                        continue
                    cursor.execute(
                        """
                        INSERT INTO public.memecoin_correlation_results (
                            run_id,
                            asset_id,
                            market_snapshot_id,
                            rank,
                            correlation_score,
                            correlation_label,
                            strongest_topic_key,
                            strongest_topic_label,
                            strongest_trend_category,
                            strongest_narrative_summary,
                            market_score,
                            lexical_score,
                            mention_score,
                            timing_score,
                            culture_fit_score,
                            support_post_count,
                            support_interaction_score,
                            is_political_dominant,
                            dexscreener_url
                        ) VALUES (
                            %(run_id)s,
                            %(asset_id)s,
                            %(market_snapshot_id)s,
                            %(rank)s,
                            %(correlation_score)s,
                            %(correlation_label)s,
                            %(strongest_topic_key)s,
                            %(strongest_topic_label)s,
                            %(strongest_trend_category)s,
                            %(strongest_narrative_summary)s,
                            %(market_score)s,
                            %(lexical_score)s,
                            %(mention_score)s,
                            %(timing_score)s,
                            %(culture_fit_score)s,
                            %(support_post_count)s,
                            %(support_interaction_score)s,
                            %(is_political_dominant)s,
                            %(dexscreener_url)s
                        )
                        """,
                        {
                            **row,
                            "run_id": run_id,
                            "asset_id": asset_id,
                            "market_snapshot_id": snapshot_id,
                        },
                    )

                for row in link_rows:
                    asset_id = asset_id_by_key.get((str(row["chain_id"]), str(row["token_address"])))
                    if asset_id is None:
                        continue
                    cursor.execute(
                        """
                        INSERT INTO public.memecoin_correlation_links (
                            run_id,
                            asset_id,
                            topic_key,
                            topic_label,
                            trend_category,
                            narrative_summary,
                            lexical_score,
                            mention_score,
                            timing_score,
                            culture_fit_score,
                            link_score,
                            support_post_count,
                            support_interaction_score,
                            is_primary,
                            why_linked,
                            match_reasons_json,
                            raw_match_signals_json
                        ) VALUES (
                            %(run_id)s,
                            %(asset_id)s,
                            %(topic_key)s,
                            %(topic_label)s,
                            %(trend_category)s,
                            %(narrative_summary)s,
                            %(lexical_score)s,
                            %(mention_score)s,
                            %(timing_score)s,
                            %(culture_fit_score)s,
                            %(link_score)s,
                            %(support_post_count)s,
                            %(support_interaction_score)s,
                            %(is_primary)s,
                            %(why_linked)s,
                            %(match_reasons_json)s,
                            %(raw_match_signals_json)s
                        )
                        """,
                        {
                            **row,
                            "run_id": run_id,
                            "asset_id": asset_id,
                            "match_reasons_json": Jsonb(
                                row.get("match_reasons_json")
                                if isinstance(row.get("match_reasons_json"), list)
                                else []
                            ),
                            "raw_match_signals_json": Jsonb(
                                row.get("raw_match_signals_json")
                                if isinstance(row.get("raw_match_signals_json"), dict)
                                else {}
                            ),
                        },
                    )

                normalized_status = str(run_row.get("status") or "").strip().lower()
                if normalized_status in {"succeeded", "completed_no_results"}:
                    cursor.execute(
                        """
                        DELETE FROM public.trend_memecoin_links
                        """,
                    )

                for row in trend_memecoin_rows:
                    cursor.execute(
                        """
                        INSERT INTO public.trend_memecoin_links (
                            topic_key,
                            topic_label,
                            rank,
                            chain_id,
                            coin_address,
                            pair_address,
                            dexscreener_url,
                            coin_symbol,
                            coin_name,
                            confidence_score,
                            confidence_band,
                            mention_count,
                            engagement_score,
                            age_hours,
                            liquidity,
                            volume_24h,
                            market_score,
                            memecoin_fit_score,
                            why_linked,
                            match_reasons_json,
                            raw_match_signals_json,
                            source_run_id,
                            last_updated_at
                        ) VALUES (
                            %(topic_key)s,
                            %(topic_label)s,
                            %(rank)s,
                            %(chain_id)s,
                            %(coin_address)s,
                            %(pair_address)s,
                            %(dexscreener_url)s,
                            %(coin_symbol)s,
                            %(coin_name)s,
                            %(confidence_score)s,
                            %(confidence_band)s,
                            %(mention_count)s,
                            %(engagement_score)s,
                            %(age_hours)s,
                            %(liquidity)s,
                            %(volume_24h)s,
                            %(market_score)s,
                            %(memecoin_fit_score)s,
                            %(why_linked)s,
                            %(match_reasons_json)s,
                            %(raw_match_signals_json)s,
                            %(source_run_id)s,
                            now()
                        )
                        """,
                        {
                            **row,
                            "match_reasons_json": Jsonb(
                                row.get("match_reasons_json")
                                if isinstance(row.get("match_reasons_json"), list)
                                else []
                            ),
                            "raw_match_signals_json": Jsonb(
                                row.get("raw_match_signals_json")
                                if isinstance(row.get("raw_match_signals_json"), dict)
                                else {}
                            ),
                            "source_run_id": run_id,
                        },
                    )

                return {
                    "run_id": run_id,
                    "asset_count": len(asset_id_by_key),
                    "snapshot_count": len(snapshot_id_by_key),
                    "result_count": len(result_rows),
                    "link_count": len(link_rows),
                    "trend_memecoin_count": len(trend_memecoin_rows),
                }

        return self._execute_write("record_memecoin_correlation_run", operation)

    def fetch_memecoin_tradingview_states(
        self,
        *,
        asset_keys: Sequence[tuple[str, str]],
    ) -> dict[tuple[str, str], dict[str, Any]]:
        normalized_keys = [
            (str(chain_id or "").strip().lower(), str(token_address or "").strip())
            for chain_id, token_address in asset_keys
            if str(chain_id or "").strip() and str(token_address or "").strip()
        ]
        if not normalized_keys:
            return {}
        if not self._has_column("memecoin_assets", "has_verified_tradingview_preview"):
            return {}

        unique_chains = sorted({chain_id for chain_id, _token_address in normalized_keys})
        unique_addresses = sorted({token_address for _chain_id, token_address in normalized_keys})
        key_set = set(normalized_keys)

        def operation(connection: psycopg.Connection[Any]) -> dict[tuple[str, str], dict[str, Any]]:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        chain_id,
                        token_address,
                        tradingview_symbol,
                        tradingview_exchange,
                        tradingview_embed_symbol,
                        tv_resolution_status,
                        tv_verified_at,
                        tv_last_checked_at,
                        tv_failure_reason,
                        tv_search_evidence_json,
                        has_verified_tradingview_preview
                    FROM public.memecoin_assets
                    WHERE chain_id = ANY(%s::text[])
                      AND token_address = ANY(%s::text[])
                    """,
                    (unique_chains, unique_addresses),
                )
                rows = cursor.fetchall()

            output: dict[tuple[str, str], dict[str, Any]] = {}
            for row in rows:
                key = (str(row[0] or "").strip().lower(), str(row[1] or "").strip())
                if key not in key_set:
                    continue
                output[key] = {
                    "chain_id": key[0],
                    "token_address": key[1],
                    "tradingview_symbol": str(row[2] or "").strip() or None,
                    "tradingview_exchange": str(row[3] or "").strip() or None,
                    "tradingview_embed_symbol": str(row[4] or "").strip() or None,
                    "tv_resolution_status": str(row[5] or "").strip() or None,
                    "tv_verified_at": row[6].isoformat() if row[6] else None,
                    "tv_last_checked_at": row[7].isoformat() if row[7] else None,
                    "tv_failure_reason": str(row[8] or "").strip() or None,
                    "tv_search_evidence_json": dict(row[9] or {}) if isinstance(row[9], dict) else {},
                    "has_verified_tradingview_preview": bool(row[10]),
                }
            return output

        return self._run_with_retry("fetch_memecoin_tradingview_states", operation)

    def upsert_memecoin_tradingview_preview_states(
        self,
        *,
        rows: Sequence[dict[str, Any]],
    ) -> int:
        normalized_rows = [
            row
            for row in rows
            if str(row.get("chain_id") or "").strip()
            and str(row.get("token_address") or "").strip()
        ]
        if not normalized_rows:
            return 0
        if not self._has_column("memecoin_assets", "has_verified_tradingview_preview"):
            raise RuntimeError(
                "memecoin TradingView preview columns are missing; apply the TradingView preview migration first"
            )

        def operation(connection: psycopg.Connection[Any]) -> int:
            updated = 0
            with connection.cursor() as cursor:
                for row in normalized_rows:
                    cursor.execute(
                        """
                        UPDATE public.memecoin_assets
                        SET tradingview_symbol = %(tradingview_symbol)s,
                            tradingview_exchange = %(tradingview_exchange)s,
                            tradingview_embed_symbol = %(tradingview_embed_symbol)s,
                            tv_resolution_status = %(tv_resolution_status)s,
                            tv_verified_at = %(tv_verified_at)s,
                            tv_last_checked_at = %(tv_last_checked_at)s,
                            tv_failure_reason = %(tv_failure_reason)s,
                            tv_search_evidence_json = %(tv_search_evidence_json)s,
                            has_verified_tradingview_preview = %(has_verified_tradingview_preview)s,
                            metadata_json = COALESCE(metadata_json, '{}'::jsonb) || %(metadata_patch)s,
                            updated_at = now()
                        WHERE chain_id = %(chain_id)s
                          AND token_address = %(token_address)s
                        """,
                        {
                            **row,
                            "tv_search_evidence_json": Jsonb(
                                dict(row.get("tv_search_evidence_json") or {})
                            ),
                            "metadata_patch": Jsonb(
                                {
                                    "tradingview_symbol": row.get("tradingview_symbol"),
                                    "tradingview_exchange": row.get("tradingview_exchange"),
                                    "tradingview_embed_symbol": row.get("tradingview_embed_symbol"),
                                    "tv_resolution_status": row.get("tv_resolution_status"),
                                    "tv_failure_reason": row.get("tv_failure_reason"),
                                    "has_verified_tradingview_preview": bool(
                                        row.get("has_verified_tradingview_preview")
                                    ),
                                }
                            ),
                        },
                    )
                    updated += int(cursor.rowcount or 0)
            return updated

        return self._execute_write("upsert_memecoin_tradingview_preview_states", operation)

    def fetch_memecoin_preview_backfill_candidates(
        self,
        *,
        limit: int = 500,
        unresolved_only: bool = True,
    ) -> list[dict[str, Any]]:
        normalized_limit = max(1, int(limit))
        if not self._has_column("memecoin_assets", "has_verified_tradingview_preview"):
            raise RuntimeError(
                "memecoin TradingView preview columns are missing; apply the TradingView preview migration first"
            )

        unresolved_filter = (
            "AND COALESCE(a.has_verified_tradingview_preview, FALSE) = FALSE"
            if unresolved_only
            else ""
        )

        def operation(connection: psycopg.Connection[Any]) -> list[dict[str, Any]]:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    WITH recent_runs AS (
                        SELECT run_id, completed_at
                        FROM public.memecoin_correlation_runs
                        WHERE status = 'succeeded'
                          AND published_result_count > 0
                        ORDER BY completed_at DESC, run_id DESC
                        LIMIT 12
                    ),
                    recent_assets AS (
                        SELECT
                            r.asset_id,
                            MAX(rr.completed_at) AS last_published_at
                        FROM public.memecoin_correlation_results r
                        INNER JOIN recent_runs rr
                          ON rr.run_id = r.run_id
                        GROUP BY r.asset_id
                    )
                    SELECT
                        a.chain_id,
                        a.token_address,
                        a.symbol,
                        a.name,
                        a.dexscreener_url,
                        a.tradingview_symbol,
                        a.tradingview_exchange,
                        a.tradingview_embed_symbol,
                        a.tv_resolution_status,
                        a.tv_verified_at,
                        a.tv_last_checked_at,
                        a.tv_failure_reason,
                        a.tv_search_evidence_json,
                        a.has_verified_tradingview_preview,
                        s.pair_address,
                        s.pair_url,
                        s.quote_symbol,
                        s.quote_token_name,
                        s.metadata_json
                    FROM public.memecoin_assets a
                    LEFT JOIN recent_assets ra
                      ON ra.asset_id = a.asset_id
                    LEFT JOIN LATERAL (
                        SELECT
                            pair_address,
                            pair_url,
                            quote_symbol,
                            quote_token_name,
                            metadata_json
                        FROM public.memecoin_market_snapshots s
                        WHERE s.asset_id = a.asset_id
                        ORDER BY s.recorded_at DESC, s.snapshot_id DESC
                        LIMIT 1
                    ) s ON TRUE
                    WHERE 1 = 1
                    {unresolved_filter}
                    ORDER BY
                        CASE WHEN ra.asset_id IS NULL THEN 1 ELSE 0 END ASC,
                        COALESCE(ra.last_published_at, a.updated_at, a.created_at) DESC,
                        COALESCE(a.tv_last_checked_at, a.updated_at, a.created_at) ASC,
                        a.updated_at DESC,
                        a.asset_id DESC
                    LIMIT %s
                    """,
                    (normalized_limit,),
                )
                rows = cursor.fetchall()

            output: list[dict[str, Any]] = []
            for row in rows:
                market_metadata = dict(row[18] or {}) if isinstance(row[18], dict) else {}
                output.append(
                    {
                        "chain_id": str(row[0] or "").strip().lower(),
                        "token_address": str(row[1] or "").strip(),
                        "symbol": str(row[2] or "").strip(),
                        "name": str(row[3] or "").strip(),
                        "dexscreener_url": str(row[4] or row[15] or "").strip() or None,
                        "tradingview_symbol": str(row[5] or "").strip() or None,
                        "tradingview_exchange": str(row[6] or "").strip() or None,
                        "tradingview_embed_symbol": str(row[7] or "").strip() or None,
                        "tv_resolution_status": str(row[8] or "").strip() or None,
                        "tv_verified_at": row[9].isoformat() if row[9] else None,
                        "tv_last_checked_at": row[10].isoformat() if row[10] else None,
                        "tv_failure_reason": str(row[11] or "").strip() or None,
                        "tv_search_evidence_json": dict(row[12] or {}) if isinstance(row[12], dict) else {},
                        "has_verified_tradingview_preview": bool(row[13]),
                        "pair_address": str(row[14] or "").strip() or None,
                        "pair_url": str(row[15] or "").strip() or None,
                        "quote_symbol": str(row[16] or "").strip() or None,
                        "quote_token_name": str(row[17] or "").strip() or None,
                        "dex_id": str(
                            market_metadata.get("dex_id") or market_metadata.get("dexId") or ""
                        ).strip()
                        or None,
                        "pair_labels": _normalize_text_list(
                            market_metadata.get("pair_labels") or market_metadata.get("pairLabels")
                        ),
                    }
                )
            return output

        return self._run_with_retry("fetch_memecoin_preview_backfill_candidates", operation)

    def fetch_recent_memecoin_publication_stats(
        self,
        *,
        limit_runs: int = 8,
    ) -> list[dict[str, Any]]:
        normalized_limit = max(1, int(limit_runs))

        def operation(connection: psycopg.Connection[Any]) -> list[dict[str, Any]]:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    WITH recent_runs AS (
                        SELECT run_id, completed_at
                        FROM public.memecoin_correlation_runs
                        WHERE status = 'succeeded'
                          AND published_result_count > 0
                        ORDER BY completed_at DESC, run_id DESC
                        LIMIT %s
                    )
                    SELECT
                        rr.run_id,
                        rr.completed_at,
                        a.chain_id,
                        a.token_address,
                        a.symbol,
                        a.name,
                        r.rank,
                        r.correlation_score,
                        r.strongest_topic_key,
                        r.strongest_topic_label
                    FROM recent_runs rr
                    INNER JOIN public.memecoin_correlation_results r
                      ON r.run_id = rr.run_id
                    INNER JOIN public.memecoin_assets a
                      ON a.asset_id = r.asset_id
                    ORDER BY rr.completed_at DESC, r.rank ASC, r.result_id DESC
                    """,
                    (normalized_limit,),
                )
                rows = cursor.fetchall()

            output: list[dict[str, Any]] = []
            for row in rows:
                output.append(
                    {
                        "run_id": int(row[0] or 0),
                        "completed_at": row[1],
                        "chain_id": str(row[2] or "").strip().lower(),
                        "token_address": str(row[3] or "").strip(),
                        "symbol": str(row[4] or "").strip(),
                        "name": str(row[5] or "").strip(),
                        "rank": int(row[6] or 0),
                        "correlation_score": float(row[7] or 0.0),
                        "strongest_topic_key": str(row[8] or "").strip(),
                        "strongest_topic_label": str(row[9] or "").strip(),
                    }
                )
            return output

        return self._run_with_retry("fetch_recent_memecoin_publication_stats", operation)

    def fetch_top_topics_for_enrichment(
        self,
        *,
        limit: int = 250,
        prioritize_pending_titles: bool = False,
    ) -> list[dict[str, Any]]:
        normalized_limit = max(1, int(limit))

        def operation(connection: psycopg.Connection[Any]) -> list[dict[str, Any]]:
            with connection.cursor() as cursor:
                cursor.execute("SELECT to_regclass('public.topic_rolling_24h')")
                relation = cursor.fetchone()
                if not relation or relation[0] is None:
                    return []
                enrichment_relation = None
                if prioritize_pending_titles:
                    cursor.execute("SELECT to_regclass('public.topic_ai_enrichments')")
                    enrichment_relation = cursor.fetchone()

                if prioritize_pending_titles and enrichment_relation and enrichment_relation[0] is not None:
                    cursor.execute(
                        """
                        SELECT
                            r.topic_key,
                            r.topic_label,
                            r.platform_count,
                            r.total_mentions,
                            r.unique_posts,
                            r.unique_authors,
                            r.positive_count,
                            r.neutral_count,
                            r.negative_count,
                            r.window_start,
                            r.window_end,
                            r.updated_at
                        FROM public.topic_rolling_24h r
                        LEFT JOIN LATERAL (
                            SELECT
                                NULLIF(TRIM(canonical_name), '') AS canonical_name,
                                COALESCE(NULLIF(TRIM(name_status), ''), 'pending') AS name_status,
                                COALESCE(NULLIF(TRIM(name_source), ''), 'none') AS name_source
                            FROM public.topic_ai_enrichments e
                            WHERE e.topic_key = r.topic_key
                            ORDER BY e.as_of_window_end DESC, e.generated_at DESC, e.id DESC
                            LIMIT 1
                        ) latest_name ON TRUE
                        ORDER BY
                            CASE
                                WHEN latest_name.name_status = 'ready'
                                 AND latest_name.name_source IN (
                                    'ai_exact',
                                    'historical_exact',
                                    'historical_alias'
                                 )
                                 AND latest_name.canonical_name IS NOT NULL
                                    THEN 1
                                ELSE 0
                            END ASC,
                            r.total_mentions DESC,
                            r.unique_posts DESC,
                            r.topic_key ASC
                        LIMIT %s
                        """,
                        (normalized_limit,),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT
                            topic_key,
                            topic_label,
                            platform_count,
                            total_mentions,
                            unique_posts,
                            unique_authors,
                            positive_count,
                            neutral_count,
                            negative_count,
                            window_start,
                            window_end,
                            updated_at
                        FROM public.topic_rolling_24h
                        ORDER BY total_mentions DESC, unique_posts DESC, topic_key ASC
                        LIMIT %s
                        """,
                        (normalized_limit,),
                    )
                rows = cursor.fetchall()

            topics: list[dict[str, Any]] = []
            for row in rows:
                topics.append(
                    {
                        "topic_key": str(row[0] or "").strip(),
                        "topic_label": str(row[1] or "").strip(),
                        "platform_count": int(row[2] or 0),
                        "total_mentions": int(row[3] or 0),
                        "unique_posts": int(row[4] or 0),
                        "unique_authors": int(row[5] or 0),
                        "positive_count": int(row[6] or 0),
                        "neutral_count": int(row[7] or 0),
                        "negative_count": int(row[8] or 0),
                        "window_start": row[9],
                        "window_end": row[10],
                        "updated_at": row[11],
                    }
                )

            return [
                row
                for row in topics
                if row.get("topic_key")
            ]

        return self._run_with_retry("fetch_top_topics_for_enrichment", operation)

    def fetch_topic_post_candidates_for_enrichment(
        self,
        *,
        topic_key: str,
        limit: int = 120,
        window_start: datetime | None = None,
        window_end: datetime | None = None,
    ) -> list[dict[str, Any]]:
        normalized_topic_key = str(topic_key or "").strip()
        if not normalized_topic_key:
            return []
        normalized_limit = max(1, int(limit))

        def operation(connection: psycopg.Connection[Any]) -> list[dict[str, Any]]:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        to_regclass('public.post_topic_mentions'),
                        to_regclass('public.processed_posts'),
                        to_regclass('public.raw_posts')
                    """
                )
                relations = cursor.fetchone() or (None, None, None)
                if not relations[0]:
                    return []

                cursor.execute(
                    """
                    SELECT
                        m.raw_post_id,
                        m.processed_post_id,
                        COALESCE(
                            NULLIF(TRIM(rp.source_post_id), ''),
                            NULLIF(TRIM(pp.source_post_id), ''),
                            m.raw_post_id::text
                        ) AS source_post_id,
                        COALESCE(
                            NULLIF(TRIM(rp.platform), ''),
                            NULLIF(TRIM(pp.platform), ''),
                            NULLIF(TRIM(m.platform), ''),
                            'bluesky'
                        ) AS platform,
                        COALESCE(
                            NULLIF(TRIM(pp.normalized_text), ''),
                            NULLIF(TRIM(pp.clean_text), ''),
                            NULLIF(TRIM(rp.text_content), ''),
                            NULLIF(TRIM(rp.raw_text), '')
                        ) AS text_content,
                        COALESCE(NULLIF(TRIM(pp.fingerprint), ''), '') AS fingerprint,
                        COALESCE(pp.quality_score, m.quality_score, 0)::double precision AS quality_score,
                        COALESCE(rp.like_count, 0)::int AS like_count,
                        COALESCE(rp.repost_count, 0)::int AS repost_count,
                        COALESCE(rp.reply_count, 0)::int AS reply_count,
                        COALESCE(
                            NULLIF(rp.metrics_json ->> 'quoteCount', '')::int,
                            NULLIF(rp.metrics_json ->> 'quote_count', '')::int,
                            0
                        )::int AS quote_count,
                        COALESCE(NULLIF(TRIM(m.sentiment_label), ''), 'neutral') AS sentiment_label,
                        COALESCE(
                            NULLIF(TRIM(m.author_id), ''),
                            NULLIF(TRIM(rp.author_id), ''),
                            NULLIF(TRIM(pp.author_id), '')
                        ) AS author_id,
                        m.event_timestamp,
                        COALESCE(m.topic_confidence, 0)::double precision AS topic_confidence,
                        COALESCE(m.is_reply, false) AS is_reply,
                        COALESCE(m.is_repost, false) AS is_repost,
                        COALESCE(m.has_link, false) AS has_link
                    FROM public.post_topic_mentions m
                    LEFT JOIN public.processed_posts pp
                      ON pp.id = m.processed_post_id
                    LEFT JOIN public.raw_posts rp
                      ON rp.id = m.raw_post_id
                    WHERE m.topic_key = %s
                      AND (%s::timestamptz IS NULL OR m.event_timestamp >= %s::timestamptz)
                      AND (%s::timestamptz IS NULL OR m.event_timestamp < %s::timestamptz)
                    ORDER BY
                        m.event_timestamp DESC,
                        COALESCE(pp.quality_score, m.quality_score, 0) DESC,
                        m.raw_post_id DESC
                    LIMIT %s
                    """,
                    (
                        normalized_topic_key,
                        window_start,
                        window_start,
                        window_end,
                        window_end,
                        normalized_limit,
                    ),
                )
                rows = cursor.fetchall()

            candidates: list[dict[str, Any]] = []
            for row in rows:
                candidates.append(
                    {
                        "raw_post_id": row[0],
                        "processed_post_id": row[1],
                        "source_post_id": str(row[2] or "").strip(),
                        "platform": str(row[3] or "bluesky").strip() or "bluesky",
                        "text_content": str(row[4] or "").strip(),
                        "fingerprint": str(row[5] or "").strip(),
                        "quality_score": float(row[6] or 0.0),
                        "like_count": int(row[7] or 0),
                        "repost_count": int(row[8] or 0),
                        "reply_count": int(row[9] or 0),
                        "quote_count": int(row[10] or 0),
                        "sentiment_label": str(row[11] or "neutral").strip() or "neutral",
                        "author_id": str(row[12] or "").strip() or None,
                        "event_timestamp": row[13],
                        "topic_confidence": float(row[14] or 0.0),
                        "is_reply": bool(row[15]),
                        "is_repost": bool(row[16]),
                        "has_link": bool(row[17]),
                    }
                )

            return candidates

        return self._run_with_retry("fetch_topic_post_candidates_for_enrichment", operation)

    def fetch_latest_topic_enrichment_state(
        self,
        *,
        topic_keys: Sequence[str],
    ) -> dict[str, dict[str, Any]]:
        normalized_keys = [
            str(topic_key or "").strip()
            for topic_key in topic_keys
            if str(topic_key or "").strip()
        ]
        if not normalized_keys:
            return {}

        def operation(connection: psycopg.Connection[Any]) -> dict[str, dict[str, Any]]:
            with connection.cursor() as cursor:
                cursor.execute("SELECT to_regclass('public.topic_ai_enrichments')")
                relation = cursor.fetchone()
                if not relation or relation[0] is None:
                    return {}

                cursor.execute(
                    """
                    SELECT DISTINCT ON (topic_key)
                        topic_key,
                        as_of_window_end,
                        canonical_name,
                        ai_display_name,
                        fallback_label,
                        status,
                        name_status,
                        ai_name_status,
                        name_source,
                        short_description,
                        context_paragraph,
                        narrative_summary,
                        why_attention,
                        trend_category,
                        key_entities,
                        abstain_reason,
                        input_hash,
                        prompt_version,
                        model_name,
                        generated_at,
                        ai_name_generated_at,
                        refreshed_at,
                        ai_name_refreshed_at,
                        expires_at,
                        ai_name_source_version,
                        summary_confidence,
                        writer_identity,
                        writer_role,
                        authoritative_writer,
                        deployment_id,
                        instance_id,
                        code_version,
                        refresh_reason,
                        usage_prompt_tokens,
                        usage_completion_tokens,
                        usage_total_tokens,
                        duration_ms,
                        replaced_existing_title,
                        metadata_json
                    FROM public.topic_ai_enrichments
                    WHERE topic_key = ANY(%s::text[])
                    ORDER BY topic_key,
                        CASE
                            WHEN COALESCE(NULLIF(TRIM(name_status), ''), '') = 'ready'
                             AND COALESCE(NULLIF(TRIM(name_source), ''), '') IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(canonical_name), '') IS NOT NULL
                                THEN 0
                            ELSE 1
                        END ASC,
                        CASE
                            WHEN authoritative_writer THEN 0
                            WHEN COALESCE(metadata_json ->> 'authoritative_writer', 'false') = 'true'
                                THEN 0
                            ELSE 1
                        END ASC,
                        as_of_window_end DESC,
                        refreshed_at DESC,
                        generated_at DESC
                    """,
                    (normalized_keys,),
                )
                rows = cursor.fetchall()

                output: dict[str, dict[str, Any]] = {}
            for row in rows:
                topic_key = str(row[0] or "").strip()
                if not topic_key:
                    continue
                output[topic_key] = {
                    "topic_key": topic_key,
                    "as_of_window_end": row[1],
                    "canonical_name": str(row[2] or "").strip() or None,
                    "ai_display_name": str(row[3] or "").strip() or None,
                    "fallback_label": str(row[4] or "").strip() or None,
                    "status": str(row[5] or "").strip() or None,
                    "name_status": str(row[6] or "").strip() or None,
                    "ai_name_status": str(row[7] or "").strip() or None,
                    "name_source": str(row[8] or "").strip() or None,
                    "short_description": str(row[9] or "").strip() or None,
                    "context_paragraph": str(row[10] or "").strip() or None,
                    "narrative_summary": str(row[11] or "").strip() or None,
                    "why_attention": str(row[12] or "").strip() or None,
                    "trend_category": str(row[13] or "").strip() or None,
                    "key_entities": _normalize_text_list(row[14]),
                    "abstain_reason": str(row[15] or "").strip() or None,
                    "input_hash": str(row[16] or "").strip(),
                    "prompt_version": str(row[17] or "").strip(),
                    "model_name": str(row[18] or "").strip(),
                    "generated_at": row[19],
                    "ai_name_generated_at": row[20],
                    "refreshed_at": row[21],
                    "ai_name_refreshed_at": row[22],
                    "expires_at": row[23],
                    "ai_name_source_version": str(row[24] or "").strip() or None,
                    "summary_confidence": float(row[25] or 0.0),
                    "writer_identity": str(row[26] or "").strip() or (
                        str((row[38] or {}).get("writer_identity") or "").strip()
                        if isinstance(row[38], dict)
                        else None
                    ),
                    "writer_role": str(row[27] or "").strip() or (
                        str((row[38] or {}).get("writer_role") or "").strip()
                        if isinstance(row[38], dict)
                        else None
                    ),
                    "authoritative_writer": bool(row[28]),
                    "deployment_id": str(row[29] or "").strip() or None,
                    "instance_id": str(row[30] or "").strip() or None,
                    "code_version": str(row[31] or "").strip() or None,
                    "refresh_reason": str(row[32] or "").strip() or None,
                    "usage_prompt_tokens": int(row[33] or 0),
                    "usage_completion_tokens": int(row[34] or 0),
                    "usage_total_tokens": int(row[35] or 0),
                    "duration_ms": float(row[36] or 0.0),
                    "replaced_existing_title": bool(row[37]),
                }

            return output

        return self._run_with_retry("fetch_latest_topic_enrichment_state", operation)

    def upsert_topic_ai_enrichment(self, row: dict[str, Any]) -> dict[str, Any] | None:
        payload = self._prepare_topic_ai_enrichment_row(row)
        if not payload.get("topic_key"):
            return None

        def operation(connection: psycopg.Connection[Any]) -> dict[str, Any] | None:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.topic_ai_enrichments (
                        topic_key,
                        as_of_window_end,
                        raw_label,
                        canonical_name,
                        ai_display_name,
                        fallback_label,
                        name_status,
                        ai_name_status,
                        name_source,
                        short_description,
                        context_paragraph,
                        narrative_summary,
                        why_attention,
                        status,
                        key_entities,
                        trend_category,
                        summary_confidence,
                        evidence_post_ids,
                        mixed_signals,
                        abstain_reason,
                        validator_errors,
                        validated_output_json,
                        raw_response_text,
                        supporting_post_ids,
                        supporting_sample,
                        representative_post_count,
                        model_name,
                        prompt_version,
                        input_hash,
                        generated_at,
                        ai_name_generated_at,
                        refreshed_at,
                        ai_name_refreshed_at,
                        expires_at,
                        ai_name_source_version,
                        writer_identity,
                        writer_role,
                        authoritative_writer,
                        deployment_id,
                        instance_id,
                        code_version,
                        refresh_reason,
                        usage_prompt_tokens,
                        usage_completion_tokens,
                        usage_total_tokens,
                        duration_ms,
                        replaced_existing_title,
                        metadata_json
                    ) VALUES (
                        %(topic_key)s,
                        %(as_of_window_end)s,
                        %(raw_label)s,
                        %(canonical_name)s,
                        %(ai_display_name)s,
                        %(fallback_label)s,
                        %(name_status)s,
                        %(ai_name_status)s,
                        %(name_source)s,
                        %(short_description)s,
                        %(context_paragraph)s,
                        %(narrative_summary)s,
                        %(why_attention)s,
                        %(status)s,
                        %(key_entities)s,
                        %(trend_category)s,
                        %(summary_confidence)s,
                        %(evidence_post_ids)s,
                        %(mixed_signals)s,
                        %(abstain_reason)s,
                        %(validator_errors)s,
                        %(validated_output_json)s,
                        %(raw_response_text)s,
                        %(supporting_post_ids)s,
                        %(supporting_sample)s,
                        %(representative_post_count)s,
                        %(model_name)s,
                        %(prompt_version)s,
                        %(input_hash)s,
                        %(generated_at)s,
                        %(ai_name_generated_at)s,
                        %(refreshed_at)s,
                        %(ai_name_refreshed_at)s,
                        %(expires_at)s,
                        %(ai_name_source_version)s,
                        %(writer_identity)s,
                        %(writer_role)s,
                        %(authoritative_writer)s,
                        %(deployment_id)s,
                        %(instance_id)s,
                        %(code_version)s,
                        %(refresh_reason)s,
                        %(usage_prompt_tokens)s,
                        %(usage_completion_tokens)s,
                        %(usage_total_tokens)s,
                        %(duration_ms)s,
                        %(replaced_existing_title)s,
                        %(metadata_json)s
                    )
                    ON CONFLICT (topic_key, as_of_window_end) DO UPDATE
                    SET raw_label = CASE
                            WHEN public.topic_ai_enrichments.name_status = 'ready'
                             AND public.topic_ai_enrichments.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(public.topic_ai_enrichments.canonical_name), '') IS NOT NULL
                             AND (
                                public.topic_ai_enrichments.authoritative_writer
                                OR COALESCE(public.topic_ai_enrichments.metadata_json ->> 'authoritative_writer', 'false') = 'true'
                             )
                             AND NOT (
                                EXCLUDED.name_status = 'ready'
                                AND EXCLUDED.name_source IN (
                                    'ai_exact',
                                    'historical_exact',
                                    'historical_alias'
                                )
                                AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                AND (
                                    EXCLUDED.authoritative_writer
                                    OR COALESCE(EXCLUDED.metadata_json ->> 'authoritative_writer', 'false') = 'true'
                                )
                             )
                                THEN public.topic_ai_enrichments.raw_label
                            ELSE EXCLUDED.raw_label
                        END,
                        canonical_name = CASE
                            WHEN EXCLUDED.name_status = 'ready'
                             AND EXCLUDED.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                THEN EXCLUDED.canonical_name
                            ELSE public.topic_ai_enrichments.canonical_name
                        END,
                        ai_display_name = CASE
                            WHEN EXCLUDED.name_status = 'ready'
                             AND EXCLUDED.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                THEN EXCLUDED.ai_display_name
                            ELSE public.topic_ai_enrichments.ai_display_name
                        END,
                        fallback_label = CASE
                            WHEN public.topic_ai_enrichments.name_status = 'ready'
                             AND public.topic_ai_enrichments.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(public.topic_ai_enrichments.canonical_name), '') IS NOT NULL
                             AND (
                                public.topic_ai_enrichments.authoritative_writer
                                OR COALESCE(public.topic_ai_enrichments.metadata_json ->> 'authoritative_writer', 'false') = 'true'
                             )
                             AND NOT (
                                EXCLUDED.name_status = 'ready'
                                AND EXCLUDED.name_source IN (
                                    'ai_exact',
                                    'historical_exact',
                                    'historical_alias'
                                )
                                AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                AND (
                                    EXCLUDED.authoritative_writer
                                    OR COALESCE(EXCLUDED.metadata_json ->> 'authoritative_writer', 'false') = 'true'
                                )
                             )
                                THEN COALESCE(public.topic_ai_enrichments.fallback_label, EXCLUDED.fallback_label)
                            ELSE COALESCE(EXCLUDED.fallback_label, public.topic_ai_enrichments.fallback_label)
                        END,
                        name_status = CASE
                            WHEN EXCLUDED.name_status = 'ready'
                             AND EXCLUDED.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                THEN EXCLUDED.name_status
                            WHEN public.topic_ai_enrichments.name_status = 'ready'
                             AND public.topic_ai_enrichments.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(public.topic_ai_enrichments.canonical_name), '') IS NOT NULL
                                THEN public.topic_ai_enrichments.name_status
                            ELSE EXCLUDED.name_status
                        END,
                        ai_name_status = CASE
                            WHEN EXCLUDED.name_status = 'ready'
                             AND EXCLUDED.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                THEN EXCLUDED.ai_name_status
                            WHEN public.topic_ai_enrichments.name_status = 'ready'
                             AND public.topic_ai_enrichments.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(public.topic_ai_enrichments.canonical_name), '') IS NOT NULL
                                THEN public.topic_ai_enrichments.ai_name_status
                            ELSE EXCLUDED.ai_name_status
                        END,
                        name_source = CASE
                            WHEN EXCLUDED.name_status = 'ready'
                             AND EXCLUDED.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                THEN EXCLUDED.name_source
                            WHEN public.topic_ai_enrichments.name_status = 'ready'
                             AND public.topic_ai_enrichments.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(public.topic_ai_enrichments.canonical_name), '') IS NOT NULL
                                THEN public.topic_ai_enrichments.name_source
                            ELSE EXCLUDED.name_source
                        END,
                        short_description = EXCLUDED.short_description,
                        context_paragraph = EXCLUDED.context_paragraph,
                        narrative_summary = EXCLUDED.narrative_summary,
                        why_attention = EXCLUDED.why_attention,
                        status = EXCLUDED.status,
                        key_entities = EXCLUDED.key_entities,
                        trend_category = EXCLUDED.trend_category,
                        summary_confidence = EXCLUDED.summary_confidence,
                        evidence_post_ids = EXCLUDED.evidence_post_ids,
                        mixed_signals = EXCLUDED.mixed_signals,
                        abstain_reason = EXCLUDED.abstain_reason,
                        validator_errors = EXCLUDED.validator_errors,
                        validated_output_json = EXCLUDED.validated_output_json,
                        raw_response_text = EXCLUDED.raw_response_text,
                        supporting_post_ids = EXCLUDED.supporting_post_ids,
                        supporting_sample = EXCLUDED.supporting_sample,
                        representative_post_count = EXCLUDED.representative_post_count,
                        model_name = EXCLUDED.model_name,
                        prompt_version = EXCLUDED.prompt_version,
                        input_hash = EXCLUDED.input_hash,
                        generated_at = EXCLUDED.generated_at,
                        ai_name_generated_at = CASE
                            WHEN EXCLUDED.name_status = 'ready'
                             AND EXCLUDED.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                THEN EXCLUDED.ai_name_generated_at
                            ELSE public.topic_ai_enrichments.ai_name_generated_at
                        END,
                        refreshed_at = EXCLUDED.refreshed_at,
                        ai_name_refreshed_at = CASE
                            WHEN EXCLUDED.name_status = 'ready'
                             AND EXCLUDED.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                THEN EXCLUDED.ai_name_refreshed_at
                            ELSE public.topic_ai_enrichments.ai_name_refreshed_at
                        END,
                        expires_at = EXCLUDED.expires_at,
                        ai_name_source_version = CASE
                            WHEN EXCLUDED.name_status = 'ready'
                             AND EXCLUDED.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                THEN EXCLUDED.ai_name_source_version
                            ELSE public.topic_ai_enrichments.ai_name_source_version
                        END,
                        writer_identity = CASE
                            WHEN public.topic_ai_enrichments.name_status = 'ready'
                             AND public.topic_ai_enrichments.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(public.topic_ai_enrichments.canonical_name), '') IS NOT NULL
                             AND (
                                public.topic_ai_enrichments.authoritative_writer
                                OR COALESCE(public.topic_ai_enrichments.metadata_json ->> 'authoritative_writer', 'false') = 'true'
                             )
                             AND NOT (
                                EXCLUDED.name_status = 'ready'
                                AND EXCLUDED.name_source IN (
                                    'ai_exact',
                                    'historical_exact',
                                    'historical_alias'
                                )
                                AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                AND (
                                    EXCLUDED.authoritative_writer
                                    OR COALESCE(EXCLUDED.metadata_json ->> 'authoritative_writer', 'false') = 'true'
                                )
                             )
                                THEN public.topic_ai_enrichments.writer_identity
                            ELSE EXCLUDED.writer_identity
                        END,
                        writer_role = CASE
                            WHEN public.topic_ai_enrichments.name_status = 'ready'
                             AND public.topic_ai_enrichments.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(public.topic_ai_enrichments.canonical_name), '') IS NOT NULL
                             AND (
                                public.topic_ai_enrichments.authoritative_writer
                                OR COALESCE(public.topic_ai_enrichments.metadata_json ->> 'authoritative_writer', 'false') = 'true'
                             )
                             AND NOT (
                                EXCLUDED.name_status = 'ready'
                                AND EXCLUDED.name_source IN (
                                    'ai_exact',
                                    'historical_exact',
                                    'historical_alias'
                                )
                                AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                AND (
                                    EXCLUDED.authoritative_writer
                                    OR COALESCE(EXCLUDED.metadata_json ->> 'authoritative_writer', 'false') = 'true'
                                )
                             )
                                THEN public.topic_ai_enrichments.writer_role
                            ELSE EXCLUDED.writer_role
                        END,
                        authoritative_writer = CASE
                            WHEN public.topic_ai_enrichments.name_status = 'ready'
                             AND public.topic_ai_enrichments.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(public.topic_ai_enrichments.canonical_name), '') IS NOT NULL
                             AND (
                                public.topic_ai_enrichments.authoritative_writer
                                OR COALESCE(public.topic_ai_enrichments.metadata_json ->> 'authoritative_writer', 'false') = 'true'
                             )
                             AND NOT (
                                EXCLUDED.name_status = 'ready'
                                AND EXCLUDED.name_source IN (
                                    'ai_exact',
                                    'historical_exact',
                                    'historical_alias'
                                )
                                AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                AND (
                                    EXCLUDED.authoritative_writer
                                    OR COALESCE(EXCLUDED.metadata_json ->> 'authoritative_writer', 'false') = 'true'
                                )
                             )
                                THEN public.topic_ai_enrichments.authoritative_writer
                            ELSE EXCLUDED.authoritative_writer
                        END,
                        deployment_id = EXCLUDED.deployment_id,
                        instance_id = EXCLUDED.instance_id,
                        code_version = EXCLUDED.code_version,
                        refresh_reason = EXCLUDED.refresh_reason,
                        usage_prompt_tokens = EXCLUDED.usage_prompt_tokens,
                        usage_completion_tokens = EXCLUDED.usage_completion_tokens,
                        usage_total_tokens = EXCLUDED.usage_total_tokens,
                        duration_ms = EXCLUDED.duration_ms,
                        replaced_existing_title = EXCLUDED.replaced_existing_title,
                        metadata_json = CASE
                            WHEN public.topic_ai_enrichments.name_status = 'ready'
                             AND public.topic_ai_enrichments.name_source IN (
                                'ai_exact',
                                'historical_exact',
                                'historical_alias'
                             )
                             AND NULLIF(TRIM(public.topic_ai_enrichments.canonical_name), '') IS NOT NULL
                             AND (
                                public.topic_ai_enrichments.authoritative_writer
                                OR COALESCE(public.topic_ai_enrichments.metadata_json ->> 'authoritative_writer', 'false') = 'true'
                             )
                             AND NOT (
                                EXCLUDED.name_status = 'ready'
                                AND EXCLUDED.name_source IN (
                                    'ai_exact',
                                    'historical_exact',
                                    'historical_alias'
                                )
                                AND NULLIF(TRIM(EXCLUDED.canonical_name), '') IS NOT NULL
                                AND (
                                    EXCLUDED.authoritative_writer
                                    OR COALESCE(EXCLUDED.metadata_json ->> 'authoritative_writer', 'false') = 'true'
                                )
                             )
                                THEN public.topic_ai_enrichments.metadata_json
                            ELSE EXCLUDED.metadata_json
                        END
                    RETURNING id, topic_key, as_of_window_end, input_hash, generated_at, refreshed_at
                    """,
                    payload,
                )
                row_out = cursor.fetchone()
                if not row_out:
                    return None
                return {
                    "id": int(row_out[0]),
                    "topic_key": str(row_out[1] or "").strip(),
                    "as_of_window_end": row_out[2],
                    "input_hash": str(row_out[3] or "").strip(),
                    "generated_at": row_out[4],
                    "refreshed_at": row_out[5],
                }

        return self._execute_write("upsert_topic_ai_enrichment", operation)

    def insert_topic_ai_enrichment_run(self, row: dict[str, Any]) -> dict[str, Any] | None:
        payload = self._prepare_topic_ai_enrichment_row(row)
        if not payload.get("topic_key"):
            return None

        def operation(connection: psycopg.Connection[Any]) -> dict[str, Any] | None:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.topic_ai_enrichment_runs (
                        topic_key,
                        as_of_window_end,
                        raw_label,
                        canonical_name,
                        ai_display_name,
                        fallback_label,
                        name_status,
                        ai_name_status,
                        name_source,
                        short_description,
                        context_paragraph,
                        narrative_summary,
                        why_attention,
                        status,
                        key_entities,
                        trend_category,
                        summary_confidence,
                        evidence_post_ids,
                        mixed_signals,
                        abstain_reason,
                        validator_errors,
                        validated_output_json,
                        raw_response_text,
                        supporting_post_ids,
                        supporting_sample,
                        representative_post_count,
                        model_name,
                        prompt_version,
                        input_hash,
                        generated_at,
                        ai_name_generated_at,
                        ai_name_refreshed_at,
                        expires_at,
                        ai_name_source_version,
                        writer_identity,
                        writer_role,
                        authoritative_writer,
                        deployment_id,
                        instance_id,
                        code_version,
                        refresh_reason,
                        usage_prompt_tokens,
                        usage_completion_tokens,
                        usage_total_tokens,
                        duration_ms,
                        replaced_existing_title,
                        metadata_json
                    ) VALUES (
                        %(topic_key)s,
                        %(as_of_window_end)s,
                        %(raw_label)s,
                        %(canonical_name)s,
                        %(ai_display_name)s,
                        %(fallback_label)s,
                        %(name_status)s,
                        %(ai_name_status)s,
                        %(name_source)s,
                        %(short_description)s,
                        %(context_paragraph)s,
                        %(narrative_summary)s,
                        %(why_attention)s,
                        %(status)s,
                        %(key_entities)s,
                        %(trend_category)s,
                        %(summary_confidence)s,
                        %(evidence_post_ids)s,
                        %(mixed_signals)s,
                        %(abstain_reason)s,
                        %(validator_errors)s,
                        %(validated_output_json)s,
                        %(raw_response_text)s,
                        %(supporting_post_ids)s,
                        %(supporting_sample)s,
                        %(representative_post_count)s,
                        %(model_name)s,
                        %(prompt_version)s,
                        %(input_hash)s,
                        %(generated_at)s,
                        %(ai_name_generated_at)s,
                        %(ai_name_refreshed_at)s,
                        %(expires_at)s,
                        %(ai_name_source_version)s,
                        %(writer_identity)s,
                        %(writer_role)s,
                        %(authoritative_writer)s,
                        %(deployment_id)s,
                        %(instance_id)s,
                        %(code_version)s,
                        %(refresh_reason)s,
                        %(usage_prompt_tokens)s,
                        %(usage_completion_tokens)s,
                        %(usage_total_tokens)s,
                        %(duration_ms)s,
                        %(replaced_existing_title)s,
                        %(metadata_json)s
                    )
                    ON CONFLICT DO NOTHING
                    RETURNING id, topic_key, as_of_window_end, input_hash, generated_at
                    """,
                    payload,
                )
                row_out = cursor.fetchone()
                if not row_out:
                    return None
                return {
                    "id": int(row_out[0]),
                    "topic_key": str(row_out[1] or "").strip(),
                    "as_of_window_end": row_out[2],
                    "input_hash": str(row_out[3] or "").strip(),
                    "generated_at": row_out[4],
                }

        return self._execute_write("insert_topic_ai_enrichment_run", operation)

    def upsert_topic_ai_writer_heartbeat(self, row: dict[str, Any]) -> dict[str, Any] | None:
        metadata_json = row.get("metadata_json")
        if not isinstance(metadata_json, dict):
            metadata_json = {}

        writer_identity = str(
            row.get("writer_identity")
            or metadata_json.get("writer_identity")
            or ""
        ).strip()
        writer_role = str(
            row.get("writer_role")
            or metadata_json.get("writer_role")
            or ""
        ).strip()
        if not writer_identity or writer_identity.lower() == "unknown":
            raise ValueError("writer_identity is required for topic AI writer heartbeat")
        if not writer_role or writer_role.lower() == "unknown":
            raise ValueError("writer_role is required for topic AI writer heartbeat")

        deployment_id = str(
            row.get("deployment_id")
            or metadata_json.get("deployment_id")
            or os.getenv("BLUESKY_TREND_DEPLOYMENT_ID")
            or os.getenv("DEPLOYMENT_ID")
            or os.getenv("RAILWAY_DEPLOYMENT_ID")
            or os.getenv("RAILWAY_SERVICE_ID")
            or os.getenv("RENDER_SERVICE_ID")
            or "local"
        ).strip() or "local"
        instance_id = str(
            row.get("instance_id")
            or metadata_json.get("instance_id")
            or os.getenv("BLUESKY_TREND_INSTANCE_ID")
            or os.getenv("INSTANCE_ID")
            or os.getenv("RAILWAY_REPLICA_ID")
            or os.getenv("RENDER_INSTANCE_ID")
            or os.getenv("HOSTNAME")
            or "local-instance"
        ).strip() or "local-instance"
        authoritative_writer = bool(
            row.get("authoritative_writer")
            if row.get("authoritative_writer") is not None
            else metadata_json.get("authoritative_writer")
        )
        status = str(row.get("status") or metadata_json.get("status") or "idle").strip().lower() or "idle"
        last_reason = str(row.get("last_reason") or metadata_json.get("last_reason") or "").strip() or None
        model_name = str(row.get("model_name") or metadata_json.get("model_name") or "").strip() or None
        prompt_version = str(
            row.get("prompt_version")
            or metadata_json.get("prompt_version")
            or ""
        ).strip() or None
        code_version = str(row.get("code_version") or metadata_json.get("code_version") or "").strip() or None
        metadata_json = {
            **metadata_json,
            "writer_identity": writer_identity,
            "writer_role": writer_role,
            "authoritative_writer": authoritative_writer,
            "deployment_id": deployment_id,
            "instance_id": instance_id,
            "model_name": model_name,
            "prompt_version": prompt_version,
            "code_version": code_version,
            "status": status,
            "last_reason": last_reason,
        }

        payload = {
            "writer_identity": writer_identity,
            "deployment_id": deployment_id,
            "instance_id": instance_id,
            "writer_role": writer_role,
            "authoritative_writer": authoritative_writer,
            "model_name": model_name,
            "prompt_version": prompt_version,
            "code_version": code_version,
            "status": status,
            "last_reason": last_reason,
            "last_seen_at": row.get("last_seen_at") or datetime.now(timezone.utc),
            "last_started_at": row.get("last_started_at"),
            "last_completed_at": row.get("last_completed_at"),
            "last_write_at": row.get("last_write_at"),
            "metadata_json": Jsonb(metadata_json),
        }

        def operation(connection: psycopg.Connection[Any]) -> dict[str, Any] | None:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.topic_ai_writer_heartbeats (
                        writer_identity,
                        deployment_id,
                        instance_id,
                        writer_role,
                        authoritative_writer,
                        model_name,
                        prompt_version,
                        code_version,
                        status,
                        last_reason,
                        last_seen_at,
                        last_started_at,
                        last_completed_at,
                        last_write_at,
                        metadata_json,
                        updated_at
                    ) VALUES (
                        %(writer_identity)s,
                        %(deployment_id)s,
                        %(instance_id)s,
                        %(writer_role)s,
                        %(authoritative_writer)s,
                        %(model_name)s,
                        %(prompt_version)s,
                        %(code_version)s,
                        %(status)s,
                        %(last_reason)s,
                        %(last_seen_at)s,
                        %(last_started_at)s,
                        %(last_completed_at)s,
                        %(last_write_at)s,
                        %(metadata_json)s,
                        now()
                    )
                    ON CONFLICT (writer_identity, deployment_id, instance_id) DO UPDATE
                    SET writer_role = EXCLUDED.writer_role,
                        authoritative_writer = EXCLUDED.authoritative_writer,
                        model_name = EXCLUDED.model_name,
                        prompt_version = EXCLUDED.prompt_version,
                        code_version = EXCLUDED.code_version,
                        status = EXCLUDED.status,
                        last_reason = EXCLUDED.last_reason,
                        last_seen_at = EXCLUDED.last_seen_at,
                        last_started_at = COALESCE(EXCLUDED.last_started_at, public.topic_ai_writer_heartbeats.last_started_at),
                        last_completed_at = COALESCE(EXCLUDED.last_completed_at, public.topic_ai_writer_heartbeats.last_completed_at),
                        last_write_at = COALESCE(EXCLUDED.last_write_at, public.topic_ai_writer_heartbeats.last_write_at),
                        metadata_json = EXCLUDED.metadata_json,
                        updated_at = now()
                    RETURNING
                        writer_identity,
                        deployment_id,
                        instance_id,
                        status,
                        last_seen_at,
                        last_write_at
                    """,
                    payload,
                )
                row_out = cursor.fetchone()
                if not row_out:
                    return None
                return {
                    "writer_identity": str(row_out[0] or "").strip(),
                    "deployment_id": str(row_out[1] or "").strip(),
                    "instance_id": str(row_out[2] or "").strip(),
                    "status": str(row_out[3] or "").strip(),
                    "last_seen_at": row_out[4],
                    "last_write_at": row_out[5],
                }

        return self._execute_write("upsert_topic_ai_writer_heartbeat", operation)

    def fetch_topic_ai_writer_diagnostics(
        self,
        *,
        lookback_hours: int = 24,
        duplicate_write_threshold: int = 3,
        authoritative_writer_identities: Sequence[str] | None = None,
        expected_prompt_versions: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        normalized_lookback_hours = max(1, int(lookback_hours))
        normalized_duplicate_threshold = max(2, int(duplicate_write_threshold))
        authoritative_identities = [
            str(value or "").strip()
            for value in (authoritative_writer_identities or _AUTHORITATIVE_TOPIC_AI_WRITER_IDENTITIES)
            if str(value or "").strip()
        ]
        prompt_versions = [
            str(value or "").strip()
            for value in (expected_prompt_versions or [])
            if str(value or "").strip()
        ]

        def operation(connection: psycopg.Connection[Any]) -> dict[str, Any]:
            with connection.cursor() as cursor:
                cursor.execute("SELECT to_regclass('public.topic_ai_enrichment_runs')")
                relation = cursor.fetchone()
                if not relation or relation[0] is None:
                    return {
                        "lookbackHours": normalized_lookback_hours,
                        "activeWriterCount": 0,
                        "activeWriterIdentities": [],
                        "unknownWriterCount": 0,
                        "nonAuthoritativeWriterCount": 0,
                        "legacyPromptWriteCount": 0,
                        "duplicateWriteTopicCount": 0,
                        "hotTopics": [],
                        "refreshReasonCounts": [],
                        "usagePromptTokens": 0,
                        "usageCompletionTokens": 0,
                        "usageTotalTokens": 0,
                        "nonAuthoritativeRunCount": 0,
                        "writerHeartbeats": [],
                    }

                cursor.execute(
                    """
                    WITH recent_runs AS (
                        SELECT
                            topic_key,
                            generated_at,
                            COALESCE(NULLIF(TRIM(writer_identity), ''), 'unknown') AS writer_identity,
                            COALESCE(authoritative_writer, false) AS authoritative_writer,
                            COALESCE(NULLIF(TRIM(prompt_version), ''), 'unknown') AS prompt_version,
                            COALESCE(NULLIF(TRIM(refresh_reason), ''), 'unknown') AS refresh_reason,
                            COALESCE(usage_prompt_tokens, 0)::bigint AS usage_prompt_tokens,
                            COALESCE(usage_completion_tokens, 0)::bigint AS usage_completion_tokens,
                            COALESCE(usage_total_tokens, 0)::bigint AS usage_total_tokens
                        FROM public.topic_ai_enrichment_runs
                        WHERE generated_at >= now() - make_interval(hours => %s)
                    ),
                    writer_activity AS (
                        SELECT
                            writer_identity,
                            MAX(generated_at) AS latest_write_at,
                            COUNT(*)::int AS run_count,
                            BOOL_OR(authoritative_writer) AS authoritative_writer
                        FROM recent_runs
                        GROUP BY writer_identity
                    ),
                    hot_topics AS (
                        SELECT
                            topic_key,
                            COUNT(*)::int AS run_count
                        FROM recent_runs
                        GROUP BY topic_key
                        HAVING COUNT(*) >= %s
                        ORDER BY run_count DESC, topic_key ASC
                        LIMIT 20
                    ),
                    refresh_reason_counts AS (
                        SELECT
                            refresh_reason,
                            COUNT(*)::int AS run_count
                        FROM recent_runs
                        GROUP BY refresh_reason
                        ORDER BY run_count DESC, refresh_reason ASC
                        LIMIT 20
                    )
                    SELECT
                        COALESCE(
                            (
                                SELECT jsonb_agg(writer_identity ORDER BY latest_write_at DESC, writer_identity ASC)
                                FROM writer_activity
                            ),
                            '[]'::jsonb
                        ) AS active_writer_identities,
                        COALESCE((SELECT COUNT(*)::int FROM writer_activity), 0)::int AS active_writer_count,
                        COALESCE((SELECT COUNT(*)::int FROM writer_activity WHERE writer_identity = 'unknown'), 0)::int AS unknown_writer_count,
                        COALESCE((SELECT COUNT(*)::int FROM writer_activity WHERE NOT authoritative_writer), 0)::int AS non_authoritative_writer_count,
                        COALESCE(
                            (
                                SELECT COUNT(*)::int
                                FROM recent_runs
                                WHERE CASE
                                    WHEN cardinality(%s::text[]) = 0 THEN false
                                    ELSE prompt_version <> ALL(%s::text[])
                                END
                            ),
                            0
                        )::int AS legacy_prompt_write_count,
                        COALESCE((SELECT COUNT(*)::int FROM hot_topics), 0)::int AS duplicate_write_topic_count,
                        COALESCE(
                            (
                                SELECT jsonb_agg(
                                    jsonb_build_object('topic_key', topic_key, 'run_count', run_count)
                                    ORDER BY run_count DESC, topic_key ASC
                                )
                                FROM hot_topics
                            ),
                            '[]'::jsonb
                        ) AS hot_topics,
                        COALESCE(
                            (
                                SELECT jsonb_agg(
                                    jsonb_build_object('refresh_reason', refresh_reason, 'run_count', run_count)
                                    ORDER BY run_count DESC, refresh_reason ASC
                                )
                                FROM refresh_reason_counts
                            ),
                            '[]'::jsonb
                        ) AS refresh_reason_counts,
                        COALESCE((SELECT SUM(usage_prompt_tokens)::bigint FROM recent_runs), 0)::bigint AS usage_prompt_tokens,
                        COALESCE((SELECT SUM(usage_completion_tokens)::bigint FROM recent_runs), 0)::bigint AS usage_completion_tokens,
                        COALESCE((SELECT SUM(usage_total_tokens)::bigint FROM recent_runs), 0)::bigint AS usage_total_tokens,
                        COALESCE(
                            (
                                SELECT COUNT(*)::int
                                FROM recent_runs
                                WHERE writer_identity <> ALL(%s::text[])
                            ),
                            0
                        )::int AS non_authoritative_run_count
                    """,
                    (
                        normalized_lookback_hours,
                        normalized_duplicate_threshold,
                        prompt_versions,
                        prompt_versions,
                        authoritative_identities,
                    ),
                )
                row_out = cursor.fetchone()

                cursor.execute("SELECT to_regclass('public.topic_ai_writer_heartbeats')")
                heartbeat_relation = cursor.fetchone()
                heartbeat_rows: list[tuple[Any, ...]] = []
                if heartbeat_relation and heartbeat_relation[0] is not None:
                    cursor.execute(
                        """
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
                        WHERE last_seen_at >= now() - make_interval(hours => %s)
                        ORDER BY last_seen_at DESC, writer_identity ASC
                        """,
                        (normalized_lookback_hours,),
                    )
                    heartbeat_rows = cursor.fetchall()

            active_writer_identities = []
            if row_out and isinstance(row_out[0], list):
                active_writer_identities = [
                    str(value or "").strip()
                    for value in row_out[0]
                    if str(value or "").strip()
                ]
            hot_topics = []
            if row_out and isinstance(row_out[6], list):
                hot_topics = [dict(item) for item in row_out[6] if isinstance(item, dict)]
            refresh_reason_counts = []
            if row_out and isinstance(row_out[7], list):
                refresh_reason_counts = [dict(item) for item in row_out[7] if isinstance(item, dict)]

            return {
                "lookbackHours": normalized_lookback_hours,
                "activeWriterCount": int(row_out[1] or 0) if row_out else 0,
                "activeWriterIdentities": active_writer_identities,
                "unknownWriterCount": int(row_out[2] or 0) if row_out else 0,
                "nonAuthoritativeWriterCount": int(row_out[3] or 0) if row_out else 0,
                "legacyPromptWriteCount": int(row_out[4] or 0) if row_out else 0,
                "duplicateWriteTopicCount": int(row_out[5] or 0) if row_out else 0,
                "hotTopics": hot_topics,
                "refreshReasonCounts": refresh_reason_counts,
                "usagePromptTokens": int(row_out[8] or 0) if row_out else 0,
                "usageCompletionTokens": int(row_out[9] or 0) if row_out else 0,
                "usageTotalTokens": int(row_out[10] or 0) if row_out else 0,
                "nonAuthoritativeRunCount": int(row_out[11] or 0) if row_out else 0,
                "writerHeartbeats": [
                    {
                        "writer_identity": str(heartbeat_row[0] or "").strip(),
                        "deployment_id": str(heartbeat_row[1] or "").strip(),
                        "instance_id": str(heartbeat_row[2] or "").strip(),
                        "writer_role": str(heartbeat_row[3] or "").strip(),
                        "authoritative_writer": bool(heartbeat_row[4]),
                        "status": str(heartbeat_row[5] or "").strip(),
                        "model_name": str(heartbeat_row[6] or "").strip() or None,
                        "prompt_version": str(heartbeat_row[7] or "").strip() or None,
                        "code_version": str(heartbeat_row[8] or "").strip() or None,
                        "last_reason": str(heartbeat_row[9] or "").strip() or None,
                        "last_seen_at": heartbeat_row[10],
                        "last_started_at": heartbeat_row[11],
                        "last_completed_at": heartbeat_row[12],
                        "last_write_at": heartbeat_row[13],
                    }
                    for heartbeat_row in heartbeat_rows
                    if str(heartbeat_row[0] or "").strip()
                ],
            }

        return self._run_with_retry("fetch_topic_ai_writer_diagnostics", operation)

    def cleanup_garbage_post_topic_mentions(
        self,
        *,
        lookback_hours: int = 168,
        statement_timeout_seconds: float | None = None,
    ) -> int:
        lookback_hours = max(1, int(lookback_hours))
        weak_tokens = sorted(set(TOPIC_GENERIC_WEAK_TOKENS))
        noise_tokens = sorted(set(TOPIC_NOISE_TOKENS))
        number_tokens = sorted(set(TOPIC_NUMBER_WORD_TOKENS))
        url_debris_tokens = sorted(set(TOPIC_URL_DEBRIS_TOKENS))
        acronym_tokens = sorted(set(TOPIC_ACRONYM_ALLOWLIST))

        def operation(connection: psycopg.Connection[Any]) -> int:
            with connection.cursor() as cursor:
                self._apply_statement_timeout(cursor, statement_timeout_seconds)
                cursor.execute("SELECT to_regclass('public.post_topic_mentions')")
                relation = cursor.fetchone()
                if not relation or relation[0] is None:
                    return 0

                cursor.execute(
                    """
                    WITH weak_topic_tokens(token) AS (SELECT unnest(%s::text[])),
                    topic_noise_tokens(token) AS (SELECT unnest(%s::text[])),
                    number_word_tokens(token) AS (SELECT unnest(%s::text[])),
                    url_debris_tokens(token) AS (SELECT unnest(%s::text[])),
                    acronym_allowlist(token) AS (SELECT unnest(%s::text[])),
                    bad_mentions AS (
                        SELECT m.mention_id
                        FROM public.post_topic_mentions m
                        WHERE m.event_timestamp >= now() - make_interval(hours => %s)
                          AND (
                              COALESCE(TRIM(m.topic_key), '') = ''
                              OR LOWER(m.topic_key) IN ('all', 'general', 'digit')
                              OR COALESCE(m.topic_confidence, 0) < 0.20
                              OR LOWER(m.topic_key) ~* '(^| )([a-z0-9]+bot)( |$)'
                              OR LOWER(m.topic_key) ~* '(^| )(https?|www|com|co|t|ly|amp)( |$)'
                              OR LOWER(m.topic_key) ~* '(area|forecast|discussion).*(afd|airnow|aqi)'
                              OR LOWER(m.topic_key) ~* '(additional|details) here'
                              OR (
                                  array_length(string_to_array(LOWER(m.topic_key), ' '), 1) = 1
                                  AND (
                                      LOWER(m.topic_key) IN (SELECT token FROM weak_topic_tokens)
                                      OR LOWER(m.topic_key) IN (SELECT token FROM topic_noise_tokens)
                                      OR LOWER(m.topic_key) IN (SELECT token FROM number_word_tokens)
                                      OR LOWER(m.topic_key) IN (SELECT token FROM url_debris_tokens)
                                  )
                              )
                              OR (
                                  array_length(string_to_array(LOWER(m.topic_key), ' '), 1) >= 1
                                  AND (
                                      SELECT COUNT(*)
                                      FROM unnest(string_to_array(LOWER(m.topic_key), ' ')) AS t(token)
                                      WHERE t.token <> ''
                                        AND t.token IN (SELECT token FROM number_word_tokens)
                                  ) = array_length(string_to_array(LOWER(m.topic_key), ' '), 1)
                              )
                              OR (
                                  array_length(string_to_array(LOWER(m.topic_key), ' '), 1) > 0
                                  AND NOT EXISTS (
                                      SELECT 1
                                      FROM unnest(string_to_array(LOWER(m.topic_key), ' ')) AS t(token)
                                      WHERE t.token <> ''
                                        AND t.token NOT IN (SELECT token FROM weak_topic_tokens)
                                        AND t.token NOT IN (SELECT token FROM topic_noise_tokens)
                                        AND t.token NOT IN (SELECT token FROM number_word_tokens)
                                        AND t.token NOT IN (SELECT token FROM url_debris_tokens)
                                        AND (
                                            length(t.token) >= 4
                                            OR t.token IN (SELECT token FROM acronym_allowlist)
                                        )
                                  )
                              )
                          )
                    )
                    DELETE FROM public.post_topic_mentions m
                    USING bad_mentions b
                    WHERE m.mention_id = b.mention_id
                    """,
                    (
                        weak_tokens,
                        noise_tokens,
                        number_tokens,
                        url_debris_tokens,
                        acronym_tokens,
                        lookback_hours,
                    ),
                )
                return int(cursor.rowcount or 0)

        return self._execute_write("cleanup_garbage_post_topic_mentions", operation)

    def prune_raw_posts_older_than(self, *, hours: float) -> int:
        retention_hours = max(0.0, float(hours))
        cutoff = datetime.now(timezone.utc) - timedelta(hours=retention_hours)

        def operation(connection: psycopg.Connection[Any]) -> int:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    WITH deleted AS (
                        DELETE FROM public.raw_posts
                        WHERE COALESCE(ingested_at, inserted_at, created_at, now()) < %s
                        RETURNING id
                    )
                    SELECT COUNT(*)::BIGINT FROM deleted
                    """,
                    (cutoff,),
                )
                row = cursor.fetchone()
                return int((row or [0])[0] or 0)

        return self._execute_write("prune_raw_posts_older_than", operation)

    def upsert_authors(self, rows: Iterable[dict[str, Any]]) -> int:
        payload = [self._prepare_author_row(row) for row in rows]
        payload = [row for row in payload if row.get("author_id")]
        if not payload:
            return 0

        def operation(connection: psycopg.Connection[Any]) -> int:
            affected_total = 0
            with connection.cursor() as cursor:
                for chunk in _chunked(payload, self._batch_size):
                    cursor.executemany(
                        """
                        INSERT INTO public.authors (
                            platform,
                            author_id,
                            author_handle,
                            display_name,
                            followers_count,
                            metadata_json,
                            first_seen_at,
                            last_seen_at
                        ) VALUES (
                            %(platform)s,
                            %(author_id)s,
                            %(author_handle)s,
                            %(display_name)s,
                            %(followers_count)s,
                            %(metadata_json)s,
                            %(first_seen_at)s,
                            %(last_seen_at)s
                        )
                        ON CONFLICT (platform, author_id) DO UPDATE
                        SET author_handle = COALESCE(EXCLUDED.author_handle, public.authors.author_handle),
                            display_name = COALESCE(EXCLUDED.display_name, public.authors.display_name),
                            followers_count = COALESCE(EXCLUDED.followers_count, public.authors.followers_count),
                            metadata_json = COALESCE(EXCLUDED.metadata_json, public.authors.metadata_json),
                            first_seen_at = CASE
                                WHEN public.authors.first_seen_at IS NULL THEN EXCLUDED.first_seen_at
                                WHEN EXCLUDED.first_seen_at IS NULL THEN public.authors.first_seen_at
                                ELSE LEAST(public.authors.first_seen_at, EXCLUDED.first_seen_at)
                            END,
                            last_seen_at = CASE
                                WHEN public.authors.last_seen_at IS NULL THEN EXCLUDED.last_seen_at
                                WHEN EXCLUDED.last_seen_at IS NULL THEN public.authors.last_seen_at
                                ELSE GREATEST(public.authors.last_seen_at, EXCLUDED.last_seen_at)
                            END
                        """,
                        list(chunk),
                    )
                    if cursor.rowcount and cursor.rowcount > 0:
                        affected_total += int(cursor.rowcount)
            return affected_total

        return self._execute_write("upsert_authors", operation)

    def _ensure_core_tables(self) -> None:
        if self._conn is None:
            return

        with self._conn.cursor() as cursor:
            self._apply_schema_lock_timeout(cursor)
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS public.raw_posts (
                    id BIGSERIAL PRIMARY KEY,
                    platform TEXT NOT NULL,
                    source_post_id TEXT,
                    source_uri TEXT,
                    source_cid TEXT,
                    author_did TEXT,
                    post_id TEXT NOT NULL,
                    author_id TEXT,
                    author_handle TEXT,
                    root_post_id TEXT,
                    reply_parent_id TEXT,
                    created_at TIMESTAMPTZ,
                    inserted_at TIMESTAMPTZ DEFAULT now(),
                    ingested_at TIMESTAMPTZ,
                    raw_text TEXT,
                    text_content TEXT,
                    language TEXT,
                    urls TEXT[],
                    hashtags TEXT[],
                    like_count INTEGER,
                    repost_count INTEGER,
                    reply_count INTEGER,
                    reply_to_uri TEXT,
                    repost_of_uri TEXT,
                    processed BOOLEAN NOT NULL DEFAULT false,
                    metrics_json JSONB,
                    raw_json JSONB
                )
                """
            )
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS id BIGINT")
            cursor.execute("CREATE SEQUENCE IF NOT EXISTS public.raw_posts_id_seq")
            cursor.execute(
                """
                ALTER TABLE public.raw_posts
                ALTER COLUMN id SET DEFAULT nextval('public.raw_posts_id_seq')
                """
            )
            cursor.execute(
                """
                ALTER SEQUENCE public.raw_posts_id_seq
                OWNED BY public.raw_posts.id
                """
            )
            cursor.execute(
                """
                UPDATE public.raw_posts
                SET id = nextval('public.raw_posts_id_seq')
                WHERE id IS NULL
                """
            )
            cursor.execute(
                """
                SELECT setval(
                    'public.raw_posts_id_seq',
                    GREATEST(
                        COALESCE((SELECT MAX(id) FROM public.raw_posts), 0),
                        1
                    ),
                    true
                )
                """
            )
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS platform TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS source_post_id TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS source_uri TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS source_cid TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS author_did TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS post_id TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS author_id TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS author_handle TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS root_post_id TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS reply_parent_id TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS inserted_at TIMESTAMPTZ")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS raw_text TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS text_content TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS language TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS urls TEXT[]")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS hashtags TEXT[]")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS like_count INTEGER")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS repost_count INTEGER")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS reply_count INTEGER")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS reply_to_uri TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS repost_of_uri TEXT")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS processed BOOLEAN")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS metrics_json JSONB")
            cursor.execute("ALTER TABLE public.raw_posts ADD COLUMN IF NOT EXISTS raw_json JSONB")
            cursor.execute("ALTER TABLE public.raw_posts ALTER COLUMN id SET NOT NULL")
            cursor.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_posts_id
                ON public.raw_posts (id)
                """
            )

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS public.authors (
                    platform TEXT NOT NULL,
                    author_id TEXT NOT NULL,
                    author_handle TEXT,
                    display_name TEXT,
                    followers_count BIGINT,
                    metadata_json JSONB,
                    first_seen_at TIMESTAMPTZ,
                    last_seen_at TIMESTAMPTZ
                )
                """
            )
            cursor.execute("ALTER TABLE public.authors ADD COLUMN IF NOT EXISTS platform TEXT")
            cursor.execute("ALTER TABLE public.authors ADD COLUMN IF NOT EXISTS author_id TEXT")
            cursor.execute("ALTER TABLE public.authors ADD COLUMN IF NOT EXISTS author_handle TEXT")
            cursor.execute("ALTER TABLE public.authors ADD COLUMN IF NOT EXISTS display_name TEXT")
            cursor.execute("ALTER TABLE public.authors ADD COLUMN IF NOT EXISTS followers_count BIGINT")
            cursor.execute("ALTER TABLE public.authors ADD COLUMN IF NOT EXISTS metadata_json JSONB")
            cursor.execute("ALTER TABLE public.authors ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ")
            cursor.execute("ALTER TABLE public.authors ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ")

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS public.ingestion_runs (
                    source TEXT NOT NULL,
                    started_at TIMESTAMPTZ NOT NULL,
                    ended_at TIMESTAMPTZ,
                    status TEXT,
                    rows_inserted BIGINT NOT NULL DEFAULT 0,
                    last_heartbeat_at TIMESTAMPTZ,
                    current_stage TEXT,
                    rows_written_this_cycle BIGINT NOT NULL DEFAULT 0,
                    last_successful_write_at TIMESTAMPTZ,
                    notes JSONB
                )
                """
            )
            cursor.execute("ALTER TABLE public.ingestion_runs ADD COLUMN IF NOT EXISTS source TEXT")
            cursor.execute("ALTER TABLE public.ingestion_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ")
            cursor.execute("ALTER TABLE public.ingestion_runs ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ")
            cursor.execute("ALTER TABLE public.ingestion_runs ADD COLUMN IF NOT EXISTS status TEXT")
            cursor.execute("ALTER TABLE public.ingestion_runs ADD COLUMN IF NOT EXISTS rows_inserted BIGINT")
            cursor.execute("ALTER TABLE public.ingestion_runs ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ")
            cursor.execute("ALTER TABLE public.ingestion_runs ADD COLUMN IF NOT EXISTS current_stage TEXT")
            cursor.execute("ALTER TABLE public.ingestion_runs ADD COLUMN IF NOT EXISTS rows_written_this_cycle BIGINT")
            cursor.execute("ALTER TABLE public.ingestion_runs ADD COLUMN IF NOT EXISTS last_successful_write_at TIMESTAMPTZ")
            cursor.execute("ALTER TABLE public.ingestion_runs ADD COLUMN IF NOT EXISTS notes JSONB")

            cursor.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_posts_platform_post_id
                ON public.raw_posts (platform, post_id)
                """
            )
            cursor.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS raw_posts_platform_source_post_id_idx
                ON public.raw_posts (platform, source_post_id)
                """
            )
            cursor.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_authors_platform_author_id
                ON public.authors (platform, author_id)
                """
            )
            cursor.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_ingestion_runs_source_started_at
                ON public.ingestion_runs (source, started_at)
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source_heartbeat
                ON public.ingestion_runs (source, last_heartbeat_at DESC)
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source_status_started
                ON public.ingestion_runs (source, status, started_at DESC)
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_raw_posts_created_at
                ON public.raw_posts (created_at)
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_raw_posts_ingested_at
                ON public.raw_posts (ingested_at)
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_raw_posts_platform_created_at
                ON public.raw_posts (platform, created_at DESC)
                """
            )

        self._conn.commit()

    def ensure_metric_bucket_tables(self) -> None:
        def operation(connection: psycopg.Connection[Any]) -> None:
            lock_key = 9_148_221
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s)", (lock_key,))
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.metric_buckets_1m (
                        bucket_start TIMESTAMPTZ NOT NULL,
                        platform TEXT NOT NULL,
                        mention_count BIGINT NOT NULL,
                        unique_authors BIGINT NOT NULL,
                        PRIMARY KEY (bucket_start, platform)
                    )
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1m
                    ADD COLUMN IF NOT EXISTS bucket_start TIMESTAMPTZ
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1m
                    ADD COLUMN IF NOT EXISTS bucket_minute TIMESTAMPTZ
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1m
                    ADD COLUMN IF NOT EXISTS platform TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1m
                    ADD COLUMN IF NOT EXISTS mention_count BIGINT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1m
                    ADD COLUMN IF NOT EXISTS raw_post_count INTEGER
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1m
                    ADD COLUMN IF NOT EXISTS processed_post_count INTEGER
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1m
                    ADD COLUMN IF NOT EXISTS unique_authors BIGINT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1m
                    ADD COLUMN IF NOT EXISTS reply_count INTEGER
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1m
                    ADD COLUMN IF NOT EXISTS repost_count INTEGER
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1m
                    ADD COLUMN IF NOT EXISTS link_post_count INTEGER
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1m
                    ADD COLUMN IF NOT EXISTS media_post_count INTEGER
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1m
                    ADD COLUMN IF NOT EXISTS avg_quality_score NUMERIC
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1m
                    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.metric_buckets_1h (
                        bucket_start TIMESTAMPTZ NOT NULL,
                        platform TEXT NOT NULL,
                        mention_count BIGINT NOT NULL,
                        unique_authors BIGINT NOT NULL,
                        PRIMARY KEY (bucket_start, platform)
                    )
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1h
                    ADD COLUMN IF NOT EXISTS bucket_start TIMESTAMPTZ
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1h
                    ADD COLUMN IF NOT EXISTS platform TEXT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1h
                    ADD COLUMN IF NOT EXISTS mention_count BIGINT
                    """
                )
                cursor.execute(
                    """
                    ALTER TABLE public.metric_buckets_1h
                    ADD COLUMN IF NOT EXISTS unique_authors BIGINT
                    """
                )
                cursor.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_metric_buckets_1m_bucket_platform
                    ON public.metric_buckets_1m (bucket_start, platform)
                    """
                )
                cursor.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS metric_buckets_1m_pkey
                    ON public.metric_buckets_1m (bucket_minute, platform)
                    """
                )
                cursor.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_metric_buckets_1h_bucket_platform
                    ON public.metric_buckets_1h (bucket_start, platform)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_metric_buckets_1m_platform_bucket
                    ON public.metric_buckets_1m (platform, bucket_start DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_metric_buckets_1h_platform_bucket
                    ON public.metric_buckets_1h (platform, bucket_start DESC)
                    """
                )

        self._execute_write("ensure_metric_bucket_tables", operation)

    def aggregate_metric_buckets_1m(self) -> int:
        def operation(connection: psycopg.Connection[Any]) -> int:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.metric_buckets_1m (
                        bucket_minute,
                        bucket_start,
                        platform,
                        raw_post_count,
                        processed_post_count,
                        mention_count,
                        unique_authors,
                        reply_count,
                        repost_count,
                        link_post_count,
                        media_post_count,
                        avg_quality_score,
                        created_at
                    )
                    SELECT
                        date_trunc('minute', created_at) AS bucket_minute,
                        date_trunc('minute', created_at) AS bucket_start,
                        platform,
                        COUNT(*)::INT AS raw_post_count,
                        COUNT(*)::INT AS processed_post_count,
                        COUNT(*)::BIGINT AS mention_count,
                        COUNT(DISTINCT author_id)::BIGINT AS unique_authors,
                        SUM(CASE WHEN reply_parent_id IS NOT NULL THEN 1 ELSE 0 END)::INT AS reply_count,
                        SUM(CASE WHEN repost_of_uri IS NOT NULL THEN 1 ELSE 0 END)::INT AS repost_count,
                        SUM(CASE WHEN COALESCE(array_length(urls, 1), 0) > 0 THEN 1 ELSE 0 END)::INT AS link_post_count,
                        0::INT AS media_post_count,
                        0::NUMERIC AS avg_quality_score,
                        now() AS created_at
                    FROM public.raw_posts
                    WHERE created_at IS NOT NULL
                      AND platform IS NOT NULL
                    GROUP BY 1, 2, 3
                    ON CONFLICT (bucket_minute, platform) DO UPDATE
                    SET bucket_start = EXCLUDED.bucket_start,
                        raw_post_count = EXCLUDED.raw_post_count,
                        processed_post_count = EXCLUDED.processed_post_count,
                        mention_count = EXCLUDED.mention_count,
                        unique_authors = EXCLUDED.unique_authors,
                        reply_count = EXCLUDED.reply_count,
                        repost_count = EXCLUDED.repost_count,
                        link_post_count = EXCLUDED.link_post_count,
                        media_post_count = EXCLUDED.media_post_count,
                        avg_quality_score = EXCLUDED.avg_quality_score,
                        created_at = EXCLUDED.created_at
                    """
                )
                return int(cursor.rowcount or 0)

        return self._execute_write("aggregate_metric_buckets_1m", operation)

    def aggregate_metric_buckets_1h(self) -> int:
        def operation(connection: psycopg.Connection[Any]) -> int:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.metric_buckets_1h (
                        bucket_start,
                        platform,
                        mention_count,
                        unique_authors
                    )
                    SELECT
                        date_trunc('hour', created_at) AS bucket_start,
                        platform,
                        COUNT(*)::BIGINT AS mention_count,
                        COUNT(DISTINCT author_id)::BIGINT AS unique_authors
                    FROM public.raw_posts
                    WHERE created_at IS NOT NULL
                      AND platform IS NOT NULL
                    GROUP BY 1, 2
                    ON CONFLICT (bucket_start, platform) DO UPDATE
                    SET mention_count = EXCLUDED.mention_count,
                        unique_authors = EXCLUDED.unique_authors
                    """
                )
                return int(cursor.rowcount or 0)

        return self._execute_write("aggregate_metric_buckets_1h", operation)

    def ensure_processed_topic_tables(self) -> None:
        def operation(connection: psycopg.Connection[Any]) -> None:
            with connection.cursor() as cursor:
                self._apply_schema_lock_timeout(cursor)
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.processed_posts (
                        id BIGSERIAL PRIMARY KEY,
                        raw_post_id BIGINT NOT NULL,
                        platform TEXT NOT NULL,
                        source_post_id TEXT NOT NULL,
                        source_created_at TIMESTAMPTZ,
                        post_id TEXT,
                        author_id TEXT,
                        created_at TIMESTAMPTZ NOT NULL,
                        processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        bucket_minute TIMESTAMPTZ NOT NULL,
                        clean_text TEXT,
                        normalized_text TEXT,
                        language TEXT,
                        quality_score DOUBLE PRECISION NOT NULL DEFAULT 0,
                        topic_key_candidate TEXT,
                        tokens TEXT[] NOT NULL DEFAULT '{}'::text[],
                        mentions TEXT[] NOT NULL DEFAULT '{}'::text[],
                        tags TEXT[] NOT NULL DEFAULT '{}'::text[],
                        topic_entities TEXT[] NOT NULL DEFAULT '{}'::text[],
                        sentiment_label TEXT NOT NULL DEFAULT 'neutral',
                        sentiment_positive_score INTEGER NOT NULL DEFAULT 0,
                        sentiment_negative_score INTEGER NOT NULL DEFAULT 0,
                        sentiment_neutral_score INTEGER NOT NULL DEFAULT 0,
                        has_media BOOLEAN NOT NULL DEFAULT false,
                        is_reply BOOLEAN NOT NULL DEFAULT false,
                        is_repost BOOLEAN NOT NULL DEFAULT false,
                        is_quote BOOLEAN NOT NULL DEFAULT false,
                        author_hash TEXT,
                        token_count INTEGER NOT NULL DEFAULT 0,
                        fingerprint TEXT,
                        hashtags TEXT[] NOT NULL DEFAULT '{}'::text[],
                        cashtags TEXT[] NOT NULL DEFAULT '{}'::text[],
                        domains TEXT[] NOT NULL DEFAULT '{}'::text[],
                        urls TEXT[] NOT NULL DEFAULT '{}'::text[],
                        key_phrases TEXT[] NOT NULL DEFAULT '{}'::text[],
                        topic_seeds TEXT[] NOT NULL DEFAULT '{}'::text[],
                        spam_score NUMERIC NOT NULL DEFAULT 0,
                        topic TEXT
                    )
                    """
                )
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS raw_post_id BIGINT")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS platform TEXT")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS source_post_id TEXT")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS source_created_at TIMESTAMPTZ")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS post_id TEXT")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS author_id TEXT")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS bucket_minute TIMESTAMPTZ")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS clean_text TEXT")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS normalized_text TEXT")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS language TEXT")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS quality_score DOUBLE PRECISION")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS topic_key_candidate TEXT")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS tokens TEXT[]")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS mentions TEXT[]")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS tags TEXT[]")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS topic_entities TEXT[]")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS sentiment_label TEXT")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS sentiment_positive_score INTEGER")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS sentiment_negative_score INTEGER")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS sentiment_neutral_score INTEGER")
                cursor.execute("ALTER TABLE public.processed_posts ALTER COLUMN topic_entities SET DEFAULT '{}'::text[]")
                cursor.execute("ALTER TABLE public.processed_posts ALTER COLUMN sentiment_label SET DEFAULT 'neutral'")
                cursor.execute("ALTER TABLE public.processed_posts ALTER COLUMN sentiment_positive_score SET DEFAULT 0")
                cursor.execute("ALTER TABLE public.processed_posts ALTER COLUMN sentiment_negative_score SET DEFAULT 0")
                cursor.execute("ALTER TABLE public.processed_posts ALTER COLUMN sentiment_neutral_score SET DEFAULT 0")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS has_media BOOLEAN")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS is_reply BOOLEAN")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS is_repost BOOLEAN")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS is_quote BOOLEAN")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS author_hash TEXT")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS token_count INTEGER")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS fingerprint TEXT")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS hashtags TEXT[]")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS cashtags TEXT[]")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS domains TEXT[]")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS urls TEXT[]")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS key_phrases TEXT[]")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS topic_seeds TEXT[]")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS spam_score NUMERIC")
                cursor.execute("ALTER TABLE public.processed_posts ADD COLUMN IF NOT EXISTS topic TEXT")
                cursor.execute(
                    """
                    UPDATE public.processed_posts
                    SET processed_at = now()
                    WHERE processed_at IS NULL
                    """
                )
                cursor.execute(
                    """
                    UPDATE public.processed_posts
                    SET bucket_minute = date_trunc(
                        'minute',
                        COALESCE(source_created_at, created_at, processed_at, now())
                    )
                    WHERE bucket_minute IS NULL
                    """
                )
                cursor.execute(
                    """
                    UPDATE public.processed_posts
                    SET sentiment_label = COALESCE(sentiment_label, 'neutral'),
                        sentiment_positive_score = COALESCE(sentiment_positive_score, 0),
                        sentiment_negative_score = COALESCE(sentiment_negative_score, 0),
                        sentiment_neutral_score = COALESCE(sentiment_neutral_score, 0),
                        topic_entities = COALESCE(topic_entities, '{}'::text[])
                    WHERE sentiment_label IS NULL
                       OR sentiment_positive_score IS NULL
                       OR sentiment_negative_score IS NULL
                       OR sentiment_neutral_score IS NULL
                       OR topic_entities IS NULL
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.topic_buckets_1m (
                        bucket_minute TIMESTAMPTZ NOT NULL,
                        platform TEXT NOT NULL,
                        topic_key TEXT NOT NULL,
                        mention_count INTEGER NOT NULL,
                        unique_authors INTEGER NOT NULL,
                        total_quality_score NUMERIC NOT NULL DEFAULT 0,
                        avg_quality_score NUMERIC NOT NULL DEFAULT 0,
                        repost_count INTEGER NOT NULL DEFAULT 0,
                        reply_count INTEGER NOT NULL DEFAULT 0,
                        link_post_count INTEGER NOT NULL DEFAULT 0,
                        sample_size INTEGER NOT NULL DEFAULT 0,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        bucket_start TIMESTAMPTZ,
                        topic TEXT,
                        PRIMARY KEY (bucket_minute, platform, topic_key)
                    )
                    """
                )
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS bucket_minute TIMESTAMPTZ")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS platform TEXT")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS topic_key TEXT")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS mention_count INTEGER")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS unique_authors INTEGER")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS total_quality_score NUMERIC")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS avg_quality_score NUMERIC")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS repost_count INTEGER")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS reply_count INTEGER")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS link_post_count INTEGER")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS sample_size INTEGER")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS bucket_start TIMESTAMPTZ")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS topic TEXT")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS normalized_topic TEXT")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS topic_display TEXT")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS unique_posts INTEGER")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS positive_count INTEGER")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS neutral_count INTEGER")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS negative_count INTEGER")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS sentiment_net INTEGER")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS sentiment_score DOUBLE PRECISION")
                cursor.execute("ALTER TABLE public.topic_buckets_1m ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ")
                cursor.execute(
                    """
                    UPDATE public.topic_buckets_1m
                    SET normalized_topic = COALESCE(
                            NULLIF(TRIM(normalized_topic), ''),
                            LOWER(COALESCE(NULLIF(TRIM(topic_key), ''), 'all'))
                        ),
                        topic_display = COALESCE(
                            NULLIF(TRIM(topic_display), ''),
                            NULLIF(TRIM(topic), ''),
                            INITCAP(COALESCE(NULLIF(TRIM(topic_key), ''), 'all'))
                        ),
                        unique_posts = COALESCE(unique_posts, mention_count, 0),
                        positive_count = COALESCE(positive_count, 0),
                        neutral_count = COALESCE(neutral_count, mention_count, 0),
                        negative_count = COALESCE(negative_count, 0),
                        sentiment_net = COALESCE(sentiment_net, 0),
                        sentiment_score = COALESCE(sentiment_score, 0),
                        updated_at = COALESCE(updated_at, created_at, now())
                    WHERE normalized_topic IS NULL
                       OR topic_display IS NULL
                       OR unique_posts IS NULL
                       OR positive_count IS NULL
                       OR neutral_count IS NULL
                       OR negative_count IS NULL
                       OR sentiment_net IS NULL
                       OR sentiment_score IS NULL
                       OR updated_at IS NULL
                    """
                )
                cursor.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_topic_buckets_1m_bucket_platform_topic
                    ON public.topic_buckets_1m (bucket_minute, platform, topic_key)
                    """
                )
                cursor.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_processed_posts_raw_post_id
                    ON public.processed_posts (raw_post_id)
                    """
                )
                cursor.execute(
                    """
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1
                            FROM pg_constraint
                            WHERE conrelid = 'public.processed_posts'::regclass
                              AND confrelid = 'public.raw_posts'::regclass
                              AND contype = 'f'
                        ) THEN
                            ALTER TABLE public.processed_posts
                            ADD CONSTRAINT processed_posts_raw_post_id_fkey
                            FOREIGN KEY (raw_post_id)
                            REFERENCES public.raw_posts(id)
                            ON DELETE CASCADE;
                        END IF;
                    END;
                    $$;
                    """
                )
                cursor.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_processed_posts_platform_source_post_id
                    ON public.processed_posts (platform, source_post_id)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_processed_posts_created_at
                    ON public.processed_posts (created_at DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_processed_posts_bucket_minute
                    ON public.processed_posts (bucket_minute)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_processed_posts_platform_bucket_minute
                    ON public.processed_posts (platform, bucket_minute)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_processed_posts_topic_key_candidate
                    ON public.processed_posts (topic_key_candidate)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_processed_posts_topic
                    ON public.processed_posts (platform, source_post_id, created_at DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_processed_posts_sentiment_label
                    ON public.processed_posts (sentiment_label)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_processed_posts_tags_gin
                    ON public.processed_posts
                    USING GIN (tags)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_topic_buckets_1m_platform_topic_bucket
                    ON public.topic_buckets_1m (platform, topic_key, bucket_minute DESC)
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS public.post_topics (
                        id BIGSERIAL PRIMARY KEY,
                        raw_post_id BIGINT NOT NULL,
                        processed_post_id BIGINT,
                        platform TEXT NOT NULL,
                        source_post_id TEXT NOT NULL,
                        topic_text TEXT NOT NULL,
                        normalized_topic TEXT NOT NULL,
                        topic_type TEXT NOT NULL,
                        language TEXT,
                        source_created_at TIMESTAMPTZ,
                        bucket_minute TIMESTAMPTZ NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
                cursor.execute("ALTER TABLE public.post_topics ADD COLUMN IF NOT EXISTS id BIGSERIAL")
                cursor.execute("ALTER TABLE public.post_topics ADD COLUMN IF NOT EXISTS raw_post_id BIGINT")
                cursor.execute("ALTER TABLE public.post_topics ADD COLUMN IF NOT EXISTS processed_post_id BIGINT")
                cursor.execute("ALTER TABLE public.post_topics ADD COLUMN IF NOT EXISTS platform TEXT")
                cursor.execute("ALTER TABLE public.post_topics ADD COLUMN IF NOT EXISTS source_post_id TEXT")
                cursor.execute("ALTER TABLE public.post_topics ADD COLUMN IF NOT EXISTS topic_text TEXT")
                cursor.execute("ALTER TABLE public.post_topics ADD COLUMN IF NOT EXISTS normalized_topic TEXT")
                cursor.execute("ALTER TABLE public.post_topics ADD COLUMN IF NOT EXISTS topic_type TEXT")
                cursor.execute("ALTER TABLE public.post_topics ADD COLUMN IF NOT EXISTS language TEXT")
                cursor.execute("ALTER TABLE public.post_topics ADD COLUMN IF NOT EXISTS source_created_at TIMESTAMPTZ")
                cursor.execute("ALTER TABLE public.post_topics ADD COLUMN IF NOT EXISTS bucket_minute TIMESTAMPTZ")
                cursor.execute("ALTER TABLE public.post_topics ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ")
                cursor.execute(
                    """
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1
                            FROM pg_constraint
                            WHERE conname = 'post_topics_raw_post_id_fkey'
                              AND conrelid = 'public.post_topics'::regclass
                        ) THEN
                            ALTER TABLE public.post_topics
                            ADD CONSTRAINT post_topics_raw_post_id_fkey
                            FOREIGN KEY (raw_post_id)
                            REFERENCES public.raw_posts(id)
                            ON DELETE CASCADE;
                        END IF;
                    END;
                    $$;
                    """
                )
                cursor.execute(
                    """
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1
                            FROM pg_constraint
                            WHERE conname = 'post_topics_processed_post_id_fkey'
                              AND conrelid = 'public.post_topics'::regclass
                        ) THEN
                            ALTER TABLE public.post_topics
                            ADD CONSTRAINT post_topics_processed_post_id_fkey
                            FOREIGN KEY (processed_post_id)
                            REFERENCES public.processed_posts(id)
                            ON DELETE CASCADE;
                        END IF;
                    END;
                    $$;
                    """
                )
                cursor.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_post_topics_raw_topic_type
                    ON public.post_topics (raw_post_id, normalized_topic, topic_type)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_post_topics_bucket_minute
                    ON public.post_topics (bucket_minute)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_post_topics_normalized_topic
                    ON public.post_topics (normalized_topic)
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_post_topics_platform_bucket_minute
                    ON public.post_topics (platform, bucket_minute)
                    """
                )

            self._load_column_metadata()

        self._execute_write("ensure_processed_topic_tables", operation)

    def refresh_processed_posts_from_raw_posts(self) -> int:
        def operation(connection: psycopg.Connection[Any]) -> int:
            with connection.cursor() as cursor:
                cursor.execute("TRUNCATE TABLE public.processed_posts")
                cursor.execute(
                    """
                    INSERT INTO public.processed_posts (
                        raw_post_id,
                        platform,
                        source_post_id,
                        post_id,
                        author_id,
                        source_created_at,
                        created_at,
                        processed_at,
                        bucket_minute,
                        clean_text,
                        normalized_text,
                        language,
                        quality_score,
                        topic_key_candidate,
                        tokens,
                        has_media,
                        is_reply,
                        is_repost,
                        is_quote,
                        author_hash,
                        token_count,
                        mentions,
                        tags,
                        topic_entities,
                        hashtags,
                        cashtags,
                        domains,
                        urls,
                        key_phrases,
                        topic_seeds,
                        sentiment_label,
                        sentiment_positive_score,
                        sentiment_negative_score,
                        sentiment_neutral_score,
                        spam_score,
                        topic
                    )
                    SELECT
                        rp.id,
                        rp.platform,
                        COALESCE(rp.source_post_id, rp.post_id),
                        rp.post_id,
                        rp.author_id,
                        rp.created_at,
                        rp.created_at,
                        COALESCE(rp.ingested_at, rp.inserted_at, now()),
                        date_trunc('minute', rp.created_at),
                        COALESCE(rp.raw_text, rp.text_content),
                        COALESCE(rp.raw_text, rp.text_content),
                        rp.language,
                        0::double precision,
                        'general'::text,
                        '{}'::text[],
                        false,
                        (rp.reply_parent_id IS NOT NULL),
                        (rp.repost_of_uri IS NOT NULL),
                        false,
                        NULL::text,
                        0,
                        '{}'::text[],
                        ARRAY['general']::text[],
                        ARRAY['general']::text[],
                        COALESCE(rp.hashtags, '{}'::text[]),
                        '{}'::text[],
                        '{}'::text[],
                        COALESCE(rp.urls, '{}'::text[]),
                        '{}'::text[],
                        '{}'::text[],
                        'neutral'::text,
                        0::int,
                        0::int,
                        0::int,
                        0::numeric,
                        'all'::text AS topic
                    FROM public.raw_posts rp
                    WHERE rp.platform IS NOT NULL
                      AND COALESCE(rp.source_post_id, rp.post_id) IS NOT NULL
                      AND rp.created_at IS NOT NULL
                    """
                )
                return int(cursor.rowcount or 0)

        return self._execute_write("refresh_processed_posts_from_raw_posts", operation)

    def aggregate_topic_buckets_1m_from_processed_posts(
        self,
        *,
        lookback_hours: float = 30.0,
        retention_hours: float = 192.0,
    ) -> int:
        recompute_lookback_hours = max(1.0, float(lookback_hours))
        stale_retention_hours = max(recompute_lookback_hours, float(retention_hours))

        def operation(connection: psycopg.Connection[Any]) -> int:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    WITH aggregation_bounds AS (
                        SELECT date_trunc('minute', now() - (%s * interval '1 hour')) AS recompute_from
                    )
                    DELETE FROM public.topic_buckets_1m
                    WHERE bucket_minute >= (SELECT recompute_from FROM aggregation_bounds)
                    """,
                    (recompute_lookback_hours,),
                )
                cursor.execute(
                    """
                    DELETE FROM public.topic_buckets_1m
                    WHERE bucket_minute < date_trunc('minute', now() - (%s * interval '1 hour'))
                    """,
                    (stale_retention_hours,),
                )
                cursor.execute(
                    """
                    WITH aggregation_bounds AS (
                        SELECT date_trunc('minute', now() - (%s * interval '1 hour')) AS recompute_from
                    ),
                    weak_topic_tokens(token) AS (
                        VALUES
                            ('a'),
                            ('about'),
                            ('after'),
                            ('all'),
                            ('also'),
                            ('am'),
                            ('an'),
                            ('and'),
                            ('any'),
                            ('are'),
                            ('as'),
                            ('at'),
                            ('be'),
                            ('because'),
                            ('been'),
                            ('before'),
                            ('being'),
                            ('but'),
                            ('by'),
                            ('can'),
                            ('could'),
                            ('did'),
                            ('do'),
                            ('does'),
                            ('dont'),
                            ('for'),
                            ('from'),
                            ('get'),
                            ('got'),
                            ('had'),
                            ('has'),
                            ('have'),
                            ('here'),
                            ('how'),
                            ('i'),
                            ('ill'),
                            ('im'),
                            ('in'),
                            ('into'),
                            ('is'),
                            ('it'),
                            ('its'),
                            ('ive'),
                            ('just'),
                            ('like'),
                            ('many'),
                            ('may'),
                            ('me'),
                            ('might'),
                            ('more'),
                            ('most'),
                            ('my'),
                            ('need'),
                            ('no'),
                            ('not'),
                            ('now'),
                            ('of'),
                            ('on'),
                            ('one'),
                            ('or'),
                            ('our'),
                            ('same'),
                            ('she'),
                            ('should'),
                            ('so'),
                            ('some'),
                            ('still'),
                            ('that'),
                            ('the'),
                            ('their'),
                            ('them'),
                            ('then'),
                            ('there'),
                            ('these'),
                            ('they'),
                            ('this'),
                            ('those'),
                            ('to'),
                            ('today'),
                            ('tomorrow'),
                            ('us'),
                            ('very'),
                            ('was'),
                            ('we'),
                            ('were'),
                            ('what'),
                            ('when'),
                            ('where'),
                            ('which'),
                            ('who'),
                            ('why'),
                            ('will'),
                            ('with'),
                            ('would'),
                            ('absolutely'),
                            ('actually'),
                            ('ad'),
                            ('adorable'),
                            ('again'),
                            ('all'),
                            ('always'),
                            ('amazing'),
                            ('another'),
                            ('anyone'),
                            ('appreciate'),
                            ('area'),
                            ('available'),
                            ('back'),
                            ('believe'),
                            ('best'),
                            ('better'),
                            ('big'),
                            ('bluesky'),
                            ('bot'),
                            ('bsky'),
                            ('character'),
                            ('come'),
                            ('coming'),
                            ('cool'),
                            ('cute'),
                            ('day'),
                            ('digit'),
                            ('doing'),
                            ('don'),
                            ('early'),
                            ('else'),
                            ('enjoy'),
                            ('even'),
                            ('ever'),
                            ('every'),
                            ('everyone'),
                            ('exactly'),
                            ('facebook'),
                            ('feel'),
                            ('feels'),
                            ('feed'),
                            ('finally'),
                            ('first'),
                            ('funny'),
                            ('game'),
                            ('games'),
                            ('gave'),
                            ('global'),
                            ('going'),
                            ('gonna'),
                            ('gorgeous'),
                            ('half'),
                            ('happy'),
                            ('hear'),
                            ('hehe'),
                            ('hello'),
                            ('hey'),
                            ('hi'),
                            ('his'),
                            ('hope'),
                            ('house'),
                            ('id'),
                            ('imagine'),
                            ('incredible'),
                            ('instead'),
                            ('internet'),
                            ('kind'),
                            ('know'),
                            ('last'),
                            ('lets'),
                            ('little'),
                            ('live'),
                            ('looks'),
                            ('loved'),
                            ('love'),
                            ('major'),
                            ('make'),
                            ('making'),
                            ('mean'),
                            ('mind'),
                            ('much'),
                            ('myself'),
                            ('needs'),
                            ('never'),
                            ('new'),
                            ('news'),
                            ('next'),
                            ('nice'),
                            ('night'),
                            ('nowplaying'),
                            ('oh'),
                            ('ok'),
                            ('once'),
                            ('only'),
                            ('original'),
                            ('over'),
                            ('part'),
                            ('photography'),
                            ('place'),
                            ('please'),
                            ('post'),
                            ('pretty'),
                            ('probably'),
                            ('profile'),
                            ('pulse'),
                            ('read'),
                            ('right'),
                            ('said'),
                            ('say'),
                            ('see'),
                            ('seems'),
                            ('share'),
                            ('shit'),
                            ('short'),
                            ('social'),
                            ('someone'),
                            ('something'),
                            ('sometimes'),
                            ('sorry'),
                            ('stop'),
                            ('story'),
                            ('such'),
                            ('super'),
                            ('sure'),
                            ('sunday'),
                            ('talk'),
                            ('talent'),
                            ('technology'),
                            ('thank'),
                            ('thanks'),
                            ('thats'),
                            ('think'),
                            ('through'),
                            ('time'),
                            ('true'),
                            ('trying'),
                            ('tv'),
                            ('video'),
                            ('vote'),
                            ('wait'),
                            ('watching'),
                            ('well'),
                            ('went'),
                            ('while'),
                            ('wish'),
                            ('work'),
                            ('yeah'),
                            ('yes'),
                            ('young'),
                            ('you'),
                            ('your'),
                            ('de'),
                            ('del'),
                            ('der'),
                            ('des'),
                            ('die'),
                            ('el'),
                            ('en'),
                            ('es'),
                            ('est'),
                            ('et'),
                            ('ich'),
                            ('la'),
                            ('le'),
                            ('mas'),
                            ('pero'),
                            ('por'),
                            ('si'),
                            ('una'),
                            ('und')
                    ),
                    topic_noise_tokens(token) AS (
                        VALUES
                            ('additional'),
                            ('advisory'),
                            ('afd'),
                            ('airnow'),
                            ('aqi'),
                            ('details'),
                            ('discussion'),
                            ('forecast'),
                            ('iembot'),
                            ('issued'),
                            ('prelim'),
                            ('statement'),
                            ('update')
                    ),
                    topic_mentions_raw AS (
                        SELECT
                            date_trunc(
                                'minute',
                                COALESCE(
                                    pt.bucket_minute,
                                    pp.bucket_minute,
                                    pp.source_created_at,
                                    pp.created_at,
                                    pp.processed_at,
                                    now()
                                )
                            ) AS bucket_minute,
                            COALESCE(NULLIF(TRIM(pt.platform), ''), COALESCE(pp.platform, 'bluesky')) AS platform,
                            CASE
                                WHEN btrim(
                                    regexp_replace(
                                        regexp_replace(lower(COALESCE(pt.normalized_topic, '')), '[^a-z0-9$#\\s]+', ' ', 'g'),
                                        '\\s+',
                                        ' ',
                                        'g'
                                    )
                                ) IN ('nokings', 'no king', 'no kings', 'no kings s', 'no kingss')
                                    THEN 'no kings'
                                ELSE btrim(
                                    regexp_replace(
                                        regexp_replace(lower(COALESCE(pt.normalized_topic, '')), '[^a-z0-9$#\\s]+', ' ', 'g'),
                                        '\\s+',
                                        ' ',
                                        'g'
                                    )
                                )
                            END AS normalized_topic,
                            COALESCE(NULLIF(TRIM(pt.topic_text), ''), NULLIF(TRIM(pt.normalized_topic), '')) AS topic_text,
                            pt.raw_post_id,
                            COALESCE(pp.author_id, '') AS author_id,
                            COALESCE(pp.quality_score, 0)::double precision AS quality_score,
                            COALESCE(pp.is_repost, false) AS is_repost,
                            COALESCE(pp.is_reply, false) AS is_reply,
                            (COALESCE(array_length(pp.urls, 1), 0) > 0) AS has_link,
                            CASE
                                WHEN COALESCE(pp.sentiment_label, '') IN ('positive', 'negative', 'neutral')
                                    THEN pp.sentiment_label
                                ELSE 'neutral'
                            END AS sentiment_label,
                            CASE
                                WHEN pt.topic_type = 'cashtag' THEN 1
                                WHEN pt.topic_type = 'hashtag' THEN 2
                                WHEN pt.topic_type = 'entity' THEN 3
                                WHEN pt.topic_type = 'keyword' THEN 4
                                ELSE 9
                            END AS topic_priority
                        FROM public.post_topics pt
                        LEFT JOIN public.processed_posts pp
                            ON pp.id = pt.processed_post_id
                        WHERE COALESCE(pt.normalized_topic, '') <> ''
                          AND date_trunc(
                              'minute',
                              COALESCE(
                                  pt.bucket_minute,
                                  pp.bucket_minute,
                                  pp.source_created_at,
                                  pp.created_at,
                                  pp.processed_at,
                                  now()
                              )
                          ) >= (SELECT recompute_from FROM aggregation_bounds)
                    ),
                    topic_mentions AS (
                        SELECT DISTINCT ON (raw_post_id, platform, normalized_topic)
                            bucket_minute,
                            platform,
                            normalized_topic,
                            topic_text,
                            raw_post_id,
                            author_id,
                            quality_score,
                            is_repost,
                            is_reply,
                            has_link,
                            sentiment_label,
                            topic_priority,
                            false AS from_fallback
                        FROM topic_mentions_raw
                        WHERE normalized_topic <> ''
                          AND normalized_topic NOT IN ('all', 'general')
                          AND normalized_topic NOT IN (SELECT token FROM weak_topic_tokens)
                          AND length(replace(normalized_topic, ' ', '')) >= 2
                          AND NOT EXISTS (
                              SELECT 1
                              FROM unnest(string_to_array(normalized_topic, ' ')) AS topic_token(token)
                              WHERE topic_token.token <> ''
                                AND topic_token.token IN (SELECT token FROM topic_noise_tokens)
                          )
                        ORDER BY raw_post_id, platform, normalized_topic, topic_priority ASC, quality_score DESC
                    ),
                    fallback_mentions AS (
                        SELECT
                            date_trunc(
                                'minute',
                                COALESCE(
                                    pp.bucket_minute,
                                    pp.source_created_at,
                                    pp.created_at,
                                    pp.processed_at,
                                    now()
                                )
                            ) AS bucket_minute,
                            COALESCE(pp.platform, 'bluesky') AS platform,
                            CASE
                                WHEN btrim(
                                    regexp_replace(
                                        regexp_replace(
                                            lower(COALESCE(pp.topic, pp.topic_key_candidate, '')),
                                            '[^a-z0-9$#\\s]+',
                                            ' ',
                                            'g'
                                        ),
                                        '\\s+',
                                        ' ',
                                        'g'
                                    )
                                ) IN ('nokings', 'no king', 'no kings', 'no kings s', 'no kingss')
                                    THEN 'no kings'
                                ELSE btrim(
                                    regexp_replace(
                                        regexp_replace(
                                            lower(COALESCE(pp.topic, pp.topic_key_candidate, '')),
                                            '[^a-z0-9$#\\s]+',
                                            ' ',
                                            'g'
                                        ),
                                        '\\s+',
                                        ' ',
                                        'g'
                                    )
                                )
                            END AS normalized_topic,
                            COALESCE(NULLIF(TRIM(pp.topic), ''), NULLIF(TRIM(pp.topic_key_candidate), '')) AS topic_text,
                            pp.raw_post_id,
                            COALESCE(pp.author_id, '') AS author_id,
                            COALESCE(pp.quality_score, 0)::double precision AS quality_score,
                            COALESCE(pp.is_repost, false) AS is_repost,
                            COALESCE(pp.is_reply, false) AS is_reply,
                            (COALESCE(array_length(pp.urls, 1), 0) > 0) AS has_link,
                            CASE
                                WHEN COALESCE(pp.sentiment_label, '') IN ('positive', 'negative', 'neutral')
                                    THEN pp.sentiment_label
                                ELSE 'neutral'
                            END AS sentiment_label,
                            9 AS topic_priority,
                            true AS from_fallback
                        FROM public.processed_posts pp
                        WHERE COALESCE(pp.topic, pp.topic_key_candidate, '') <> ''
                          AND date_trunc(
                              'minute',
                              COALESCE(
                                  pp.bucket_minute,
                                  pp.source_created_at,
                                  pp.created_at,
                                  pp.processed_at,
                                  now()
                              )
                          ) >= (SELECT recompute_from FROM aggregation_bounds)
                          AND NOT EXISTS (
                              SELECT 1
                              FROM public.post_topics pt
                              WHERE pt.raw_post_id = pp.raw_post_id
                          )
                    ),
                    all_mentions AS (
                        SELECT * FROM topic_mentions
                        UNION ALL
                        SELECT * FROM fallback_mentions
                    ),
                    filtered_mentions AS (
                        SELECT *
                        FROM all_mentions
                        WHERE normalized_topic <> ''
                          AND normalized_topic NOT IN ('all', 'general')
                          AND normalized_topic NOT IN (SELECT token FROM weak_topic_tokens)
                          AND length(replace(normalized_topic, ' ', '')) >= 2
                          AND NOT EXISTS (
                              SELECT 1
                              FROM unnest(string_to_array(normalized_topic, ' ')) AS topic_token(token)
                              WHERE topic_token.token <> ''
                                AND topic_token.token IN (SELECT token FROM topic_noise_tokens)
                          )
                          AND normalized_topic !~* '(^| )([a-z0-9]+bot)( |$)'
                          AND normalized_topic !~* '(area|forecast|discussion).*(afd|airnow|aqi)'
                          AND normalized_topic !~* '(additional|details) here'
                          AND (
                              SELECT COUNT(*)
                              FROM unnest(string_to_array(normalized_topic, ' ')) AS topic_token(token)
                              WHERE topic_token.token <> ''
                                AND (
                                    topic_token.token IN (SELECT token FROM weak_topic_tokens)
                                    OR topic_token.token IN (SELECT token FROM topic_noise_tokens)
                                )
                          ) <= GREATEST(1, array_length(string_to_array(normalized_topic, ' '), 1) - 1)
                          AND EXISTS (
                              SELECT 1
                              FROM unnest(string_to_array(normalized_topic, ' ')) AS topic_token(token)
                              WHERE topic_token.token <> ''
                                AND topic_token.token NOT IN (SELECT token FROM weak_topic_tokens)
                                AND topic_token.token NOT IN (SELECT token FROM topic_noise_tokens)
                                AND (
                                    length(topic_token.token) >= 4
                                )
                          )
                    ),
                    aggregated AS (
                        SELECT
                            bucket_minute,
                            platform,
                            normalized_topic,
                            COUNT(*)::INT AS mention_count,
                            COUNT(DISTINCT NULLIF(author_id, ''))::INT AS unique_authors,
                            COUNT(DISTINCT raw_post_id)::INT AS unique_posts,
                            COALESCE(SUM(quality_score), 0)::numeric AS total_quality_score,
                            COALESCE(AVG(quality_score), 0)::numeric AS avg_quality_score,
                            MIN(topic_priority)::INT AS best_topic_priority,
                            SUM(CASE WHEN is_repost THEN 1 ELSE 0 END)::INT AS repost_count,
                            SUM(CASE WHEN is_reply THEN 1 ELSE 0 END)::INT AS reply_count,
                            SUM(CASE WHEN has_link THEN 1 ELSE 0 END)::INT AS link_post_count,
                            SUM(CASE WHEN sentiment_label = 'positive' THEN 1 ELSE 0 END)::INT AS positive_count,
                            SUM(CASE WHEN sentiment_label = 'negative' THEN 1 ELSE 0 END)::INT AS negative_count,
                            SUM(CASE WHEN sentiment_label = 'neutral' THEN 1 ELSE 0 END)::INT AS neutral_count
                        FROM filtered_mentions
                        GROUP BY 1, 2, 3
                    ),
                    topic_totals AS (
                        SELECT
                            platform,
                            normalized_topic,
                            SUM(mention_count)::INT AS total_mentions
                        FROM aggregated
                        GROUP BY 1, 2
                    ),
                    filtered_aggregated AS (
                        SELECT aggregated.*
                        FROM aggregated
                        JOIN topic_totals
                          ON topic_totals.platform = aggregated.platform
                         AND topic_totals.normalized_topic = aggregated.normalized_topic
                        WHERE topic_totals.total_mentions >= 2
                    )
                    INSERT INTO public.topic_buckets_1m (
                        bucket_minute,
                        platform,
                        topic_key,
                        mention_count,
                        unique_authors,
                        total_quality_score,
                        avg_quality_score,
                        repost_count,
                        reply_count,
                        link_post_count,
                        sample_size,
                        created_at,
                        bucket_start,
                        topic,
                        normalized_topic,
                        topic_display,
                        unique_posts,
                        positive_count,
                        neutral_count,
                        negative_count,
                        sentiment_net,
                        sentiment_score,
                        updated_at
                    )
                    SELECT
                        bucket_minute,
                        platform,
                        normalized_topic AS topic_key,
                        mention_count,
                        unique_authors,
                        total_quality_score,
                        avg_quality_score,
                        repost_count,
                        reply_count,
                        link_post_count,
                        mention_count AS sample_size,
                        now() AS created_at,
                        bucket_minute AS bucket_start,
                        CASE
                            WHEN normalized_topic = 'no kings' THEN 'No Kings'
                            ELSE INITCAP(normalized_topic)
                        END AS topic,
                        normalized_topic,
                        CASE
                            WHEN normalized_topic = 'no kings' THEN 'No Kings'
                            ELSE INITCAP(normalized_topic)
                        END AS topic_display,
                        unique_posts,
                        positive_count,
                        neutral_count,
                        negative_count,
                        (positive_count - negative_count)::INT AS sentiment_net,
                        CASE
                            WHEN mention_count > 0 THEN
                                ROUND(((positive_count - negative_count)::numeric / mention_count)::numeric, 4)::double precision
                            ELSE 0::double precision
                        END AS sentiment_score,
                        now() AS updated_at
                    FROM filtered_aggregated
                    ON CONFLICT (bucket_minute, platform, topic_key) DO UPDATE
                    SET mention_count = EXCLUDED.mention_count,
                        unique_authors = EXCLUDED.unique_authors,
                        total_quality_score = EXCLUDED.total_quality_score,
                        avg_quality_score = EXCLUDED.avg_quality_score,
                        repost_count = EXCLUDED.repost_count,
                        reply_count = EXCLUDED.reply_count,
                        link_post_count = EXCLUDED.link_post_count,
                        sample_size = EXCLUDED.sample_size,
                        bucket_start = EXCLUDED.bucket_start,
                        topic = EXCLUDED.topic,
                        normalized_topic = EXCLUDED.normalized_topic,
                        topic_display = EXCLUDED.topic_display,
                        unique_posts = EXCLUDED.unique_posts,
                        positive_count = EXCLUDED.positive_count,
                        neutral_count = EXCLUDED.neutral_count,
                        negative_count = EXCLUDED.negative_count,
                        sentiment_net = EXCLUDED.sentiment_net,
                        sentiment_score = EXCLUDED.sentiment_score,
                        updated_at = EXCLUDED.updated_at
                    """
                    ,
                    (recompute_lookback_hours,),
                )
                return int(cursor.rowcount or 0)

        return self._execute_write("aggregate_topic_buckets_1m_from_processed_posts", operation)

    def _prepare_raw_post_row(self, row: dict[str, Any]) -> dict[str, Any]:
        ingested_at = row.get("ingested_at")
        if ingested_at is None:
            ingested_at = datetime.now(timezone.utc)
        created_at = row.get("created_at") or ingested_at
        raw_json_payload = row.get("raw_json") or {}
        if not isinstance(raw_json_payload, dict):
            raw_json_payload = {}
        source_post_id = str(row.get("source_post_id") or row.get("post_id") or "").strip()
        metrics_payload = dict(row.get("metrics_json") or {})
        return {
            "platform": str(row.get("platform") or "bluesky"),
            "source_post_id": source_post_id,
            "source_uri": str(row.get("source_uri") or source_post_id).strip() or None,
            "source_cid": str(row.get("source_cid") or raw_json_payload.get("cid") or "").strip() or None,
            "author_did": str(
                row.get("author_did")
                or row.get("author_id")
                or raw_json_payload.get("authorDid")
                or ""
            ).strip()
            or None,
            "post_id": str(row.get("post_id") or "").strip(),
            "author_id": str(row.get("author_id") or "").strip() or None,
            "author_handle": str(row.get("author_handle") or "").strip() or None,
            "root_post_id": str(row.get("root_post_id") or "").strip() or None,
            "reply_parent_id": str(row.get("reply_parent_id") or "").strip() or None,
            "created_at": created_at,
            "inserted_at": ingested_at,
            "ingested_at": ingested_at,
            "raw_text": str(row.get("raw_text") or row.get("text_content") or "").strip() or None,
            "text_content": str(row.get("text_content") or "").strip() or None,
            "language": str(row.get("language") or "").strip() or None,
            "urls": self._adapt_collection("raw_posts", "urls", row.get("urls")),
            "hashtags": self._adapt_collection("raw_posts", "hashtags", row.get("hashtags")),
            "like_count": int(
                row.get("like_count")
                or metrics_payload.get("likeCount")
                or 0
            ),
            "repost_count": int(
                row.get("repost_count")
                or metrics_payload.get("repostCount")
                or 0
            ),
            "reply_count": int(
                row.get("reply_count")
                or metrics_payload.get("replyCount")
                or 0
            ),
            "reply_to_uri": str(row.get("reply_to_uri") or row.get("reply_parent_id") or "").strip() or None,
            "repost_of_uri": str(
                row.get("repost_of_uri")
                or row.get("root_post_id")
                or raw_json_payload.get("quotedUri")
                or ""
            ).strip()
            or None,
            "processed": bool(row.get("processed", False)),
            "metrics_json": self._adapt_json("raw_posts", "metrics_json", metrics_payload),
            "raw_json": self._adapt_json("raw_posts", "raw_json", raw_json_payload),
        }

    @staticmethod
    def _decode_ingested_raw_post_row(row: Sequence[Any]) -> dict[str, Any]:
        decoded = {
            "id": row[0],
            "platform": row[1],
            "source_post_id": row[2],
            "post_id": row[3],
            "author_id": row[4],
            "author_handle": row[5],
            "root_post_id": row[6],
            "reply_parent_id": row[7],
            "created_at": row[8],
            "inserted_at": row[9],
            "ingested_at": row[10],
            "raw_text": row[11],
            "text_content": row[12],
            "language": row[13],
            "urls": row[14],
            "hashtags": row[15],
            "reply_to_uri": row[16],
            "repost_of_uri": row[17],
            "metrics_json": row[18] or {},
            "raw_json": row[19] or {},
        }
        decoded["processed"] = bool(row[20]) if len(row) > 20 else False
        return decoded

    @staticmethod
    def _decode_processed_post_summary_row(
        row: Sequence[Any],
        *,
        payload_by_raw_id: dict[int, dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        raw_post_id = int(row[1])
        payload = dict((payload_by_raw_id or {}).get(raw_post_id) or {})
        topic_entities_payload = row[5]
        if isinstance(topic_entities_payload, (list, tuple)):
            topic_entities_value = [
                str(value).strip()
                for value in topic_entities_payload
                if str(value or "").strip()
            ]
        else:
            topic_entities_value = (
                [str(topic_entities_payload).strip()]
                if str(topic_entities_payload or "").strip()
                else []
            )
        return {
            "id": int(row[0]),
            "raw_post_id": raw_post_id,
            "source_post_id": str(row[2] or payload.get("source_post_id") or "").strip(),
            "platform": str(row[3] or payload.get("platform") or "").strip(),
            "processed_at": row[4],
            "topic_entities": topic_entities_value,
            "language": row[6] if len(row) > 6 else payload.get("language"),
            "source_created_at": row[7] if len(row) > 7 else payload.get("source_created_at"),
            "bucket_minute": row[8] if len(row) > 8 else payload.get("bucket_minute"),
            "topic_records": list(payload.get("topic_records") or []),
        }

    def _prepare_processed_post_row(self, row: dict[str, Any]) -> dict[str, Any]:
        processed_at = row.get("processed_at") or datetime.now(timezone.utc)
        source_created_at = row.get("source_created_at") or row.get("created_at")
        if source_created_at is None:
            source_created_at = processed_at
        created_at = row.get("created_at") or source_created_at
        if created_at is None:
            created_at = processed_at
        bucket_minute = row.get("bucket_minute")
        if bucket_minute is None and created_at is not None:
            try:
                bucket_minute = created_at.replace(second=0, microsecond=0)
            except Exception:
                bucket_minute = processed_at.replace(second=0, microsecond=0)
        if bucket_minute is None:
            bucket_minute = processed_at.replace(second=0, microsecond=0)

        quality_score = row.get("quality_score")
        try:
            quality_score_value = float(quality_score if quality_score is not None else 0.0)
        except (TypeError, ValueError):
            quality_score_value = 0.0

        spam_score = row.get("spam_score")
        try:
            spam_score_value = float(spam_score if spam_score is not None else 0.0)
        except (TypeError, ValueError):
            spam_score_value = 0.0

        def _safe_int(value: Any, default: int = 0) -> int:
            try:
                return int(value if value is not None else default)
            except (TypeError, ValueError):
                return default

        topic_key_candidate = str(row.get("topic_key_candidate") or row.get("topic") or "general").strip()
        if not topic_key_candidate:
            topic_key_candidate = "general"

        return {
            "raw_post_id": row.get("raw_post_id"),
            "platform": str(row.get("platform") or "bluesky").strip() or "bluesky",
            "source_post_id": str(row.get("source_post_id") or row.get("post_id") or "").strip(),
            "post_id": str(row.get("post_id") or "").strip() or None,
            "author_id": str(row.get("author_id") or "").strip() or None,
            "source_created_at": source_created_at,
            "created_at": created_at,
            "processed_at": processed_at,
            "bucket_minute": bucket_minute,
            "clean_text": str(row.get("clean_text") or "").strip() or None,
            "normalized_text": str(row.get("normalized_text") or row.get("clean_text") or "").strip() or None,
            "language": str(row.get("language") or "").strip() or None,
            "quality_score": quality_score_value,
            "topic_key_candidate": topic_key_candidate,
            "tokens": self._adapt_collection("processed_posts", "tokens", row.get("tokens")),
            "hashtags": self._adapt_collection("processed_posts", "hashtags", row.get("hashtags")),
            "mentions": self._adapt_collection("processed_posts", "mentions", row.get("mentions")),
            "urls": self._adapt_collection("processed_posts", "urls", row.get("urls")),
            "domains": self._adapt_collection("processed_posts", "domains", row.get("domains")),
            "tags": self._adapt_collection("processed_posts", "tags", row.get("tags")),
            "topic_entities": self._adapt_collection("processed_posts", "topic_entities", row.get("topic_entities")),
            "has_media": bool(row.get("has_media", False)),
            "is_reply": bool(row.get("is_reply", False)),
            "is_repost": bool(row.get("is_repost", False)),
            "is_quote": bool(row.get("is_quote", False)),
            "author_hash": str(row.get("author_hash") or "").strip() or None,
            "token_count": int(row.get("token_count", 0) or 0),
            "fingerprint": str(row.get("fingerprint") or "").strip() or None,
            "cashtags": self._adapt_collection("processed_posts", "cashtags", row.get("cashtags")),
            "key_phrases": self._adapt_collection("processed_posts", "key_phrases", row.get("key_phrases")),
            "topic_seeds": self._adapt_collection("processed_posts", "topic_seeds", row.get("topic_seeds")),
            "sentiment_label": str(row.get("sentiment_label") or "neutral").strip() or "neutral",
            "sentiment_positive_score": _safe_int(row.get("sentiment_positive_score"), 0),
            "sentiment_negative_score": _safe_int(row.get("sentiment_negative_score"), 0),
            "sentiment_neutral_score": _safe_int(row.get("sentiment_neutral_score"), 0),
            "spam_score": spam_score_value,
            "topic": str(row.get("topic") or topic_key_candidate).strip() or topic_key_candidate,
        }

    def _prepare_post_topic_row(self, row: dict[str, Any]) -> dict[str, Any]:
        created_at = row.get("created_at") or datetime.now(timezone.utc)
        return {
            "raw_post_id": row.get("raw_post_id"),
            "processed_post_id": row.get("processed_post_id"),
            "platform": str(row.get("platform") or "bluesky").strip() or "bluesky",
            "source_post_id": str(row.get("source_post_id") or "").strip(),
            "topic_text": str(row.get("topic_text") or "").strip(),
            "normalized_topic": str(row.get("normalized_topic") or "").strip(),
            "topic_type": str(row.get("topic_type") or "entity").strip() or "entity",
            "language": str(row.get("language") or "").strip() or None,
            "source_created_at": row.get("source_created_at"),
            "bucket_minute": row.get("bucket_minute") or created_at,
            "created_at": created_at,
        }

    def _prepare_author_row(self, row: dict[str, Any]) -> dict[str, Any]:
        observed_at = datetime.now(timezone.utc)
        first_seen = row.get("first_seen_at") or observed_at
        last_seen = row.get("last_seen_at") or observed_at
        return {
            "platform": str(row.get("platform") or "bluesky"),
            "author_id": str(row.get("author_id") or "").strip(),
            "author_handle": str(row.get("author_handle") or "").strip() or None,
            "display_name": str(row.get("display_name") or "").strip() or None,
            "followers_count": row.get("followers_count"),
            "metadata_json": self._adapt_json(
                "authors",
                "metadata_json",
                row.get("metadata_json") or {},
            ),
            "first_seen_at": first_seen,
            "last_seen_at": last_seen,
        }

    def _prepare_topic_ai_enrichment_row(self, row: dict[str, Any]) -> dict[str, Any]:
        topic_key = str(row.get("topic_key") or "").strip()
        now_value = datetime.now(timezone.utc)
        generated_at = row.get("generated_at") or now_value
        refreshed_at = row.get("refreshed_at") or generated_at
        summary_confidence_raw = row.get("summary_confidence")
        try:
            summary_confidence = float(summary_confidence_raw if summary_confidence_raw is not None else 0.0)
        except (TypeError, ValueError):
            summary_confidence = 0.0
        summary_confidence = max(0.0, min(1.0, summary_confidence))

        def _safe_int_local(value: Any, default: int = 0) -> int:
            try:
                return int(value if value is not None else default)
            except (TypeError, ValueError):
                return default

        def _safe_float_local(value: Any, default: float = 0.0) -> float:
            try:
                return float(value if value is not None else default)
            except (TypeError, ValueError):
                return default

        key_entities = row.get("key_entities")
        if not isinstance(key_entities, list):
            key_entities = []
        normalized_entities = [
            str(value or "").strip()
            for value in key_entities
            if str(value or "").strip()
        ]

        supporting_post_ids = row.get("supporting_post_ids")
        if not isinstance(supporting_post_ids, list):
            supporting_post_ids = []
        normalized_post_ids = [
            str(value or "").strip()
            for value in supporting_post_ids
            if str(value or "").strip()
        ]

        supporting_sample = row.get("supporting_sample")
        if not isinstance(supporting_sample, list):
            supporting_sample = []

        evidence_post_ids = row.get("evidence_post_ids")
        if not isinstance(evidence_post_ids, list):
            evidence_post_ids = []
        normalized_evidence_post_ids = [
            str(value or "").strip()
            for value in evidence_post_ids
            if str(value or "").strip()
        ]

        mixed_signals = row.get("mixed_signals")
        if not isinstance(mixed_signals, list):
            mixed_signals = []
        normalized_mixed_signals = [
            str(value or "").strip()
            for value in mixed_signals
            if str(value or "").strip()
        ]

        validator_errors = row.get("validator_errors")
        if not isinstance(validator_errors, list):
            validator_errors = []
        normalized_validator_errors = [
            str(value or "").strip()
            for value in validator_errors
            if str(value or "").strip()
        ]

        metadata_json = row.get("metadata_json")
        if not isinstance(metadata_json, dict):
            metadata_json = {}
        writer_identity_value = str(
            row.get("writer_identity")
            or metadata_json.get("writer_identity")
            or ""
        ).strip()
        writer_role_value = str(
            row.get("writer_role")
            or metadata_json.get("writer_role")
            or ""
        ).strip()
        if not writer_identity_value or writer_identity_value.lower() == "unknown":
            raise ValueError("writer_identity is required for topic AI persistence")
        if not writer_role_value or writer_role_value.lower() == "unknown":
            raise ValueError("writer_role is required for topic AI persistence")
        authoritative_writer_value = writer_identity_value in _AUTHORITATIVE_TOPIC_AI_WRITER_IDENTITIES
        deployment_id_value = str(
            row.get("deployment_id")
            or metadata_json.get("deployment_id")
            or ""
        ).strip() or None
        instance_id_value = str(
            row.get("instance_id")
            or metadata_json.get("instance_id")
            or ""
        ).strip() or None
        code_version_value = str(
            row.get("code_version")
            or metadata_json.get("code_version")
            or ""
        ).strip() or None
        refresh_reason_value = str(
            row.get("refresh_reason")
            or metadata_json.get("refresh_reason")
            or ""
        ).strip() or None
        usage_prompt_tokens_value = _safe_int_local(
            row.get("usage_prompt_tokens")
            if row.get("usage_prompt_tokens") is not None
            else metadata_json.get("usage_prompt_tokens")
        )
        usage_completion_tokens_value = _safe_int_local(
            row.get("usage_completion_tokens")
            if row.get("usage_completion_tokens") is not None
            else metadata_json.get("usage_completion_tokens")
        )
        usage_total_tokens_value = _safe_int_local(
            row.get("usage_total_tokens")
            if row.get("usage_total_tokens") is not None
            else metadata_json.get("usage_total_tokens")
        )
        duration_ms_value = _safe_float_local(
            row.get("duration_ms")
            if row.get("duration_ms") is not None
            else metadata_json.get("duration_ms")
        )
        replaced_existing_title_value = bool(
            row.get("replaced_existing_title")
            if row.get("replaced_existing_title") is not None
            else metadata_json.get("replaced_existing_title")
        )
        metadata_json = {
            **metadata_json,
            "writer_identity": writer_identity_value,
            "writer_role": writer_role_value,
            "authoritative_writer": authoritative_writer_value,
            "deployment_id": deployment_id_value,
            "instance_id": instance_id_value,
            "code_version": code_version_value,
            "refresh_reason": refresh_reason_value,
            "usage_prompt_tokens": usage_prompt_tokens_value,
            "usage_completion_tokens": usage_completion_tokens_value,
            "usage_total_tokens": usage_total_tokens_value,
            "duration_ms": duration_ms_value,
            "replaced_existing_title": replaced_existing_title_value,
        }

        validated_output_json = row.get("validated_output_json")
        if not isinstance(validated_output_json, dict):
            validated_output_json = {}

        representative_post_count = row.get("representative_post_count")
        try:
            representative_post_count_value = int(representative_post_count or len(normalized_post_ids))
        except (TypeError, ValueError):
            representative_post_count_value = len(normalized_post_ids)
        representative_post_count_value = max(0, representative_post_count_value)
        raw_label_value = str(row.get("raw_label") or topic_key).strip() or topic_key
        narrative_summary_value = str(
            row.get("narrative_summary")
            or row.get("context_paragraph")
            or row.get("short_description")
            or row.get("abstain_reason")
            or "Narrative enrichment is unavailable for this trend window."
        ).strip()
        short_description_value = str(
            row.get("short_description")
            or narrative_summary_value
            or row.get("raw_label")
            or topic_key
        ).strip()
        context_paragraph_value = str(
            row.get("context_paragraph")
            or narrative_summary_value
            or short_description_value
        ).strip()
        status_value = str(row.get("status") or "ok").strip().lower() or "ok"
        if status_value not in {"ok", "mixed", "insufficient_evidence", "junk"}:
            status_value = "ok"
        (
            canonical_name_value,
            fallback_label_value,
            name_status_value,
            name_source_value,
        ) = _resolve_topic_ai_name_fields(
            raw_label=raw_label_value,
            canonical_name=str(row.get("canonical_name") or "").strip() or None,
            fallback_label=str(row.get("fallback_label") or "").strip() or None,
            status=status_value,
            name_status=str(row.get("name_status") or "").strip().lower() or None,
            name_source=str(row.get("name_source") or "").strip().lower() or None,
            narrative_summary=narrative_summary_value,
            abstain_reason=str(row.get("abstain_reason") or "").strip() or None,
            mixed_signals=normalized_mixed_signals,
            metadata_json=metadata_json,
            writer_identity=writer_identity_value,
        )
        ai_display_name_value = canonical_name_value
        ai_name_status_value = name_status_value
        ai_name_generated_at_value = generated_at if ai_display_name_value else None
        ai_name_refreshed_at_value = refreshed_at if ai_display_name_value else None
        ai_name_source_version_value = (
            str(row.get("ai_name_source_version") or row.get("prompt_version") or "").strip() or None
        ) if ai_display_name_value else None
        metadata_json["resolved_name_status"] = name_status_value
        metadata_json["resolved_name_source"] = name_source_value
        metadata_json["ai_display_name"] = ai_display_name_value
        metadata_json["ai_name_status"] = ai_name_status_value
        metadata_json["ai_name_generated_at"] = (
            ai_name_generated_at_value.isoformat()
            if isinstance(ai_name_generated_at_value, datetime)
            else None
        )
        metadata_json["ai_name_refreshed_at"] = (
            ai_name_refreshed_at_value.isoformat()
            if isinstance(ai_name_refreshed_at_value, datetime)
            else None
        )
        metadata_json["ai_name_source_version"] = ai_name_source_version_value

        return {
            "topic_key": topic_key,
            "as_of_window_end": row.get("as_of_window_end") or generated_at,
            "raw_label": raw_label_value,
            "canonical_name": canonical_name_value,
            "ai_display_name": ai_display_name_value,
            "fallback_label": fallback_label_value,
            "name_status": name_status_value,
            "ai_name_status": ai_name_status_value,
            "name_source": name_source_value,
            "short_description": short_description_value,
            "context_paragraph": context_paragraph_value,
            "narrative_summary": narrative_summary_value,
            "why_attention": str(row.get("why_attention") or "").strip() or None,
            "status": status_value,
            "key_entities": Jsonb(normalized_entities),
            "trend_category": str(row.get("trend_category") or "").strip() or None,
            "summary_confidence": summary_confidence,
            "evidence_post_ids": Jsonb(normalized_evidence_post_ids),
            "mixed_signals": Jsonb(normalized_mixed_signals),
            "abstain_reason": str(row.get("abstain_reason") or "").strip() or None,
            "validator_errors": Jsonb(normalized_validator_errors),
            "validated_output_json": Jsonb(validated_output_json),
            "raw_response_text": str(row.get("raw_response_text") or "").strip() or None,
            "supporting_post_ids": Jsonb(normalized_post_ids),
            "supporting_sample": Jsonb(supporting_sample),
            "representative_post_count": representative_post_count_value,
            "model_name": str(row.get("model_name") or "unknown").strip() or "unknown",
            "prompt_version": str(row.get("prompt_version") or "v1").strip() or "v1",
            "input_hash": str(row.get("input_hash") or "").strip(),
            "generated_at": generated_at,
            "ai_name_generated_at": ai_name_generated_at_value,
            "refreshed_at": refreshed_at,
            "ai_name_refreshed_at": ai_name_refreshed_at_value,
            "expires_at": row.get("expires_at"),
            "ai_name_source_version": ai_name_source_version_value,
            "writer_identity": writer_identity_value,
            "writer_role": writer_role_value,
            "authoritative_writer": authoritative_writer_value,
            "deployment_id": deployment_id_value,
            "instance_id": instance_id_value,
            "code_version": code_version_value,
            "refresh_reason": refresh_reason_value,
            "usage_prompt_tokens": usage_prompt_tokens_value,
            "usage_completion_tokens": usage_completion_tokens_value,
            "usage_total_tokens": usage_total_tokens_value,
            "duration_ms": duration_ms_value,
            "replaced_existing_title": replaced_existing_title_value,
            "metadata_json": Jsonb(metadata_json),
        }

    def _run_with_retry(
        self,
        label: str,
        operation: Callable[[psycopg.Connection[Any]], Any],
    ) -> Any:
        last_error: Exception | None = None
        for attempt in range(1, 3):
            try:
                self.connect()
                if self._conn is None:
                    raise RuntimeError("Database connection is not available")
                result = operation(self._conn)
                if self._conn.info.transaction_status != TransactionStatus.IDLE:
                    self._conn.commit()
                return result
            except psycopg.OperationalError as error:
                last_error = error
                self._logger.warning(
                    "db_operation_retry label=%s attempt=%s error=%s",
                    label,
                    attempt,
                    error,
                )
                self.close()
                if attempt < 2:
                    time.sleep(min(2.0, 0.5 * attempt))
            except psycopg.InterfaceError as error:
                last_error = error
                self._logger.warning(
                    "db_connection_reset label=%s attempt=%s error=%s",
                    label,
                    attempt,
                    error,
                )
                self.close()
                if attempt < 2:
                    time.sleep(min(2.0, 0.5 * attempt))
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"Database operation failed: {label}")

    def _execute_write(
        self,
        label: str,
        operation: Callable[[psycopg.Connection[Any]], Any],
    ) -> Any:
        def wrapped(connection: psycopg.Connection[Any]) -> Any:
            try:
                result = operation(connection)
                connection.commit()
                return result
            except Exception:
                connection.rollback()
                raise

        return self._run_with_retry(label, wrapped)

    def _apply_schema_lock_timeout(self, cursor: Any) -> None:
        if self._schema_lock_timeout_ms <= 0:
            return
        cursor.execute(f"SET LOCAL lock_timeout = '{int(self._schema_lock_timeout_ms)}ms'")

    @staticmethod
    def _apply_statement_timeout(cursor: Any, timeout_seconds: float | None) -> None:
        if timeout_seconds is None:
            return
        try:
            timeout_ms = int(max(0.0, float(timeout_seconds)) * 1000)
        except (TypeError, ValueError):
            timeout_ms = 0
        if timeout_ms <= 0:
            return
        cursor.execute(f"SET LOCAL statement_timeout = '{timeout_ms}ms'")

    def _load_column_metadata(self) -> None:
        if self._conn is None:
            return
        with self._conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT table_name, column_name, data_type, udt_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = ANY(%s)
                """,
                (
                    [
                        "raw_posts",
                        "authors",
                        "ingestion_runs",
                        "processed_posts",
                        "post_topics",
                        "topic_ai_enrichments",
                        "memecoin_assets",
                        "memecoin_correlation_runs",
                        "memecoin_market_snapshots",
                        "memecoin_correlation_results",
                        "memecoin_correlation_links",
                        "trend_memecoin_links",
                    ],
                ),
            )
            rows = cursor.fetchall()
        self._column_types = {
            (str(table_name), str(column_name)): (str(data_type), str(udt_name))
            for table_name, column_name, data_type, udt_name in rows
        }

    def _verify_required_schema(self) -> None:
        if self._schema_verified:
            return

        required_columns = {
            "raw_posts": {
                "id",
                "platform",
                "source_post_id",
                "post_id",
                "author_id",
                "author_handle",
                "root_post_id",
                "reply_parent_id",
                "created_at",
                "ingested_at",
                "text_content",
                "language",
                "urls",
                "hashtags",
                "metrics_json",
                "raw_json",
            },
            "authors": {
                "platform",
                "author_id",
                "author_handle",
                "display_name",
                "followers_count",
                "metadata_json",
                "first_seen_at",
                "last_seen_at",
            },
            "ingestion_runs": {
                "source",
                "started_at",
                "ended_at",
                "status",
                "rows_inserted",
                "notes",
            },
        }

        available_by_table: dict[str, set[str]] = {}
        for (table_name, column_name), _metadata in self._column_types.items():
            available_by_table.setdefault(table_name, set()).add(column_name)

        missing: dict[str, list[str]] = {}
        for table_name, columns in required_columns.items():
            missing_columns = sorted(columns - available_by_table.get(table_name, set()))
            if missing_columns:
                missing[table_name] = missing_columns

        if missing:
            raise RuntimeError(f"Database schema does not match required worker columns: {missing}")

        self._schema_verified = True

    def _column_metadata(self, table: str, column: str) -> tuple[str, str]:
        return self._column_types.get((table, column), ("", ""))

    def _has_column(self, table: str, column: str) -> bool:
        return (table, column) in self._column_types

    def _expects_json(self, table: str, column: str) -> bool:
        data_type, _udt_name = self._column_metadata(table, column)
        return data_type in {"json", "jsonb"}

    def _expects_array(self, table: str, column: str) -> bool:
        _data_type, udt_name = self._column_metadata(table, column)
        return udt_name.startswith("_")

    def _adapt_json(self, table: str, column: str, payload: Any) -> Any:
        if payload is None:
            return None
        if self._expects_json(table, column):
            return Jsonb(payload)
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)

    def _adapt_collection(self, table: str, column: str, values: Any) -> Any:
        normalized = _normalize_text_list(values)
        if self._expects_json(table, column):
            return Jsonb(normalized)
        if self._expects_array(table, column):
            return normalized
        return ", ".join(normalized)

    def _adapt_notes(self, payload: dict[str, Any]) -> Any:
        if self._expects_json("ingestion_runs", "notes"):
            return Jsonb(payload)
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)

    @staticmethod
    def _decode_notes(value: Any) -> dict[str, Any]:
        if value is None:
            return {}
        if isinstance(value, dict):
            return value
        if isinstance(value, (bytes, bytearray)):
            value = value.decode("utf-8", errors="replace")
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return {}
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                return {"message": text}
            if isinstance(parsed, dict):
                return parsed
            return {"value": parsed}
        return {"value": str(value)}
