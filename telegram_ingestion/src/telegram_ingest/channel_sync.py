from __future__ import annotations

import json
import logging
import random
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Sequence

from . import normalize as normalize_module

MAX_TDLIB_PAGE_SIZE = 100
DEFAULT_BATCH_SIZE = 100
DEFAULT_MAX_RETRIES = 5
DEFAULT_BACKOFF_SECONDS = 1.0
DEFAULT_BACKOFF_CAP_SECONDS = 30.0


@dataclass(slots=True)
class ResolvedChannel:
    channel_id: int
    channel_name: str
    channel_ref: str
    username: str | None = None
    title: str | None = None
    public_url: str | None = None
    raw_json: Mapping[str, Any] | None = None


@dataclass(slots=True)
class ChannelSyncState:
    channel_id: int
    channel_name: str
    last_backfilled_message_id: int = 0
    last_incremental_message_id: int = 0
    last_synced_at: str | None = None
    last_status: str = "never_synced"
    last_error: str | None = None

    def as_record(self) -> dict[str, Any]:
        return {
            "channel_id": self.channel_id,
            "channel_name": self.channel_name,
            "last_backfilled_message_id": self.last_backfilled_message_id,
            "last_incremental_message_id": self.last_incremental_message_id,
            "last_synced_at": self.last_synced_at,
            "last_status": self.last_status,
            "last_error": self.last_error,
        }


@dataclass(slots=True)
class ChannelSyncResult:
    channel: ResolvedChannel
    mode: str
    batches: int = 0
    fetched: int = 0
    normalized: int = 0
    written: int = 0
    newest_message_id: int = 0
    oldest_message_id: int = 0
    checkpoint_reached: bool = False
    exhausted_history: bool = False
    errors: list[str] = field(default_factory=list)

    def as_record(self) -> dict[str, Any]:
        return {
            "channel": {
                "channel_id": self.channel.channel_id,
                "channel_name": self.channel.channel_name,
                "channel_ref": self.channel.channel_ref,
                "username": self.channel.username,
                "title": self.channel.title,
                "public_url": self.channel.public_url,
            },
            "mode": self.mode,
            "batches": self.batches,
            "fetched": self.fetched,
            "normalized": self.normalized,
            "written": self.written,
            "newest_message_id": self.newest_message_id,
            "oldest_message_id": self.oldest_message_id,
            "checkpoint_reached": self.checkpoint_reached,
            "exhausted_history": self.exhausted_history,
            "errors": list(self.errors),
        }


@dataclass(slots=True)
class BatchResult:
    fetched: int = 0
    normalized: int = 0
    written: int = 0
    newest_message_id: int = 0
    oldest_message_id: int = 0
    checkpoint_reached: bool = False


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_iso_now() -> str:
    return _utc_now().isoformat().replace("+00:00", "Z")


def _lookup(obj: Any, *names: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, Mapping):
        for name in names:
            if name in obj:
                return obj[name]
    else:
        for name in names:
            if hasattr(obj, name):
                return getattr(obj, name)
    return default


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return default if value is None else int(value)
    except (TypeError, ValueError):
        return default


def _coerce_str(value: Any, default: str = "") -> str:
    text = "" if value is None else str(value).strip()
    return text or default


def _normalize_channel_ref(value: Any) -> str:
    text = _coerce_str(value)
    if not text:
        return ""
    text = text.removeprefix("https://t.me/")
    text = text.removeprefix("http://t.me/")
    text = text.removeprefix("t.me/")
    text = text.removeprefix("@")
    text = text.split("?", 1)[0].split("/", 1)[0]
    return text.strip()


def _split_channel_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        parts = re.split(r"[\n,;]+", value)
    elif isinstance(value, Sequence):
        parts = list(value)
    else:
        parts = [value]
    refs: list[str] = []
    for part in parts:
        normalized = _normalize_channel_ref(part)
        if normalized and normalized not in refs:
            refs.append(normalized)
    return refs


def _configured_channel_refs(config: Any) -> list[str]:
    refs: list[str] = []
    for key in ("telegram_channels", "channels", "TELEGRAM_CHANNELS"):
        refs.extend([ref for ref in _split_channel_values(_lookup(config, key)) if ref not in refs])
    return refs


