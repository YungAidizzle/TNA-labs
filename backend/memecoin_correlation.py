from __future__ import annotations

import logging
import math
import os
import re
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Any
from urllib.parse import urlparse

from backend.dexscreener_client import DexscreenerClient
from backend.logging_setup import log_event
from backend.topic_rules import TOPIC_GENERIC_WEAK_TOKENS, TOPIC_NOISE_TOKENS, topic_tokens
from backend.tradingview_preview import (
    PersistedTradingViewState,
    TradingViewPreviewVerifier,
    TradingViewResolverInput,
    TradingViewVerificationResult,
)


QUOTE_SYMBOL_BONUS = {
    "SOL": 14,
    "USDC": 14,
    "USDT": 14,
    "USDt": 14,
    "WETH": 12,
    "ETH": 12,
    "WBTC": 10,
    "BTC": 10,
    "BNB": 10,
    "WBNB": 10,
}
COMMON_QUOTE_SYMBOLS = set(QUOTE_SYMBOL_BONUS.keys())
GENERIC_CASHTAG_BLACKLIST = {
    "AI",
    "API",
    "BTC",
    "ETH",
    "SOL",
    "USD",
    "USDC",
    "USDT",
    "WETH",
    "BNB",
}
GENERIC_SEED_TERMS = {
    "alert",
    "article",
    "board",
    "breaking",
    "cluster",
    "coin",
    "coins",
    "commentary",
    "community",
    "content",
    "creator",
    "crypto",
    "daily",
    "dashboard",
    "debate",
    "detail",
    "discussion",
    "ecosystem",
    "event",
    "feed",
    "headline",
    "label",
    "live",
    "loading",
    "media",
    "meme",
    "memecoin",
    "mentions",
    "mixed",
    "narrative",
    "news",
    "online",
    "people",
    "platform",
    "post",
    "posts",
    "refresh",
    "report",
    "score",
    "seed",
    "signal",
    "signals",
    "social",
    "story",
    "stream",
    "topic",
    "topics",
    "trend",
    "trends",
    "update",
    "updates",
    "viral",
}
NARRATIVE_GENERIC_MATCH_TOKENS = {
    *GENERIC_SEED_TERMS,
    "acceleration",
    "act",
    "agents",
    "ai",
    "business",
    "campaign",
    "celebrity",
    "clip",
    "clips",
    "conflict",
    "crackdown",
    "culture",
    "economy",
    "economic",
    "election",
    "escalation",
    "fed",
    "geopolitics",
    "government",
    "inflation",
    "jitters",
    "macro",
    "market",
    "markets",
    "policy",
    "push",
    "rates",
    "risk",
    "rotation",
    "surge",
    "tech",
    "war",
}
NARRATIVE_ALIAS_GROUPS: dict[str, tuple[str, ...]] = {
    "openai": ("openai", "chatgpt", "gpt"),
    "anthropic": ("anthropic", "claude"),
    "federal-reserve": (
        "fed",
        "federal reserve",
        "jerome powell",
        "powell",
        "money printer",
        "printer go brr",
        "brr",
        "brrr",
    ),
    "trump": ("trump", "donald trump", "maga"),
    "iran": ("iran", "iranian"),
    "israel": ("israel", "israeli"),
    "ukraine": ("ukraine", "ukrainian"),
    "russia": ("russia", "russian", "putin"),
    "bitcoin-etf": ("bitcoin etf", "btc etf", "spot bitcoin etf", "blackrock", "ishares"),
    "tesla-musk": ("elon", "musk", "tesla", "grok", "xai"),
}
LOW_INFORMATION_LABEL_TOKENS = {
    "broad",
    "cluster",
    "commentary",
    "discussion",
    "general",
    "group",
    "media",
    "mentions",
    "mixed",
    "news",
    "posts",
    "signals",
    "topic",
    "trending",
    "updates",
}
TREND_CULTURE_SIGNAL_TERMS = {
    "anime",
    "arcade",
    "fandom",
    "fanart",
    "fanbase",
    "franchise",
    "game",
    "gaming",
    "gamer",
    "hashtag",
    "irl",
    "manga",
    "meme",
    "reaction",
    "shitpost",
    "slang",
    "streamer",
    "tiktok",
    "timeline",
    "trend",
    "twitch",
    "viral",
    "vtuber",
    "waifu",
    "youtube",
}
TREND_BUCKET_SELECTION_ORDER = (
    "meme",
    "internet_culture",
    "gaming",
    "entertainment",
    "creator",
    "ai_tech",
)
SEED_CLASS_PRIORITY = {
    "primary": 60.0,
    "entity": 52.0,
    "cashtag": 50.0,
    "hashtag": 44.0,
    "phrase": 40.0,
    "topic_seed": 38.0,
    "tag": 34.0,
    "alias": 32.0,
    "fragment": 28.0,
    "community": 24.0,
}
SYMBOL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{1,14}$")
TOKEN_PATTERN = re.compile(r"[a-z0-9$#][a-z0-9$#'_-]{1,63}")
WHITESPACE_PATTERN = re.compile(r"\s+")
URL_PATTERN = re.compile(r"https?://\S+", re.IGNORECASE)
TREND_MEMECOIN_LINK_LIMIT = 5
TREND_MEMECOIN_LINK_TARGET_MIN = 3

