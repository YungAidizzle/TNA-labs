from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import socket
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from urllib import error as urllib_error
from urllib import request as urllib_request

from backend.logging_setup import log_event
from backend.trend_memecoin_signals import infer_memecoin_trend_category, profile_memecoin_attention

OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"

OPENAI_SYSTEM_PROMPT = (
    "You are an evidence-bound narrative labeler for a production trend intelligence system. "
    "Use only the supplied posts and diagnostics. "
    "Your first task is to decide whether the cluster is usable. "
    "When a cluster is usable, choose exactly one dominant narrative for canonical_name. "
    "Prefer abstention over false specificity. "
    "If the cluster is mixed, fragmented, weak, or malformed, say so explicitly. "
    "Do not expose multi-topic mashups in canonical_name. "
    "Do not invent causes, significance, timelines, people, or event details. "
    "Do not repair malformed topic fragments unless the supplied evidence clearly supports the repaired term."
)

OPENAI_JSON_SCHEMA = {
    "name": "trend_enrichment",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {
                "type": "string",
                "enum": ["ok", "mixed", "insufficient_evidence", "junk"],
                "description": "Overall usability of the cluster.",
            },
            "canonical_name": {
                "type": ["string", "null"],
                "description": "Operationally useful single dominant narrative grounded in the evidence. Null when abstaining.",
            },
            "summary": {
                "type": ["string", "null"],
                "description": "Short evidence-grounded summary. Keep it concise.",
            },
            "why_attention": {
                "type": ["string", "null"],
                "description": "Optional reason for attention only when directly supported by the evidence.",
            },
            "evidence_post_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "IDs of supplied evidence posts that support the output.",
            },
            "evidence_entities": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Entities or phrases from the evidence that anchor the cluster.",
            },
            "mixed_signals": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional reasons why the cluster is mixed or ambiguous.",
            },
            "abstain_reason": {
                "type": ["string", "null"],
                "description": "Required when status is not ok.",
            },
            "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "Confidence in the status and narrative output.",
            },
        },
        "required": [
            "status",
            "canonical_name",
            "summary",
            "why_attention",
            "evidence_post_ids",
            "evidence_entities",
            "mixed_signals",
            "abstain_reason",
            "confidence",
        ],
    },
}

OPENAI_TITLE_SYSTEM_PROMPT = (
    "You are an evidence-bound title generator for a production trend leaderboard. "
    "Use only the supplied posts and diagnostics. "
    "When the cluster is usable, choose exactly one dominant user-facing canonical_name. "
    "Write a descriptive narrative label, not a bare entity, keyword bag, or chopped token fragment. "
    "The label should read like a current internet narrative with enough specificity for a trader or researcher scanning a board. "
    "Prefer abstention over false specificity. "
    "Do not expose multi-topic mashups in canonical_name. "
    "Do not invent causes, significance, timelines, people, or event details."
)

OPENAI_TITLE_JSON_SCHEMA = {
    "name": "trend_visible_title",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {
                "type": "string",
                "enum": ["ok", "mixed", "insufficient_evidence", "junk"],
            },
            "canonical_name": {
                "type": ["string", "null"],
            },
            "evidence_post_ids": {
                "type": "array",
                "items": {"type": "string"},
            },
            "evidence_entities": {
                "type": "array",
                "items": {"type": "string"},
            },
            "mixed_signals": {
                "type": "array",
                "items": {"type": "string"},
            },
            "abstain_reason": {
                "type": ["string", "null"],
            },
            "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
            },
        },
        "required": [
            "status",
            "canonical_name",
            "evidence_post_ids",
            "evidence_entities",
            "mixed_signals",
            "abstain_reason",
            "confidence",
        ],
    },
}

ENRICHMENT_STATUSES = {"ok", "mixed", "insufficient_evidence", "junk"}
GENERIC_NAME_PHRASES = {
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
GENERIC_EVIDENCE_TOKENS = {
    "about",
    "broad",
    "cluster",
    "conversation",
    "discussion",
    "event",
    "general",
    "mixed",
    "miscellaneous",
    "online",
    "posts",
    "recent",
    "social",
    "topic",
    "trend",
}
VISIBLE_TITLE_NARRATIVE_HINT_TOKENS = {
    "attention",
    "appeals",
    "backlash",
    "campaign",
    "catchphrase",
    "clip",
    "controversy",
    "debate",
    "deepfake",
    "discourse",
    "escalation",
    "fan",
    "fallout",
    "fundraising",
    "inflows",
    "meme",
    "movie",
    "policy",
    "reposts",
    "protests",
    "reactions",
    "response",
    "responses",
    "rhetoric",
    "rumor",
    "rumors",
    "speculation",
    "tariffs",
    "trial",
}
TITLE_WRITER_IDENTITY = "backend.main:trend_title_generation"
TITLE_WRITER_ROLE = "authoritative_title_worker"
ENRICHMENT_WRITER_IDENTITY = "backend.main:trend_enrichment"
ENRICHMENT_WRITER_ROLE = "authoritative_enrichment_worker"
AUTHORITATIVE_TREND_TITLE_TARGET = 250
CAUSAL_LANGUAGE_TOKENS = {
    "amid",
    "because",
    "caused",
    "causing",
    "driven",
    "following",
    "after",
    "response",
    "reacting",
    "reactions",
    "due",
}
COMPOUND_CANONICAL_SEPARATOR_PATTERN = re.compile(r"\s(?:&|/)\s|,\s*|\s+and\s+", re.IGNORECASE)
TRAILING_GENERIC_CANONICAL_TOKENS = {
    "chatter",
    "cluster",
    "clusters",
    "conversation",
    "conversations",
    "discussion",
    "discussions",
    "mention",
    "mentions",
    "post",
    "posts",
    "talk",
    "topic",
    "topics",
    "trend",
    "trends",
    "update",
    "updates",
}
SIGIL_STRIP_PATTERN = re.compile(r"^[#$]+")

STOPWORD_TOKENS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "have",
    "i",
    "if",
    "in",
    "is",
    "it",
    "its",
    "of",
    "on",
    "or",
    "that",
    "the",
    "their",
    "there",
    "this",
    "to",
    "was",
    "we",
    "with",
    "you",
}

TOKEN_PATTERN = re.compile(r"[a-z0-9$#][a-z0-9$#'_-]{1,63}")
URL_PATTERN = re.compile(r"https?://\S+", re.IGNORECASE)
WHITESPACE_PATTERN = re.compile(r"\s+")
VISIBLE_TITLE_FRAGMENT_PATTERN = re.compile(r"(?:apital|eneral|etting|hased|arket|tion|ment|ally|ized)$")


@dataclass(frozen=True)
class TrendEnrichmentRuntimeConfig:
    enabled: bool
    openai_api_key: str
    model_name: str
    prompt_version: str
    interval_seconds: float
    max_topics: int
    max_topics_per_pass: int
    max_duration_seconds: float
    representative_posts: int
    candidate_post_limit: int
    stale_after_hours: float
    request_timeout_seconds: float
    max_retries: int
    retry_backoff_seconds: float
    hash_change_cooldown_hours: float
    max_post_chars: int
    enforce_min_text_chars: int
    enforce_min_word_count: int
    min_unique_authors: int
    min_unique_posts: int
    min_coherence_score: float
    mixed_coherence_score: float
    max_top_author_share: float
    simulated_delay_seconds: float


@dataclass(frozen=True)
class TrendTitleGenerationRuntimeConfig:
    enabled: bool
    openai_api_key: str
    model_name: str
    prompt_version: str
    interval_seconds: float
    max_topics: int
    max_topics_per_pass: int
    max_duration_seconds: float
    representative_posts: int
    candidate_post_limit: int
    stale_after_hours: float
    request_timeout_seconds: float
    max_retries: int
    retry_backoff_seconds: float
    retry_after_minutes: float
    hash_change_cooldown_hours: float
    parallelism: int
    max_post_chars: int
    enforce_min_text_chars: int
    enforce_min_word_count: int
    min_unique_authors: int
    min_unique_posts: int
    min_coherence_score: float
    mixed_coherence_score: float
    max_top_author_share: float


class OpenAIEnrichmentTransportError(RuntimeError):
    pass


class OpenAIEnrichmentOutputError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        raw_response_text: str | None = None,
        validator_errors: list[str] | None = None,
    ) -> None:
        super().__init__(message)
        self.raw_response_text = str(raw_response_text or "")
        self.validator_errors = list(validator_errors or [])


def _resolve_writer_deployment_id() -> str:
    for candidate in (
        os.getenv("BLUESKY_TREND_DEPLOYMENT_ID", ""),
        os.getenv("DEPLOYMENT_ID", ""),
        os.getenv("RAILWAY_DEPLOYMENT_ID", ""),
        os.getenv("RAILWAY_SERVICE_ID", ""),
        os.getenv("RENDER_SERVICE_ID", ""),
        os.getenv("VERCEL_URL", ""),
    ):
        normalized = str(candidate or "").strip()
        if normalized:
            return normalized
    return "local"


def _resolve_writer_instance_id() -> str:
    for candidate in (
        os.getenv("BLUESKY_TREND_INSTANCE_ID", ""),
        os.getenv("INSTANCE_ID", ""),
        os.getenv("RAILWAY_REPLICA_ID", ""),
        os.getenv("RENDER_INSTANCE_ID", ""),
        os.getenv("HOSTNAME", ""),
        socket.gethostname(),
    ):
        normalized = str(candidate or "").strip()
        if normalized:
            return normalized
    return "unknown-instance"


def _resolve_writer_code_version() -> str | None:
    for candidate in (
        os.getenv("BLUESKY_TREND_CODE_VERSION", ""),
        os.getenv("SOURCE_VERSION", ""),
        os.getenv("GIT_SHA", ""),
        os.getenv("RAILWAY_GIT_COMMIT_SHA", ""),
        os.getenv("RENDER_GIT_COMMIT", ""),
        os.getenv("VERCEL_GIT_COMMIT_SHA", ""),
    ):
        normalized = str(candidate or "").strip()
        if normalized:
            return normalized
    return None


