"""Telegram message normalization helpers.

This module converts Telegram/TDLib message payloads into a stable schema
that downstream analytics and SQLite storage can consume without depending on
TDLib internals.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import re
from typing import Any, Mapping, MutableMapping

__all__ = [
    "NormalizedTelegramMessage",
    "build_message_url",
    "canonical_channel_name",
    "normalize",
    "normalize_message",
    "normalize_telegram_message",
    "transform_message",
]


USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{5,32}$")
TELEGRAM_HANDLE_RE = re.compile(r"^@?([A-Za-z0-9_]{5,32})$")


@dataclass(frozen=True)
class NormalizedTelegramMessage:
    """Stable Telegram message shape for storage and analytics."""

    platform: str
    channel_id: int
    channel_name: str
    message_id: int
    timestamp: str
    text: str
    views: int | None
    forward_count: int | None
    reply_count: int | None
    media_type: str
    message_url: str | None
    raw_json: str

    def as_db_tuple(self) -> tuple[Any, ...]:
        """Return a tuple aligned with the SQLite message schema."""

        return (
            self.platform,
            self.channel_id,
            self.channel_name,
            self.message_id,
            self.timestamp,
            self.text,
            self.views,
            self.forward_count,
            self.reply_count,
            self.media_type,
            self.message_url,
            self.raw_json,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "platform": self.platform,
            "channel_id": self.channel_id,
            "channel_name": self.channel_name,
            "message_id": self.message_id,
            "timestamp": self.timestamp,
            "text": self.text,
            "views": self.views,
            "forward_count": self.forward_count,
            "reply_count": self.reply_count,
            "media_type": self.media_type,
            "message_url": self.message_url,
            "raw_json": self.raw_json,
        }

    def __iter__(self):  # type: ignore[override]
        return iter(self.to_dict().items())

    def __getitem__(self, key: str) -> Any:
        return self.to_dict()[key]


def canonical_channel_name(value: str | None) -> str:
    """Normalize a configured/public Telegram channel identifier."""

    if value is None:
        return ""

    stripped = str(value).strip()
    if not stripped:
        return ""

    stripped = stripped.removeprefix("https://t.me/")
    stripped = stripped.removeprefix("http://t.me/")
    stripped = stripped.removeprefix("t.me/")
    stripped = stripped.removeprefix("@")
    stripped = stripped.strip().strip("/")

    match = TELEGRAM_HANDLE_RE.fullmatch(stripped)
    if match:
        return match.group(1).lower()

    return stripped


def build_message_url(channel_name: str | None, message_id: int | str | None) -> str | None:
    """Build a Telegram public message URL when the channel has a username."""

    canonical = canonical_channel_name(channel_name)
    if not canonical or not USERNAME_RE.fullmatch(canonical):
        return None

    message_int = _coerce_int(message_id)
    if message_int is None:
        return None

    return f"https://t.me/{canonical}/{message_int}"


def normalize_telegram_message(
    raw_message: Mapping[str, Any] | MutableMapping[str, Any],
    channel: Any | None = None,
    *,
    channel_id: int | str | None = None,
    channel_name: str | None = None,
    platform: str = "telegram",
    message_url: str | None = None,
    raw_json: str | None = None,
) -> NormalizedTelegramMessage:
    """Normalize a raw Telegram message into the stable storage schema."""

    payload = _unwrap_message(raw_message)
    channel_hint = _coerce_channel_hint(channel)

    inferred_channel_id = channel_id
    if inferred_channel_id is None:
        inferred_channel_id = (
            payload.get("channel_id")
            or payload.get("chat_id")
            or channel_hint.get("channel_id")
        )
    resolved_channel_id = _coerce_int(inferred_channel_id)
    if resolved_channel_id is None:
        raise ValueError("Telegram message is missing a usable channel_id/chat_id")

    resolved_channel_name = channel_name
    if resolved_channel_name is None:
        resolved_channel_name = (
            _first_text(payload, "channel_name", "channelName", "username", "chat_name", "title")
            or _extract_channel_name_from_chat(payload)
            or channel_hint.get("channel_name")
            or channel_hint.get("username")
            or channel_hint.get("title")
        )
    resolved_channel_name = canonical_channel_name(resolved_channel_name)
    if not resolved_channel_name:
        raise ValueError("Telegram message is missing a usable channel_name")

    message_id = _coerce_int(payload.get("message_id") or payload.get("id"))
    if message_id is None:
        raise ValueError("Telegram message is missing a usable message_id/id")

    timestamp = _coerce_timestamp(
        payload.get("timestamp")
        or payload.get("date")
        or payload.get("created_at")
        or payload.get("sent_at")
        or _extract_nested(payload, ("message", "date"))
    )
    if timestamp is None:
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    text = _extract_text(payload)
    media_type = _extract_media_type(payload)

    views = _coerce_int(
        _first_not_none(
            payload.get("views"),
            payload.get("view_count"),
            _extract_nested(payload, ("interaction_info", "view_count")),
            _extract_nested(payload, ("interaction_info", "views")),
        )
    )
    forward_count = _coerce_int(
        _first_not_none(
            payload.get("forward_count"),
            payload.get("forwards"),
            _extract_nested(payload, ("interaction_info", "forward_count")),
            _extract_nested(payload, ("interaction_info", "forwards")),
        )
    )
    reply_count = _coerce_int(
        _first_not_none(
            payload.get("reply_count"),
            _extract_nested(payload, ("reply_info", "reply_count")),
            _extract_nested(payload, ("interaction_info", "reply_count")),
        )
    )

    resolved_message_url = (
        message_url
        or _first_text(payload, "message_url", "url", "link")
        or build_message_url(resolved_channel_name, message_id)
    )
    resolved_raw_json = raw_json or _serialize_raw_json(raw_message)

    return NormalizedTelegramMessage(
        platform=platform,
        channel_id=resolved_channel_id,
        channel_name=resolved_channel_name,
        message_id=message_id,
        timestamp=timestamp,
        text=text,
        views=views,
        forward_count=forward_count,
        reply_count=reply_count,
        media_type=media_type,
        message_url=resolved_message_url,
        raw_json=resolved_raw_json,
    )


def normalize_message(
    raw_message: Mapping[str, Any] | MutableMapping[str, Any],
    channel: Any | None = None,
    **kwargs: Any,
) -> NormalizedTelegramMessage:
    return normalize_telegram_message(raw_message, channel=channel, **kwargs)


def transform_message(
    raw_message: Mapping[str, Any] | MutableMapping[str, Any],
    channel: Any | None = None,
    **kwargs: Any,
) -> NormalizedTelegramMessage:
    return normalize_telegram_message(raw_message, channel=channel, **kwargs)


def normalize(
    raw_message: Mapping[str, Any] | MutableMapping[str, Any],
    channel: Any | None = None,
    **kwargs: Any,
) -> NormalizedTelegramMessage:
    return normalize_telegram_message(raw_message, channel=channel, **kwargs)


def _unwrap_message(raw_message: Mapping[str, Any] | MutableMapping[str, Any]) -> Mapping[str, Any]:
    if "message" in raw_message and isinstance(raw_message["message"], Mapping):
        return raw_message["message"]  # type: ignore[return-value]
    return raw_message


def _serialize_raw_json(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    except TypeError:
        return json.dumps(str(value), ensure_ascii=False, separators=(",", ":"))


def _coerce_int(value: Any) -> int | None:
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
        try:
            return int(float(stripped))
        except ValueError:
            return None
    return None


def _coerce_timestamp(value: Any) -> str | None:
    if value is None or value == "":
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

    return None


def _extract_text(payload: Mapping[str, Any]) -> str:
    candidates: list[Any] = [
        payload.get("text"),
        payload.get("caption"),
        _extract_nested(payload, ("content", "text")),
        _extract_nested(payload, ("content", "caption")),
        _extract_nested(payload, ("message", "text")),
        _extract_nested(payload, ("message", "caption")),
    ]
    for candidate in candidates:
        extracted = _stringify_text(candidate)
        if extracted:
            return extracted

    content = payload.get("content")
    if isinstance(content, Mapping):
        for key in ("caption", "text", "description"):
            extracted = _stringify_text(content.get(key))
            if extracted:
                return extracted

    return ""


def _stringify_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, Mapping):
        nested_text = value.get("text")
        if isinstance(nested_text, str):
            return nested_text.strip()
        if isinstance(nested_text, Mapping):
            deeper = nested_text.get("text")
            if isinstance(deeper, str):
                return deeper.strip()
        caption = value.get("caption")
        if isinstance(caption, str):
            return caption.strip()
    return ""


def _extract_media_type(payload: Mapping[str, Any]) -> str:
    direct_media_type = payload.get("media_type") or payload.get("mediaType")
    if isinstance(direct_media_type, str) and direct_media_type.strip():
        return direct_media_type.strip().lower()

    content = payload.get("content")
    content_type = None
    if isinstance(content, Mapping):
        content_type = content.get("@type") or content.get("type")
    if content_type is None:
        content_type = payload.get("@type") or payload.get("type")

    normalized = str(content_type or "").strip()
    if not normalized:
        return "unknown"

    media_map = {
        "messagetext": "text",
        "messagephoto": "photo",
        "messagevideo": "video",
        "messageaudio": "audio",
        "messagedocument": "document",
        "messageanimation": "animation",
        "messagevoicenote": "voice_note",
        "messagevideonote": "video_note",
        "messagesticker": "sticker",
        "messagepoll": "poll",
        "messagecontact": "contact",
        "messagelocation": "location",
        "messagevenue": "venue",
        "messagechataddmembers": "service",
        "messagechatdeletemember": "service",
        "messagechatjoinbylink": "service",
        "messagechatmigratefrom": "service",
        "messagechatmigrateto": "service",
        "messagescreenshottaken": "service",
    }
    key = normalized.lower()
    if key in media_map:
        return media_map[key]

    if key.startswith("message"):
        key = key[len("message") :]
    key = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", key)
    key = re.sub(r"[^a-zA-Z0-9_]+", "_", key).strip("_")
    return key.lower() or "unknown"


def _first_text(payload: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _first_not_none(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _extract_channel_name_from_chat(payload: Mapping[str, Any]) -> str | None:
    chat = payload.get("chat")
    if isinstance(chat, Mapping):
        for key in ("username", "title", "name"):
            value = chat.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _extract_nested(payload: Mapping[str, Any], path: tuple[str, ...]) -> Any:
    current: Any = payload
    for key in path:
        if not isinstance(current, Mapping):
            return None
        current = current.get(key)
    return current


def _coerce_channel_hint(channel: Any | None) -> dict[str, Any]:
    if channel is None:
        return {}
    if isinstance(channel, Mapping):
        return {
            "channel_id": channel.get("channel_id") or channel.get("chat_id") or channel.get("id"),
            "channel_name": channel.get("channel_name") or channel.get("name"),
            "username": channel.get("username") or channel.get("handle"),
            "title": channel.get("title"),
        }
    return {
        "channel_id": getattr(channel, "channel_id", None) or getattr(channel, "chat_id", None) or getattr(channel, "id", None),
        "channel_name": getattr(channel, "channel_name", None) or getattr(channel, "name", None),
        "username": getattr(channel, "username", None) or getattr(channel, "handle", None),
        "title": getattr(channel, "title", None),
    }