PREFERRED_CATEGORY_TERMS: dict[str, set[str]] = {
    "meme": {
        "meme",
        "memes",
        "shitpost",
        "shitposting",
        "viral",
        "virality",
        "frog",
        "doge",
        "dog",
        "pepe",
        "reaction image",
        "joke",
        "parody",
    },
    "internet_culture": {
        "internet",
        "online",
        "timeline",
        "twitter",
        "x.com",
        "tiktok",
        "twitch",
        "discord",
        "reddit",
        "bluesky",
        "copypasta",
        "stream",
        "trend",
    },
    "entertainment": {
        "movie",
        "film",
        "music",
        "album",
        "artist",
        "celebrity",
        "show",
        "series",
        "anime",
        "manga",
        "tv",
        "box office",
    },
    "gaming": {
        "gaming",
        "game",
        "gamer",
        "esports",
        "xbox",
        "playstation",
        "switch",
        "steam",
        "minecraft",
        "fortnite",
        "roblox",
        "league",
        "nintendo",
    },
    "creator": {
        "creator",
        "influencer",
        "streamer",
        "youtube",
        "youtuber",
        "podcast",
        "vtuber",
        "tiktok",
        "channel",
        "fanbase",
        "community",
        "onlyfans",
    },
    "ai_tech": {
        "ai",
        "artificial intelligence",
        "agent",
        "agents",
        "openai",
        "gpt",
        "claude",
        "llm",
        "robot",
        "model",
        "tech",
        "gpu",
        "chip",
        "automation",
    },
}
DEPRIORITIZED_TERMS: dict[str, set[str]] = {
    "politics": {
        "trump",
        "maga",
        "election",
        "republican",
        "democrat",
        "white house",
        "congress",
        "senate",
        "policy",
        "government",
        "tariff",
        "fed",
        "putin",
        "netanyahu",
        "war",
        "campaign",
    },
    "macro": {
        "inflation",
        "rates",
        "gdp",
        "macro",
        "cpi",
        "policy",
        "yield",
        "treasury",
        "economy",
        "recession",
    },
    "finance": {
        "earnings",
        "stocks",
        "equity",
        "nasdaq",
        "s&p",
        "sp500",
        "dow",
        "portfolio",
        "options",
        "futures",
    },
    "news": {
        "breaking",
        "update",
        "headline",
        "developing",
        "police",
        "weather",
        "traffic",
        "shooting",
        "press release",
        "statement",
    },
}
MEMECOIN_STYLE_TERMS = {
    "meme",
    "memecoin",
    "meme coin",
    "cto",
    "community takeover",
    "cult",
    "degen",
    "viral",
    "shitpost",
    "shitcoin",
    "dog",
    "doge",
    "cat",
    "frog",
    "pepe",
    "bonk",
    "wif",
    "fart",
    "mog",
    "chad",
    "giga",
    "anime",
    "waifu",
}
UTILITY_TOKEN_TERMS = {
    "protocol",
    "infrastructure",
    "bridge",
    "staking",
    "restaking",
    "validator",
    "node",
    "wallet",
    "oracle",
    "governance",
    "lending",
    "borrow",
    "yield",
    "stablecoin",
    "payments",
    "payment",
    "settlement",
    "perpetual",
    "perps",
    "derivatives",
    "launchpad",
    "layer 1",
    "layer 2",
    "rollup",
    "mainnet",
    "testnet",
    "router",
    "swap",
    "dex",
    "exchange",
    "liquid staking",
    "cross-chain",
    "cross chain",
    "consensus",
    "data availability",
    "rwa",
    "real world asset",
}
SOCIAL_PLATFORM_TERMS = {
    "telegram",
    "discord",
    "twitter",
    "x.com",
    "tiktok",
    "youtube",
    "twitch",
}
TRUSTED_TREND_NAME_SOURCES = {
    "ai_exact",
    "historical_exact",
    "historical_alias",
}
NON_GENERIC_SINGLE_TREND_LABELS = SOCIAL_PLATFORM_TERMS.union(
    {
        "nintendo",
        "openai",
        "chatgpt",
        "discord",
        "telegram",
        "netflix",
        "spotify",
        "marvel",
        "pixar",
        "roblox",
        "minecraft",
        "fortnite",
        "pokemon",
        "anime",
        "manga",
        "hololive",
    }
)
STOPWORD_TOKENS = {
    "a",
    "about",
    "after",
    "all",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "by",
    "for",
    "from",
    "has",
    "have",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "of",
    "on",
    "or",
    "that",
    "the",
    "their",
    "this",
    "to",
    "was",
    "were",
    "with",
    "you",
}
LOW_SIGNAL_TREND_TEXT_FRAGMENTS = {
    "safe fallback because ai enrichment was unavailable for this cycle",
    "ai trend naming failed for this visible topic during the current request",
    "signals are still mixed across sampled posts",
    "signals are directionally related but still broad",
    "trend detected from recent social posts",
    "discussion trend detected from recent social posts",
}
LOW_SIGNAL_TREND_STATUS = {
    "failed",
    "insufficient_evidence",
}
LOW_SIGNAL_TREND_CATEGORIES = {
    "mixed discussion cluster",
    "general discussion",
    "broad discussion",
    "insufficient evidence",
}
PREFERRED_TREND_CATEGORY_BUCKETS: dict[str, set[str]] = {
    "meme": {"meme", "memes"},
    "internet_culture": {"culture", "internet culture", "media"},
    "entertainment": {"entertainment", "music", "anime", "movies", "film", "tv"},
    "gaming": {"gaming", "games"},
    "creator": {"creator", "creator / influencer", "influencer"},
    "ai_tech": {"ai", "technology", "science and technology", "tech"},
}
DEPRIORITIZED_TREND_CATEGORY_BUCKETS: dict[str, set[str]] = {
    "politics": {"politics", "policy"},
    "macro": {"macro", "economy"},
    "finance": {"markets", "commerce"},
    "news": {"general discussion", "public safety", "weather", "weather alerts", "transport", "local transit"},
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


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


def _parse_int_env_with_aliases(
    primary: str,
    aliases: tuple[str, ...],
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    for name in (primary, *aliases):
        value = str(os.getenv(name, "")).strip()
        if not value:
            continue
        try:
            parsed = int(value)
        except ValueError:
            continue
        return max(minimum, min(maximum, parsed))
    return default


def _parse_float_env_with_aliases(
    primary: str,
    aliases: tuple[str, ...],
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    for name in (primary, *aliases):
        value = str(os.getenv(name, "")).strip()
        if not value:
            continue
        try:
            parsed = float(value)
        except ValueError:
            continue
        return max(minimum, min(maximum, parsed))
    return default


def _normalize_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = URL_PATTERN.sub(" ", text.lower())
    text = text.replace("\n", " ").replace("\r", " ")
    text = re.sub(r"[^a-z0-9$#\s'_-]+", " ", text)
    return WHITESPACE_PATTERN.sub(" ", text).strip()


def _compact_identity(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", _normalize_text(value))


def _tokenize(value: Any) -> list[str]:
    tokens: list[str] = []
    for token in TOKEN_PATTERN.findall(_normalize_text(value)):
        normalized = str(token or "").strip("._-")
        if not normalized or normalized in STOPWORD_TOKENS:
            continue
        if normalized.isdigit():
            continue
        tokens.append(normalized)
    return tokens


def _unique_preserve(values: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = str(value or "").strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(normalized)
    return output


def _is_narrative_generic_match_token(token: str) -> bool:
    return str(token or "").strip().lower() in NARRATIVE_GENERIC_MATCH_TOKENS


def _specific_match_tokens(value: Any) -> list[str]:
    return [
        token
        for token in _tokenize(value)
        if len(token) >= 3 and not _is_narrative_generic_match_token(token)
    ]


def _extract_specific_phrase_variants(value: Any, *, max_phrases: int = 6) -> list[str]:
    phrases: list[str] = []
    normalized = _normalize_text(value)
    if normalized:
        normalized_tokens = _tokenize(normalized)
        if normalized_tokens and not all(_is_narrative_generic_match_token(token) for token in normalized_tokens):
            phrases.append(normalized)
    for phrase in _extract_phrase_variants(value, max_phrases=max_phrases):
        phrase_tokens = _tokenize(phrase)
        if phrase_tokens and not all(_is_narrative_generic_match_token(token) for token in phrase_tokens):
            phrases.append(phrase)
    return _unique_preserve(phrases)


def _extract_alias_groups(values: list[Any]) -> list[str]:
    combined = " ".join(_normalize_text(value) for value in values if _normalize_text(value))
    token_set = set(_tokenize(combined))
    groups: list[str] = []
    for group, aliases in NARRATIVE_ALIAS_GROUPS.items():
        matched = False
        for alias in aliases:
            normalized_alias = _normalize_text(alias)
            if not normalized_alias:
                continue
            if " " in normalized_alias:
                if normalized_alias in combined:
                    matched = True
                    break
            elif normalized_alias in token_set:
                matched = True
                break
        if matched:
            groups.append(group)
    return _unique_preserve(groups)


def _increment_count(counts: dict[str, int], key: str, amount: int = 1) -> None:
    normalized_key = str(key or "").strip()
    if not normalized_key:
        return
    counts[normalized_key] = counts.get(normalized_key, 0) + amount


def _merge_count_maps(*count_maps: dict[str, int]) -> dict[str, int]:
    merged: dict[str, int] = {}
    for count_map in count_maps:
        for key, value in count_map.items():
            _increment_count(merged, key, int(value or 0))
    return merged


def _coerce_text_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return _unique_preserve([str(item or "").strip() for item in value if str(item or "").strip()])
    return []


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value if value is not None else default)
    except (TypeError, ValueError):
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value if value is not None else default)
    except (TypeError, ValueError):
        return default


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _log_score(value: float, *, weight: float, cap: float) -> float:
    if value <= 0:
        return 0.0
    return min(cap, math.log10(value + 1) * weight)


def _parse_iso_datetime(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _age_hours_from(value: Any, now: datetime) -> float | None:
    timestamp = _parse_iso_datetime(value)
    if timestamp is None:
        return None
    return max(0.0, (now - timestamp).total_seconds() / 3600.0)


def _keywords_present(text: str, keywords: set[str]) -> int:
    normalized_text = _normalize_text(text)
    if not normalized_text:
        return 0
    text_tokens = set(_tokenize(normalized_text))
    hits = 0
    for keyword in keywords:
        normalized_keyword = _normalize_text(keyword)
        if not normalized_keyword:
            continue
        keyword_tokens = _tokenize(normalized_keyword)
        if not keyword_tokens:
            continue
        if len(keyword_tokens) == 1 and keyword_tokens[0] == normalized_keyword:
            if keyword_tokens[0] in text_tokens:
                hits += 1
            continue
        phrase = " ".join(keyword_tokens)
        if phrase and phrase in normalized_text:
            hits += 1
    return hits


def _token_sequence(value: Any) -> list[str]:
    return [
        token
        for token in _tokenize(value)
        if token not in GENERIC_SEED_TERMS
        and token not in LOW_INFORMATION_LABEL_TOKENS
    ]


def _seed_identity(value: Any) -> str:
    return _compact_identity(value)


def _seed_family_key(value: Any) -> str:
    return _seed_identity(value)


def _seed_query_base(value: Any) -> str:
    normalized = _normalize_text(value)
    if not normalized:
        return ""
    parts = [part for part in normalized.split(" ") if part and part not in GENERIC_SEED_TERMS]
    return " ".join(parts[:4]).strip()


def _is_seed_term_low_information(value: str) -> bool:
    normalized = _normalize_text(value)
    if not normalized:
        return True
    tokens = _token_sequence(normalized)
    if not tokens:
        return True
    if len(tokens) == 1 and (tokens[0] in GENERIC_SEED_TERMS or len(tokens[0]) <= 2):
        return True
    return all(token in GENERIC_SEED_TERMS for token in tokens)


def _seed_term_variants(value: str) -> list[str]:
    normalized = str(value or "").strip()
    if not normalized:
        return []
    variants: list[str] = [normalized]
    stripped = normalized.lstrip("#$")
    if stripped and stripped != normalized:
        variants.append(stripped)
    base = _seed_query_base(normalized)
    if base and base.lower() != normalized.lower():
        variants.append(base)
    tokens = _token_sequence(normalized)
    if 1 < len(tokens) <= 3:
        compact = "".join(tokens)
        if 3 <= len(compact) <= 20:
            variants.append(compact)
        acronym = "".join(token[0] for token in tokens if token)
        if 2 <= len(acronym) <= 8:
            variants.append(acronym)
    if len(tokens) >= 2:
        variants.append(" ".join(tokens[:2]))
        variants.append(" ".join(tokens[-2:]))
    if len(tokens) >= 3:
        variants.append(" ".join(tokens[:3]))
    topical_tokens = [token for token in tokens if len(token) >= 4]
    if topical_tokens:
        variants.append(topical_tokens[0])
        variants.append(topical_tokens[-1])
        base_phrase = " ".join(topical_tokens[:2]) if len(topical_tokens) >= 2 else topical_tokens[0]
        if base_phrase:
            if "meme" not in base_phrase:
                variants.append(f"{base_phrase} meme")
            if "coin" not in base_phrase:
                variants.append(f"{base_phrase} coin")
            variants.append(f"{base_phrase} cto")
    for token in tokens:
        if len(token) >= 3:
            variants.append(token)
    return _unique_preserve(
        [
            variant
            for variant in variants
            if _is_seed_term_usable(variant) and not _is_seed_term_low_information(variant)
        ]
    )


def _extract_phrase_variants(value: Any, *, max_phrases: int = 4) -> list[str]:
    tokens = _token_sequence(value)
    if len(tokens) < 2:
        return []
    phrases: list[str] = []
    for size in (3, 2):
        if len(tokens) < size:
            continue
        for index in range(0, len(tokens) - size + 1):
            phrase_tokens = tokens[index : index + size]
            if any(token in GENERIC_SEED_TERMS for token in phrase_tokens):
                continue
            phrase = " ".join(phrase_tokens)
            if _is_seed_term_usable(phrase) and not _is_seed_term_low_information(phrase):
                phrases.append(phrase)
            if len(phrases) >= max_phrases:
                return _unique_preserve(phrases)
    return _unique_preserve(phrases)


def _extract_token_variants(
    value: Any,
    *,
    max_terms: int = 6,
    min_length: int = 3,
) -> list[str]:
    return _unique_preserve(
        [
            token
            for token in _token_sequence(value)
            if len(token) >= min_length and token not in TOPIC_GENERIC_WEAK_TOKENS
        ][:max_terms]
    )


def _partial_overlap_term_score(left: str, right: str) -> float:
    normalized_left = _compact_identity(left)
    normalized_right = _compact_identity(right)
    if not normalized_left or not normalized_right or normalized_left == normalized_right:
        return 0.0
    shorter, longer = sorted((normalized_left, normalized_right), key=len)
    if len(shorter) < 4:
        return 0.0
    if shorter in longer:
        return len(shorter) / max(len(longer), 1)
    prefix_size = min(4, len(shorter), len(longer))
    if prefix_size >= 3 and shorter[:prefix_size] == longer[:prefix_size]:
        return 0.55 + prefix_size * 0.08
    return 0.0


def _collect_partial_overlap_terms(
    left_terms: set[str],
    right_terms: set[str],
    *,
    limit: int = 5,
) -> list[str]:
    matches: list[tuple[float, str]] = []
    seen: set[str] = set()
    for left_term in sorted(left_terms):
        for right_term in sorted(right_terms):
            score = _partial_overlap_term_score(left_term, right_term)
            if score <= 0:
                continue
            label = left_term if len(left_term) <= len(right_term) else right_term
            if label in seen:
                continue
            seen.add(label)
            matches.append((score, label))
            break
    matches.sort(key=lambda item: (item[0], len(item[1]), item[1]), reverse=True)
    return [label for _score, label in matches[:limit]]


def _best_similarity_match(
    value: Any,
    candidates: list[str],
) -> tuple[float, str | None]:
    normalized_value = _compact_identity(value)
    if not normalized_value:
        return 0.0, None
    best_score = 0.0
    best_candidate: str | None = None
    for candidate in candidates:
        normalized_candidate = _compact_identity(candidate)
        if not normalized_candidate:
            continue
        score = SequenceMatcher(None, normalized_value, normalized_candidate).ratio()
        overlap_score = _partial_overlap_term_score(normalized_value, normalized_candidate)
        effective_score = max(score, overlap_score)
        if effective_score > best_score:
            best_score = effective_score
            best_candidate = candidate
    return best_score, best_candidate


def _confidence_band_from_score(score: float) -> str:
    if score >= 80.0:
        return "high"
    if score >= 60.0:
        return "medium"
    if score >= 40.0:
        return "speculative"
    return "coverage"


def _normalized_trend_category_bucket(category: Any) -> str | None:
    normalized = _normalize_text(category)
    if not normalized:
        return None
    for bucket, labels in PREFERRED_TREND_CATEGORY_BUCKETS.items():
        if normalized in labels:
            return bucket
    for bucket, labels in DEPRIORITIZED_TREND_CATEGORY_BUCKETS.items():
        if normalized in labels:
            return bucket
    return None


def _is_low_signal_trend_text(value: Any) -> bool:
    normalized = _normalize_text(value)
    if not normalized:
        return False
    return any(fragment in normalized for fragment in LOW_SIGNAL_TREND_TEXT_FRAGMENTS)


def _clean_trend_context(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if _is_low_signal_trend_text(text):
        return ""
    return text


def _has_structured_trend_entities(values: list[str]) -> bool:
    for value in values:
        text = str(value or "").strip()
        if text.startswith("$") or text.startswith("#"):
            return True
        tokens = topic_tokens(text)
        informative_tokens = [
            token
            for token in tokens
            if token not in TOPIC_GENERIC_WEAK_TOKENS
            and token not in TOPIC_NOISE_TOKENS
            and len(token) >= 4
        ]
        if len(informative_tokens) >= 1:
            return True
    return False


def _should_use_trusted_trend_display_name(row: dict[str, Any]) -> bool:
    canonical_name = str(row.get("canonical_name") or "").strip()
    if not canonical_name:
        return False
    name_status = str(row.get("name_status") or "").strip().lower()
    name_source = str(row.get("name_source") or "").strip().lower()
    return name_status == "ready" and name_source in TRUSTED_TREND_NAME_SOURCES


def _choose_trend_display_label(row: dict[str, Any]) -> str:
    if _should_use_trusted_trend_display_name(row):
        canonical_name = str(row.get("canonical_name") or "").strip()
        if canonical_name:
            return canonical_name
    for key in ("fallback_label", "raw_label", "display_label", "topic_label", "topic_key"):
        value = str(row.get(key) or "").strip()
        if value:
            return value
    return ""


def _is_generic_trend_label(
    label: Any,
    *,
    key_entities: list[str],
    representative_post_count: int = 0,
    trusted_name: bool = False,
) -> bool:
    if trusted_name:
        return False
    tokens = topic_tokens(str(label or ""))
    if not tokens:
        return True
    if len(tokens) == 1:
        return tokens[0] not in NON_GENERIC_SINGLE_TREND_LABELS
    if _has_structured_trend_entities(key_entities):
        return False
    informative_tokens = [
        token
        for token in tokens
        if token not in TOPIC_GENERIC_WEAK_TOKENS
        and token not in TOPIC_NOISE_TOKENS
        and token not in LOW_INFORMATION_LABEL_TOKENS
        and len(token) >= 4
    ]
    if len(informative_tokens) >= 2:
        return False
    return True


def _trend_quality_penalty(
    *,
    display_label: str,
    trend_category: str | None,
    enrichment_status: str | None,
    summary_confidence: float,
    narrative_summary: str | None,
    context_paragraph: str | None,
    key_entities: list[str],
    representative_post_count: int,
    name_status: str | None,
    name_source: str | None,
    trusted_display_name: bool,
) -> float:
    penalty = 0.0
    if str(enrichment_status or "").strip().lower() in LOW_SIGNAL_TREND_STATUS:
        penalty += 18.0
    if summary_confidence <= 0.0:
        penalty += 8.0
    elif summary_confidence < 0.2:
        penalty += 6.0
    if _is_low_signal_trend_text(narrative_summary):
        penalty += 10.0
    if _is_low_signal_trend_text(context_paragraph):
        penalty += 6.0
    normalized_category = _normalize_text(trend_category)
    if normalized_category in LOW_SIGNAL_TREND_CATEGORIES:
        penalty += 6.0
    if representative_post_count <= 2:
        penalty += 10.0
    elif representative_post_count <= 4:
        penalty += 6.0
    elif representative_post_count <= 6:
        penalty += 2.0
    if str(name_status or "").strip().lower() == "failed":
        penalty += 6.0
    if not trusted_display_name and str(name_source or "").strip().lower() in {"fallback_cleaned", "none"}:
        penalty += 3.0
    if _is_generic_trend_label(
        display_label,
        key_entities=key_entities,
        representative_post_count=representative_post_count,
        trusted_name=trusted_display_name,
    ):
        penalty += 16.0
        if not key_entities:
            penalty += 8.0
    display_tokens = set(_tokenize(display_label))
    if display_tokens.intersection(LOW_INFORMATION_LABEL_TOKENS):
        penalty += 6.0
    bucket = _normalized_trend_category_bucket(trend_category)
    if bucket in {"politics", "macro", "finance", "news"}:
        penalty += 6.0
    return penalty


def _preferred_trend_bucket(row: dict[str, Any], bias: TrendBias) -> str | None:
    explicit_bucket = _normalized_trend_category_bucket(row.get("trend_category"))
    if explicit_bucket in PREFERRED_CATEGORY_TERMS:
        return explicit_bucket
    if bias.dominant_category in PREFERRED_CATEGORY_TERMS and bias.preferred_hits.get(bias.dominant_category, 0) > 0:
        return bias.dominant_category
    return None


def _trend_category_bonus(bucket: str | None) -> float:
    return {
        "meme": 20.0,
        "internet_culture": 18.0,
        "entertainment": 16.0,
        "gaming": 16.0,
        "creator": 14.0,
        "ai_tech": 14.0,
        "politics": -18.0,
        "macro": -12.0,
        "finance": -12.0,
        "news": -8.0,
    }.get(str(bucket or "").strip(), 0.0)


def _trend_culture_bonus(
    *,
    text: str,
    key_entities: list[str],
    preferred_bucket: str | None,
    representative_post_count: int,
) -> float:
    normalized_text = _normalize_text(text)
    culture_hits = _keywords_present(normalized_text, TREND_CULTURE_SIGNAL_TERMS)
    entity_bonus = min(8.0, len([value for value in key_entities if str(value or "").strip()]) * 1.2)
    bucket_bonus = {
        "meme": 8.0,
        "internet_culture": 7.0,
        "gaming": 7.0,
        "entertainment": 6.0,
        "creator": 6.0,
        "ai_tech": 5.0,
    }.get(str(preferred_bucket or "").strip(), 0.0)
    activity_bonus = 3.0 if representative_post_count >= 10 else 1.5 if representative_post_count >= 6 else 0.0
    return min(18.0, culture_hits * 1.8 + entity_bonus + bucket_bonus + activity_bonus)


@dataclass(frozen=True)
class MemecoinCorrelationRuntimeConfig:
    enabled: bool
    interval_seconds: float
    min_cycles_between_runs: int
    defer_backlog_lag_minutes: float
    defer_if_cycle_duration_ms: float
    defer_if_cycle_events: int
    defer_if_no_ingestion_seconds: float
    max_trends: int
    max_seeds_per_trend: int
    post_lookback_hours: int
    max_posts_per_trend: int
    max_seed_queries: int
    max_pairs_per_seed: int
    discovery_expansion_depth: int
    max_discovery_tokens: int
    max_results: int
    target_published_results: int
    max_political_results: int
    max_theme_results_per_run: int
    min_trend_culture_score: float
    min_memecoin_fit_score: float
    allowed_chains: tuple[str, ...]
    minimum_basic_liquidity_usd: float
    minimum_basic_volume_24h_usd: float
    minimum_basic_txns_24h: int
    live_min_liquidity_usd: float
    live_min_volume_24h_usd: float
    live_min_recent_txns: int
    live_max_snapshot_staleness_hours: float
    min_liquidity_usd: float
    min_volume_24h_usd: float
    min_txns_24h: int
    new_pair_penalty_hours: float
    high_confidence_correlation_threshold: float
    medium_confidence_correlation_threshold: float
    exploratory_correlation_threshold: float
    medium_confidence_market_floor: float
    medium_confidence_memecoin_floor: float
    exploratory_market_floor: float
    exploratory_memecoin_floor: float
    recent_repeat_penalty_window_runs: int
    max_recent_token_appearances: int
    recent_repeat_penalty_per_hit: float
    recent_theme_penalty_per_hit: float
    max_volume_liquidity_ratio: float
    drained_liquidity_usd: float
    dead_pair_age_hours: float
    dead_liquidity_usd: float
    dead_volume_24h_usd: float
    dead_txns_24h: int
    rug_pull_price_drop_pct: float
    min_request_spacing_seconds: float
    request_timeout_seconds: float
    max_retries: int
    retry_backoff_seconds: float
    discovery_cache_ttl_seconds: int
    token_cache_ttl_seconds: int
    search_cache_ttl_seconds: int
    stale_cache_ttl_seconds: int


@dataclass
class TrendBias:
    preferred_hits: dict[str, int]
    deprioritized_hits: dict[str, int]
    culture_score: float
    political_dominant: bool
    dominant_category: str


@dataclass
class ActiveTrendCandidate:
    topic_key: str
    display_label: str
    raw_label: str
    trend_category: str | None
    enrichment_status: str | None
    summary_confidence: float
    name_status: str | None
    name_source: str | None
    representative_post_count: int
    trusted_display_name: bool
    narrative_summary: str | None
    context_paragraph: str | None
    key_entities: list[str]
    total_mentions: int
    unique_posts: int
    unique_authors: int
    last_seen_at: str | None
    window_end: str | None
    bias: TrendBias
    priority_score: float
    preferred_bucket: str | None
    quality_penalty: float
    trend_text: str


@dataclass
class RecentTrendPost:
    topic_key: str
    text: str
    normalized_text: str
    cashtags: list[str]
    hashtags: list[str]
    key_phrases: list[str]
    topic_seeds: list[str]
    tags: list[str]
    created_at: str | None
    quality_score: float
    engagement_score: float


@dataclass
class DiscoveryHint:
    chain_id: str
    token_address: str
    source_names: set[str]
    seed_terms: set[str]
    matched_trend_keys: set[str]
    description: str | None = None
    links: list[dict[str, Any]] | None = None
    cto: bool | None = None


@dataclass
class MarketCandidate:
    chain_id: str
    token_address: str
    pair_address: str
    dexscreener_url: str
    dex_id: str | None
    pair_labels: list[str]
    token_name: str
    token_symbol: str
    quote_symbol: str | None
    quote_token_address: str | None
    quote_token_name: str | None
    price_usd: float | None
    liquidity_usd: float
    volume_h24: float
    volume_h6: float
    volume_h1: float
    price_change_h24: float | None
    price_change_h6: float | None
    price_change_h1: float | None
    buys_h24: int
    sells_h24: int
    txns_h24: int
    txns_h6: int
    txns_h1: int
    fdv: float | None
    market_cap: float | None
    pair_created_at: str | None
    icon_url: str | None
    header_url: str | None
    websites: list[dict[str, Any]]
    socials: list[dict[str, Any]]
    description: str | None
    discovery_sources: set[str]
    matched_trend_keys: set[str]
    seed_terms: set[str]
    market_score: float
    memecoin_fit_score: float
    token_text: str
    normalized_symbol: str
    normalized_name: str
    political_dominant: bool
    community_takeover: bool
    is_live: bool = False
    last_validated_at: str | None = None
    validation_status: str | None = None
    validation_reason: str | None = None
    last_seen_liquidity_usd: float | None = None
    last_seen_volume_h24: float | None = None
    last_seen_txns_h24: int | None = None
    validation_source: str | None = None
    tradingview_symbol: str | None = None
    tradingview_exchange: str | None = None
    tradingview_embed_symbol: str | None = None
    tv_resolution_status: str | None = None
    tv_verified_at: str | None = None
    tv_last_checked_at: str | None = None
    tv_failure_reason: str | None = None
    tv_search_evidence: dict[str, Any] = field(default_factory=dict)
    has_verified_tradingview_preview: bool = False


@dataclass
class TrendLinkScore:
    topic_key: str
    topic_label: str
    trend_category: str | None
    narrative_summary: str | None
    lexical_score: float
    mention_score: float
    timing_score: float
    culture_fit_score: float
    link_score: float
    support_post_count: int
    support_interaction_score: float
    overlap_terms: list[str] = field(default_factory=list)
    why_linked: str = ""
    match_reasons: list[str] = field(default_factory=list)
    raw_match_signals: dict[str, Any] = field(default_factory=dict)


@dataclass
class CandidateHydrationResult:
    candidates: list[MarketCandidate]
    reject_counts: dict[str, int]
    penalty_counts: dict[str, int]
    funnel_counts: dict[str, int]


@dataclass
class LiveMarketValidationResult:
    candidate: MarketCandidate | None
    is_live: bool
    status: str
    reason: str | None
    source: str | None


@dataclass
class PreviewEligibilityResult:
    candidates: list[MarketCandidate]
    reject_counts: dict[str, int]
    funnel_counts: dict[str, int]
    diagnostics: dict[str, Any]


@dataclass
class CorrelationRankingResult:
    selected_results: list[dict[str, Any]]
    link_rows: list[dict[str, Any]]
    trend_memecoin_rows: list[dict[str, Any]]
    ranking_diagnostics: dict[str, Any]
    reject_counts: dict[str, int]
    penalty_counts: dict[str, int]
    funnel_counts: dict[str, int]


def build_memecoin_correlation_runtime_config_from_env() -> MemecoinCorrelationRuntimeConfig:
    allowed_chains_value = str(
        os.getenv("MEMECOIN_CORRELATION_ALLOWED_CHAINS", "solana,ethereum,base,bsc")
    ).strip()
    allowed_chains = tuple(
        value.strip().lower()
        for value in allowed_chains_value.split(",")
        if value.strip()
    ) or ("solana", "ethereum", "base", "bsc")
    return MemecoinCorrelationRuntimeConfig(
        enabled=_parse_bool_env("MEMECOIN_CORRELATION_ENABLED", True),
        interval_seconds=_parse_float_env("MEMECOIN_CORRELATION_INTERVAL_SECONDS", 900.0, 60.0, 86400.0),
        min_cycles_between_runs=_parse_int_env("MEMECOIN_CORRELATION_MIN_CYCLES_BETWEEN_RUNS", 5, 0, 5000),
        defer_backlog_lag_minutes=_parse_float_env(
            "MEMECOIN_CORRELATION_DEFER_BACKLOG_LAG_MINUTES",
            10.0,
            0.0,
            360.0,
        ),
        defer_if_cycle_duration_ms=_parse_float_env(
            "MEMECOIN_CORRELATION_DEFER_IF_CYCLE_DURATION_MS",
            14000.0,
            0.0,
            300000.0,
        ),
        defer_if_cycle_events=_parse_int_env(
            "MEMECOIN_CORRELATION_DEFER_IF_CYCLE_EVENTS",
            8000,
            0,
            500000,
        ),
        defer_if_no_ingestion_seconds=_parse_float_env(
            "MEMECOIN_CORRELATION_DEFER_IF_NO_INGESTION_SECONDS",
            60.0,
            0.0,
            3600.0,
        ),
        max_trends=_parse_int_env("MEMECOIN_CORRELATION_MAX_TRENDS", 96, 4, 128),
        max_seeds_per_trend=_parse_int_env("MEMECOIN_CORRELATION_MAX_SEEDS_PER_TREND", 18, 2, 40),
        post_lookback_hours=_parse_int_env("MEMECOIN_CORRELATION_POST_LOOKBACK_HOURS", 36, 6, 168),
        max_posts_per_trend=_parse_int_env("MEMECOIN_CORRELATION_MAX_POSTS_PER_TREND", 120, 10, 400),
        max_seed_queries=_parse_int_env("MEMECOIN_CORRELATION_MAX_SEED_QUERIES", 96, 2, 192),
        max_pairs_per_seed=_parse_int_env("MEMECOIN_CORRELATION_MAX_PAIRS_PER_SEED", 12, 1, 28),
        discovery_expansion_depth=_parse_int_env("MEMECOIN_CORRELATION_DISCOVERY_EXPANSION_DEPTH", 5, 1, 8),
        max_discovery_tokens=_parse_int_env("MEMECOIN_CORRELATION_MAX_DISCOVERY_TOKENS", 900, 20, 1600),
        max_results=_parse_int_env("MEMECOIN_CORRELATION_MAX_RESULTS", 0, 0, 500),
        target_published_results=_parse_int_env("MEMECOIN_CORRELATION_TARGET_PUBLISHED_RESULTS", 0, 0, 500),
        max_political_results=_parse_int_env("MEMECOIN_CORRELATION_MAX_POLITICAL_RESULTS", 32, 0, 64),
        max_theme_results_per_run=_parse_int_env("MEMECOIN_CORRELATION_MAX_THEME_RESULTS_PER_RUN", 12, 1, 24),
        min_trend_culture_score=_parse_float_env("MEMECOIN_CORRELATION_MIN_TREND_CULTURE_SCORE", -12.0, -20.0, 20.0),
        min_memecoin_fit_score=_parse_float_env(
            "MEMECOIN_CORRELATION_MIN_MEMECOIN_FIT_SCORE",
            4.0,
            0.0,
            100.0,
        ),
        allowed_chains=allowed_chains,
        minimum_basic_liquidity_usd=_parse_float_env_with_aliases(
            "MEMECOIN_CORRELATION_BASIC_MIN_LIQUIDITY_USD",
            ("MEMECOIN_CORRELATION_MINIMUM_PUBLISHABLE_LIQUIDITY_USD",),
            750.0,
            100.0,
            5000000.0,
        ),
        minimum_basic_volume_24h_usd=_parse_float_env_with_aliases(
            "MEMECOIN_CORRELATION_BASIC_MIN_VOLUME_24H_USD",
            ("MEMECOIN_CORRELATION_MINIMUM_PUBLISHABLE_VOLUME_24H_USD",),
            400.0,
            100.0,
            10000000.0,
        ),
        minimum_basic_txns_24h=_parse_int_env_with_aliases(
            "MEMECOIN_CORRELATION_BASIC_MIN_TXNS_24H",
            ("MEMECOIN_CORRELATION_MINIMUM_PUBLISHABLE_TXNS_24H",),
            2,
            1,
            50000,
        ),
        live_min_liquidity_usd=_parse_float_env_with_aliases(
            "MEMECOIN_LIVE_VALIDATION_MIN_LIQUIDITY_USD",
            ("MEMECOIN_CORRELATION_LIVE_MIN_LIQUIDITY_USD",),
            750.0,
            0.0,
            5000000.0,
        ),
        live_min_volume_24h_usd=_parse_float_env_with_aliases(
            "MEMECOIN_LIVE_VALIDATION_MIN_VOLUME_24H_USD",
            ("MEMECOIN_CORRELATION_LIVE_MIN_VOLUME_24H_USD",),
            400.0,
            0.0,
            10000000.0,
        ),
        live_min_recent_txns=_parse_int_env_with_aliases(
            "MEMECOIN_LIVE_VALIDATION_MIN_RECENT_TXNS",
            ("MEMECOIN_CORRELATION_LIVE_MIN_RECENT_TXNS",),
            2,
            0,
            50000,
        ),
        live_max_snapshot_staleness_hours=_parse_float_env_with_aliases(
            "MEMECOIN_LIVE_VALIDATION_MAX_STALENESS_HOURS",
            ("MEMECOIN_CORRELATION_LIVE_MAX_STALENESS_HOURS",),
            6.0,
            0.0,
            168.0,
        ),
        min_liquidity_usd=_parse_float_env("MEMECOIN_CORRELATION_MIN_LIQUIDITY_USD", 6000.0, 100.0, 5000000.0),
        min_volume_24h_usd=_parse_float_env("MEMECOIN_CORRELATION_MIN_VOLUME_24H_USD", 2500.0, 100.0, 10000000.0),
        min_txns_24h=_parse_int_env("MEMECOIN_CORRELATION_MIN_TXNS_24H", 6, 1, 50000),
        new_pair_penalty_hours=_parse_float_env_with_aliases(
            "MEMECOIN_CORRELATION_NEW_PAIR_PENALTY_HOURS",
            ("MEMECOIN_CORRELATION_MIN_PAIR_AGE_HOURS", "MEMECOIN_CORRELATION_MINIMUM_PUBLISHABLE_PAIR_AGE_HOURS"),
            1.5,
            0.0,
            8760.0,
        ),
        high_confidence_correlation_threshold=_parse_float_env(
            "MEMECOIN_CORRELATION_HIGH_CONFIDENCE_THRESHOLD",
            22.0,
            0.0,
            100.0,
        ),
        medium_confidence_correlation_threshold=_parse_float_env(
            "MEMECOIN_CORRELATION_MEDIUM_CONFIDENCE_THRESHOLD",
            12.0,
            0.0,
            100.0,
        ),
        exploratory_correlation_threshold=_parse_float_env_with_aliases(
            "MEMECOIN_CORRELATION_EXPLORATORY_THRESHOLD",
            ("MEMECOIN_CORRELATION_LOW_CONFIDENCE_THRESHOLD",),
            5.0,
            0.0,
            100.0,
        ),
        medium_confidence_market_floor=_parse_float_env(
            "MEMECOIN_CORRELATION_MEDIUM_CONFIDENCE_MARKET_FLOOR",
            6.0,
            0.0,
            100.0,
        ),
        medium_confidence_memecoin_floor=_parse_float_env(
            "MEMECOIN_CORRELATION_MEDIUM_CONFIDENCE_MEMECOIN_FLOOR",
            0.0,
            0.0,
            100.0,
        ),
        exploratory_market_floor=_parse_float_env_with_aliases(
            "MEMECOIN_CORRELATION_EXPLORATORY_MARKET_FLOOR",
            ("MEMECOIN_CORRELATION_LOW_CONFIDENCE_MARKET_FLOOR",),
            0.0,
            0.0,
            100.0,
        ),
        exploratory_memecoin_floor=_parse_float_env_with_aliases(
            "MEMECOIN_CORRELATION_EXPLORATORY_MEMECOIN_FLOOR",
            ("MEMECOIN_CORRELATION_LOW_CONFIDENCE_MEMECOIN_FLOOR",),
            0.0,
            0.0,
            100.0,
        ),
        recent_repeat_penalty_window_runs=_parse_int_env(
            "MEMECOIN_CORRELATION_RECENT_REPEAT_WINDOW_RUNS",
            12,
            0,
            40,
        ),
        max_recent_token_appearances=_parse_int_env(
            "MEMECOIN_CORRELATION_MAX_RECENT_TOKEN_APPEARANCES",
            14,
            0,
            20,
        ),
        recent_repeat_penalty_per_hit=_parse_float_env(
            "MEMECOIN_CORRELATION_RECENT_REPEAT_PENALTY_PER_HIT",
            0.25,
            0.0,
            10.0,
        ),
        recent_theme_penalty_per_hit=_parse_float_env(
            "MEMECOIN_CORRELATION_RECENT_THEME_PENALTY_PER_HIT",
            0.08,
            0.0,
            10.0,
        ),
        max_volume_liquidity_ratio=_parse_float_env(
            "MEMECOIN_CORRELATION_MAX_VOLUME_LIQUIDITY_RATIO",
            180.0,
            1.0,
            500.0,
        ),
        drained_liquidity_usd=_parse_float_env(
            "MEMECOIN_CORRELATION_DRAINED_LIQUIDITY_USD",
            350.0,
            25.0,
            500000.0,
        ),
        dead_pair_age_hours=_parse_float_env(
            "MEMECOIN_CORRELATION_DEAD_PAIR_AGE_HOURS",
            24.0,
            1.0,
            8760.0,
        ),
        dead_liquidity_usd=_parse_float_env(
            "MEMECOIN_CORRELATION_DEAD_LIQUIDITY_USD",
            2500.0,
            100.0,
            5000000.0,
        ),
        dead_volume_24h_usd=_parse_float_env(
            "MEMECOIN_CORRELATION_DEAD_VOLUME_24H_USD",
            1200.0,
            50.0,
            10000000.0,
        ),
        dead_txns_24h=_parse_int_env(
            "MEMECOIN_CORRELATION_DEAD_TXNS_24H",
            3,
            0,
            50000,
        ),
        rug_pull_price_drop_pct=_parse_float_env(
            "MEMECOIN_CORRELATION_RUG_PULL_PRICE_DROP_PCT",
            94.0,
            10.0,
            100.0,
        ),
        min_request_spacing_seconds=_parse_float_env(
            "MEMECOIN_CORRELATION_MIN_REQUEST_SPACING_SECONDS",
            0.25,
            0.0,
            10.0,
        ),
        request_timeout_seconds=_parse_float_env("MEMECOIN_CORRELATION_TIMEOUT_SECONDS", 8.0, 2.0, 60.0),
        max_retries=_parse_int_env("MEMECOIN_CORRELATION_MAX_RETRIES", 2, 0, 8),
        retry_backoff_seconds=_parse_float_env(
            "MEMECOIN_CORRELATION_RETRY_BACKOFF_SECONDS",
            0.75,
            0.0,
            10.0,
        ),
        discovery_cache_ttl_seconds=_parse_int_env(
            "MEMECOIN_CORRELATION_DISCOVERY_CACHE_TTL_SECONDS",
            1800,
            0,
            86400,
        ),
        token_cache_ttl_seconds=_parse_int_env(
            "MEMECOIN_CORRELATION_TOKEN_CACHE_TTL_SECONDS",
            900,
            0,
            86400,
        ),
        search_cache_ttl_seconds=_parse_int_env(
            "MEMECOIN_CORRELATION_SEARCH_CACHE_TTL_SECONDS",
            10800,
            0,
            86400,
        ),
        stale_cache_ttl_seconds=_parse_int_env(
            "MEMECOIN_CORRELATION_STALE_CACHE_TTL_SECONDS",
            21600,
            0,
            172800,
        ),
    )


def _score_bias(text: str) -> TrendBias:
    preferred_hits = {
        category: _keywords_present(text, keywords)
        for category, keywords in PREFERRED_CATEGORY_TERMS.items()
    }
    deprioritized_hits = {
        category: _keywords_present(text, keywords)
        for category, keywords in DEPRIORITIZED_TERMS.items()
    }
    preferred_score = (
        preferred_hits["meme"] * 1.8
        + preferred_hits["internet_culture"] * 1.5
        + preferred_hits["entertainment"] * 1.2
        + preferred_hits["gaming"] * 1.3
        + preferred_hits["creator"] * 1.0
        + preferred_hits["ai_tech"] * 1.4
    )
    penalty_score = (
        deprioritized_hits["politics"] * 2.0
        + deprioritized_hits["macro"] * 1.4
        + deprioritized_hits["finance"] * 1.2
        + deprioritized_hits["news"] * 1.0
    )
    dominant_category = max(
        preferred_hits.items(),
        key=lambda item: (item[1], item[0]),
    )[0]
    political_dominant = deprioritized_hits["politics"] >= max(
        2,
        max(preferred_hits.values()) + 1,
    )
    if political_dominant:
        dominant_category = "politics"
    return TrendBias(
        preferred_hits=preferred_hits,
        deprioritized_hits=deprioritized_hits,
        culture_score=preferred_score - penalty_score,
        political_dominant=political_dominant,
        dominant_category=dominant_category,
    )


def _trend_priority_score(row: dict[str, Any], text: str, now: datetime) -> float:
    total_mentions = max(0, _safe_int(row.get("total_mentions")))
    unique_posts = max(0, _safe_int(row.get("unique_posts")))
    unique_authors = max(0, _safe_int(row.get("unique_authors")))
    representative_post_count = max(0, _safe_int(row.get("representative_post_count")))
    display_label = _choose_trend_display_label(row)
    trusted_display_name = _should_use_trusted_trend_display_name(row)
    bias = _score_bias(text)
    quality_penalty = _trend_quality_penalty(
        display_label=display_label,
        trend_category=str(row.get("trend_category") or "").strip() or None,
        enrichment_status=str(row.get("enrichment_status") or "").strip() or None,
        summary_confidence=_safe_float(row.get("summary_confidence")),
        narrative_summary=str(row.get("narrative_summary") or "").strip() or None,
        context_paragraph=str(row.get("context_paragraph") or "").strip() or None,
        key_entities=_coerce_text_list(row.get("key_entities")),
        representative_post_count=representative_post_count,
        name_status=str(row.get("name_status") or "").strip() or None,
        name_source=str(row.get("name_source") or "").strip() or None,
        trusted_display_name=trusted_display_name,
    )
    preferred_bucket = _preferred_trend_bucket(row, bias)
    category_bucket = _normalized_trend_category_bucket(row.get("trend_category")) or preferred_bucket
    culture_bonus = _trend_culture_bonus(
        text=text,
        key_entities=_coerce_text_list(row.get("key_entities")),
        preferred_bucket=preferred_bucket,
        representative_post_count=representative_post_count,
    )
    age_hours = _age_hours_from(row.get("last_seen_at"), now)
    freshness_bonus = (
        12.0
        if age_hours is not None and age_hours <= 6
        else 4.0
        if age_hours is not None and age_hours <= 24
        else 0.0
    )
    volume_score = (
        _log_score(total_mentions, weight=12.0, cap=30.0)
        + _log_score(unique_posts, weight=10.0, cap=18.0)
        + _log_score(unique_authors, weight=8.0, cap=14.0)
        + _log_score(representative_post_count, weight=6.0, cap=10.0)
    )
    confidence_bonus = min(6.0, max(0.0, _safe_float(row.get("summary_confidence"))) * 10.0)
    return (
        volume_score
        + freshness_bonus
        + bias.culture_score * 4.0
        + _trend_category_bonus(category_bucket)
        + culture_bonus
        + confidence_bonus
        - quality_penalty
    )


def _build_trend_text(row: dict[str, Any]) -> str:
    display_label = _choose_trend_display_label(row)
    raw_label = str(row.get("raw_label") or "").strip()
    return " ".join(
        value
        for value in [
            display_label,
            raw_label if raw_label and _normalize_text(raw_label) != _normalize_text(display_label) else "",
            str(row.get("trend_category") or "").strip(),
            _clean_trend_context(row.get("narrative_summary")),
            _clean_trend_context(row.get("context_paragraph")),
            " ".join(_coerce_text_list(row.get("key_entities"))),
        ]
        if value
    ).strip()


def _select_active_trends(
    raw_rows: list[dict[str, Any]],
    *,
    config: MemecoinCorrelationRuntimeConfig,
    now: datetime,
) -> list[ActiveTrendCandidate]:
    candidates: list[ActiveTrendCandidate] = []
    for row in raw_rows:
        topic_key = str(row.get("topic_key") or "").strip()
        display_label = _choose_trend_display_label(row)
        if not topic_key or not display_label:
            continue
        key_entities = _coerce_text_list(row.get("key_entities"))
        representative_post_count = max(0, _safe_int(row.get("representative_post_count")))
        trusted_display_name = _should_use_trusted_trend_display_name(row)
        trend_text = _build_trend_text(row)
        bias = _score_bias(trend_text)
        preferred_bucket = _preferred_trend_bucket(row, bias)
        quality_penalty = _trend_quality_penalty(
            display_label=display_label,
            trend_category=str(row.get("trend_category") or "").strip() or None,
            enrichment_status=str(row.get("enrichment_status") or "").strip() or None,
            summary_confidence=_safe_float(row.get("summary_confidence")),
            narrative_summary=str(row.get("narrative_summary") or "").strip() or None,
            context_paragraph=str(row.get("context_paragraph") or "").strip() or None,
            key_entities=key_entities,
            representative_post_count=representative_post_count,
            name_status=str(row.get("name_status") or "").strip() or None,
            name_source=str(row.get("name_source") or "").strip() or None,
            trusted_display_name=trusted_display_name,
        )
        priority_score = _trend_priority_score(row, trend_text, now)
        candidates.append(
            ActiveTrendCandidate(
                topic_key=topic_key,
                display_label=display_label,
                raw_label=str(row.get("raw_label") or row.get("topic_label") or display_label).strip(),
                trend_category=str(row.get("trend_category") or "").strip() or None,
                enrichment_status=str(row.get("enrichment_status") or "").strip() or None,
                summary_confidence=_safe_float(row.get("summary_confidence")),
                name_status=str(row.get("name_status") or "").strip() or None,
                name_source=str(row.get("name_source") or "").strip() or None,
                representative_post_count=representative_post_count,
                trusted_display_name=trusted_display_name,
                narrative_summary=str(row.get("narrative_summary") or "").strip() or None,
                context_paragraph=str(row.get("context_paragraph") or "").strip() or None,
                key_entities=key_entities,
                total_mentions=max(0, _safe_int(row.get("total_mentions"))),
                unique_posts=max(0, _safe_int(row.get("unique_posts"))),
                unique_authors=max(0, _safe_int(row.get("unique_authors"))),
                last_seen_at=str(row.get("last_seen_at") or "").strip() or None,
                window_end=str(row.get("window_end") or "").strip() or None,
                bias=bias,
                priority_score=priority_score,
                preferred_bucket=preferred_bucket,
                quality_penalty=quality_penalty,
                trend_text=trend_text,
            )
        )

    candidates.sort(
        key=lambda row: (
            row.total_mentions,
            row.unique_posts,
            row.unique_authors,
            row.priority_score,
            row.display_label.lower(),
        ),
        reverse=True,
    )
    return candidates[: config.max_trends]


def _engagement_score_from_post(row: dict[str, Any]) -> float:
    return (
        _safe_float(row.get("quality_score"))
        + _safe_int(row.get("like_count")) * 0.05
        + _safe_int(row.get("repost_count")) * 0.12
        + _safe_int(row.get("reply_count")) * 0.1
    )


def _recent_post_from_row(row: dict[str, Any]) -> RecentTrendPost | None:
    topic_key = str(row.get("topic_key") or "").strip()
    text = str(row.get("text") or row.get("clean_text") or "").strip()
    if not topic_key or not text:
        return None
    cashtags = [
        str(value or "").strip().upper()
        for value in _coerce_text_list(row.get("cashtags"))
        if str(value or "").strip()
    ]
    return RecentTrendPost(
        topic_key=topic_key,
        text=text,
        normalized_text=_normalize_text(text),
        cashtags=_unique_preserve(cashtags),
        hashtags=_coerce_text_list(row.get("hashtags")),
        key_phrases=_coerce_text_list(row.get("key_phrases")),
        topic_seeds=_coerce_text_list(row.get("topic_seeds")),
        tags=_coerce_text_list(row.get("tags")),
        created_at=str(row.get("created_at") or "").strip() or None,
        quality_score=_safe_float(row.get("quality_score")),
        engagement_score=_engagement_score_from_post(row),
    )


def _is_seed_term_usable(value: str) -> bool:
    normalized = str(value or "").strip()
    if not normalized:
        return False
    lowered = normalized.lower()
    if lowered in {"ai", "crypto", "token", "coin", "meme", "memecoin", "news"}:
        return False
    if _is_seed_term_low_information(normalized):
        return False
    if len(lowered) <= 2 and not lowered.startswith("$"):
        return False
    compact = _seed_identity(normalized)
    if compact and compact in GENERIC_SEED_TERMS:
        return False
    return True


def _add_search_seed_candidate(
    seeds_by_key: dict[str, dict[str, Any]],
    *,
    term: str,
    trend: ActiveTrendCandidate,
    score: float,
    seed_class: str,
    family_key: str | None = None,
    title_based: bool = False,
) -> None:
    normalized = str(term or "").strip()
    if not _is_seed_term_usable(normalized):
        return
    key = normalized.lower()
    current = seeds_by_key.get(key)
    priority = SEED_CLASS_PRIORITY.get(seed_class, 0.0)
    if not current:
        seeds_by_key[key] = {
            "term": normalized,
            "score": float(score),
            "trend_key": trend.topic_key,
            "trend_keys": {trend.topic_key},
            "seed_class": seed_class,
            "family_key": family_key or _seed_family_key(normalized),
            "class_priority": priority,
            "title_based": bool(title_based),
        }
        return
    current["score"] = max(float(current.get("score") or 0.0), float(score))
    current["trend_keys"].add(trend.topic_key)
    current["title_based"] = bool(current.get("title_based")) or bool(title_based)
    if priority > float(current.get("class_priority") or 0.0):
        current["seed_class"] = seed_class
        current["class_priority"] = priority
    if not current.get("family_key"):
        current["family_key"] = family_key or _seed_family_key(normalized)


def _build_trend_search_seeds(
    trend: ActiveTrendCandidate,
    topic_posts: list[RecentTrendPost],
    *,
    max_seeds_per_trend: int,
) -> list[dict[str, Any]]:
    local_seeds: dict[str, dict[str, Any]] = {}

    def add_seed(
        term: str,
        *,
        score: float,
        seed_class: str,
        family_key: str | None = None,
        title_based: bool = False,
    ) -> None:
        _add_search_seed_candidate(
            local_seeds,
            term=term,
            trend=trend,
            score=score,
            seed_class=seed_class,
            family_key=family_key,
            title_based=title_based,
        )

    display_generic = _is_generic_trend_label(
        trend.display_label,
        key_entities=trend.key_entities,
        representative_post_count=trend.representative_post_count,
        trusted_name=trend.trusted_display_name,
    )
    if not display_generic:
        add_seed(
            trend.display_label,
            score=trend.priority_score + (18.0 if trend.trusted_display_name else 12.0),
            seed_class="primary",
            title_based=trend.trusted_display_name,
        )
        for token in _extract_token_variants(trend.display_label, max_terms=4):
            add_seed(
                token,
                score=trend.priority_score + 13.0,
                seed_class="fragment",
                title_based=trend.trusted_display_name,
            )
    else:
        for token in _extract_token_variants(trend.display_label, max_terms=3):
            add_seed(
                token,
                score=trend.priority_score + 8.0,
                seed_class="fragment",
                title_based=False,
            )
        for fragment in _extract_phrase_variants(trend.display_label, max_phrases=3):
            add_seed(
                fragment,
                score=trend.priority_score + 11.0,
                seed_class="fragment",
                title_based=trend.trusted_display_name,
            )

    if trend.raw_label and _normalize_text(trend.raw_label) != _normalize_text(trend.display_label):
        add_seed(
            trend.raw_label,
            score=trend.priority_score + 10.0,
            seed_class="alias",
            title_based=trend.trusted_display_name,
        )
        for token in _extract_token_variants(trend.raw_label, max_terms=4):
            add_seed(
                token,
                score=trend.priority_score + 9.5,
                seed_class="alias",
                title_based=trend.trusted_display_name,
            )
        for fragment in _extract_phrase_variants(trend.raw_label, max_phrases=2):
            add_seed(
                fragment,
                score=trend.priority_score + 8.0,
                seed_class="fragment",
                title_based=trend.trusted_display_name,
            )

    for index, entity in enumerate(trend.key_entities[:6]):
        add_seed(entity, score=trend.priority_score + 16.0 - index * 1.5, seed_class="entity")
        for token in _extract_token_variants(entity, max_terms=3):
            add_seed(token, score=trend.priority_score + 12.0 - index, seed_class="entity")
        for fragment in _extract_phrase_variants(entity, max_phrases=2):
            add_seed(fragment, score=trend.priority_score + 9.0 - index, seed_class="fragment")

    for token in _extract_token_variants(trend.narrative_summary, max_terms=6):
        add_seed(token, score=trend.priority_score + 9.0, seed_class="community")
    for token in _extract_token_variants(trend.context_paragraph, max_terms=5):
        add_seed(token, score=trend.priority_score + 8.0, seed_class="community")
    for fragment in _extract_phrase_variants(trend.narrative_summary, max_phrases=5):
        add_seed(fragment, score=trend.priority_score + 8.5, seed_class="community")
    for fragment in _extract_phrase_variants(trend.context_paragraph, max_phrases=4):
        add_seed(fragment, score=trend.priority_score + 7.5, seed_class="community")

    phrase_counts: dict[tuple[str, str], int] = {}
    cashtag_counts: dict[str, int] = {}
    hashtag_counts: dict[str, int] = {}
    for post in topic_posts:
        for cashtag in post.cashtags:
            if cashtag in GENERIC_CASHTAG_BLACKLIST or len(cashtag) <= 1 or len(cashtag) > 15:
                continue
            cashtag_counts[cashtag] = cashtag_counts.get(cashtag, 0) + 1
        for hashtag in post.hashtags:
            normalized_hashtag = str(hashtag or "").strip().lstrip("#")
            if len(normalized_hashtag) <= 2 or len(normalized_hashtag) > 40:
                continue
            hashtag_counts[normalized_hashtag] = hashtag_counts.get(normalized_hashtag, 0) + 1
        for phrase in [*post.key_phrases, *post.topic_seeds, *post.tags]:
            normalized_phrase = str(phrase or "").strip()
            if not normalized_phrase:
                continue
            if not _is_seed_term_usable(normalized_phrase):
                continue
            seed_class = "topic_seed" if normalized_phrase in post.topic_seeds else "tag" if normalized_phrase in post.tags else "phrase"
            phrase_counts[(seed_class, normalized_phrase)] = phrase_counts.get((seed_class, normalized_phrase), 0) + 1
            for token in _extract_token_variants(normalized_phrase, max_terms=3):
                phrase_counts[(seed_class, token)] = phrase_counts.get((seed_class, token), 0) + 1

    for index, (cashtag, count) in enumerate(
        sorted(cashtag_counts.items(), key=lambda item: (item[1], item[0]), reverse=True)[:6]
    ):
        add_seed(cashtag, score=trend.priority_score + count * 6.0 - index, seed_class="cashtag")

    for index, (hashtag, count) in enumerate(
        sorted(hashtag_counts.items(), key=lambda item: (item[1], item[0]), reverse=True)[:6]
    ):
        add_seed(hashtag, score=trend.priority_score + count * 4.5 - index, seed_class="hashtag")
        for token in _extract_token_variants(hashtag, max_terms=2):
            add_seed(token, score=trend.priority_score + count * 3.4 - index * 0.5, seed_class="hashtag")

    sorted_phrase_counts = sorted(
        phrase_counts.items(),
        key=lambda item: (item[1], SEED_CLASS_PRIORITY.get(item[0][0], 0.0), item[0][1].lower()),
        reverse=True,
    )
    for index, ((seed_class, phrase), count) in enumerate(sorted_phrase_counts[:14]):
        add_seed(
            phrase,
            score=trend.priority_score + count * 3.2 + SEED_CLASS_PRIORITY.get(seed_class, 0.0) * 0.1 - index * 0.5,
            seed_class=seed_class,
        )

    if trend.preferred_bucket:
        bucket_terms = sorted(PREFERRED_CATEGORY_TERMS.get(trend.preferred_bucket, set()))
        for index, term in enumerate(bucket_terms[:6]):
            if term in trend.trend_text.lower():
                add_seed(term, score=trend.priority_score + 6.0 - index, seed_class="community")

    ordered_seeds = sorted(
        local_seeds.values(),
        key=lambda item: (
            float(item["class_priority"]),
            float(item["score"]),
            len(str(item["term"])),
            str(item["term"]).lower(),
        ),
        reverse=True,
    )
    selected_seed_rows: list[dict[str, Any]] = []
    selected_terms: set[str] = set()
    primary_key = trend.display_label.lower()
    primary_seed = local_seeds.get(primary_key)
    if primary_seed is not None:
        selected_seed_rows.append(primary_seed)
        selected_terms.add(primary_key)
    context_seed_classes = {"cashtag", "hashtag", "topic_seed", "phrase", "tag"}
    for seed in ordered_seeds:
        term_key = str(seed["term"]).lower()
        if term_key in selected_terms:
            continue
        if str(seed.get("seed_class") or "") not in context_seed_classes:
            continue
        selected_seed_rows.append(seed)
        selected_terms.add(term_key)
        if len(selected_seed_rows) >= min(max_seeds_per_trend, 4):
            break
    for seed in ordered_seeds:
        term_key = str(seed["term"]).lower()
        if term_key in selected_terms:
            continue
        selected_seed_rows.append(seed)
        selected_terms.add(term_key)
        if len(selected_seed_rows) >= max_seeds_per_trend:
            break
    return [
        {
            "term": str(seed["term"]),
            "score": float(seed["score"]),
            "trend_key": trend.topic_key,
            "trend_keys": sorted(seed["trend_keys"]),
            "seed_class": str(seed["seed_class"]),
            "family_key": str(seed["family_key"] or _seed_family_key(seed["term"])),
            "title_based": bool(seed.get("title_based")),
        }
        for seed in selected_seed_rows[:max_seeds_per_trend]
    ]


def _build_search_seeds(
    trends: list[ActiveTrendCandidate],
    posts_by_topic: dict[str, list[RecentTrendPost]],
    *,
    max_seed_queries: int,
    max_seeds_per_trend: int,
) -> list[dict[str, Any]]:
    per_trend_seeds = [
        _build_trend_search_seeds(
            trend,
            posts_by_topic.get(trend.topic_key, []),
            max_seeds_per_trend=max_seeds_per_trend,
        )
        for trend in trends
    ]

    selected: list[dict[str, Any]] = []
    seen_terms: set[str] = set()

    def round_robin_pick(seed_lists: list[list[dict[str, Any]]], *, limit: int) -> None:
        round_index = 0
        while len(selected) < limit:
            added = False
            for trend_seed_list in seed_lists:
                if round_index >= len(trend_seed_list):
                    continue
                seed = trend_seed_list[round_index]
                term_key = str(seed["term"]).lower()
                if term_key in seen_terms:
                    continue
                selected.append(seed)
                seen_terms.add(term_key)
                added = True
                if len(selected) >= limit:
                    break
            if not added:
                break
            round_index += 1

    title_seed_lists = [
        [seed for seed in trend_seed_list if bool(seed.get("title_based"))]
        for trend_seed_list in per_trend_seeds
    ]
    title_target = min(
        max_seed_queries,
        max(len(trends) * 2, math.ceil(max_seed_queries * 0.8)),
    )
    round_robin_pick(title_seed_lists, limit=title_target)
    round_robin_pick(per_trend_seeds, limit=max_seed_queries)

    selected.sort(
        key=lambda item: (
            bool(item.get("title_based")),
            SEED_CLASS_PRIORITY.get(str(item.get("seed_class") or ""), 0.0),
            float(item["score"]),
            str(item["term"]).lower(),
        ),
        reverse=True,
    )
    return selected[:max_seed_queries]


def _expand_search_queries(
    search_seeds: list[dict[str, Any]],
    *,
    config: MemecoinCorrelationRuntimeConfig,
) -> list[dict[str, Any]]:
    expanded_queries: list[dict[str, Any]] = []
    seen_terms: set[str] = set()
    for seed in search_seeds:
        base_score = float(seed.get("score") or 0.0)
        variants = _seed_term_variants(str(seed.get("term") or ""))
        variant_limit = max(1, config.discovery_expansion_depth + (2 if bool(seed.get("title_based")) else 0))
        for stage_index, variant in enumerate(variants[:variant_limit]):
            key = variant.lower()
            if key in seen_terms:
                continue
            seen_terms.add(key)
            expanded_queries.append(
                {
                    **seed,
                    "query": variant,
                    "stage": stage_index,
                    "score": base_score - stage_index * 2.0,
                    "title_based": bool(seed.get("title_based")),
                }
            )

    expanded_queries.sort(
        key=lambda item: (
            -int(item.get("stage") or 0),
            float(item.get("score") or 0.0),
            str(item.get("query") or "").lower(),
        ),
        reverse=True,
    )
    return expanded_queries[: max(config.max_seed_queries, config.max_seed_queries * config.discovery_expansion_depth)]


def _upsert_discovery_hint(
    hints_by_key: dict[tuple[str, str], DiscoveryHint],
    *,
    chain_id: str,
    token_address: str,
    source_name: str,
    seed_terms: list[str] | None = None,
    matched_trend_keys: list[str] | None = None,
    description: str | None = None,
    links: list[dict[str, Any]] | None = None,
    cto: bool | None = None,
) -> None:
    normalized_chain = str(chain_id or "").strip().lower()
    normalized_address = str(token_address or "").strip()
    if not normalized_chain or not normalized_address:
        return
    key = (normalized_chain, normalized_address)
    current = hints_by_key.get(key)
    if current is None:
        current = DiscoveryHint(
            chain_id=normalized_chain,
            token_address=normalized_address,
            source_names=set(),
            seed_terms=set(),
            matched_trend_keys=set(),
            description=None,
            links=[],
            cto=None,
        )
        hints_by_key[key] = current
    current.source_names.add(str(source_name or "").strip() or "unknown")
    for term in seed_terms or []:
        if _is_seed_term_usable(term):
            current.seed_terms.add(str(term).strip())
    for topic_key in matched_trend_keys or []:
        normalized_topic_key = str(topic_key or "").strip()
        if normalized_topic_key:
            current.matched_trend_keys.add(normalized_topic_key)
    if description and not current.description:
        current.description = str(description).strip()
    if links:
        current.links = list(links)
    if cto is not None:
        current.cto = bool(cto)


def _discover_from_dex_feeds(
    *,
    client: DexscreenerClient,
    config: MemecoinCorrelationRuntimeConfig,
    logger: Any,
) -> dict[tuple[str, str], DiscoveryHint]:
    hints_by_key: dict[tuple[str, str], DiscoveryHint] = {}

    def ingest_items(
        items: list[dict[str, Any]],
        source_name: str,
        *,
        community_takeover: bool = False,
    ) -> None:
        for item in items:
            chain_id = str(item.get("chainId") or "").strip().lower()
            token_address = str(item.get("tokenAddress") or "").strip()
            if chain_id not in config.allowed_chains:
                continue
            _upsert_discovery_hint(
                hints_by_key,
                chain_id=chain_id,
                token_address=token_address,
                source_name=source_name,
                description=str(item.get("description") or "").strip() or None,
                links=item.get("links") if isinstance(item.get("links"), list) else None,
                cto=community_takeover if community_takeover else (bool(item.get("cto")) if item.get("cto") is not None else None),
            )

    try:
        ingest_items(client.get_token_boosts_top(), "dex_boosts_top")
    except Exception as error:
        log_event(logger, 30, "memecoin_dex_boosts_top_failed", error=str(error))

    try:
        ingest_items(
            client.get_community_takeovers_latest(),
            "dex_community_takeovers_latest",
            community_takeover=True,
        )
    except Exception as error:
        log_event(logger, 30, "memecoin_dex_community_takeovers_failed", error=str(error))

    try:
        ingest_items(client.get_token_boosts_latest(), "dex_boosts_latest")
    except Exception as error:
        log_event(logger, 30, "memecoin_dex_boosts_latest_failed", error=str(error))

    try:
        ingest_items(client.get_token_profiles_latest(), "dex_profiles_latest")
    except Exception as error:
        log_event(logger, 30, "memecoin_dex_profiles_latest_failed", error=str(error))

    return hints_by_key


def _score_search_pair_match(pair: dict[str, Any], seed_term: str) -> float:
    base_token = pair.get("baseToken") if isinstance(pair.get("baseToken"), dict) else {}
    if not isinstance(base_token, dict):
        return float("-inf")
    seed_normalized = _normalize_text(seed_term)
    symbol = str(base_token.get("symbol") or "").strip()
    name = str(base_token.get("name") or "").strip()
    symbol_normalized = _normalize_text(symbol)
    name_normalized = _normalize_text(name)
    compact_seed = _compact_identity(seed_term)
    compact_symbol = _compact_identity(symbol)
    compact_name = _compact_identity(name)

    exact_symbol = symbol_normalized == seed_normalized or compact_symbol == compact_seed
    exact_name = name_normalized == seed_normalized or compact_name == compact_seed
    contains_match = seed_normalized in name_normalized or seed_normalized in symbol_normalized
    seed_tokens = [token for token in _token_sequence(seed_term) if len(token) >= 3]
    name_tokens = set(_token_sequence(name))
    symbol_tokens = set(_token_sequence(symbol))
    shared_name_tokens = len([token for token in seed_tokens if token in name_tokens])
    shared_symbol_tokens = len([token for token in seed_tokens if token in symbol_tokens])
    partial_name_tokens = len(_collect_partial_overlap_terms(set(seed_tokens), name_tokens, limit=4))
    partial_symbol_tokens = len(_collect_partial_overlap_terms(set(seed_tokens), symbol_tokens, limit=4))
    name_similarity = (
        SequenceMatcher(None, compact_seed, compact_name).ratio()
        if compact_seed and compact_name
        else 0.0
    )
    symbol_similarity = (
        SequenceMatcher(None, compact_seed, compact_symbol).ratio()
        if compact_seed and compact_symbol
        else 0.0
    )
    seed_prefix4 = compact_seed[:4]
    seed_prefix3 = compact_seed[:3]
    prefix_match = bool(
        compact_seed
        and (
            (compact_name and seed_prefix4 and compact_name.startswith(seed_prefix4))
            or (compact_name and len(compact_name) >= 4 and compact_seed.startswith(compact_name[:4]))
            or (compact_symbol and seed_prefix3 and compact_symbol.startswith(seed_prefix3))
            or (compact_symbol and len(compact_symbol) >= 3 and compact_seed.startswith(compact_symbol[:3]))
        )
    )
    compact_overlap = max(
        _partial_overlap_term_score(compact_seed, compact_name),
        _partial_overlap_term_score(compact_seed, compact_symbol),
    )
    if (
        len(seed_normalized) <= 2
        and not exact_symbol
        and shared_name_tokens <= 0
        and shared_symbol_tokens <= 0
        and partial_name_tokens <= 0
        and partial_symbol_tokens <= 0
        and max(name_similarity, symbol_similarity, compact_overlap) < 0.68
    ):
        return float("-inf")

    liquidity_usd = _safe_float((pair.get("liquidity") or {}).get("usd"))
    volume_h24 = _safe_float((pair.get("volume") or {}).get("h24"))
    score = 0.0
    if exact_symbol:
        score += 72.0
    if exact_name:
        score += 68.0
    if contains_match:
        score += 22.0
    score += shared_name_tokens * 16.0
    score += shared_symbol_tokens * 14.0
    score += partial_name_tokens * 8.0
    score += partial_symbol_tokens * 7.0
    score += min(18.0, max(name_similarity, symbol_similarity) * 20.0)
    score += min(14.0, compact_overlap * 16.0)
    if prefix_match:
        score += 10.0
    if (
        not exact_symbol
        and not exact_name
        and not contains_match
        and shared_name_tokens <= 0
        and shared_symbol_tokens <= 0
        and partial_name_tokens <= 0
        and partial_symbol_tokens <= 0
        and max(name_similarity, symbol_similarity, compact_overlap) < 0.46
        and not prefix_match
    ):
        return float("-inf")
    score += _log_score(liquidity_usd, weight=8.0, cap=18.0)
    score += _log_score(volume_h24, weight=6.0, cap=12.0)
    quote_symbol = str(((pair.get("quoteToken") or {}) if isinstance(pair.get("quoteToken"), dict) else {}).get("symbol") or "").strip()
    score += QUOTE_SYMBOL_BONUS.get(quote_symbol, 0)
    return score


def _discover_from_search(
    *,
    client: DexscreenerClient,
    config: MemecoinCorrelationRuntimeConfig,
    search_queries: list[dict[str, Any]],
) -> dict[tuple[str, str], DiscoveryHint]:
    hints_by_key: dict[tuple[str, str], DiscoveryHint] = {}
    family_result_counts: dict[tuple[str, str], int] = {}
    trend_result_counts: dict[str, int] = {}
    per_trend_cap = max(config.max_pairs_per_seed * 12, config.max_seeds_per_trend * 8)
    per_family_cap = max(12, config.max_pairs_per_seed * 5)

    for query in search_queries:
        query_term = str(query.get("query") or query.get("term") or "").strip()
        if not query_term:
            continue
        try:
            pairs = client.search_pairs(query_term)
        except Exception:
            continue
        ranked_pairs = []
        for pair in pairs:
            chain_id = str(pair.get("chainId") or "").strip().lower()
            if chain_id not in config.allowed_chains:
                continue
            base_token = pair.get("baseToken") if isinstance(pair.get("baseToken"), dict) else {}
            token_address = str(base_token.get("address") or "").strip()
            if not token_address:
                continue
            pair_score = _score_search_pair_match(pair, query_term)
            if pair_score == float("-inf"):
                continue
            ranked_pairs.append((pair_score, pair))

        ranked_pairs.sort(key=lambda item: item[0], reverse=True)
        added_for_query = 0
        primary_trend_key = str(query.get("trend_key") or "").strip()
        family_key = str(query.get("family_key") or _seed_family_key(query_term)).strip()
        title_based = bool(query.get("title_based"))
        per_query_cap = config.max_pairs_per_seed + (
            4 if title_based else 2 if _safe_int(query.get("stage")) > 0 else 1
        )
        for _pair_score, pair in ranked_pairs:
            if added_for_query >= per_query_cap:
                break
            base_token = pair.get("baseToken") if isinstance(pair.get("baseToken"), dict) else {}
            chain_id = str(pair.get("chainId") or "").strip().lower()
            token_address = str(base_token.get("address") or "").strip()
            candidate_key = (chain_id, token_address)
            is_new_hint = candidate_key not in hints_by_key
            if primary_trend_key and is_new_hint and trend_result_counts.get(primary_trend_key, 0) >= per_trend_cap:
                continue
            family_counter_key = (primary_trend_key, family_key)
            if is_new_hint and family_result_counts.get(family_counter_key, 0) >= per_family_cap:
                continue
            _upsert_discovery_hint(
                hints_by_key,
                chain_id=chain_id,
                token_address=token_address,
                source_name="trend_seed_search",
                seed_terms=[query_term, str(query.get("term") or "").strip()],
                matched_trend_keys=list(query.get("trend_keys") or []),
            )
            if is_new_hint:
                if primary_trend_key:
                    trend_result_counts[primary_trend_key] = trend_result_counts.get(primary_trend_key, 0) + 1
                family_result_counts[family_counter_key] = family_result_counts.get(family_counter_key, 0) + 1
                added_for_query += 1
    return hints_by_key


def _quote_token_bonus(symbol: str | None) -> int:
    return QUOTE_SYMBOL_BONUS.get(str(symbol or "").strip(), 0)


def _canonical_dexscreener_url(chain_id: str | None, pair_address: str | None) -> str | None:
    normalized_chain = str(chain_id or "").strip().lower()
    normalized_pair = str(pair_address or "").strip()
    if not normalized_chain or not normalized_pair:
        return None
    return f"https://dexscreener.com/{normalized_chain}/{normalized_pair}"


def _is_usable_dexscreener_url(
    value: Any,
    *,
    expected_chain_id: str | None = None,
    expected_pair_address: str | None = None,
) -> bool:
    normalized = str(value or "").strip()
    if not normalized:
        return False
    try:
        parsed = urlparse(normalized)
    except Exception:
        return False
    if parsed.scheme not in {"http", "https"}:
        return False
    hostname = str(parsed.netloc or "").strip().lower()
    if "dexscreener.com" not in hostname:
        return False
    path_parts = [part.strip() for part in str(parsed.path or "").split("/") if part.strip()]
    if len(path_parts) < 2:
        return False
    pair_segment = path_parts[1]
    if not pair_segment or pair_segment.lower() in {"token", "pair", "pairs", "search"}:
        return False
    expected_chain = str(expected_chain_id or "").strip().lower()
    expected_pair = str(expected_pair_address or "").strip().lower()
    if expected_chain and path_parts[0].lower() != expected_chain:
        return False
    if expected_pair and pair_segment.lower() != expected_pair:
        return False
    return True


def _pair_has_identity(
    pair: dict[str, Any],
    *,
    expected_chain_id: str,
    expected_token_address: str,
) -> bool:
    base_token = pair.get("baseToken") if isinstance(pair.get("baseToken"), dict) else {}
    chain_id = str(pair.get("chainId") or "").strip().lower()
    token_address = str(base_token.get("address") or "").strip().lower()
    pair_address = str(pair.get("pairAddress") or "").strip()
    return (
        bool(chain_id)
        and bool(token_address)
        and bool(pair_address)
        and chain_id == expected_chain_id.strip().lower()
        and token_address == expected_token_address.strip().lower()
    )


def _pair_recent_activity_key(pair: dict[str, Any]) -> tuple[float, float, int, float, int, float]:
    _buys_h1, _sells_h1, txns_h1 = DexscreenerClient.summarize_txns(pair, "h1")
    _buys_h6, _sells_h6, txns_h6 = DexscreenerClient.summarize_txns(pair, "h6")
    _buys_h24, _sells_h24, txns_h24 = DexscreenerClient.summarize_txns(pair, "h24")
    volume_h1 = max(0.0, _safe_float((pair.get("volume") or {}).get("h1")))
    volume_h6 = max(0.0, _safe_float((pair.get("volume") or {}).get("h6")))
    volume_h24 = max(0.0, _safe_float((pair.get("volume") or {}).get("h24")))
    return (
        float(txns_h1),
        volume_h1,
        txns_h6,
        volume_h6,
        txns_h24,
        volume_h24,
    )


def _live_pair_sort_key(pair: dict[str, Any]) -> tuple[float, float, tuple[float, float, int, float, int, float], int, float, str]:
    liquidity_usd = max(0.0, _safe_float((pair.get("liquidity") or {}).get("usd")))
    volume_h24 = max(0.0, _safe_float((pair.get("volume") or {}).get("h24")))
    pair_address = str(pair.get("pairAddress") or "").strip().lower()
    url_bonus = 1 if _is_usable_dexscreener_url(pair.get("url")) else 0
    pair_created_ts = DexscreenerClient.parse_pair_created_at(pair.get("pairCreatedAt")) or 0.0
    return (
        liquidity_usd,
        volume_h24,
        _pair_recent_activity_key(pair),
        url_bonus,
        pair_created_ts,
        pair_address,
    )


def _unique_live_pairs(pairs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    output: list[dict[str, Any]] = []
    for pair in pairs:
        pair_address = str(pair.get("pairAddress") or "").strip().lower()
        url = str(pair.get("url") or "").strip().lower()
        key = pair_address or url
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(pair)
    return output


def _choose_best_pair(token_pairs: list[dict[str, Any]]) -> dict[str, Any] | None:
    best_pair: dict[str, Any] | None = None
    for pair in token_pairs:
        if best_pair is None or _live_pair_sort_key(pair) > _live_pair_sort_key(best_pair):
            best_pair = pair
    return best_pair


def _build_token_text(
    *,
    token_name: str,
    token_symbol: str,
    description: str | None,
    websites: list[dict[str, Any]],
    socials: list[dict[str, Any]],
    seed_terms: set[str],
) -> str:
    website_terms = " ".join(str(site.get("label") or site.get("url") or "") for site in websites)
    social_terms = " ".join(str(site.get("type") or site.get("url") or "") for site in socials)
    return " ".join(
        value
        for value in [
            token_name,
            token_symbol,
            description or "",
            website_terms,
            social_terms,
            " ".join(sorted(seed_terms)),
        ]
        if value
    ).strip()


def _score_memecoin_fit(candidate: MarketCandidate) -> float:
    token_text = _normalize_text(candidate.token_text)
    name_text = _normalize_text(f"{candidate.token_name} {candidate.token_symbol}")
    style_hits = _keywords_present(token_text, MEMECOIN_STYLE_TERMS)
    name_style_hits = _keywords_present(name_text, MEMECOIN_STYLE_TERMS)
    culture_hits = sum(
        _keywords_present(token_text, terms)
        for terms in PREFERRED_CATEGORY_TERMS.values()
    )
    utility_hits = _keywords_present(token_text, UTILITY_TOKEN_TERMS)

    source_bonus = 0.0
    if "dex_community_takeovers_latest" in candidate.discovery_sources or candidate.community_takeover:
        source_bonus += 14.0
    if "dex_boosts_top" in candidate.discovery_sources:
        source_bonus += 10.0
    if "dex_boosts_latest" in candidate.discovery_sources:
        source_bonus += 6.0
    if "dex_profiles_latest" in candidate.discovery_sources:
        source_bonus += 4.0

    social_bonus = 0.0
    social_text = " ".join(
        [
            *[
                str(entry.get("platform") or entry.get("label") or entry.get("type") or "")
                for entry in candidate.socials
            ],
            *[
                str(entry.get("label") or entry.get("url") or "")
                for entry in candidate.websites
            ],
        ]
    )
    social_bonus += min(6.0, _keywords_present(_normalize_text(social_text), SOCIAL_PLATFORM_TERMS) * 1.5)
    social_bonus += min(6.0, len(candidate.matched_trend_keys) * 1.5)

    penalty = utility_hits * 7.5
    if utility_hits >= 2 and style_hits == 0 and name_style_hits == 0:
        penalty += 10.0

    fit_score = (
        style_hits * 8.0
        + name_style_hits * 4.0
        + min(18.0, culture_hits * 1.8)
        + source_bonus
        + social_bonus
        - penalty
    )
    if style_hits == 0 and name_style_hits == 0 and culture_hits == 0:
        fit_score = min(fit_score, 16.0 if candidate.community_takeover else 10.0)
    return round(_clamp(fit_score, 0.0, 100.0), 3)


def _score_market_health(candidate: MarketCandidate) -> float:
    age_hours = _age_hours_from(candidate.pair_created_at, _utc_now()) or 0.0
    activity_ratio = candidate.volume_h1 / candidate.volume_h24 if candidate.volume_h24 > 0 else 0.0
    score = (
        _log_score(candidate.liquidity_usd, weight=10.0, cap=28.0)
        + _log_score(candidate.volume_h24, weight=8.0, cap=22.0)
        + min(16.0, math.log1p(max(0, candidate.txns_h24)) * 3.2)
        + min(10.0, max(0.0, activity_ratio) * 85.0)
        + (3.0 if age_hours >= 1.0 else 1.5 if age_hours >= 0.1 else 0.0)
    )
    return _clamp(score, 0.0, 100.0)


def _coerce_links(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _market_candidate_from_pair(
    *,
    pair: dict[str, Any],
    hint: DiscoveryHint,
    now: datetime,
) -> MarketCandidate | None:
    base_token = pair.get("baseToken") if isinstance(pair.get("baseToken"), dict) else {}
    quote_token = pair.get("quoteToken") if isinstance(pair.get("quoteToken"), dict) else {}
    info = pair.get("info") if isinstance(pair.get("info"), dict) else {}
    if not isinstance(base_token, dict) or not isinstance(quote_token, dict):
        return None

    chain_id = str(pair.get("chainId") or hint.chain_id).strip().lower()
    token_address = str(base_token.get("address") or hint.token_address).strip()
    pair_address = str(pair.get("pairAddress") or "").strip()
    token_name = str(base_token.get("name") or "").strip()
    token_symbol = str(base_token.get("symbol") or "").strip().upper()
    if not chain_id or not token_address or not pair_address or not token_name or not token_symbol:
        return None

    buys_h24, sells_h24, txns_h24 = DexscreenerClient.summarize_txns(pair, "h24")
    _buys_h6, _sells_h6, txns_h6 = DexscreenerClient.summarize_txns(pair, "h6")
    _buys_h1, _sells_h1, txns_h1 = DexscreenerClient.summarize_txns(pair, "h1")
    websites = _coerce_links(info.get("websites")) or _coerce_links(hint.links)
    socials = _coerce_links(info.get("socials"))
    pair_created_ts = DexscreenerClient.parse_pair_created_at(pair.get("pairCreatedAt"))
    pair_created_at = (
        datetime.fromtimestamp(pair_created_ts, tz=timezone.utc).isoformat()
        if pair_created_ts
        else None
    )
    token_text = _build_token_text(
        token_name=token_name,
        token_symbol=token_symbol,
        description=hint.description,
        websites=websites,
        socials=socials,
        seed_terms=hint.seed_terms,
    )
    political_dominant = _keywords_present(
        _normalize_text(token_text),
        DEPRIORITIZED_TERMS["politics"],
    ) >= 2

    candidate = MarketCandidate(
        chain_id=chain_id,
        token_address=token_address,
        pair_address=pair_address,
        dexscreener_url=str(pair.get("url") or "").strip(),
        dex_id=str(pair.get("dexId") or "").strip() or None,
        pair_labels=_coerce_text_list(pair.get("labels")),
        token_name=token_name,
        token_symbol=token_symbol,
        quote_symbol=str(quote_token.get("symbol") or "").strip() or None,
        quote_token_address=str(quote_token.get("address") or "").strip() or None,
        quote_token_name=str(quote_token.get("name") or "").strip() or None,
        price_usd=_safe_float(pair.get("priceUsd"), default=float("nan")),
        liquidity_usd=max(0.0, _safe_float((pair.get("liquidity") or {}).get("usd"))),
        volume_h24=max(0.0, _safe_float((pair.get("volume") or {}).get("h24"))),
        volume_h6=max(0.0, _safe_float((pair.get("volume") or {}).get("h6"))),
        volume_h1=max(0.0, _safe_float((pair.get("volume") or {}).get("h1"))),
        price_change_h24=_safe_float((pair.get("priceChange") or {}).get("h24"), default=float("nan")),
        price_change_h6=_safe_float((pair.get("priceChange") or {}).get("h6"), default=float("nan")),
        price_change_h1=_safe_float((pair.get("priceChange") or {}).get("h1"), default=float("nan")),
        buys_h24=buys_h24,
        sells_h24=sells_h24,
        txns_h24=txns_h24,
        txns_h6=txns_h6,
        txns_h1=txns_h1,
        fdv=_safe_float(pair.get("fdv"), default=float("nan")),
        market_cap=_safe_float(pair.get("marketCap"), default=float("nan")),
        pair_created_at=pair_created_at,
        icon_url=str(info.get("imageUrl") or "").strip() or None,
        header_url=str(info.get("header") or "").strip() or None,
        websites=websites,
        socials=socials,
        description=hint.description,
        discovery_sources=set(hint.source_names),
        matched_trend_keys=set(hint.matched_trend_keys),
        seed_terms=set(hint.seed_terms),
        market_score=0.0,
        memecoin_fit_score=0.0,
        token_text=token_text,
        normalized_symbol=_compact_identity(token_symbol),
        normalized_name=_compact_identity(token_name),
        political_dominant=political_dominant,
        community_takeover=bool(hint.cto),
    )
    candidate.market_score = _score_market_health(candidate)
    candidate.memecoin_fit_score = _score_memecoin_fit(candidate)
    candidate.price_usd = None if candidate.price_usd != candidate.price_usd else candidate.price_usd
    candidate.price_change_h24 = (
        None if candidate.price_change_h24 != candidate.price_change_h24 else candidate.price_change_h24
    )
    candidate.price_change_h6 = (
        None if candidate.price_change_h6 != candidate.price_change_h6 else candidate.price_change_h6
    )
    candidate.price_change_h1 = (
        None if candidate.price_change_h1 != candidate.price_change_h1 else candidate.price_change_h1
    )
    candidate.fdv = None if candidate.fdv != candidate.fdv else candidate.fdv
    candidate.market_cap = None if candidate.market_cap != candidate.market_cap else candidate.market_cap
    return candidate


def _discovery_hint_from_candidate(candidate: MarketCandidate) -> DiscoveryHint:
    return DiscoveryHint(
        chain_id=candidate.chain_id,
        token_address=candidate.token_address,
        source_names=set(candidate.discovery_sources),
        seed_terms=set(candidate.seed_terms),
        matched_trend_keys=set(candidate.matched_trend_keys),
        description=candidate.description,
        links=list(candidate.websites or []),
        cto=bool(candidate.community_takeover),
    )


def _apply_live_validation_state(
    candidate: MarketCandidate,
    *,
    is_live: bool,
    validated_at: str,
    status: str,
    reason: str | None,
    source: str | None,
) -> MarketCandidate:
    candidate.is_live = bool(is_live)
    candidate.last_validated_at = validated_at
    candidate.validation_status = status
    candidate.validation_reason = reason
    candidate.validation_source = source
    candidate.last_seen_liquidity_usd = candidate.liquidity_usd
    candidate.last_seen_volume_h24 = candidate.volume_h24
    candidate.last_seen_txns_h24 = candidate.txns_h24
    return candidate


def _invalid_live_validation_result(
    candidate: MarketCandidate,
    *,
    validated_at: str,
    status: str,
    reason: str | None,
    source: str | None,
) -> LiveMarketValidationResult:
    return LiveMarketValidationResult(
        candidate=_apply_live_validation_state(
            candidate,
            is_live=False,
            validated_at=validated_at,
            status=status,
            reason=reason,
            source=source,
        ),
        is_live=False,
        status=status,
        reason=reason,
        source=source,
    )


def _validate_live_market_candidate(
    *,
    client: DexscreenerClient,
    candidate: MarketCandidate,
    config: MemecoinCorrelationRuntimeConfig,
    now: datetime,
    logger: Any | None = None,
) -> LiveMarketValidationResult:
    validated_at = now.isoformat()
    normalized_chain = str(candidate.chain_id or "").strip().lower()
    normalized_token = str(candidate.token_address or "").strip().lower()
    normalized_pair = str(candidate.pair_address or "").strip()

    def reject(reason: str, *, source: str | None, extra: dict[str, Any] | None = None) -> LiveMarketValidationResult:
        if logger is not None:
            payload = {
                "chain_id": normalized_chain,
                "token_address": candidate.token_address,
                "pair_address": candidate.pair_address,
                "reason": reason,
            }
            if extra:
                payload.update(extra)
            log_event(logger, logging.WARNING, "memecoin_live_validation_failed", **payload)
        return _invalid_live_validation_result(
            candidate,
            validated_at=validated_at,
            status="invalid",
            reason=reason,
            source=source,
        )

    if not normalized_chain or not normalized_token or not normalized_pair:
        return reject("missing_identity", source="input_only")

    pair_lookup_error: str | None = None
    token_lookup_error: str | None = None
    pair_candidates: list[dict[str, Any]] = []
    token_candidates: list[dict[str, Any]] = []
    try:
        pair_candidates = client.get_pair_by_address(
            chain_id=normalized_chain,
            pair_address=normalized_pair,
        )
    except Exception as error:
        pair_lookup_error = str(error)
    try:
        token_candidates = client.get_pairs_for_token(
            chain_id=normalized_chain,
            token_address=candidate.token_address,
        )
    except Exception as error:
        token_lookup_error = str(error)

    candidate_pairs = _unique_live_pairs(
        [
            pair
            for pair in [*pair_candidates, *token_candidates]
            if _pair_has_identity(
                pair,
                expected_chain_id=normalized_chain,
                expected_token_address=normalized_token,
            )
        ]
    )
    if not candidate_pairs:
        reason = (
            "pair_lookup_failed"
            if pair_lookup_error and token_lookup_error
            else "no_pair_found"
        )
        return reject(
            reason,
            source="pair_address" if pair_candidates else "token_address",
            extra={
                "pair_lookup_error": pair_lookup_error,
                "token_lookup_error": token_lookup_error,
            },
        )

    best_pair = sorted(candidate_pairs, key=_live_pair_sort_key, reverse=True)[0]
    validated_pair_candidates = pair_candidates
    if str(best_pair.get("pairAddress") or "").strip().lower() != normalized_pair.lower():
        try:
            validated_pair_candidates = client.get_pair_by_address(
                chain_id=normalized_chain,
                pair_address=str(best_pair.get("pairAddress") or "").strip(),
            )
        except Exception as error:
            pair_lookup_error = str(error)
            validated_pair_candidates = []
    validated_pair = next(
        (
            pair
            for pair in validated_pair_candidates
            if str(pair.get("pairAddress") or "").strip().lower()
            == str(best_pair.get("pairAddress") or "").strip().lower()
        ),
        None,
    )
    if validated_pair is None:
        return reject(
            "pair_deleted",
            source="pair_address",
            extra={
                "pair_address": str(best_pair.get("pairAddress") or "").strip(),
                "pair_lookup_error": pair_lookup_error,
            },
        )

    pair_address = str(validated_pair.get("pairAddress") or "").strip()
    chain_id = str(validated_pair.get("chainId") or normalized_chain).strip().lower()
    pair_url = (
        str(validated_pair.get("url") or "").strip()
        if _is_usable_dexscreener_url(
            validated_pair.get("url"),
            expected_chain_id=chain_id,
            expected_pair_address=pair_address,
        )
        else _canonical_dexscreener_url(chain_id, pair_address) or ""
    )
    if not _is_usable_dexscreener_url(
        pair_url,
        expected_chain_id=chain_id,
        expected_pair_address=pair_address,
    ):
        return reject("bad_url", source="pair_address")

    liquidity_usd = max(0.0, _safe_float((validated_pair.get("liquidity") or {}).get("usd")))
    volume_h24 = max(0.0, _safe_float((validated_pair.get("volume") or {}).get("h24")))
    volume_h6 = max(0.0, _safe_float((validated_pair.get("volume") or {}).get("h6")))
    volume_h1 = max(0.0, _safe_float((validated_pair.get("volume") or {}).get("h1")))
    _buys_h24, _sells_h24, txns_h24 = DexscreenerClient.summarize_txns(validated_pair, "h24")
    _buys_h6, _sells_h6, txns_h6 = DexscreenerClient.summarize_txns(validated_pair, "h6")
    _buys_h1, _sells_h1, txns_h1 = DexscreenerClient.summarize_txns(validated_pair, "h1")
    if liquidity_usd < config.live_min_liquidity_usd:
        return reject("liquidity_too_low", source="pair_address")
    has_recent_volume = (
        volume_h24 >= config.live_min_volume_24h_usd
        or volume_h6 >= max(50.0, config.live_min_volume_24h_usd * 0.25)
        or volume_h1 >= max(20.0, config.live_min_volume_24h_usd * 0.08)
    )
    has_recent_txns = (
        txns_h24 >= config.live_min_recent_txns
        or txns_h6 >= max(1, math.ceil(config.live_min_recent_txns * 0.5))
        or txns_h1 >= max(1, math.ceil(config.live_min_recent_txns * 0.25))
    )
    if not has_recent_volume and not has_recent_txns:
        return reject("stale_market", source="pair_address")

    rebuilt_candidate = _market_candidate_from_pair(
        pair={**validated_pair, "url": pair_url},
        hint=_discovery_hint_from_candidate(candidate),
        now=now,
    )
    if rebuilt_candidate is None:
        return reject("market_data_incomplete", source="pair_address")

    rebuilt_candidate.tradingview_symbol = candidate.tradingview_symbol
    rebuilt_candidate.tradingview_exchange = candidate.tradingview_exchange
    rebuilt_candidate.tradingview_embed_symbol = candidate.tradingview_embed_symbol
    rebuilt_candidate.tv_resolution_status = candidate.tv_resolution_status
    rebuilt_candidate.tv_verified_at = candidate.tv_verified_at
    rebuilt_candidate.tv_last_checked_at = candidate.tv_last_checked_at
    rebuilt_candidate.tv_failure_reason = candidate.tv_failure_reason
    rebuilt_candidate.tv_search_evidence = dict(candidate.tv_search_evidence or {})
    rebuilt_candidate.has_verified_tradingview_preview = bool(candidate.has_verified_tradingview_preview)
    rebuilt_candidate = _apply_live_validation_state(
        rebuilt_candidate,
        is_live=True,
        validated_at=validated_at,
        status="live",
        reason=None,
        source="pair_address" if pair_candidates else "token_address",
    )
    if logger is not None and candidate.pair_address != rebuilt_candidate.pair_address:
        log_event(
            logger,
            logging.INFO,
            "memecoin_live_validation_pair_switched",
            chain_id=rebuilt_candidate.chain_id,
            token_address=rebuilt_candidate.token_address,
            previous_pair_address=candidate.pair_address,
            selected_pair_address=rebuilt_candidate.pair_address,
            liquidity_usd=rebuilt_candidate.liquidity_usd,
            volume_h24=rebuilt_candidate.volume_h24,
            txns_h24=rebuilt_candidate.txns_h24,
        )
    return LiveMarketValidationResult(
        candidate=rebuilt_candidate,
        is_live=True,
        status="live",
        reason=None,
        source=rebuilt_candidate.validation_source,
    )


def _volume_liquidity_ratio(candidate: MarketCandidate) -> float | None:
    if candidate.liquidity_usd <= 0:
        return None
    return candidate.volume_h24 / candidate.liquidity_usd


def _has_basic_market_presence(
    candidate: MarketCandidate,
    *,
    config: MemecoinCorrelationRuntimeConfig,
) -> bool:
    has_liquidity = candidate.liquidity_usd >= config.minimum_basic_liquidity_usd
    has_volume = (
        candidate.volume_h24 >= config.minimum_basic_volume_24h_usd
        or candidate.volume_h6 >= config.minimum_basic_volume_24h_usd * 0.4
        or candidate.volume_h1 >= config.minimum_basic_volume_24h_usd * 0.18
    )
    has_txns = (
        candidate.txns_h24 >= config.minimum_basic_txns_24h
        or candidate.txns_h6 >= max(1, math.ceil(config.minimum_basic_txns_24h * 0.5))
        or candidate.txns_h1 >= 1
    )
    has_trade_flow = (candidate.buys_h24 + candidate.sells_h24) > 0 or has_txns
    return has_liquidity and (has_volume or has_txns) and has_trade_flow


def _anti_rug_sanity_failure(
    candidate: MarketCandidate,
    *,
    config: MemecoinCorrelationRuntimeConfig,
) -> str | None:
    if candidate.price_usd is not None and candidate.price_usd <= 0:
        return "broken_metadata"
    if not candidate.pair_address or not candidate.quote_symbol:
        return "broken_metadata"
    ratio = _volume_liquidity_ratio(candidate)
    if ratio is not None and ratio > config.max_volume_liquidity_ratio:
        return "anti_rug_failed"
    if candidate.price_change_h24 is not None and abs(candidate.price_change_h24) >= 1600:
        return "anti_rug_failed"
    if candidate.liquidity_usd <= 0 and candidate.volume_h24 <= 0 and candidate.txns_h24 <= 0:
        return "anti_rug_failed"
    return None


def _rugged_or_dead_failure(
    candidate: MarketCandidate,
    *,
    config: MemecoinCorrelationRuntimeConfig,
    now: datetime,
) -> str | None:
    age_hours = _age_hours_from(candidate.pair_created_at, now)
    dried_up_activity = (
        candidate.volume_h24 <= config.dead_volume_24h_usd
        and candidate.volume_h6 <= max(80.0, config.dead_volume_24h_usd * 0.15)
        and candidate.txns_h24 <= config.dead_txns_24h
        and candidate.txns_h6 <= max(1, math.ceil(config.dead_txns_24h * 0.34))
        and (candidate.buys_h24 + candidate.sells_h24) <= max(4, config.dead_txns_24h + 1)
    )
    if candidate.liquidity_usd <= config.drained_liquidity_usd and dried_up_activity:
        return "liquidity_drained"
    if (
        age_hours is not None
        and age_hours >= config.dead_pair_age_hours
        and candidate.liquidity_usd <= config.dead_liquidity_usd
        and dried_up_activity
    ):
        return "dead_pair_activity"

    severe_dump = candidate.price_change_h24 is not None and candidate.price_change_h24 <= -config.rug_pull_price_drop_pct
    sell_dominant = candidate.sells_h24 >= max(8, candidate.buys_h24 * 2)
    weak_recovery = (
        candidate.volume_h6 <= max(120.0, config.dead_volume_24h_usd * 0.2)
        and candidate.txns_h6 <= max(1, math.ceil(config.dead_txns_24h * 0.5))
    )
    drained_state = candidate.liquidity_usd <= max(config.dead_liquidity_usd, config.drained_liquidity_usd * 3.0)
    if severe_dump and sell_dominant and weak_recovery and drained_state:
        return "rug_pull_signature"
    return None


def _candidate_filter_reason(
    candidate: MarketCandidate,
    *,
    config: MemecoinCorrelationRuntimeConfig,
    now: datetime,
) -> str | None:
    if not candidate.dexscreener_url:
        return "missing_dex_url"
    if not candidate.normalized_name or not candidate.normalized_symbol:
        return "broken_metadata"
    if candidate.normalized_symbol in {"null", "none", "token"}:
        return "broken_metadata"
    if not _has_basic_market_presence(candidate, config=config):
        return "no_basic_market_presence"
    anti_rug_failure = _anti_rug_sanity_failure(candidate, config=config)
    if anti_rug_failure:
        return anti_rug_failure
    rugged_or_dead_failure = _rugged_or_dead_failure(candidate, config=config, now=now)
    if rugged_or_dead_failure:
        return rugged_or_dead_failure
    return None


def _soft_gate_penalties(
    candidate: MarketCandidate,
    *,
    config: MemecoinCorrelationRuntimeConfig,
    now: datetime,
) -> tuple[dict[str, float], float]:
    penalties: dict[str, float] = {}

    def add_penalty(reason: str, value: float) -> None:
        penalties[reason] = round(max(0.0, value), 3)

    if candidate.liquidity_usd < config.min_liquidity_usd:
        liquidity_gap_ratio = 1.0 - _clamp(candidate.liquidity_usd / max(config.min_liquidity_usd, 1.0), 0.0, 1.0)
        add_penalty("low_liquidity", 1.2 + liquidity_gap_ratio * 2.6)
    if candidate.volume_h24 < config.min_volume_24h_usd:
        volume_gap_ratio = 1.0 - _clamp(candidate.volume_h24 / max(config.min_volume_24h_usd, 1.0), 0.0, 1.0)
        add_penalty("low_volume", 1.0 + volume_gap_ratio * 2.4)
    if candidate.txns_h24 < config.min_txns_24h:
        txn_gap_ratio = 1.0 - _clamp(candidate.txns_h24 / max(config.min_txns_24h, 1), 0.0, 1.0)
        add_penalty("low_txns", 0.8 + txn_gap_ratio * 2.0)
    age_hours = _age_hours_from(candidate.pair_created_at, now)
    if age_hours is not None and age_hours < config.new_pair_penalty_hours:
        age_gap_ratio = 1.0 - _clamp(age_hours / max(config.new_pair_penalty_hours, 0.01), 0.0, 1.0)
        add_penalty("fresh_pair", 0.4 + age_gap_ratio * 1.2)
    if candidate.memecoin_fit_score < config.min_memecoin_fit_score:
        fit_gap_ratio = 1.0 - _clamp(
            candidate.memecoin_fit_score / max(config.min_memecoin_fit_score, 0.1),
            0.0,
            1.0,
        )
        add_penalty("low_memecoin_fit", 0.35 + fit_gap_ratio * 1.4)
    return penalties, round(sum(penalties.values()), 3)


def _candidate_force_fill_score(
    candidate: MarketCandidate,
    *,
    config: MemecoinCorrelationRuntimeConfig,
    now: datetime,
) -> float:
    penalties, total_penalty = _soft_gate_penalties(candidate, config=config, now=now)
    recovery_bonus = 0.0
    if not penalties:
        recovery_bonus += 1.0
    if candidate.liquidity_usd >= config.min_liquidity_usd:
        recovery_bonus += 1.0
    if candidate.volume_h24 >= config.min_volume_24h_usd:
        recovery_bonus += 1.0
    if candidate.txns_h24 >= config.min_txns_24h:
        recovery_bonus += 0.6
    recovery_bonus += min(4.0, len(candidate.matched_trend_keys) * 1.2)
    return round(candidate.market_score * 0.6 + candidate.memecoin_fit_score * 0.25 + recovery_bonus - total_penalty, 3)


def _hydrate_market_candidates(
    *,
    client: DexscreenerClient,
    config: MemecoinCorrelationRuntimeConfig,
    hints_by_key: dict[tuple[str, str], DiscoveryHint],
    now: datetime,
    logger: Any | None = None,
) -> CandidateHydrationResult:
    candidate_hints = list(hints_by_key.values())[: config.max_discovery_tokens]
    by_chain: dict[str, list[str]] = defaultdict(list)
    for hint in candidate_hints:
        by_chain[hint.chain_id].append(hint.token_address)

    hydrated: list[MarketCandidate] = []
    reject_counts: dict[str, int] = {}
    penalty_counts: dict[str, int] = {}
    funnel_counts: dict[str, int] = {
        "candidates_after_metadata_sanity": 0,
        "candidates_after_basic_market_sanity": 0,
        "candidates_after_anti_rug_screen": 0,
        "candidates_after_live_validation": 0,
    }
    for chain_id, token_addresses in by_chain.items():
        deduped_addresses = _unique_preserve(token_addresses)
        for index in range(0, len(deduped_addresses), 30):
            chunk = deduped_addresses[index : index + 30]
            try:
                token_pairs = client.get_pairs_for_tokens(chain_id=chain_id, token_addresses=chunk)
            except Exception:
                continue

            pairs_by_token: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for pair in token_pairs:
                base_token = pair.get("baseToken") if isinstance(pair.get("baseToken"), dict) else {}
                token_address = str(base_token.get("address") or "").strip()
                if token_address:
                    pairs_by_token[token_address].append(pair)

            for token_address in chunk:
                token_pairs_for_address = pairs_by_token.get(token_address, [])
                if not token_pairs_for_address:
                    _increment_count(reject_counts, "missing_pair_data")
                    continue
                best_pair = _choose_best_pair(token_pairs_for_address)
                hint = hints_by_key.get((chain_id, token_address))
                if best_pair is None or hint is None:
                    _increment_count(reject_counts, "missing_best_pair")
                    continue
                candidate = _market_candidate_from_pair(pair=best_pair, hint=hint, now=now)
                if candidate is None:
                    _increment_count(reject_counts, "broken_metadata")
                    continue
                _increment_count(funnel_counts, "candidates_after_metadata_sanity")
                if not _has_basic_market_presence(candidate, config=config):
                    _increment_count(reject_counts, "no_basic_market_presence")
                    continue
                _increment_count(funnel_counts, "candidates_after_basic_market_sanity")
                anti_rug_failure = _anti_rug_sanity_failure(candidate, config=config)
                if anti_rug_failure:
                    _increment_count(reject_counts, anti_rug_failure)
                    continue
                _increment_count(funnel_counts, "candidates_after_anti_rug_screen")
                live_validation = _validate_live_market_candidate(
                    client=client,
                    candidate=candidate,
                    config=config,
                    now=now,
                    logger=logger,
                )
                if not live_validation.is_live or live_validation.candidate is None:
                    _increment_count(
                        reject_counts,
                        live_validation.reason or live_validation.status or "live_validation_failed",
                    )
                    continue
                candidate = live_validation.candidate
                _increment_count(funnel_counts, "candidates_after_live_validation")
                hard_reject_reason = _candidate_filter_reason(candidate, config=config, now=now)
                if hard_reject_reason:
                    _increment_count(reject_counts, hard_reject_reason)
                    continue
                if candidate.liquidity_usd >= config.min_liquidity_usd:
                    _increment_count(funnel_counts, "candidates_after_liquidity_filter")
                else:
                    _increment_count(penalty_counts, "low_liquidity")
                if candidate.volume_h24 >= config.min_volume_24h_usd:
                    _increment_count(funnel_counts, "candidates_after_volume_filter")
                else:
                    _increment_count(penalty_counts, "low_volume")
                if candidate.txns_h24 >= config.min_txns_24h:
                    _increment_count(funnel_counts, "candidates_after_txns_filter")
                else:
                    _increment_count(penalty_counts, "low_txns")
                age_hours = _age_hours_from(candidate.pair_created_at, now)
                if age_hours is not None and age_hours >= config.new_pair_penalty_hours:
                    _increment_count(funnel_counts, "candidates_after_pair_age_filter")
                else:
                    _increment_count(penalty_counts, "fresh_pair")
                if candidate.memecoin_fit_score >= config.min_memecoin_fit_score:
                    _increment_count(funnel_counts, "candidates_after_memecoin_fit")
                else:
                    _increment_count(penalty_counts, "low_memecoin_fit")
                hydrated.append(candidate)

    hydrated.sort(
        key=lambda item: (
            item.market_score,
            item.volume_h24,
            item.liquidity_usd,
            item.txns_h24,
        ),
        reverse=True,
    )
    return CandidateHydrationResult(
        candidates=hydrated,
        reject_counts=reject_counts,
        penalty_counts=penalty_counts,
        funnel_counts=funnel_counts,
    )


def _preview_input_from_candidate(
    candidate: MarketCandidate,
    *,
    existing_state: PersistedTradingViewState | None = None,
) -> TradingViewResolverInput:
    stored_symbol = (
        existing_state.tradingview_embed_symbol
        if existing_state and existing_state.tradingview_embed_symbol
        else existing_state.tradingview_symbol
        if existing_state and existing_state.tradingview_symbol
        else candidate.tradingview_embed_symbol
        if candidate.tradingview_embed_symbol
        else candidate.tradingview_symbol
    )
    return TradingViewResolverInput(
        chain_id=candidate.chain_id,
        token_address=candidate.token_address,
        pair_address=candidate.pair_address or None,
        symbol=candidate.token_symbol,
        name=candidate.token_name,
        quote_symbol=candidate.quote_symbol,
        dex_id=candidate.dex_id,
        dexscreener_url=candidate.dexscreener_url or None,
        pair_labels=list(candidate.pair_labels or []),
        stored_tradingview_symbol=stored_symbol,
    )


def _persisted_tv_state_from_row(row: dict[str, Any] | None) -> PersistedTradingViewState:
    payload = dict(row or {})
    return PersistedTradingViewState(
        tradingview_symbol=str(payload.get("tradingview_symbol") or "").strip() or None,
        tradingview_exchange=str(payload.get("tradingview_exchange") or "").strip() or None,
        tradingview_embed_symbol=str(payload.get("tradingview_embed_symbol") or "").strip() or None,
        tv_resolution_status=str(payload.get("tv_resolution_status") or "").strip() or None,
        tv_verified_at=str(payload.get("tv_verified_at") or "").strip() or None,
        tv_last_checked_at=str(payload.get("tv_last_checked_at") or "").strip() or None,
        tv_failure_reason=str(payload.get("tv_failure_reason") or "").strip() or None,
        tv_search_evidence=(
            dict(payload.get("tv_search_evidence_json") or {})
            if isinstance(payload.get("tv_search_evidence_json"), dict)
            else {}
        ),
        has_verified_tradingview_preview=bool(payload.get("has_verified_tradingview_preview")),
    )


def _apply_tradingview_result(
    candidate: MarketCandidate,
    result: TradingViewVerificationResult,
) -> None:
    candidate.tradingview_symbol = result.tradingview_symbol
    candidate.tradingview_exchange = result.tradingview_exchange
    candidate.tradingview_embed_symbol = result.tradingview_embed_symbol
    candidate.tv_resolution_status = result.tv_resolution_status
    candidate.tv_verified_at = result.tv_verified_at
    candidate.tv_last_checked_at = result.tv_last_checked_at
    candidate.tv_failure_reason = result.tv_failure_reason
    candidate.tv_search_evidence = dict(result.tv_search_evidence or {})
    candidate.has_verified_tradingview_preview = bool(result.has_verified_tradingview_preview)


def _serialize_tradingview_state_row(candidate: MarketCandidate) -> dict[str, Any]:
    return {
        "chain_id": candidate.chain_id,
        "token_address": candidate.token_address,
        "tradingview_symbol": candidate.tradingview_symbol,
        "tradingview_exchange": candidate.tradingview_exchange,
        "tradingview_embed_symbol": candidate.tradingview_embed_symbol,
        "tv_resolution_status": candidate.tv_resolution_status or (
            "verified" if candidate.has_verified_tradingview_preview else "unavailable"
        ),
        "tv_verified_at": _parse_iso_datetime(candidate.tv_verified_at),
        "tv_last_checked_at": _parse_iso_datetime(candidate.tv_last_checked_at),
        "tv_failure_reason": candidate.tv_failure_reason,
        "tv_search_evidence_json": dict(candidate.tv_search_evidence or {}),
        "has_verified_tradingview_preview": bool(candidate.has_verified_tradingview_preview),
    }


def _resolve_verified_tradingview_candidates(
    *,
    store: Any,
    logger: Any,
    candidates: list[MarketCandidate],
) -> PreviewEligibilityResult:
    if not candidates:
        return PreviewEligibilityResult(
            candidates=[],
            reject_counts={},
            funnel_counts={
                "candidates_before_tradingview_gate": 0,
                "candidates_after_tradingview_gate": 0,
            },
            diagnostics={
                "candidate_count": 0,
                "verified_count": 0,
                "unresolved_count": 0,
                "coverage_rate_pct": 0.0,
                "status_counts": {},
                "unresolved_reason_counts": {},
            },
        )

    asset_keys = [(candidate.chain_id, candidate.token_address) for candidate in candidates]
    state_fetcher = getattr(store, "fetch_memecoin_tradingview_states", None)
    state_rows = (
        state_fetcher(asset_keys=asset_keys)
        if callable(state_fetcher)
        else {}
    )
    persisted_states = {
        (str(chain_id).strip().lower(), str(token_address).strip()): _persisted_tv_state_from_row(row)
        for (chain_id, token_address), row in dict(state_rows or {}).items()
    }
    verifier = TradingViewPreviewVerifier(logger=logger)

    verified_candidates: list[MarketCandidate] = []
    status_counts: dict[str, int] = {}
    unresolved_reason_counts: dict[str, int] = {}
    search_attempts_total = 0
    state_rows_to_persist: list[dict[str, Any]] = []

    for candidate in candidates:
        existing_state = persisted_states.get((candidate.chain_id.lower(), candidate.token_address))
        resolution = verifier.resolve(
            _preview_input_from_candidate(candidate, existing_state=existing_state),
            existing_state,
        )
        _apply_tradingview_result(candidate, resolution)
        state_rows_to_persist.append(_serialize_tradingview_state_row(candidate))

        status_key = candidate.tv_resolution_status or (
            "verified" if candidate.has_verified_tradingview_preview else "unavailable"
        )
        _increment_count(status_counts, status_key)
        search_attempts_total += len(
            candidate.tv_search_evidence.get("candidate_validation")
            if isinstance(candidate.tv_search_evidence.get("candidate_validation"), list)
            else []
        )

        if candidate.has_verified_tradingview_preview and candidate.tradingview_embed_symbol:
            verified_candidates.append(candidate)
        else:
            _increment_count(
                unresolved_reason_counts,
                candidate.tv_failure_reason or status_key or "tradingview_symbol_unavailable",
            )

    upsert = getattr(store, "upsert_memecoin_tradingview_preview_states", None)
    if callable(upsert) and state_rows_to_persist:
        upsert(rows=state_rows_to_persist)

    coverage_rate_pct = round(
        (len(verified_candidates) / len(candidates)) * 100.0,
        2,
    )
    diagnostics = {
        "candidate_count": len(candidates),
        "verified_count": len(verified_candidates),
        "unresolved_count": max(0, len(candidates) - len(verified_candidates)),
        "coverage_rate_pct": coverage_rate_pct,
        "status_counts": status_counts,
        "unresolved_reason_counts": unresolved_reason_counts,
        "average_search_attempts_per_coin": round(search_attempts_total / max(1, len(candidates)), 3),
        "cached_verified_reuse_count": verifier.stats.get("cached_verified_reuse_count", 0),
        "cached_negative_reuse_count": verifier.stats.get("cached_negative_reuse_count", 0),
        "search_request_count": verifier.stats.get("search_request_count", 0),
        "search_cache_hit_count": verifier.stats.get("search_cache_hit_count", 0),
        "validation_request_count": verifier.stats.get("validation_request_count", 0),
        "validation_cache_hit_count": verifier.stats.get("validation_cache_hit_count", 0),
    }
    return PreviewEligibilityResult(
        candidates=candidates,
        reject_counts={},
        funnel_counts={
            "candidates_before_tradingview_gate": len(candidates),
            "candidates_after_tradingview_gate": len(candidates),
        },
        diagnostics=diagnostics,
    )


def _build_candidate_token_set(candidate: MarketCandidate) -> set[str]:
    tokens = set(_tokenize(candidate.token_name))
    tokens.update(_tokenize(candidate.token_symbol))
    tokens.update(_tokenize(candidate.token_text))
    for term in candidate.seed_terms:
        tokens.update(_tokenize(term))
    return {token for token in tokens if len(token) >= 2}


def _build_trend_token_set(
    trend: ActiveTrendCandidate,
    *,
    posts: list[RecentTrendPost] | None = None,
) -> set[str]:
    tokens = set(_tokenize(trend.display_label))
    tokens.update(_tokenize(trend.raw_label))
    tokens.update(_tokenize(trend.narrative_summary))
    tokens.update(_tokenize(trend.context_paragraph))
    for entity in trend.key_entities:
        tokens.update(_tokenize(entity))
    for post in (posts or [])[:24]:
        for value in [*post.cashtags, *post.hashtags, *post.key_phrases, *post.topic_seeds, *post.tags]:
            tokens.update(_tokenize(value))
    return {token for token in tokens if len(token) >= 2}


def _build_trend_phrase_candidates(
    trend: ActiveTrendCandidate,
    *,
    posts: list[RecentTrendPost],
) -> list[str]:
    phrases: list[str] = _unique_preserve(
        [
            trend.display_label,
            trend.raw_label,
            trend.narrative_summary or "",
            trend.context_paragraph or "",
            *trend.key_entities,
        ]
    )
    phrase_counts: dict[str, int] = {}
    for post in posts[:24]:
        for value in [*post.cashtags, *post.hashtags, *post.key_phrases, *post.topic_seeds, *post.tags]:
            normalized = str(value or "").strip()
            if not normalized or not _is_seed_term_usable(normalized):
                continue
            phrase_counts[normalized] = phrase_counts.get(normalized, 0) + 1
    for phrase, _count in sorted(
        phrase_counts.items(),
        key=lambda item: (item[1], len(item[0]), item[0].lower()),
        reverse=True,
    )[:12]:
        phrases.append(phrase)
    for base_value in [trend.display_label, trend.raw_label, trend.narrative_summary, trend.context_paragraph, *trend.key_entities]:
        phrases.extend(_extract_phrase_variants(base_value, max_phrases=2))
    return _unique_preserve([phrase for phrase in phrases if str(phrase or "").strip()])[:20]


def _post_mentions_candidate(post: RecentTrendPost, candidate: MarketCandidate) -> bool:
    normalized_text = post.normalized_text
    if not normalized_text:
        return False
    symbol = candidate.token_symbol.upper()
    if symbol and symbol in post.cashtags:
        return True
    symbol_token = candidate.normalized_symbol
    name_token = candidate.normalized_name
    if symbol_token and symbol_token in _compact_identity(normalized_text):
        return True
    if name_token and name_token in _compact_identity(normalized_text):
        return True
    for seed_term in candidate.seed_terms:
        normalized_seed = _normalize_text(seed_term)
        if normalized_seed and normalized_seed in normalized_text:
            return True
    return False


def _build_trend_link_reasons(
    *,
    candidate: MarketCandidate,
    trend: ActiveTrendCandidate,
    match_type: str,
    exact_overlap_terms: list[str],
    phrase_overlap_terms: list[str],
    entity_overlap_terms: list[str],
    alias_overlap_groups: list[str],
    partial_overlap_terms: list[str],
    seed_overlap_terms: list[str],
    best_name_similarity: float,
    best_name_phrase: str | None,
    best_symbol_similarity: float,
    best_symbol_phrase: str | None,
    support_post_count: int,
    support_interaction_score: float,
    market_activity_ratio: float,
    generic_penalty: float,
    evidence_strength_score: float,
    narrative_strength_score: float,
    broad_only_match: bool,
    source_basis: list[str],
) -> tuple[str, list[str], dict[str, Any]]:
    match_reasons: list[str] = []
    if match_type == "explicit_origin":
        match_reasons.append("coin metadata points to the same named narrative")
    elif match_type == "strong_narrative":
        match_reasons.append("coin metadata strongly tracks the same narrative wave")
    else:
        match_reasons.append("best available narrative-adjacent fallback")
    if entity_overlap_terms:
        match_reasons.append(f"matched named entity '{entity_overlap_terms[0]}'")
    if phrase_overlap_terms:
        match_reasons.append(f"matched named phrase '{phrase_overlap_terms[0]}'")
    if alias_overlap_groups:
        match_reasons.append(f"matched alias group '{alias_overlap_groups[0]}'")
    if exact_overlap_terms:
        match_reasons.append(f"matched narrative keyword '{exact_overlap_terms[0]}'")
    if partial_overlap_terms:
        match_reasons.append(f"partial term overlap on '{partial_overlap_terms[0]}'")
    if seed_overlap_terms:
        match_reasons.append(f"secondary seed overlap from '{seed_overlap_terms[0]}'")
    if best_symbol_similarity >= 0.72 and best_symbol_phrase:
        match_reasons.append(f"ticker similarity to '{best_symbol_phrase}'")
    if best_name_similarity >= 0.62 and best_name_phrase:
        match_reasons.append(f"name similarity to '{best_name_phrase}'")
    if trend.topic_key in candidate.matched_trend_keys and match_type != "fallback":
        match_reasons.append("candidate also surfaced from this narrative's expanded search")
    if support_post_count > 0:
        match_reasons.append(
            f"{support_post_count} supporting social mention{'s' if support_post_count != 1 else ''}"
        )
    if candidate.liquidity_usd > 0 or candidate.volume_h24 > 0:
        match_reasons.append(
            f"market support ${round(candidate.liquidity_usd / 1000)}k liq / ${round(candidate.volume_h24 / 1000)}k vol"
        )
    if broad_only_match:
        match_reasons.append("broad thematic overlap only")
    why_linked = "; ".join(match_reasons[:3]).strip().rstrip(".") + "."
    return (
        why_linked,
        match_reasons[:5],
        {
            "match_type": match_type,
            "match_score": round(
                evidence_strength_score if match_type == "explicit_origin" else narrative_strength_score,
                3,
            ),
            "origin_reason": why_linked,
            "source_basis": source_basis,
            "evidence_signals": _unique_preserve(
                [
                    "entity_overlap" if entity_overlap_terms else "",
                    "phrase_overlap" if phrase_overlap_terms else "",
                    "alias_overlap" if alias_overlap_groups else "",
                    "keyword_overlap" if exact_overlap_terms else "",
                    "supporting_posts" if support_post_count > 0 else "",
                    "matched_trend_key" if trend.topic_key in candidate.matched_trend_keys else "",
                    "broad_only_overlap" if broad_only_match else "",
                ]
            ),
            "evidence_strength_score": round(evidence_strength_score, 3),
            "narrative_strength_score": round(narrative_strength_score, 3),
            "matched_entities": entity_overlap_terms,
            "matched_keywords": exact_overlap_terms,
            "exact_overlap_count": len(exact_overlap_terms),
            "exact_overlap_terms": exact_overlap_terms,
            "phrase_overlap_count": len(phrase_overlap_terms),
            "phrase_overlap_terms": phrase_overlap_terms,
            "entity_overlap_count": len(entity_overlap_terms),
            "entity_overlap_terms": entity_overlap_terms,
            "alias_overlap_groups": alias_overlap_groups,
            "partial_overlap_count": len(partial_overlap_terms),
            "partial_overlap_terms": partial_overlap_terms,
            "seed_overlap_count": len(seed_overlap_terms),
            "seed_overlap_terms": seed_overlap_terms,
            "best_name_similarity": round(best_name_similarity, 3),
            "best_name_phrase": best_name_phrase,
            "best_symbol_similarity": round(best_symbol_similarity, 3),
            "best_symbol_phrase": best_symbol_phrase,
            "support_post_count": support_post_count,
            "support_interaction_score": round(support_interaction_score, 3),
            "market_activity_ratio": round(max(0.0, market_activity_ratio), 4),
            "generic_penalty": round(generic_penalty, 3),
            "matched_trend_key": trend.topic_key in candidate.matched_trend_keys,
            "generic_only_match": broad_only_match,
        },
    )


def _score_trend_link(
    *,
    candidate: MarketCandidate,
    trend: ActiveTrendCandidate,
    posts: list[RecentTrendPost],
    now: datetime,
) -> TrendLinkScore:
    candidate_tokens = _build_candidate_token_set(candidate)
    trend_tokens = _build_trend_token_set(trend, posts=posts)
    trend_phrases = _build_trend_phrase_candidates(trend, posts=posts)
    noisy_terms = TOPIC_GENERIC_WEAK_TOKENS.union(TOPIC_NOISE_TOKENS).union(
        NARRATIVE_GENERIC_MATCH_TOKENS
    )
    trend_origin_values = [
        trend.display_label,
        trend.raw_label,
        trend.narrative_summary or "",
        trend.context_paragraph or "",
        *trend.key_entities,
        *trend_phrases,
    ]
    candidate_origin_values = [
        candidate.token_name,
        candidate.token_symbol,
        candidate.description or "",
        *[
            str(entry.get("label") or entry.get("url") or "")
            for entry in candidate.websites
        ],
        *[
            str(
                entry.get("platform")
                or entry.get("label")
                or entry.get("type")
                or entry.get("handle")
                or entry.get("url")
                or ""
            )
            for entry in candidate.socials
        ],
    ]
    trend_specific_tokens = {
        token
        for value in trend_origin_values
        for token in _specific_match_tokens(value)
    }
    candidate_specific_tokens = {
        token
        for value in candidate_origin_values
        for token in _specific_match_tokens(value)
    }
    shared_tokens = candidate_tokens.intersection(trend_tokens)
    exact_overlap_terms = sorted(candidate_specific_tokens.intersection(trend_specific_tokens))[:5]
    generic_overlap_terms = sorted(
        token
        for token in shared_tokens
        if len(token) >= 3 and token not in TOPIC_NOISE_TOKENS and token not in exact_overlap_terms
    )[:5]
    trend_specific_phrases = _unique_preserve(
        [
            phrase
            for value in trend_origin_values
            for phrase in _extract_specific_phrase_variants(value, max_phrases=3)
        ]
    )
    candidate_specific_phrases = _unique_preserve(
        [
            phrase
            for value in candidate_origin_values
            for phrase in _extract_specific_phrase_variants(value, max_phrases=3)
        ]
    )
    candidate_phrase_set = set(_normalize_text(phrase) for phrase in candidate_specific_phrases)
    candidate_text_normalized = _normalize_text(" ".join(candidate_origin_values))
    phrase_overlap_terms = [
        phrase
        for phrase in trend_specific_phrases
        if _normalize_text(phrase) in candidate_phrase_set
        or _normalize_text(phrase) in candidate_text_normalized
    ][:4]
    entity_overlap_terms = [
        entity
        for entity in _unique_preserve(
            [*trend.key_entities, trend.display_label, trend.raw_label]
        )
        if _compact_identity(entity)
        and any(
            not _is_narrative_generic_match_token(token)
            for token in _tokenize(entity)
        )
        and (
            _compact_identity(entity) in _compact_identity(candidate_text_normalized)
            or _normalize_text(entity) in candidate_phrase_set
        )
    ][:4]
    trend_alias_groups = set(_extract_alias_groups(trend_origin_values))
    candidate_alias_groups = set(_extract_alias_groups(candidate_origin_values))
    alias_overlap_groups = sorted(trend_alias_groups.intersection(candidate_alias_groups))[:3]
    partial_overlap_terms = _collect_partial_overlap_terms(
        {token for token in candidate_specific_tokens if token not in noisy_terms},
        {token for token in trend_specific_tokens if token not in noisy_terms},
        limit=5,
    )
    seed_overlap_terms = _unique_preserve(
        [
            str(seed_term).strip()
            for seed_term in sorted(candidate.seed_terms)
            if str(seed_term).strip()
            and any(
                not _is_narrative_generic_match_token(token)
                for token in _tokenize(seed_term)
            )
            and any(
                _normalize_text(seed_term) in _normalize_text(phrase)
                or _partial_overlap_term_score(seed_term, phrase) >= 0.55
                for phrase in trend_specific_phrases
            )
        ]
    )[:4]
    best_name_similarity, best_name_phrase = _best_similarity_match(candidate.token_name, trend_phrases)
    best_symbol_similarity, best_symbol_phrase = _best_similarity_match(candidate.token_symbol, trend_phrases)
    broad_only_match = (
        not exact_overlap_terms
        and not phrase_overlap_terms
        and not entity_overlap_terms
        and not alias_overlap_groups
    )
    generic_penalty = min(14.0, len(generic_overlap_terms) * 2.6)
    if broad_only_match and generic_overlap_terms:
        generic_penalty += min(10.0, len(generic_overlap_terms) * 1.4)

    lexical_score = min(
        68.0,
        len(exact_overlap_terms) * 11.0
        + len(phrase_overlap_terms) * 13.0
        + len(entity_overlap_terms) * 16.0
        + len(alias_overlap_groups) * 10.0
        + len(partial_overlap_terms) * 4.0
        + len(seed_overlap_terms) * 2.0
        + max(best_name_similarity, best_symbol_similarity) * 16.0,
    )
    if trend.topic_key in candidate.matched_trend_keys and not broad_only_match:
        lexical_score += 8.0
    if best_name_similarity >= 0.82:
        lexical_score += 8.0
    if best_symbol_similarity >= 0.86:
        lexical_score += 6.0

    support_post_count = 0
    support_interaction_score = 0.0
    for post in posts:
        if not _post_mentions_candidate(post, candidate):
            continue
        support_post_count += 1
        support_interaction_score += post.engagement_score + post.quality_score

    mention_score = min(
        34.0,
        support_post_count * 6.5 + math.log1p(max(0.0, support_interaction_score)) * 4.5,
    )
    freshness_hours = _age_hours_from(trend.last_seen_at, now)
    market_activity_ratio = (
        candidate.volume_h1 / candidate.volume_h24 if candidate.volume_h24 > 0 else 0.0
    )
    timing_score = 0.0
    if freshness_hours is not None and freshness_hours <= 6:
        timing_score += 8.0
    elif freshness_hours is not None and freshness_hours <= 24:
        timing_score += 4.0
    timing_score += min(12.0, max(0.0, market_activity_ratio) * 90.0)

    culture_fit_score = 0.0
    if trend.bias.dominant_category in PREFERRED_CATEGORY_TERMS:
        culture_fit_score += min(
            6.0,
            _keywords_present(
                _normalize_text(candidate.token_text),
                PREFERRED_CATEGORY_TERMS[trend.bias.dominant_category],
            )
            * 1.4,
        )
    if trend.topic_key in candidate.matched_trend_keys and not broad_only_match:
        culture_fit_score += 6.0
    if candidate.political_dominant and not trend.bias.political_dominant:
        culture_fit_score -= 6.0

    evidence_strength_score = 0.0
    if trend.topic_key in candidate.matched_trend_keys and (
        exact_overlap_terms or phrase_overlap_terms or entity_overlap_terms or alias_overlap_groups
    ):
        evidence_strength_score += 18.0
    evidence_strength_score += min(30.0, len(phrase_overlap_terms) * 16.0)
    evidence_strength_score += min(30.0, len(entity_overlap_terms) * 18.0)
    evidence_strength_score += min(18.0, len(alias_overlap_groups) * 11.0)
    evidence_strength_score += min(20.0, len(exact_overlap_terms) * 8.0)
    if support_post_count > 0 and (
        phrase_overlap_terms or entity_overlap_terms or alias_overlap_groups or exact_overlap_terms
    ):
        evidence_strength_score += min(10.0, support_post_count * 3.0)
    if broad_only_match:
        evidence_strength_score = min(evidence_strength_score, 22.0)
    evidence_strength_score = _clamp(evidence_strength_score, 0.0, 100.0)

    narrative_strength_score = (
        len(alias_overlap_groups) * 12.0
        + len(exact_overlap_terms) * 8.0
        + len(partial_overlap_terms) * 5.0
        + len(seed_overlap_terms) * 3.5
        + min(10.0, support_post_count * 3.5)
        + min(8.0, math.log1p(max(0.0, support_interaction_score)) * 2.2)
        + min(8.0, max(best_name_similarity, best_symbol_similarity) * 8.0)
    )
    if trend.topic_key in candidate.matched_trend_keys and not broad_only_match:
        narrative_strength_score += 8.0
    if broad_only_match:
        narrative_strength_score = min(narrative_strength_score, 34.0)
    narrative_strength_score = _clamp(narrative_strength_score, 0.0, 100.0)

    has_explicit_origin_evidence = bool(
        phrase_overlap_terms
        or entity_overlap_terms
        or alias_overlap_groups
        or len(exact_overlap_terms) >= 2
        or (
            exact_overlap_terms
            and any(len(term) >= 5 for term in exact_overlap_terms)
        )
    )
    has_strong_narrative_evidence = bool(
        alias_overlap_groups
        or exact_overlap_terms
        or partial_overlap_terms
        or seed_overlap_terms
        or support_post_count > 0
        or trend.topic_key in candidate.matched_trend_keys
    )
    if has_explicit_origin_evidence and evidence_strength_score >= 58.0:
        match_type = "explicit_origin"
    elif has_strong_narrative_evidence and narrative_strength_score >= 42.0 and not broad_only_match:
        match_type = "strong_narrative"
    else:
        match_type = "fallback"

    base_match_score = (
        evidence_strength_score
        if match_type == "explicit_origin"
        else narrative_strength_score
        if match_type == "strong_narrative"
        else min(34.0, narrative_strength_score * 0.55 + support_post_count * 2.0)
    )
    link_score = _clamp(
        base_match_score * 0.72
        + mention_score * 0.18
        + timing_score * 0.1
        + culture_fit_score * 0.06
        - generic_penalty,
        0.0,
        100.0,
    )
    if broad_only_match:
        link_score = min(link_score, 36.0)

    source_basis = _unique_preserve(
        [
            "token_metadata" if phrase_overlap_terms or entity_overlap_terms else "",
            "alias_dictionary" if alias_overlap_groups else "",
            "supporting_posts" if support_post_count > 0 else "",
            "search_seed" if seed_overlap_terms else "",
            "market_activity" if candidate.liquidity_usd > 0 or candidate.volume_h24 > 0 else "",
            "website_or_social_text"
            if any(_normalize_text(value) for value in candidate_origin_values[3:])
            else "",
        ]
    )

    why_linked, match_reasons, raw_match_signals = _build_trend_link_reasons(
        candidate=candidate,
        trend=trend,
        match_type=match_type,
        exact_overlap_terms=exact_overlap_terms,
        phrase_overlap_terms=phrase_overlap_terms,
        entity_overlap_terms=entity_overlap_terms,
        alias_overlap_groups=alias_overlap_groups,
        partial_overlap_terms=partial_overlap_terms,
        seed_overlap_terms=seed_overlap_terms,
        best_name_similarity=best_name_similarity,
        best_name_phrase=best_name_phrase,
        best_symbol_similarity=best_symbol_similarity,
        best_symbol_phrase=best_symbol_phrase,
        support_post_count=support_post_count,
        support_interaction_score=support_interaction_score,
        market_activity_ratio=market_activity_ratio,
        generic_penalty=generic_penalty,
        evidence_strength_score=evidence_strength_score,
        narrative_strength_score=narrative_strength_score,
        broad_only_match=broad_only_match,
        source_basis=source_basis,
    )
    return TrendLinkScore(
        topic_key=trend.topic_key,
        topic_label=trend.display_label,
        trend_category=trend.trend_category,
        narrative_summary=trend.narrative_summary,
        lexical_score=round(lexical_score, 3),
        mention_score=round(mention_score, 3),
        timing_score=round(timing_score, 3),
        culture_fit_score=round(culture_fit_score, 3),
        link_score=round(link_score, 3),
        support_post_count=support_post_count,
        support_interaction_score=round(support_interaction_score, 3),
        overlap_terms=_unique_preserve([*exact_overlap_terms, *partial_overlap_terms, *seed_overlap_terms])[:5],
        why_linked=why_linked,
        match_reasons=match_reasons,
        raw_match_signals=raw_match_signals,
    )


def _trend_link_is_plausible(link: TrendLinkScore) -> bool:
    match_type = str(link.raw_match_signals.get("match_type") or "").strip().lower()
    exact_overlap_count = _safe_int(link.raw_match_signals.get("exact_overlap_count"))
    phrase_overlap_count = _safe_int(link.raw_match_signals.get("phrase_overlap_count"))
    entity_overlap_count = _safe_int(link.raw_match_signals.get("entity_overlap_count"))
    alias_overlap_count = len(_coerce_text_list(link.raw_match_signals.get("alias_overlap_groups")))
    partial_overlap_count = _safe_int(link.raw_match_signals.get("partial_overlap_count"))
    seed_overlap_count = _safe_int(link.raw_match_signals.get("seed_overlap_count"))
    best_name_similarity = _safe_float(link.raw_match_signals.get("best_name_similarity"))
    best_symbol_similarity = _safe_float(link.raw_match_signals.get("best_symbol_similarity"))
    if match_type == "explicit_origin":
        return True
    if match_type == "strong_narrative" and (
        phrase_overlap_count > 0
        or entity_overlap_count > 0
        or alias_overlap_count > 0
        or exact_overlap_count > 0
        or link.support_post_count > 0
    ):
        return True
    return bool(
        link.support_post_count > 0
        or exact_overlap_count > 0
        or phrase_overlap_count > 0
        or entity_overlap_count > 0
        or alias_overlap_count > 0
        or partial_overlap_count > 0
        or seed_overlap_count > 0
        or max(best_name_similarity, best_symbol_similarity) >= 0.46
        or link.link_score >= 16.0
    )


def _match_type_priority(value: Any) -> int:
    normalized = str(value or "").strip().lower()
    if normalized == "explicit_origin":
        return 3
    if normalized == "strong_narrative":
        return 2
    if normalized == "fallback":
        return 1
    return 0


def _candidate_identity(candidate: MarketCandidate) -> str:
    return f"{candidate.chain_id}:{candidate.token_address.strip().lower()}"


def _load_recent_publications(
    *,
    store: Any,
    config: MemecoinCorrelationRuntimeConfig,
) -> list[dict[str, Any]]:
    if config.recent_repeat_penalty_window_runs <= 0:
        return []
    fetcher = getattr(store, "fetch_recent_memecoin_publication_stats", None)
    if not callable(fetcher):
        return []
    try:
        rows = fetcher(limit_runs=config.recent_repeat_penalty_window_runs)
    except TypeError:
        rows = fetcher()
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def _recent_publication_counts(rows: list[dict[str, Any]]) -> tuple[dict[str, int], dict[str, int]]:
    token_counts: dict[str, int] = {}
    theme_counts: dict[str, int] = {}
    for row in rows:
        chain_id = str(row.get("chain_id") or "").strip().lower()
        token_address = str(row.get("token_address") or "").strip().lower()
        if chain_id and token_address:
            _increment_count(token_counts, f"{chain_id}:{token_address}")
        topic_key = str(row.get("strongest_topic_key") or "").strip()
        if topic_key:
            _increment_count(theme_counts, topic_key)
    return token_counts, theme_counts


def _publish_tier_for_candidate(
    *,
    candidate: MarketCandidate,
    strongest: TrendLinkScore,
    correlation_score: float,
    config: MemecoinCorrelationRuntimeConfig,
    soft_penalty_score: float,
) -> str | None:
    adjusted_score = correlation_score - soft_penalty_score * 0.18
    match_type = str(strongest.raw_match_signals.get("match_type") or "").strip().lower()
    if (
        match_type == "explicit_origin"
        and adjusted_score >= config.high_confidence_correlation_threshold
        and candidate.market_score >= config.medium_confidence_market_floor
        and strongest.link_score >= 34.0
    ):
        return "high"
    if (
        match_type in {"explicit_origin", "strong_narrative"}
        and adjusted_score >= config.high_confidence_correlation_threshold
        and candidate.market_score >= config.medium_confidence_market_floor
        and strongest.link_score >= 20.0
    ):
        return "high"
    if (
        match_type in {"explicit_origin", "strong_narrative"}
        and adjusted_score >= config.medium_confidence_correlation_threshold
        and candidate.market_score >= config.medium_confidence_market_floor
        and (
            strongest.link_score >= 12.0
            or strongest.support_post_count > 0
            or bool(candidate.matched_trend_keys)
        )
    ):
        return "medium"
    return "exploratory"


def _correlation_label(score: float) -> str:
    if score >= 80:
        return "High"
    if score >= 60:
        return "Medium"
    if score >= 40:
        return "Speculative"
    return "Coverage"


def _trend_link_confidence_score(
    *,
    candidate: MarketCandidate,
    link: TrendLinkScore,
    soft_penalty_score: float,
) -> float:
    match_type = str(link.raw_match_signals.get("match_type") or "").strip().lower()
    exact_overlap_count = _safe_int(link.raw_match_signals.get("exact_overlap_count"))
    phrase_overlap_count = _safe_int(link.raw_match_signals.get("phrase_overlap_count"))
    entity_overlap_count = _safe_int(link.raw_match_signals.get("entity_overlap_count"))
    alias_overlap_count = len(_coerce_text_list(link.raw_match_signals.get("alias_overlap_groups")))
    partial_overlap_count = _safe_int(link.raw_match_signals.get("partial_overlap_count"))
    seed_overlap_count = _safe_int(link.raw_match_signals.get("seed_overlap_count"))
    best_similarity = max(
        _safe_float(link.raw_match_signals.get("best_name_similarity")),
        _safe_float(link.raw_match_signals.get("best_symbol_similarity")),
    )
    evidence_strength_score = _safe_float(link.raw_match_signals.get("evidence_strength_score"))
    narrative_strength_score = _safe_float(link.raw_match_signals.get("narrative_strength_score"))
    matched_key_bonus = (
        4.0
        if link.topic_key in candidate.matched_trend_keys and match_type != "fallback"
        else 0.0
    )
    seed_bonus = min(3.0, seed_overlap_count * 0.8 + len(candidate.seed_terms) * 0.08)
    exact_overlap_bonus = min(7.0, exact_overlap_count * 2.0)
    phrase_bonus = min(10.0, phrase_overlap_count * 3.0)
    entity_bonus = min(12.0, entity_overlap_count * 3.4)
    alias_bonus = min(8.0, alias_overlap_count * 2.8)
    partial_overlap_bonus = min(4.5, partial_overlap_count * 1.35)
    fuzzy_bonus = min(5.0, best_similarity * 5.4)
    support_bonus = min(
        10.0,
        link.support_post_count * 2.1 + math.log1p(max(0.0, link.support_interaction_score)) * 1.3,
    )
    score = (
        link.link_score * 0.52
        + candidate.market_score * 0.14
        + candidate.memecoin_fit_score * 0.06
        + evidence_strength_score * 0.16
        + narrative_strength_score * 0.08
        + matched_key_bonus
        + seed_bonus
        + exact_overlap_bonus
        + phrase_bonus
        + entity_bonus
        + alias_bonus
        + partial_overlap_bonus
        + fuzzy_bonus
        + support_bonus
        - soft_penalty_score * 1.15
    )
    if link.support_post_count <= 0:
        score -= 10.0
    if (
        exact_overlap_count <= 0
        and phrase_overlap_count <= 0
        and entity_overlap_count <= 0
        and alias_overlap_count <= 0
        and partial_overlap_count <= 0
    ):
        score -= 6.0
    if match_type == "fallback":
        score = min(score, 46.0)
    elif match_type == "strong_narrative":
        score = min(score, 82.0 if link.support_post_count <= 0 else 88.0)
    if link.support_post_count <= 0:
        score = min(
            score,
            86.0
            if phrase_overlap_count > 0 or entity_overlap_count > 0 or exact_overlap_count >= 2
            else 68.0,
        )
    elif link.support_post_count == 1 and exact_overlap_count <= 1:
        score = min(score, 84.0)
    return round(_clamp(score, 0.0, 100.0), 3)


def _build_trend_memecoin_rows(
    *,
    trends: list[ActiveTrendCandidate],
    trend_candidates: dict[str, list[dict[str, Any]]],
    now: datetime,
) -> list[dict[str, Any]]:
    tier_priority = {"high": 3, "medium": 2, "exploratory": 1}
    rows: list[dict[str, Any]] = []

    for trend in trends:
        ranked_candidates = sorted(
            trend_candidates.get(trend.topic_key, []),
            key=lambda item: (
                _match_type_priority(item["trend_link"].raw_match_signals.get("match_type")),
                tier_priority.get(str(item.get("publish_tier")), 0),
                float(item.get("confidence_score") or 0.0),
                item["trend_link"].support_post_count,
                item["trend_link"].support_interaction_score,
                item["candidate"].market_score,
                item["candidate"].volume_h24,
                item["candidate"].liquidity_usd,
                item["candidate"].token_symbol.lower(),
                item["candidate"].token_address.lower(),
            ),
            reverse=True,
        )
        plausible_ranked_candidates = [
            item for item in ranked_candidates if _trend_link_is_plausible(item["trend_link"])
        ]
        ranked_pool = plausible_ranked_candidates or ranked_candidates

        selected: list[dict[str, Any]] = []
        seen_token_keys: set[str] = set()
        for item in ranked_pool:
            token_key = _candidate_identity(item["candidate"])
            if token_key in seen_token_keys:
                continue
            seen_token_keys.add(token_key)
            selected.append(item)
            if len(selected) >= TREND_MEMECOIN_LINK_LIMIT:
                break

        if len(selected) < TREND_MEMECOIN_LINK_TARGET_MIN:
            for item in ranked_candidates:
                token_key = _candidate_identity(item["candidate"])
                if token_key in seen_token_keys:
                    continue
                if not _trend_link_is_plausible(item["trend_link"]):
                    continue
                seen_token_keys.add(token_key)
                selected.append(item)
                if len(selected) >= min(TREND_MEMECOIN_LINK_TARGET_MIN, TREND_MEMECOIN_LINK_LIMIT):
                    break

        for rank, item in enumerate(selected, start=1):
            candidate: MarketCandidate = item["candidate"]
            link: TrendLinkScore = item["trend_link"]
            confidence_score = float(item["confidence_score"])
            rows.append(
                {
                    "topic_key": trend.topic_key,
                    "topic_label": trend.display_label,
                    "rank": rank,
                    "chain_id": candidate.chain_id,
                    "coin_address": candidate.token_address,
                    "pair_address": candidate.pair_address,
                    "dexscreener_url": candidate.dexscreener_url,
                    "coin_symbol": candidate.token_symbol,
                    "coin_name": candidate.token_name,
                    "confidence_score": confidence_score,
                    "confidence_band": _confidence_band_from_score(confidence_score),
                    "mention_count": link.support_post_count,
                    "engagement_score": link.support_interaction_score,
                    "age_hours": _age_hours_from(candidate.pair_created_at, now),
                    "liquidity": candidate.liquidity_usd,
                    "volume_24h": candidate.volume_h24,
                    "market_score": candidate.market_score,
                    "memecoin_fit_score": candidate.memecoin_fit_score,
                    "why_linked": link.why_linked,
                    "match_reasons_json": link.match_reasons,
                    "raw_match_signals_json": link.raw_match_signals,
                }
            )

    return rows


def _rank_correlated_candidates(
    *,
    candidates: list[MarketCandidate],
    trends: list[ActiveTrendCandidate],
    posts_by_topic: dict[str, list[RecentTrendPost]],
    config: MemecoinCorrelationRuntimeConfig,
    now: datetime,
    recent_publications: list[dict[str, Any]] | None = None,
) -> CorrelationRankingResult:
    scored_candidates: list[dict[str, Any]] = []
    link_rows: list[dict[str, Any]] = []
    trend_candidate_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    reject_counts: dict[str, int] = {}
    penalty_counts: dict[str, int] = {}
    funnel_counts: dict[str, int] = {
        "candidates_after_relevance_scoring": 0,
        "candidates_after_publish_dedupe": 0,
        "distinct_tokens_published": 0,
        "high_candidates": 0,
        "medium_candidates": 0,
        "exploratory_candidates": 0,
        "final_published_count": 0,
    }
    ranking_diagnostics: dict[str, Any] = {
        "candidate_count": len(candidates),
        "candidates_with_links": 0,
        "candidates_without_links": 0,
        "high_candidates": 0,
        "medium_candidates": 0,
        "exploratory_candidates": 0,
        "rejected_below_exploratory_threshold": 0,
        "rejected_political_cap": 0,
        "rejected_duplicate_token_same_run": 0,
        "selected_count": 0,
        "high_confidence_published": 0,
        "medium_confidence_published": 0,
        "exploratory_published": 0,
        "final_published_count": 0,
        "forced_fill_used": False,
        "candidate_pool_exhausted": False,
        "minimally_sane_candidate_count": len(candidates),
        "under_threshold_examples": [],
    }

    trend_lookup = {trend.topic_key: trend for trend in trends}
    recent_token_counts, recent_theme_counts = _recent_publication_counts(recent_publications or [])
    for candidate in candidates:
        trend_links = [
            _score_trend_link(
                candidate=candidate,
                trend=trend,
                posts=posts_by_topic.get(trend.topic_key, []),
                now=now,
            )
            for trend in trends
        ]
        trend_links = [link for link in trend_links if link.link_score > 0]
        if not trend_links:
            ranking_diagnostics["candidates_without_links"] = (
                int(ranking_diagnostics.get("candidates_without_links") or 0) + 1
            )
            continue
        ranking_diagnostics["candidates_with_links"] = (
            int(ranking_diagnostics.get("candidates_with_links") or 0) + 1
        )
        trend_links.sort(
            key=lambda item: (
                _match_type_priority(item.raw_match_signals.get("match_type")),
                item.link_score,
                item.support_post_count,
                item.support_interaction_score,
                item.topic_label.lower(),
            ),
            reverse=True,
        )
        strongest = trend_links[0]
        multi_trend_bonus = min(12.0, max(0, len(trend_links) - 1) * 2.4)
        matched_key_bonus = min(8.0, len(candidate.matched_trend_keys) * 2.0)
        seed_bonus = min(5.0, len(candidate.seed_terms) * 0.4)
        strongest_component = strongest.link_score * 0.76
        market_component = candidate.market_score * 0.12
        memecoin_component = candidate.memecoin_fit_score * 0.06
        correlation_score = (
            strongest_component
            + market_component
            + memecoin_component
            + multi_trend_bonus
            + matched_key_bonus
            + seed_bonus
        )
        owning_trend = trend_lookup.get(strongest.topic_key)
        political_dominant = bool(
            candidate.political_dominant or (owning_trend.bias.political_dominant if owning_trend else False)
        )
        if political_dominant and not (owning_trend.bias.political_dominant if owning_trend else False):
            correlation_score -= 4.0
        correlation_score = round(_clamp(correlation_score, 0.0, 100.0), 3)
        soft_penalties, soft_penalty_score = _soft_gate_penalties(candidate, config=config, now=now)
        for reason in soft_penalties:
            _increment_count(penalty_counts, reason)
        publish_tier = _publish_tier_for_candidate(
            candidate=candidate,
            strongest=strongest,
            correlation_score=correlation_score,
            config=config,
            soft_penalty_score=soft_penalty_score,
        )
        if publish_tier is None:
            _increment_count(reject_counts, "below_exploratory_threshold")
            ranking_diagnostics["rejected_below_exploratory_threshold"] = (
                int(ranking_diagnostics.get("rejected_below_exploratory_threshold") or 0) + 1
            )
            under_threshold_examples = ranking_diagnostics.get("under_threshold_examples")
            if isinstance(under_threshold_examples, list) and len(under_threshold_examples) < 8:
                under_threshold_examples.append(
                    {
                        "symbol": candidate.token_symbol,
                        "name": candidate.token_name,
                        "correlation_score": correlation_score,
                        "market_score": round(candidate.market_score, 3),
                        "memecoin_fit_score": round(candidate.memecoin_fit_score, 3),
                        "strongest_topic_key": strongest.topic_key,
                        "strongest_topic_label": strongest.topic_label,
                        "strongest_link_score": strongest.link_score,
                        "support_post_count": strongest.support_post_count,
                        "matched_trend_keys": sorted(candidate.matched_trend_keys),
                    }
                )
            continue

        for trend_link in trend_links:
            trend_confidence_score = _trend_link_confidence_score(
                candidate=candidate,
                link=trend_link,
                soft_penalty_score=soft_penalty_score,
            )
            trend_publish_tier = _publish_tier_for_candidate(
                candidate=candidate,
                strongest=trend_link,
                correlation_score=trend_confidence_score,
                config=config,
                soft_penalty_score=soft_penalty_score,
            )
            if trend_publish_tier is None:
                continue
            trend_candidate_rows[trend_link.topic_key].append(
                {
                    "candidate": candidate,
                    "trend_link": trend_link,
                    "confidence_score": trend_confidence_score,
                    "publish_tier": trend_publish_tier,
                }
            )

        if publish_tier == "high":
            ranking_diagnostics["high_candidates"] = (
                int(ranking_diagnostics.get("high_candidates") or 0) + 1
            )
        elif publish_tier == "medium":
            ranking_diagnostics["medium_candidates"] = (
                int(ranking_diagnostics.get("medium_candidates") or 0) + 1
            )
        else:
            ranking_diagnostics["exploratory_candidates"] = (
                int(ranking_diagnostics.get("exploratory_candidates") or 0) + 1
            )

        token_identity = _candidate_identity(candidate)
        recent_token_appearances = recent_token_counts.get(token_identity, 0)
        recent_theme_appearances = recent_theme_counts.get(strongest.topic_key, 0)
        novelty_bonus = 1.75 if recent_token_appearances == 0 else 0.0
        repeat_over_cap = max(0, recent_token_appearances - config.max_recent_token_appearances)
        recent_penalty = (
            recent_token_appearances * config.recent_repeat_penalty_per_hit
            + recent_theme_appearances * config.recent_theme_penalty_per_hit
            + repeat_over_cap * 0.2
        )
        tier_bonus = {"high": 5.0, "medium": 2.0, "exploratory": 0.0}.get(publish_tier, 0.0)
        force_fill_score = _candidate_force_fill_score(candidate, config=config, now=now)
        effective_score = (
            correlation_score
            + tier_bonus
            + min(2.5, candidate.market_score * 0.04)
            + min(2.0, candidate.memecoin_fit_score * 0.08)
            + min(3.5, strongest.support_post_count * 1.0)
            + novelty_bonus
            + max(0.0, force_fill_score * 0.05)
            - soft_penalty_score * 0.7
            - recent_penalty
        )
        scored_candidates.append(
            {
                "candidate": candidate,
                "strongest_link": strongest,
                "all_links": trend_links[:3],
                "correlation_score": correlation_score,
                "correlation_label": _correlation_label(correlation_score),
                "political_dominant": political_dominant,
                "publish_tier": publish_tier,
                "selection_score": round(effective_score, 3),
                "soft_penalties": soft_penalties,
                "soft_penalty_score": soft_penalty_score,
                "force_fill_score": force_fill_score,
                "recent_token_appearances": recent_token_appearances,
                "recent_theme_appearances": recent_theme_appearances,
                "recent_penalty": round(recent_penalty, 3),
            }
        )

    funnel_counts["candidates_after_relevance_scoring"] = len(scored_candidates)
    funnel_counts["high_candidates"] = int(ranking_diagnostics["high_candidates"])
    funnel_counts["medium_candidates"] = int(ranking_diagnostics["medium_candidates"])
    funnel_counts["exploratory_candidates"] = int(ranking_diagnostics["exploratory_candidates"])

    tier_priority = {"high": 3, "medium": 2, "exploratory": 1}
    scored_candidates.sort(
        key=lambda item: (
            tier_priority.get(str(item["publish_tier"]), 0),
            float(item["selection_score"]),
            float(item.get("force_fill_score") or 0.0),
            item["candidate"].memecoin_fit_score,
            item["candidate"].market_score,
            item["candidate"].volume_h24,
            item["candidate"].liquidity_usd,
        ),
        reverse=True,
    )

    publishable_unique_token_count = len({_candidate_identity(item["candidate"]) for item in scored_candidates})
    selection_limit = (
        len(scored_candidates)
        if config.max_results <= 0
        else min(config.max_results, len(scored_candidates))
    )
    target_publish_count = (
        publishable_unique_token_count
        if config.target_published_results <= 0
        else min(config.target_published_results, publishable_unique_token_count, selection_limit)
    )
    ranking_diagnostics["publishable_unique_token_count"] = publishable_unique_token_count
    ranking_diagnostics["selection_limit"] = selection_limit
    ranking_diagnostics["target_publish_count"] = target_publish_count

    selected_results: list[dict[str, Any]] = []
    political_count = 0
    selected_token_keys: set[str] = set()
    selected_theme_counts: dict[str, int] = {}
    attempted_item_ids: set[int] = set()

    def try_select(item: dict[str, Any], *, enforce_theme_cap: bool) -> bool:
        nonlocal political_count
        if len(selected_results) >= selection_limit:
            return False
        candidate: MarketCandidate = item["candidate"]
        strongest: TrendLinkScore = item["strongest_link"]
        token_key = _candidate_identity(candidate)
        if token_key in selected_token_keys:
            ranking_diagnostics["rejected_duplicate_token_same_run"] = (
                int(ranking_diagnostics.get("rejected_duplicate_token_same_run") or 0) + 1
            )
            _increment_count(reject_counts, "duplicate_token_same_run")
            return False
        theme_key = strongest.topic_key
        theme_count = selected_theme_counts.get(theme_key, 0)
        if enforce_theme_cap and theme_count >= config.max_theme_results_per_run:
            _increment_count(penalty_counts, "duplicate_theme")
            return False
        if item["political_dominant"] and political_count >= config.max_political_results:
            ranking_diagnostics["rejected_political_cap"] = (
                int(ranking_diagnostics.get("rejected_political_cap") or 0) + 1
            )
            _increment_count(reject_counts, "political_cap")
            return False
        selected_results.append(item)
        selected_token_keys.add(token_key)
        selected_theme_counts[theme_key] = theme_count + 1
        if item["political_dominant"]:
            political_count += 1
        return True

    for tier_name in ("high", "medium", "exploratory"):
        for item in scored_candidates:
            if item["publish_tier"] != tier_name:
                continue
            item_id = id(item)
            if item_id in attempted_item_ids:
                continue
            attempted_item_ids.add(item_id)
            if len(selected_results) >= selection_limit:
                break
            if not try_select(item, enforce_theme_cap=False):
                continue
        if len(selected_results) >= selection_limit:
            break

    if len(selected_results) < target_publish_count:
        for item in scored_candidates:
            if len(selected_results) >= target_publish_count:
                break
            item_id = id(item)
            if item_id in attempted_item_ids:
                continue
            attempted_item_ids.add(item_id)
            if item in selected_results:
                continue
            try_select(item, enforce_theme_cap=False)

    if len(selected_results) < selection_limit:
        for item in scored_candidates:
            if len(selected_results) >= selection_limit:
                break
            item_id = id(item)
            if item_id in attempted_item_ids:
                continue
            attempted_item_ids.add(item_id)
            if item in selected_results:
                continue
            try_select(item, enforce_theme_cap=True)

    ranking_diagnostics["selected_count"] = len(selected_results)
    ranking_diagnostics["high_confidence_published"] = sum(
        1 for item in selected_results if item["publish_tier"] == "high"
    )
    ranking_diagnostics["medium_confidence_published"] = sum(
        1 for item in selected_results if item["publish_tier"] == "medium"
    )
    ranking_diagnostics["exploratory_published"] = sum(
        1 for item in selected_results if item["publish_tier"] == "exploratory"
    )
    ranking_diagnostics["final_published_count"] = len(selected_results)
    ranking_diagnostics["forced_fill_used"] = bool(
        ranking_diagnostics["medium_confidence_published"]
        or ranking_diagnostics["exploratory_published"]
    )
    ranking_diagnostics["candidate_pool_exhausted"] = len(selected_results) < target_publish_count
    funnel_counts["candidates_after_publish_dedupe"] = len(selected_results)
    funnel_counts["distinct_tokens_published"] = len(selected_token_keys)
    funnel_counts["final_published_count"] = len(selected_results)
    for rank, item in enumerate(selected_results, start=1):
        candidate = item["candidate"]
        strongest = item["strongest_link"]
        item["rank"] = rank
        for index, link in enumerate(item["all_links"]):
            link_rows.append(
                {
                    "chain_id": candidate.chain_id,
                    "token_address": candidate.token_address,
                    "pair_address": candidate.pair_address,
                    "topic_key": link.topic_key,
                    "topic_label": link.topic_label,
                    "trend_category": link.trend_category,
                    "narrative_summary": link.narrative_summary,
                    "lexical_score": link.lexical_score,
                    "mention_score": link.mention_score,
                    "timing_score": link.timing_score,
                    "culture_fit_score": link.culture_fit_score,
                    "link_score": link.link_score,
                    "support_post_count": link.support_post_count,
                    "support_interaction_score": link.support_interaction_score,
                    "is_primary": index == 0,
                    "why_linked": link.why_linked,
                    "match_reasons_json": link.match_reasons,
                    "raw_match_signals_json": link.raw_match_signals,
                }
            )
        item["strongest_link"] = strongest

    trend_memecoin_rows = _build_trend_memecoin_rows(
        trends=trends,
        trend_candidates=trend_candidate_rows,
        now=now,
    )
    linked_topic_keys = {
        str(row.get("topic_key") or "").strip()
        for row in trend_memecoin_rows
        if str(row.get("topic_key") or "").strip()
    }
    topic_link_counts: dict[str, int] = {}
    for row in trend_memecoin_rows:
        topic_key = str(row.get("topic_key") or "").strip()
        if not topic_key:
            continue
        topic_link_counts[topic_key] = topic_link_counts.get(topic_key, 0) + 1
    ranking_diagnostics["trend_topics_with_links"] = len(linked_topic_keys)
    ranking_diagnostics["trend_topics_without_links"] = max(0, len(trends) - len(linked_topic_keys))
    ranking_diagnostics["trend_topics_with_3_plus_links"] = sum(
        1 for count in topic_link_counts.values() if count >= TREND_MEMECOIN_LINK_TARGET_MIN
    )
    ranking_diagnostics["trend_topics_below_min_link_target"] = max(
        0,
        len(trends) - int(ranking_diagnostics["trend_topics_with_3_plus_links"]),
    )
    ranking_diagnostics["trend_memecoin_row_count"] = len(trend_memecoin_rows)
    ranking_diagnostics["avg_memecoins_per_trend"] = round(
        len(trend_memecoin_rows) / len(trends),
        3,
    ) if trends else 0.0
    ranking_diagnostics["trend_link_coverage_pct"] = round(
        (len(linked_topic_keys) / len(trends)) * 100.0,
        2,
    ) if trends else 0.0

    return CorrelationRankingResult(
        selected_results=selected_results,
        link_rows=link_rows,
        trend_memecoin_rows=trend_memecoin_rows,
        ranking_diagnostics=ranking_diagnostics,
        reject_counts=reject_counts,
        penalty_counts=penalty_counts,
        funnel_counts=funnel_counts,
    )


def _serialize_asset_row(candidate: MarketCandidate) -> dict[str, Any]:
    return {
        "chain_id": candidate.chain_id,
        "token_address": candidate.token_address,
        "pair_address": candidate.pair_address,
        "symbol": candidate.token_symbol,
        "name": candidate.token_name,
        "icon_url": candidate.icon_url,
        "header_url": candidate.header_url,
        "description": candidate.description,
        "dexscreener_url": candidate.dexscreener_url,
        "is_live": bool(candidate.is_live),
        "last_validated_at": _parse_iso_datetime(candidate.last_validated_at),
        "validation_status": candidate.validation_status or ("live" if candidate.is_live else "pending"),
        "validation_reason": candidate.validation_reason,
        "last_seen_liquidity_usd": candidate.last_seen_liquidity_usd,
        "last_seen_volume_h24": candidate.last_seen_volume_h24,
        "last_seen_txns_h24": candidate.last_seen_txns_h24,
        "websites_json": candidate.websites,
        "socials_json": candidate.socials,
        "holder_count": None,
        "tradingview_symbol": candidate.tradingview_symbol,
        "tradingview_exchange": candidate.tradingview_exchange,
        "tradingview_embed_symbol": candidate.tradingview_embed_symbol,
        "tv_resolution_status": candidate.tv_resolution_status
        or ("verified" if candidate.has_verified_tradingview_preview else "unavailable"),
        "tv_verified_at": _parse_iso_datetime(candidate.tv_verified_at),
        "tv_last_checked_at": _parse_iso_datetime(candidate.tv_last_checked_at),
        "tv_failure_reason": candidate.tv_failure_reason,
        "tv_search_evidence_json": dict(candidate.tv_search_evidence or {}),
        "has_verified_tradingview_preview": bool(candidate.has_verified_tradingview_preview),
        "metadata_json": {
            "seed_terms": sorted(candidate.seed_terms),
            "discovery_sources": sorted(candidate.discovery_sources),
            "matched_trend_keys": sorted(candidate.matched_trend_keys),
            "community_takeover": candidate.community_takeover,
            "tradingview_symbol": candidate.tradingview_symbol,
            "tradingview_exchange": candidate.tradingview_exchange,
            "tradingview_embed_symbol": candidate.tradingview_embed_symbol,
            "tv_resolution_status": candidate.tv_resolution_status,
            "tv_failure_reason": candidate.tv_failure_reason,
            "has_verified_tradingview_preview": bool(candidate.has_verified_tradingview_preview),
            "is_live": bool(candidate.is_live),
            "last_validated_at": candidate.last_validated_at,
            "validation_status": candidate.validation_status,
            "validation_reason": candidate.validation_reason,
            "last_seen_liquidity_usd": candidate.last_seen_liquidity_usd,
            "last_seen_volume_h24": candidate.last_seen_volume_h24,
            "last_seen_txns_h24": candidate.last_seen_txns_h24,
            "validation_source": candidate.validation_source,
        },
    }


def _serialize_market_snapshot_row(candidate: MarketCandidate) -> dict[str, Any]:
    return {
        "chain_id": candidate.chain_id,
        "token_address": candidate.token_address,
        "pair_address": candidate.pair_address,
        "pair_url": candidate.dexscreener_url,
        "quote_symbol": candidate.quote_symbol,
        "quote_token_address": candidate.quote_token_address,
        "quote_token_name": candidate.quote_token_name,
        "price_usd": candidate.price_usd,
        "liquidity_usd": candidate.liquidity_usd,
        "volume_h24_usd": candidate.volume_h24,
        "volume_h6_usd": candidate.volume_h6,
        "volume_h1_usd": candidate.volume_h1,
        "price_change_h24_pct": candidate.price_change_h24,
        "price_change_h6_pct": candidate.price_change_h6,
        "price_change_h1_pct": candidate.price_change_h1,
        "buys_h24": candidate.buys_h24,
        "sells_h24": candidate.sells_h24,
        "txns_h24": candidate.txns_h24,
        "txns_h6": candidate.txns_h6,
        "txns_h1": candidate.txns_h1,
        "fdv_usd": candidate.fdv,
        "market_cap_usd": candidate.market_cap,
        "pair_created_at": _parse_iso_datetime(candidate.pair_created_at),
        "market_score": candidate.market_score,
        "metadata_json": {
            "discovery_sources": sorted(candidate.discovery_sources),
            "seed_terms": sorted(candidate.seed_terms),
            "dex_id": candidate.dex_id,
            "pair_labels": candidate.pair_labels,
            "political_dominant": candidate.political_dominant,
            "community_takeover": candidate.community_takeover,
            "memecoin_fit_score": candidate.memecoin_fit_score,
            "is_live": bool(candidate.is_live),
            "last_validated_at": candidate.last_validated_at,
            "validation_status": candidate.validation_status,
            "validation_reason": candidate.validation_reason,
            "validation_source": candidate.validation_source,
            "tradingview_symbol": candidate.tradingview_embed_symbol or candidate.tradingview_symbol,
            "tv_resolution_status": candidate.tv_resolution_status,
            "tv_failure_reason": candidate.tv_failure_reason,
            "has_verified_tradingview_preview": bool(candidate.has_verified_tradingview_preview),
        },
    }


def _serialize_result_row(item: dict[str, Any]) -> dict[str, Any]:
    candidate: MarketCandidate = item["candidate"]
    strongest: TrendLinkScore = item["strongest_link"]
    return {
        "chain_id": candidate.chain_id,
        "token_address": candidate.token_address,
        "pair_address": candidate.pair_address,
        "rank": int(item["rank"]),
        "correlation_score": float(item["correlation_score"]),
        "correlation_label": str(item["correlation_label"]),
        "strongest_topic_key": strongest.topic_key,
        "strongest_topic_label": strongest.topic_label,
        "strongest_trend_category": strongest.trend_category,
        "strongest_narrative_summary": strongest.narrative_summary,
        "market_score": candidate.market_score,
        "lexical_score": strongest.lexical_score,
        "mention_score": strongest.mention_score,
        "timing_score": strongest.timing_score,
        "culture_fit_score": strongest.culture_fit_score,
        "support_post_count": strongest.support_post_count,
        "support_interaction_score": strongest.support_interaction_score,
        "is_political_dominant": bool(item["political_dominant"]),
        "dexscreener_url": candidate.dexscreener_url,
    }


def _build_memecoin_run_notes(
    *,
    selected_trends: list[ActiveTrendCandidate],
    search_seeds: list[dict[str, Any]],
    reject_counts: dict[str, int],
    penalty_counts: dict[str, int],
    funnel_counts: dict[str, int],
    ranking_diagnostics: dict[str, Any],
    preview_diagnostics: dict[str, Any],
    dexscreener_stats: dict[str, Any],
    candidate_trend_count: int,
    discovery_token_count: int,
    eligible_token_count: int,
    published_result_count: int,
    live_validation_thresholds: dict[str, Any],
    db_write_counts: dict[str, int],
    outcome_reason: str,
    error: str | None = None,
    failure_stage: str | None = None,
) -> dict[str, Any]:
    return {
        "board_mode": "potentially_correlated_exploratory",
        "outcome_reason": outcome_reason,
        "failure_stage": failure_stage,
        "error": error,
        "candidate_trend_count": candidate_trend_count,
        "active_trends": [
            {
                "topic_key": trend.topic_key,
                "label": trend.display_label,
                "trend_category": trend.trend_category,
                "enrichment_status": trend.enrichment_status,
                "summary_confidence": round(trend.summary_confidence, 3),
                "name_status": trend.name_status,
                "name_source": trend.name_source,
                "representative_post_count": trend.representative_post_count,
                "trusted_display_name": trend.trusted_display_name,
                "priority_score": round(trend.priority_score, 3),
                "quality_penalty": round(trend.quality_penalty, 3),
                "preferred_bucket": trend.preferred_bucket,
                "culture_score": round(trend.bias.culture_score, 3),
                "political_dominant": trend.bias.political_dominant,
            }
            for trend in selected_trends
        ],
        "search_seeds": search_seeds,
        "funnel_counts": funnel_counts,
        "reject_counts": reject_counts,
        "penalty_counts": penalty_counts,
        "ranking_diagnostics": ranking_diagnostics,
        "preview_diagnostics": preview_diagnostics,
        "dexscreener_stats": dexscreener_stats,
        "discovery_tokens": discovery_token_count,
        "eligible_tokens": eligible_token_count,
        "published_results": published_result_count,
        "live_validation_thresholds": live_validation_thresholds,
        "db_write_counts": db_write_counts,
        "trend_memecoin_topics_with_links": ranking_diagnostics.get("trend_topics_with_links"),
        "trend_memecoin_topics_without_links": ranking_diagnostics.get("trend_topics_without_links"),
        "trend_memecoin_row_count": ranking_diagnostics.get("trend_memecoin_row_count"),
        "trend_link_coverage_pct": ranking_diagnostics.get("trend_link_coverage_pct"),
        "avg_memecoins_per_trend": ranking_diagnostics.get("avg_memecoins_per_trend"),
    }


def _record_memecoin_run(
    *,
    store: Any,
    config: MemecoinCorrelationRuntimeConfig,
    started_at: datetime,
    completed_at: datetime,
    status: str,
    trigger_reason: str,
    outcome_reason: str,
    selected_trends: list[ActiveTrendCandidate],
    search_seeds: list[dict[str, Any]],
    reject_counts: dict[str, int],
    penalty_counts: dict[str, int],
    funnel_counts: dict[str, int],
    ranking_diagnostics: dict[str, Any],
    preview_diagnostics: dict[str, Any],
    dexscreener_stats: dict[str, Any],
    candidate_trend_count: int,
    discovery_token_count: int,
    eligible_token_count: int,
    published_result_count: int,
    asset_rows: list[dict[str, Any]],
    market_snapshot_rows: list[dict[str, Any]],
    result_rows: list[dict[str, Any]],
    link_rows: list[dict[str, Any]],
    selected_topic_keys: list[str],
    trend_memecoin_rows: list[dict[str, Any]],
    error: str | None = None,
    failure_stage: str | None = None,
) -> dict[str, Any]:
    return store.record_memecoin_correlation_run(
        run_row={
            "started_at": started_at,
            "completed_at": completed_at,
            "status": status,
            "reason": trigger_reason,
            "source": "dexscreener",
            "active_trend_count": len(selected_trends),
            "discovery_token_count": discovery_token_count,
            "eligible_token_count": eligible_token_count,
            "published_result_count": published_result_count,
            "request_count": _safe_int(dexscreener_stats.get("request_count")),
            "cache_hit_count": _safe_int(dexscreener_stats.get("cache_hit_count")),
            "stale_cache_hit_count": _safe_int(dexscreener_stats.get("stale_cache_hit_count")),
            "search_query_count": _safe_int(dexscreener_stats.get("search_query_count")),
            "token_batch_count": _safe_int(dexscreener_stats.get("token_batch_count")),
            "notes_json": _build_memecoin_run_notes(
                selected_trends=selected_trends,
                search_seeds=search_seeds,
                reject_counts=reject_counts,
                penalty_counts=penalty_counts,
                funnel_counts=funnel_counts,
                ranking_diagnostics=ranking_diagnostics,
                preview_diagnostics=preview_diagnostics,
                dexscreener_stats=dexscreener_stats,
                candidate_trend_count=candidate_trend_count,
                discovery_token_count=discovery_token_count,
                eligible_token_count=eligible_token_count,
                published_result_count=published_result_count,
                live_validation_thresholds={
                    "minimum_basic_liquidity_usd": config.minimum_basic_liquidity_usd,
                    "minimum_basic_volume_24h_usd": config.minimum_basic_volume_24h_usd,
                    "minimum_basic_txns_24h": config.minimum_basic_txns_24h,
                    "live_min_liquidity_usd": config.live_min_liquidity_usd,
                    "live_min_volume_24h_usd": config.live_min_volume_24h_usd,
                    "live_min_recent_txns": config.live_min_recent_txns,
                    "live_max_snapshot_staleness_hours": config.live_max_snapshot_staleness_hours,
                    "min_liquidity_usd": config.min_liquidity_usd,
                    "min_volume_24h_usd": config.min_volume_24h_usd,
                    "min_txns_24h": config.min_txns_24h,
                },
                db_write_counts={
                    "asset_rows": len(asset_rows),
                    "market_snapshot_rows": len(market_snapshot_rows),
                    "result_rows": len(result_rows),
                    "link_rows": len(link_rows),
                    "trend_memecoin_rows": len(trend_memecoin_rows),
                },
                outcome_reason=outcome_reason,
                error=error,
                failure_stage=failure_stage,
            ),
        },
        asset_rows=asset_rows,
        market_snapshot_rows=market_snapshot_rows,
        result_rows=result_rows,
        link_rows=link_rows,
        selected_topic_keys=selected_topic_keys,
        trend_memecoin_rows=trend_memecoin_rows,
    )


def run_memecoin_correlation_cycle(
    *,
    store: Any,
    logger: Any,
    config: MemecoinCorrelationRuntimeConfig,
    reason: str,
) -> dict[str, Any]:
    started_at = _utc_now()
    started_monotonic = time.monotonic()
    if not config.enabled:
        return {"skipped": True, "reason": "disabled"}

    schema_state = store.verify_memecoin_correlation_tables()
    if not schema_state.get("available"):
        return {
            "skipped": True,
            "reason": "missing_schema",
            "missing_tables": schema_state.get("missing_tables") or [],
            "missing_columns": schema_state.get("missing_columns") or {},
        }
    trend_fetch_limit = max(config.max_trends * 80, 1500)
    candidate_trend_rows: list[dict[str, Any]] = []
    selected_trends: list[ActiveTrendCandidate] = []
    search_seeds: list[dict[str, Any]] = []
    search_queries: list[dict[str, Any]] = []
    merged_hints: dict[tuple[str, str], DiscoveryHint] = {}
    market_candidates: list[MarketCandidate] = []
    recent_publications: list[dict[str, Any]] = []
    reject_counts: dict[str, int] = {}
    penalty_counts: dict[str, int] = {}
    funnel_counts: dict[str, int] = {}
    preview_diagnostics: dict[str, Any] = {}
    client: DexscreenerClient | None = None
    failure_stage = "initialize"

    try:
        failure_stage = "fetch_candidate_trends"
        candidate_trend_rows = store.fetch_memecoin_candidate_trends(limit=trend_fetch_limit)
        selected_trends = _select_active_trends(candidate_trend_rows, config=config, now=started_at)
        if not selected_trends:
            completed_at = _utc_now()
            duration_ms = round((time.monotonic() - started_monotonic) * 1000, 1)
            stored_run = _record_memecoin_run(
                store=store,
                config=config,
                started_at=started_at,
                completed_at=completed_at,
                status="skipped",
                trigger_reason=reason,
                outcome_reason="no_active_trends",
                selected_trends=[],
                search_seeds=[],
                reject_counts={},
                penalty_counts={},
                funnel_counts={},
                ranking_diagnostics={},
                preview_diagnostics={},
                dexscreener_stats={},
                candidate_trend_count=len(candidate_trend_rows),
                discovery_token_count=0,
                eligible_token_count=0,
                published_result_count=0,
                asset_rows=[],
                market_snapshot_rows=[],
                result_rows=[],
                link_rows=[],
                selected_topic_keys=[],
                trend_memecoin_rows=[],
            )
            return {
                "skipped": True,
                "status": "skipped",
                "reason": "no_active_trends",
                "started_at": started_at.isoformat(),
                "completed_at": completed_at.isoformat(),
                "duration_ms": duration_ms,
                "candidate_trend_count": len(candidate_trend_rows),
                "run_id": stored_run.get("run_id") if isinstance(stored_run, dict) else None,
            }

        topic_keys = [trend.topic_key for trend in selected_trends]
        failure_stage = "fetch_recent_posts"
        post_rows = store.fetch_memecoin_recent_posts_for_topics(
            topic_keys=topic_keys,
            lookback_hours=config.post_lookback_hours,
            per_topic_limit=config.max_posts_per_trend,
        )
        posts_by_topic: dict[str, list[RecentTrendPost]] = defaultdict(list)
        for row in post_rows:
            post = _recent_post_from_row(row)
            if post is None:
                continue
            posts_by_topic[post.topic_key].append(post)

        search_seeds = _build_search_seeds(
            selected_trends,
            posts_by_topic,
            max_seed_queries=config.max_seed_queries,
            max_seeds_per_trend=config.max_seeds_per_trend,
        )
        search_queries = _expand_search_queries(search_seeds, config=config)
        recent_publications = _load_recent_publications(store=store, config=config)
        funnel_counts = {
            "active_trends_selected": len(selected_trends),
            "seeds_generated": len(search_seeds),
            "search_queries_generated": len(search_queries),
        }
        client = DexscreenerClient(
            logger=logger,
            timeout_seconds=config.request_timeout_seconds,
            max_retries=config.max_retries,
            retry_backoff_seconds=config.retry_backoff_seconds,
            min_request_spacing_seconds=config.min_request_spacing_seconds,
            discovery_cache_ttl_seconds=config.discovery_cache_ttl_seconds,
            token_cache_ttl_seconds=config.token_cache_ttl_seconds,
            search_cache_ttl_seconds=config.search_cache_ttl_seconds,
            stale_cache_ttl_seconds=config.stale_cache_ttl_seconds,
        )

        log_event(
            logger,
            logging.INFO,
            "memecoin_correlation_started",
            reason=reason,
            candidate_trends=len(candidate_trend_rows),
            selected_trends=len(selected_trends),
            search_seeds=len(search_seeds),
            search_queries=len(search_queries),
            allowed_chains=list(config.allowed_chains),
            max_results=config.max_results,
            target_published_results=config.target_published_results,
            high_confidence_threshold=config.high_confidence_correlation_threshold,
            medium_confidence_threshold=config.medium_confidence_correlation_threshold,
            exploratory_threshold=config.exploratory_correlation_threshold,
            minimum_basic_liquidity_usd=config.minimum_basic_liquidity_usd,
            minimum_basic_volume_24h_usd=config.minimum_basic_volume_24h_usd,
            minimum_basic_txns_24h=config.minimum_basic_txns_24h,
            live_min_liquidity_usd=config.live_min_liquidity_usd,
            live_min_volume_24h_usd=config.live_min_volume_24h_usd,
            live_min_recent_txns=config.live_min_recent_txns,
            min_memecoin_fit_score=config.min_memecoin_fit_score,
            min_liquidity_usd=config.min_liquidity_usd,
            min_volume_24h_usd=config.min_volume_24h_usd,
            new_pair_penalty_hours=config.new_pair_penalty_hours,
            board_mode="potentially_correlated_exploratory",
        )

        failure_stage = "discover_dex_feeds"
        feed_hints = _discover_from_dex_feeds(client=client, config=config, logger=logger)
        failure_stage = "discover_seed_search"
        search_hints = _discover_from_search(
            client=client,
            config=config,
            search_queries=search_queries,
        )
        merged_hints = dict(feed_hints)
        for key, hint in search_hints.items():
            _upsert_discovery_hint(
                merged_hints,
                chain_id=hint.chain_id,
                token_address=hint.token_address,
                source_name="trend_seed_search",
                seed_terms=sorted(hint.seed_terms),
                matched_trend_keys=sorted(hint.matched_trend_keys),
                description=hint.description,
                links=hint.links,
                cto=hint.cto,
            )

        failure_stage = "hydrate_market_candidates"
        hydration_result = _hydrate_market_candidates(
            client=client,
            config=config,
            hints_by_key=merged_hints,
            now=started_at,
            logger=logger,
        )
        market_candidates = hydration_result.candidates
        all_market_candidates = list(market_candidates)
        reject_counts = _merge_count_maps(reject_counts, hydration_result.reject_counts)
        penalty_counts = _merge_count_maps(penalty_counts, hydration_result.penalty_counts)
        funnel_counts = _merge_count_maps(
            funnel_counts,
            {"discovery_candidates_found": len(merged_hints)},
            hydration_result.funnel_counts,
        )
        failure_stage = "verify_tradingview_previews"
        preview_result = _resolve_verified_tradingview_candidates(
            store=store,
            logger=logger,
            candidates=market_candidates,
        )
        reject_counts = _merge_count_maps(reject_counts, preview_result.reject_counts)
        funnel_counts = _merge_count_maps(funnel_counts, preview_result.funnel_counts)
        preview_diagnostics = preview_result.diagnostics
        market_candidates = preview_result.candidates
        failure_stage = "rank_correlated_candidates"
        ranking_result = _rank_correlated_candidates(
            candidates=market_candidates,
            trends=selected_trends,
            posts_by_topic=posts_by_topic,
            config=config,
            now=started_at,
            recent_publications=recent_publications,
        )
        reject_counts = _merge_count_maps(reject_counts, ranking_result.reject_counts)
        penalty_counts = _merge_count_maps(penalty_counts, ranking_result.penalty_counts)
        funnel_counts = _merge_count_maps(funnel_counts, ranking_result.funnel_counts)
        ranking_result.ranking_diagnostics["preview_diagnostics"] = preview_diagnostics

        asset_rows = [_serialize_asset_row(candidate) for candidate in all_market_candidates]
        market_rows = [_serialize_market_snapshot_row(candidate) for candidate in all_market_candidates]
        result_rows = [_serialize_result_row(item) for item in ranking_result.selected_results]
        completed_at = _utc_now()
        duration_ms = round((time.monotonic() - started_monotonic) * 1000, 1)
        run_status = "succeeded" if result_rows else "completed_no_results"
        client_stats = dict(client.stats)
        stored_run = _record_memecoin_run(
            store=store,
            config=config,
            started_at=started_at,
            completed_at=completed_at,
            status=run_status,
            trigger_reason=reason,
            outcome_reason=run_status,
            selected_trends=selected_trends,
            search_seeds=search_seeds,
            reject_counts=reject_counts,
            penalty_counts=penalty_counts,
            funnel_counts=funnel_counts,
            ranking_diagnostics=ranking_result.ranking_diagnostics,
            preview_diagnostics=preview_diagnostics,
            dexscreener_stats=client_stats,
            candidate_trend_count=len(candidate_trend_rows),
            discovery_token_count=len(merged_hints),
            eligible_token_count=len(market_candidates),
            published_result_count=len(result_rows),
            asset_rows=asset_rows,
            market_snapshot_rows=market_rows,
            result_rows=result_rows,
            link_rows=ranking_result.link_rows,
            selected_topic_keys=[trend.topic_key for trend in selected_trends],
            trend_memecoin_rows=ranking_result.trend_memecoin_rows,
        )

        log_event(
            logger,
            logging.INFO,
            "memecoin_correlation_completed",
            reason=reason,
            run_status=run_status,
            duration_ms=duration_ms,
            active_trends=len(selected_trends),
            discovery_tokens=len(merged_hints),
            eligible_tokens=len(market_candidates),
            published_results=len(result_rows),
            funnel_counts=funnel_counts,
            reject_counts=reject_counts,
            penalty_counts=penalty_counts,
            preview_diagnostics=preview_diagnostics,
            high_confidence_published=ranking_result.ranking_diagnostics.get("high_confidence_published"),
            medium_confidence_published=ranking_result.ranking_diagnostics.get("medium_confidence_published"),
            exploratory_published=ranking_result.ranking_diagnostics.get("exploratory_published"),
            forced_fill_used=ranking_result.ranking_diagnostics.get("forced_fill_used"),
            candidate_pool_exhausted=ranking_result.ranking_diagnostics.get("candidate_pool_exhausted"),
            trend_topics_with_links=ranking_result.ranking_diagnostics.get("trend_topics_with_links"),
            trend_topics_without_links=ranking_result.ranking_diagnostics.get("trend_topics_without_links"),
            trend_link_coverage_pct=ranking_result.ranking_diagnostics.get("trend_link_coverage_pct"),
            avg_memecoins_per_trend=ranking_result.ranking_diagnostics.get("avg_memecoins_per_trend"),
            request_count=client_stats.get("request_count"),
            cache_hit_count=client_stats.get("cache_hit_count"),
            stale_cache_hit_count=client_stats.get("stale_cache_hit_count"),
            run_id=stored_run.get("run_id") if isinstance(stored_run, dict) else None,
        )
        return {
            "skipped": False,
            "status": run_status,
            "reason": reason,
            "started_at": started_at.isoformat(),
            "completed_at": completed_at.isoformat(),
            "duration_ms": duration_ms,
            "candidate_trend_count": len(candidate_trend_rows),
            "active_trends": len(selected_trends),
            "search_seed_count": len(search_seeds),
            "search_query_count": len(search_queries),
            "discovery_token_count": len(merged_hints),
            "eligible_token_count": len(market_candidates),
            "published_result_count": len(result_rows),
            "trend_topics_with_links": ranking_result.ranking_diagnostics.get("trend_topics_with_links"),
            "trend_link_coverage_pct": ranking_result.ranking_diagnostics.get("trend_link_coverage_pct"),
            "avg_memecoins_per_trend": ranking_result.ranking_diagnostics.get("avg_memecoins_per_trend"),
            "reject_counts": reject_counts,
            "penalty_counts": penalty_counts,
            "funnel_counts": funnel_counts,
            "ranking_diagnostics": ranking_result.ranking_diagnostics,
            "preview_diagnostics": preview_diagnostics,
            "dexscreener_stats": client_stats,
            "run_id": stored_run.get("run_id") if isinstance(stored_run, dict) else None,
            "updated_at": completed_at.isoformat(),
        }
    except Exception as error:
        completed_at = _utc_now()
        duration_ms = round((time.monotonic() - started_monotonic) * 1000, 1)
        failure_run_id: int | None = None
        client_stats = dict(client.stats) if client is not None else {}
        try:
            stored_failure_run = _record_memecoin_run(
                store=store,
                config=config,
                started_at=started_at,
                completed_at=completed_at,
                status="failed",
                trigger_reason=reason,
                outcome_reason="failed",
                selected_trends=selected_trends,
                search_seeds=search_seeds,
                reject_counts=reject_counts,
                penalty_counts=penalty_counts,
                funnel_counts=funnel_counts,
                ranking_diagnostics={},
                preview_diagnostics=preview_diagnostics,
                dexscreener_stats=client_stats,
                candidate_trend_count=len(candidate_trend_rows),
                discovery_token_count=len(merged_hints),
                eligible_token_count=len(market_candidates),
                published_result_count=0,
                asset_rows=[],
                market_snapshot_rows=[],
                result_rows=[],
                link_rows=[],
                selected_topic_keys=[trend.topic_key for trend in selected_trends],
                trend_memecoin_rows=[],
                error=str(error),
                failure_stage=failure_stage,
            )
            if isinstance(stored_failure_run, dict):
                failure_run_id = _safe_int(stored_failure_run.get("run_id"), default=0) or None
        except Exception as persist_error:
            log_event(
                logger,
                logging.ERROR,
                "memecoin_correlation_failure_persist_failed",
                reason=reason,
                stage=failure_stage,
                error=str(persist_error),
                original_error=str(error),
            )
        log_event(
            logger,
            logging.ERROR,
            "memecoin_correlation_cycle_failed",
            reason=reason,
            stage=failure_stage,
            duration_ms=duration_ms,
            candidate_trends=len(candidate_trend_rows),
            selected_trends=len(selected_trends),
            search_seeds=len(search_seeds),
            search_queries=len(search_queries),
            discovery_tokens=len(merged_hints),
            eligible_tokens=len(market_candidates),
            error=str(error),
            run_id=failure_run_id,
        )
        raise