def _summarize_persistence_delta(
    *,
    existing_state: dict[str, Any] | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if not existing_state:
        return {
            "hasMeaningfulChange": True,
            "changedFields": ["missing_existing_state"],
            "stateChangeKind": "initial_write",
            "replacedExistingTitle": False,
            "isIdenticalAuthoritativeTitle": False,
        }

    changed_fields: list[str] = []
    comparison_fields = (
        ("canonical_name", "canonical_name"),
        ("fallback_label", "fallback_label"),
        ("name_status", "name_status"),
        ("name_source", "name_source"),
        ("status", "status"),
        ("input_hash", "input_hash"),
        ("prompt_version", "prompt_version"),
        ("model_name", "model_name"),
        ("writer_identity", "writer_identity"),
    )
    for payload_key, existing_key in comparison_fields:
        payload_value = str(payload.get(payload_key) or "").strip()
        existing_value = str(existing_state.get(existing_key) or "").strip()
        if payload_value != existing_value:
            changed_fields.append(payload_key)

    existing_canonical = str(existing_state.get("canonical_name") or "").strip()
    incoming_canonical = str(payload.get("canonical_name") or "").strip()
    replaced_existing_title = bool(
        existing_canonical
        and incoming_canonical
        and existing_canonical != incoming_canonical
    )
    is_identical_authoritative_title = bool(
        existing_canonical
        and incoming_canonical
        and existing_canonical == incoming_canonical
        and str(existing_state.get("name_status") or "").strip().lower() == "ready"
        and str(existing_state.get("writer_identity") or "").strip() == str(payload.get("writer_identity") or "").strip()
    )
    if not changed_fields:
        state_change_kind = "no_meaningful_change"
    elif replaced_existing_title:
        state_change_kind = "replaced_existing_title"
    elif "canonical_name" in changed_fields:
        state_change_kind = "title_changed"
    elif "name_status" in changed_fields or "name_source" in changed_fields:
        state_change_kind = "state_changed"
    else:
        state_change_kind = "metadata_changed"

    return {
        "hasMeaningfulChange": bool(changed_fields),
        "changedFields": changed_fields,
        "stateChangeKind": state_change_kind,
        "replacedExistingTitle": replaced_existing_title,
        "isIdenticalAuthoritativeTitle": is_identical_authoritative_title,
    }


def _parse_bool_env(name: str, default: bool) -> bool:
    value = str(os.getenv(name, "")).strip().lower()
    if not value:
        return default
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return default


def _parse_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    value = str(os.getenv(name, "")).strip()
    if not value:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return max(minimum, min(maximum, parsed))


def _parse_float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    value = str(os.getenv(name, "")).strip()
    if not value:
        return default
    try:
        parsed = float(value)
    except ValueError:
        return default
    return max(minimum, min(maximum, parsed))


def build_trend_enrichment_runtime_config_from_env() -> TrendEnrichmentRuntimeConfig:
    default_model_name = (
        str(os.getenv("BLUESKY_TREND_ENRICHMENT_MODEL", "")).strip()
        or str(os.getenv("OPENAI_TREND_MODEL", "gpt-5-mini")).strip()
        or "gpt-5-mini"
    )
    return TrendEnrichmentRuntimeConfig(
        enabled=_parse_bool_env("BLUESKY_TREND_ENRICHMENT_ENABLED", False),
        openai_api_key=str(os.getenv("OPENAI_API_KEY", "")).strip(),
        model_name=default_model_name,
        prompt_version=str(os.getenv("BLUESKY_TREND_ENRICHMENT_PROMPT_VERSION", "v2")).strip() or "v2",
        interval_seconds=_parse_float_env("BLUESKY_TREND_ENRICHMENT_INTERVAL_SECONDS", 3600.0, 30.0, 3600.0),
        max_topics=_parse_int_env("BLUESKY_TREND_ENRICHMENT_MAX_TOPICS", 64, 1, 500),
        max_topics_per_pass=_parse_int_env("BLUESKY_TREND_ENRICHMENT_MAX_TOPICS_PER_PASS", 4, 1, 250),
        max_duration_seconds=_parse_float_env("BLUESKY_TREND_ENRICHMENT_MAX_DURATION_SECONDS", 15.0, 1.0, 300.0),
        representative_posts=_parse_int_env("BLUESKY_TREND_ENRICHMENT_POSTS_PER_TOPIC", 4, 3, 20),
        candidate_post_limit=_parse_int_env("BLUESKY_TREND_ENRICHMENT_CANDIDATE_POST_LIMIT", 24, 20, 400),
        stale_after_hours=_parse_float_env("BLUESKY_TREND_ENRICHMENT_STALE_HOURS", 168.0, 0.5, 336.0),
        request_timeout_seconds=_parse_float_env("BLUESKY_TREND_ENRICHMENT_TIMEOUT_SECONDS", 8.0, 3.0, 120.0),
        max_retries=_parse_int_env("BLUESKY_TREND_ENRICHMENT_MAX_RETRIES", 1, 1, 6),
        retry_backoff_seconds=_parse_float_env("BLUESKY_TREND_ENRICHMENT_RETRY_BACKOFF_SECONDS", 0.6, 0.0, 10.0),
        hash_change_cooldown_hours=_parse_float_env(
            "BLUESKY_TREND_ENRICHMENT_HASH_CHANGE_COOLDOWN_HOURS",
            24.0,
            0.5,
            336.0,
        ),
        max_post_chars=_parse_int_env("BLUESKY_TREND_ENRICHMENT_MAX_POST_CHARS", 160, 120, 600),
        enforce_min_text_chars=_parse_int_env("BLUESKY_TREND_ENRICHMENT_MIN_TEXT_CHARS", 28, 0, 200),
        enforce_min_word_count=_parse_int_env("BLUESKY_TREND_ENRICHMENT_MIN_WORDS", 5, 0, 40),
        min_unique_authors=_parse_int_env("BLUESKY_TREND_ENRICHMENT_MIN_UNIQUE_AUTHORS", 5, 1, 100),
        min_unique_posts=_parse_int_env("BLUESKY_TREND_ENRICHMENT_MIN_UNIQUE_POSTS", 8, 1, 200),
        min_coherence_score=_parse_float_env("BLUESKY_TREND_ENRICHMENT_MIN_COHERENCE", 0.18, 0.0, 1.0),
        mixed_coherence_score=_parse_float_env("BLUESKY_TREND_ENRICHMENT_MIXED_COHERENCE", 0.10, 0.0, 1.0),
        max_top_author_share=_parse_float_env("BLUESKY_TREND_ENRICHMENT_MAX_TOP_AUTHOR_SHARE", 0.35, 0.05, 1.0),
        simulated_delay_seconds=_parse_float_env(
            "BLUESKY_TREND_ENRICHMENT_SIMULATED_DELAY_SECONDS",
            0.0,
            0.0,
            30.0,
        ),
    )


def build_trend_title_generation_runtime_config_from_env() -> TrendTitleGenerationRuntimeConfig:
    default_model_name = (
        str(os.getenv("BLUESKY_TREND_TITLE_MODEL", "")).strip()
        or str(os.getenv("OPENAI_TREND_GROUPING_MODEL", "")).strip()
        or str(os.getenv("BLUESKY_TREND_ENRICHMENT_MODEL", "")).strip()
        or str(os.getenv("OPENAI_TREND_MODEL", "gpt-5-mini")).strip()
        or "gpt-5-mini"
    )
    return TrendTitleGenerationRuntimeConfig(
        enabled=_parse_bool_env("BLUESKY_TREND_TITLE_ENABLED", True),
        openai_api_key=str(os.getenv("OPENAI_API_KEY", "")).strip(),
        model_name=default_model_name,
        prompt_version=(
            str(os.getenv("BLUESKY_TREND_TITLE_PROMPT_VERSION", "")).strip()
            or str(os.getenv("BLUESKY_TREND_ENRICHMENT_PROMPT_VERSION", "")).strip()
            or "visible-title-v4-memecoin"
        ),
        interval_seconds=_parse_float_env("BLUESKY_TREND_TITLE_INTERVAL_SECONDS", 600.0, 30.0, 3600.0),
        max_topics=_parse_int_env(
            "BLUESKY_TREND_TITLE_MAX_TOPICS",
            AUTHORITATIVE_TREND_TITLE_TARGET,
            AUTHORITATIVE_TREND_TITLE_TARGET,
            AUTHORITATIVE_TREND_TITLE_TARGET,
        ),
        max_topics_per_pass=_parse_int_env(
            "BLUESKY_TREND_TITLE_MAX_TOPICS_PER_PASS",
            AUTHORITATIVE_TREND_TITLE_TARGET,
            AUTHORITATIVE_TREND_TITLE_TARGET,
            AUTHORITATIVE_TREND_TITLE_TARGET,
        ),
        max_duration_seconds=_parse_float_env("BLUESKY_TREND_TITLE_MAX_DURATION_SECONDS", 120.0, 15.0, 300.0),
        representative_posts=_parse_int_env("BLUESKY_TREND_TITLE_POSTS_PER_TOPIC", 3, 2, 12),
        candidate_post_limit=_parse_int_env("BLUESKY_TREND_TITLE_CANDIDATE_POST_LIMIT", 12, 8, 160),
        stale_after_hours=_parse_float_env("BLUESKY_TREND_TITLE_STALE_HOURS", 168.0, 0.5, 336.0),
        request_timeout_seconds=_parse_float_env("BLUESKY_TREND_TITLE_TIMEOUT_SECONDS", 6.0, 2.0, 30.0),
        max_retries=_parse_int_env("BLUESKY_TREND_TITLE_MAX_RETRIES", 1, 1, 4),
        retry_backoff_seconds=_parse_float_env("BLUESKY_TREND_TITLE_RETRY_BACKOFF_SECONDS", 0.4, 0.0, 5.0),
        retry_after_minutes=_parse_float_env("BLUESKY_TREND_TITLE_RETRY_AFTER_MINUTES", 180.0, 1.0, 720.0),
        hash_change_cooldown_hours=_parse_float_env(
            "BLUESKY_TREND_TITLE_HASH_CHANGE_COOLDOWN_HOURS",
            12.0,
            0.5,
            336.0,
        ),
        parallelism=_parse_int_env("BLUESKY_TREND_TITLE_PARALLELISM", 2, 1, 8),
        max_post_chars=_parse_int_env("BLUESKY_TREND_TITLE_MAX_POST_CHARS", 120, 80, 320),
        enforce_min_text_chars=_parse_int_env("BLUESKY_TREND_TITLE_MIN_TEXT_CHARS", 20, 0, 120),
        enforce_min_word_count=_parse_int_env("BLUESKY_TREND_TITLE_MIN_WORDS", 4, 0, 24),
        min_unique_authors=_parse_int_env("BLUESKY_TREND_TITLE_MIN_UNIQUE_AUTHORS", 2, 1, 100),
        min_unique_posts=_parse_int_env("BLUESKY_TREND_TITLE_MIN_UNIQUE_POSTS", 3, 1, 200),
        min_coherence_score=_parse_float_env("BLUESKY_TREND_TITLE_MIN_COHERENCE", 0.1, 0.0, 1.0),
        mixed_coherence_score=_parse_float_env("BLUESKY_TREND_TITLE_MIXED_COHERENCE", 0.06, 0.0, 1.0),
        max_top_author_share=_parse_float_env("BLUESKY_TREND_TITLE_MAX_TOP_AUTHOR_SHARE", 0.45, 0.05, 1.0),
    )


def _to_utc_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    candidate = str(value or "").strip()
    if not candidate:
        return None
    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except Exception:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _normalize_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = URL_PATTERN.sub(" ", text)
    text = WHITESPACE_PATTERN.sub(" ", text)
    return text.strip()


def _normalize_identity(value: Any) -> str:
    text = SIGIL_STRIP_PATTERN.sub("", _normalize_text(value).lower())
    return re.sub(r"[^a-z0-9]+", "", text)


def _truncate_text(value: str, max_chars: int) -> str:
    if len(value) <= max_chars:
        return value
    return value[: max_chars - 1].rstrip() + "..."


def _tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for match in TOKEN_PATTERN.findall(text.lower()):
        token = str(match or "").strip("._-")
        if not token:
            continue
        if token in STOPWORD_TOKENS:
            continue
        if token.isdigit():
            continue
        tokens.append(token)
    return tokens


def _jaccard_similarity(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    union = left | right
    if not union:
        return 0.0
    return len(left & right) / len(union)


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _safe_float(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _trim_optional_text(value: Any, *, limit: int) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    return text[:limit]


def _dedupe_text_list(values: Iterable[Any], *, limit: int, item_limit: int = 120) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        lowered = text.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        output.append(text[:item_limit])
        if len(output) >= limit:
            break
    return output


def _engagement_score(row: dict[str, Any]) -> float:
    return (
        _safe_int(row.get("like_count")) * 1.0
        + _safe_int(row.get("repost_count")) * 3.0
        + _safe_int(row.get("reply_count")) * 2.5
        + _safe_int(row.get("quote_count")) * 3.5
        + max(0.0, _safe_float(row.get("quality_score")) * 12.0)
    )


def _row_id(row: dict[str, Any]) -> str:
    source_post_id = str(row.get("source_post_id") or "").strip()
    if source_post_id:
        return source_post_id
    raw_post_id = row.get("raw_post_id")
    if raw_post_id is not None:
        return f"raw:{raw_post_id}"
    processed_post_id = row.get("processed_post_id")
    if processed_post_id is not None:
        return f"processed:{processed_post_id}"
    return hashlib.sha1(str(row).encode("utf-8")).hexdigest()[:16]

def _prepare_candidates(
    rows: Iterable[dict[str, Any]],
    *,
    max_post_chars: int,
    min_text_chars: int,
    min_word_count: int,
) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for row in rows:
        text = _normalize_text(row.get("text_content"))
        if not text:
            continue
        words = text.split()
        token_list = _tokenize(text)
        prepared.append(
            {
                **row,
                "candidate_id": _row_id(row),
                "normalized_text": text,
                "truncated_text": _truncate_text(text, max_post_chars),
                "token_list": token_list,
                "token_set": set(token_list),
                "word_count": len(words),
                "char_count": len(text),
                "engagement_score": _engagement_score(row),
                "event_dt": _to_utc_datetime(row.get("event_timestamp")),
                "is_short": len(text) < min_text_chars or len(words) < min_word_count,
            }
        )
    return prepared


def _dedupe_candidates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []

    ranked = sorted(
        rows,
        key=lambda row: (
            row["engagement_score"],
            _safe_float(row.get("quality_score")),
            (row.get("event_dt") or datetime.fromtimestamp(0, tz=timezone.utc)).timestamp(),
        ),
        reverse=True,
    )

    exact_seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for row in ranked:
        fingerprint = str(row.get("fingerprint") or "").strip()
        dedupe_key = fingerprint or row.get("normalized_text") or ""
        if not dedupe_key:
            continue
        if dedupe_key in exact_seen:
            continue
        exact_seen.add(dedupe_key)
        deduped.append(row)

    selected: list[dict[str, Any]] = []
    for row in deduped:
        token_set = row.get("token_set") or set()
        near_duplicate = any(
            _jaccard_similarity(token_set, existing.get("token_set") or set()) >= 0.92
            for existing in selected
        )
        if near_duplicate:
            continue
        selected.append(row)

    return selected


def _score_candidate_centrality(rows: list[dict[str, Any]]) -> None:
    token_frequency: dict[str, int] = {}
    for row in rows:
        for token in row.get("token_set") or set():
            token_frequency[token] = token_frequency.get(token, 0) + 1

    for row in rows:
        token_set = row.get("token_set") or set()
        if not token_set:
            row["centrality_score"] = 0.0
            continue
        total = sum(token_frequency.get(token, 0) for token in token_set)
        row["centrality_score"] = total / max(1, len(token_set))


def _coherence_score(rows: list[dict[str, Any]]) -> float:
    if len(rows) <= 1:
        return 0.5
    pairs = 0
    similarity_sum = 0.0
    for left_index in range(len(rows)):
        left_tokens = rows[left_index].get("token_set") or set()
        for right_index in range(left_index + 1, len(rows)):
            right_tokens = rows[right_index].get("token_set") or set()
            similarity_sum += _jaccard_similarity(left_tokens, right_tokens)
            pairs += 1
            if pairs >= 45:
                break
        if pairs >= 45:
            break
    if pairs <= 0:
        return 0.0
    return max(0.0, min(1.0, round(similarity_sum / pairs, 4)))


def select_representative_posts(
    rows: Iterable[dict[str, Any]],
    *,
    limit: int,
    max_post_chars: int,
    min_text_chars: int,
    min_word_count: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    prepared = _prepare_candidates(
        rows,
        max_post_chars=max_post_chars,
        min_text_chars=min_text_chars,
        min_word_count=min_word_count,
    )
    deduped = _dedupe_candidates(prepared)
    if not deduped:
        return [], {
            "candidate_count": 0,
            "deduped_count": 0,
            "coherence_score": 0.0,
            "short_post_ratio": 1.0,
        }

    _score_candidate_centrality(deduped)

    strict_rows = [row for row in deduped if not row.get("is_short")]
    pool = strict_rows if strict_rows else deduped

    latest_ts = max(
        (row.get("event_dt") or datetime.fromtimestamp(0, tz=timezone.utc)).timestamp()
        for row in pool
    )
    earliest_ts = min(
        (row.get("event_dt") or datetime.fromtimestamp(0, tz=timezone.utc)).timestamp()
        for row in pool
    )
    span = max(1.0, latest_ts - earliest_ts)
    for row in pool:
        event_dt = row.get("event_dt") or datetime.fromtimestamp(0, tz=timezone.utc)
        recency_norm = ((event_dt.timestamp() - earliest_ts) / span) if span > 0 else 1.0
        row["recency_score"] = recency_norm
        row["hybrid_score"] = (
            row.get("engagement_score", 0.0) * 0.45
            + row.get("centrality_score", 0.0) * 8.0
            + recency_norm * 8.0
            + _safe_float(row.get("quality_score")) * 5.0
        )

    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()
    selected_author_counts: dict[str, int] = {}
    max_posts_per_author = 2

    def extend_candidates(candidates: list[dict[str, Any]], max_count: int) -> None:
        for candidate in candidates:
            candidate_id = str(candidate.get("candidate_id") or "")
            if not candidate_id or candidate_id in selected_ids:
                continue
            author_id = str(candidate.get("author_id") or "").strip()
            if author_id and selected_author_counts.get(author_id, 0) >= max_posts_per_author:
                continue
            selected.append(candidate)
            selected_ids.add(candidate_id)
            if author_id:
                selected_author_counts[author_id] = selected_author_counts.get(author_id, 0) + 1
            if len(selected) >= max_count:
                return

    engagement_quota = min(limit, 4)
    recency_quota = min(limit, 3)
    centrality_quota = min(limit, 3)

    extend_candidates(
        sorted(pool, key=lambda row: row.get("engagement_score", 0.0), reverse=True),
        engagement_quota,
    )
    extend_candidates(
        sorted(pool, key=lambda row: row.get("event_dt") or datetime.fromtimestamp(0, tz=timezone.utc), reverse=True),
        max(len(selected), engagement_quota) + recency_quota,
    )
    extend_candidates(
        sorted(pool, key=lambda row: row.get("centrality_score", 0.0), reverse=True),
        max(len(selected), engagement_quota + recency_quota) + centrality_quota,
    )
    extend_candidates(
        sorted(pool, key=lambda row: row.get("hybrid_score", 0.0), reverse=True),
        limit,
    )

    final_rows = selected[:limit]
    coherence = _coherence_score(final_rows)
    short_ratio = (
        sum(1 for row in final_rows if row.get("is_short")) / max(1, len(final_rows))
    )
    author_counts: dict[str, int] = {}
    for row in deduped:
        author_id = str(row.get("author_id") or "").strip()
        if not author_id:
            continue
        author_counts[author_id] = author_counts.get(author_id, 0) + 1
    unique_author_count = len(author_counts)
    top_author_post_count = max(author_counts.values()) if author_counts else 0
    top_author_share = (
        round(top_author_post_count / max(1, len(deduped)), 4)
        if deduped
        else 0.0
    )

    return final_rows, {
        "candidate_count": len(prepared),
        "deduped_count": len(deduped),
        "pool_count": len(pool),
        "strict_pool_count": len(strict_rows),
        "coherence_score": coherence,
        "short_post_ratio": round(short_ratio, 4),
        "unique_author_count": unique_author_count,
        "top_author_post_count": top_author_post_count,
        "top_author_share": top_author_share,
    }


def _json_dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)


def build_enrichment_input_hash(
    *,
    topic_row: dict[str, Any],
    representative_posts: list[dict[str, Any]],
) -> str:
    # Hash only stable evidence so small metric churn does not trigger
    # unnecessary re-enrichment when the visible topic name is still supported.
    payload = {
        "topic_key": str(topic_row.get("topic_key") or "").strip(),
        "raw_label": str(topic_row.get("topic_label") or topic_row.get("topic_key") or "").strip(),
        "posts": sorted(
            [
                {
                    "id": str(post.get("source_post_id") or post.get("candidate_id") or "").strip(),
                    "text": _normalize_text(post.get("truncated_text") or "")[:220],
                    "platform": str(post.get("platform") or "bluesky").strip().lower() or "bluesky",
                }
                for post in representative_posts
            ],
            key=lambda value: (
                str(value.get("id") or ""),
                str(value.get("platform") or ""),
                str(value.get("text") or ""),
            ),
        ),
    }
    return hashlib.sha256(_json_dumps(payload).encode("utf-8")).hexdigest()


def _summarize_prompt_input(
    *,
    topic_row: dict[str, Any],
    representative_posts: list[dict[str, Any]],
    cluster_diagnostics: dict[str, Any],
) -> dict[str, Any]:
    total_mentions = _safe_int(topic_row.get("total_mentions"))
    unique_posts = _safe_int(topic_row.get("unique_posts"))
    unique_authors = _safe_int(topic_row.get("unique_authors"))
    positive = _safe_int(topic_row.get("positive_count"))
    neutral = _safe_int(topic_row.get("neutral_count"))
    negative = _safe_int(topic_row.get("negative_count"))
    sentiment_total = max(1, positive + neutral + negative)
    sentiment_balance = round((positive - negative) / sentiment_total, 4)

    posts_payload = []
    for post in representative_posts:
        event_dt = post.get("event_dt")
        posts_payload.append(
            {
                "id": str(post.get("candidate_id") or ""),
                "source_post_id": str(post.get("source_post_id") or ""),
                "platform": str(post.get("platform") or "bluesky"),
                "event_timestamp": event_dt.isoformat() if isinstance(event_dt, datetime) else None,
                "engagement_score": round(_safe_float(post.get("engagement_score")), 3),
                "text": str(post.get("truncated_text") or ""),
            }
        )

    evidence_post_ids = [
        str(post.get("source_post_id") or post.get("candidate_id") or "").strip()
        for post in representative_posts
        if str(post.get("source_post_id") or post.get("candidate_id") or "").strip()
    ]

    return {
        "trend": {
            "topic_key": str(topic_row.get("topic_key") or "").strip(),
            "raw_label": str(topic_row.get("topic_label") or topic_row.get("topic_key") or "").strip(),
            "window_end": str(topic_row.get("window_end") or ""),
            "stats": {
                "total_mentions": total_mentions,
                "unique_posts": unique_posts,
                "unique_authors": unique_authors,
                "platform_count": _safe_int(topic_row.get("platform_count")),
                "positive_count": positive,
                "neutral_count": neutral,
                "negative_count": negative,
                "sentiment_balance": sentiment_balance,
            },
        },
        "cluster_diagnostics": {
            "coherence_score": round(_safe_float(cluster_diagnostics.get("coherence_score")), 4),
            "unique_author_count": _safe_int(cluster_diagnostics.get("unique_author_count")),
            "top_author_share": round(_safe_float(cluster_diagnostics.get("top_author_share")), 4),
            "short_post_ratio": round(_safe_float(cluster_diagnostics.get("short_post_ratio")), 4),
            "candidate_count": _safe_int(cluster_diagnostics.get("candidate_count")),
            "deduped_count": _safe_int(cluster_diagnostics.get("deduped_count")),
        },
        "posts": posts_payload,
        "allowed_evidence_post_ids": evidence_post_ids,
        "instructions": {
            "workflow": [
                "Decide status first: ok, mixed, insufficient_evidence, or junk.",
                "Prefer abstention over false specificity.",
                "Use only the supplied posts and diagnostics.",
                "Do not invent causes, significance, timelines, or repaired entities.",
                "If status is not ok, canonical_name may be null and why_attention must be null.",
                "canonical_name must name one dominant narrative only.",
                "Never join topics with &, and, /, commas, or stacked labels unless the exact combined phrase is directly supported by the evidence as a real narrative.",
                "If status is mixed, still choose the single strongest narrative center for canonical_name and describe the ambiguity in summary or mixed_signals.",
                "Choose the dominant narrative using strongest post share first, then keyword recurrence, then semantic center, then engagement concentration as a tiebreaker.",
                "Only include evidence_post_ids from allowed_evidence_post_ids.",
                "summary should be short and grounded in the supplied evidence.",
                "why_attention is optional and only allowed when directly supported by the posts.",
            ],
        },
    }

def _extract_json_object(text: str) -> dict[str, Any]:
    candidate = str(text or "").strip()
    if not candidate:
        raise ValueError("OpenAI response was empty")
    if candidate.startswith("```"):
        candidate = candidate.strip("`")
        candidate = candidate.replace("json\n", "", 1).strip()
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start < 0 or end <= start:
            raise
        parsed = json.loads(candidate[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("OpenAI payload was not a JSON object")
    return parsed


def _validate_openai_enrichment_payload(payload: dict[str, Any]) -> dict[str, Any]:
    status = str(payload.get("status") or "").strip().lower()
    if status not in ENRICHMENT_STATUSES:
        raise ValueError("status missing or invalid in OpenAI payload")

    canonical_name = _trim_optional_text(payload.get("canonical_name"), limit=140)
    summary = _trim_optional_text(payload.get("summary"), limit=520)
    why_attention = _trim_optional_text(payload.get("why_attention"), limit=280)
    abstain_reason = _trim_optional_text(payload.get("abstain_reason"), limit=240)
    evidence_post_ids = _dedupe_text_list(
        payload.get("evidence_post_ids") if isinstance(payload.get("evidence_post_ids"), list) else [],
        limit=12,
        item_limit=80,
    )
    evidence_entities = _dedupe_text_list(
        payload.get("evidence_entities") if isinstance(payload.get("evidence_entities"), list) else [],
        limit=12,
        item_limit=80,
    )
    mixed_signals = _dedupe_text_list(
        payload.get("mixed_signals") if isinstance(payload.get("mixed_signals"), list) else [],
        limit=8,
        item_limit=140,
    )

    confidence = _safe_float(payload.get("confidence"))
    confidence = max(0.0, min(1.0, confidence))

    if status == "ok":
        if not canonical_name:
            raise ValueError("canonical_name missing for ok cluster")
        if not summary:
            raise ValueError("summary missing for ok cluster")
        if not evidence_post_ids:
            raise ValueError("evidence_post_ids missing for ok cluster")
    if status == "mixed" and not summary:
        raise ValueError("summary missing for mixed cluster")
    if status != "ok" and why_attention:
        raise ValueError("why_attention must be null when status is not ok")
    if status != "ok" and not abstain_reason:
        raise ValueError("abstain_reason missing for non-ok cluster")

    return {
        "status": status,
        "canonical_name": canonical_name,
        "summary": summary,
        "why_attention": why_attention,
        "confidence": confidence,
        "evidence_post_ids": evidence_post_ids,
        "evidence_entities": evidence_entities,
        "mixed_signals": mixed_signals,
        "abstain_reason": abstain_reason,
    }


def _validate_openai_title_payload(payload: dict[str, Any]) -> dict[str, Any]:
    status = str(payload.get("status") or "").strip().lower()
    if status not in ENRICHMENT_STATUSES:
        raise ValueError("status missing or invalid in OpenAI title payload")

    canonical_name = _trim_optional_text(payload.get("canonical_name"), limit=140)
    abstain_reason = _trim_optional_text(payload.get("abstain_reason"), limit=240)
    evidence_post_ids = _dedupe_text_list(
        payload.get("evidence_post_ids") if isinstance(payload.get("evidence_post_ids"), list) else [],
        limit=12,
        item_limit=80,
    )
    evidence_entities = _dedupe_text_list(
        payload.get("evidence_entities") if isinstance(payload.get("evidence_entities"), list) else [],
        limit=12,
        item_limit=80,
    )
    mixed_signals = _dedupe_text_list(
        payload.get("mixed_signals") if isinstance(payload.get("mixed_signals"), list) else [],
        limit=8,
        item_limit=140,
    )

    confidence = _safe_float(payload.get("confidence"))
    confidence = max(0.0, min(1.0, confidence))

    if status == "ok" and not canonical_name:
        raise ValueError("canonical_name missing for ok title payload")
    if status != "ok" and not abstain_reason and not canonical_name:
        raise ValueError("abstain_reason missing for non-ok title payload")

    summary = (
        _safe_sentence(f"Posts are discussing {canonical_name.lower()}.")[:520]
        if canonical_name
        else (_safe_sentence(abstain_reason)[:520] if abstain_reason else None)
    )

    return {
        "status": status,
        "canonical_name": canonical_name,
        "summary": summary,
        "why_attention": None,
        "confidence": confidence,
        "evidence_post_ids": evidence_post_ids,
        "evidence_entities": evidence_entities,
        "mixed_signals": mixed_signals,
        "abstain_reason": abstain_reason,
    }


def _significant_tokens(text: str) -> list[str]:
    return [
        token
        for token in _tokenize(text)
        if len(token) >= 3 and token not in GENERIC_EVIDENCE_TOKENS
    ]


def _build_evidence_context(representative_posts: list[dict[str, Any]]) -> tuple[str, set[str], set[str]]:
    evidence_text_parts: list[str] = []
    evidence_tokens: set[str] = set()
    allowed_ids: set[str] = set()
    for post in representative_posts:
        text = _normalize_text(post.get("truncated_text") or post.get("text_content"))
        if text:
            evidence_text_parts.append(text.lower())
            evidence_tokens.update(_tokenize(text))
        for key in ("source_post_id", "candidate_id"):
            post_id = str(post.get(key) or "").strip()
            if post_id:
                allowed_ids.add(post_id)
    return " ".join(evidence_text_parts), evidence_tokens, allowed_ids


def _token_supported_by_evidence(token: str, *, evidence_tokens: set[str]) -> bool:
    normalized = str(token or "").strip().lower()
    if not normalized:
        return False
    if normalized in evidence_tokens:
        return True
    if normalized.endswith("s") and normalized[:-1] in evidence_tokens:
        return True
    if f"{normalized}s" in evidence_tokens:
        return True
    return False


def _phrase_supported_by_evidence(
    phrase: str,
    *,
    evidence_text: str,
    evidence_tokens: set[str],
) -> bool:
    normalized_phrase = _normalize_text(phrase).lower()
    if not normalized_phrase:
        return False
    if normalized_phrase in evidence_text:
        return True
    tokens = _significant_tokens(normalized_phrase)
    if not tokens:
        return False
    if len(tokens) == 1:
        return _token_supported_by_evidence(tokens[0], evidence_tokens=evidence_tokens)
    overlap = sum(
        1
        for token in tokens[:4]
        if _token_supported_by_evidence(token, evidence_tokens=evidence_tokens)
    )
    return (overlap / max(1, min(len(tokens), 4))) >= 0.66


def _normalize_dominant_label_segment(value: Any) -> str | None:
    normalized = _trim_optional_text(_normalize_text(value), limit=140)
    if not normalized:
        return None
    parts = normalized.split()
    while len(parts) > 1 and parts[-1].lower() in TRAILING_GENERIC_CANONICAL_TOKENS:
        parts.pop()
    candidate = _trim_optional_text(" ".join(parts), limit=140)
    return candidate or None


def _split_compound_canonical_name(value: Any) -> list[str]:
    normalized = _normalize_text(value)
    if not normalized:
        return []
    segments = [
        _normalize_dominant_label_segment(segment)
        for segment in COMPOUND_CANONICAL_SEPARATOR_PATTERN.split(normalized)
    ]
    return _dedupe_text_list(
        [segment for segment in segments if segment],
        limit=8,
        item_limit=120,
    )


def _compound_phrase_is_established_in_evidence(
    phrase: str,
    representative_posts: list[dict[str, Any]],
) -> bool:
    normalized_phrase = _normalize_text(phrase).lower()
    if not normalized_phrase:
        return False
    for post in representative_posts:
        post_text = _normalize_text(post.get("truncated_text") or post.get("text_content")).lower()
        if normalized_phrase and normalized_phrase in post_text:
            return True
    return False


def _looks_like_compound_canonical_name(
    name: str | None,
    representative_posts: list[dict[str, Any]],
) -> bool:
    normalized = _normalize_text(name)
    if not normalized or not COMPOUND_CANONICAL_SEPARATOR_PATTERN.search(normalized):
        return False
    segments = _split_compound_canonical_name(normalized)
    if len(segments) < 2:
        return False
    if _compound_phrase_is_established_in_evidence(normalized, representative_posts):
        return False
    return True


def _score_dominant_canonical_candidate(
    candidate: str,
    *,
    raw_label: str,
    representative_posts: list[dict[str, Any]],
) -> tuple[int, int, int, float, str, str] | None:
    normalized = _normalize_dominant_label_segment(candidate)
    if not normalized or _is_generic_canonical_name(normalized):
        return None
    tokens = _significant_tokens(normalized.lower())
    if not tokens:
        return None

    normalized_phrase = _normalize_text(normalized).lower()
    raw_label_tokens = set(_significant_tokens(_normalize_text(raw_label).lower()))
    supporting_post_count = 0
    recurrence = 0
    semantic_center = 0
    engagement = 0.0

    for post in representative_posts:
        post_text = _normalize_text(post.get("truncated_text") or post.get("text_content"))
        post_tokens = set(_tokenize(post_text))
        exact_phrase_match = bool(normalized_phrase and normalized_phrase in post_text.lower())
        matched_tokens = sum(
            1 for token in tokens if _token_supported_by_evidence(token, evidence_tokens=post_tokens)
        )
        if exact_phrase_match or (matched_tokens / max(1, len(tokens))) >= 0.6:
            supporting_post_count += 1
            engagement += _safe_float(post.get("engagement_score"))
        recurrence += matched_tokens
        if exact_phrase_match:
            semantic_center += 2

    semantic_center += sum(1 for token in tokens if token in raw_label_tokens)

    evidence_text, evidence_tokens, _ = _build_evidence_context(representative_posts)
    if supporting_post_count == 0 or not _phrase_supported_by_evidence(
        normalized,
        evidence_text=evidence_text,
        evidence_tokens=evidence_tokens,
    ):
        return None

    return (
        supporting_post_count,
        recurrence,
        semantic_center,
        engagement,
        normalized.lower(),
        normalized,
    )


def _infer_dominant_canonical_name(
    *,
    raw_label: str,
    representative_posts: list[dict[str, Any]],
    candidates: Iterable[Any],
) -> str | None:
    normalized_candidates: list[str] = []
    for candidate in candidates:
        normalized = _normalize_text(candidate)
        if not normalized:
            continue
        if _looks_like_compound_canonical_name(normalized, representative_posts):
            normalized_candidates.extend(_split_compound_canonical_name(normalized))
        else:
            segment = _normalize_dominant_label_segment(normalized)
            if segment:
                normalized_candidates.append(segment)

    deduped_candidates = _dedupe_text_list(normalized_candidates, limit=16, item_limit=120)
    scores = [
        score
        for score in (
            _score_dominant_canonical_candidate(
                candidate,
                raw_label=raw_label,
                representative_posts=representative_posts,
            )
            for candidate in deduped_candidates
        )
        if score
    ]
    if not scores:
        return None

    scores.sort(key=lambda item: (-item[0], -item[1], -item[2], -item[3], item[4]))
    return scores[0][5]


def _rewrite_compound_canonical_name(
    *,
    structured_output: dict[str, Any],
    raw_label: str,
    representative_posts: list[dict[str, Any]],
) -> dict[str, Any]:
    canonical_name = _trim_optional_text(structured_output.get("canonical_name"), limit=140)
    if not canonical_name or not _looks_like_compound_canonical_name(canonical_name, representative_posts):
        return structured_output

    dominant_name = _infer_dominant_canonical_name(
        raw_label=raw_label,
        representative_posts=representative_posts,
        candidates=[
            canonical_name,
            raw_label,
            *(structured_output.get("evidence_entities") or []),
        ],
    )
    mixed_signals = structured_output.get("mixed_signals") if isinstance(structured_output.get("mixed_signals"), list) else []
    if not dominant_name:
        return {
            **structured_output,
            "mixed_signals": _dedupe_text_list(
                [*mixed_signals, "compound_canonical_name_unresolved"],
                limit=8,
                item_limit=120,
            ),
        }

    return {
        **structured_output,
        "canonical_name": dominant_name,
        "mixed_signals": _dedupe_text_list(
            [*mixed_signals, "rewrote_compound_canonical_name"],
            limit=8,
            item_limit=120,
        ),
    }


def _summary_supported_by_evidence(
    text: str,
    *,
    evidence_tokens: set[str],
) -> bool:
    tokens = _significant_tokens(text)
    if not tokens:
        return False
    overlap = sum(
        1
        for token in tokens
        if _token_supported_by_evidence(token, evidence_tokens=evidence_tokens)
    )
    return (overlap / max(1, len(tokens))) >= 0.4


def _is_generic_canonical_name(name: str) -> bool:
    normalized = " ".join(_tokenize(name))
    if not normalized:
        return True
    if normalized in GENERIC_NAME_PHRASES:
        return True
    tokens = normalized.split()
    generic_token_count = sum(1 for token in tokens if token in GENERIC_EVIDENCE_TOKENS)
    return generic_token_count >= max(2, len(tokens))


def _is_low_quality_visible_title_name(name: str) -> bool:
    normalized = _normalize_text(name)
    if not normalized:
        return True
    lowered = normalized.lower()
    compact = re.sub(r"[^a-z0-9]+", "", lowered)
    tokens = [token for token in _tokenize(lowered) if token]
    if not tokens:
        return True
    if _is_generic_canonical_name(normalized):
        return True
    if VISIBLE_TITLE_FRAGMENT_PATTERN.search(compact):
        return True
    if len(tokens) == 1 and tokens[0] not in VISIBLE_TITLE_NARRATIVE_HINT_TOKENS:
        return True
    return False


def _is_authoritative_title_state(existing_state: dict[str, Any] | None) -> bool:
    if not existing_state:
        return False
    writer_identity = str(existing_state.get("writer_identity") or "").strip()
    return writer_identity in {TITLE_WRITER_IDENTITY, ENRICHMENT_WRITER_IDENTITY}


def _extract_capitalized_evidence_phrases(representative_posts: list[dict[str, Any]]) -> list[str]:
    phrases: list[str] = []
    pattern = re.compile(r"\b(?:[A-Z][a-z0-9]+(?:['’-][A-Z]?[a-z0-9]+)?)(?:\s+(?:[A-Z][a-z0-9]+(?:['’-][A-Z]?[a-z0-9]+)?)){0,2}\b")
    for post in representative_posts:
        text = _normalize_text(post.get("truncated_text") or post.get("text_content"))
        for match in pattern.findall(text):
            phrase = _trim_optional_text(match, limit=120)
            if not phrase:
                continue
            lowered = phrase.lower()
            if lowered in {"hey", "act now"}:
                continue
            phrases.append(phrase)
    return _dedupe_text_list(phrases, limit=24, item_limit=120)


def _detect_heuristic_visible_title_suffix(representative_posts: list[dict[str, Any]]) -> str | None:
    token_counter: Counter[str] = Counter()
    for post in representative_posts:
        text = _normalize_text(post.get("truncated_text") or post.get("text_content"))
        token_counter.update(_tokenize(text))

    token_set = set(token_counter)
    if token_set & {"deepfake", "deepfakes"}:
        if token_set & {"parody", "parodies", "edit", "edits", "repost", "reposts"}:
            return "deepfake scandal driving parody edits"
        return "deepfake meme wave"
    if token_set & {"clip", "clips"}:
        if token_set & {"viral", "repost", "reposts", "timeline"}:
            return "viral clip wave driving reposts"
        if token_set & {"creator", "streamer", "influencer", "fanbase"}:
            return "creator clip wave driving reposts"
    if token_set & {"fan", "fandom", "stan", "stans", "fancam", "anime", "manga"}:
        return "fan edit wave driving meme posts"
    if token_set & {"verification", "verified", "ban", "banned", "outage", "algorithm", "moderation"}:
        return "platform backlash driving creator debate"
    if token_set & {"etf", "bitcoin", "btc", "solana", "memecoin", "launchpad", "pump", "token"}:
        if token_set & {"inflow", "inflows"}:
            return "ETF inflows reviving meme speculation"
        if token_set & {"launch", "launchpad", "rotation"}:
            return "launchpad wave driving meme speculation"
    if token_set & {"animal", "dog", "doge", "cat", "frog", "hippo", "penguin", "mascot"}:
        return "animal meme wave driving reposts"
    if token_set & {"donate", "d0nation", "donation", "donations", "gofundme"}:
        if token_set & {"family", "families", "save", "help"}:
            return "family donation appeals"
        return "donation appeals"
    if token_set & {"movie", "film", "cinema", "trailer"}:
        if token_set & {"review", "reviews", "saw", "seen", "good", "bad", "fans", "fan"}:
            return "movie reactions"
        return "movie speculation"
    if token_set & {"tariff", "tariffs", "trade"}:
        if token_set & {"backlash", "anger", "angry", "voted", "paybacks"}:
            return "tariff backlash"
        return "tariff rhetoric"
    if token_set & {"trial", "juicio", "court", "judge"}:
        if token_set & {"corruption", "scandal"}:
            return "corruption trial"
        return "trial"
    if token_set & {"artemis", "nasa", "lunar", "moon", "mission"}:
        return "lunar mission"
    if token_set & {"easter", "holiday", "greetings"}:
        return "holiday discourse"
    if token_set & {"controversy", "criticized", "criticised"}:
        return "controversy"
    if token_set & {"reaction", "reactions"}:
        return "reactions"
    if token_set & {"speculation", "rumor", "rumors"}:
        return "speculation"
    return None


def _heuristic_suffix_for_memecoin_category(category: str | None) -> str | None:
    normalized = _normalize_text(category).lower()
    return {
        "ai meme wave": "deepfake and parody edits",
        "animal meme": "animal meme wave driving reposts",
        "catchphrase wave": "catchphrase wave driving reposts",
        "creator viral moment": "creator clip wave driving reposts",
        "celebrity meme": "celebrity meme wave driving parody posts",
        "platform drama": "platform backlash and creator debate",
        "fandom wave": "fan edit wave driving meme posts",
        "gaming meme": "gaming meme wave driving clips",
        "crypto spillover": "crypto attention and meme speculation",
        "memeified politics": "meme clip wave driving reposts",
    }.get(normalized)


def _build_heuristic_visible_title_output(
    *,
    raw_label: str,
    representative_posts: list[dict[str, Any]],
    reason_code: str,
) -> dict[str, Any] | None:
    capitalized_phrases = _extract_capitalized_evidence_phrases(representative_posts)
    anchor = _infer_dominant_canonical_name(
        raw_label=raw_label,
        representative_posts=representative_posts,
        candidates=[raw_label, *capitalized_phrases],
    )
    if not anchor:
        anchor = _trim_optional_text(raw_label, limit=140)
    anchor = _trim_optional_text(re.sub(r"^[#$]+", "", str(anchor or "").strip()), limit=140)
    inferred_category = infer_memecoin_trend_category(
        raw_label,
        " ".join(_normalize_text(post.get("truncated_text") or post.get("text_content")) for post in representative_posts),
    )
    suffix = _detect_heuristic_visible_title_suffix(representative_posts) or _heuristic_suffix_for_memecoin_category(
        inferred_category
    )
    if anchor and anchor.lower() in {"youtube", "twitter", "instagram", "reddit", "telegram"}:
        if suffix not in {
            "reactions",
            "controversy",
            "platform backlash driving creator debate",
            "viral clip wave driving reposts",
        }:
            return None
    if suffix:
        suffix_normalized = _normalize_text(suffix)
        if anchor and suffix_normalized.lower() not in _normalize_text(anchor).lower():
            canonical_name = _normalize_text(f"{anchor} {suffix_normalized}")
        else:
            canonical_name = anchor
    else:
        canonical_name = anchor
    if not canonical_name or _is_low_quality_visible_title_name(canonical_name):
        return None

    evidence_post_ids = _dedupe_text_list(
        (
            str(post.get("source_post_id") or post.get("candidate_id") or "").strip()
            for post in representative_posts
        ),
        limit=6,
        item_limit=80,
    )
    evidence_entities = _dedupe_text_list(
        [canonical_name, *capitalized_phrases[:3]],
        limit=6,
        item_limit=120,
    )
    return {
        "status": "ok",
        "canonical_name": canonical_name[:140],
        "summary": _safe_sentence(
            f"Heuristic title fallback named this cluster as {canonical_name.lower()} because the language evidence was consistent enough for a readable board label."
        )[:520],
        "why_attention": None,
        "confidence": 0.34,
        "evidence_post_ids": evidence_post_ids,
        "evidence_entities": evidence_entities,
        "mixed_signals": _dedupe_text_list([reason_code, "heuristic_visible_title"], limit=8, item_limit=120),
        "abstain_reason": None,
        "preferred_name_source": "historical_alias",
    }


def _validate_model_output_against_evidence(
    *,
    model_output: dict[str, Any],
    representative_posts: list[dict[str, Any]],
    cluster_diagnostics: dict[str, Any],
) -> list[str]:
    errors: list[str] = []
    evidence_text, evidence_tokens, allowed_post_ids = _build_evidence_context(representative_posts)

    status = str(model_output.get("status") or "").strip().lower()
    canonical_name = str(model_output.get("canonical_name") or "").strip()
    summary = str(model_output.get("summary") or "").strip()
    why_attention = str(model_output.get("why_attention") or "").strip()
    evidence_post_ids = model_output.get("evidence_post_ids") or []
    evidence_entities = model_output.get("evidence_entities") or []
    abstain_reason = str(model_output.get("abstain_reason") or "").strip()
    confidence = _safe_float(model_output.get("confidence"))
    coherence_score = _safe_float(cluster_diagnostics.get("coherence_score"))

    if status not in ENRICHMENT_STATUSES:
        errors.append("invalid_status")
        return errors

    if status == "ok" and _is_generic_canonical_name(canonical_name):
        errors.append("canonical_name_too_generic")
    if canonical_name and _looks_like_compound_canonical_name(canonical_name, representative_posts):
        errors.append("compound_canonical_name")
    if canonical_name and not _phrase_supported_by_evidence(
        canonical_name,
        evidence_text=evidence_text,
        evidence_tokens=evidence_tokens,
    ):
        errors.append("canonical_name_not_supported_by_evidence")
    if summary and not _summary_supported_by_evidence(summary, evidence_tokens=evidence_tokens):
        errors.append("summary_not_supported_by_evidence")
    if why_attention and not _summary_supported_by_evidence(
        why_attention,
        evidence_tokens=evidence_tokens,
    ):
        errors.append("why_attention_not_supported_by_evidence")
    if why_attention and any(token in CAUSAL_LANGUAGE_TOKENS for token in _tokenize(why_attention)):
        if not _phrase_supported_by_evidence(
            why_attention,
            evidence_text=evidence_text,
            evidence_tokens=evidence_tokens,
        ):
            errors.append("unsupported_causal_claim")

    for evidence_post_id in evidence_post_ids:
        if evidence_post_id not in allowed_post_ids:
            errors.append("evidence_post_ids_outside_supplied_posts")
            break

    for entity in evidence_entities:
        if not _phrase_supported_by_evidence(
            entity,
            evidence_text=evidence_text,
            evidence_tokens=evidence_tokens,
        ):
            errors.append("evidence_entity_not_supported")
            break

    if status != "ok" and why_attention:
        errors.append("why_attention_present_for_non_ok_status")
    if status != "ok" and not abstain_reason:
        errors.append("abstain_reason_missing")
    return _dedupe_text_list(errors, limit=20, item_limit=120)


def _validate_title_output_against_evidence(
    *,
    model_output: dict[str, Any],
    representative_posts: list[dict[str, Any]],
) -> list[str]:
    errors: list[str] = []
    evidence_text, evidence_tokens, allowed_post_ids = _build_evidence_context(representative_posts)

    status = str(model_output.get("status") or "").strip().lower()
    canonical_name = str(model_output.get("canonical_name") or "").strip()
    evidence_post_ids = model_output.get("evidence_post_ids") or []
    evidence_entities = model_output.get("evidence_entities") or []
    abstain_reason = str(model_output.get("abstain_reason") or "").strip()

    if status not in ENRICHMENT_STATUSES:
        errors.append("invalid_status")
        return errors
    if status == "ok" and _is_generic_canonical_name(canonical_name):
        errors.append("canonical_name_too_generic")
    if canonical_name and _is_low_quality_visible_title_name(canonical_name):
        errors.append("canonical_name_not_narrative_enough")
    if canonical_name and _looks_like_compound_canonical_name(canonical_name, representative_posts):
        errors.append("compound_canonical_name")
    if canonical_name and not _phrase_supported_by_evidence(
        canonical_name,
        evidence_text=evidence_text,
        evidence_tokens=evidence_tokens,
    ):
        errors.append("canonical_name_not_supported_by_evidence")

    for evidence_post_id in evidence_post_ids:
        if evidence_post_id not in allowed_post_ids:
            errors.append("evidence_post_ids_outside_supplied_posts")
            break

    for entity in evidence_entities:
        if not _phrase_supported_by_evidence(
            entity,
            evidence_text=evidence_text,
            evidence_tokens=evidence_tokens,
        ):
            errors.append("evidence_entity_not_supported")
            break

    if status != "ok" and not abstain_reason and not canonical_name:
        errors.append("abstain_reason_missing")
    return _dedupe_text_list(errors, limit=20, item_limit=120)


def _safe_sentence(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.endswith((".", "!", "?")):
        return text
    return f"{text}."


def _first_sentence(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.search(r"(?<=[.!?])\s", text)
    if not match:
        return text
    return text[: match.start()].strip()


def _build_legacy_enrichment_fields(
    *,
    structured_output: dict[str, Any],
    raw_label: str,
    topic_key: str,
) -> dict[str, Any]:
    status = str(structured_output.get("status") or "insufficient_evidence").strip().lower()
    canonical_name = _trim_optional_text(structured_output.get("canonical_name"), limit=140)
    raw_label_value = _trim_optional_text(raw_label or topic_key, limit=140)
    if canonical_name and raw_label_value and canonical_name.lower() == raw_label_value.lower():
        canonical_name = None
    summary = _trim_optional_text(structured_output.get("summary"), limit=520)
    why_attention = _trim_optional_text(structured_output.get("why_attention"), limit=280)
    abstain_reason = _trim_optional_text(structured_output.get("abstain_reason"), limit=240)

    narrative_parts: list[str] = []
    if summary:
        narrative_parts.append(_safe_sentence(summary))
    if why_attention:
        narrative_parts.append(_safe_sentence(why_attention))
    if not narrative_parts and abstain_reason:
        narrative_parts.append(_safe_sentence(abstain_reason))
    if not narrative_parts:
        narrative_parts.append("Narrative enrichment abstained because evidence was not reliable enough.")
    narrative_summary = " ".join(part for part in narrative_parts if part).strip()
    short_description = _first_sentence(narrative_summary)[:280] or _safe_sentence(raw_label)[:280]

    inferred_trend_category = infer_memecoin_trend_category(
        canonical_name,
        summary,
        why_attention,
        narrative_summary,
        raw_label,
    )
    trend_category = inferred_trend_category or {
        "mixed": "mixed discussion cluster",
        "insufficient_evidence": "insufficient evidence",
        "junk": "junk cluster",
    }.get(status)

    return {
        "canonical_name": canonical_name,
        "short_description": short_description[:280],
        "context_paragraph": narrative_summary[:900],
        "narrative_summary": narrative_summary[:520],
        "trend_category": trend_category[:80] if trend_category else None,
    }


def _extract_chat_completion_content(response_payload: dict[str, Any]) -> str:
    choices = response_payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("OpenAI response missing choices")
    first = choices[0] if isinstance(choices[0], dict) else {}
    message = first.get("message") if isinstance(first, dict) else {}
    if not isinstance(message, dict):
        raise ValueError("OpenAI response missing message")
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_chunks: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text":
                text_value = str(item.get("text") or "").strip()
                if text_value:
                    text_chunks.append(text_value)
        if text_chunks:
            return "\n".join(text_chunks)
    raise ValueError("OpenAI message content was empty")


def _post_openai_chat_completions(
    *,
    api_key: str,
    timeout_seconds: float,
    request_body: dict[str, Any],
) -> dict[str, Any]:
    payload_bytes = _json_dumps(request_body).encode("utf-8")
    request = urllib_request.Request(
        OPENAI_CHAT_COMPLETIONS_URL,
        data=payload_bytes,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib_request.urlopen(request, timeout=timeout_seconds) as response:
        body = response.read().decode("utf-8", errors="replace")
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise ValueError("OpenAI response was not a JSON object")
    return parsed


def _call_openai_for_enrichment(
    *,
    api_key: str,
    model_name: str,
    prompt_version: str,
    prompt_input: dict[str, Any],
    timeout_seconds: float,
    max_retries: int,
    retry_backoff_seconds: float,
    logger: Any | None = None,
    topic_key: str | None = None,
) -> tuple[dict[str, Any], dict[str, int], str]:
    messages = [
        {"role": "system", "content": OPENAI_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Label this detected trend cluster for production use.\n"
                "Rules:\n"
                "- Determine status first.\n"
                "- Use only provided evidence.\n"
                "- Prefer abstention over false specificity.\n"
                "- If evidence is mixed, say mixed but still choose one dominant narrative for canonical_name.\n"
                "- If evidence is weak, say insufficient_evidence.\n"
                "- Never output a multi-topic mashup in canonical_name.\n"
                "- Do not join topics with &, and, /, or commas unless the exact combined phrase is directly supported by the evidence as a real narrative.\n"
                "- Choose the dominant narrative using strongest post share first, then keyword recurrence, then semantic center, then engagement concentration as a tiebreaker.\n"
                "- Do not invent causes, significance, or repaired topic fragments.\n"
                "- why_attention must be null unless directly supported by the evidence.\n"
                "- Only include evidence_post_ids from allowed_evidence_post_ids.\n"
                f"- Prompt version: {prompt_version}\n\n"
                f"Input JSON:\n{_json_dumps(prompt_input)}"
            ),
        },
    ]
    request_body = {
        "model": model_name,
        "temperature": 0.2,
        "messages": messages,
        "response_format": {
            "type": "json_schema",
            "json_schema": OPENAI_JSON_SCHEMA,
        },
    }

    last_error: Exception | None = None
    last_raw_response_text = ""
    for attempt in range(1, max_retries + 1):
        if logger is not None:
            log_event(
                logger,
                logging.INFO,
                "trend_enrichment_openai_request_started",
                topic_key=topic_key,
                attempt=attempt,
                max_retries=max_retries,
                model_name=model_name,
                timeout_seconds=timeout_seconds,
            )
        try:
            payload = _post_openai_chat_completions(
                api_key=api_key,
                timeout_seconds=timeout_seconds,
                request_body=request_body,
            )
            usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
            usage_summary = {
                "prompt_tokens": _safe_int(usage.get("prompt_tokens")),
                "completion_tokens": _safe_int(usage.get("completion_tokens")),
                "total_tokens": _safe_int(usage.get("total_tokens")),
            }
            if logger is not None:
                log_event(
                    logger,
                    logging.INFO,
                    "trend_enrichment_openai_request_succeeded",
                    topic_key=topic_key,
                    attempt=attempt,
                    prompt_tokens=usage_summary["prompt_tokens"],
                    completion_tokens=usage_summary["completion_tokens"],
                    total_tokens=usage_summary["total_tokens"],
                )
            try:
                content = _extract_chat_completion_content(payload)
                last_raw_response_text = content
                parsed = _extract_json_object(content)
                normalized = _validate_openai_enrichment_payload(parsed)
            except (ValueError, json.JSONDecodeError) as parse_error:
                if logger is not None:
                    log_event(
                        logger,
                        logging.WARNING,
                        "trend_enrichment_parse_failed",
                        topic_key=topic_key,
                        attempt=attempt,
                        error=str(parse_error),
                    )
                last_error = OpenAIEnrichmentOutputError(
                    f"invalid_model_output: {parse_error}",
                    raw_response_text=last_raw_response_text,
                )
                if attempt >= max_retries:
                    break
                sleep_seconds = retry_backoff_seconds * (2 ** max(0, attempt - 1))
                time.sleep(max(0.0, sleep_seconds))
                continue
            if logger is not None:
                log_event(
                    logger,
                    logging.INFO,
                    "trend_enrichment_parse_succeeded",
                    topic_key=topic_key,
                    attempt=attempt,
                    status=normalized.get("status"),
                    canonical_name=normalized.get("canonical_name"),
                    confidence=normalized.get("confidence"),
                )
            return normalized, usage_summary, last_raw_response_text
        except urllib_error.HTTPError as error:
            status = int(getattr(error, "code", 0) or 0)
            should_retry = status in {408, 409, 429, 500, 502, 503, 504}
            details = error.read().decode("utf-8", errors="replace")
            if logger is not None:
                log_event(
                    logger,
                    logging.WARNING,
                    "trend_enrichment_openai_request_failed",
                    topic_key=topic_key,
                    attempt=attempt,
                    status=status,
                    retriable=should_retry,
                    error_body=details[:240],
                )
            last_error = OpenAIEnrichmentTransportError(
                f"openai_http_error status={status} body={details[:400]}"
            )
            if not should_retry or attempt >= max_retries:
                break
        except (urllib_error.URLError, TimeoutError) as error:
            if logger is not None:
                log_event(
                    logger,
                    logging.WARNING,
                    "trend_enrichment_openai_request_failed",
                    topic_key=topic_key,
                    attempt=attempt,
                    retriable=attempt < max_retries,
                    error=str(error),
                )
            last_error = OpenAIEnrichmentTransportError(str(error))
            if attempt >= max_retries:
                break

        sleep_seconds = retry_backoff_seconds * (2 ** max(0, attempt - 1))
        time.sleep(max(0.0, sleep_seconds))

    if last_error is None:
        raise OpenAIEnrichmentTransportError("OpenAI enrichment failed with unknown error")
    if isinstance(last_error, OpenAIEnrichmentOutputError):
        raise last_error
    raise OpenAIEnrichmentTransportError(f"OpenAI enrichment failed after retries: {last_error}")


def _call_openai_for_title(
    *,
    api_key: str,
    model_name: str,
    prompt_version: str,
    prompt_input: dict[str, Any],
    timeout_seconds: float,
    max_retries: int,
    retry_backoff_seconds: float,
    logger: Any | None = None,
    topic_key: str | None = None,
) -> tuple[dict[str, Any], dict[str, int], str]:
    messages = [
        {"role": "system", "content": OPENAI_TITLE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Generate the visible title for this detected trend cluster.\n"
                "Rules:\n"
                "- Determine status first.\n"
                "- Use only provided evidence.\n"
                "- Prefer abstention over false specificity.\n"
                "- If evidence is mixed, say mixed but still choose one dominant canonical_name.\n"
                "- canonical_name must be a descriptive narrative label, usually 5 to 12 words and never more than 14 words.\n"
                "- Do not output a bare person name, place name, party name, product name, or keyword fragment by itself.\n"
                "- Do not output chopped or repaired token fragments like Epublicans, Itchen, Niverse, or Ahmouds.\n"
                "- Never output a multi-topic mashup in canonical_name.\n"
                "- Choose the dominant narrative using strongest post share first, then keyword recurrence, then semantic center, then engagement concentration as a tiebreaker.\n"
                "- canonical_name should explain what the narrative is, what is specifically happening, and why people are paying attention.\n"
                "- Favor internet-native wording that would still be clear to a memecoin researcher scanning a board.\n"
                "- Prioritize meme-translatable narratives: viral clips, creator moments, fan edits, deepfakes, platform drama, slogans, catchphrases, animals, mascots, AI persona waves, and crypto spillover that revives meme speculation.\n"
                "- Deprioritize generic geopolitics, macro, dry business process news, and non-memeified policy coverage.\n"
                "- Good examples: Grok deepfake scandal driving viral reposts and parody edits; Spot Bitcoin ETF inflows reviving crypto attention and meme speculation; TikTok platform backlash driving creator debate.\n"
                "- Bad examples: Trump; Ahmouds; Onate; Epublicans; Platform update buzz; Internet debate topic.\n"
                "- Only include evidence_post_ids from allowed_evidence_post_ids.\n"
                f"- Prompt version: {prompt_version}\n\n"
                f"Input JSON:\n{_json_dumps(prompt_input)}"
            ),
        },
    ]
    request_body = {
        "model": model_name,
        "temperature": 0.2,
        "messages": messages,
        "response_format": {
            "type": "json_schema",
            "json_schema": OPENAI_TITLE_JSON_SCHEMA,
        },
    }

    last_error: Exception | None = None
    last_raw_response_text = ""
    for attempt in range(1, max_retries + 1):
        if logger is not None:
            log_event(
                logger,
                logging.INFO,
                "trend_title_openai_request_started",
                topic_key=topic_key,
                attempt=attempt,
                max_retries=max_retries,
                model_name=model_name,
                timeout_seconds=timeout_seconds,
            )
        try:
            payload = _post_openai_chat_completions(
                api_key=api_key,
                timeout_seconds=timeout_seconds,
                request_body=request_body,
            )
            usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
            usage_summary = {
                "prompt_tokens": _safe_int(usage.get("prompt_tokens")),
                "completion_tokens": _safe_int(usage.get("completion_tokens")),
                "total_tokens": _safe_int(usage.get("total_tokens")),
            }
            if logger is not None:
                log_event(
                    logger,
                    logging.INFO,
                    "trend_title_openai_request_succeeded",
                    topic_key=topic_key,
                    attempt=attempt,
                    prompt_tokens=usage_summary["prompt_tokens"],
                    completion_tokens=usage_summary["completion_tokens"],
                    total_tokens=usage_summary["total_tokens"],
                )
            try:
                content = _extract_chat_completion_content(payload)
                last_raw_response_text = content
                parsed = _extract_json_object(content)
                normalized = _validate_openai_title_payload(parsed)
            except (ValueError, json.JSONDecodeError) as parse_error:
                if logger is not None:
                    log_event(
                        logger,
                        logging.WARNING,
                        "trend_title_parse_failed",
                        topic_key=topic_key,
                        attempt=attempt,
                        error=str(parse_error),
                    )
                last_error = OpenAIEnrichmentOutputError(
                    f"invalid_title_output: {parse_error}",
                    raw_response_text=last_raw_response_text,
                )
                if attempt >= max_retries:
                    break
                sleep_seconds = retry_backoff_seconds * (2 ** max(0, attempt - 1))
                time.sleep(max(0.0, sleep_seconds))
                continue
            if logger is not None:
                log_event(
                    logger,
                    logging.INFO,
                    "trend_title_parse_succeeded",
                    topic_key=topic_key,
                    attempt=attempt,
                    status=normalized.get("status"),
                    canonical_name=normalized.get("canonical_name"),
                    confidence=normalized.get("confidence"),
                )
            return normalized, usage_summary, last_raw_response_text
        except urllib_error.HTTPError as error:
            status = int(getattr(error, "code", 0) or 0)
            should_retry = status in {408, 409, 429, 500, 502, 503, 504}
            details = error.read().decode("utf-8", errors="replace")
            if logger is not None:
                log_event(
                    logger,
                    logging.WARNING,
                    "trend_title_openai_request_failed",
                    topic_key=topic_key,
                    attempt=attempt,
                    status=status,
                    retriable=should_retry,
                    error_body=details[:240],
                )
            last_error = OpenAIEnrichmentTransportError(
                f"openai_http_error status={status} body={details[:400]}"
            )
            if not should_retry or attempt >= max_retries:
                break
        except (urllib_error.URLError, TimeoutError) as error:
            if logger is not None:
                log_event(
                    logger,
                    logging.WARNING,
                    "trend_title_openai_request_failed",
                    topic_key=topic_key,
                    attempt=attempt,
                    retriable=attempt < max_retries,
                    error=str(error),
                )
            last_error = OpenAIEnrichmentTransportError(str(error))
            if attempt >= max_retries:
                break

        sleep_seconds = retry_backoff_seconds * (2 ** max(0, attempt - 1))
        time.sleep(max(0.0, sleep_seconds))

    if last_error is None:
        raise OpenAIEnrichmentTransportError("OpenAI title generation failed with unknown error")
    if isinstance(last_error, OpenAIEnrichmentOutputError):
        raise last_error
    raise OpenAIEnrichmentTransportError(f"OpenAI title generation failed after retries: {last_error}")


def _looks_like_fragment_key(topic_key: str, raw_label: str) -> bool:
    key_identity = _normalize_identity(topic_key)
    label_identity = _normalize_identity(raw_label)
    if not key_identity or not label_identity:
        return True
    if len(key_identity) >= 3 and len(label_identity) == len(key_identity) + 1:
        if label_identity[1:] == key_identity:
            return True
    return False


def _looks_like_junk_label(raw_label: str, topic_key: str) -> bool:
    label_identity = _normalize_identity(raw_label or topic_key)
    if not label_identity:
        return True
    if len(label_identity) < 3 and label_identity not in {"ai", "uk", "us", "eu"}:
        return True
    return False


def _format_gate_reason(reason_codes: list[str]) -> str:
    if not reason_codes:
        return "Cluster quality checks failed."
    labels = {
        "author_concentration_too_high": "discussion is dominated by too few authors",
        "coherence_too_low": "posts do not form a coherent narrative",
        "insufficient_unique_authors": "too few unique authors support the cluster",
        "insufficient_unique_posts": "too few posts support the cluster",
        "junk_label": "topic label appears too fragmentary or low quality",
        "short_post_ratio_too_high": "too many sampled posts are too short or fragmentary",
        "suspicious_topic_key": "topic key appears malformed",
    }
    parts = [labels.get(code, code.replace("_", " ")) for code in reason_codes]
    return "; ".join(parts)


def _evaluate_cluster_quality(
    *,
    topic_row: dict[str, Any],
    raw_label: str,
    topic_key: str,
    representative_posts: list[dict[str, Any]],
    cluster_diagnostics: dict[str, Any],
    config: TrendEnrichmentRuntimeConfig,
) -> dict[str, Any]:
    unique_posts = max(
        _safe_int(topic_row.get("unique_posts")),
        _safe_int(cluster_diagnostics.get("deduped_count")),
        len(representative_posts),
    )
    unique_authors = max(
        _safe_int(topic_row.get("unique_authors")),
        _safe_int(cluster_diagnostics.get("unique_author_count")),
    )
    sampled_unique_authors = _safe_int(cluster_diagnostics.get("unique_author_count"))
    deduped_count = _safe_int(cluster_diagnostics.get("deduped_count"))
    coherence_score = _safe_float(cluster_diagnostics.get("coherence_score"))
    top_author_share = _safe_float(cluster_diagnostics.get("top_author_share"))
    short_post_ratio = _safe_float(cluster_diagnostics.get("short_post_ratio"))

    reason_codes: list[str] = []
    status = "ok"
    if _looks_like_fragment_key(topic_key, raw_label):
        status = "junk"
        reason_codes.append("suspicious_topic_key")
    elif _looks_like_junk_label(raw_label, topic_key):
        status = "junk"
        reason_codes.append("junk_label")
    else:
        if unique_authors < config.min_unique_authors:
            reason_codes.append("insufficient_unique_authors")
        if unique_posts < config.min_unique_posts:
            reason_codes.append("insufficient_unique_posts")
        if sampled_unique_authors >= 3 and top_author_share > config.max_top_author_share:
            reason_codes.append("author_concentration_too_high")
        if short_post_ratio > 0.75:
            reason_codes.append("short_post_ratio_too_high")

        if reason_codes:
            status = "insufficient_evidence"
        elif deduped_count >= 4:
            if coherence_score < config.mixed_coherence_score:
                status = "insufficient_evidence"
                reason_codes.append("coherence_too_low")
            elif coherence_score < config.min_coherence_score:
                status = "mixed"
                reason_codes.append("coherence_too_low")

    return {
        "status": status,
        "reason_codes": reason_codes,
        "reason_text": _format_gate_reason(reason_codes),
        "unique_posts": unique_posts,
        "unique_authors": unique_authors,
        "coherence_score": coherence_score,
        "top_author_share": top_author_share,
        "short_post_ratio": short_post_ratio,
        "passed": status == "ok",
    }


def _build_safe_structured_output(
    *,
    status: str,
    raw_label: str,
    topic_key: str,
    representative_posts: list[dict[str, Any]],
    reason_text: str,
    reason_codes: list[str],
    cluster_diagnostics: dict[str, Any],
    custom_summary: str | None = None,
    confidence_override: float | None = None,
) -> dict[str, Any]:
    evidence_post_ids = _dedupe_text_list(
        (
            str(post.get("source_post_id") or post.get("candidate_id") or "").strip()
            for post in representative_posts
        ),
        limit=6,
        item_limit=80,
    )
    safe_label = None if _looks_like_fragment_key(topic_key, raw_label) else str(raw_label or topic_key).strip() or None
    coherence_score = _safe_float(cluster_diagnostics.get("coherence_score"))
    if status == "mixed":
        summary = custom_summary or (
            f"Sampled posts around {safe_label or 'this topic'} are directionally related but still mixed, "
            "so the system is keeping the narrative broad instead of assigning a precise label."
        )
        confidence = confidence_override if confidence_override is not None else min(0.45, max(0.18, coherence_score))
    elif status == "junk":
        summary = custom_summary or (
            "This topic bucket was rejected because the topic key or label appears malformed or operationally unusable."
        )
        confidence = confidence_override if confidence_override is not None else 0.05
    else:
        summary = custom_summary or (
            "The sampled posts do not provide enough coherent, diverse evidence to assign a reliable cleaned narrative in this window."
        )
        confidence = confidence_override if confidence_override is not None else min(0.3, max(0.08, coherence_score))

    return {
        "status": status,
        "canonical_name": safe_label if status == "mixed" else None,
        "summary": summary[:520],
        "why_attention": None,
        "confidence": max(0.0, min(1.0, confidence)),
        "evidence_post_ids": evidence_post_ids,
        "evidence_entities": [safe_label] if safe_label and status == "mixed" else [],
        "mixed_signals": _dedupe_text_list(reason_codes, limit=6, item_limit=80),
        "abstain_reason": reason_text[:240] if reason_text else "Cluster quality checks failed.",
    }


def _clamp_model_confidence(
    *,
    structured_output: dict[str, Any],
    cluster_diagnostics: dict[str, Any],
) -> None:
    status = str(structured_output.get("status") or "insufficient_evidence").strip().lower()
    confidence = _safe_float(structured_output.get("confidence"))
    coherence_score = _safe_float(cluster_diagnostics.get("coherence_score"))
    if status == "ok":
        if coherence_score < 0.24:
            confidence = min(confidence, 0.7)
        elif coherence_score < 0.32:
            confidence = min(confidence, 0.82)
    else:
        confidence = min(confidence, 0.5)
    structured_output["confidence"] = max(0.0, min(1.0, confidence))


def _build_supporting_sample(representative_posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(row.get("candidate_id") or ""),
            "source_post_id": str(row.get("source_post_id") or ""),
            "event_timestamp": (
                row.get("event_dt").isoformat()
                if isinstance(row.get("event_dt"), datetime)
                else None
            ),
            "engagement_score": round(_safe_float(row.get("engagement_score")), 3),
            "text": str(row.get("truncated_text") or ""),
        }
        for row in representative_posts
    ]


def _should_refresh_enrichment(
    *,
    existing_state: dict[str, Any] | None,
    input_hash: str,
    model_name: str,
    prompt_version: str,
    stale_after_hours: float,
    hash_change_cooldown_hours: float,
    now: datetime,
) -> tuple[bool, str]:
    if not existing_state:
        return True, "missing"

    existing_hash = str(existing_state.get("input_hash") or "").strip()
    if not existing_hash:
        return True, "missing_hash"
    existing_prompt_version = str(existing_state.get("prompt_version") or "").strip()
    if existing_prompt_version != prompt_version:
        return True, "prompt_version_changed"

    existing_model = str(existing_state.get("model_name") or "").strip()
    if existing_model != model_name:
        return True, "model_changed"

    expires_at = _to_utc_datetime(existing_state.get("expires_at"))
    if expires_at and expires_at <= now:
        return True, "expired"

    refreshed_at = _to_utc_datetime(existing_state.get("refreshed_at")) or _to_utc_datetime(
        existing_state.get("generated_at")
    )
    if refreshed_at is None:
        return True, "missing_timestamp"
    if existing_hash != input_hash:
        if refreshed_at + timedelta(hours=max(0.5, hash_change_cooldown_hours)) <= now:
            return True, "input_hash_changed"
        return False, "input_hash_changed_during_cooldown"
    if refreshed_at + timedelta(hours=max(0.5, stale_after_hours)) <= now:
        return True, "stale"

    return False, "unchanged"


def _has_ready_visible_title(existing_state: dict[str, Any] | None) -> bool:
    if not existing_state:
        return False
    name_status = str(existing_state.get("name_status") or "").strip().lower()
    name_source = str(existing_state.get("name_source") or "").strip().lower()
    canonical_name = str(existing_state.get("canonical_name") or "").strip()
    return (
        bool(canonical_name)
        and name_status == "ready"
        and name_source in {"ai_exact", "historical_exact", "historical_alias"}
    )


def _should_refresh_visible_title(
    *,
    existing_state: dict[str, Any] | None,
    input_hash: str,
    stale_after_hours: float,
    retry_after_minutes: float,
    hash_change_cooldown_hours: float,
    now: datetime,
) -> tuple[bool, str]:
    if not existing_state:
        return True, "missing"

    existing_hash = str(existing_state.get("input_hash") or "").strip()
    if not existing_hash:
        return True, "missing_hash"
    expires_at = _to_utc_datetime(existing_state.get("expires_at"))
    refreshed_at = _to_utc_datetime(existing_state.get("refreshed_at")) or _to_utc_datetime(
        existing_state.get("generated_at")
    )
    if refreshed_at is None:
        return True, "missing_timestamp"

    if _has_ready_visible_title(existing_state):
        existing_canonical_name = str(existing_state.get("canonical_name") or "").strip()
        if not _is_authoritative_title_state(existing_state):
            if refreshed_at + timedelta(minutes=max(0.5, retry_after_minutes)) <= now:
                return True, "non_authoritative_existing_title"
            return False, "recent_non_authoritative_title"
        if existing_canonical_name and _is_low_quality_visible_title_name(existing_canonical_name):
            if refreshed_at + timedelta(minutes=max(0.5, retry_after_minutes)) <= now:
                return True, "low_quality_existing_title"
            return False, "recent_low_quality_existing_title"
        if existing_hash != input_hash:
            if refreshed_at + timedelta(hours=max(0.5, hash_change_cooldown_hours)) <= now:
                return True, "input_hash_changed_after_cooldown"
            return False, "ready_title_reused_during_cooldown"
        if expires_at and expires_at <= now:
            return True, "expired"
        if refreshed_at + timedelta(hours=max(0.5, stale_after_hours)) <= now:
            return True, "stale"
        return False, "unchanged"

    existing_fallback_label = str(existing_state.get("fallback_label") or "").strip()
    if existing_fallback_label and _is_low_quality_visible_title_name(existing_fallback_label):
        if refreshed_at + timedelta(minutes=max(0.5, retry_after_minutes)) <= now:
            return True, "low_quality_fallback_title"
        return False, "recent_low_quality_fallback_title"
    if existing_hash != input_hash:
        if refreshed_at + timedelta(minutes=max(0.5, retry_after_minutes)) <= now:
            return True, "input_hash_changed_retry_due"
        return False, "recent_failure_during_cooldown"
    if expires_at and expires_at <= now:
        if refreshed_at + timedelta(minutes=max(0.5, retry_after_minutes)) <= now:
            return True, "expired"
        return False, "recent_failure_during_cooldown"
    if refreshed_at + timedelta(minutes=max(0.5, retry_after_minutes)) <= now:
        return True, "retry_due"
    return False, "recent_failure"


def summarize_trend_title_coverage(
    *,
    store: Any,
    topic_limit: int = AUTHORITATIVE_TREND_TITLE_TARGET,
) -> dict[str, Any]:
    normalized_limit = max(AUTHORITATIVE_TREND_TITLE_TARGET, int(topic_limit or AUTHORITATIVE_TREND_TITLE_TARGET))
    topics = store.fetch_top_topics_for_enrichment(
        limit=normalized_limit,
        prioritize_pending_titles=False,
    )
    topic_keys = [
        str(topic.get("topic_key") or "").strip()
        for topic in topics
        if str(topic.get("topic_key") or "").strip()
    ]
    if not topic_keys:
        return {
            "topic_count": 0,
            "authoritative_ready_count": 0,
            "ready_count": 0,
            "pending_count": 0,
            "failed_count": 0,
            "missing_count": 0,
            "non_authoritative_ready_count": 0,
            "topic_keys": [],
        }

    latest_state = store.fetch_latest_topic_enrichment_state(topic_keys=topic_keys)
    ready_count = 0
    authoritative_ready_count = 0
    pending_count = 0
    failed_count = 0
    missing_count = 0
    non_authoritative_ready_count = 0

    for topic_key in topic_keys:
        existing_state = latest_state.get(topic_key)
        if not existing_state:
            missing_count += 1
            continue
        if _has_ready_visible_title(existing_state):
            ready_count += 1
            if _is_authoritative_title_state(existing_state):
                authoritative_ready_count += 1
            else:
                non_authoritative_ready_count += 1
            continue
        if str(existing_state.get("name_status") or "").strip().lower() == "failed":
            failed_count += 1
        else:
            pending_count += 1

    return {
        "topic_count": len(topic_keys),
        "authoritative_ready_count": authoritative_ready_count,
        "ready_count": ready_count,
        "pending_count": pending_count,
        "failed_count": failed_count,
        "missing_count": missing_count,
        "non_authoritative_ready_count": non_authoritative_ready_count,
        "topic_keys": topic_keys,
    }


def run_trend_title_generation_backfill_job(
    *,
    store: Any,
    logger: Any,
    config: TrendTitleGenerationRuntimeConfig,
    reason: str,
) -> dict[str, Any]:
    target_topic_limit = max(AUTHORITATIVE_TREND_TITLE_TARGET, int(config.max_topics))
    max_passes = _parse_int_env("BLUESKY_TREND_TITLE_BACKFILL_MAX_PASSES", 8, 1, 32)
    initial_coverage = summarize_trend_title_coverage(
        store=store,
        topic_limit=target_topic_limit,
    )
    log_event(
        logger,
        logging.INFO,
        "trend_title_coverage_snapshot",
        reason=reason,
        stage="before_backfill",
        coverage=initial_coverage,
        target_topic_limit=target_topic_limit,
        max_passes=max_passes,
    )
    if initial_coverage["topic_count"] <= 0:
        return {
            "skipped": True,
            "reason": "no_topics",
            "coverage_before": initial_coverage,
            "coverage_after": initial_coverage,
            "coverage_target_topics": target_topic_limit,
            "backfill_passes": 0,
            "coverage_complete": True,
        }
    if initial_coverage["authoritative_ready_count"] >= initial_coverage["topic_count"]:
        return {
            "skipped": True,
            "reason": "coverage_satisfied",
            "coverage_before": initial_coverage,
            "coverage_after": initial_coverage,
            "coverage_target_topics": target_topic_limit,
            "backfill_passes": 0,
            "coverage_complete": True,
        }

    previous_coverage = initial_coverage
    last_cycle_summary: dict[str, Any] = {"skipped": True, "reason": "coverage_pending"}
    stop_reason = "max_passes_reached"
    backfill_passes = 0

    for pass_index in range(1, max_passes + 1):
        cycle_reason = reason if pass_index == 1 else f"{reason}:title_backfill"
        last_cycle_summary = run_trend_title_generation_cycle(
            store=store,
            logger=logger,
            config=config,
            reason=cycle_reason,
        )
        backfill_passes = pass_index
        current_coverage = summarize_trend_title_coverage(
            store=store,
            topic_limit=target_topic_limit,
        )
        log_event(
            logger,
            logging.INFO,
            "trend_title_coverage_snapshot",
            reason=cycle_reason,
            stage="after_pass",
            pass_index=pass_index,
            coverage=current_coverage,
            cycle_summary=last_cycle_summary,
            target_topic_limit=target_topic_limit,
            max_passes=max_passes,
        )
        if current_coverage["authoritative_ready_count"] >= current_coverage["topic_count"]:
            stop_reason = "coverage_satisfied"
            previous_coverage = current_coverage
            break
        unresolved_count = (
            current_coverage["missing_count"]
            + current_coverage["pending_count"]
            + current_coverage["non_authoritative_ready_count"]
        )
        progress_made = (
            current_coverage["authoritative_ready_count"] > previous_coverage["authoritative_ready_count"]
        )
        if unresolved_count <= 0:
            stop_reason = "coverage_exhausted"
            previous_coverage = current_coverage
            break
        if (
            not progress_made
            and int(last_cycle_summary.get("attempted_topics") or 0) <= 0
            and int(last_cycle_summary.get("named_topics") or 0) <= 0
        ):
            stop_reason = "no_progress"
            previous_coverage = current_coverage
            break
        previous_coverage = current_coverage

    final_coverage = previous_coverage
    coverage_complete = final_coverage["authoritative_ready_count"] >= final_coverage["topic_count"]
    result = dict(last_cycle_summary)
    result.update(
        {
            "coverage_before": initial_coverage,
            "coverage_after": final_coverage,
            "coverage_target_topics": target_topic_limit,
            "backfill_passes": backfill_passes,
            "coverage_complete": coverage_complete,
            "coverage_stop_reason": stop_reason,
        }
    )
    if coverage_complete:
        result["last_write_at"] = str(result.get("last_write_at") or _utc_now().isoformat())
    return result


def _ensure_enrichment_schema(*, store: Any, logger: Any, reason: str) -> None:
    ensure_method = getattr(store, "ensure_stable_topic_read_model_tables", None)
    if not callable(ensure_method):
        return
    started_at = time.monotonic()
    ensure_method()
    log_event(
        logger,
        logging.INFO,
        "trend_enrichment_schema_ready",
        reason=reason,
        duration_ms=round((time.monotonic() - started_at) * 1000, 1),
    )


def _is_missing_enrichment_schema_error(error: Exception) -> bool:
    message = str(error or "").lower()
    if "topic_ai_enrichment" not in message:
        return False
    return any(
        token in message
        for token in (
            "undefined column",
            "undefined table",
            "does not exist",
            "missing column",
            "missing relation",
        )
    )


def _upsert_enrichment_row_with_repair(
    *,
    store: Any,
    logger: Any,
    reason: str,
    topic_key: str,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    try:
        return store.upsert_topic_ai_enrichment(payload)
    except Exception as error:
        if not _is_missing_enrichment_schema_error(error):
            raise
        log_event(
            logger,
            logging.WARNING,
            "trend_enrichment_db_write_schema_repair_started",
            reason=reason,
            topic_key=topic_key,
            error=str(error),
        )
        _ensure_enrichment_schema(store=store, logger=logger, reason=reason)
        return store.upsert_topic_ai_enrichment(payload)


def _insert_enrichment_run_with_repair(
    *,
    store: Any,
    logger: Any,
    reason: str,
    topic_key: str,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    insert_method = getattr(store, "insert_topic_ai_enrichment_run", None)
    if not callable(insert_method):
        return None
    try:
        return insert_method(payload)
    except Exception as error:
        if not _is_missing_enrichment_schema_error(error):
            raise
        log_event(
            logger,
            logging.WARNING,
            "trend_enrichment_run_write_schema_repair_started",
            reason=reason,
            topic_key=topic_key,
            error=str(error),
        )
        _ensure_enrichment_schema(store=store, logger=logger, reason=reason)
        return insert_method(payload)


def _resolve_visible_name_fields(
    *,
    canonical_name: str | None,
    raw_label: str,
    status: str,
    preferred_name_source: str | None = None,
) -> dict[str, str | None]:
    raw_label_value = _trim_optional_text(raw_label, limit=140) or None
    canonical_name_value = _trim_optional_text(canonical_name, limit=140)
    if canonical_name_value and raw_label_value and canonical_name_value.lower() == raw_label_value.lower():
        canonical_name_value = None

    if canonical_name_value:
        name_status = "ready"
        normalized_preferred_source = str(preferred_name_source or "").strip().lower()
        name_source = (
            normalized_preferred_source
            if normalized_preferred_source in {"ai_exact", "historical_exact", "historical_alias"}
            else "ai_exact"
        )
    elif status in {"insufficient_evidence", "junk"}:
        name_status = "failed"
        name_source = "fallback_cleaned" if raw_label_value else "none"
    else:
        name_status = "pending"
        name_source = "fallback_cleaned" if raw_label_value else "none"

    return {
        "canonical_name": canonical_name_value,
        "fallback_label": raw_label_value,
        "name_status": name_status,
        "name_source": name_source,
    }


def _build_enrichment_row_payload(
    *,
    topic_key: str,
    window_end: datetime,
    raw_label: str,
    structured_output: dict[str, Any],
    representative_posts: list[dict[str, Any]],
    input_hash: str,
    model_name: str,
    prompt_version: str,
    refresh_reason: str,
    reason: str,
    cluster_diagnostics: dict[str, Any],
    usage: dict[str, int],
    validator_errors: list[str],
    raw_response_text: str,
    generated_at: datetime,
    expires_at: datetime,
    duration_ms: float,
    existing_state: dict[str, Any] | None = None,
    pre_llm_gate: dict[str, Any] | None = None,
    writer_identity: str | None = None,
    writer_role: str | None = None,
) -> dict[str, Any]:
    legacy_fields = _build_legacy_enrichment_fields(
        structured_output=structured_output,
        raw_label=raw_label,
        topic_key=topic_key,
    )
    name_fields = _resolve_visible_name_fields(
        canonical_name=legacy_fields.get("canonical_name"),
        raw_label=raw_label,
        status=str(structured_output.get("status") or "insufficient_evidence").strip().lower(),
        preferred_name_source=str(structured_output.get("preferred_name_source") or "").strip() or None,
    )
    supporting_post_ids = _dedupe_text_list(
        (
            str(row.get("source_post_id") or row.get("candidate_id") or "").strip()
            for row in representative_posts
        ),
        limit=20,
        item_limit=80,
    )
    writer_identity_value = _trim_optional_text(writer_identity, limit=120) or None
    writer_role_value = _trim_optional_text(writer_role, limit=120) or None
    if not writer_identity_value or writer_identity_value.lower() == "unknown":
        raise ValueError("writer_identity is required for topic AI enrichment persistence")
    if not writer_role_value or writer_role_value.lower() == "unknown":
        raise ValueError("writer_role is required for topic AI enrichment persistence")
    authoritative_writer = writer_identity_value in {
        TITLE_WRITER_IDENTITY,
        ENRICHMENT_WRITER_IDENTITY,
    }
    deployment_id = _resolve_writer_deployment_id()
    instance_id = _resolve_writer_instance_id()
    code_version = _resolve_writer_code_version()
    payload = {
        "topic_key": topic_key,
        "as_of_window_end": window_end,
        "raw_label": raw_label,
        "canonical_name": name_fields["canonical_name"],
        "fallback_label": name_fields["fallback_label"],
        "name_status": name_fields["name_status"],
        "name_source": name_fields["name_source"],
        "writer_identity": writer_identity_value,
        "writer_role": writer_role_value,
        "short_description": legacy_fields["short_description"],
        "context_paragraph": legacy_fields["context_paragraph"],
        "narrative_summary": legacy_fields["narrative_summary"],
        "why_attention": structured_output.get("why_attention"),
        "key_entities": structured_output.get("evidence_entities") or [],
        "trend_category": legacy_fields.get("trend_category"),
        "summary_confidence": _safe_float(structured_output.get("confidence")),
        "status": str(structured_output.get("status") or "insufficient_evidence").strip().lower(),
        "evidence_post_ids": structured_output.get("evidence_post_ids") or [],
        "mixed_signals": structured_output.get("mixed_signals") or [],
        "abstain_reason": structured_output.get("abstain_reason"),
        "validator_errors": validator_errors,
        "validated_output_json": structured_output,
        "raw_response_text": raw_response_text,
        "supporting_post_ids": supporting_post_ids,
        "supporting_sample": _build_supporting_sample(representative_posts),
        "representative_post_count": len(representative_posts),
        "model_name": model_name,
        "prompt_version": prompt_version,
        "input_hash": input_hash,
        "generated_at": generated_at,
        "refreshed_at": generated_at,
        "expires_at": expires_at,
        "writer_identity": writer_identity_value,
        "writer_role": writer_role_value,
        "authoritative_writer": authoritative_writer,
        "deployment_id": deployment_id,
        "instance_id": instance_id,
        "code_version": code_version,
        "refresh_reason": refresh_reason,
        "usage_prompt_tokens": _safe_int(usage.get("prompt_tokens")),
        "usage_completion_tokens": _safe_int(usage.get("completion_tokens")),
        "usage_total_tokens": _safe_int(usage.get("total_tokens")),
        "duration_ms": round(max(0.0, duration_ms), 3),
        "replaced_existing_title": False,
        "metadata_json": {
            "refresh_reason": refresh_reason,
            "reason": reason,
            "sample_diagnostics": cluster_diagnostics,
            "token_usage": usage,
            "usage_prompt_tokens": _safe_int(usage.get("prompt_tokens")),
            "usage_completion_tokens": _safe_int(usage.get("completion_tokens")),
            "usage_total_tokens": _safe_int(usage.get("total_tokens")),
            "pre_llm_gate": pre_llm_gate or {},
            "validator_errors": validator_errors,
            "structured_output_version": "v2",
            "writer_identity": writer_identity_value,
            "writer_role": writer_role_value,
            "authoritative_writer": authoritative_writer,
            "deployment_id": deployment_id,
            "instance_id": instance_id,
            "code_version": code_version,
            "duration_ms": round(max(0.0, duration_ms), 3),
        },
    }
    persistence_delta = _summarize_persistence_delta(
        existing_state=existing_state,
        payload=payload,
    )
    payload["replaced_existing_title"] = bool(persistence_delta["replacedExistingTitle"])
    payload["metadata_json"]["state_change_kind"] = str(persistence_delta["stateChangeKind"])
    payload["metadata_json"]["state_change_fields"] = list(persistence_delta["changedFields"])
    payload["metadata_json"]["replaced_existing_title"] = bool(
        persistence_delta["replacedExistingTitle"]
    )
    payload["metadata_json"]["identical_authoritative_title"] = bool(
        persistence_delta["isIdenticalAuthoritativeTitle"]
    )
    return payload


def _build_safe_title_output(
    *,
    status: str,
    representative_posts: list[dict[str, Any]],
    reason_text: str,
    reason_codes: list[str],
    confidence_override: float | None = None,
) -> dict[str, Any]:
    evidence_post_ids = _dedupe_text_list(
        (
            str(post.get("source_post_id") or post.get("candidate_id") or "").strip()
            for post in representative_posts
        ),
        limit=6,
        item_limit=80,
    )
    normalized_status = status if status in ENRICHMENT_STATUSES else "insufficient_evidence"
    confidence = confidence_override if confidence_override is not None else (
        0.05 if normalized_status == "junk" else 0.12
    )
    return {
        "status": normalized_status,
        "canonical_name": None,
        "summary": _safe_sentence(reason_text or "Visible title generation abstained.")[:520],
        "why_attention": None,
        "confidence": max(0.0, min(1.0, confidence)),
        "evidence_post_ids": evidence_post_ids,
        "evidence_entities": [],
        "mixed_signals": _dedupe_text_list(reason_codes, limit=8, item_limit=120),
        "abstain_reason": (reason_text or "Visible title generation abstained.")[:240],
    }


def _should_upsert_current_enrichment_row(
    *,
    existing_state: dict[str, Any] | None,
    payload: dict[str, Any],
) -> tuple[bool, str]:
    delta = _summarize_persistence_delta(existing_state=existing_state, payload=payload)
    if delta["hasMeaningfulChange"]:
        return True, str(delta["stateChangeKind"])
    if int(payload.get("usage_total_tokens") or 0) > 0:
        return False, "identical_state_after_paid_run"
    return False, "identical_state"


def _estimate_usage_cost_usd(
    *,
    prompt_tokens: int,
    completion_tokens: int,
    input_rate_per_million: float,
    output_rate_per_million: float,
) -> float | None:
    if input_rate_per_million <= 0 and output_rate_per_million <= 0:
        return None
    estimated = (
        (max(0, prompt_tokens) / 1_000_000.0) * max(0.0, input_rate_per_million)
        + (max(0, completion_tokens) / 1_000_000.0) * max(0.0, output_rate_per_million)
    )
    return round(estimated, 6)


def run_trend_title_generation_cycle(
    *,
    store: Any,
    logger: Any,
    config: TrendTitleGenerationRuntimeConfig,
    reason: str,
) -> dict[str, Any]:
    started_at_monotonic = time.monotonic()
    now = datetime.now(timezone.utc)
    input_cost_rate = _parse_float_env(
        "BLUESKY_TREND_TITLE_INPUT_COST_USD_PER_MILLION_TOKENS",
        0.0,
        0.0,
        10_000.0,
    )
    output_cost_rate = _parse_float_env(
        "BLUESKY_TREND_TITLE_OUTPUT_COST_USD_PER_MILLION_TOKENS",
        0.0,
        0.0,
        10_000.0,
    )
    if not config.enabled:
        return {"skipped": True, "reason": "disabled"}
    openai_enabled = bool(config.openai_api_key)

    log_event(
        logger,
        logging.INFO,
        "trend_title_batch_started",
        reason=reason,
        model_name=config.model_name,
        prompt_version=config.prompt_version,
        max_topics=config.max_topics,
        max_topics_per_pass=config.max_topics_per_pass,
        max_duration_seconds=config.max_duration_seconds,
        request_timeout_seconds=config.request_timeout_seconds,
        parallelism=config.parallelism,
        openai_enabled=openai_enabled,
    )
    _ensure_enrichment_schema(store=store, logger=logger, reason=reason)

    topics = store.fetch_top_topics_for_enrichment(
        limit=config.max_topics,
        prioritize_pending_titles=True,
    )
    if not topics:
        return {"skipped": True, "reason": "no_topics"}

    pass_topic_limit = max(1, min(config.max_topics, config.max_topics_per_pass))
    topic_keys = [
        str(row.get("topic_key") or "").strip()
        for row in topics
        if str(row.get("topic_key") or "").strip()
    ]
    existing_by_topic = store.fetch_latest_topic_enrichment_state(topic_keys=topic_keys)

    processed_topics = 0
    attempted_topics = 0
    named_topics = 0
    abstained_topics = 0
    skipped_unchanged = 0
    skipped_no_posts = 0
    failed_topics = 0
    openai_failed_topics = 0
    db_failed_topics = 0
    deferred_topics = 0
    deferred_reason: str | None = None
    last_write_at: str | None = None
    reasons: dict[str, int] = {}
    skipped_due_to_recent_good_title = 0
    skipped_due_to_hash_cooldown = 0
    skipped_due_to_retry_cooldown = 0
    usage_prompt_tokens = 0
    usage_completion_tokens = 0
    usage_total_tokens = 0
    queued_topics: list[dict[str, Any]] = []

    for topic in topics:
        elapsed_seconds = time.monotonic() - started_at_monotonic
        if processed_topics >= pass_topic_limit:
            deferred_topics = max(0, len(topics) - processed_topics)
            deferred_reason = "per_pass_topic_limit"
            reasons["per_pass_topic_limit"] = reasons.get("per_pass_topic_limit", 0) + deferred_topics
            break
        if elapsed_seconds >= max(1.0, config.max_duration_seconds):
            deferred_topics = max(0, len(topics) - processed_topics)
            deferred_reason = "max_duration_reached"
            reasons["max_duration_reached"] = reasons.get("max_duration_reached", 0) + deferred_topics
            break

        topic_key = str(topic.get("topic_key") or "").strip()
        if not topic_key:
            reasons["invalid_topic_key"] = reasons.get("invalid_topic_key", 0) + 1
            continue
        processed_topics += 1
        raw_label = str(topic.get("topic_label") or topic_key).strip() or topic_key
        window_end = _to_utc_datetime(topic.get("window_end")) or now

        candidates = store.fetch_topic_post_candidates_for_enrichment(
            topic_key=topic_key,
            limit=config.candidate_post_limit,
            window_start=_to_utc_datetime(topic.get("window_start")),
            window_end=window_end,
        )
        representative_posts, sample_diagnostics = select_representative_posts(
            candidates,
            limit=config.representative_posts,
            max_post_chars=config.max_post_chars,
            min_text_chars=config.enforce_min_text_chars,
            min_word_count=config.enforce_min_word_count,
        )
        if not representative_posts:
            input_hash = build_enrichment_input_hash(
                topic_row=topic,
                representative_posts=[],
            )
            should_refresh, refresh_reason = _should_refresh_visible_title(
                existing_state=existing_by_topic.get(topic_key),
                input_hash=input_hash,
                stale_after_hours=config.stale_after_hours,
                retry_after_minutes=config.retry_after_minutes,
                hash_change_cooldown_hours=config.hash_change_cooldown_hours,
                now=now,
            )
            reasons[refresh_reason] = reasons.get(refresh_reason, 0) + 1
            if not should_refresh:
                skipped_unchanged += 1
                if refresh_reason in {"unchanged", "ready_title_reused_during_cooldown"}:
                    skipped_due_to_recent_good_title += 1
                elif "cooldown" in refresh_reason:
                    skipped_due_to_hash_cooldown += 1
                elif "recent" in refresh_reason:
                    skipped_due_to_retry_cooldown += 1
                log_event(
                    logger,
                    logging.INFO,
                    "trend_title_topic_skipped",
                    reason=reason,
                    topic_key=topic_key,
                    raw_label=raw_label,
                    skip_reason=refresh_reason,
                )
                continue
            skipped_no_posts += 1
            reasons["no_representative_posts"] = reasons.get("no_representative_posts", 0) + 1
            safe_output = _build_safe_title_output(
                status="insufficient_evidence",
                representative_posts=[],
                reason_text="No representative posts were available for visible title generation.",
                reason_codes=["no_representative_posts"],
                confidence_override=0.05,
            )
            payload = _build_enrichment_row_payload(
                topic_key=topic_key,
                window_end=window_end,
                raw_label=raw_label,
                structured_output=safe_output,
                representative_posts=[],
                input_hash=input_hash,
                model_name=config.model_name,
                prompt_version=config.prompt_version,
                refresh_reason=refresh_reason,
                reason=reason,
                cluster_diagnostics=sample_diagnostics,
                usage={"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                validator_errors=[],
                raw_response_text="",
                generated_at=now,
                expires_at=now + timedelta(hours=max(0.5, config.stale_after_hours)),
                duration_ms=0.0,
                existing_state=existing_by_topic.get(topic_key),
                pre_llm_gate={"status": "insufficient_evidence", "reason_codes": ["no_representative_posts"]},
                writer_identity=TITLE_WRITER_IDENTITY,
                writer_role=TITLE_WRITER_ROLE,
            )
            try:
                _insert_enrichment_run_with_repair(
                    store=store,
                    logger=logger,
                    reason=reason,
                    topic_key=topic_key,
                    payload=payload,
                )
                should_upsert, upsert_reason = _should_upsert_current_enrichment_row(
                    existing_state=existing_by_topic.get(topic_key),
                    payload=payload,
                )
                persisted = None
                if should_upsert:
                    persisted = _upsert_enrichment_row_with_repair(
                        store=store,
                        logger=logger,
                        reason=reason,
                        topic_key=topic_key,
                        payload=payload,
                    )
                else:
                    reasons[upsert_reason] = reasons.get(upsert_reason, 0) + 1
                if persisted and persisted.get("refreshed_at"):
                    last_write_at = str(persisted.get("refreshed_at"))
                abstained_topics += 1
            except Exception as error:
                failed_topics += 1
                db_failed_topics += 1
                reasons["db_write_failed"] = reasons.get("db_write_failed", 0) + 1
                log_event(
                    logger,
                    logging.ERROR,
                    "trend_title_db_write_failed",
                    reason=reason,
                    topic_key=topic_key,
                    raw_label=raw_label,
                    error=str(error),
                )
            continue

        input_hash = build_enrichment_input_hash(
            topic_row=topic,
            representative_posts=representative_posts,
        )
        should_refresh, refresh_reason = _should_refresh_visible_title(
            existing_state=existing_by_topic.get(topic_key),
            input_hash=input_hash,
            stale_after_hours=config.stale_after_hours,
            retry_after_minutes=config.retry_after_minutes,
            hash_change_cooldown_hours=config.hash_change_cooldown_hours,
            now=now,
        )
        reasons[refresh_reason] = reasons.get(refresh_reason, 0) + 1
        if not should_refresh:
            skipped_unchanged += 1
            if refresh_reason in {"unchanged", "ready_title_reused_during_cooldown"}:
                skipped_due_to_recent_good_title += 1
            elif "cooldown" in refresh_reason:
                skipped_due_to_hash_cooldown += 1
            elif "recent" in refresh_reason:
                skipped_due_to_retry_cooldown += 1
            log_event(
                logger,
                logging.INFO,
                "trend_title_topic_skipped",
                reason=reason,
                topic_key=topic_key,
                raw_label=raw_label,
                skip_reason=refresh_reason,
            )
            continue

        cluster_quality = _evaluate_cluster_quality(
            topic_row=topic,
            raw_label=raw_label,
            topic_key=topic_key,
            representative_posts=representative_posts,
            cluster_diagnostics=sample_diagnostics,
            config=config,
        )
        cluster_diagnostics = {
            **sample_diagnostics,
            "gate_status": cluster_quality["status"],
            "gate_reason_codes": cluster_quality["reason_codes"],
            "gate_reason_text": cluster_quality["reason_text"],
            "gate_passed": cluster_quality["passed"],
        }
        if cluster_quality["status"] in {"junk", "insufficient_evidence"}:
            safe_output = _build_heuristic_visible_title_output(
                raw_label=raw_label,
                representative_posts=representative_posts,
                reason_code=str(cluster_quality["status"]),
            ) or _build_safe_title_output(
                status=str(cluster_quality["status"]),
                representative_posts=representative_posts,
                reason_text=str(cluster_quality["reason_text"]),
                reason_codes=list(cluster_quality["reason_codes"]),
            )
            payload = _build_enrichment_row_payload(
                topic_key=topic_key,
                window_end=window_end,
                raw_label=raw_label,
                structured_output=safe_output,
                representative_posts=representative_posts,
                input_hash=input_hash,
                model_name=config.model_name,
                prompt_version=config.prompt_version,
                refresh_reason=refresh_reason,
                reason=reason,
                cluster_diagnostics=cluster_diagnostics,
                usage={"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                validator_errors=[],
                raw_response_text="",
                generated_at=now,
                expires_at=now + timedelta(hours=max(0.5, config.stale_after_hours)),
                duration_ms=round((time.monotonic() - started_at_monotonic) * 1000, 3),
                existing_state=existing_by_topic.get(topic_key),
                pre_llm_gate=cluster_quality,
                writer_identity=TITLE_WRITER_IDENTITY,
                writer_role=TITLE_WRITER_ROLE,
            )
            try:
                _insert_enrichment_run_with_repair(
                    store=store,
                    logger=logger,
                    reason=reason,
                    topic_key=topic_key,
                    payload=payload,
                )
                should_upsert, upsert_reason = _should_upsert_current_enrichment_row(
                    existing_state=existing_by_topic.get(topic_key),
                    payload=payload,
                )
                persisted = None
                if should_upsert:
                    persisted = _upsert_enrichment_row_with_repair(
                        store=store,
                        logger=logger,
                        reason=reason,
                        topic_key=topic_key,
                        payload=payload,
                    )
                else:
                    reasons[upsert_reason] = reasons.get(upsert_reason, 0) + 1
                if persisted and persisted.get("refreshed_at"):
                    last_write_at = str(persisted.get("refreshed_at"))
                abstained_topics += 1
            except Exception as error:
                failed_topics += 1
                db_failed_topics += 1
                reasons["db_write_failed"] = reasons.get("db_write_failed", 0) + 1
                log_event(
                    logger,
                    logging.ERROR,
                    "trend_title_db_write_failed",
                    reason=reason,
                    topic_key=topic_key,
                    raw_label=raw_label,
                    error=str(error),
                )
            continue

        queued_topics.append(
            {
                "topic": topic,
                "topic_key": topic_key,
                "raw_label": raw_label,
                "window_end": window_end,
                "representative_posts": representative_posts,
                "cluster_diagnostics": cluster_diagnostics,
                "cluster_quality": cluster_quality,
                "input_hash": input_hash,
                "refresh_reason": refresh_reason,
            }
        )

    def generate_visible_title(context: dict[str, Any]) -> tuple[dict[str, Any], dict[str, int], str, list[str], float]:
        started_at = time.monotonic()
        if not openai_enabled:
            heuristic_output = _build_heuristic_visible_title_output(
                raw_label=context["raw_label"],
                representative_posts=context["representative_posts"],
                reason_code="missing_openai_api_key",
            )
            return (
                heuristic_output
                or _build_safe_title_output(
                    status="insufficient_evidence",
                    representative_posts=context["representative_posts"],
                    reason_text="Visible title generation fell back to non-LLM mode but no credible heuristic title was available.",
                    reason_codes=["missing_openai_api_key"],
                    confidence_override=0.08,
                ),
                {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                "",
                [],
                round((time.monotonic() - started_at) * 1000, 3),
            )
        prompt_input = _summarize_prompt_input(
            topic_row=context["topic"],
            representative_posts=context["representative_posts"],
            cluster_diagnostics=context["cluster_diagnostics"],
        )
        structured_output, usage, raw_response_text = _call_openai_for_title(
            api_key=config.openai_api_key,
            model_name=config.model_name,
            prompt_version=config.prompt_version,
            prompt_input=prompt_input,
            timeout_seconds=config.request_timeout_seconds,
            max_retries=config.max_retries,
            retry_backoff_seconds=config.retry_backoff_seconds,
            logger=logger,
            topic_key=context["topic_key"],
        )
        structured_output = _rewrite_compound_canonical_name(
            structured_output=structured_output,
            raw_label=context["raw_label"],
            representative_posts=context["representative_posts"],
        )
        validator_errors = _validate_title_output_against_evidence(
            model_output=structured_output,
            representative_posts=context["representative_posts"],
        )
        if validator_errors:
            heuristic_output = _build_heuristic_visible_title_output(
                raw_label=context["raw_label"],
                representative_posts=context["representative_posts"],
                reason_code="validator_rejected_title",
            )
            structured_output = heuristic_output or _build_safe_title_output(
                status="insufficient_evidence",
                representative_posts=context["representative_posts"],
                reason_text="Generated visible title could not be validated against the supplied evidence.",
                reason_codes=validator_errors,
                confidence_override=0.12,
            )
        return structured_output, usage, raw_response_text, validator_errors, round((time.monotonic() - started_at) * 1000, 3)

    if queued_topics:
        with ThreadPoolExecutor(max_workers=max(1, config.parallelism), thread_name_prefix="trend-title-pass") as executor:
            future_to_context = {
                executor.submit(generate_visible_title, context): context
                for context in queued_topics
            }
            for future in as_completed(future_to_context):
                context = future_to_context[future]
                attempted_topics += 1
                try:
                    structured_output, usage, raw_response_text, validator_errors, topic_duration_ms = future.result()
                except OpenAIEnrichmentTransportError as error:
                    heuristic_output = _build_heuristic_visible_title_output(
                        raw_label=context["raw_label"],
                        representative_posts=context["representative_posts"],
                        reason_code="openai_failed",
                    )
                    if heuristic_output is None:
                        openai_failed_topics += 1
                        failed_topics += 1
                        reasons["openai_failed"] = reasons.get("openai_failed", 0) + 1
                        log_event(
                            logger,
                            logging.ERROR,
                            "trend_title_topic_failed",
                            reason=reason,
                            topic_key=context["topic_key"],
                            raw_label=context["raw_label"],
                            error=str(error),
                        )
                        continue
                    structured_output = heuristic_output
                    usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
                    raw_response_text = ""
                    validator_errors = ["openai_failed", "heuristic_visible_title"]
                    openai_failed_topics += 1
                    reasons["openai_failed"] = reasons.get("openai_failed", 0) + 1
                    topic_duration_ms = 0.0
                except OpenAIEnrichmentOutputError as error:
                    structured_output = _build_heuristic_visible_title_output(
                        raw_label=context["raw_label"],
                        representative_posts=context["representative_posts"],
                        reason_code="invalid_model_output",
                    )
                    if structured_output is None:
                        structured_output = _build_safe_title_output(
                            status="insufficient_evidence",
                            representative_posts=context["representative_posts"],
                            reason_text="Generated visible title could not be parsed safely.",
                            reason_codes=_dedupe_text_list(
                                [*(error.validator_errors or []), "invalid_model_output"],
                                limit=12,
                                item_limit=120,
                            ),
                            confidence_override=0.1,
                        )
                    usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
                    raw_response_text = error.raw_response_text
                    validator_errors = _dedupe_text_list(
                        [*(error.validator_errors or []), "invalid_model_output"],
                        limit=12,
                        item_limit=120,
                    )
                    topic_duration_ms = 0.0
                except Exception as error:
                    failed_topics += 1
                    reasons["title_generation_failed"] = reasons.get("title_generation_failed", 0) + 1
                    log_event(
                        logger,
                        logging.ERROR,
                        "trend_title_topic_failed",
                        reason=reason,
                        topic_key=context["topic_key"],
                        raw_label=context["raw_label"],
                        error=str(error),
                    )
                    continue
                usage_prompt_tokens += _safe_int(usage.get("prompt_tokens"))
                usage_completion_tokens += _safe_int(usage.get("completion_tokens"))
                usage_total_tokens += _safe_int(usage.get("total_tokens"))

                now_value = datetime.now(timezone.utc)
                expires_at = now_value + timedelta(hours=max(0.5, config.stale_after_hours))
                payload = _build_enrichment_row_payload(
                    topic_key=context["topic_key"],
                    window_end=context["window_end"],
                    raw_label=context["raw_label"],
                    structured_output=structured_output,
                    representative_posts=context["representative_posts"],
                    input_hash=context["input_hash"],
                    model_name=config.model_name,
                    prompt_version=config.prompt_version,
                    refresh_reason=context["refresh_reason"],
                    reason=reason,
                    cluster_diagnostics=context["cluster_diagnostics"],
                    usage=usage,
                    validator_errors=validator_errors,
                    raw_response_text=raw_response_text,
                    generated_at=now_value,
                    expires_at=expires_at,
                    duration_ms=topic_duration_ms,
                    existing_state=existing_by_topic.get(context["topic_key"]),
                    pre_llm_gate=context["cluster_quality"],
                    writer_identity=TITLE_WRITER_IDENTITY,
                    writer_role=TITLE_WRITER_ROLE,
                )
                try:
                    _insert_enrichment_run_with_repair(
                        store=store,
                        logger=logger,
                        reason=reason,
                        topic_key=context["topic_key"],
                        payload=payload,
                    )
                    should_upsert, upsert_reason = _should_upsert_current_enrichment_row(
                        existing_state=existing_by_topic.get(context["topic_key"]),
                        payload=payload,
                    )
                    persisted = None
                    if should_upsert:
                        persisted = _upsert_enrichment_row_with_repair(
                            store=store,
                            logger=logger,
                            reason=reason,
                            topic_key=context["topic_key"],
                            payload=payload,
                        )
                    else:
                        reasons[upsert_reason] = reasons.get(upsert_reason, 0) + 1
                    if persisted and persisted.get("refreshed_at"):
                        last_write_at = str(persisted.get("refreshed_at"))
                        existing_by_topic[context["topic_key"]] = {
                            "topic_key": context["topic_key"],
                            "canonical_name": str(payload.get("canonical_name") or "").strip() or None,
                            "fallback_label": str(payload.get("fallback_label") or "").strip() or None,
                            "name_status": str(payload.get("name_status") or "").strip() or None,
                            "name_source": str(payload.get("name_source") or "").strip() or None,
                            "status": str(payload.get("status") or "").strip() or None,
                            "input_hash": str(payload.get("input_hash") or "").strip(),
                            "prompt_version": str(payload.get("prompt_version") or "").strip(),
                            "model_name": str(payload.get("model_name") or "").strip(),
                            "generated_at": payload.get("generated_at"),
                            "refreshed_at": payload.get("refreshed_at"),
                            "expires_at": payload.get("expires_at"),
                            "writer_identity": str(payload.get("writer_identity") or "").strip(),
                        }
                    if _has_ready_visible_title(
                        {
                            "canonical_name": payload.get("canonical_name"),
                            "name_status": payload.get("name_status"),
                            "name_source": payload.get("name_source"),
                        }
                    ):
                        named_topics += 1
                    else:
                        abstained_topics += 1
                except Exception as error:
                    failed_topics += 1
                    db_failed_topics += 1
                    reasons["db_write_failed"] = reasons.get("db_write_failed", 0) + 1
                    log_event(
                        logger,
                        logging.ERROR,
                        "trend_title_db_write_failed",
                        reason=reason,
                        topic_key=context["topic_key"],
                        raw_label=context["raw_label"],
                        error=str(error),
                    )

    duration_ms = round((time.monotonic() - started_at_monotonic) * 1000, 1)
    estimated_cost_usd = _estimate_usage_cost_usd(
        prompt_tokens=usage_prompt_tokens,
        completion_tokens=usage_completion_tokens,
        input_rate_per_million=input_cost_rate,
        output_rate_per_million=output_cost_rate,
    )
    summary = {
        "candidate_topics": len(topics),
        "processed_topics": processed_topics,
        "attempted_topics": attempted_topics,
        "named_topics": named_topics,
        "abstained_topics": abstained_topics,
        "failed_topics": failed_topics,
        "openai_failed_topics": openai_failed_topics,
        "db_failed_topics": db_failed_topics,
        "deferred_topics": deferred_topics,
        "deferred_reason": deferred_reason,
        "skipped_unchanged": skipped_unchanged,
        "skipped_no_posts": skipped_no_posts,
        "duration_ms": duration_ms,
        "reason_counts": reasons,
        "skipped_due_to_recent_good_title": skipped_due_to_recent_good_title,
        "skipped_due_to_hash_cooldown": skipped_due_to_hash_cooldown,
        "skipped_due_to_retry_cooldown": skipped_due_to_retry_cooldown,
        "usage_prompt_tokens": usage_prompt_tokens,
        "usage_completion_tokens": usage_completion_tokens,
        "usage_total_tokens": usage_total_tokens,
        "estimated_cost_usd": estimated_cost_usd,
        "last_write_at": last_write_at,
        "model_name": config.model_name,
        "prompt_version": config.prompt_version,
        "parallelism": config.parallelism,
        "max_topics_per_pass": pass_topic_limit,
        "max_duration_seconds": config.max_duration_seconds,
        "hash_change_cooldown_hours": config.hash_change_cooldown_hours,
        "retry_after_minutes": config.retry_after_minutes,
    }
    log_event(
        logger,
        logging.INFO,
        "trend_title_batch_completed",
        reason=reason,
        summary=summary,
    )
    return summary


def run_trend_enrichment_cycle(
    *,
    store: Any,
    logger: Any,
    config: TrendEnrichmentRuntimeConfig,
    reason: str,
) -> dict[str, Any]:
    started_at_monotonic = time.monotonic()
    now = datetime.now(timezone.utc)
    input_cost_rate = _parse_float_env(
        "BLUESKY_TREND_ENRICHMENT_INPUT_COST_USD_PER_MILLION_TOKENS",
        0.0,
        0.0,
        10_000.0,
    )
    output_cost_rate = _parse_float_env(
        "BLUESKY_TREND_ENRICHMENT_OUTPUT_COST_USD_PER_MILLION_TOKENS",
        0.0,
        0.0,
        10_000.0,
    )
    if not config.enabled:
        return {"skipped": True, "reason": "disabled"}
    if not config.openai_api_key:
        return {"skipped": True, "reason": "missing_openai_api_key"}

    log_event(
        logger,
        logging.INFO,
        "trend_enrichment_batch_started",
        reason=reason,
        model_name=config.model_name,
        prompt_version=config.prompt_version,
        max_topics=config.max_topics,
        max_topics_per_pass=config.max_topics_per_pass,
        max_duration_seconds=config.max_duration_seconds,
        request_timeout_seconds=config.request_timeout_seconds,
    )
    _ensure_enrichment_schema(store=store, logger=logger, reason=reason)

    topics = store.fetch_top_topics_for_enrichment(limit=config.max_topics)
    if not topics:
        return {"skipped": True, "reason": "no_topics"}

    pass_topic_limit = max(1, min(config.max_topics, config.max_topics_per_pass))
    log_event(
        logger,
        logging.INFO,
        "trend_enrichment_topics_selected",
        reason=reason,
        selected_topics=len(topics),
        pass_topic_limit=pass_topic_limit,
    )
    topic_keys = [
        str(row.get("topic_key") or "").strip()
        for row in topics
        if str(row.get("topic_key") or "").strip()
    ]
    existing_by_topic = store.fetch_latest_topic_enrichment_state(topic_keys=topic_keys)

    enriched_count = 0
    mixed_count = 0
    abstained_count = 0
    gated_count = 0
    validator_rejected_count = 0
    skipped_unchanged = 0
    skipped_no_posts = 0
    skipped_invalid_topic_key = 0
    failed_count = 0
    openai_failed_count = 0
    db_failed_count = 0
    attempted_count = 0
    usage_prompt_tokens = 0
    usage_completion_tokens = 0
    usage_total_tokens = 0
    processed_topics = 0
    deferred_topics = 0
    deferred_reason: str | None = None
    reasons: dict[str, int] = {}
    status_counts: dict[str, int] = {}
    skipped_due_to_hash_cooldown = 0

    for topic in topics:
        elapsed_seconds = time.monotonic() - started_at_monotonic
        if attempted_count >= pass_topic_limit:
            deferred_topics = max(0, len(topics) - processed_topics)
            deferred_reason = "per_pass_topic_limit"
            reasons["per_pass_topic_limit"] = reasons.get("per_pass_topic_limit", 0) + deferred_topics
            break
        if elapsed_seconds >= max(1.0, config.max_duration_seconds):
            deferred_topics = max(0, len(topics) - processed_topics)
            deferred_reason = "max_duration_reached"
            reasons["max_duration_reached"] = reasons.get("max_duration_reached", 0) + deferred_topics
            break

        topic_started_at = time.monotonic()
        topic_key = str(topic.get("topic_key") or "").strip()
        if not topic_key:
            skipped_invalid_topic_key += 1
            reasons["invalid_topic_key"] = reasons.get("invalid_topic_key", 0) + 1
            log_event(
                logger,
                logging.WARNING,
                "trend_enrichment_topic_skipped",
                reason=reason,
                skip_reason="invalid_topic_key",
                topic=topic,
                duration_ms=round((time.monotonic() - topic_started_at) * 1000, 1),
            )
            continue
        processed_topics += 1
        raw_label = str(topic.get("topic_label") or topic_key).strip() or topic_key
        try:
            window_start = _to_utc_datetime(topic.get("window_start"))
            window_end = _to_utc_datetime(topic.get("window_end")) or now
            candidates = store.fetch_topic_post_candidates_for_enrichment(
                topic_key=topic_key,
                limit=config.candidate_post_limit,
                window_start=window_start,
                window_end=window_end,
            )
            representative_posts, sample_diagnostics = select_representative_posts(
                candidates,
                limit=config.representative_posts,
                max_post_chars=config.max_post_chars,
                min_text_chars=config.enforce_min_text_chars,
                min_word_count=config.enforce_min_word_count,
            )
            log_event(
                logger,
                logging.INFO,
                "trend_enrichment_topic_sampled",
                reason=reason,
                topic_key=topic_key,
                raw_label=raw_label,
                candidate_posts=len(candidates),
                representative_posts=len(representative_posts),
                sample_diagnostics=sample_diagnostics,
            )
            if not representative_posts:
                skipped_no_posts += 1
                reasons["no_representative_posts"] = reasons.get("no_representative_posts", 0) + 1
                log_event(
                    logger,
                    logging.INFO,
                    "trend_enrichment_topic_skipped",
                    reason=reason,
                    topic_key=topic_key,
                    raw_label=raw_label,
                    skip_reason="no_representative_posts",
                    candidate_posts=len(candidates),
                    duration_ms=round((time.monotonic() - topic_started_at) * 1000, 1),
                )
                continue

            input_hash = build_enrichment_input_hash(
                topic_row=topic,
                representative_posts=representative_posts,
            )
            existing_state = existing_by_topic.get(topic_key)
            should_refresh, refresh_reason = _should_refresh_enrichment(
                existing_state=existing_state,
                input_hash=input_hash,
                model_name=config.model_name,
                prompt_version=config.prompt_version,
                stale_after_hours=config.stale_after_hours,
                hash_change_cooldown_hours=config.hash_change_cooldown_hours,
                now=now,
            )
            reasons[refresh_reason] = reasons.get(refresh_reason, 0) + 1
            if not should_refresh:
                skipped_unchanged += 1
                if "cooldown" in refresh_reason:
                    skipped_due_to_hash_cooldown += 1
                log_event(
                    logger,
                    logging.INFO,
                    "trend_enrichment_topic_skipped",
                    reason=reason,
                    topic_key=topic_key,
                    raw_label=raw_label,
                    skip_reason=refresh_reason,
                    duration_ms=round((time.monotonic() - topic_started_at) * 1000, 1),
                )
                continue

            cluster_quality = _evaluate_cluster_quality(
                topic_row=topic,
                raw_label=raw_label,
                topic_key=topic_key,
                representative_posts=representative_posts,
                cluster_diagnostics=sample_diagnostics,
                config=config,
            )
            cluster_diagnostics = {
                **sample_diagnostics,
                "gate_status": cluster_quality["status"],
                "gate_reason_codes": cluster_quality["reason_codes"],
                "gate_reason_text": cluster_quality["reason_text"],
                "gate_passed": cluster_quality["passed"],
                "evaluated_unique_posts": cluster_quality["unique_posts"],
                "evaluated_unique_authors": cluster_quality["unique_authors"],
                "evaluated_top_author_share": cluster_quality["top_author_share"],
            }

            usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
            validator_errors: list[str] = []
            raw_response_text = ""
            structured_output: dict[str, Any]

            if not cluster_quality["passed"]:
                gated_count += 1
                reasons[f"gate_{cluster_quality['status']}"] = reasons.get(
                    f"gate_{cluster_quality['status']}",
                    0,
                ) + 1
                structured_output = _build_safe_structured_output(
                    status=str(cluster_quality["status"]),
                    raw_label=raw_label,
                    topic_key=topic_key,
                    representative_posts=representative_posts,
                    reason_text=str(cluster_quality["reason_text"]),
                    reason_codes=list(cluster_quality["reason_codes"]),
                    cluster_diagnostics=cluster_diagnostics,
                )
            else:
                attempted_count += 1
                prompt_input = _summarize_prompt_input(
                    topic_row=topic,
                    representative_posts=representative_posts,
                    cluster_diagnostics=cluster_diagnostics,
                )

                if config.simulated_delay_seconds > 0:
                    time.sleep(config.simulated_delay_seconds)
                log_event(
                    logger,
                    logging.INFO,
                    "trend_enrichment_topic_started",
                    reason=reason,
                    topic_key=topic_key,
                    raw_label=raw_label,
                    refresh_reason=refresh_reason,
                    representative_posts=len(representative_posts),
                    coherence_score=round(_safe_float(cluster_diagnostics.get("coherence_score")), 4),
                )
                try:
                    structured_output, usage, raw_response_text = _call_openai_for_enrichment(
                        api_key=config.openai_api_key,
                        model_name=config.model_name,
                        prompt_version=config.prompt_version,
                        prompt_input=prompt_input,
                        timeout_seconds=config.request_timeout_seconds,
                        max_retries=config.max_retries,
                        retry_backoff_seconds=config.retry_backoff_seconds,
                        logger=logger,
                        topic_key=topic_key,
                    )
                    structured_output = _rewrite_compound_canonical_name(
                        structured_output=structured_output,
                        raw_label=raw_label,
                        representative_posts=representative_posts,
                    )
                    usage_prompt_tokens += _safe_int(usage.get("prompt_tokens"))
                    usage_completion_tokens += _safe_int(usage.get("completion_tokens"))
                    usage_total_tokens += _safe_int(usage.get("total_tokens"))
                    validator_errors = _validate_model_output_against_evidence(
                        model_output=structured_output,
                        representative_posts=representative_posts,
                        cluster_diagnostics=cluster_diagnostics,
                    )
                    if validator_errors:
                        validator_rejected_count += 1
                        reasons["validator_rejected"] = reasons.get("validator_rejected", 0) + 1
                        structured_output = _build_safe_structured_output(
                            status="insufficient_evidence",
                            raw_label=raw_label,
                            topic_key=topic_key,
                            representative_posts=representative_posts,
                            reason_text="Model output could not be validated against supplied evidence.",
                            reason_codes=validator_errors,
                            cluster_diagnostics=cluster_diagnostics,
                            custom_summary=(
                                "Model output was rejected because it could not be validated against the supplied evidence, "
                                "so narrative enrichment abstained for this window."
                            ),
                            confidence_override=0.12,
                        )
                    else:
                        _clamp_model_confidence(
                            structured_output=structured_output,
                            cluster_diagnostics=cluster_diagnostics,
                        )
                except OpenAIEnrichmentOutputError as error:
                    validator_rejected_count += 1
                    reasons["invalid_model_output"] = reasons.get("invalid_model_output", 0) + 1
                    validator_errors = _dedupe_text_list(
                        [*(error.validator_errors or []), "invalid_model_output"],
                        limit=12,
                        item_limit=120,
                    )
                    raw_response_text = error.raw_response_text
                    structured_output = _build_safe_structured_output(
                        status="insufficient_evidence",
                        raw_label=raw_label,
                        topic_key=topic_key,
                        representative_posts=representative_posts,
                        reason_text="Model output could not be parsed or validated safely.",
                        reason_codes=validator_errors,
                        cluster_diagnostics=cluster_diagnostics,
                        custom_summary=(
                            "Model output was invalid for this cluster, so narrative enrichment abstained for this window."
                        ),
                        confidence_override=0.1,
                    )
                except OpenAIEnrichmentTransportError as error:
                    openai_failed_count += 1
                    reasons["openai_failed"] = reasons.get("openai_failed", 0) + 1
                    failed_count += 1
                    log_event(
                        logger,
                        logging.ERROR,
                        "trend_enrichment_topic_failed",
                        reason=reason,
                        topic_key=topic_key,
                        raw_label=raw_label,
                        error=str(error),
                        duration_ms=round((time.monotonic() - topic_started_at) * 1000, 1),
                    )
                    continue

            now_value = datetime.now(timezone.utc)
            expires_at = now_value + timedelta(hours=max(0.5, config.stale_after_hours))
            enrichment_row_payload = _build_enrichment_row_payload(
                topic_key=topic_key,
                window_end=window_end,
                raw_label=raw_label,
                structured_output=structured_output,
                representative_posts=representative_posts,
                input_hash=input_hash,
                model_name=config.model_name,
                prompt_version=config.prompt_version,
                refresh_reason=refresh_reason,
                reason=reason,
                cluster_diagnostics=cluster_diagnostics,
                usage=usage,
                validator_errors=validator_errors,
                raw_response_text=raw_response_text,
                generated_at=now_value,
                expires_at=expires_at,
                duration_ms=round((time.monotonic() - topic_started_at) * 1000, 3),
                existing_state=existing_state,
                pre_llm_gate=cluster_quality,
                writer_identity=ENRICHMENT_WRITER_IDENTITY,
                writer_role=ENRICHMENT_WRITER_ROLE,
            )
            _insert_enrichment_run_with_repair(
                store=store,
                logger=logger,
                reason=reason,
                topic_key=topic_key,
                payload=enrichment_row_payload,
            )
            should_upsert, upsert_reason = _should_upsert_current_enrichment_row(
                existing_state=existing_state,
                payload=enrichment_row_payload,
            )
            persisted = None
            if should_upsert:
                persisted = _upsert_enrichment_row_with_repair(
                    store=store,
                    logger=logger,
                    reason=reason,
                    topic_key=topic_key,
                    payload=enrichment_row_payload,
                )
            else:
                reasons[upsert_reason] = reasons.get(upsert_reason, 0) + 1

            if persisted:
                status = str(structured_output.get("status") or "insufficient_evidence").strip().lower()
                status_counts[status] = status_counts.get(status, 0) + 1
                if status == "ok":
                    enriched_count += 1
                elif status == "mixed":
                    mixed_count += 1
                else:
                    abstained_count += 1

                existing_by_topic[topic_key] = {
                    "topic_key": topic_key,
                    "as_of_window_end": window_end,
                    "input_hash": input_hash,
                    "prompt_version": config.prompt_version,
                    "model_name": config.model_name,
                    "generated_at": now_value,
                    "refreshed_at": now_value,
                    "expires_at": expires_at,
                    "summary_confidence": _safe_float(structured_output.get("confidence")),
                }
                log_event(
                    logger,
                    logging.INFO,
                    "trend_enrichment_db_write_succeeded",
                    reason=reason,
                    topic_key=topic_key,
                    raw_label=raw_label,
                    representative_posts=len(representative_posts),
                    status=status,
                    validator_errors=validator_errors,
                    duration_ms=round((time.monotonic() - topic_started_at) * 1000, 1),
                )
            else:
                db_failed_count += 1
                failed_count += 1
                reasons["db_write_returned_empty"] = reasons.get("db_write_returned_empty", 0) + 1
                log_event(
                    logger,
                    logging.ERROR,
                    "trend_enrichment_db_write_failed",
                    reason=reason,
                    topic_key=topic_key,
                    raw_label=raw_label,
                    error="upsert_topic_ai_enrichment returned no row",
                    duration_ms=round((time.monotonic() - topic_started_at) * 1000, 1),
                )
        except Exception as error:
            db_failed_count += 1
            reasons["topic_processing_failed"] = reasons.get("topic_processing_failed", 0) + 1
            failed_count += 1
            log_event(
                logger,
                logging.ERROR,
                "trend_enrichment_topic_failed",
                reason=reason,
                topic_key=topic_key,
                raw_label=raw_label,
                error=str(error),
                duration_ms=round((time.monotonic() - topic_started_at) * 1000, 1),
            )
            continue

    duration_ms = round((time.monotonic() - started_at_monotonic) * 1000, 1)
    estimated_cost_usd = _estimate_usage_cost_usd(
        prompt_tokens=usage_prompt_tokens,
        completion_tokens=usage_completion_tokens,
        input_rate_per_million=input_cost_rate,
        output_rate_per_million=output_cost_rate,
    )
    summary = {
        "candidate_topics": len(topics),
        "processed_topics": processed_topics,
        "attempted_topics": attempted_count,
        "enriched_topics": enriched_count,
        "mixed_topics": mixed_count,
        "abstained_topics": abstained_count,
        "gated_topics": gated_count,
        "validator_rejected_topics": validator_rejected_count,
        "failed_topics": failed_count,
        "openai_failed_topics": openai_failed_count,
        "db_failed_topics": db_failed_count,
        "deferred_topics": deferred_topics,
        "deferred_reason": deferred_reason,
        "skipped_unchanged": skipped_unchanged,
        "skipped_no_posts": skipped_no_posts,
        "skipped_invalid_topic_key": skipped_invalid_topic_key,
        "usage_prompt_tokens": usage_prompt_tokens,
        "usage_completion_tokens": usage_completion_tokens,
        "usage_total_tokens": usage_total_tokens,
        "estimated_cost_usd": estimated_cost_usd,
        "duration_ms": duration_ms,
        "reason_counts": reasons,
        "status_counts": status_counts,
        "skipped_due_to_hash_cooldown": skipped_due_to_hash_cooldown,
        "model_name": config.model_name,
        "prompt_version": config.prompt_version,
        "top_topics_limit": config.max_topics,
        "max_topics_per_pass": pass_topic_limit,
        "max_duration_seconds": config.max_duration_seconds,
        "hash_change_cooldown_hours": config.hash_change_cooldown_hours,
    }
    log_event(
        logger,
        logging.INFO,
        "trend_enrichment_batch_completed",
        reason=reason,
        summary=summary,
    )
    return summary
