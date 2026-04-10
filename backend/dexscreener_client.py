from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import quote


DEXSCREENER_API_BASE = "https://api.dexscreener.com"
DEFAULT_USER_AGENT = "sentiment-analysis-worker/1.0"


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


@dataclass
class DexscreenerCacheEntry:
    payload: Any
    fresh_until_monotonic: float
    stale_until_monotonic: float
    fetched_at_iso: str


class DexscreenerClient:
    def __init__(
        self,
        *,
        logger: logging.Logger | None,
        timeout_seconds: float,
        max_retries: int,
        retry_backoff_seconds: float,
        min_request_spacing_seconds: float,
        discovery_cache_ttl_seconds: int,
        token_cache_ttl_seconds: int,
        search_cache_ttl_seconds: int,
        stale_cache_ttl_seconds: int,
        user_agent: str = DEFAULT_USER_AGENT,
    ) -> None:
        self._logger = logger or logging.getLogger("backend.dexscreener")
        self._timeout_seconds = max(1.0, float(timeout_seconds))
        self._max_retries = max(0, int(max_retries))
        self._retry_backoff_seconds = max(0.0, float(retry_backoff_seconds))
        self._min_request_spacing_seconds = max(0.0, float(min_request_spacing_seconds))
        self._discovery_cache_ttl_seconds = max(0, int(discovery_cache_ttl_seconds))
        self._token_cache_ttl_seconds = max(0, int(token_cache_ttl_seconds))
        self._search_cache_ttl_seconds = max(0, int(search_cache_ttl_seconds))
        self._stale_cache_ttl_seconds = max(0, int(stale_cache_ttl_seconds))
        self._user_agent = str(user_agent or DEFAULT_USER_AGENT).strip() or DEFAULT_USER_AGENT
        self._cache: dict[str, DexscreenerCacheEntry] = {}
        self._last_request_started_monotonic = 0.0
        self.stats = {
            "request_count": 0,
            "cache_hit_count": 0,
            "stale_cache_hit_count": 0,
            "search_query_count": 0,
            "token_batch_count": 0,
            "discovery_request_count": 0,
        }

    def get_token_profiles_latest(self) -> list[dict[str, Any]]:
        payload = self._fetch_json(
            cache_key="discovery:token_profiles_latest",
            path="/token-profiles/latest/v1",
            fresh_ttl_seconds=self._discovery_cache_ttl_seconds,
        )
        self.stats["discovery_request_count"] += 1
        return self._coerce_list(payload)

    def get_token_boosts_latest(self) -> list[dict[str, Any]]:
        payload = self._fetch_json(
            cache_key="discovery:token_boosts_latest",
            path="/token-boosts/latest/v1",
            fresh_ttl_seconds=self._discovery_cache_ttl_seconds,
        )
        self.stats["discovery_request_count"] += 1
        return self._coerce_list(payload)

    def get_community_takeovers_latest(self) -> list[dict[str, Any]]:
        payload = self._fetch_json(
            cache_key="discovery:community_takeovers_latest",
            path="/community-takeovers/latest/v1",
            fresh_ttl_seconds=self._discovery_cache_ttl_seconds,
        )
        self.stats["discovery_request_count"] += 1
        return self._coerce_list(payload)

    def get_token_boosts_top(self) -> list[dict[str, Any]]:
        payload = self._fetch_json(
            cache_key="discovery:token_boosts_top",
            path="/token-boosts/top/v1",
            fresh_ttl_seconds=self._discovery_cache_ttl_seconds,
        )
        self.stats["discovery_request_count"] += 1
        return self._coerce_list(payload)

    def search_pairs(self, query: str) -> list[dict[str, Any]]:
        normalized_query = str(query or "").strip()
        if not normalized_query:
            return []
        payload = self._fetch_json(
            cache_key=f"search:{normalized_query.lower()}",
            path=f"/latest/dex/search?q={quote(normalized_query)}",
            fresh_ttl_seconds=self._search_cache_ttl_seconds,
        )
        self.stats["search_query_count"] += 1
        if isinstance(payload, dict):
            return self._coerce_list(payload.get("pairs"))
        return self._coerce_list(payload)

    def get_pairs_for_tokens(
        self,
        *,
        chain_id: str,
        token_addresses: list[str],
    ) -> list[dict[str, Any]]:
        normalized_chain = str(chain_id or "").strip().lower()
        normalized_addresses = [
            str(value or "").strip()
            for value in token_addresses
            if str(value or "").strip()
        ]
        if not normalized_chain or not normalized_addresses:
            return []

        cache_key = f"tokens:{normalized_chain}:{','.join(sorted(normalized_addresses))}"
        payload = self._fetch_json(
            cache_key=cache_key,
            path=f"/tokens/v1/{normalized_chain}/{','.join(normalized_addresses)}",
            fresh_ttl_seconds=self._token_cache_ttl_seconds,
        )
        self.stats["token_batch_count"] += 1
        return self._coerce_list(payload)

    def get_pairs_for_token(
        self,
        *,
        chain_id: str,
        token_address: str,
    ) -> list[dict[str, Any]]:
        normalized_chain = str(chain_id or "").strip().lower()
        normalized_address = str(token_address or "").strip()
        if not normalized_chain or not normalized_address:
            return []

        payload = self._fetch_json(
            cache_key=f"token-pairs:{normalized_chain}:{normalized_address.lower()}",
            path=f"/token-pairs/v1/{normalized_chain}/{normalized_address}",
            fresh_ttl_seconds=self._token_cache_ttl_seconds,
        )
        self.stats["token_batch_count"] += 1
        return self._coerce_list(payload)

    def get_pair_by_address(
        self,
        *,
        chain_id: str,
        pair_address: str,
    ) -> list[dict[str, Any]]:
        normalized_chain = str(chain_id or "").strip().lower()
        normalized_pair = str(pair_address or "").strip()
        if not normalized_chain or not normalized_pair:
            return []

        payload = self._fetch_json(
            cache_key=f"pair:{normalized_chain}:{normalized_pair.lower()}",
            path=f"/latest/dex/pairs/{normalized_chain}/{normalized_pair}",
            fresh_ttl_seconds=max(15, min(self._token_cache_ttl_seconds, 300)),
        )
        return self._coerce_list(payload)

    def _fetch_json(
        self,
        *,
        cache_key: str,
        path: str,
        fresh_ttl_seconds: int,
    ) -> Any:
        now_monotonic = time.monotonic()
        cached = self._cache.get(cache_key)
        if cached and cached.fresh_until_monotonic > now_monotonic:
            self.stats["cache_hit_count"] += 1
            return cached.payload

        url = f"{DEXSCREENER_API_BASE}{path}"
        errors: list[str] = []
        for attempt in range(self._max_retries + 1):
            self._respect_request_spacing()
            request = urllib_request.Request(
                url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": self._user_agent,
                },
                method="GET",
            )
            started_monotonic = time.monotonic()
            self._last_request_started_monotonic = started_monotonic
            try:
                self.stats["request_count"] += 1
                with urllib_request.urlopen(request, timeout=self._timeout_seconds) as response:
                    response_bytes = response.read()
                payload = json.loads(response_bytes.decode("utf-8"))
                self._cache[cache_key] = DexscreenerCacheEntry(
                    payload=payload,
                    fresh_until_monotonic=started_monotonic + max(0, fresh_ttl_seconds),
                    stale_until_monotonic=started_monotonic
                    + max(fresh_ttl_seconds, self._stale_cache_ttl_seconds),
                    fetched_at_iso=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                )
                return payload
            except urllib_error.HTTPError as error:
                body = ""
                try:
                    body = error.read().decode("utf-8", errors="replace")
                except Exception:
                    body = ""
                message = f"http_{error.code}:{body[:200]}"
                errors.append(message)
                retryable = error.code in {408, 425, 429, 500, 502, 503, 504}
                if attempt >= self._max_retries or not retryable:
                    break
                self._sleep_before_retry(attempt, error.code)
            except (urllib_error.URLError, TimeoutError, json.JSONDecodeError) as error:
                errors.append(str(error))
                if attempt >= self._max_retries:
                    break
                self._sleep_before_retry(attempt, None)

        if cached and cached.stale_until_monotonic > now_monotonic:
            self.stats["stale_cache_hit_count"] += 1
            self._logger.warning(
                "dexscreener_request_failed_using_stale_cache cache_key=%s errors=%s",
                cache_key,
                errors,
            )
            return cached.payload

        raise RuntimeError(
            f"Dexscreener request failed for {path}: {' | '.join(errors) if errors else 'unknown_error'}"
        )

    def _respect_request_spacing(self) -> None:
        if self._min_request_spacing_seconds <= 0:
            return
        elapsed = time.monotonic() - self._last_request_started_monotonic
        if elapsed >= self._min_request_spacing_seconds:
            return
        time.sleep(self._min_request_spacing_seconds - elapsed)

    def _sleep_before_retry(self, attempt: int, status_code: int | None) -> None:
        multiplier = 2 ** max(0, attempt)
        status_penalty = 2.0 if status_code == 429 else 1.0
        delay = self._retry_backoff_seconds * multiplier * status_penalty
        if delay > 0:
            time.sleep(delay)

    @staticmethod
    def _coerce_list(value: Any) -> list[dict[str, Any]]:
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            if isinstance(value.get("pairs"), list):
                return [item for item in value.get("pairs", []) if isinstance(item, dict)]
            if isinstance(value.get("value"), list):
                return [item for item in value.get("value", []) if isinstance(item, dict)]
        return []

    @staticmethod
    def parse_pair_created_at(value: Any) -> float | None:
        timestamp_ms = _safe_float(value, default=float("nan"))
        if not timestamp_ms or timestamp_ms != timestamp_ms:
            return None
        return max(0.0, timestamp_ms / 1000.0)

    @staticmethod
    def summarize_txns(pair: dict[str, Any], window: str) -> tuple[int, int, int]:
        txns = pair.get("txns")
        if not isinstance(txns, dict):
            return 0, 0, 0
        bucket = txns.get(window)
        if not isinstance(bucket, dict):
            return 0, 0, 0
        buys = max(0, _safe_int(bucket.get("buys")))
        sells = max(0, _safe_int(bucket.get("sells")))
        return buys, sells, buys + sells
