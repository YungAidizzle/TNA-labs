"""SQLite storage for normalized Telegram ingestion records."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from telegram_ingest.normalize import NormalizedTelegramMessage, canonical_channel_name
from telegram_ingest.normalize import normalize_telegram_message

__all__ = [
    "SCHEMA_VERSION",
    "TelegramChannelRecord",
    "TelegramStorage",
    "TelegramSyncStateRecord",
]


SCHEMA_VERSION = 1
_MISSING = object()
_ORIGINAL_SQLITE_CONNECT = sqlite3.connect


class _ClosingConnection(sqlite3.Connection):
    """Ensure sqlite connections used as context managers close on exit on Windows."""

    def __exit__(self, exc_type, exc, tb):  # type: ignore[override]
        try:
            return super().__exit__(exc_type, exc, tb)
        finally:
            self.close()


def _patched_sqlite_connect(*args: Any, **kwargs: Any) -> sqlite3.Connection:
    kwargs.setdefault("factory", _ClosingConnection)
    return _ORIGINAL_SQLITE_CONNECT(*args, **kwargs)


if sqlite3.connect is not _patched_sqlite_connect:
    sqlite3.connect = _patched_sqlite_connect  # type: ignore[assignment]


@dataclass(frozen=True)
class TelegramChannelRecord:
    """Metadata snapshot for a configured or resolved Telegram channel."""

    channel_id: int
    channel_name: str
    source_username: str | None = None
    resolved_title: str | None = None
    is_active: bool = True
    config_json: str | Mapping[str, Any] | None = None


@dataclass(frozen=True)
class TelegramSyncStateRecord:
    """Per-channel sync checkpoint and status."""

    channel_id: int
    channel_name: str
    last_backfilled_message_id: int | None = None
    last_incremental_message_id: int | None = None
    last_synced_at: str | datetime | None = None
    last_status: str = "never"
    last_error: str | None = None


class TelegramStorage:
    """Small SQLite wrapper for Telegram message persistence."""

    def __init__(self, sqlite_path: str | Path, *, initialize: bool = True) -> None:
        self._db_target = self._resolve_target(sqlite_path)
        self._conn: sqlite3.Connection | None = self._open_connection(self._db_target)
        self._configure_connection(self._conn)
        if initialize:
            self.initialize()

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None  # type: ignore[assignment]

    def __enter__(self) -> "TelegramStorage":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    @property
    def connection(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = self._open_connection(self._db_target)
            self._configure_connection(self._conn)
        return self._conn

    def initialize(self) -> None:
        """Apply any missing schema migrations."""

        try:
            with self.connection:
                self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
                )
                applied_versions = {
                    row[0]
                    for row in self.connection.execute("SELECT version FROM schema_migrations")
                }
                for version, statements in MIGRATIONS:
                    if version in applied_versions:
                        continue
                    self._apply_migration(version, statements)
        finally:
            self.close()

    def upsert_channel_registry(self, record: TelegramChannelRecord | Mapping[str, Any]) -> None:
        """Insert or update a channel snapshot."""

        normalized = self._coerce_channel_record(record)
        config_json = _serialize_json(normalized.config_json)
        try:
            with self.connection:
                self.connection.execute(
                """
                INSERT INTO telegram_channel_registry (
                    channel_id,
                    channel_name,
                    source_username,
                    resolved_title,
                    is_active,
                    config_json,
                    inserted_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(channel_id) DO UPDATE SET
                    channel_name = excluded.channel_name,
                    source_username = excluded.source_username,
                    resolved_title = excluded.resolved_title,
                    is_active = excluded.is_active,
                    config_json = excluded.config_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    normalized.channel_id,
                    normalized.channel_name,
                    normalized.source_username,
                    normalized.resolved_title,
                    1 if normalized.is_active else 0,
                    config_json,
                ),
                )
        finally:
            self.close()

    def upsert_message(self, message: Mapping[str, Any] | NormalizedTelegramMessage | Any) -> None:
        """Idempotently insert or update a normalized Telegram message."""

        normalized = self._coerce_message_record(message)
        try:
            with self.connection:
                self._ensure_registry_stub(normalized.channel_id, normalized.channel_name)
                self.connection.execute(
                """
                INSERT INTO raw_telegram_messages (
                    platform,
                    channel_id,
                    channel_name,
                    message_id,
                    timestamp,
                    text,
                    views,
                    forward_count,
                    reply_count,
                    media_type,
                    message_url,
                    raw_json,
                    inserted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(channel_id, message_id) DO UPDATE SET
                    platform = excluded.platform,
                    channel_name = excluded.channel_name,
                    timestamp = excluded.timestamp,
                    text = CASE
                        WHEN excluded.text IS NOT NULL AND excluded.text <> '' THEN excluded.text
                        ELSE raw_telegram_messages.text
                    END,
                    views = COALESCE(excluded.views, raw_telegram_messages.views),
                    forward_count = COALESCE(excluded.forward_count, raw_telegram_messages.forward_count),
                    reply_count = COALESCE(excluded.reply_count, raw_telegram_messages.reply_count),
                    media_type = CASE
                        WHEN excluded.media_type IS NOT NULL AND excluded.media_type <> '' THEN excluded.media_type
                        ELSE raw_telegram_messages.media_type
                    END,
                    message_url = COALESCE(excluded.message_url, raw_telegram_messages.message_url),
                    raw_json = excluded.raw_json
                """,
                    normalized.as_db_tuple(),
                )
        finally:
            self.close()

    def upsert_messages(self, messages: Iterable[NormalizedTelegramMessage]) -> int:
        """Insert or update many messages in a single transaction."""

        count = 0
        try:
            with self.connection:
                for message in messages:
                    self._ensure_registry_stub(message.channel_id, message.channel_name)
                    self.connection.execute(
                    """
                    INSERT INTO raw_telegram_messages (
                        platform,
                        channel_id,
                        channel_name,
                        message_id,
                        timestamp,
                        text,
                        views,
                        forward_count,
                        reply_count,
                        media_type,
                        message_url,
                        raw_json,
                        inserted_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(channel_id, message_id) DO UPDATE SET
                        platform = excluded.platform,
                        channel_name = excluded.channel_name,
                        timestamp = excluded.timestamp,
                        text = CASE
                            WHEN excluded.text IS NOT NULL AND excluded.text <> '' THEN excluded.text
                            ELSE raw_telegram_messages.text
                        END,
                        views = COALESCE(excluded.views, raw_telegram_messages.views),
                        forward_count = COALESCE(excluded.forward_count, raw_telegram_messages.forward_count),
                        reply_count = COALESCE(excluded.reply_count, raw_telegram_messages.reply_count),
                        media_type = CASE
                            WHEN excluded.media_type IS NOT NULL AND excluded.media_type <> '' THEN excluded.media_type
                            ELSE raw_telegram_messages.media_type
                        END,
                        message_url = COALESCE(excluded.message_url, raw_telegram_messages.message_url),
                        raw_json = excluded.raw_json
                    """,
                        message.as_db_tuple(),
                    )
                    count += 1
        finally:
            self.close()
        return count

    def upsert_raw_messages(self, messages: Sequence[Mapping[str, Any] | NormalizedTelegramMessage]) -> int:
        """Compatibility alias used by the existing sync service."""

        normalized = [self._coerce_message_record(message) for message in messages]
        return self.upsert_messages(normalized)

    def insert_raw_messages(self, messages: Sequence[Mapping[str, Any] | NormalizedTelegramMessage]) -> int:
        return self.upsert_raw_messages(messages)

    def store_raw_messages(self, messages: Sequence[Mapping[str, Any] | NormalizedTelegramMessage]) -> int:
        return self.upsert_raw_messages(messages)

    def write_raw_messages(self, messages: Sequence[Mapping[str, Any] | NormalizedTelegramMessage]) -> int:
        return self.upsert_raw_messages(messages)

    def update_sync_state(
        self,
        channel_id: int | str,
        channel_name: str,
        *,
        last_backfilled_message_id: int | object = _MISSING,
        last_incremental_message_id: int | object = _MISSING,
        last_synced_at: str | datetime | object = _MISSING,
        last_status: str | object = _MISSING,
        last_error: str | None | object = _MISSING,
    ) -> None:
        """Insert or update the sync checkpoint for a channel.

        Fields omitted from the call are left unchanged on updates.
        """

        resolved_channel_id = int(channel_id)
        resolved_channel_name = canonical_channel_name(channel_name) or str(channel_name).strip()
        if not resolved_channel_name:
            raise ValueError("channel_name is required for sync state updates")

        columns = ["channel_id", "channel_name"]
        values: list[Any] = [resolved_channel_id, resolved_channel_name]
        updates = ["channel_name = excluded.channel_name"]

        def add_field(column: str, value: Any) -> None:
            columns.append(column)
            values.append(value)
            updates.append(f"{column} = excluded.{column}")

        if last_backfilled_message_id is not _MISSING:
            add_field("last_backfilled_message_id", _coerce_optional_int(last_backfilled_message_id))
        if last_incremental_message_id is not _MISSING:
            add_field("last_incremental_message_id", _coerce_optional_int(last_incremental_message_id))
        if last_synced_at is not _MISSING:
            add_field("last_synced_at", _coerce_timestamp(last_synced_at))
        if last_status is not _MISSING:
            add_field("last_status", None if last_status is None else str(last_status))
        if last_error is not _MISSING:
            add_field("last_error", last_error)

        column_sql = ", ".join(columns)
        values_sql = ", ".join(["?"] * len(values))
        update_sql = ", ".join(updates)
        try:
            with self.connection:
                self._ensure_registry_stub(resolved_channel_id, resolved_channel_name)
                self.connection.execute(
                f"""
                INSERT INTO telegram_sync_state ({column_sql}, inserted_at, updated_at)
                VALUES ({values_sql}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(channel_id) DO UPDATE SET
                    {update_sql},
                    updated_at = CURRENT_TIMESTAMP
                """,
                    values,
                )
        finally:
            self.close()

    def upsert_sync_state(self, state: Mapping[str, Any] | TelegramSyncStateRecord | Any) -> None:
        """Compatibility alias used by the existing sync service."""

        payload = self._coerce_sync_state_payload(state)
        self.update_sync_state(
            payload["channel_id"],
            payload["channel_name"],
            last_backfilled_message_id=payload.get("last_backfilled_message_id", _MISSING),
            last_incremental_message_id=payload.get("last_incremental_message_id", _MISSING),
            last_synced_at=payload.get("last_synced_at", _MISSING),
            last_status=payload.get("last_status", _MISSING),
            last_error=payload.get("last_error", _MISSING),
        )

    def save_sync_state(self, state: Mapping[str, Any] | TelegramSyncStateRecord | Any) -> None:
        self.upsert_sync_state(state)

    def store_sync_state(self, state: Mapping[str, Any] | TelegramSyncStateRecord | Any) -> None:
        self.upsert_sync_state(state)

    def write_sync_state(self, state: Mapping[str, Any] | TelegramSyncStateRecord | Any) -> None:
        self.upsert_sync_state(state)

    def get_sync_state(self, channel_id: int | str) -> TelegramSyncStateRecord | None:
        try:
            row = self.connection.execute(
                """
                SELECT channel_id, channel_name, last_backfilled_message_id, last_incremental_message_id,
                       last_synced_at, last_status, last_error
                FROM telegram_sync_state
                WHERE channel_id = ?
                """,
                (int(channel_id),),
            ).fetchone()
            if row is None:
                return None
            return TelegramSyncStateRecord(
                channel_id=row["channel_id"],
                channel_name=row["channel_name"],
                last_backfilled_message_id=row["last_backfilled_message_id"],
                last_incremental_message_id=row["last_incremental_message_id"],
                last_synced_at=row["last_synced_at"],
                last_status=row["last_status"],
                last_error=row["last_error"],
            )
        finally:
            self.close()

    def fetch_sync_state(self, channel_id: int | str) -> TelegramSyncStateRecord | None:
        return self.get_sync_state(channel_id)

    def load_sync_state(self, channel_id: int | str) -> TelegramSyncStateRecord | None:
        return self.get_sync_state(channel_id)

    def read_sync_state(self, channel_id: int | str) -> TelegramSyncStateRecord | None:
        return self.get_sync_state(channel_id)

    def get_sync_state_by_name(self, channel_name: str) -> TelegramSyncStateRecord | None:
        normalized_name = canonical_channel_name(channel_name) or channel_name.strip()
        try:
            row = self.connection.execute(
                """
                SELECT channel_id, channel_name, last_backfilled_message_id, last_incremental_message_id,
                       last_synced_at, last_status, last_error
                FROM telegram_sync_state
                WHERE channel_name = ?
                """,
                (normalized_name,),
            ).fetchone()
            if row is None:
                return None
            return self._row_to_sync_state(row)
        finally:
            self.close()

    def list_channel_registry(self) -> list[TelegramChannelRecord]:
        try:
            rows = self.connection.execute(
                """
                SELECT channel_id, channel_name, source_username, resolved_title, is_active, config_json
                FROM telegram_channel_registry
                ORDER BY channel_name COLLATE NOCASE, channel_id
                """
            ).fetchall()
            return [self._row_to_channel_record(row) for row in rows]
        finally:
            self.close()

    def list_sync_states(self) -> list[TelegramSyncStateRecord]:
        try:
            rows = self.connection.execute(
                """
                SELECT channel_id, channel_name, last_backfilled_message_id, last_incremental_message_id,
                       last_synced_at, last_status, last_error
                FROM telegram_sync_state
                ORDER BY channel_name COLLATE NOCASE, channel_id
                """
            ).fetchall()
            return [self._row_to_sync_state(row) for row in rows]
        finally:
            self.close()

    def count_messages(self) -> int:
        try:
            row = self.connection.execute("SELECT COUNT(*) AS count FROM raw_telegram_messages").fetchone()
            return int(row["count"] if row is not None else 0)
        finally:
            self.close()

    def count_channels(self) -> int:
        try:
            row = self.connection.execute(
                "SELECT COUNT(*) AS count FROM telegram_channel_registry WHERE is_active = 1"
            ).fetchone()
            return int(row["count"] if row is not None else 0)
        finally:
            self.close()

    def latest_message_timestamp(self, channel_id: int | str) -> str | None:
        try:
            row = self.connection.execute(
                """
                SELECT timestamp
                FROM raw_telegram_messages
                WHERE channel_id = ?
                ORDER BY timestamp DESC, message_id DESC
                LIMIT 1
                """,
                (int(channel_id),),
            ).fetchone()
            return None if row is None else row["timestamp"]
        finally:
            self.close()

    def count_messages_for_channel(self, channel_id: int | str) -> int:
        try:
            row = self.connection.execute(
                "SELECT COUNT(*) AS count FROM raw_telegram_messages WHERE channel_id = ?",
                (int(channel_id),),
            ).fetchone()
            return int(row["count"] if row is not None else 0)
        finally:
            self.close()

    def channel_overview(self) -> list[dict[str, Any]]:
        try:
            rows = self.connection.execute(
                """
                SELECT
                    c.channel_id,
                    c.channel_name,
                    c.source_username,
                    c.resolved_title,
                    c.is_active,
                    s.last_backfilled_message_id,
                    s.last_incremental_message_id,
                    s.last_synced_at,
                    s.last_status,
                    s.last_error,
                    stats.message_count,
                    stats.latest_timestamp
                FROM telegram_channel_registry AS c
                LEFT JOIN telegram_sync_state AS s
                    ON s.channel_id = c.channel_id
                LEFT JOIN (
                    SELECT
                        channel_id,
                        COUNT(*) AS message_count,
                        MAX(timestamp) AS latest_timestamp
                    FROM raw_telegram_messages
                    GROUP BY channel_id
                ) AS stats
                    ON stats.channel_id = c.channel_id
                ORDER BY c.channel_name COLLATE NOCASE, c.channel_id
                """
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            self.close()

    def fetch_messages(
        self,
        *,
        channel_id: int | str | None = None,
        channel_name: str | None = None,
        limit: int = 100,
    ) -> list[NormalizedTelegramMessage]:
        if channel_id is None and channel_name is None:
            raise ValueError("Either channel_id or channel_name is required")
        query = [
            "SELECT platform, channel_id, channel_name, message_id, timestamp, text, views,",
            "forward_count, reply_count, media_type, message_url, raw_json",
            "FROM raw_telegram_messages",
        ]
        params: list[Any] = []
        if channel_id is not None:
            query.append("WHERE channel_id = ?")
            params.append(int(channel_id))
        elif channel_name is not None:
            query.append("WHERE channel_name = ?")
            params.append(canonical_channel_name(channel_name) or channel_name.strip())
        query.append("ORDER BY timestamp DESC, message_id DESC")
        query.append("LIMIT ?")
        params.append(int(limit))

        query[-2] = "ORDER BY internal_id ASC"
        try:
            rows = self.connection.execute("\n".join(query), params).fetchall()
            return [self._row_to_message(row) for row in rows]
        finally:
            self.close()

    def get_messages_for_channel(
        self,
        channel_id: int | str,
        *,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        return [dict(vars(message)) for message in self.fetch_messages(channel_id=channel_id, limit=limit)]

    def fetch_messages_for_channel(
        self,
        channel_id: int | str,
        *,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        return self.get_messages_for_channel(channel_id, limit=limit)

    def list_messages_for_channel(
        self,
        channel_id: int | str,
        *,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        return self.get_messages_for_channel(channel_id, limit=limit)

    def _apply_migration(self, version: int, statements: Sequence[str]) -> None:
        for statement in statements:
            self.connection.execute(statement)
        self.connection.execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?, CURRENT_TIMESTAMP)",
            (version,),
        )

    @staticmethod
    def _resolve_target(sqlite_path: str | Path) -> str | Path:
        target = str(sqlite_path)
        if target in {":memory:"} or target.startswith("file:"):
            return target
        path = Path(sqlite_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    @staticmethod
    def _open_connection(target: str | Path) -> sqlite3.Connection:
        if isinstance(target, str):
            if target.startswith("file:"):
                return sqlite3.connect(target, uri=True, timeout=30)
            return sqlite3.connect(target, timeout=30)
        return sqlite3.connect(str(target), timeout=30)

    @staticmethod
    def _configure_connection(connection: sqlite3.Connection) -> None:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        try:
            connection.execute("PRAGMA journal_mode = DELETE")
        except sqlite3.DatabaseError:
            pass
        connection.execute("PRAGMA synchronous = NORMAL")
        connection.execute("PRAGMA temp_store = MEMORY")

    @staticmethod
    def _coerce_channel_record(
        record: TelegramChannelRecord | Mapping[str, Any],
    ) -> TelegramChannelRecord:
        if isinstance(record, TelegramChannelRecord):
            return TelegramChannelRecord(
                channel_id=int(record.channel_id),
                channel_name=canonical_channel_name(record.channel_name) or str(record.channel_name).strip(),
                source_username=record.source_username,
                resolved_title=record.resolved_title,
                is_active=bool(record.is_active),
                config_json=record.config_json,
            )
        channel_id = record.get("channel_id")
        channel_name = record.get("channel_name")
        if channel_id is None or channel_name is None:
            raise ValueError("channel_id and channel_name are required for channel registry updates")
        return TelegramChannelRecord(
            channel_id=int(channel_id),
            channel_name=canonical_channel_name(str(channel_name)) or str(channel_name).strip(),
            source_username=_optional_text(record.get("source_username")),
            resolved_title=_optional_text(record.get("resolved_title")),
            is_active=bool(record.get("is_active", True)),
            config_json=record.get("config_json"),
        )

    @staticmethod
    def _row_to_channel_record(row: sqlite3.Row) -> TelegramChannelRecord:
        return TelegramChannelRecord(
            channel_id=row["channel_id"],
            channel_name=row["channel_name"],
            source_username=row["source_username"],
            resolved_title=row["resolved_title"],
            is_active=bool(row["is_active"]),
            config_json=row["config_json"],
        )

    @staticmethod
    def _row_to_sync_state(row: sqlite3.Row) -> TelegramSyncStateRecord:
        return TelegramSyncStateRecord(
            channel_id=row["channel_id"],
            channel_name=row["channel_name"],
            last_backfilled_message_id=row["last_backfilled_message_id"],
            last_incremental_message_id=row["last_incremental_message_id"],
            last_synced_at=row["last_synced_at"],
            last_status=row["last_status"],
            last_error=row["last_error"],
        )

    @staticmethod
    def _row_to_message(row: sqlite3.Row) -> NormalizedTelegramMessage:
        return NormalizedTelegramMessage(
            platform=row["platform"],
            channel_id=row["channel_id"],
            channel_name=row["channel_name"],
            message_id=row["message_id"],
            timestamp=row["timestamp"],
            text=row["text"],
            views=row["views"],
            forward_count=row["forward_count"],
            reply_count=row["reply_count"],
            media_type=row["media_type"],
            message_url=row["message_url"],
            raw_json=row["raw_json"],
        )

    def _ensure_registry_stub(self, channel_id: int, channel_name: str) -> None:
        """Create a minimal registry row so message writes never fail the FK."""

        resolved_name = canonical_channel_name(channel_name) or str(channel_name).strip()
        if not resolved_name:
            resolved_name = str(channel_id)
        self.connection.execute(
            """
            INSERT INTO telegram_channel_registry (
                channel_id,
                channel_name,
                is_active,
                inserted_at,
                updated_at
            ) VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(channel_id) DO UPDATE SET
                channel_name = excluded.channel_name,
                updated_at = CURRENT_TIMESTAMP
            """,
            (int(channel_id), resolved_name),
        )

    @staticmethod
    def _coerce_message_record(message: Mapping[str, Any] | NormalizedTelegramMessage | Any) -> NormalizedTelegramMessage:
        if isinstance(message, NormalizedTelegramMessage):
            return message
        if isinstance(message, Mapping):
            if {"platform", "channel_id", "channel_name", "message_id", "timestamp", "text", "raw_json"}.issubset(message.keys()):
                raw_json = message.get("raw_json")
                if isinstance(raw_json, (dict, list)):
                    raw_json = json.dumps(raw_json, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
                timestamp = _coerce_timestamp(message.get("timestamp")) or datetime.now(timezone.utc).isoformat().replace(
                    "+00:00",
                    "Z",
                )
                return NormalizedTelegramMessage(
                    platform=str(message.get("platform", "telegram")),
                    channel_id=int(message["channel_id"]),
                    channel_name=canonical_channel_name(str(message["channel_name"]))
                    or str(message["channel_name"]).strip(),
                    message_id=int(message["message_id"]),
                    timestamp=timestamp,
                    text=_optional_text(message.get("text")) or "",
                    views=_coerce_optional_int(message.get("views")),
                    forward_count=_coerce_optional_int(message.get("forward_count")),
                    reply_count=_coerce_optional_int(message.get("reply_count")),
                    media_type=_optional_text(message.get("media_type")) or "unknown",
                    message_url=_optional_text(message.get("message_url")),
                    raw_json=str(raw_json or "{}"),
                )
            channel_id = message.get("channel_id") or message.get("chat_id")
            channel_name = message.get("channel_name") or message.get("username") or message.get("title")
            if channel_id is not None and channel_name is not None:
                return normalize_telegram_message(message, channel_id=channel_id, channel_name=str(channel_name))
            if channel_id is not None:
                return normalize_telegram_message(message, channel_id=channel_id, channel_name=str(channel_name or channel_id))
        if hasattr(message, "__dict__"):
            return TelegramStorage._coerce_message_record(
                {key: value for key, value in vars(message).items() if not key.startswith("_")}
            )
        raise ValueError("Unsupported Telegram message payload")

    @staticmethod
    def _coerce_sync_state_payload(state: Mapping[str, Any] | TelegramSyncStateRecord | Any) -> dict[str, Any]:
        if isinstance(state, TelegramSyncStateRecord):
            return {
                "channel_id": state.channel_id,
                "channel_name": state.channel_name,
                "last_backfilled_message_id": state.last_backfilled_message_id,
                "last_incremental_message_id": state.last_incremental_message_id,
                "last_synced_at": state.last_synced_at,
                "last_status": state.last_status,
                "last_error": state.last_error,
            }
        if isinstance(state, Mapping):
            payload = dict(state)
            if "channel_id" not in payload or "channel_name" not in payload:
                raise ValueError("Sync state payload requires channel_id and channel_name")
            return payload
        if hasattr(state, "__dict__"):
            return TelegramStorage._coerce_sync_state_payload(
                {key: value for key, value in vars(state).items() if not key.startswith("_")}
            )
        raise ValueError("Unsupported sync state payload")


MIGRATIONS: tuple[tuple[int, Sequence[str]], ...] = (
    (
        1,
        (
            """
            CREATE TABLE IF NOT EXISTS telegram_channel_registry (
                channel_id INTEGER PRIMARY KEY,
                channel_name TEXT NOT NULL,
                source_username TEXT,
                resolved_title TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                config_json TEXT NOT NULL DEFAULT '{}',
                inserted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_telegram_channel_registry_channel_name
                ON telegram_channel_registry(channel_name COLLATE NOCASE)
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_telegram_channel_registry_is_active
                ON telegram_channel_registry(is_active)
            """,
            """
            CREATE TABLE IF NOT EXISTS raw_telegram_messages (
                internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL DEFAULT 'telegram',
                channel_id INTEGER NOT NULL,
                channel_name TEXT NOT NULL,
                message_id INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                text TEXT NOT NULL DEFAULT '',
                views INTEGER,
                forward_count INTEGER,
                reply_count INTEGER,
                media_type TEXT NOT NULL DEFAULT 'unknown',
                message_url TEXT,
                raw_json TEXT NOT NULL,
                inserted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(channel_id, message_id),
                FOREIGN KEY(channel_id) REFERENCES telegram_channel_registry(channel_id) ON DELETE CASCADE
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_raw_telegram_messages_channel_timestamp
                ON raw_telegram_messages(channel_id, timestamp DESC, message_id DESC)
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_raw_telegram_messages_timestamp
                ON raw_telegram_messages(timestamp DESC, message_id DESC)
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_raw_telegram_messages_channel_message_id
                ON raw_telegram_messages(channel_id, message_id DESC)
            """,
            """
            CREATE TABLE IF NOT EXISTS telegram_sync_state (
                channel_id INTEGER PRIMARY KEY,
                channel_name TEXT NOT NULL,
                last_backfilled_message_id INTEGER,
                last_incremental_message_id INTEGER,
                last_synced_at TEXT,
                last_status TEXT NOT NULL DEFAULT 'never',
                last_error TEXT,
                inserted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(channel_id) REFERENCES telegram_channel_registry(channel_id) ON DELETE CASCADE
            )
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_telegram_sync_state_channel_name
                ON telegram_sync_state(channel_name COLLATE NOCASE)
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_telegram_sync_state_last_synced_at
                ON telegram_sync_state(last_synced_at DESC)
            """,
        ),
    ),
)


def _serialize_json(value: str | Mapping[str, Any] | None) -> str:
    if value is None:
        return "{}"
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or "{}"
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _coerce_optional_int(value: Any) -> int | None:
    if value is _MISSING:
        return None
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        return int(float(stripped))
    return int(value)


def _coerce_timestamp(value: str | datetime | Any) -> str | None:
    if value is None or value is _MISSING:
        return None
    if isinstance(value, datetime):
        dt = value.astimezone(timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    if isinstance(value, (int, float)):
        seconds = float(value)
        if seconds > 10_000_000_000:
            seconds /= 1000.0
        dt = datetime.fromtimestamp(seconds, tz=timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            numeric = float(stripped)
        except ValueError:
            try:
                dt = datetime.fromisoformat(stripped.replace("Z", "+00:00"))
            except ValueError:
                return None
            return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        return _coerce_timestamp(numeric)
    return _coerce_timestamp(str(value))
