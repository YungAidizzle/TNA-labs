from __future__ import annotations

import json
import logging
import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import quote


TRADINGVIEW_SEARCH_URL = "https://symbol-search.tradingview.com/symbol_search/v3/"
TRADINGVIEW_SYMBOL_PAGE_URL = "https://www.tradingview.com/symbols/"
DEFAULT_USER_AGENT = "Mozilla/5.0"
SEARCH_TIMEOUT_SECONDS = 3.5
VALIDATION_TIMEOUT_SECONDS = 2.5
MAX_PAIR_DERIVED_CANDIDATES = 18
MAX_SEARCH_QUERIES = 10
MAX_SEARCH_RESULTS = 12
MAX_SEARCH_VALIDATIONS = 6
SEARCH_ACCEPTANCE_THRESHOLD = 60
VERIFIED_REUSE_TTL = timedelta(days=14)
UNAVAILABLE_REUSE_TTL = timedelta(hours=18)
TEMPORARY_FAILURE_REUSE_TTL = timedelta(hours=4)

KNOWN_MEME_TRADINGVIEW_SYMBOLS: dict[str, str] = {
    "DOGE": "BINANCE:DOGEUSDT",
    "SHIB": "BINANCE:SHIBUSDT",
    "PEPE": "BINANCE:PEPEUSDT",
}

QUOTE_SYMBOL_EQUIVALENTS: dict[str, list[str]] = {
    "SOL": ["SOL", "WSOL"],
    "WSOL": ["SOL", "WSOL"],
    "ETH": ["ETH", "WETH"],
    "WETH": ["ETH", "WETH"],
    "BNB": ["BNB", "WBNB"],
    "WBNB": ["BNB", "WBNB"],
    "BTC": ["BTC", "WBTC"],
    "WBTC": ["BTC", "WBTC"],
    "USDT": ["USDT", "USD"],
    "USDC": ["USDC", "USD"],
}

DEX_EXCHANGE_ALIASES: dict[str, list[str]] = {
    "AERODROME": ["AERODROME"],
    "BASESWAP": ["BASESWAP"],
    "METEORA": ["METEORA"],
    "ORCA": ["ORCA"],
    "PANCAKESWAP": ["PANCAKESWAP"],
    "PUMPFUN": ["PUMPFUN"],
    "PUMPSWAP": ["PUMPSWAP"],
    "RAYDIUM": ["RAYDIUM"],
    "UNISWAP": ["UNISWAP"],
}

CHAIN_EXCHANGE_ALIASES: dict[str, list[str]] = {
    "BASE": ["BASE"],
    "BSC": ["BSC"],
    "ETHEREUM": ["ETHEREUM"],
    "SOLANA": ["SOLANA"],
}

GENERIC_TRADINGVIEW_QUOTES = [
    "USDT",
    "USDC",
    "USD",
    "SOL",
    "WSOL",
    "WETH",
    "ETH",
    "WBNB",
    "BNB",
    "WBTC",
    "BTC",
    "EUR",
    "TRY",
]

