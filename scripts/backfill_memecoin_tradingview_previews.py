from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

import psycopg

from backend.db import PostgresStore
from backend.tradingview_preview import (
    PersistedTradingViewState,
    TradingViewPreviewVerifier,
    TradingViewResolverInput,
)


def _build_logger(verbose: bool) -> logging.Logger:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    return logging.getLogger("scripts.backfill_memecoin_tradingview_previews")


def _require_database_url() -> str:
    for env_path in (Path(".env.local"), Path(".env")):
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    database_url = str(os.getenv("DATABASE_URL") or "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")
    return database_url


def _build_store(database_url: str, logger: logging.Logger) -> PostgresStore:
    store = PostgresStore(
        database_url=database_url,
        batch_size=200,
        logger=logger,
    )
    store.connect()
    return store


def _coverage_summary(database_url: str) -> dict[str, Any]:
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                WITH recent_runs AS (
                    SELECT run_id
                    FROM public.memecoin_correlation_runs
                    WHERE status = 'succeeded'
                      AND published_result_count > 0
                    ORDER BY completed_at DESC, run_id DESC
                    LIMIT 12
                ),
                candidate_rows AS (
                    SELECT
                        a.asset_id,
                        a.tv_failure_reason,
                        a.tv_resolution_status,
                        a.has_verified_tradingview_preview,
                        COALESCE(a.tradingview_embed_symbol, a.tradingview_symbol) AS tradingview_symbol
                    FROM public.memecoin_correlation_results r
                    INNER JOIN recent_runs rr
                      ON rr.run_id = r.run_id
                    INNER JOIN public.memecoin_assets a
                      ON a.asset_id = r.asset_id
                )
                SELECT
                    asset_id,
                    tv_failure_reason,
                    tv_resolution_status,
                    has_verified_tradingview_preview,
                    tradingview_symbol
                FROM candidate_rows
                """,
            )
            rows = cursor.fetchall()

    rows_considered = len(rows)
    rows_verified = 0
    unresolved_reason_counts: dict[str, int] = {}
    for row in rows:
        has_verified = bool(row[3]) and bool(str(row[4] or "").strip())
        if has_verified:
            rows_verified += 1
            continue
        reason = (
            str(row[1] or "").strip()
            or str(row[2] or "").strip()
            or "tradingview_symbol_unavailable"
        )
        unresolved_reason_counts[reason] = unresolved_reason_counts.get(reason, 0) + 1
    return {
        "rowsConsidered": rows_considered,
        "rowsVerified": rows_verified,
        "rowsExcluded": max(0, rows_considered - rows_verified),
        "coverageRatePct": round((rows_verified / rows_considered) * 100.0, 2)
        if rows_considered > 0
        else 0.0,
        "unresolvedReasonCounts": unresolved_reason_counts,
    }


def _resolver_input(row: dict[str, Any]) -> tuple[TradingViewResolverInput, PersistedTradingViewState]:
    state = PersistedTradingViewState(
        tradingview_symbol=row.get("tradingview_symbol"),
        tradingview_exchange=row.get("tradingview_exchange"),
        tradingview_embed_symbol=row.get("tradingview_embed_symbol"),
        tv_resolution_status=row.get("tv_resolution_status"),
        tv_verified_at=row.get("tv_verified_at"),
        tv_last_checked_at=row.get("tv_last_checked_at"),
        tv_failure_reason=row.get("tv_failure_reason"),
        tv_search_evidence=(
            dict(row.get("tv_search_evidence_json") or {})
            if isinstance(row.get("tv_search_evidence_json"), dict)
            else {}
        ),
        has_verified_tradingview_preview=bool(row.get("has_verified_tradingview_preview")),
    )
    return (
        TradingViewResolverInput(
            chain_id=str(row.get("chain_id") or "").strip().lower(),
            token_address=str(row.get("token_address") or "").strip(),
            pair_address=str(row.get("pair_address") or "").strip() or None,
            symbol=str(row.get("symbol") or "").strip(),
            name=str(row.get("name") or "").strip(),
            quote_symbol=str(row.get("quote_symbol") or "").strip() or None,
            dex_id=str(row.get("dex_id") or "").strip() or None,
            dexscreener_url=str(row.get("dexscreener_url") or "").strip() or None,
            pair_labels=list(row.get("pair_labels") or []),
            stored_tradingview_symbol=(
                str(row.get("tradingview_embed_symbol") or row.get("tradingview_symbol") or "").strip()
                or None
            ),
        ),
        state,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Backfill persistent TradingView preview verification for memecoin assets.",
    )
    parser.add_argument("--limit", type=int, default=500, help="Maximum assets to process in one run.")
    parser.add_argument(
        "--include-verified",
        action="store_true",
        help="Also refresh already-verified assets instead of only unresolved ones.",
    )
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        help="Ignore TTL reuse and re-run TradingView discovery for each processed asset.",
    )
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    logger = _build_logger(args.verbose)
    database_url = _require_database_url()
    before = _coverage_summary(database_url)
    store = _build_store(database_url, logger)
    verifier = TradingViewPreviewVerifier(logger=logger)

    try:
        candidates = store.fetch_memecoin_preview_backfill_candidates(
            limit=max(1, int(args.limit)),
            unresolved_only=not bool(args.include_verified),
        )
        if not candidates:
            print(
                json.dumps(
                    {
                        "processed": 0,
                        "before": before,
                        "after": before,
                        "message": "No memecoin assets matched the requested backfill scope.",
                    },
                    indent=2,
                    ensure_ascii=True,
                )
            )
            return 0

        updates: list[dict[str, Any]] = []
        status_counts: dict[str, int] = {}
        unresolved_reason_counts: dict[str, int] = {}
        sample_rows: list[dict[str, Any]] = []

        for row in candidates:
            input_row, existing_state = _resolver_input(row)
            result = verifier.resolve(
                input_row,
                existing_state,
                force_refresh=bool(args.force_refresh),
            )
            status = result.tv_resolution_status or (
                "verified" if result.has_verified_tradingview_preview else "unavailable"
            )
            status_counts[status] = status_counts.get(status, 0) + 1
            if not result.has_verified_tradingview_preview:
                reason = result.tv_failure_reason or status
                unresolved_reason_counts[reason] = unresolved_reason_counts.get(reason, 0) + 1

            updates.append(
                {
                    "chain_id": input_row.chain_id,
                    "token_address": input_row.token_address,
                    "tradingview_symbol": result.tradingview_symbol,
                    "tradingview_exchange": result.tradingview_exchange,
                    "tradingview_embed_symbol": result.tradingview_embed_symbol,
                    "tv_resolution_status": result.tv_resolution_status,
                    "tv_verified_at": result.tv_verified_at,
                    "tv_last_checked_at": result.tv_last_checked_at,
                    "tv_failure_reason": result.tv_failure_reason,
                    "tv_search_evidence_json": dict(result.tv_search_evidence or {}),
                    "has_verified_tradingview_preview": bool(result.has_verified_tradingview_preview),
                }
            )

            if len(sample_rows) < 20:
                sample_rows.append(
                    {
                        "chainId": input_row.chain_id,
                        "tokenAddress": input_row.token_address,
                        "symbol": input_row.symbol,
                        "name": input_row.name,
                        "quoteSymbol": input_row.quote_symbol,
                        "tradingviewSymbol": result.tradingview_embed_symbol,
                        "status": result.tv_resolution_status,
                        "failureReason": result.tv_failure_reason,
                    }
                )

        updated_rows = store.upsert_memecoin_tradingview_preview_states(rows=updates)
        after = _coverage_summary(database_url)
        output = {
            "processed": len(candidates),
            "updatedRows": updated_rows,
            "statusCounts": status_counts,
            "unresolvedReasonCounts": unresolved_reason_counts,
            "verifierStats": verifier.stats,
            "before": before,
            "after": after,
            "samples": sample_rows,
        }
        print(json.dumps(output, indent=2, ensure_ascii=True))
        return 0
    finally:
        store.close()


if __name__ == "__main__":
    sys.exit(main())
