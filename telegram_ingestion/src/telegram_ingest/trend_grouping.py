"""OpenAI-backed trend grouping for recently ingested Telegram messages."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
import json
import os
import re
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from openai import OpenAI

from .config import load_env_file
from .storage import TelegramStorage

DEFAULT_MODEL = "gpt-5-mini"
DEFAULT_HOURS = 24
DEFAULT_LIMIT = 320
DEFAULT_PER_CHANNEL_LIMIT = 60
DEFAULT_MIN_TEXT_LENGTH = 12
DEFAULT_MAX_TEXT_LENGTH = 280
DEFAULT_MAX_TRENDS = 24

_TREND_RESULT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "trends": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "label": {"type": "string"},
                    "summary": {"type": "string"},
                    "why_now": {"type": "string"},
                    "keywords": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "message_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["id", "label", "summary", "why_now", "keywords", "message_ids"],
            },
        },
        "ignored_message_ids": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": ["trends", "ignored_message_ids"],
}


@dataclass(frozen=True, slots=True)
class TrendSourceMessage:
    source_id: str
    channel_id: int
    channel_name: str
    message_id: int
    timestamp: str
    text: str
    message_url: str | None
    views: int | None
    forward_count: int | None
    reply_count: int | None
    engagement_score: int


def load_openai_runtime_env(*, cwd: Path | None = None) -> dict[str, str]:
    """Merge repo-root and local .env files, then overlay process env."""

    base_dir = (cwd or Path.cwd()).resolve()
    search_dirs = [base_dir]
    parent_dir = base_dir.parent
    if parent_dir != base_dir:
        search_dirs.insert(0, parent_dir)

    merged: dict[str, str] = {}
    for directory in search_dirs:
        for filename in (".env.local", ".env"):
            merged.update(load_env_file(directory / filename))
    merged.update(os.environ)
    return merged


class TelegramTrendGrouper:
    """Group recent Telegram messages into higher-level trends with OpenAI."""

    def __init__(
        self,
        *,
        sqlite_path: str | Path,
        output_path: str | Path | None = None,
        env: Mapping[str, str] | None = None,
        client_factory: Callable[..., Any] = OpenAI,
    ) -> None:
        self._sqlite_path = Path(sqlite_path).resolve()
        self._output_path = (
            Path(output_path).resolve()
            if output_path is not None
            else self._sqlite_path.parent / "telegram_trends.json"
        )
        self._env = dict(env) if env is not None else load_openai_runtime_env(cwd=self._sqlite_path.parent.parent)
        self._client_factory = client_factory

    @property
    def output_path(self) -> Path:
        return self._output_path

    def group_recent_messages(
        self,
        *,
        hours: int = DEFAULT_HOURS,
        limit: int = DEFAULT_LIMIT,
        per_channel_limit: int = DEFAULT_PER_CHANNEL_LIMIT,
        min_text_length: int = DEFAULT_MIN_TEXT_LENGTH,
        max_text_length: int = DEFAULT_MAX_TEXT_LENGTH,
        max_trends: int = DEFAULT_MAX_TRENDS,
    ) -> dict[str, Any]:
        if hours <= 0:
            raise ValueError("hours must be greater than zero")
        if limit <= 0:
            raise ValueError("limit must be greater than zero")
        if per_channel_limit <= 0:
            raise ValueError("per_channel_limit must be greater than zero")
        if min_text_length <= 0:
            raise ValueError("min_text_length must be greater than zero")
        if max_text_length < min_text_length:
            raise ValueError("max_text_length must be greater than or equal to min_text_length")
        if max_trends <= 0:
            raise ValueError("max_trends must be greater than zero")

        messages = self._load_recent_messages(
            hours=hours,
            limit=limit,
            per_channel_limit=per_channel_limit,
            min_text_length=min_text_length,
            max_text_length=max_text_length,
        )
        if not messages:
            payload = self._build_empty_payload(hours=hours, limit=limit)
            self._write_output(payload)
            return payload

        model = (
            self._env.get("OPENAI_TELEGRAM_TREND_MODEL")
            or self._env.get("OPENAI_TREND_MODEL")
            or DEFAULT_MODEL
        ).strip()
        api_key = (self._env.get("OPENAI_API_KEY") or "").strip()
        if not api_key:
            raise RuntimeError("Missing OPENAI_API_KEY. Set it in the repo root .env.local or the process environment.")

        client_kwargs: dict[str, Any] = {"api_key": api_key}
        base_url = (self._env.get("OPENAI_BASE_URL") or "").strip()
        if base_url:
            client_kwargs["base_url"] = base_url

        client = self._client_factory(**client_kwargs)
        response = client.responses.create(
            model=model,
            instructions=(
                "You are a precise trend classification engine for Telegram market/news monitoring. "
                "Return strict JSON only."
            ),
            input=self._build_prompt(messages=messages, max_trends=max_trends, hours=hours),
            store=False,
            text={
                "format": {
                    "type": "json_schema",
                    "name": "telegram_trends",
                    "strict": True,
                    "schema": _TREND_RESULT_SCHEMA,
                },
                "verbosity": "low",
            },
        )
        parsed = self._parse_response_text(getattr(response, "output_text", ""))
        grouped = self._normalize_model_result(parsed, messages=messages, model=model, hours=hours)
        self._write_output(grouped)
        return grouped

    def _build_empty_payload(self, *, hours: int, limit: int) -> dict[str, Any]:
        generated_at = datetime.now(UTC).isoformat()
        return {
            "generated_at": generated_at,
            "window": {"hours": hours, "limit": limit},
            "model": None,
            "source_message_count": 0,
            "source_hash": None,
            "output_path": str(self.output_path),
            "sampled_messages": [],
            "trends": [],
            "ignored_message_ids": [],
        }

    def _load_recent_messages(
        self,
        *,
        hours: int,
        limit: int,
        per_channel_limit: int,
        min_text_length: int,
        max_text_length: int,
    ) -> list[TrendSourceMessage]:
        cutoff = (datetime.now(UTC) - timedelta(hours=hours)).isoformat()
        scan_limit = max(limit * 8, per_channel_limit * 20, 500)

        query = """
            SELECT
                channel_id,
                channel_name,
                message_id,
                timestamp,
                text,
                message_url,
                views,
                forward_count,
                reply_count
            FROM raw_telegram_messages
            WHERE timestamp >= ?
              AND text IS NOT NULL
            ORDER BY timestamp DESC, message_id DESC
            LIMIT ?
        """

        channel_counts: dict[int, int] = {}
        seen_texts: set[str] = set()
        selected: list[TrendSourceMessage] = []

        with TelegramStorage(self._sqlite_path, initialize=False) as storage:
            rows = storage.connection.execute(query, (cutoff, int(scan_limit))).fetchall()

        for row in rows:
            channel_id = int(row["channel_id"])
            if channel_counts.get(channel_id, 0) >= per_channel_limit:
                continue

            cleaned_text = _clean_message_text(str(row["text"] or ""), max_length=max_text_length)
            if len(cleaned_text) < min_text_length:
                continue

            dedupe_key = _dedupe_key(cleaned_text)
            if dedupe_key in seen_texts:
                continue

            seen_texts.add(dedupe_key)
            channel_counts[channel_id] = channel_counts.get(channel_id, 0) + 1

            message_id = int(row["message_id"])
            selected.append(
                TrendSourceMessage(
                    source_id=f"{channel_id}:{message_id}",
                    channel_id=channel_id,
                    channel_name=str(row["channel_name"]),
                    message_id=message_id,
                    timestamp=str(row["timestamp"]),
                    text=cleaned_text,
                    message_url=None if row["message_url"] is None else str(row["message_url"]),
                    views=_coerce_optional_int(row["views"]),
                    forward_count=_coerce_optional_int(row["forward_count"]),
                    reply_count=_coerce_optional_int(row["reply_count"]),
                    engagement_score=_engagement_score(
                        views=_coerce_optional_int(row["views"]),
                        forward_count=_coerce_optional_int(row["forward_count"]),
                        reply_count=_coerce_optional_int(row["reply_count"]),
                    ),
                )
            )
            if len(selected) >= limit:
                break

        return selected

    @staticmethod
    def _build_prompt(*, messages: Sequence[TrendSourceMessage], max_trends: int, hours: int) -> str:
        serializable_messages = [
            {
                "id": message.source_id,
                "channel_name": message.channel_name,
                "timestamp": message.timestamp,
                "engagement_score": message.engagement_score,
                "views": message.views,
                "forward_count": message.forward_count,
                "reply_count": message.reply_count,
                "text": message.text,
            }
            for message in messages
        ]
        return json.dumps(
            {
                "task": "Group recent Telegram messages into concrete Telegram discussion trends.",
                "window_hours": hours,
                "rules": [
                    "Group messages that refer to the same real-world event, company, asset move, policy, exploit, product launch, macro theme, public debate, or repeated community talking point.",
                    "Prefer specific, self-contained labels that would make sense on a trend dashboard.",
                    "If a topic appears repeatedly in the supplied messages, keep it as a trend even when it is niche, conversational, or limited to Telegram.",
                    "Use 2-6 words for labels unless a single clear entity name is the best label.",
                    "Every message id may appear in at most one trend.",
                    "Only include message_ids that are present in the supplied list.",
                    f"Return between 1 and {max_trends} trends when the source messages support them, and prefer covering more valid topics over dropping them.",
                    "Use ignored_message_ids only for spam, exact duplicates, greetings, or messages with no clear topical meaning.",
                    "Do not ignore a message just because the topic is small if it has repeated support in the supplied messages.",
                ],
                "messages": serializable_messages,
            },
            ensure_ascii=True,
            separators=(",", ":"),
        )

    @staticmethod
    def _parse_response_text(output_text: str) -> dict[str, Any]:
        if not output_text or not output_text.strip():
            raise RuntimeError("OpenAI returned an empty trend grouping response.")
        parsed = json.loads(output_text)
        if not _is_trend_result(parsed):
            raise RuntimeError("OpenAI trend grouping returned an invalid payload.")
        return parsed

    def _normalize_model_result(
        self,
        payload: Mapping[str, Any],
        *,
        messages: Sequence[TrendSourceMessage],
        model: str,
        hours: int,
    ) -> dict[str, Any]:
        message_lookup = {message.source_id: message for message in messages}
        assigned_ids: set[str] = set()
        trends: list[dict[str, Any]] = []
        trend_by_message_id: dict[str, dict[str, Any]] = {}

        for index, trend in enumerate(payload.get("trends", []), start=1):
            if not isinstance(trend, Mapping):
                continue

            valid_ids: list[str] = []
            for message_id in trend.get("message_ids", []):
                if not isinstance(message_id, str):
                    continue
                if message_id not in message_lookup or message_id in assigned_ids:
                    continue
                valid_ids.append(message_id)
                assigned_ids.add(message_id)

            if not valid_ids:
                continue

            trend_messages = [message_lookup[message_id] for message_id in valid_ids]
            channels = sorted({message.channel_name for message in trend_messages}, key=str.lower)
            representative_messages = [
                {
                    "source_id": message.source_id,
                    "channel_name": message.channel_name,
                    "timestamp": message.timestamp,
                    "text": message.text,
                    "message_url": message.message_url,
                    "engagement_score": message.engagement_score,
                }
                for message in sorted(
                    trend_messages,
                    key=lambda item: (item.engagement_score, item.timestamp, item.message_id),
                    reverse=True,
                )[:5]
            ]

            trend_record = {
                "id": _clean_label(str(trend.get("id") or f"trend_{index}"), fallback=f"trend_{index}"),
                "label": _clean_label(str(trend.get("label") or ""), fallback=f"Trend {index}"),
                "summary": _clean_sentence(str(trend.get("summary") or "")),
                "why_now": _clean_sentence(str(trend.get("why_now") or "")),
                "keywords": _clean_keywords(trend.get("keywords")),
                "message_count": len(valid_ids),
                "channel_count": len(channels),
                "channel_names": channels,
                "message_ids": valid_ids,
                "representative_messages": representative_messages,
                "total_engagement_score": sum(message.engagement_score for message in trend_messages),
                "latest_timestamp": max(message.timestamp for message in trend_messages),
            }
            trends.append(trend_record)
            for message_id in valid_ids:
                trend_by_message_id[message_id] = trend_record

        ignored_message_ids = [
            message_id
            for message_id in payload.get("ignored_message_ids", [])
            if isinstance(message_id, str) and message_id in message_lookup and message_id not in assigned_ids
        ]
        ignored_message_id_set = set(ignored_message_ids)

        source_hash = sha256(
            json.dumps(
                {
                    "model": model,
                    "hours": hours,
                    "messages": [
                        {
                            "id": message.source_id,
                            "channel_name": message.channel_name,
                            "timestamp": message.timestamp,
                            "text": message.text,
                            "engagement_score": message.engagement_score,
                        }
                        for message in messages
                    ],
                },
                sort_keys=True,
                ensure_ascii=True,
            ).encode("utf-8")
        ).hexdigest()

        trends.sort(key=lambda item: (item["message_count"], item["total_engagement_score"], item["latest_timestamp"]), reverse=True)

        return {
            "generated_at": datetime.now(UTC).isoformat(),
            "window": {"hours": hours, "limit": len(messages)},
            "model": model,
            "source_message_count": len(messages),
            "source_hash": source_hash,
            "output_path": str(self.output_path),
            "sampled_messages": [
                {
                    "source_id": message.source_id,
                    "channel_id": message.channel_id,
                    "channel_name": message.channel_name,
                    "message_id": message.message_id,
                    "timestamp": message.timestamp,
                    "text": message.text,
                    "message_url": message.message_url,
                    "views": message.views,
                    "forward_count": message.forward_count,
                    "reply_count": message.reply_count,
                    "engagement_score": message.engagement_score,
                    "assigned_trend_id": trend_by_message_id.get(message.source_id, {}).get("id"),
                    "assigned_trend_label": trend_by_message_id.get(message.source_id, {}).get("label"),
                    "ignored": message.source_id in ignored_message_id_set,
                }
                for message in messages
            ],
            "ignored_message_ids": ignored_message_ids,
            "trends": trends,
        }

    def _write_output(self, payload: Mapping[str, Any]) -> None:
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")


def _clean_message_text(value: str, *, max_length: int) -> str:
    cleaned = re.sub(r"\s+", " ", value.replace("\x00", " ")).strip()
    if len(cleaned) <= max_length:
        return cleaned
    truncated = cleaned[: max_length - 1].rstrip()
    return f"{truncated}..."


def _dedupe_key(value: str) -> str:
    normalized = re.sub(r"https?://\S+", "", value.lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _coerce_optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _engagement_score(*, views: int | None, forward_count: int | None, reply_count: int | None) -> int:
    safe_views = max(0, views or 0)
    safe_forwards = max(0, forward_count or 0)
    safe_replies = max(0, reply_count or 0)
    return safe_forwards * 10 + safe_replies * 8 + min(safe_views, 5000) // 25


def _is_trend_result(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    trends = value.get("trends")
    ignored = value.get("ignored_message_ids")
    if not isinstance(trends, list) or not isinstance(ignored, list):
        return False
    for trend in trends:
        if not isinstance(trend, Mapping):
            return False
        if not isinstance(trend.get("id"), str):
            return False
        if not isinstance(trend.get("label"), str):
            return False
        if not isinstance(trend.get("summary"), str):
            return False
        if not isinstance(trend.get("why_now"), str):
            return False
        if not isinstance(trend.get("keywords"), list) or not all(isinstance(item, str) for item in trend["keywords"]):
            return False
        if not isinstance(trend.get("message_ids"), list) or not all(isinstance(item, str) for item in trend["message_ids"]):
            return False
    return all(isinstance(item, str) for item in ignored)


def _clean_label(value: str, *, fallback: str) -> str:
    stripped = re.sub(r"\s+", " ", value).strip().strip(" .")
    return stripped or fallback


def _clean_sentence(value: str) -> str:
    stripped = re.sub(r"\s+", " ", value).strip()
    if not stripped:
        return ""
    return stripped


def _clean_keywords(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    keywords: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        cleaned = _clean_label(item, fallback="")
        lowered = cleaned.lower()
        if not cleaned or lowered in seen:
            continue
        seen.add(lowered)
        keywords.append(cleaned)
    return keywords[:8]


__all__ = [
    "DEFAULT_HOURS",
    "DEFAULT_LIMIT",
    "DEFAULT_MAX_TRENDS",
    "DEFAULT_MODEL",
    "DEFAULT_PER_CHANNEL_LIMIT",
    "TelegramTrendGrouper",
    "TrendSourceMessage",
    "load_openai_runtime_env",
]
