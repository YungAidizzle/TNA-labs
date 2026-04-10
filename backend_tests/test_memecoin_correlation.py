from __future__ import annotations

import logging
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.memecoin_correlation import (
    ActiveTrendCandidate,
    CandidateHydrationResult,
    CorrelationRankingResult,
    MarketCandidate,
    PreviewEligibilityResult,
    RecentTrendPost,
    TrendLinkScore,
    _build_search_seeds,
    _build_trend_text,
    _candidate_filter_reason,
    _choose_best_pair,
    _rank_correlated_candidates,
    _resolve_verified_tradingview_candidates,
    _select_active_trends,
    _soft_gate_penalties,
    _score_memecoin_fit,
    _validate_live_market_candidate,
    build_memecoin_correlation_runtime_config_from_env,
    run_memecoin_correlation_cycle,
)
from backend.tradingview_preview import TradingViewVerificationResult


def _build_candidate(
    *,
    name: str,
    symbol: str,
    description: str,
    discovery_sources: set[str] | None = None,
    community_takeover: bool = False,
    matched_trend_keys: set[str] | None = None,
    seed_terms: set[str] | None = None,
    market_score: float = 76.0,
    memecoin_fit_score: float = 0.0,
    token_address: str | None = None,
    pair_address: str | None = None,
    liquidity_usd: float = 180000.0,
    volume_h24: float = 720000.0,
    volume_h6: float = 180000.0,
    volume_h1: float = 60000.0,
    txns_h24: int = 1530,
    txns_h6: int = 320,
    txns_h1: int = 110,
    pair_age_days: int = 8,
    buys_h24: int = 820,
    sells_h24: int = 710,
    price_change_h24: float = 24.0,
) -> MarketCandidate:
    return MarketCandidate(
        chain_id="solana",
        token_address=token_address or f"{symbol.lower()}-token",
        pair_address=pair_address or f"{symbol.lower()}-pair",
        dexscreener_url=f"https://dexscreener.com/solana/{(pair_address or f'{symbol.lower()}-pair')}",
        dex_id="raydium",
        pair_labels=["memecoin"],
        token_name=name,
        token_symbol=symbol,
        quote_symbol="SOL",
        quote_token_address="sol-quote",
        quote_token_name="Solana",
        price_usd=0.0012,
        liquidity_usd=liquidity_usd,
        volume_h24=volume_h24,
        volume_h6=volume_h6,
        volume_h1=volume_h1,
        price_change_h24=price_change_h24,
        price_change_h6=8.0,
        price_change_h1=2.0,
        buys_h24=buys_h24,
        sells_h24=sells_h24,
        txns_h24=txns_h24,
        txns_h6=txns_h6,
        txns_h1=txns_h1,
        fdv=9500000.0,
        market_cap=9300000.0,
        pair_created_at=(datetime.now(timezone.utc) - timedelta(days=pair_age_days)).isoformat(),
        icon_url=None,
        header_url=None,
        websites=[{"label": "site", "url": "https://example.com"}],
        socials=[{"platform": "telegram", "handle": "frogcto"}],
        description=description,
        discovery_sources=set(discovery_sources or set()),
        matched_trend_keys=set(matched_trend_keys or {"internet-culture"}),
        seed_terms=set(seed_terms or {"internet culture"}),
        market_score=market_score,
        memecoin_fit_score=memecoin_fit_score,
        token_text=f"{name} {symbol} {description}",
        normalized_symbol=symbol.lower(),
        normalized_name=name.lower().replace(" ", ""),
        political_dominant=False,
        community_takeover=community_takeover,
    )


def _build_trend(
    *,
    topic_key: str,
    display_label: str,
    raw_label: str | None = None,
    trend_category: str = "internet_culture",
    key_entities: list[str] | None = None,
    narrative_summary: str | None = None,
    context_paragraph: str | None = None,
    total_mentions: int = 42,
    trusted_name: bool = True,
) -> ActiveTrendCandidate:
    now = datetime.now(timezone.utc)
    selected = _select_active_trends(
        [
            {
                "topic_key": topic_key,
                "display_label": display_label,
                "canonical_name": display_label if trusted_name else None,
                "raw_label": raw_label or display_label,
                "trend_category": trend_category,
                "enrichment_status": "ok",
                "summary_confidence": 0.72,
                "name_status": "ready" if trusted_name else "pending",
                "name_source": "ai_exact" if trusted_name else "none",
                "representative_post_count": 10,
                "narrative_summary": narrative_summary
                or f"{display_label} is driving fandom memes and creator chatter.",
                "context_paragraph": context_paragraph
                or f"Posts reference {display_label}, fan edits, and meme reactions.",
                "key_entities": key_entities or [display_label],
                "total_mentions": total_mentions,
                "unique_posts": max(10, total_mentions - 8),
                "unique_authors": max(8, total_mentions - 12),
                "last_seen_at": now.isoformat(),
                "window_end": now.isoformat(),
            }
        ],
        config=replace(build_memecoin_correlation_runtime_config_from_env(), max_trends=1),
        now=now,
    )
    return selected[0]


class _FakeDexClient:
    def __init__(
        self,
        *,
        pairs_by_pair_address: dict[tuple[str, str], list[dict]] | None = None,
        pairs_by_token_address: dict[tuple[str, str], list[dict]] | None = None,
    ) -> None:
        self._pairs_by_pair_address = pairs_by_pair_address or {}
        self._pairs_by_token_address = pairs_by_token_address or {}

    def get_pair_by_address(self, *, chain_id: str, pair_address: str) -> list[dict]:
        return list(self._pairs_by_pair_address.get((chain_id, pair_address), []))

    def get_pairs_for_token(self, *, chain_id: str, token_address: str) -> list[dict]:
        return list(self._pairs_by_token_address.get((chain_id, token_address), []))