def _coerce_channel(raw: Any, channel_ref: str) -> ResolvedChannel:
    if isinstance(raw, ResolvedChannel):
        return raw
    channel_id = _coerce_int(_lookup(raw, "channel_id", "chat_id", "id", default=0))
    channel_name = _coerce_str(_lookup(raw, "channel_name", "name", "title", "username", default=""))
    username = _coerce_str(_lookup(raw, "username", "handle", default=""), "")
    title = _coerce_str(_lookup(raw, "title", default=""), "")
    public_url = _coerce_str(_lookup(raw, "public_url", "url", default=""), "")
    if not public_url and username:
        public_url = f"https://t.me/{username}"
    if not channel_name:
        channel_name = username or title or _normalize_channel_ref(channel_ref) or channel_ref
    raw_json = _lookup(raw, "raw_json", "raw", default=None)
    if isinstance(raw_json, str):
        try:
            raw_json = json.loads(raw_json)
        except json.JSONDecodeError:
            raw_json = None
    if not isinstance(raw_json, Mapping):
        raw_json = None
    return ResolvedChannel(
        channel_id=channel_id,
        channel_name=channel_name,
        channel_ref=_normalize_channel_ref(channel_ref) or channel_ref,
        username=username or None,
        title=title or None,
        public_url=public_url or None,
        raw_json=raw_json,
    )


def _to_iso_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat().replace("+00:00", "Z")
    text = _coerce_str(value)
    return text or None


def _extract_text(raw_message: Mapping[str, Any]) -> str:
    direct = _lookup(raw_message, "text", "body", "message_text", default=None)
    if isinstance(direct, Mapping):
        nested = _lookup(direct, "text", "caption", default=None)
        return _coerce_str(nested, "")
    text = _coerce_str(direct, "")
    if text:
        return text
    content = _lookup(raw_message, "content", default=None)
    if isinstance(content, Mapping):
        nested = _lookup(content, "text", "caption", default=None)
        if isinstance(nested, Mapping):
            return _coerce_str(_lookup(nested, "text", default=None), "")
        return _coerce_str(nested, "")
    return ""


def _extract_media_type(raw_message: Mapping[str, Any]) -> str:
    value = _lookup(raw_message, "media_type", "mediaType", default=None)
    if isinstance(value, str) and value:
        return value.lower()
    content = _lookup(raw_message, "content", default=None)
    content_type = _lookup(content, "@type", "type", default=None)
    if not isinstance(content_type, str) or not content_type:
        return ""
    mapping = {
        "messageText": "text",
        "messagePhoto": "photo",
        "messageVideo": "video",
        "messageAudio": "audio",
        "messageVoiceNote": "voice_note",
        "messageVideoNote": "video_note",
        "messageDocument": "document",
        "messageSticker": "sticker",
        "messageAnimation": "animation",
        "messagePoll": "poll",
        "messageLocation": "location",
        "messagePaidMedia": "paid_media",
    }
    return mapping.get(content_type, content_type.removeprefix("message").lower())


def _extract_timestamp(raw_message: Mapping[str, Any]) -> str | None:
    return _to_iso_timestamp(_lookup(raw_message, "timestamp", "date", "created_at", "createdAt", default=None))


def _extract_message_id(raw_message: Mapping[str, Any]) -> int:
    return _coerce_int(_lookup(raw_message, "message_id", "id", default=0))


def _extract_views(raw_message: Mapping[str, Any]) -> int:
    return _coerce_int(_lookup(raw_message, "views", "view_count", "viewCount", default=0))


def _extract_forward_count(raw_message: Mapping[str, Any]) -> int:
    value = _lookup(raw_message, "forward_count", "forwards", "forwardCount", default=None)
    return _coerce_int(value, 0)


def _extract_reply_count(raw_message: Mapping[str, Any]) -> int:
    value = _lookup(raw_message, "reply_count", "replyCount", default=None)
    if value is not None:
        return _coerce_int(value, 0)
    reply_info = _lookup(raw_message, "reply_info", "replyInfo", default=None)
    if isinstance(reply_info, Mapping):
        return _coerce_int(_lookup(reply_info, "reply_count", "replyCount", default=0), 0)
    return 0


def _public_message_url(channel: ResolvedChannel, message_id: int, raw_message: Mapping[str, Any]) -> str | None:
    explicit = _lookup(raw_message, "message_url", "url", "link", default=None)
    if explicit:
        return _coerce_str(explicit)
    username = channel.username or channel.channel_ref
    if not username:
        return None
    return f"https://t.me/{username}/{message_id}"


