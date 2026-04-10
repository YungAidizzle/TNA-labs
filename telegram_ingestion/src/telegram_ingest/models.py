"""Core data models for Telegram ingestion."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class TelegramMessageRecord:
    """Normalized message shape stored in SQLite and consumed downstream."""

    platform: str
    channel_id: int
    channel_name: str
    message_id: int
    timestamp: datetime
    text: str | None
    views: int | None
    forward_count: int | None
    reply_count: int | None
    media_type: str | None
    message_url: str | None
    raw_json: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class TelegramSyncState:
    """Per-channel synchronization checkpoint."""

    channel_id: int
    channel_name: str
    last_backfilled_message_id: int | None
    last_incremental_message_id: int | None
    last_synced_at: datetime | None
    last_status: str
    last_error: str | None = None


@dataclass(frozen=True, slots=True)
class TelegramChannelSnapshot:
    """Resolved public channel metadata captured during discovery."""

    channel_id: int | None
    channel_name: str
    display_name: str | None = None
    description: str | None = None
    is_verified: bool | None = None


__all__ = [
    "TelegramChannelSnapshot",
    "TelegramMessageRecord",
    "TelegramSyncState",
]