class MemecoinCorrelationTests(unittest.TestCase):
    def test_memecoin_fit_favors_meme_native_candidates(self) -> None:
        config = build_memecoin_correlation_runtime_config_from_env()
        candidate = _build_candidate(
            name="Frog CTO",
            symbol="FROG",
            description="Community takeover meme coin for internet culture degens and viral frogs.",
            discovery_sources={"dex_community_takeovers_latest", "dex_boosts_top"},
            community_takeover=True,
        )

        candidate.memecoin_fit_score = _score_memecoin_fit(candidate)
        reject_reason = _candidate_filter_reason(
            candidate,
            config=config,
            now=datetime.now(timezone.utc),
        )

        self.assertGreaterEqual(candidate.memecoin_fit_score, config.min_memecoin_fit_score)
        self.assertIsNone(reject_reason)

    def test_memecoin_fit_softens_utility_heavy_tokens_into_penalties(self) -> None:
        config = build_memecoin_correlation_runtime_config_from_env()
        candidate = _build_candidate(
            name="Layer Swap Protocol",
            symbol="LSP",
            description=(
                "Cross-chain staking bridge protocol for governance, validators, restaking, "
                "wallet routing, and infrastructure automation."
            ),
            discovery_sources={"trend_seed_search"},
        )

        candidate.memecoin_fit_score = _score_memecoin_fit(candidate)
        reject_reason = _candidate_filter_reason(
            candidate,
            config=config,
            now=datetime.now(timezone.utc),
        )
        penalty_reasons, total_penalty = _soft_gate_penalties(
            candidate,
            config=config,
            now=datetime.now(timezone.utc),
        )

        self.assertLess(candidate.memecoin_fit_score, config.min_memecoin_fit_score)
        self.assertIsNone(reject_reason)
        self.assertIn("low_memecoin_fit", penalty_reasons)
        self.assertGreater(total_penalty, 0.0)

    def test_candidate_filter_still_rejects_broken_metadata(self) -> None:
        config = build_memecoin_correlation_runtime_config_from_env()
        candidate = _build_candidate(
            name="Broken Coin",
            symbol="BROKE",
            description="Broken metadata sample.",
        )
        candidate.dexscreener_url = ""

        reject_reason = _candidate_filter_reason(
            candidate,
            config=config,
            now=datetime.now(timezone.utc),
        )

        self.assertEqual(reject_reason, "missing_dex_url")

    def test_candidate_filter_softens_liquidity_volume_txns_and_pair_age(self) -> None:
        config = build_memecoin_correlation_runtime_config_from_env()
        candidate = _build_candidate(
            name="Thin Frog",
            symbol="TFROG",
            description="Thin but real meme coin for frogs and viral posts.",
            liquidity_usd=max(config.minimum_basic_liquidity_usd + 500.0, 1400.0),
            volume_h24=max(config.minimum_basic_volume_24h_usd + 250.0, 900.0),
            txns_h24=max(config.minimum_basic_txns_24h + 2, 4),
            txns_h6=6,
            txns_h1=2,
            pair_age_days=0,
            memecoin_fit_score=max(0.0, config.min_memecoin_fit_score - 3.0),
        )
        candidate.pair_created_at = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()

        reject_reason = _candidate_filter_reason(
            candidate,
            config=config,
            now=datetime.now(timezone.utc),
        )
        penalty_reasons, total_penalty = _soft_gate_penalties(
            candidate,
            config=config,
            now=datetime.now(timezone.utc),
        )

        self.assertIsNone(reject_reason)
        self.assertIn("low_liquidity", penalty_reasons)
        self.assertIn("low_volume", penalty_reasons)
        self.assertIn("low_txns", penalty_reasons)
        self.assertIn("fresh_pair", penalty_reasons)
        self.assertIn("low_memecoin_fit", penalty_reasons)
        self.assertGreater(total_penalty, 0.0)

    def test_candidate_filter_rejects_blatant_anti_rug_failure(self) -> None:
        config = build_memecoin_correlation_runtime_config_from_env()
        candidate = _build_candidate(
            name="Volume Mirage",
            symbol="VMRG",
            description="Looks broken and spoofed.",
            liquidity_usd=max(config.minimum_basic_liquidity_usd + 100.0, 900.0),
            volume_h24=max(config.minimum_basic_liquidity_usd * 500.0, 600000.0),
            txns_h24=max(config.minimum_basic_txns_24h + 2, 4),
        )

        reject_reason = _candidate_filter_reason(
            candidate,
            config=config,
            now=datetime.now(timezone.utc),
        )

        self.assertEqual(reject_reason, "anti_rug_failed")

    def test_candidate_filter_rejects_effectively_dead_pair(self) -> None:
        config = build_memecoin_correlation_runtime_config_from_env()
        candidate = _build_candidate(
            name="Dead Frog",
            symbol="DFROG",
            description="Old meme coin with almost no trading left.",
            liquidity_usd=max(config.minimum_basic_liquidity_usd + 250.0, 1800.0),
            volume_h24=max(config.minimum_basic_volume_24h_usd + 50.0, 700.0),
            volume_h6=40.0,
            volume_h1=0.0,
            txns_h24=max(config.minimum_basic_txns_24h + 1, 3),
            txns_h6=1,
            txns_h1=0,
            buys_h24=1,
            sells_h24=2,
            pair_age_days=7,
        )

        reject_reason = _candidate_filter_reason(
            candidate,
            config=config,
            now=datetime.now(timezone.utc),
        )

        self.assertEqual(reject_reason, "dead_pair_activity")

    def test_candidate_filter_rejects_rug_pull_signature_but_keeps_new_active_pair(self) -> None:
        config = build_memecoin_correlation_runtime_config_from_env()
        rugged_candidate = _build_candidate(
            name="Dumped Coin",
            symbol="DUMP",
            description="Collapsed meme coin with exit-liquidity vibes.",
            liquidity_usd=max(config.minimum_basic_liquidity_usd + 400.0, 2400.0),
            volume_h24=max(config.minimum_basic_volume_24h_usd + 250.0, 1200.0),
            volume_h6=90.0,
            volume_h1=10.0,
            txns_h24=10,
            txns_h6=1,
            txns_h1=0,
            buys_h24=2,
            sells_h24=24,
            price_change_h24=-97.5,
            pair_age_days=1,
        )
        live_new_candidate = _build_candidate(
            name="Fresh Wave",
            symbol="FWAVE",
            description="New meme coin with live trading and real speculative flow.",
            liquidity_usd=max(config.minimum_basic_liquidity_usd + 300.0, 1700.0),
            volume_h24=max(config.minimum_basic_volume_24h_usd + 450.0, 1200.0),
            volume_h6=500.0,
            volume_h1=180.0,
            txns_h24=max(config.minimum_basic_txns_24h + 6, 8),
            txns_h6=4,
            txns_h1=2,
            buys_h24=14,
            sells_h24=9,
            pair_age_days=0,
        )
        live_new_candidate.pair_created_at = (datetime.now(timezone.utc) - timedelta(minutes=25)).isoformat()

        rugged_reason = _candidate_filter_reason(
            rugged_candidate,
            config=config,
            now=datetime.now(timezone.utc),
        )
        live_reason = _candidate_filter_reason(
            live_new_candidate,
            config=config,
            now=datetime.now(timezone.utc),
        )

        self.assertEqual(rugged_reason, "rug_pull_signature")
        self.assertIsNone(live_reason)

    def test_choose_best_pair_prefers_active_preferred_quote_with_preview(self) -> None:
        weak_usdc_pair = {
            "pairAddress": "weak-pair",
            "url": "https://dexscreener.com/solana/weak-pair",
            "quoteToken": {"symbol": "USDC"},
            "liquidity": {"usd": 2200.0},
            "volume": {"h24": 1800.0},
            "txns": {"h24": {"buys": 8, "sells": 6}},
            "info": {},
            "pairCreatedAt": int((datetime.now(timezone.utc) - timedelta(days=2)).timestamp() * 1000),
        }
        strong_sol_pair = {
            "pairAddress": "strong-pair",
            "url": "https://dexscreener.com/solana/strong-pair",
            "quoteToken": {"symbol": "SOL"},
            "liquidity": {"usd": 180000.0},
            "volume": {"h24": 720000.0},
            "txns": {"h24": {"buys": 620, "sells": 540}},
            "info": {"openGraph": "https://cdn.example/strong.png"},
            "pairCreatedAt": int((datetime.now(timezone.utc) - timedelta(hours=10)).timestamp() * 1000),
        }

        selected = _choose_best_pair([weak_usdc_pair, strong_sol_pair])

        self.assertEqual(selected, strong_sol_pair)

    def test_live_validation_accepts_current_live_pair(self) -> None:
        config = build_memecoin_correlation_runtime_config_from_env()
        candidate = _build_candidate(
            name="Live Frog",
            symbol="LFROG",
            description="Live frog meme coin with active trading.",
            token_address="live-frog-token",
            pair_address="live-frog-pair",
        )
        live_pair = {
            "chainId": "solana",
            "pairAddress": "live-frog-pair",
            "url": "https://dexscreener.com/solana/live-frog-pair",
            "dexId": "raydium",
            "labels": ["memecoin"],
            "baseToken": {
                "address": "live-frog-token",
                "name": "Live Frog",
                "symbol": "LFROG",
            },
            "quoteToken": {
                "address": "sol-quote",
                "name": "Solana",
                "symbol": "SOL",
            },
            "liquidity": {"usd": 180000.0},
            "volume": {"h24": 820000.0, "h6": 280000.0, "h1": 64000.0},
            "txns": {
                "h24": {"buys": 820, "sells": 770},
                "h6": {"buys": 240, "sells": 220},
                "h1": {"buys": 62, "sells": 58},
            },
            "priceUsd": "0.0014",
            "priceChange": {"h24": "18.0", "h6": "7.0", "h1": "2.1"},
            "pairCreatedAt": int((datetime.now(timezone.utc) - timedelta(days=4)).timestamp() * 1000),
            "info": {"imageUrl": "https://cdn.example/live-frog.png"},
        }
        client = _FakeDexClient(
            pairs_by_pair_address={("solana", "live-frog-pair"): [live_pair]},
            pairs_by_token_address={("solana", "live-frog-token"): [live_pair]},
        )

        validation = _validate_live_market_candidate(
            client=client,
            candidate=candidate,
            config=config,
            now=datetime.now(timezone.utc),
        )

        self.assertTrue(validation.is_live)
        self.assertEqual(validation.status, "live")
        self.assertIsNotNone(validation.candidate)
        self.assertEqual(validation.candidate.pair_address, "live-frog-pair")
        self.assertTrue(validation.candidate.is_live)

    def test_live_validation_replaces_stale_cached_pair_with_stronger_live_pool(self) -> None:
        config = build_memecoin_correlation_runtime_config_from_env()
        candidate = _build_candidate(
            name="Swap Frog",
            symbol="SFROG",
            description="Meme coin rotating into a stronger live pool.",
            token_address="swap-frog-token",
            pair_address="stale-pair",
        )
        stale_pair = {
            "chainId": "solana",
            "pairAddress": "stale-pair",
            "url": "https://dexscreener.com/solana/stale-pair",
            "dexId": "raydium",
            "labels": ["memecoin"],
            "baseToken": {
                "address": "swap-frog-token",
                "name": "Swap Frog",
                "symbol": "SFROG",
            },
            "quoteToken": {
                "address": "sol-quote",
                "name": "Solana",
                "symbol": "SOL",
            },
            "liquidity": {"usd": 250.0},
            "volume": {"h24": 0.0, "h6": 0.0, "h1": 0.0},
            "txns": {
                "h24": {"buys": 0, "sells": 0},
                "h6": {"buys": 0, "sells": 0},
                "h1": {"buys": 0, "sells": 0},
            },
            "pairCreatedAt": int((datetime.now(timezone.utc) - timedelta(days=12)).timestamp() * 1000),
        }
        strong_pair = {
            "chainId": "solana",
            "pairAddress": "strong-live-pair",
            "url": "https://dexscreener.com/solana/strong-live-pair",
            "dexId": "raydium",
            "labels": ["memecoin"],
            "baseToken": {
                "address": "swap-frog-token",
                "name": "Swap Frog",
                "symbol": "SFROG",
            },
            "quoteToken": {
                "address": "sol-quote",
                "name": "Solana",
                "symbol": "SOL",
            },
            "liquidity": {"usd": 210000.0},
            "volume": {"h24": 910000.0, "h6": 360000.0, "h1": 88000.0},
            "txns": {
                "h24": {"buys": 900, "sells": 840},
                "h6": {"buys": 280, "sells": 240},
                "h1": {"buys": 70, "sells": 65},
            },
            "priceUsd": "0.0018",
            "priceChange": {"h24": "24.0", "h6": "11.0", "h1": "3.4"},
            "pairCreatedAt": int((datetime.now(timezone.utc) - timedelta(hours=18)).timestamp() * 1000),
            "info": {"imageUrl": "https://cdn.example/strong-live.png"},
        }
        client = _FakeDexClient(
            pairs_by_pair_address={
                ("solana", "stale-pair"): [],
                ("solana", "strong-live-pair"): [strong_pair],
            },
            pairs_by_token_address={("solana", "swap-frog-token"): [stale_pair, strong_pair]},
        )

        validation = _validate_live_market_candidate(
            client=client,
            candidate=candidate,
            config=config,
            now=datetime.now(timezone.utc),
        )

        self.assertTrue(validation.is_live)
        self.assertEqual(validation.candidate.pair_address, "strong-live-pair")
        self.assertEqual(validation.candidate.dexscreener_url, "https://dexscreener.com/solana/strong-live-pair")

    def test_live_validation_rejects_tokens_without_live_pairs(self) -> None:
        config = build_memecoin_correlation_runtime_config_from_env()
        candidate = _build_candidate(
            name="Dead Frog",
            symbol="DFROG",
            description="Dead meme coin with no live Dex pair.",
            token_address="dead-frog-token",
            pair_address="dead-frog-pair",
        )
        client = _FakeDexClient(
            pairs_by_pair_address={("solana", "dead-frog-pair"): []},
            pairs_by_token_address={("solana", "dead-frog-token"): []},
        )

        validation = _validate_live_market_candidate(
            client=client,
            candidate=candidate,
            config=config,
            now=datetime.now(timezone.utc),
        )

        self.assertFalse(validation.is_live)
        self.assertEqual(validation.reason, "no_pair_found")

    def test_build_trend_text_ignores_low_signal_enrichment_boilerplate(self) -> None:
        trend_text = _build_trend_text(
            {
                "display_label": "Steam",
                "raw_label": "Steam",
                "trend_category": "gaming",
                "narrative_summary": (
                    "Signals are still mixed across sampled posts. "
                    "This label is a safe fallback because AI enrichment was unavailable for this cycle."
                ),
                "context_paragraph": (
                    "AI trend naming failed for this visible topic during the current request, "
                    "so the dashboard is using the cleaned fallback label."
                ),
                "key_entities": ["Steam Deck", "Valve"],
            }
        )

        self.assertIn("Steam Deck", trend_text)
        self.assertIn("Valve", trend_text)
        self.assertNotIn("AI enrichment was unavailable", trend_text)
        self.assertNotIn("dashboard is using the cleaned fallback label", trend_text)

    def test_select_active_trends_prefers_culture_topics_over_political_fallback_noise(self) -> None:
        config = replace(build_memecoin_correlation_runtime_config_from_env(), max_trends=1)
        now = datetime.now(timezone.utc)

        selected = _select_active_trends(
            [
                {
                    "topic_key": "rump",
                    "display_label": "Trump",
                    "raw_label": "Trump",
                    "trend_category": "mixed discussion cluster",
                    "enrichment_status": "ok",
                    "summary_confidence": 0.18,
                    "narrative_summary": (
                        "Signals are still mixed across sampled posts. "
                        "This label is a safe fallback because AI enrichment was unavailable for this cycle."
                    ),
                    "context_paragraph": (
                        "Signals are directionally related but still broad. "
                        "This label is a safe fallback because AI enrichment was unavailable for this cycle."
                    ),
                    "key_entities": [],
                    "total_mentions": 220,
                    "unique_posts": 180,
                    "unique_authors": 160,
                    "last_seen_at": now.isoformat(),
                    "window_end": now.isoformat(),
                },
                {
                    "topic_key": "steam",
                    "display_label": "Steam Game Update",
                    "raw_label": "Steam",
                    "trend_category": "gaming",
                    "enrichment_status": "ok",
                    "summary_confidence": 0.61,
                    "narrative_summary": "Players are sharing reactions to a Steam game patch, streaming clips, and gaming memes.",
                    "context_paragraph": "Gaming communities are comparing updates and joke formats around the release.",
                    "key_entities": ["Steam", "Valve", "Steam Deck"],
                    "total_mentions": 26,
                    "unique_posts": 18,
                    "unique_authors": 15,
                    "last_seen_at": now.isoformat(),
                    "window_end": now.isoformat(),
                },
            ],
            config=config,
            now=now,
        )

        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0].topic_key, "rump")

    def test_build_search_seeds_skips_generic_display_labels(self) -> None:
        trend = _build_trend(
            topic_key="steam",
            display_label="Steam Game Update",
            raw_label="Steam Game Update",
        trend_category="gaming",
        key_entities=["Steam Deck", "Valve"],
        narrative_summary="Players are sharing reactions to a Steam game patch and memes.",
        context_paragraph="Gaming communities are comparing updates and joke formats around the release.",
        trusted_name=False,
    )

        seeds = _build_search_seeds(
            [trend],
            posts_by_topic={
                "steam": [
                    RecentTrendPost(
                        topic_key="steam",
                        text="Steam Deck fans are posting #SteamDeck clips and Valve memes",
                        normalized_text="steam deck fans are posting steamdeck clips and valve memes",
                        cashtags=[],
                        hashtags=["SteamDeck"],
                        key_phrases=["Steam Deck"],
                        topic_seeds=["Valve fanbase"],
                        tags=["gaming meme"],
                        created_at=datetime.now(timezone.utc).isoformat(),
                        quality_score=0.0,
                        engagement_score=0.0,
                    )
                ]
            },
            max_seed_queries=12,
            max_seeds_per_trend=6,
        )
        seed_terms = [seed["term"] for seed in seeds]

        self.assertIn("Steam Deck", seed_terms)
        self.assertIn("Valve", seed_terms)
        self.assertIn("Steam Game Update", seed_terms)
        self.assertIn("Valve fanbase", seed_terms)

    def test_build_search_seeds_prioritizes_trusted_ai_title_queries(self) -> None:
        trend = _build_trend(
            topic_key="skibidi",
            display_label="Skibidi Toilet",
            raw_label="mixed internet discourse cluster",
            trend_category="internet_culture",
            key_entities=["Skibidi", "Toilet"],
            narrative_summary="People are posting skibidi clips, remix edits, and brainrot memes.",
            context_paragraph="The cluster also contains noisy reaction-post fragments and generic chatter.",
        )

        seeds = _build_search_seeds(
            [trend],
            posts_by_topic={
                "skibidi": [
                    RecentTrendPost(
                        topic_key="skibidi",
                        text="Skibidi edits and #brainrot jokes are everywhere",
                        normalized_text="skibidi edits and brainrot jokes are everywhere",
                        cashtags=[],
                        hashtags=["brainrot"],
                        key_phrases=["reaction post fragments"],
                        topic_seeds=["generic chatter"],
                        tags=["internet discourse"],
                        created_at=datetime.now(timezone.utc).isoformat(),
                        quality_score=0.0,
                        engagement_score=0.0,
                    )
                ]
            },
            max_seed_queries=6,
            max_seeds_per_trend=8,
        )

        self.assertGreaterEqual(len(seeds), 2)
        self.assertEqual(seeds[0]["term"], "Skibidi Toilet")
        self.assertTrue(seeds[0]["title_based"])
        self.assertTrue(any(seed["title_based"] for seed in seeds[:3]))

    def test_rank_correlated_candidates_uses_medium_confidence_backfill(self) -> None:
        config = replace(
            build_memecoin_correlation_runtime_config_from_env(),
            high_confidence_correlation_threshold=90.0,
            medium_confidence_correlation_threshold=80.0,
            exploratory_correlation_threshold=20.0,
            target_published_results=3,
            max_results=5,
            max_recent_token_appearances=10,
        )
        anime_trend = _build_trend(
            topic_key="anime",
            display_label="Anime Meme Mania",
            trend_category="entertainment",
            key_entities=["Anime Bitcoin", "Waifu"],
        )
        vtuber_trend = _build_trend(
            topic_key="vtuber",
            display_label="Vtuber Stream Clips",
            trend_category="creator",
            key_entities=["Vtuber", "Streamer"],
        )
        gaming_trend = _build_trend(
            topic_key="gaming",
            display_label="Gaming Patch Memes",
            trend_category="gaming",
            key_entities=["Steam Deck", "Gaming Meme"],
        )
        candidates = [
            _build_candidate(
                name="Anime Bitcoin",
                symbol="ANIME",
                description="Anime meme coin for fandom edits and waifu timeline jokes.",
                matched_trend_keys={"anime"},
                seed_terms={"Anime Bitcoin", "Waifu"},
                memecoin_fit_score=22.0,
            ),
            _build_candidate(
                name="Stream Frog",
                symbol="SFROG",
                description="Vtuber streamer meme coin for clips, fanbase raids, and viral reactions.",
                matched_trend_keys={"vtuber"},
                seed_terms={"Vtuber", "Streamer"},
                memecoin_fit_score=21.0,
            ),
            _build_candidate(
                name="Patch Goblin",
                symbol="PATCH",
                description="Gaming meme coin for patch notes, Steam Deck jokes, and update memes.",
                matched_trend_keys={"gaming"},
                seed_terms={"Steam Deck", "Gaming Meme"},
                memecoin_fit_score=20.0,
            ),
        ]
        posts_by_topic = {
            "anime": [],
            "vtuber": [],
            "gaming": [],
        }

        result = _rank_correlated_candidates(
            candidates=candidates,
            trends=[anime_trend, vtuber_trend, gaming_trend],
            posts_by_topic=posts_by_topic,
            config=config,
            now=datetime.now(timezone.utc),
            recent_publications=[],
        )

        self.assertEqual(len(result.selected_results), 3)
        self.assertEqual(result.ranking_diagnostics["trend_topics_with_3_plus_links"], 3)
        self.assertEqual(result.ranking_diagnostics["trend_link_coverage_pct"], 100.0)
        self.assertEqual(result.funnel_counts["distinct_tokens_published"], 3)

    def test_rank_correlated_candidates_publishes_all_valid_candidates_when_cap_is_disabled(self) -> None:
        config = replace(
            build_memecoin_correlation_runtime_config_from_env(),
            high_confidence_correlation_threshold=95.0,
            medium_confidence_correlation_threshold=90.0,
            exploratory_correlation_threshold=12.0,
            medium_confidence_market_floor=28.0,
            medium_confidence_memecoin_floor=12.0,
            exploratory_market_floor=0.0,
            exploratory_memecoin_floor=0.0,
            target_published_results=0,
            max_results=0,
            max_theme_results_per_run=24,
            max_recent_token_appearances=20,
        )
        trend = _build_trend(
            topic_key="internet-culture",
            display_label="Internet Culture Meme Cluster",
            key_entities=["Frog", "Viral"],
        )
        candidates = [
            _build_candidate(
                name=f"Frog Meme {index}",
                symbol=f"FM{index}",
                description="Internet culture meme coin for viral frogs and degen timeline jokes.",
                matched_trend_keys={"internet-culture"},
                seed_terms={"Frog", "Viral"},
                token_address=f"frog-{index}",
                pair_address=f"frog-pair-{index}",
                liquidity_usd=4500.0 + index * 50.0,
                volume_h24=2600.0 + index * 40.0,
                txns_h24=10 + (index % 4),
                txns_h6=4,
                txns_h1=1,
                pair_age_days=0,
                memecoin_fit_score=5.0 + (index % 3),
            )
            for index in range(24)
        ]
        now = datetime.now(timezone.utc)
        for index, candidate in enumerate(candidates):
            candidate.pair_created_at = (now - timedelta(hours=2.5 + index * 0.05)).isoformat()

        result = _rank_correlated_candidates(
            candidates=candidates,
            trends=[trend],
            posts_by_topic={"internet-culture": []},
            config=config,
            now=now,
            recent_publications=[],
        )

        self.assertEqual(len(result.selected_results), 24)
        self.assertEqual(result.ranking_diagnostics["final_published_count"], 24)
        self.assertEqual(result.ranking_diagnostics["publishable_unique_token_count"], 24)
        self.assertEqual(result.ranking_diagnostics["selection_limit"], 24)
        self.assertTrue(result.ranking_diagnostics["forced_fill_used"])
        self.assertGreaterEqual(result.ranking_diagnostics["exploratory_published"], 1)

    def test_rank_correlated_candidates_publishes_plausible_exploratory_candidate(self) -> None:
        config = replace(
            build_memecoin_correlation_runtime_config_from_env(),
            high_confidence_correlation_threshold=95.0,
            medium_confidence_correlation_threshold=85.0,
            exploratory_correlation_threshold=6.0,
            exploratory_market_floor=0.0,
            exploratory_memecoin_floor=0.0,
            target_published_results=1,
            max_results=3,
        )
        trend = _build_trend(
            topic_key="vtuber",
            display_label="Vtuber Clip Memes",
            trend_category="creator",
            key_entities=["Vtuber", "Streamer", "Clip"],
        )
        candidate = _build_candidate(
            name="Clip Frog",
            symbol="CLIPF",
            description="Vtuber fandom meme coin for clip farms, raids, and streamer jokes.",
            matched_trend_keys={"vtuber"},
            seed_terms={"Vtuber", "Streamer", "Clip"},
            liquidity_usd=max(build_memecoin_correlation_runtime_config_from_env().minimum_basic_liquidity_usd + 100.0, 1000.0),
            volume_h24=max(build_memecoin_correlation_runtime_config_from_env().minimum_basic_volume_24h_usd + 100.0, 700.0),
            txns_h24=max(build_memecoin_correlation_runtime_config_from_env().minimum_basic_txns_24h + 1, 3),
            memecoin_fit_score=1.5,
        )
        candidate.pair_created_at = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()

        result = _rank_correlated_candidates(
            candidates=[candidate],
            trends=[trend],
            posts_by_topic={"vtuber": []},
            config=config,
            now=datetime.now(timezone.utc),
            recent_publications=[],
        )

        self.assertEqual(len(result.selected_results), 1)
        self.assertIn(result.selected_results[0]["publish_tier"], {"medium", "exploratory"})
        self.assertEqual(result.trend_memecoin_rows[0]["confidence_band"], "medium")
        self.assertTrue(result.trend_memecoin_rows[0]["why_linked"])
        self.assertIsInstance(result.trend_memecoin_rows[0]["match_reasons_json"], list)

    def test_rank_correlated_candidates_penalizes_recent_repeat_tokens(self) -> None:
        config = replace(
            build_memecoin_correlation_runtime_config_from_env(),
            high_confidence_correlation_threshold=40.0,
            medium_confidence_correlation_threshold=34.0,
            target_published_results=2,
            max_results=2,
            max_recent_token_appearances=10,
        )
        trend = _build_trend(
            topic_key="internet-culture",
            display_label="Internet Culture Memes",
            key_entities=["Frog", "Bull"],
        )
        repeated = _build_candidate(
            name="Bull",
            symbol="BULL",
            description="Internet culture meme coin for bull posting and viral jokes.",
            matched_trend_keys={"internet-culture"},
            seed_terms={"Bull"},
            memecoin_fit_score=20.0,
        )
        novel = _build_candidate(
            name="Frog CTO",
            symbol="FROG",
            description="Internet culture meme coin for frogs, degen posts, and viral memes.",
            matched_trend_keys={"internet-culture"},
            seed_terms={"Frog"},
            memecoin_fit_score=21.0,
        )

        result = _rank_correlated_candidates(
            candidates=[repeated, novel],
            trends=[trend],
            posts_by_topic={"internet-culture": []},
            config=config,
            now=datetime.now(timezone.utc),
            recent_publications=[
                {
                    "chain_id": "solana",
                    "token_address": "bull-token",
                    "strongest_topic_key": "internet-culture",
                },
                {
                    "chain_id": "solana",
                    "token_address": "bull-token",
                    "strongest_topic_key": "internet-culture",
                },
            ],
        )

        self.assertGreaterEqual(len(result.selected_results), 2)
        self.assertEqual(result.selected_results[0]["candidate"].token_symbol, "FROG")

    def test_rank_correlated_candidates_softens_repeat_penalty_when_fill_is_needed(self) -> None:
        config = replace(
            build_memecoin_correlation_runtime_config_from_env(),
            high_confidence_correlation_threshold=48.0,
            medium_confidence_correlation_threshold=30.0,
            exploratory_correlation_threshold=14.0,
            target_published_results=3,
            max_results=3,
            max_recent_token_appearances=1,
            recent_repeat_penalty_per_hit=1.0,
            recent_theme_penalty_per_hit=0.5,
        )
        trend = _build_trend(
            topic_key="internet-culture",
            display_label="Internet Culture Memes",
            key_entities=["Frog", "Bull", "Cat"],
        )
        repeated = _build_candidate(
            name="Bull",
            symbol="BULL",
            description="Internet culture meme coin for bull posting and viral jokes.",
            matched_trend_keys={"internet-culture"},
            seed_terms={"Bull"},
            memecoin_fit_score=18.0,
        )
        backup_one = _build_candidate(
            name="Frog CTO",
            symbol="FROG",
            description="Internet culture meme coin for frogs, degen posts, and viral memes.",
            matched_trend_keys={"internet-culture"},
            seed_terms={"Frog"},
            memecoin_fit_score=19.0,
        )
        backup_two = _build_candidate(
            name="Cat Wave",
            symbol="CATW",
            description="Internet culture meme coin for cat edits, timeline jokes, and fan memes.",
            matched_trend_keys={"internet-culture"},
            seed_terms={"Cat"},
            memecoin_fit_score=17.0,
        )

        result = _rank_correlated_candidates(
            candidates=[repeated, backup_one, backup_two],
            trends=[trend],
            posts_by_topic={"internet-culture": []},
            config=config,
            now=datetime.now(timezone.utc),
            recent_publications=[
                {
                    "chain_id": "solana",
                    "token_address": "bull-token",
                    "strongest_topic_key": "internet-culture",
                },
                {
                    "chain_id": "solana",
                    "token_address": "bull-token",
                    "strongest_topic_key": "internet-culture",
                },
                {
                    "chain_id": "solana",
                    "token_address": "bull-token",
                    "strongest_topic_key": "internet-culture",
                },
            ],
        )

        self.assertEqual(len(result.selected_results), 3)
        self.assertIn("BULL", [item["candidate"].token_symbol for item in result.selected_results])

    def test_rank_correlated_candidates_avoids_duplicate_token_publish(self) -> None:
        config = replace(
            build_memecoin_correlation_runtime_config_from_env(),
            high_confidence_correlation_threshold=34.0,
            medium_confidence_correlation_threshold=30.0,
            target_published_results=2,
            max_results=3,
        )
        trend = _build_trend(
            topic_key="frog",
            display_label="Frog Meme Fever",
            key_entities=["Frog CTO"],
        )
        first = _build_candidate(
            name="Frog CTO",
            symbol="FROG",
            description="Frog meme coin for viral internet culture jokes.",
            matched_trend_keys={"frog"},
            seed_terms={"Frog CTO"},
            memecoin_fit_score=22.0,
            token_address="frog-token",
            pair_address="frog-pair-a",
        )
        second = _build_candidate(
            name="Frog CTO",
            symbol="FROG",
            description="Frog meme coin for viral internet culture jokes.",
            matched_trend_keys={"frog"},
            seed_terms={"Frog CTO"},
            memecoin_fit_score=22.0,
            token_address="frog-token",
            pair_address="frog-pair-b",
        )

        result = _rank_correlated_candidates(
            candidates=[first, second],
            trends=[trend],
            posts_by_topic={"frog": []},
            config=config,
            now=datetime.now(timezone.utc),
            recent_publications=[],
        )

        self.assertEqual(len(result.selected_results), 1)
        self.assertEqual(result.reject_counts.get("duplicate_token_same_run"), 1)

    def test_select_active_trends_ignores_untrusted_generic_canonical_names(self) -> None:
        config = replace(build_memecoin_correlation_runtime_config_from_env(), max_trends=2)
        now = datetime.now(timezone.utc)

        selected = _select_active_trends(
            [
                {
                    "topic_key": "outube",
                    "display_label": "Mixed creator platform discussion",
                    "canonical_name": "Mixed creator platform discussion",
                    "raw_label": "YouTube",
                    "fallback_label": "YouTube",
                    "trend_category": "mixed discussion cluster",
                    "enrichment_status": "ok",
                    "summary_confidence": 0.18,
                    "name_status": "pending",
                    "name_source": "none",
                    "representative_post_count": 10,
                    "narrative_summary": "Creators are discussing YouTube uploads and platform changes.",
                    "context_paragraph": "The conversation is mostly short reactions about YouTube videos and channels.",
                    "key_entities": [],
                    "total_mentions": 18,
                    "unique_posts": 18,
                    "unique_authors": 18,
                    "last_seen_at": now.isoformat(),
                    "window_end": now.isoformat(),
                },
                {
                    "topic_key": "ovie",
                    "display_label": "Movie",
                    "canonical_name": "Movie",
                    "raw_label": "Movie",
                    "fallback_label": "Movie",
                    "trend_category": "mixed discussion cluster",
                    "enrichment_status": "ok",
                    "summary_confidence": 0.18,
                    "name_status": "pending",
                    "name_source": "none",
                    "representative_post_count": 5,
                    "narrative_summary": "General film chatter with mixed posts and no single coherent narrative.",
                    "context_paragraph": "The sample is broad entertainment discussion rather than a specific trend.",
                    "key_entities": [],
                    "total_mentions": 14,
                    "unique_posts": 14,
                    "unique_authors": 14,
                    "last_seen_at": now.isoformat(),
                    "window_end": now.isoformat(),
                },
            ],
            config=config,
            now=now,
        )

        self.assertCountEqual([trend.topic_key for trend in selected], ["outube", "ovie"])
        selected_by_key = {trend.topic_key: trend for trend in selected}
        self.assertEqual(selected_by_key["outube"].display_label, "YouTube")
        self.assertFalse(selected_by_key["outube"].trusted_display_name)

    def test_failed_cycle_persists_failed_run_row(self) -> None:
        config = replace(build_memecoin_correlation_runtime_config_from_env(), max_trends=1)
        now = datetime.now(timezone.utc)

        class _FakeStore:
            def __init__(self) -> None:
                self.record_calls: list[dict] = []

            def verify_memecoin_correlation_tables(self) -> dict[str, object]:
                return {"available": True, "missing_tables": []}

            def fetch_memecoin_candidate_trends(self, *, limit: int = 80) -> list[dict]:
                return [
                    {
                        "topic_key": "steam",
                        "display_label": "Steam Game Update",
                        "raw_label": "Steam",
                        "trend_category": "gaming",
                        "enrichment_status": "ok",
                        "summary_confidence": 0.61,
                        "narrative_summary": "Players are sharing reactions to a Steam game patch and memes.",
                        "context_paragraph": "Gaming communities are comparing updates and joke formats around the release.",
                        "key_entities": ["Steam Deck", "Valve"],
                        "total_mentions": 22,
                        "unique_posts": 18,
                        "unique_authors": 14,
                        "last_seen_at": now.isoformat(),
                        "window_end": now.isoformat(),
                    }
                ]

            def fetch_memecoin_recent_posts_for_topics(
                self,
                *,
                topic_keys: list[str],
                lookback_hours: int = 36,
                per_topic_limit: int = 60,
            ) -> list[dict]:
                return []

            def record_memecoin_correlation_run(
                self,
                *,
                run_row: dict,
                asset_rows,
                market_snapshot_rows,
                result_rows,
                link_rows,
                selected_topic_keys,
                trend_memecoin_rows,
            ) -> dict:
                self.record_calls.append(
                    {
                        "run_row": dict(run_row),
                        "asset_rows": list(asset_rows),
                        "market_snapshot_rows": list(market_snapshot_rows),
                        "result_rows": list(result_rows),
                        "link_rows": list(link_rows),
                        "selected_topic_keys": list(selected_topic_keys),
                        "trend_memecoin_rows": list(trend_memecoin_rows),
                    }
                )
                return {"run_id": len(self.record_calls)}

        store = _FakeStore()
        logger = logging.getLogger("memecoin-test")

        with patch(
            "backend.memecoin_correlation._hydrate_market_candidates",
            side_effect=RuntimeError("boom"),
        ):
            with self.assertRaisesRegex(RuntimeError, "boom"):
                run_memecoin_correlation_cycle(
                    store=store,
                    logger=logger,
                    config=config,
                    reason="unit_test",
                )

        self.assertEqual(len(store.record_calls), 1)
        self.assertEqual(store.record_calls[0]["run_row"]["status"], "failed")
        self.assertEqual(store.record_calls[0]["run_row"]["published_result_count"], 0)
        self.assertEqual(store.record_calls[0]["run_row"]["notes_json"]["failure_stage"], "hydrate_market_candidates")
        self.assertEqual(store.record_calls[0]["run_row"]["notes_json"]["error"], "boom")

    def test_tradingview_resolution_persists_preview_state_without_filtering_candidates(self) -> None:
        verified = _build_candidate(
            name="Verified Frog",
            symbol="VFROG",
            description="Verified frog meme coin.",
        )
        unresolved = _build_candidate(
            name="Unverified Ghost",
            symbol="GHOST",
            description="Ghost meme coin.",
            token_address="ghost-token",
            pair_address="ghost-pair",
        )

        class _FakeStore:
            def __init__(self) -> None:
                self.upsert_rows: list[dict] = []

            def fetch_memecoin_tradingview_states(self, *, asset_keys):
                return {}

            def upsert_memecoin_tradingview_preview_states(self, *, rows):
                self.upsert_rows = list(rows)
                return len(rows)

        store = _FakeStore()
        verification_results = [
            TradingViewVerificationResult(
                has_verified_tradingview_preview=True,
                tradingview_symbol="VFROGUSDT",
                tradingview_exchange="KCEX",
                tradingview_embed_symbol="KCEX:VFROGUSDT",
                tv_resolution_status="verified",
                tv_verified_at=datetime.now(timezone.utc).isoformat(),
                tv_last_checked_at=datetime.now(timezone.utc).isoformat(),
                tv_failure_reason=None,
                tv_search_evidence={"resolution_source": "tradingview_search"},
            ),
            TradingViewVerificationResult(
                has_verified_tradingview_preview=False,
                tradingview_symbol=None,
                tradingview_exchange=None,
                tradingview_embed_symbol=None,
                tv_resolution_status="unavailable",
                tv_verified_at=None,
                tv_last_checked_at=datetime.now(timezone.utc).isoformat(),
                tv_failure_reason="tradingview_symbol_unavailable",
                tv_search_evidence={"resolution_source": None},
            ),
        ]

        with patch(
            "backend.memecoin_correlation.TradingViewPreviewVerifier.resolve",
            side_effect=verification_results,
        ):
            result = _resolve_verified_tradingview_candidates(
                store=store,
                logger=logging.getLogger("memecoin-tv-gate-test"),
                candidates=[verified, unresolved],
            )

        self.assertEqual([candidate.token_symbol for candidate in result.candidates], ["VFROG", "GHOST"])
        self.assertEqual(result.reject_counts, {})
        self.assertEqual(result.funnel_counts["candidates_after_tradingview_gate"], 2)
        self.assertEqual(result.diagnostics["verified_count"], 1)
        self.assertEqual(result.diagnostics["unresolved_reason_counts"]["tradingview_symbol_unavailable"], 1)
        self.assertEqual(len(store.upsert_rows), 2)
        self.assertTrue(store.upsert_rows[0]["has_verified_tradingview_preview"])
        self.assertFalse(store.upsert_rows[1]["has_verified_tradingview_preview"])

    def test_run_cycle_records_funnel_counts_for_successful_publish(self) -> None:
        config = replace(
            build_memecoin_correlation_runtime_config_from_env(),
            max_trends=2,
            target_published_results=2,
            max_results=4,
        )
        now = datetime.now(timezone.utc)

        class _FakeStore:
            def __init__(self) -> None:
                self.record_calls: list[dict] = []

            def verify_memecoin_correlation_tables(self) -> dict[str, object]:
                return {"available": True, "missing_tables": []}

            def fetch_memecoin_candidate_trends(self, *, limit: int = 80) -> list[dict]:
                return [
                    {
                        "topic_key": "anime",
                        "display_label": "Anime Meme Mania",
                        "raw_label": "Anime",
                        "trend_category": "entertainment",
                        "enrichment_status": "ok",
                        "summary_confidence": 0.72,
                        "narrative_summary": "Anime fandom memes are surging.",
                        "context_paragraph": "Fan edits and meme clips are spreading quickly.",
                        "key_entities": ["Anime Bitcoin", "Waifu"],
                        "total_mentions": 48,
                        "unique_posts": 42,
                        "unique_authors": 39,
                        "last_seen_at": now.isoformat(),
                        "window_end": now.isoformat(),
                    },
                    {
                        "topic_key": "vtuber",
                        "display_label": "Vtuber Stream Clips",
                        "raw_label": "Vtuber",
                        "trend_category": "creator",
                        "enrichment_status": "ok",
                        "summary_confidence": 0.68,
                        "narrative_summary": "Vtuber clips and fan jokes are circulating.",
                        "context_paragraph": "Streamer fandom content is dominating short posts.",
                        "key_entities": ["Vtuber", "Streamer"],
                        "total_mentions": 44,
                        "unique_posts": 36,
                        "unique_authors": 31,
                        "last_seen_at": now.isoformat(),
                        "window_end": now.isoformat(),
                    },
                ]

            def fetch_memecoin_recent_posts_for_topics(
                self,
                *,
                topic_keys: list[str],
                lookback_hours: int = 36,
                per_topic_limit: int = 60,
            ) -> list[dict]:
                return []

            def fetch_recent_memecoin_publication_stats(self, *, limit_runs: int = 8) -> list[dict]:
                return [
                    {
                        "chain_id": "solana",
                        "token_address": "bull-token",
                        "strongest_topic_key": "anime",
                    }
                ]

            def record_memecoin_correlation_run(
                self,
                *,
                run_row: dict,
                asset_rows,
                market_snapshot_rows,
                result_rows,
                link_rows,
                selected_topic_keys,
                trend_memecoin_rows,
            ) -> dict:
                self.record_calls.append(
                    {
                        "run_row": dict(run_row),
                        "asset_rows": list(asset_rows),
                        "market_snapshot_rows": list(market_snapshot_rows),
                        "result_rows": list(result_rows),
                        "link_rows": list(link_rows),
                        "selected_topic_keys": list(selected_topic_keys),
                        "trend_memecoin_rows": list(trend_memecoin_rows),
                    }
                )
                return {"run_id": len(self.record_calls)}

        store = _FakeStore()
        logger = logging.getLogger("memecoin-success-test")
        anime_candidate = _build_candidate(
            name="Anime Bitcoin",
            symbol="ANIME",
            description="Anime meme coin for fandom posts and waifu jokes.",
            matched_trend_keys={"anime"},
            seed_terms={"Anime Bitcoin"},
            memecoin_fit_score=22.0,
        )
        frog_candidate = _build_candidate(
            name="Stream Frog",
            symbol="FROG",
            description="Vtuber meme coin for streamer clips and fandom raids.",
            matched_trend_keys={"vtuber"},
            seed_terms={"Vtuber"},
            memecoin_fit_score=20.0,
        )
        strongest_anime = TrendLinkScore(
            topic_key="anime",
            topic_label="Anime Meme Mania",
            trend_category="entertainment",
            narrative_summary="Anime fandom memes are surging.",
            lexical_score=24.0,
            mention_score=12.0,
            timing_score=8.0,
            culture_fit_score=10.0,
            link_score=54.0,
            support_post_count=2,
            support_interaction_score=5.0,
        )
        strongest_vtuber = TrendLinkScore(
            topic_key="vtuber",
            topic_label="Vtuber Stream Clips",
            trend_category="creator",
            narrative_summary="Vtuber clips and fan jokes are circulating.",
            lexical_score=20.0,
            mention_score=10.0,
            timing_score=8.0,
            culture_fit_score=9.0,
            link_score=47.0,
            support_post_count=1,
            support_interaction_score=4.0,
        )

        with patch(
            "backend.memecoin_correlation._discover_from_dex_feeds",
            return_value={},
        ), patch(
            "backend.memecoin_correlation._discover_from_search",
            return_value={},
        ), patch(
            "backend.memecoin_correlation._hydrate_market_candidates",
            return_value=CandidateHydrationResult(
                candidates=[anime_candidate, frog_candidate],
                reject_counts={"no_basic_market_presence": 3},
                penalty_counts={"low_volume": 2},
                funnel_counts={
                    "discovery_candidates_found": 8,
                    "candidates_after_metadata_sanity": 6,
                    "candidates_after_basic_market_sanity": 5,
                    "candidates_after_anti_rug_screen": 4,
                },
            ),
        ), patch(
            "backend.memecoin_correlation._resolve_verified_tradingview_candidates",
            return_value=PreviewEligibilityResult(
                candidates=[anime_candidate, frog_candidate],
                reject_counts={},
                funnel_counts={"candidates_after_tradingview_gate": 2},
                diagnostics={"verified_count": 2, "coverage_rate_pct": 100.0},
            ),
        ), patch(
            "backend.memecoin_correlation._rank_correlated_candidates",
            return_value=CorrelationRankingResult(
                selected_results=[
                    {
                        "candidate": anime_candidate,
                        "strongest_link": strongest_anime,
                        "rank": 1,
                        "correlation_score": 58.0,
                        "correlation_label": "Moderate",
                        "political_dominant": False,
                    },
                    {
                        "candidate": frog_candidate,
                        "strongest_link": strongest_vtuber,
                        "rank": 2,
                        "correlation_score": 43.0,
                        "correlation_label": "Moderate",
                        "political_dominant": False,
                    },
                ],
                link_rows=[],
                trend_memecoin_rows=[
                    {
                        "topic_key": "anime",
                        "topic_label": "Anime Meme Mania",
                        "rank": 1,
                        "chain_id": "solana",
                        "coin_address": "anime-token",
                        "pair_address": "anime-pair",
                        "dexscreener_url": "https://dexscreener.com/solana/anime-pair",
                        "coin_symbol": "ANIME",
                        "coin_name": "Anime Bitcoin",
                        "confidence_score": 58.0,
                        "confidence_band": "speculative",
                        "mention_count": 2,
                        "engagement_score": 5.0,
                        "age_hours": 24.0,
                        "liquidity": 180000.0,
                        "volume_24h": 720000.0,
                        "market_score": 76.0,
                        "memecoin_fit_score": 22.0,
                        "why_linked": "matched narrative keyword 'anime'.",
                        "match_reasons_json": ["matched narrative keyword 'anime'"],
                        "raw_match_signals_json": {"exact_overlap_count": 1},
                    },
                    {
                        "topic_key": "vtuber",
                        "topic_label": "Vtuber Stream Clips",
                        "rank": 1,
                        "chain_id": "solana",
                        "coin_address": "frog-token",
                        "pair_address": "frog-pair",
                        "dexscreener_url": "https://dexscreener.com/solana/frog-pair",
                        "coin_symbol": "FROG",
                        "coin_name": "Stream Frog",
                        "confidence_score": 43.0,
                        "confidence_band": "speculative",
                        "mention_count": 1,
                        "engagement_score": 4.0,
                        "age_hours": 24.0,
                        "liquidity": 180000.0,
                        "volume_24h": 720000.0,
                        "market_score": 76.0,
                        "memecoin_fit_score": 20.0,
                        "why_linked": "matched narrative keyword 'vtuber'.",
                        "match_reasons_json": ["matched narrative keyword 'vtuber'"],
                        "raw_match_signals_json": {"exact_overlap_count": 1},
                    },
                ],
                ranking_diagnostics={
                    "candidate_count": 2,
                    "selected_count": 2,
                    "high_candidates": 1,
                    "medium_candidates": 1,
                    "exploratory_candidates": 0,
                    "high_confidence_published": 1,
                    "medium_confidence_published": 1,
                    "exploratory_published": 0,
                    "final_published_count": 2,
                    "forced_fill_used": True,
                    "candidate_pool_exhausted": False,
                    "trend_topics_with_links": 2,
                    "trend_topics_without_links": 0,
                    "trend_memecoin_row_count": 2,
                    "trend_link_coverage_pct": 100.0,
                    "avg_memecoins_per_trend": 1.0,
                },
                reject_counts={"below_exploratory_threshold": 1},
                penalty_counts={"fresh_pair": 1},
                funnel_counts={
                    "candidates_after_relevance_scoring": 2,
                    "candidates_after_publish_dedupe": 2,
                    "distinct_tokens_published": 2,
                },
            ),
        ):
            summary = run_memecoin_correlation_cycle(
                store=store,
                logger=logger,
                config=config,
                reason="unit_success",
            )

        self.assertEqual(summary["published_result_count"], 2)
        self.assertEqual(summary["funnel_counts"]["active_trends_selected"], 2)
        self.assertEqual(summary["funnel_counts"]["distinct_tokens_published"], 2)
        self.assertEqual(summary["trend_topics_with_links"], 2)
        self.assertEqual(summary["trend_link_coverage_pct"], 100.0)
        self.assertEqual(store.record_calls[0]["selected_topic_keys"], ["anime", "vtuber"])
        self.assertEqual(len(store.record_calls[0]["trend_memecoin_rows"]), 2)
        notes_json = store.record_calls[0]["run_row"]["notes_json"]
        self.assertEqual(notes_json["funnel_counts"]["candidates_after_anti_rug_screen"], 4)
        self.assertEqual(notes_json["reject_counts"]["below_exploratory_threshold"], 1)
        self.assertEqual(notes_json["penalty_counts"]["fresh_pair"], 1)
        self.assertEqual(notes_json["preview_diagnostics"]["verified_count"], 2)
        self.assertEqual(notes_json["db_write_counts"]["result_rows"], 2)
        self.assertEqual(
            notes_json["live_validation_thresholds"]["live_min_liquidity_usd"],
            config.live_min_liquidity_usd,
        )


if __name__ == "__main__":
    unittest.main()