NAME_STOPWORDS = {
    "A",
    "AN",
    "AND",
    "COIN",
    "JUST",
    "MEME",
    "MEMECOIN",
    "OFFICIAL",
    "ON",
    "THE",
    "TOKEN",
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_upper(value: str | None) -> str:
    return str(value or "").strip().upper()


def _normalize_lower(value: str | None) -> str:
    return str(value or "").strip().lower()


def _compact_identity(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _compact_search_text(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]+", "", _normalize_upper(value))


def _normalize_search_text(value: str | None) -> str:
    text = str(value or "").strip().upper()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9]+", " ", text)).strip()


def _unique_strings(values: list[str | None]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = _normalize_upper(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        output.append(normalized)
    return output


def _tokenize_name(value: str | None) -> list[str]:
    return [
        token
        for token in _normalize_search_text(value).split(" ")
        if token and token not in NAME_STOPWORDS
    ]


def _build_page_slug(symbol: str) -> str:
    return _normalize_upper(symbol).replace(":", "-")


def _parse_iso_datetime(value: str | None) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _preferred_quote_candidates(value: str | None) -> list[str]:
    normalized = _compact_search_text(value)
    if not normalized:
        return []
    return _unique_strings([normalized, *(QUOTE_SYMBOL_EQUIVALENTS.get(normalized) or [])])


def _search_quote_candidates(value: str | None) -> list[str]:
    return _unique_strings([*_preferred_quote_candidates(value), *GENERIC_TRADINGVIEW_QUOTES])[:6]


def _preferred_exchange_candidates(chain_id: str | None, dex_id: str | None) -> list[str]:
    return _unique_strings(
        [
            *(DEX_EXCHANGE_ALIASES.get(_compact_search_text(dex_id)) or []),
            *(CHAIN_EXCHANGE_ALIASES.get(_compact_search_text(chain_id)) or []),
        ]
    )


@dataclass(frozen=True)
class TradingViewResolverInput:
    chain_id: str
    token_address: str
    pair_address: str | None
    symbol: str
    name: str
    quote_symbol: str | None
    dex_id: str | None
    dexscreener_url: str | None
    pair_labels: list[str] = field(default_factory=list)
    stored_tradingview_symbol: str | None = None


@dataclass(frozen=True)
class PersistedTradingViewState:
    tradingview_symbol: str | None = None
    tradingview_exchange: str | None = None
    tradingview_embed_symbol: str | None = None
    tv_resolution_status: str | None = None
    tv_verified_at: str | None = None
    tv_last_checked_at: str | None = None
    tv_failure_reason: str | None = None
    tv_search_evidence: dict[str, Any] = field(default_factory=dict)
    has_verified_tradingview_preview: bool = False


@dataclass(frozen=True)
class TradingViewCandidateValidation:
    symbol: str
    valid: bool
    status: int | None
    rejection_reason: str | None
    temporary_failure: bool = False


@dataclass(frozen=True)
class TradingViewVerificationResult:
    has_verified_tradingview_preview: bool
    tradingview_symbol: str | None
    tradingview_exchange: str | None
    tradingview_embed_symbol: str | None
    tv_resolution_status: str
    tv_verified_at: str | None
    tv_last_checked_at: str
    tv_failure_reason: str | None
    tv_search_evidence: dict[str, Any]


@dataclass(frozen=True)
class TradingViewSearchQuery:
    term: str
    kind: str


@dataclass(frozen=True)
class TradingViewSearchCandidate:
    symbol: str
    exchange: str | None
    score: float
    query: TradingViewSearchQuery
    rejection_reason: str | None
    notes: list[str]


class TradingViewPreviewVerifier:
    def __init__(
        self,
        *,
        logger: logging.Logger | None = None,
        user_agent: str = DEFAULT_USER_AGENT,
    ) -> None:
        self._logger = logger or logging.getLogger("backend.tradingview_preview")
        self._user_agent = str(user_agent or DEFAULT_USER_AGENT).strip() or DEFAULT_USER_AGENT
        self._validation_cache: dict[str, TradingViewCandidateValidation] = {}
        self._search_cache: dict[str, dict[str, Any]] = {}
        self.stats: dict[str, int] = {
            "asset_count": 0,
            "cached_verified_reuse_count": 0,
            "cached_negative_reuse_count": 0,
            "search_request_count": 0,
            "search_cache_hit_count": 0,
            "validation_request_count": 0,
            "validation_cache_hit_count": 0,
            "verified_count": 0,
            "unavailable_count": 0,
            "temporary_failure_count": 0,
        }

    def resolve(
        self,
        input_row: TradingViewResolverInput,
        existing_state: PersistedTradingViewState | None = None,
        *,
        force_refresh: bool = False,
    ) -> TradingViewVerificationResult:
        self.stats["asset_count"] += 1
        existing = existing_state or PersistedTradingViewState()
        now = _utc_now()

        if not force_refresh:
            cached = self._reuse_cached_state(existing=existing, now=now)
            if cached is not None:
                if cached.has_verified_tradingview_preview:
                    self.stats["cached_verified_reuse_count"] += 1
                    self.stats["verified_count"] += 1
                else:
                    self.stats["cached_negative_reuse_count"] += 1
                    if cached.tv_resolution_status == "temporary_failure":
                        self.stats["temporary_failure_count"] += 1
                    else:
                        self.stats["unavailable_count"] += 1
                return cached

        resolved = self._resolve_uncached(input_row=input_row, existing=existing, now=now)
        if (
            not resolved.has_verified_tradingview_preview
            and resolved.tv_resolution_status == "temporary_failure"
            and existing.has_verified_tradingview_preview
            and _normalize_upper(existing.tradingview_embed_symbol or existing.tradingview_symbol)
        ):
            fallback_symbol = _normalize_upper(
                existing.tradingview_embed_symbol or existing.tradingview_symbol
            )
            fallback_exchange = _normalize_upper(existing.tradingview_exchange) or None
            stale_verified = TradingViewVerificationResult(
                has_verified_tradingview_preview=True,
                tradingview_symbol=_normalize_upper(existing.tradingview_symbol) or fallback_symbol,
                tradingview_exchange=fallback_exchange,
                tradingview_embed_symbol=fallback_symbol,
                tv_resolution_status="verified",
                tv_verified_at=existing.tv_verified_at or now.isoformat(),
                tv_last_checked_at=now.isoformat(),
                tv_failure_reason=None,
                tv_search_evidence={
                    **dict(existing.tv_search_evidence or {}),
                    **dict(resolved.tv_search_evidence or {}),
                    "stale_revalidation_kept_cached_verified": True,
                },
            )
            self.stats["verified_count"] += 1
            return stale_verified

        if resolved.has_verified_tradingview_preview:
            self.stats["verified_count"] += 1
        elif resolved.tv_resolution_status == "temporary_failure":
            self.stats["temporary_failure_count"] += 1
        else:
            self.stats["unavailable_count"] += 1
        return resolved

    def _reuse_cached_state(
        self,
        *,
        existing: PersistedTradingViewState,
        now: datetime,
    ) -> TradingViewVerificationResult | None:
        last_checked = _parse_iso_datetime(existing.tv_last_checked_at)
        if last_checked is None:
            return None

        embed_symbol = _normalize_upper(
            existing.tradingview_embed_symbol or existing.tradingview_symbol
        ) or None
        status = _normalize_lower(existing.tv_resolution_status)
        if existing.has_verified_tradingview_preview and embed_symbol:
            if now - last_checked <= VERIFIED_REUSE_TTL:
                return TradingViewVerificationResult(
                    has_verified_tradingview_preview=True,
                    tradingview_symbol=_normalize_upper(existing.tradingview_symbol) or embed_symbol,
                    tradingview_exchange=_normalize_upper(existing.tradingview_exchange) or None,
                    tradingview_embed_symbol=embed_symbol,
                    tv_resolution_status="verified",
                    tv_verified_at=existing.tv_verified_at,
                    tv_last_checked_at=existing.tv_last_checked_at or now.isoformat(),
                    tv_failure_reason=None,
                    tv_search_evidence=dict(existing.tv_search_evidence or {}),
                )
            return None

        reuse_ttl = (
            TEMPORARY_FAILURE_REUSE_TTL
            if status == "temporary_failure"
            else UNAVAILABLE_REUSE_TTL
        )
        if now - last_checked > reuse_ttl:
            return None
        return TradingViewVerificationResult(
            has_verified_tradingview_preview=False,
            tradingview_symbol=None,
            tradingview_exchange=None,
            tradingview_embed_symbol=None,
            tv_resolution_status=status or "unavailable",
            tv_verified_at=None,
            tv_last_checked_at=existing.tv_last_checked_at or now.isoformat(),
            tv_failure_reason=existing.tv_failure_reason,
            tv_search_evidence=dict(existing.tv_search_evidence or {}),
        )

    def _resolve_uncached(
        self,
        *,
        input_row: TradingViewResolverInput,
        existing: PersistedTradingViewState,
        now: datetime,
    ) -> TradingViewVerificationResult:
        validation: list[TradingViewCandidateValidation] = []
        queries: list[str] = []
        search_candidates: list[dict[str, Any]] = []
        notes: list[str] = []

        explicit_symbol = _normalize_upper(
            input_row.stored_tradingview_symbol
            or existing.tradingview_embed_symbol
            or existing.tradingview_symbol
        )
        if explicit_symbol:
            explicit_validation = self._validate_symbol(explicit_symbol)
            validation.append(explicit_validation)
            if explicit_validation.valid:
                return self._verified_result(
                    symbol=explicit_symbol,
                    source="stored_symbol",
                    now=now,
                    validation=validation,
                    queries=queries,
                    search_candidates=search_candidates,
                    notes=[
                        "Using the persisted TradingView symbol stored for this memecoin asset.",
                    ],
                )
            notes.append(f"Persisted symbol {explicit_symbol} was not reusable.")

        curated_symbol = KNOWN_MEME_TRADINGVIEW_SYMBOLS.get(_compact_search_text(input_row.symbol))
        if curated_symbol:
            curated_validation = self._validate_symbol(curated_symbol)
            validation.append(curated_validation)
            if curated_validation.valid:
                return self._verified_result(
                    symbol=curated_symbol,
                    source="curated_ticker",
                    now=now,
                    validation=validation,
                    queries=queries,
                    search_candidates=search_candidates,
                    notes=[
                        "Using the curated TradingView mapping for a canonical memecoin ticker.",
                    ],
                )

        pair_candidates = self._build_pair_derived_candidates(input_row)
        for candidate_symbol in pair_candidates:
            candidate_validation = self._validate_symbol(candidate_symbol)
            validation.append(candidate_validation)
            if candidate_validation.valid:
                return self._verified_result(
                    symbol=candidate_symbol,
                    source="pair_derived",
                    now=now,
                    validation=validation,
                    queries=queries,
                    search_candidates=search_candidates,
                    notes=[
                        f"Validated {candidate_symbol} from pair metadata and quote/exchange heuristics.",
                    ],
                )

        search_result = self._resolve_from_tradingview_search(
            input_row=input_row,
            excluded_symbols=[entry.symbol for entry in validation],
        )
        queries.extend(search_result["queries"])
        search_candidates.extend(search_result["search_candidates"])
        validation.extend(search_result["validation"])
        notes.extend(search_result["notes"])
        if search_result["symbol"]:
            return self._verified_result(
                symbol=str(search_result["symbol"]),
                source="tradingview_search",
                now=now,
                validation=validation,
                queries=queries,
                search_candidates=search_candidates,
                notes=notes,
            )

        temporary_failure = any(entry.temporary_failure for entry in validation) or bool(
            search_result["temporary_failure"]
        )
        resolution_status = "temporary_failure" if temporary_failure else "unavailable"
        failure_reason = (
            self._first_failure_reason(validation)
            or search_result["failure_reason"]
            or "tradingview_symbol_unavailable"
        )
        return TradingViewVerificationResult(
            has_verified_tradingview_preview=False,
            tradingview_symbol=None,
            tradingview_exchange=None,
            tradingview_embed_symbol=None,
            tv_resolution_status=resolution_status,
            tv_verified_at=None,
            tv_last_checked_at=now.isoformat(),
            tv_failure_reason=failure_reason,
            tv_search_evidence={
                "resolution_source": None,
                "queries": queries,
                "candidate_validation": [
                    {
                        "symbol": item.symbol,
                        "valid": item.valid,
                        "status": item.status,
                        "rejection_reason": item.rejection_reason,
                        "temporary_failure": item.temporary_failure,
                    }
                    for item in validation[:32]
                ],
                "search_candidates": search_candidates[:20],
                "notes": notes[:24],
            },
        )

    def _verified_result(
        self,
        *,
        symbol: str,
        source: str,
        now: datetime,
        validation: list[TradingViewCandidateValidation],
        queries: list[str],
        search_candidates: list[dict[str, Any]],
        notes: list[str],
    ) -> TradingViewVerificationResult:
        embed_symbol = _normalize_upper(symbol)
        exchange, base_symbol = self._split_exchange_symbol(embed_symbol)
        return TradingViewVerificationResult(
            has_verified_tradingview_preview=True,
            tradingview_symbol=base_symbol,
            tradingview_exchange=exchange,
            tradingview_embed_symbol=embed_symbol,
            tv_resolution_status="verified",
            tv_verified_at=now.isoformat(),
            tv_last_checked_at=now.isoformat(),
            tv_failure_reason=None,
            tv_search_evidence={
                "resolution_source": source,
                "queries": queries,
                "candidate_validation": [
                    {
                        "symbol": item.symbol,
                        "valid": item.valid,
                        "status": item.status,
                        "rejection_reason": item.rejection_reason,
                        "temporary_failure": item.temporary_failure,
                    }
                    for item in validation[:32]
                ],
                "search_candidates": search_candidates[:20],
                "notes": notes[:24],
            },
        )

    @staticmethod
    def _split_exchange_symbol(symbol: str) -> tuple[str | None, str]:
        normalized = _normalize_upper(symbol)
        if ":" not in normalized:
            return None, normalized
        exchange, base_symbol = normalized.split(":", 1)
        return exchange or None, base_symbol

    @staticmethod
    def _first_failure_reason(validation: list[TradingViewCandidateValidation]) -> str | None:
        for entry in validation:
            if entry.valid or not entry.rejection_reason:
                continue
            return entry.rejection_reason
        return None

    def _build_pair_derived_candidates(self, input_row: TradingViewResolverInput) -> list[str]:
        base_symbol = _compact_search_text(input_row.symbol)[:32]
        pair_address = _compact_search_text(input_row.pair_address).removeprefix("0X")
        if not base_symbol or not pair_address:
            return []

        quote_symbols = _search_quote_candidates(input_row.quote_symbol)
        exchange_symbols = _preferred_exchange_candidates(
            input_row.chain_id,
            input_row.dex_id,
        )
        pair_codes = _unique_strings(
            [*(f"{base_symbol}{quote}" for quote in quote_symbols), base_symbol]
        )
        pair_suffixes = [
            suffix
            for suffix in _unique_strings([pair_address[:6], pair_address[:8]])
            if len(suffix) >= 6
        ]
        return _unique_strings(
            [
                *(
                    f"{pair_code}_{pair_suffix}.USD"
                    for pair_suffix in pair_suffixes
                    for pair_code in pair_codes
                ),
                *(
                    f"{pair_code}_{pair_suffix}"
                    for pair_suffix in pair_suffixes
                    for pair_code in pair_codes
                ),
                *(
                    f"{exchange}:{pair_code}"
                    for exchange in exchange_symbols
                    for pair_code in pair_codes
                ),
                *(
                    f"{exchange}:{pair_code}.USD"
                    for exchange in exchange_symbols
                    for pair_code in pair_codes
                ),
                *(f"{pair_code}.USD" for pair_code in pair_codes),
            ]
        )[:MAX_PAIR_DERIVED_CANDIDATES]

    def _build_search_queries(self, input_row: TradingViewResolverInput) -> list[TradingViewSearchQuery]:
        symbol = _compact_search_text(input_row.symbol)
        raw_name = _normalize_search_text(input_row.name)
        compact_name = _compact_search_text(raw_name)
        cleaned_tokens = _tokenize_name(raw_name)
        cleaned_name = " ".join(cleaned_tokens)
        cleaned_compact_name = "".join(cleaned_tokens)
        quote_candidates = _search_quote_candidates(input_row.quote_symbol)

        queries = _unique_strings(
            [
                *(f"{symbol}{quote}" for quote in quote_candidates if symbol),
                *(f"{compact_name}{quote}" for quote in quote_candidates if compact_name),
                *(f"{cleaned_compact_name}{quote}" for quote in quote_candidates if cleaned_compact_name),
                compact_name,
                cleaned_compact_name,
                cleaned_name,
                raw_name,
                symbol,
            ]
        )[:MAX_SEARCH_QUERIES]

        output: list[TradingViewSearchQuery] = []
        for term in queries:
            if symbol and any(term == f"{symbol}{quote}" for quote in quote_candidates):
                output.append(TradingViewSearchQuery(term=term, kind="symbol_quote"))
            elif compact_name and any(term == f"{compact_name}{quote}" for quote in quote_candidates):
                output.append(TradingViewSearchQuery(term=term, kind="name_compact_quote"))
            elif cleaned_compact_name and any(
                term == f"{cleaned_compact_name}{quote}" for quote in quote_candidates
            ):
                output.append(TradingViewSearchQuery(term=term, kind="name_compact_quote"))
            elif term in {compact_name, cleaned_compact_name}:
                output.append(TradingViewSearchQuery(term=term, kind="name_compact"))
            elif term in {raw_name, cleaned_name}:
                output.append(TradingViewSearchQuery(term=term, kind="name"))
            else:
                output.append(TradingViewSearchQuery(term=term, kind="symbol"))
        return output

    def _resolve_from_tradingview_search(
        self,
        *,
        input_row: TradingViewResolverInput,
        excluded_symbols: list[str],
    ) -> dict[str, Any]:
        queries = self._build_search_queries(input_row)
        if not queries:
            return {
                "symbol": None,
                "queries": [],
                "search_candidates": [],
                "validation": [],
                "notes": [
                    "TradingView search was skipped because no usable symbol or token-name query could be built."
                ],
                "failure_reason": "search_queries_unavailable",
                "temporary_failure": False,
            }

        scored_by_symbol: dict[str, TradingViewSearchCandidate] = {}
        search_candidate_rows: list[dict[str, Any]] = []
        validation: list[TradingViewCandidateValidation] = []
        notes = [f"TradingView search queries: {', '.join(query.term for query in queries)}"]
        temporary_failure = False

        for query in queries:
            result = self._fetch_search_results(query)
            if result["error"]:
                notes.append(f'TradingView search for "{query.term}" returned {result["error"]}.')
            if result["temporary_failure"]:
                temporary_failure = True
            for record in result["records"]:
                scored = self._score_search_candidate(input_row=input_row, query=query, record=record)
                if scored is None:
                    continue
                existing = scored_by_symbol.get(scored.symbol)
                if existing is None or existing.score < scored.score:
                    scored_by_symbol[scored.symbol] = scored

        exclusion_set = {_normalize_upper(entry) for entry in excluded_symbols}
        ranked = sorted(
            scored_by_symbol.values(),
            key=lambda item: item.score,
            reverse=True,
        )[:MAX_SEARCH_RESULTS]

        for candidate in ranked:
            search_candidate_rows.append(
                {
                    "symbol": candidate.symbol,
                    "exchange": candidate.exchange,
                    "score": round(candidate.score, 3) if math.isfinite(candidate.score) else None,
                    "query": candidate.query.term,
                    "query_kind": candidate.query.kind,
                    "rejection_reason": candidate.rejection_reason,
                    "notes": candidate.notes[:8],
                }
            )
            if candidate.symbol in exclusion_set:
                validation.append(
                    TradingViewCandidateValidation(
                        symbol=candidate.symbol,
                        valid=False,
                        status=None,
                        rejection_reason="duplicate_search_candidate",
                    )
                )
                continue
            if candidate.rejection_reason:
                validation.append(
                    TradingViewCandidateValidation(
                        symbol=candidate.symbol,
                        valid=False,
                        status=None,
                        rejection_reason=candidate.rejection_reason,
                    )
                )

        candidates_to_validate = [
            candidate
            for candidate in ranked
            if candidate.symbol not in exclusion_set and not candidate.rejection_reason
        ][:MAX_SEARCH_VALIDATIONS]

        for candidate in candidates_to_validate:
            candidate_validation = self._validate_symbol(candidate.symbol)
            validation.append(candidate_validation)
            if candidate_validation.valid:
                notes.append(
                    f'TradingView search matched {candidate.symbol} via "{candidate.query.term}" '
                    f"({', '.join(candidate.notes[:4])})."
                )
                return {
                    "symbol": candidate.symbol,
                    "queries": [query.term for query in queries],
                    "search_candidates": search_candidate_rows,
                    "validation": validation,
                    "notes": notes,
                    "failure_reason": None,
                    "temporary_failure": temporary_failure,
                }

        failure_reason = (
            self._first_failure_reason(validation)
            or ("search_request_failed" if temporary_failure else "tradingview_symbol_unavailable")
        )
        return {
            "symbol": None,
            "queries": [query.term for query in queries],
            "search_candidates": search_candidate_rows,
            "validation": validation,
            "notes": notes,
            "failure_reason": failure_reason,
            "temporary_failure": temporary_failure,
        }

    def _score_search_candidate(
        self,
        *,
        input_row: TradingViewResolverInput,
        query: TradingViewSearchQuery,
        record: dict[str, Any],
    ) -> TradingViewSearchCandidate | None:
        widget_symbol = self._build_widget_symbol(record)
        if not widget_symbol:
            return None

        raw_symbol = _compact_search_text(str(record.get("symbol") or ""))
        description = _normalize_search_text(str(record.get("description") or ""))
        description_compact = _compact_search_text(description)
        source_id = _normalize_upper(
            str(record.get("source_id") or record.get("prefix") or record.get("exchange") or "")
        )
        result_type = _normalize_upper(str(record.get("type") or ""))
        type_specs = [
            _normalize_upper(str(value or ""))
            for value in (record.get("typespecs") or [])
            if str(value or "").strip()
        ]
        preferred_quotes = _search_quote_candidates(input_row.quote_symbol)
        split_pair = self._split_base_quote(raw_symbol, preferred_quotes)
        input_symbol = _compact_search_text(input_row.symbol)
        name_variants = _unique_strings(
            [
                _compact_search_text(input_row.name),
                "".join(_tokenize_name(input_row.name)),
            ]
        )
        long_name_variants = [
            entry for entry in name_variants if len(entry) >= max(len(input_symbol) + 2, 6)
        ]
        description_tokens = set(_tokenize_name(description))
        notes: list[str] = []

        if not raw_symbol:
            return TradingViewSearchCandidate(
                symbol=widget_symbol,
                exchange=_normalize_upper(record.get("prefix")) or None,
                score=float("-inf"),
                query=query,
                rejection_reason="search_missing_symbol",
                notes=notes,
            )

        if result_type == "FUNDAMENTAL" or raw_symbol.endswith("_SUPPLY") or raw_symbol.endswith("_MARKETCAP"):
            return TradingViewSearchCandidate(
                symbol=widget_symbol,
                exchange=_normalize_upper(record.get("prefix")) or None,
                score=float("-inf"),
                query=query,
                rejection_reason="search_non_chart_result",
                notes=notes,
            )

        if result_type == "INDEX" and source_id == "CRYPTOCAP":
            return TradingViewSearchCandidate(
                symbol=widget_symbol,
                exchange=_normalize_upper(record.get("prefix")) or None,
                score=float("-inf"),
                query=query,
                rejection_reason="search_market_cap_index",
                notes=notes,
            )

        if result_type not in {"SPOT", "SWAP", "INDEX"} and "CRYPTO" not in type_specs:
            return TradingViewSearchCandidate(
                symbol=widget_symbol,
                exchange=_normalize_upper(record.get("prefix")) or None,
                score=float("-inf"),
                query=query,
                rejection_reason="search_non_crypto_result",
                notes=notes,
            )

        score = 0.0
        if query.kind == "symbol_quote":
            score += 38.0
            notes.append("symbol_quote_query")
        elif query.kind == "name_compact_quote":
            score += 44.0
            notes.append("name_quote_query")
        elif query.kind == "name_compact":
            score += 34.0
            notes.append("compact_name_query")
        elif query.kind == "name":
            score += 28.0
            notes.append("name_query")
        else:
            score += 18.0
            notes.append("symbol_query")

        if split_pair["base"] and split_pair["base"] == input_symbol:
            score += 44.0
            notes.append("base_symbol_match")

        if split_pair["quote"] in preferred_quotes:
            score += 26.0
            notes.append("preferred_quote_match")
        elif split_pair["quote"] in {"USD", "USDC", "USDT"}:
            score += 14.0
            notes.append("stable_quote_match")

        if result_type == "SPOT":
            score += 24.0
        elif result_type == "SWAP":
            score += 8.0
        elif result_type == "INDEX":
            score -= 8.0

        if "PERPETUAL" in type_specs or raw_symbol.endswith(".P"):
            score -= 18.0
            notes.append("perpetual_penalty")

        if source_id == "CRYPTO":
            score += 14.0
            notes.append("aggregate_crypto_source")

        overlapping_name_tokens = [
            token
            for token in _tokenize_name(input_row.name)
            if token in description_tokens or token in raw_symbol
        ]
        strong_name_prefix_match = any(
            raw_symbol.startswith(variant) for variant in name_variants if len(variant) >= 4
        )
        has_structural_identity_match = bool(
            (split_pair["base"] and split_pair["base"] == input_symbol and input_symbol)
            or overlapping_name_tokens
            or strong_name_prefix_match
        )
        if not has_structural_identity_match and long_name_variants:
            has_structural_identity_match = any(
                raw_symbol.startswith(variant) or variant in description_compact
                for variant in long_name_variants
            )
        if not has_structural_identity_match:
            return TradingViewSearchCandidate(
                symbol=widget_symbol,
                exchange=_normalize_upper(record.get("prefix")) or None,
                score=float("-inf"),
                query=query,
                rejection_reason="search_no_identity_match",
                notes=notes,
            )
        if overlapping_name_tokens:
            score += min(36.0, len(overlapping_name_tokens) * 12.0)
            notes.append("name_token_overlap")

        has_strong_name_match = (
            not long_name_variants
            or any(
                raw_symbol.startswith(variant) or variant in description_compact
                for variant in long_name_variants
            )
        )
        if has_strong_name_match and long_name_variants:
            score += 48.0
            notes.append("full_name_match")
        elif long_name_variants:
            score -= 40.0
            notes.append("full_name_mismatch")

        if len(input_symbol) <= 2 and query.kind == "symbol":
            score -= 18.0
            notes.append("short_symbol_penalty")

        if not input_symbol and not long_name_variants:
            score -= 24.0

        rejection_reason = None if score >= SEARCH_ACCEPTANCE_THRESHOLD else "search_score_too_low"
        return TradingViewSearchCandidate(
            symbol=widget_symbol,
            exchange=_normalize_upper(record.get("prefix")) or None,
            score=score,
            query=query,
            rejection_reason=rejection_reason,
            notes=notes,
        )

    @staticmethod
    def _build_widget_symbol(record: dict[str, Any]) -> str | None:
        symbol = _normalize_search_text(str(record.get("symbol") or ""))
        prefix = _normalize_search_text(
            str(record.get("prefix") or record.get("exchange") or record.get("source_id") or "")
        )
        if not symbol:
            return None
        return f"{prefix}:{symbol}" if prefix else symbol

    @staticmethod
    def _split_base_quote(value: str, preferred_quotes: list[str]) -> dict[str, str | None]:
        normalized = _compact_search_text(value)
        quotes = sorted(
            _unique_strings([*preferred_quotes, *GENERIC_TRADINGVIEW_QUOTES]),
            key=len,
            reverse=True,
        )
        for quote_symbol in quotes:
            if len(normalized) > len(quote_symbol) and normalized.endswith(quote_symbol):
                return {
                    "base": normalized[: len(normalized) - len(quote_symbol)],
                    "quote": quote_symbol,
                }
        return {
            "base": normalized,
            "quote": None,
        }

    def _validate_symbol(self, symbol: str) -> TradingViewCandidateValidation:
        normalized_symbol = _normalize_upper(symbol)
        cached = self._validation_cache.get(normalized_symbol)
        if cached is not None:
            self.stats["validation_cache_hit_count"] += 1
            return cached

        url = f"{TRADINGVIEW_SYMBOL_PAGE_URL}{quote(_build_page_slug(normalized_symbol))}/"
        request = urllib_request.Request(
            url,
            headers={
                "Accept": "text/html,application/xhtml+xml",
                "User-Agent": self._user_agent,
            },
            method="GET",
        )
        try:
            self.stats["validation_request_count"] += 1
            with urllib_request.urlopen(request, timeout=VALIDATION_TIMEOUT_SECONDS) as response:
                status = int(getattr(response, "status", 200) or 200)
                html = response.read().decode("utf-8", errors="replace")
            invalid = (
                "This symbol doesn&#39;t exist" in html
                or "This symbol doesn't exist" in html
                or "This symbol does not exist" in html
            )
            result = TradingViewCandidateValidation(
                symbol=normalized_symbol,
                valid=not invalid,
                status=status,
                rejection_reason="symbol_not_found_page" if invalid else None,
            )
        except urllib_error.HTTPError as error:
            try:
                error.read()
            except Exception:
                pass
            temporary = error.code in {403, 408, 425, 429, 500, 502, 503, 504}
            result = TradingViewCandidateValidation(
                symbol=normalized_symbol,
                valid=False,
                status=int(error.code),
                rejection_reason=f"http_{error.code}",
                temporary_failure=temporary,
            )
        except (urllib_error.URLError, TimeoutError):
            result = TradingViewCandidateValidation(
                symbol=normalized_symbol,
                valid=False,
                status=None,
                rejection_reason="request_failed",
                temporary_failure=True,
            )

        self._validation_cache[normalized_symbol] = result
        return result

    def _fetch_search_results(self, query: TradingViewSearchQuery) -> dict[str, Any]:
        cache_key = query.term
        cached = self._search_cache.get(cache_key)
        if cached is not None:
            self.stats["search_cache_hit_count"] += 1
            return cached

        url = f"{TRADINGVIEW_SEARCH_URL}?text={quote(query.term)}&lang=en&search_type=crypto"
        request = urllib_request.Request(
            url,
            headers={
                "Accept": "application/json",
                "Origin": "https://www.tradingview.com",
                "Referer": "https://www.tradingview.com/",
                "User-Agent": self._user_agent,
            },
            method="GET",
        )
        try:
            self.stats["search_request_count"] += 1
            with urllib_request.urlopen(request, timeout=SEARCH_TIMEOUT_SECONDS) as response:
                response_bytes = response.read()
            payload = json.loads(response_bytes.decode("utf-8"))
            records = payload.get("symbols") if isinstance(payload, dict) else []
            result = {
                "records": [item for item in records if isinstance(item, dict)],
                "error": None,
                "temporary_failure": False,
            }
        except urllib_error.HTTPError as error:
            result = {
                "records": [],
                "error": f"search_http_{error.code}",
                "temporary_failure": error.code in {403, 408, 425, 429, 500, 502, 503, 504},
            }
        except (urllib_error.URLError, TimeoutError, json.JSONDecodeError):
            result = {
                "records": [],
                "error": "search_request_failed",
                "temporary_failure": True,
            }
        self._search_cache[cache_key] = result
        return result