def _ensure_record(record: Mapping[str, Any], raw_message: Mapping[str, Any], channel: ResolvedChannel) -> dict[str, Any]:
    message_id = _coerce_int(_lookup(record, "message_id", default=None), _extract_message_id(raw_message))
    payload: dict[str, Any] = {
        "platform": "telegram",
        "channel_id": _coerce_int(_lookup(record, "channel_id", default=None), channel.channel_id),
        "channel_name": _coerce_str(_lookup(record, "channel_name", default=None), channel.channel_name),
        "message_id": message_id,
        "timestamp": _lookup(record, "timestamp", default=None) or _extract_timestamp(raw_message),
        "text": _coerce_str(_lookup(record, "text", default=None), _extract_text(raw_message)),
        "views": _coerce_int(_lookup(record, "views", default=None), _extract_views(raw_message)),
        "forward_count": _coerce_int(_lookup(record, "forward_count", default=None), _extract_forward_count(raw_message)),
        "reply_count": _coerce_int(_lookup(record, "reply_count", default=None), _extract_reply_count(raw_message)),
        "media_type": _coerce_str(_lookup(record, "media_type", default=None), _extract_media_type(raw_message)),
        "message_url": _coerce_str(_lookup(record, "message_url", default=None), _public_message_url(channel, message_id, raw_message) or ""),
        "raw_json": _lookup(record, "raw_json", default=None)
        or json.dumps(raw_message, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
    }
    for key, value in record.items():
        if key not in payload or payload[key] in (None, "", 0):
            payload[key] = value
    if payload["timestamp"] is not None:
        payload["timestamp"] = _coerce_str(payload["timestamp"], "")
    return payload


def _is_transient_error(exc: BaseException) -> bool:
    if isinstance(exc, (TimeoutError, ConnectionError, OSError)):
        return True
    if getattr(exc, "retry_after", None) is not None:
        return True
    if getattr(exc, "code", None) in {429, 500, 502, 503, 504}:
        return True
    message = str(exc).lower()
    markers = ("timeout", "temporarily unavailable", "connection reset", "flood", "try again later", "service unavailable", "gateway timeout")
    return any(marker in message for marker in markers)


def _retry_delay(exc: BaseException, attempt: int, *, base_delay: float, cap_delay: float) -> float:
    retry_after = getattr(exc, "retry_after", None)
    if retry_after is not None:
        try:
            return min(cap_delay, float(retry_after) + 0.5)
        except (TypeError, ValueError):
            pass
    jitter = random.uniform(0.0, 0.25)
    return min(cap_delay, base_delay * (2 ** max(0, attempt - 1))) + jitter


def _coerce_write_result(result: Any, default_count: int) -> int:
    if result is None:
        return default_count
    if isinstance(result, int):
        return result
    if isinstance(result, Mapping):
        for key in ("written", "inserted", "count", "rows", "rowcount"):
            if key in result:
                return _coerce_int(result[key], default_count)
        return default_count
    for key in ("written", "inserted", "count", "rows", "rowcount"):
        value = getattr(result, key, None)
        if value is not None:
            return _coerce_int(value, default_count)
    return default_count


def _invoke_first(obj: Any, names: Sequence[str], *args: Any, **kwargs: Any) -> Any:
    last_error: Exception | None = None
    for name in names:
        if obj is None or not hasattr(obj, name):
            continue
        try:
            return getattr(obj, name)(*args, **kwargs)
        except Exception as exc:  # pragma: no cover - retried by caller
            last_error = exc
            break
    if last_error is not None:
        raise last_error
    raise AttributeError(f"None of {names!r} exist on {type(obj).__name__}")


class TelegramChannelSyncService:
    def __init__(
        self,
        *,
        config: Any,
        resolver: Any,
        tdlib: Any,
        storage: Any,
        normalizer: Any | None = None,
        logger: logging.Logger | None = None,
        sleep: Callable[[float], None] = time.sleep,
        max_retries: int = DEFAULT_MAX_RETRIES,
        base_backoff_seconds: float = DEFAULT_BACKOFF_SECONDS,
        backoff_cap_seconds: float = DEFAULT_BACKOFF_CAP_SECONDS,
    ) -> None:
        self._config = config
        self._resolver = resolver or tdlib
        self._tdlib = tdlib or resolver
        self._storage = storage
        self._normalizer = normalizer
        self._logger = logger or logging.getLogger(__name__)
        self._sleep = sleep
        self._max_retries = max(1, int(max_retries))
        self._base_backoff_seconds = float(base_backoff_seconds)
        self._backoff_cap_seconds = float(backoff_cap_seconds)
        self._resolved_cache: dict[str, ResolvedChannel] = {}

    def configured_channel_refs(self) -> list[str]:
        return _configured_channel_refs(self._config)

    def resolve_configured_channels(self, channel_refs: Sequence[str] | None = None) -> list[ResolvedChannel]:
        resolved: list[ResolvedChannel] = []
        refs = self.configured_channel_refs() if channel_refs is None else list(channel_refs)
        for ref in refs:
            try:
                resolved.append(self.resolve_channel(ref))
            except Exception as exc:
                self._logger.warning(
                    "telegram.channel.resolve.failed",
                    extra={"channel_ref": ref, "error": str(exc)},
                )
        return resolved

    def resolve_channel(self, channel_ref: str) -> ResolvedChannel:
        normalized_ref = _normalize_channel_ref(channel_ref)
        if not normalized_ref:
            raise ValueError("Channel reference cannot be empty.")
        if normalized_ref in self._resolved_cache:
            return self._resolved_cache[normalized_ref]

        def _call() -> ResolvedChannel:
            raw = _invoke_first(
                self._resolver,
                ("resolve_channel", "resolve_public_channel", "lookup_channel", "get_public_channel", "search_public_chat"),
                normalized_ref,
            )
            return _coerce_channel(raw, normalized_ref)

        channel = self._retry("resolve_channel", _call, metadata={"channel_ref": normalized_ref})
        self._resolved_cache[normalized_ref] = channel
        return channel

    def backfill_channel(
        self,
        channel_ref: str,
        *,
        limit: int | None = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> ChannelSyncResult:
        channel = self.resolve_channel(channel_ref)
        state = self._load_state(channel)
        start_cursor = max(0, state.last_backfilled_message_id - 1) if state.last_backfilled_message_id else 0
        return self._sync_channel(
            channel,
            mode="backfill",
            start_cursor=start_cursor,
            stop_at_message_id=0,
            limit=limit,
            batch_size=batch_size,
            initial_state=state,
        )

    def backfill_all(
        self,
        *,
        limit_per_channel: int | None = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
        channel_refs: Sequence[str] | None = None,
    ) -> list[ChannelSyncResult]:
        results: list[ChannelSyncResult] = []
        for channel in self.resolve_configured_channels(channel_refs):
            state = self._load_state(channel)
            results.append(
                self._sync_channel(
                    channel,
                    mode="backfill",
                    start_cursor=max(0, state.last_backfilled_message_id - 1) if state.last_backfilled_message_id else 0,
                    stop_at_message_id=0,
                    limit=limit_per_channel,
                    batch_size=batch_size,
                    initial_state=state,
                )
            )
        return results

    def sync_once(
        self,
        *,
        channel_refs: Sequence[str] | None = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> list[ChannelSyncResult]:
        results: list[ChannelSyncResult] = []
        for channel in self.resolve_configured_channels(channel_refs):
            state = self._load_state(channel)
            checkpoint = state.last_incremental_message_id or state.last_backfilled_message_id or 0
            results.append(
                self._sync_channel(
                    channel,
                    mode="incremental",
                    start_cursor=0,
                    stop_at_message_id=checkpoint,
                    limit=None,
                    batch_size=batch_size,
                    initial_state=state,
                )
            )
        return results

    def inspect_channel(self, channel_ref: str, *, limit: int = 10) -> dict[str, Any]:
        channel = self.resolve_channel(channel_ref)
        state = self._load_state(channel)
        messages = self._read_messages(channel, limit=limit)
        return {
            "channel": {
                "channel_id": channel.channel_id,
                "channel_name": channel.channel_name,
                "channel_ref": channel.channel_ref,
                "username": channel.username,
                "title": channel.title,
                "public_url": channel.public_url,
            },
            "sync_state": state.as_record(),
            "message_count_preview": len(messages),
            "latest_message": messages[0] if messages else None,
            "messages": messages,
        }

    def _sync_channel(
        self,
        channel: ResolvedChannel,
        *,
        mode: str,
        start_cursor: int,
        stop_at_message_id: int,
        limit: int | None,
        batch_size: int,
        initial_state: ChannelSyncState,
    ) -> ChannelSyncResult:
        batch_size = max(1, min(int(batch_size), MAX_TDLIB_PAGE_SIZE))
        result = ChannelSyncResult(channel=channel, mode=mode)
        cursor = max(0, int(start_cursor))
        checkpoint = max(0, int(stop_at_message_id))
        remaining = None if limit is None else max(0, int(limit))
        newest_seen = initial_state.last_incremental_message_id
        oldest_seen = initial_state.last_backfilled_message_id

        self._logger.info(
            "telegram.channel.sync.start",
            extra={
                "channel_id": channel.channel_id,
                "channel_name": channel.channel_name,
                "channel_ref": channel.channel_ref,
                "mode": mode,
                "cursor": cursor,
                "checkpoint": checkpoint,
                "limit": remaining,
                "batch_size": batch_size,
            },
        )

        while True:
            if remaining is not None and remaining <= 0:
                break

            page_limit = batch_size if remaining is None else max(1, min(batch_size, remaining))
            page = self._fetch_history_page(channel.channel_id, cursor, page_limit)
            if not page:
                result.exhausted_history = True
                break

            batch = self._process_history_page(channel, page, checkpoint=checkpoint, mode=mode)
            result.batches += 1
            result.fetched += batch.fetched
            result.normalized += batch.normalized
            result.written += batch.written
            result.checkpoint_reached = result.checkpoint_reached or batch.checkpoint_reached
            if batch.newest_message_id:
                newest_seen = max(newest_seen, batch.newest_message_id)
                result.newest_message_id = max(result.newest_message_id, batch.newest_message_id)
            if batch.oldest_message_id:
                oldest_seen = batch.oldest_message_id if oldest_seen == 0 else min(oldest_seen, batch.oldest_message_id)
                result.oldest_message_id = (
                    batch.oldest_message_id
                    if result.oldest_message_id == 0
                    else min(result.oldest_message_id, batch.oldest_message_id)
                )

            if batch.checkpoint_reached:
                break

            if remaining is not None:
                remaining -= batch.fetched

            next_cursor = batch.oldest_message_id if batch.oldest_message_id > 0 else 0
            if next_cursor <= 0 or next_cursor == cursor:
                break
            cursor = next_cursor

        state = ChannelSyncState(
            channel_id=channel.channel_id,
            channel_name=channel.channel_name,
            last_backfilled_message_id=oldest_seen or initial_state.last_backfilled_message_id,
            last_incremental_message_id=newest_seen or initial_state.last_incremental_message_id,
            last_synced_at=_utc_iso_now(),
            last_status="ok" if not result.errors else "partial",
            last_error="; ".join(result.errors) if result.errors else None,
        )
        self._store_state(state)
        self._logger.info(
            "telegram.channel.sync.complete",
            extra={
                "channel_id": channel.channel_id,
                "channel_name": channel.channel_name,
                "channel_ref": channel.channel_ref,
                "mode": mode,
                "batches": result.batches,
                "fetched": result.fetched,
                "normalized": result.normalized,
                "written": result.written,
                "newest_message_id": result.newest_message_id,
                "oldest_message_id": result.oldest_message_id,
                "checkpoint_reached": result.checkpoint_reached,
                "exhausted_history": result.exhausted_history,
            },
        )
        return result

    def _process_history_page(
        self,
        channel: ResolvedChannel,
        raw_messages: Sequence[Any],
        *,
        checkpoint: int,
        mode: str,
    ) -> BatchResult:
        batch = BatchResult()
        records: list[Mapping[str, Any]] = []
        for raw in raw_messages:
            raw_message = self._coerce_message(raw)
            message_id = _extract_message_id(raw_message)
            if message_id <= 0:
                continue
            batch.fetched += 1
            if checkpoint and mode == "incremental" and message_id <= checkpoint:
                batch.checkpoint_reached = True
                break
            normalized = self._normalize_message(raw_message, channel)
            if normalized is None:
                continue
            records.append(normalized)
            batch.normalized += 1
            batch.newest_message_id = message_id if batch.newest_message_id == 0 else max(batch.newest_message_id, message_id)
            batch.oldest_message_id = message_id if batch.oldest_message_id == 0 else min(batch.oldest_message_id, message_id)

        if records:
            batch.written = self._write_messages(records)

        self._logger.info(
            "telegram.channel.sync.batch",
            extra={
                "channel_id": channel.channel_id,
                "channel_name": channel.channel_name,
                "channel_ref": channel.channel_ref,
                "mode": mode,
                "fetched": batch.fetched,
                "normalized": batch.normalized,
                "written": batch.written,
                "newest_message_id": batch.newest_message_id,
                "oldest_message_id": batch.oldest_message_id,
                "checkpoint_reached": batch.checkpoint_reached,
            },
        )
        return batch

    def _fetch_history_page(self, chat_id: int, from_message_id: int, limit: int) -> Sequence[Any]:
        def _call() -> Sequence[Any]:
            return _invoke_first(
                self._tdlib,
                ("get_chat_history", "getChatHistory"),
                chat_id,
                from_message_id,
                0,
                min(MAX_TDLIB_PAGE_SIZE, max(1, int(limit))),
                False,
            )

        response = self._retry("fetch_history", _call, metadata={"chat_id": chat_id, "from_message_id": from_message_id, "limit": limit})
        if response is None:
            return []
        if isinstance(response, Mapping):
            for key in ("messages", "items", "result", "data"):
                value = response.get(key)
                if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
                    return value
            return []
        if isinstance(response, Sequence) and not isinstance(response, (str, bytes, bytearray)):
            return response
        maybe_messages = _lookup(response, "messages", "items", "result", default=None)
        if isinstance(maybe_messages, Sequence) and not isinstance(maybe_messages, (str, bytes, bytearray)):
            return maybe_messages
        return []

    def _normalize_message(self, raw_message: Mapping[str, Any], channel: ResolvedChannel) -> Mapping[str, Any] | None:
        normalized: Any = None
        if self._normalizer is not None:
            for name in ("normalize_message", "normalize_telegram_message", "transform_message", "normalize"):
                if hasattr(self._normalizer, name):
                    fn = getattr(self._normalizer, name)
                    try:
                        normalized = fn(raw_message, channel)
                    except TypeError:
                        normalized = fn(raw_message=raw_message, channel=channel)
                    break
        if normalized is None:
            record: dict[str, Any] = {}
        elif isinstance(normalized, Mapping):
            record = dict(normalized)
        else:
            record = {
                key: getattr(normalized, key)
                for key in (
                    "platform",
                    "channel_id",
                    "channel_name",
                    "message_id",
                    "timestamp",
                    "text",
                    "views",
                    "forward_count",
                    "reply_count",
                    "media_type",
                    "message_url",
                    "raw_json",
                )
                if hasattr(normalized, key)
            }
        return _ensure_record(record, raw_message, channel)

    def _write_messages(self, messages: Sequence[Mapping[str, Any]]) -> int:
        if not messages:
            return 0

        def _call() -> Any:
            return _invoke_first(
                self._storage,
                ("upsert_raw_messages", "insert_raw_messages", "store_raw_messages", "write_raw_messages"),
                messages,
            )

        result = self._retry("write_messages", _call, metadata={"count": len(messages)})
        return _coerce_write_result(result, len(messages))

    def _load_state(self, channel: ResolvedChannel) -> ChannelSyncState:
        raw: Any = None
        for name in ("get_sync_state", "load_sync_state", "fetch_sync_state", "read_sync_state"):
            if hasattr(self._storage, name):
                try:
                    raw = getattr(self._storage, name)(channel.channel_id)
                except TypeError:
                    raw = getattr(self._storage, name)(channel_id=channel.channel_id)
                break
        if raw is None:
            return ChannelSyncState(channel_id=channel.channel_id, channel_name=channel.channel_name)
        if isinstance(raw, ChannelSyncState):
            return raw
        return ChannelSyncState(
            channel_id=_coerce_int(_lookup(raw, "channel_id", default=channel.channel_id), channel.channel_id),
            channel_name=_coerce_str(_lookup(raw, "channel_name", default=channel.channel_name), channel.channel_name),
            last_backfilled_message_id=_coerce_int(
                _lookup(raw, "last_backfilled_message_id", "backfilled_message_id", default=0)
            ),
            last_incremental_message_id=_coerce_int(
                _lookup(raw, "last_incremental_message_id", "incremental_message_id", default=0)
            ),
            last_synced_at=_coerce_str(_lookup(raw, "last_synced_at", default=""), "") or None,
            last_status=_coerce_str(_lookup(raw, "last_status", default="never_synced"), "never_synced"),
            last_error=_coerce_str(_lookup(raw, "last_error", default=""), "") or None,
        )

    def _store_state(self, state: ChannelSyncState) -> None:
        payload = state.as_record()
        for name in ("upsert_sync_state", "save_sync_state", "store_sync_state", "write_sync_state"):
            if hasattr(self._storage, name):
                try:
                    getattr(self._storage, name)(payload)
                except TypeError:
                    getattr(self._storage, name)(**payload)
                return
        raise AttributeError("Storage does not expose a sync-state write method.")

    def _read_messages(self, channel: ResolvedChannel, *, limit: int) -> list[dict[str, Any]]:
        for name in ("get_messages_for_channel", "fetch_messages_for_channel", "list_messages_for_channel"):
            if hasattr(self._storage, name):
                reader = getattr(self._storage, name)
                try:
                    rows = reader(channel.channel_id, limit=limit)
                except TypeError:
                    rows = reader(channel_id=channel.channel_id, limit=limit)
                break
        else:
            return []
        if rows is None:
            return []
        if isinstance(rows, Mapping):
            rows = rows.get("messages", [])
        if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes, bytearray)):
            return []
        output: list[dict[str, Any]] = []
        for row in rows:
            if isinstance(row, Mapping):
                output.append(dict(row))
            elif hasattr(row, "__dict__"):
                output.append({key: value for key, value in vars(row).items() if not key.startswith("_")})
        return output

    def _coerce_message(self, raw: Any) -> Mapping[str, Any]:
        if isinstance(raw, Mapping):
            return raw
        if isinstance(raw, str):
            try:
                loaded = json.loads(raw)
            except json.JSONDecodeError:
                return {"text": raw}
            if isinstance(loaded, Mapping):
                return loaded
        if hasattr(raw, "__dict__"):
            return {key: value for key, value in vars(raw).items() if not key.startswith("_")}
        return {"raw": raw}

    def _retry(self, operation: str, func: Callable[[], Any], *, metadata: Mapping[str, Any] | None = None) -> Any:
        attempt = 0
        while True:
            attempt += 1
            try:
                return func()
            except Exception as exc:
                if not _is_transient_error(exc) or attempt >= self._max_retries:
                    raise
                delay = _retry_delay(
                    exc,
                    attempt,
                    base_delay=self._base_backoff_seconds,
                    cap_delay=self._backoff_cap_seconds,
                )
                self._logger.warning(
                    "telegram.retry",
                    extra={"operation": operation, "attempt": attempt, "delay_seconds": round(delay, 3), **(dict(metadata) if metadata else {}), "error": str(exc)},
                )
                self._sleep(delay)


def resolve_configured_channels(config: Any, resolver: Any, *, logger: logging.Logger | None = None) -> list[ResolvedChannel]:
    service = TelegramChannelSyncService(
        config=config,
        resolver=resolver,
        tdlib=resolver,
        storage=_NoopStorage(),
        normalizer=None,
        logger=logger,
    )
    return service.resolve_configured_channels()


class _NoopStorage:
    def upsert_raw_messages(self, messages: Sequence[Mapping[str, Any]]) -> int:
        return len(messages)

    def upsert_sync_state(self, state: Mapping[str, Any]) -> None:
        return None

    def get_sync_state(self, channel_id: int) -> None:
        return None


class _ResolverHistoryAdapter:
    """Adapt test doubles and the real TDLib client to one interface."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def resolve_channel(self, channel_ref: str) -> Any:
        for name in ("resolve_channel", "search_public_chat", "get_chat", "getChat"):
            if hasattr(self._client, name):
                return getattr(self._client, name)(channel_ref)
        raise AttributeError("Client does not expose a channel resolution method")

    def get_chat_history(
        self,
        chat_id: int,
        from_message_id: int = 0,
        offset: int = 0,
        limit: int = DEFAULT_BATCH_SIZE,
        only_local: bool = False,
    ) -> Any:
        del offset, only_local
        for name in ("get_chat_history", "fetch_history", "get_history", "getChatHistory"):
            if not hasattr(self._client, name):
                continue
            method = getattr(self._client, name)
            if name == "get_chat_history":
                try:
                    return method(
                        chat_id,
                        from_message_id=from_message_id,
                        offset=0,
                        limit=limit,
                        only_local=False,
                    )
                except TypeError:
                    try:
                        return method(chat_id, from_message_id, 0, limit, False)
                    except TypeError:
                        continue
            if name in {"fetch_history", "get_history"}:
                try:
                    return method(
                        chat_id,
                        offset_message_id=from_message_id if from_message_id > 0 else None,
                        limit=limit,
                    )
                except TypeError:
                    try:
                        return method(chat_id, from_message_id, 0, limit, False)
                    except TypeError:
                        continue
            try:
                return method(chat_id, from_message_id, 0, limit, False)
            except TypeError:
                try:
                    return method(chat_id)
                except TypeError:
                    continue
        raise AttributeError("Client does not expose a history fetch method")


class TelegramChannelSync:
    """Simple operator-facing channel sync API used by tests and the CLI."""

    def __init__(
        self,
        *,
        client: Any,
        storage: Any,
        config: Any | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self.client = client
        self.storage = storage
        self.config = config or {"telegram_channels": ()}
        self.logger = logger or logging.getLogger(__name__)
        adapter = _ResolverHistoryAdapter(client)
        self._service = TelegramChannelSyncService(
            config=self.config,
            resolver=adapter,
            tdlib=adapter,
            storage=storage,
            normalizer=normalize_module,
            logger=self.logger,
        )

    def validate_channels(self, channels: Sequence[str]) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for channel_ref in channels:
            try:
                channel = self._service.resolve_channel(channel_ref)
                self._persist_channel(channel)
                results.append(
                    {
                        "channel_name": channel.channel_name,
                        "channel_id": channel.channel_id,
                        "status": "ok",
                        "public_url": channel.public_url,
                    }
                )
            except Exception as exc:
                results.append(
                    {
                        "channel_name": _normalize_channel_ref(channel_ref) or str(channel_ref),
                        "status": "error",
                        "error": str(exc),
                    }
                )
        return results

    def backfill_channel(
        self,
        channel: str,
        *,
        limit: int | None = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> dict[str, Any]:
        self._persist_channel(self._service.resolve_channel(channel))
        return self._service.backfill_channel(channel, limit=limit, batch_size=batch_size).as_record()

    def backfill(self, channel: str, *, limit: int | None = None, batch_size: int = DEFAULT_BATCH_SIZE) -> dict[str, Any]:
        return self.backfill_channel(channel, limit=limit, batch_size=batch_size)

    def backfill_all(
        self,
        channels: Sequence[str] | None = None,
        *,
        limit: int | None = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> list[dict[str, Any]]:
        refs = list(channels) if channels is not None else self._service.configured_channel_refs()
        results = self._service.backfill_all(
            channel_refs=refs,
            limit_per_channel=limit,
            batch_size=batch_size,
        )
        return [result.as_record() for result in results]

    def sync_once(self, channel: str, *, batch_size: int = DEFAULT_BATCH_SIZE) -> dict[str, Any]:
        resolved_channel = self._service.resolve_channel(channel)
        self._persist_channel(resolved_channel)
        state = self._service._load_state(resolved_channel)
        checkpoint = state.last_incremental_message_id or state.last_backfilled_message_id or 0
        result = self._service._sync_channel(
            resolved_channel,
            mode="incremental",
            start_cursor=0,
            stop_at_message_id=checkpoint,
            limit=None,
            batch_size=batch_size,
            initial_state=state,
        )
        return result.as_record()

    def sync_channel_once(self, channel: str, *, batch_size: int = DEFAULT_BATCH_SIZE) -> dict[str, Any]:
        return self.sync_once(channel, batch_size=batch_size)

    def sync_channel(self, channel: str, *, batch_size: int = DEFAULT_BATCH_SIZE) -> dict[str, Any]:
        return self.sync_once(channel, batch_size=batch_size)

    def sync_all_once(
        self,
        channels: Sequence[str] | None = None,
        *,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> list[dict[str, Any]]:
        refs = list(channels) if channels is not None else self._service.configured_channel_refs()
        return [self.sync_once(channel_ref, batch_size=batch_size) for channel_ref in refs]

    def sync_loop(
        self,
        channels: Sequence[str] | None = None,
        *,
        interval_seconds: int = 300,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> None:
        refs = list(channels) if channels is not None else self._service.configured_channel_refs()
        while True:
            self.sync_all_once(refs, batch_size=batch_size)
            time.sleep(interval_seconds)

    def _persist_channel(self, channel: ResolvedChannel) -> None:
        if not hasattr(self.storage, "upsert_channel_registry"):
            return
        self.storage.upsert_channel_registry(
            {
                "channel_id": channel.channel_id,
                "channel_name": channel.channel_name,
                "source_username": channel.username or channel.channel_ref,
                "resolved_title": channel.title,
                "config_json": channel.raw_json or {},
            }
        )


TelegramSyncService = TelegramChannelSync
ChannelSyncService = TelegramChannelSync
