from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

from .channel_sync import ChannelSyncState, TelegramChannelSyncService


@dataclass(slots=True)
class ChannelDiagnostics:
    channel_id: int
    channel_name: str
    channel_ref: str
    resolved: bool = False
    total_messages: int | None = None
    latest_message_timestamp: str | None = None
    last_status: str | None = None
    last_error: str | None = None
    last_backfilled_message_id: int | None = None
    last_incremental_message_id: int | None = None

    def as_record(self) -> dict[str, Any]:
        return {
            "channel_id": self.channel_id,
            "channel_name": self.channel_name,
            "channel_ref": self.channel_ref,
            "resolved": self.resolved,
            "total_messages": self.total_messages,
            "latest_message_timestamp": self.latest_message_timestamp,
            "last_status": self.last_status,
            "last_error": self.last_error,
            "last_backfilled_message_id": self.last_backfilled_message_id,
            "last_incremental_message_id": self.last_incremental_message_id,
        }


@dataclass(slots=True)
class IngestionDiagnostics:
    total_channels_configured: int = 0
    total_channels_resolved: int = 0
    total_messages_stored: int = 0
    channels: list[ChannelDiagnostics] = field(default_factory=list)

    def as_record(self) -> dict[str, Any]:
        return {
            "total_channels_configured": self.total_channels_configured,
            "total_channels_resolved": self.total_channels_resolved,
            "total_messages_stored": self.total_messages_stored,
            "channels": [channel.as_record() for channel in self.channels],
        }


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


def _call_first(obj: Any, names: Sequence[str], *args: Any, **kwargs: Any) -> Any:
    for name in names:
        if obj is None or not hasattr(obj, name):
            continue
        try:
            return getattr(obj, name)(*args, **kwargs)
        except TypeError:
            return getattr(obj, name)(**kwargs)
    raise AttributeError(f"None of {names!r} exist on {type(obj).__name__}")


def _latest_timestamp_from_storage(storage: Any, channel_id: int) -> str | None:
    for name in ("get_latest_message_timestamp", "latest_message_timestamp", "fetch_latest_message_timestamp"):
        if hasattr(storage, name):
            try:
                value = getattr(storage, name)(channel_id)
            except TypeError:
                value = getattr(storage, name)(channel_id=channel_id)
            return _coerce_str(value, "") or None
    for name in ("latest_message_for_channel", "get_latest_message_for_channel", "fetch_latest_message_for_channel"):
        if hasattr(storage, name):
            try:
                row = getattr(storage, name)(channel_id)
            except TypeError:
                row = getattr(storage, name)(channel_id=channel_id)
            value = _lookup(row, "timestamp", default=None)
            return _coerce_str(value, "") or None
    return None


def _count_messages(storage: Any) -> int:
    for name in ("count_raw_messages", "count_messages", "message_count", "total_messages"):
        if hasattr(storage, name):
            value = getattr(storage, name)()
            return _coerce_int(value, 0)
    return 0


def _count_messages_for_channel(storage: Any, channel_id: int) -> int | None:
    for name in ("count_raw_messages_for_channel", "count_messages_for_channel", "channel_message_count"):
        if hasattr(storage, name):
            try:
                value = getattr(storage, name)(channel_id)
            except TypeError:
                value = getattr(storage, name)(channel_id=channel_id)
            return _coerce_int(value, 0)
    return None


def _iter_sync_states(storage: Any) -> list[ChannelSyncState]:
    for name in ("list_sync_states", "get_sync_states", "iter_sync_states"):
        if hasattr(storage, name):
            raw = getattr(storage, name)()
            break
    else:
        return []
    if raw is None:
        return []
    if isinstance(raw, Mapping):
        raw = raw.get("items", raw.get("states", []))
    if not isinstance(raw, Sequence):
        return []
    states: list[ChannelSyncState] = []
    for item in raw:
        states.append(
            ChannelSyncState(
                channel_id=_coerce_int(_lookup(item, "channel_id", default=0), 0),
                channel_name=_coerce_str(_lookup(item, "channel_name", default=""), ""),
                last_backfilled_message_id=_coerce_int(_lookup(item, "last_backfilled_message_id", default=0), 0),
                last_incremental_message_id=_coerce_int(_lookup(item, "last_incremental_message_id", default=0), 0),
                last_synced_at=_coerce_str(_lookup(item, "last_synced_at", default=""), "") or None,
                last_status=_coerce_str(_lookup(item, "last_status", default="never_synced"), "never_synced"),
                last_error=_coerce_str(_lookup(item, "last_error", default=""), "") or None,
            )
        )
    return states


def build_ingestion_diagnostics(
    *,
    service: TelegramChannelSyncService,
    storage: Any,
    channel_refs: Sequence[str] | None = None,
) -> IngestionDiagnostics:
    configured_refs = service.configured_channel_refs() if channel_refs is None else list(channel_refs)
    resolved = service.resolve_configured_channels(configured_refs)
    resolved_map = {channel.channel_ref: channel for channel in resolved}
    state_map = {state.channel_id: state for state in _iter_sync_states(storage)}

    channels: list[ChannelDiagnostics] = []
    for ref in configured_refs:
        channel = resolved_map.get(ref)
        if channel is None:
            channels.append(
                ChannelDiagnostics(
                    channel_id=0,
                    channel_name=ref,
                    channel_ref=ref,
                    resolved=False,
                )
            )
            continue

        state = state_map.get(channel.channel_id)
        channels.append(
            ChannelDiagnostics(
                channel_id=channel.channel_id,
                channel_name=channel.channel_name,
                channel_ref=channel.channel_ref,
                resolved=True,
                total_messages=_count_messages_for_channel(storage, channel.channel_id),
                latest_message_timestamp=_latest_timestamp_from_storage(storage, channel.channel_id),
                last_status=state.last_status if state else None,
                last_error=state.last_error if state else None,
                last_backfilled_message_id=state.last_backfilled_message_id if state else None,
                last_incremental_message_id=state.last_incremental_message_id if state else None,
            )
        )

    return IngestionDiagnostics(
        total_channels_configured=len(configured_refs),
        total_channels_resolved=len(resolved),
        total_messages_stored=_count_messages(storage),
        channels=channels,
    )


def format_ingestion_diagnostics(diagnostics: IngestionDiagnostics) -> str:
    lines = [
        f"configured_channels={diagnostics.total_channels_configured}",
        f"resolved_channels={diagnostics.total_channels_resolved}",
        f"total_messages_stored={diagnostics.total_messages_stored}",
    ]
    for channel in diagnostics.channels:
        lines.append(
            "channel="
            f"{channel.channel_ref} "
            f"resolved={str(channel.resolved).lower()} "
            f"messages={channel.total_messages if channel.total_messages is not None else 'unknown'} "
            f"latest={channel.latest_message_timestamp or 'unknown'} "
            f"status={channel.last_status or 'unknown'}"
        )
    return "\n".join(lines)


def inspect_channel(
    *,
    service: TelegramChannelSyncService,
    channel_ref: str,
    limit: int = 10,
) -> dict[str, Any]:
    return service.inspect_channel(channel_ref, limit=limit)
