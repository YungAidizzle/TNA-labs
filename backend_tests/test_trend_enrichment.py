import logging
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.trend_enrichment import (
    OpenAIEnrichmentOutputError,
    OpenAIEnrichmentTransportError,
    _should_refresh_enrichment,
    _should_upsert_current_enrichment_row,
    _should_refresh_visible_title,
    _validate_title_output_against_evidence,
    TrendEnrichmentRuntimeConfig,
    build_trend_enrichment_runtime_config_from_env,
    build_trend_title_generation_runtime_config_from_env,
    build_enrichment_input_hash,
    run_trend_enrichment_cycle,
    summarize_trend_title_coverage,
    select_representative_posts,
)


class _FakeStore:
    def __init__(self, *, topics: list[dict], candidate_rows_by_topic: dict[str, list[dict]]) -> None:
        self.topics = topics
        self.candidate_rows_by_topic = candidate_rows_by_topic
        self.latest_state: dict[str, dict] = {}
        self.ensure_calls = 0
        self.upsert_calls: list[dict] = []
        self.insert_run_calls: list[dict] = []
        self.upsert_failures: list[Exception] = []

    def ensure_stable_topic_read_model_tables(self) -> None:
        self.ensure_calls += 1

    def fetch_top_topics_for_enrichment(
        self,
        *,
        limit: int = 250,
        prioritize_pending_titles: bool = False,
    ) -> list[dict]:
        return self.topics[:limit]

    def fetch_topic_post_candidates_for_enrichment(
        self,
        *,
        topic_key: str,
        limit: int = 120,
        window_start=None,
        window_end=None,
    ) -> list[dict]:
        return list(self.candidate_rows_by_topic.get(topic_key, []))[:limit]

    def fetch_latest_topic_enrichment_state(self, *, topic_keys: list[str]) -> dict[str, dict]:
        return {
            topic_key: dict(self.latest_state[topic_key])
            for topic_key in topic_keys
            if topic_key in self.latest_state
        }

    def upsert_topic_ai_enrichment(self, row: dict) -> dict:
        self.upsert_calls.append(dict(row))
        if self.upsert_failures:
            raise self.upsert_failures.pop(0)
        return {
            "id": len(self.upsert_calls),
            "topic_key": row["topic_key"],
            "as_of_window_end": row["as_of_window_end"],
            "input_hash": row["input_hash"],
            "generated_at": row["generated_at"],
            "refreshed_at": row["refreshed_at"],
        }

    def insert_topic_ai_enrichment_run(self, row: dict) -> dict:
        self.insert_run_calls.append(dict(row))
        return {
            "id": len(self.insert_run_calls),
            "topic_key": row["topic_key"],
            "as_of_window_end": row["as_of_window_end"],
            "input_hash": row["input_hash"],
            "generated_at": row["generated_at"],
        }


class TrendEnrichmentTests(unittest.TestCase):
    def _build_runtime_config(self) -> TrendEnrichmentRuntimeConfig:
        return TrendEnrichmentRuntimeConfig(
            enabled=True,
            openai_api_key="test-key",
            model_name="gpt-5.4-mini",
            prompt_version="v1",
            interval_seconds=300.0,
            max_topics=250,
            max_topics_per_pass=24,
            max_duration_seconds=30.0,
            representative_posts=4,
            candidate_post_limit=20,
            stale_after_hours=6.0,
            request_timeout_seconds=8.0,
            max_retries=1,
            retry_backoff_seconds=0.1,
            hash_change_cooldown_hours=12.0,
            max_post_chars=260,
            enforce_min_text_chars=28,
            enforce_min_word_count=5,
            min_unique_authors=5,
            min_unique_posts=8,
            min_coherence_score=0.18,
            mixed_coherence_score=0.10,
            max_top_author_share=0.35,
            simulated_delay_seconds=0.0,
        )

    def _topic_rows(self) -> tuple[list[dict], dict[str, list[dict]]]:
        now = datetime(2026, 4, 1, 1, 0, tzinfo=timezone.utc)
        topics = [
            {
                "topic_key": "march",
                "topic_label": "march",
                "platform_count": 1,
                "total_mentions": 120,
                "unique_posts": 44,
                "unique_authors": 31,
                "positive_count": 18,
                "neutral_count": 20,
                "negative_count": 6,
                "window_start": (now - timedelta(hours=24)).isoformat(),
                "window_end": now.isoformat(),
            },
            {
                "topic_key": "chip export",
                "topic_label": "chip export",
                "platform_count": 1,
                "total_mentions": 95,
                "unique_posts": 36,
                "unique_authors": 29,
                "positive_count": 10,
                "neutral_count": 18,
                "negative_count": 8,
                "window_start": (now - timedelta(hours=24)).isoformat(),
                "window_end": now.isoformat(),
            },
        ]
        candidate_rows = {
            "march": [
                {
                    "raw_post_id": 1,
                    "source_post_id": "m1",
                    "platform": "bluesky",
                    "text_content": "Fans are debating March Madness bracket picks, game results, and standout NCAA tournament performances tonight.",
                    "fingerprint": "march-1",
                    "quality_score": 0.9,
                    "like_count": 30,
                    "repost_count": 5,
                    "reply_count": 6,
                    "quote_count": 1,
                    "author_id": "march-a",
                    "event_timestamp": now.isoformat(),
                },
                {
                    "raw_post_id": 2,
                    "source_post_id": "m2",
                    "platform": "bluesky",
                    "text_content": "Posts focus on March Madness upsets, live reactions, and bracket damage across the NCAA tournament field.",
                    "fingerprint": "march-2",
                    "quality_score": 0.82,
                    "like_count": 22,
                    "repost_count": 3,
                    "reply_count": 4,
                    "quote_count": 1,
                    "author_id": "march-b",
                    "event_timestamp": (now - timedelta(minutes=5)).isoformat(),
                },
            ],
            "chip export": [
                {
                    "raw_post_id": 3,
                    "source_post_id": "c1",
                    "platform": "bluesky",
                    "text_content": "Developers are reacting to new AI chip export restrictions and discussing the impact on model training capacity.",
                    "fingerprint": "chip-1",
                    "quality_score": 0.88,
                    "like_count": 25,
                    "repost_count": 4,
                    "reply_count": 3,
                    "quote_count": 2,
                    "author_id": "chip-a",
                    "event_timestamp": now.isoformat(),
                },
                {
                    "raw_post_id": 4,
                    "source_post_id": "c2",
                    "platform": "bluesky",
                    "text_content": "Industry posts compare export control fallout, hardware supply concerns, and developer responses around AI accelerators.",
                    "fingerprint": "chip-2",
                    "quality_score": 0.8,
                    "like_count": 18,
                    "repost_count": 2,
                    "reply_count": 2,
                    "quote_count": 0,
                    "author_id": "chip-b",
                    "event_timestamp": (now - timedelta(minutes=7)).isoformat(),
                },
            ],
        }
        return topics, candidate_rows

    def test_select_representative_posts_dedupes_near_identical_rows(self):
        now = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
        rows = [
            {
                "raw_post_id": 1,
                "source_post_id": "p1",
                "text_content": "Polymarket launches new sports contracts and users discuss liquidity shifts.",
                "fingerprint": "fp_a",
                "quality_score": 0.92,
                "like_count": 45,
                "repost_count": 10,
                "reply_count": 8,
                "quote_count": 3,
                "event_timestamp": now.isoformat(),
            },
            {
                "raw_post_id": 2,
                "source_post_id": "p2",
                "text_content": "Polymarket launches new sports contracts and users discuss liquidity shifts.",
                "fingerprint": "fp_a",
                "quality_score": 0.91,
                "like_count": 30,
                "repost_count": 7,
                "reply_count": 5,
                "quote_count": 1,
                "event_timestamp": (now - timedelta(minutes=5)).isoformat(),
            },
            {
                "raw_post_id": 3,
                "source_post_id": "p3",
                "text_content": "Kalshi and ICE strategy is being compared against Polymarket expansion plans.",
                "fingerprint": "fp_b",
                "quality_score": 0.88,
                "like_count": 25,
                "repost_count": 6,
                "reply_count": 4,
                "quote_count": 2,
                "event_timestamp": (now - timedelta(minutes=12)).isoformat(),
            },
            {
                "raw_post_id": 4,
                "source_post_id": "p4",
                "text_content": "Short",
                "fingerprint": "fp_c",
                "quality_score": 0.2,
                "like_count": 1,
                "repost_count": 0,
                "reply_count": 0,
                "quote_count": 0,
                "event_timestamp": (now - timedelta(minutes=1)).isoformat(),
            },
        ]

        selected, diagnostics = select_representative_posts(
            rows,
            limit=10,
            max_post_chars=220,
            min_text_chars=25,
            min_word_count=5,
        )

        selected_ids = {row.get("source_post_id") for row in selected}
        self.assertIn("p1", selected_ids)
        self.assertIn("p3", selected_ids)
        self.assertNotIn("p2", selected_ids)
        self.assertLessEqual(len(selected), 10)
        self.assertGreaterEqual(diagnostics.get("candidate_count", 0), 3)

    def test_input_hash_changes_when_sample_changes(self):
        topic = {
            "topic_key": "prediction market",
            "topic_label": "Prediction Market",
            "window_end": datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc).isoformat(),
            "total_mentions": 120,
            "unique_posts": 40,
            "unique_authors": 28,
        }
        base_posts = [
            {
                "candidate_id": "p1",
                "source_post_id": "p1",
                "truncated_text": "Polymarket and Kalshi competition discussion.",
                "engagement_score": 20.0,
                "event_dt": datetime(2026, 3, 31, 11, 55, tzinfo=timezone.utc),
                "quality_score": 0.8,
            }
        ]
        changed_posts = [
            {
                **base_posts[0],
                "truncated_text": "Polymarket and ICE infrastructure expansion discussion.",
            }
        ]

        hash_a = build_enrichment_input_hash(
            topic_row=topic,
            representative_posts=base_posts,
        )
        hash_b = build_enrichment_input_hash(
            topic_row=topic,
            representative_posts=changed_posts,
        )
        self.assertNotEqual(hash_a, hash_b)

    def test_input_hash_ignores_metric_and_timestamp_churn_when_evidence_text_is_unchanged(self):
        topic_a = {
            "topic_key": "prediction market",
            "topic_label": "Prediction Market",
            "window_end": datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc).isoformat(),
            "total_mentions": 120,
            "unique_posts": 40,
            "unique_authors": 28,
            "platform_count": 1,
        }
        topic_b = {
            **topic_a,
            "total_mentions": 166,
            "unique_posts": 54,
            "unique_authors": 39,
            "platform_count": 3,
        }
        base_posts = [
            {
                "candidate_id": "p1",
                "source_post_id": "p1",
                "platform": "bluesky",
                "truncated_text": "Polymarket and Kalshi competition discussion.",
                "engagement_score": 20.0,
                "event_dt": datetime(2026, 3, 31, 11, 55, tzinfo=timezone.utc),
                "quality_score": 0.8,
            }
        ]
        churned_posts = [
            {
                **base_posts[0],
                "engagement_score": 99.0,
                "event_dt": datetime(2026, 3, 31, 11, 59, tzinfo=timezone.utc),
                "quality_score": 0.99,
            }
        ]

        hash_a = build_enrichment_input_hash(
            topic_row=topic_a,
            representative_posts=base_posts,
        )
        hash_b = build_enrichment_input_hash(
            topic_row=topic_b,
            representative_posts=churned_posts,
        )
        self.assertEqual(hash_a, hash_b)

    def test_should_refresh_skips_when_hash_model_prompt_match_and_recent(self):
        now = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
        should_refresh, reason = _should_refresh_enrichment(
            existing_state={
                "input_hash": "abc",
                "prompt_version": "v1",
                "model_name": "gpt-5.4-mini",
                "refreshed_at": (now - timedelta(hours=1)).isoformat(),
                "expires_at": (now + timedelta(hours=3)).isoformat(),
            },
            input_hash="abc",
            model_name="gpt-5.4-mini",
            prompt_version="v1",
            stale_after_hours=6,
            hash_change_cooldown_hours=12,
            now=now,
        )
        self.assertFalse(should_refresh)
        self.assertEqual(reason, "unchanged")

    def test_should_refresh_enrichment_defers_hash_churn_during_cooldown(self):
        now = datetime(2026, 3, 31, 12, 0, tzinfo=timezone.utc)
        should_refresh, reason = _should_refresh_enrichment(
            existing_state={
                "input_hash": "abc",
                "prompt_version": "v1",
                "model_name": "gpt-5.4-mini",
                "refreshed_at": (now - timedelta(hours=2)).isoformat(),
                "expires_at": (now + timedelta(hours=10)).isoformat(),
            },
            input_hash="changed",
            model_name="gpt-5.4-mini",
            prompt_version="v1",
            stale_after_hours=24,
            hash_change_cooldown_hours=12,
            now=now,
        )
        self.assertFalse(should_refresh)
        self.assertEqual(reason, "input_hash_changed_during_cooldown")

    def test_should_refresh_visible_title_retries_non_authoritative_ready_rows(self):
        now = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
        should_refresh, reason = _should_refresh_visible_title(
            existing_state={
                "input_hash": "abc",
                "canonical_name": "Republican tax backlash",
                "name_status": "ready",
                "name_source": "historical_alias",
                "writer_identity": "legacy.topic_aggregator",
                "refreshed_at": (now - timedelta(minutes=10)).isoformat(),
                "expires_at": (now + timedelta(hours=6)).isoformat(),
            },
            input_hash="abc",
            stale_after_hours=24,
            retry_after_minutes=5,
            hash_change_cooldown_hours=12,
            now=now,
        )
        self.assertTrue(should_refresh)
        self.assertEqual(reason, "non_authoritative_existing_title")

    def test_should_refresh_visible_title_reuses_ready_title_during_hash_cooldown(self):
        now = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
        should_refresh, reason = _should_refresh_visible_title(
            existing_state={
                "input_hash": "abc",
                "canonical_name": "Trump tariff rhetoric",
                "name_status": "ready",
                "name_source": "ai_exact",
                "writer_identity": "backend.main:trend_title_generation",
                "refreshed_at": (now - timedelta(hours=2)).isoformat(),
                "expires_at": (now + timedelta(hours=24)).isoformat(),
            },
            input_hash="changed",
            stale_after_hours=168,
            retry_after_minutes=180,
            hash_change_cooldown_hours=12,
            now=now,
        )
        self.assertFalse(should_refresh)
        self.assertEqual(reason, "ready_title_reused_during_cooldown")

    def test_should_upsert_current_enrichment_row_skips_identical_paid_run(self):
        should_upsert, reason = _should_upsert_current_enrichment_row(
            existing_state={
                "canonical_name": "Trump tariff rhetoric",
                "fallback_label": "Tariffs",
                "name_status": "ready",
                "name_source": "ai_exact",
                "status": "ok",
                "input_hash": "abc",
                "prompt_version": "visible-title-v3",
                "model_name": "gpt-4.1-mini",
                "writer_identity": "backend.main:trend_title_generation",
            },
            payload={
                "canonical_name": "Trump tariff rhetoric",
                "fallback_label": "Tariffs",
                "name_status": "ready",
                "name_source": "ai_exact",
                "status": "ok",
                "input_hash": "abc",
                "prompt_version": "visible-title-v3",
                "model_name": "gpt-4.1-mini",
                "writer_identity": "backend.main:trend_title_generation",
                "usage_total_tokens": 151,
            },
        )
        self.assertFalse(should_upsert)
        self.assertEqual(reason, "identical_state_after_paid_run")

    def test_runtime_config_defaults_cover_top_250_titles(self):
        env_keys = [
            "OPENAI_API_KEY",
            "BLUESKY_TREND_TITLE_INTERVAL_SECONDS",
            "BLUESKY_TREND_TITLE_MAX_TOPICS",
            "BLUESKY_TREND_TITLE_MAX_TOPICS_PER_PASS",
            "BLUESKY_TREND_TITLE_POSTS_PER_TOPIC",
            "BLUESKY_TREND_TITLE_CANDIDATE_POST_LIMIT",
            "BLUESKY_TREND_TITLE_HASH_CHANGE_COOLDOWN_HOURS",
            "BLUESKY_TREND_TITLE_RETRY_AFTER_MINUTES",
            "BLUESKY_TREND_TITLE_PARALLELISM",
            "BLUESKY_TREND_TITLE_MAX_POST_CHARS",
            "BLUESKY_TREND_ENRICHMENT_ENABLED",
            "BLUESKY_TREND_ENRICHMENT_INTERVAL_SECONDS",
            "BLUESKY_TREND_ENRICHMENT_MAX_TOPICS_PER_PASS",
            "BLUESKY_TREND_ENRICHMENT_POSTS_PER_TOPIC",
            "BLUESKY_TREND_ENRICHMENT_CANDIDATE_POST_LIMIT",
            "BLUESKY_TREND_ENRICHMENT_HASH_CHANGE_COOLDOWN_HOURS",
        ]
        preserved = {key: os.environ.get(key) for key in env_keys}
        try:
            for key in env_keys:
                os.environ.pop(key, None)
            os.environ["OPENAI_API_KEY"] = "test-key"

            title_config = build_trend_title_generation_runtime_config_from_env()
            enrichment_config = build_trend_enrichment_runtime_config_from_env()
        finally:
            for key, value in preserved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        self.assertEqual(title_config.interval_seconds, 600.0)
        self.assertEqual(title_config.max_topics, 250)
        self.assertEqual(title_config.max_topics_per_pass, 250)
        self.assertEqual(title_config.representative_posts, 3)
        self.assertEqual(title_config.candidate_post_limit, 12)
        self.assertEqual(title_config.hash_change_cooldown_hours, 12.0)
        self.assertEqual(title_config.retry_after_minutes, 180.0)
        self.assertEqual(title_config.parallelism, 2)
        self.assertEqual(title_config.max_post_chars, 120)
        self.assertEqual(title_config.max_duration_seconds, 120.0)
        self.assertFalse(enrichment_config.enabled)
        self.assertEqual(enrichment_config.interval_seconds, 3600.0)
        self.assertEqual(enrichment_config.max_topics_per_pass, 4)
        self.assertEqual(enrichment_config.representative_posts, 4)
        self.assertEqual(enrichment_config.candidate_post_limit, 24)
        self.assertEqual(enrichment_config.hash_change_cooldown_hours, 24.0)

    def test_title_coverage_counts_non_authoritative_titles_as_unresolved(self):
        topics, candidate_rows = self._topic_rows()
        store = _FakeStore(topics=topics, candidate_rows_by_topic=candidate_rows)
        now = datetime(2026, 4, 7, 4, 0, tzinfo=timezone.utc)
        store.latest_state = {
            "march": {
                "topic_key": "march",
                "canonical_name": "March Madness bracket backlash",
                "name_status": "ready",
                "name_source": "ai_exact",
                "writer_identity": "legacy.topic_aggregator",
                "generated_at": now.isoformat(),
                "refreshed_at": now.isoformat(),
            },
            "chip export": {
                "topic_key": "chip export",
                "canonical_name": "Chip export control backlash",
                "name_status": "ready",
                "name_source": "ai_exact",
                "writer_identity": "backend.main:trend_title_generation",
                "generated_at": now.isoformat(),
                "refreshed_at": now.isoformat(),
            },
        }

        coverage = summarize_trend_title_coverage(store=store, topic_limit=250)

        self.assertEqual(coverage["topic_count"], 2)
        self.assertEqual(coverage["ready_count"], 2)
        self.assertEqual(coverage["authoritative_ready_count"], 1)
        self.assertEqual(coverage["non_authoritative_ready_count"], 1)
        self.assertEqual(coverage["missing_count"], 0)

    def test_validate_title_output_rejects_one_word_visible_titles(self):
        representative_posts = [
            {
                "candidate_id": "p1",
                "source_post_id": "p1",
                "text_content": "Posts discuss Republican tariff backlash and voter anger over the latest trade rhetoric.",
            },
            {
                "candidate_id": "p2",
                "source_post_id": "p2",
                "text_content": "Another post describes Republican tariff backlash and reactions from red-state voters.",
            },
        ]
        errors = _validate_title_output_against_evidence(
            model_output={
                "status": "ok",
                "canonical_name": "Republicans",
                "evidence_post_ids": ["p1", "p2"],
                "evidence_entities": ["Republicans"],
                "mixed_signals": [],
                "abstain_reason": None,
            },
            representative_posts=representative_posts,
        )
        self.assertIn("canonical_name_not_narrative_enough", errors)

    def test_run_cycle_repairs_missing_enrichment_schema_and_retries_write(self):
        topics, candidate_rows = self._topic_rows()
        store = _FakeStore(topics=[topics[0]], candidate_rows_by_topic=candidate_rows)
        store.upsert_failures = [
            RuntimeError("undefined column \"narrative_summary\" of relation \"topic_ai_enrichments\""),
        ]
        payload = {
            "status": "ok",
            "canonical_name": "March Madness Tournament Discussion",
            "summary": "Posts are discussing March Madness games, bracket picks, and live tournament reactions.",
            "why_attention": None,
            "evidence_post_ids": ["m1", "m2"],
            "evidence_entities": ["March Madness", "NCAA tournament"],
            "mixed_signals": [],
            "abstain_reason": None,
            "confidence": 0.82,
        }

        with patch(
            "backend.trend_enrichment._call_openai_for_enrichment",
            return_value=(payload, {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}, '{"status":"ok"}'),
        ):
            summary = run_trend_enrichment_cycle(
                store=store,
                logger=logging.getLogger("trend-enrichment-test"),
                config=self._build_runtime_config(),
                reason="unit_test",
            )

        self.assertEqual(summary["enriched_topics"], 1)
        self.assertEqual(summary["failed_topics"], 0)
        self.assertEqual(summary["db_failed_topics"], 0)
        self.assertEqual(store.ensure_calls, 2)
        self.assertEqual(len(store.upsert_calls), 2)
        self.assertEqual(len(store.insert_run_calls), 1)
        self.assertEqual(store.upsert_calls[-1]["status"], "ok")

    def test_run_cycle_continues_when_one_topic_openai_call_fails(self):
        topics, candidate_rows = self._topic_rows()
        store = _FakeStore(topics=topics, candidate_rows_by_topic=candidate_rows)
        success_payload = {
            "status": "ok",
            "canonical_name": "AI Chip Export Controls Debate",
            "summary": "Posts discuss AI chip export restrictions, supply concerns, and developer reaction.",
            "why_attention": None,
            "evidence_post_ids": ["c1", "c2"],
            "evidence_entities": ["AI chips", "export controls"],
            "mixed_signals": [],
            "abstain_reason": None,
            "confidence": 0.79,
        }

        with patch(
            "backend.trend_enrichment._call_openai_for_enrichment",
            side_effect=[
                OpenAIEnrichmentTransportError("OpenAI enrichment failed after retries: timeout"),
                (success_payload, {"prompt_tokens": 11, "completion_tokens": 6, "total_tokens": 17}, '{"status":"ok"}'),
            ],
        ):
            summary = run_trend_enrichment_cycle(
                store=store,
                logger=logging.getLogger("trend-enrichment-test"),
                config=self._build_runtime_config(),
                reason="unit_test",
            )

        self.assertEqual(summary["attempted_topics"], 2)
        self.assertEqual(summary["enriched_topics"], 1)
        self.assertEqual(summary["failed_topics"], 1)
        self.assertEqual(summary["openai_failed_topics"], 1)
        self.assertEqual(summary["db_failed_topics"], 0)
        self.assertEqual(len(store.upsert_calls), 1)
        self.assertEqual(len(store.insert_run_calls), 1)

    def test_run_cycle_gates_malformed_topic_fragment_without_openai(self):
        topics, candidate_rows = self._topic_rows()
        malformed_topic = {
            **topics[0],
            "topic_key": "rump",
            "topic_label": "Trump",
        }
        store = _FakeStore(topics=[malformed_topic], candidate_rows_by_topic={"rump": candidate_rows["march"]})

        with patch("backend.trend_enrichment._call_openai_for_enrichment") as mocked_openai:
            summary = run_trend_enrichment_cycle(
                store=store,
                logger=logging.getLogger("trend-enrichment-test"),
                config=self._build_runtime_config(),
                reason="unit_test",
            )

        mocked_openai.assert_not_called()
        self.assertEqual(summary["attempted_topics"], 0)
        self.assertEqual(summary["abstained_topics"], 1)
        self.assertEqual(summary["gated_topics"], 1)
        self.assertEqual(store.upsert_calls[-1]["status"], "junk")
        self.assertIn("suspicious_topic_key", store.upsert_calls[-1]["mixed_signals"])

    def test_run_cycle_abstains_on_low_author_cluster_without_openai(self):
        now = datetime(2026, 4, 1, 1, 0, tzinfo=timezone.utc)
        topic = {
            "topic_key": "thin signal",
            "topic_label": "Thin Signal",
            "platform_count": 1,
            "total_mentions": 6,
            "unique_posts": 4,
            "unique_authors": 2,
            "positive_count": 1,
            "neutral_count": 4,
            "negative_count": 1,
            "window_start": (now - timedelta(hours=24)).isoformat(),
            "window_end": now.isoformat(),
        }
        candidate_rows = {
            "thin signal": [
                {
                    "raw_post_id": 10,
                    "source_post_id": "t1",
                    "platform": "bluesky",
                    "author_id": "thin-a",
                    "text_content": "Thin signal post about a vague topic that never gains much support from the wider network.",
                    "fingerprint": "thin-1",
                    "quality_score": 0.8,
                    "like_count": 3,
                    "repost_count": 0,
                    "reply_count": 1,
                    "quote_count": 0,
                    "event_timestamp": now.isoformat(),
                },
                {
                    "raw_post_id": 11,
                    "source_post_id": "t2",
                    "platform": "bluesky",
                    "author_id": "thin-b",
                    "text_content": "Another sparse post on the same vague topic with limited concrete evidence or supporting context.",
                    "fingerprint": "thin-2",
                    "quality_score": 0.75,
                    "like_count": 2,
                    "repost_count": 0,
                    "reply_count": 0,
                    "quote_count": 0,
                    "event_timestamp": (now - timedelta(minutes=3)).isoformat(),
                },
            ],
        }
        store = _FakeStore(topics=[topic], candidate_rows_by_topic=candidate_rows)

        with patch("backend.trend_enrichment._call_openai_for_enrichment") as mocked_openai:
            summary = run_trend_enrichment_cycle(
                store=store,
                logger=logging.getLogger("trend-enrichment-test"),
                config=self._build_runtime_config(),
                reason="unit_test",
            )

        mocked_openai.assert_not_called()
        self.assertEqual(summary["abstained_topics"], 1)
        self.assertEqual(store.upsert_calls[-1]["status"], "insufficient_evidence")
        self.assertEqual(store.upsert_calls[-1]["abstain_reason"], "too few unique authors support the cluster; too few posts support the cluster")

    def test_run_cycle_rejects_unsupported_claims_with_safe_abstain(self):
        topics, candidate_rows = self._topic_rows()
        store = _FakeStore(topics=[topics[0]], candidate_rows_by_topic=candidate_rows)
        unsupported_payload = {
            "status": "ok",
            "canonical_name": "Federal Reserve Emergency Action",
            "summary": "Posts are reacting to a Federal Reserve emergency action and related intervention.",
            "why_attention": "Attention is rising because the Federal Reserve unexpectedly intervened.",
            "evidence_post_ids": ["m1", "m2"],
            "evidence_entities": ["Federal Reserve"],
            "mixed_signals": [],
            "abstain_reason": None,
            "confidence": 0.9,
        }

        with patch(
            "backend.trend_enrichment._call_openai_for_enrichment",
            return_value=(unsupported_payload, {"prompt_tokens": 9, "completion_tokens": 4, "total_tokens": 13}, '{"status":"ok"}'),
        ):
            summary = run_trend_enrichment_cycle(
                store=store,
                logger=logging.getLogger("trend-enrichment-test"),
                config=self._build_runtime_config(),
                reason="unit_test",
            )

        self.assertEqual(summary["validator_rejected_topics"], 1)
        self.assertEqual(summary["abstained_topics"], 1)
        self.assertEqual(store.upsert_calls[-1]["status"], "insufficient_evidence")
        self.assertIn("canonical_name_not_supported_by_evidence", store.upsert_calls[-1]["validator_errors"])
        self.assertEqual(store.upsert_calls[-1]["raw_response_text"], '{"status":"ok"}')

    def test_run_cycle_rewrites_compound_canonical_name_to_dominant_single_narrative(self):
        now = datetime(2026, 4, 1, 1, 0, tzinfo=timezone.utc)
        topic = {
            "topic_key": "builders",
            "topic_label": "Builders",
            "platform_count": 1,
            "total_mentions": 48,
            "unique_posts": 18,
            "unique_authors": 12,
            "positive_count": 14,
            "neutral_count": 26,
            "negative_count": 8,
            "window_start": (now - timedelta(hours=24)).isoformat(),
            "window_end": now.isoformat(),
        }
        candidate_rows = {
            "builders": [
                {
                    "raw_post_id": 20,
                    "source_post_id": "b1",
                    "platform": "bluesky",
                    "text_content": "Builders keep comparing AI tools for coding, research, and workflow automation.",
                    "fingerprint": "builders-1",
                    "quality_score": 0.9,
                    "like_count": 22,
                    "repost_count": 5,
                    "reply_count": 3,
                    "quote_count": 1,
                    "author_id": "builders-a",
                    "event_timestamp": now.isoformat(),
                },
                {
                    "raw_post_id": 21,
                    "source_post_id": "b2",
                    "platform": "bluesky",
                    "text_content": "Founders are testing AI tools for prototyping and shipping faster this week.",
                    "fingerprint": "builders-2",
                    "quality_score": 0.86,
                    "like_count": 18,
                    "repost_count": 3,
                    "reply_count": 2,
                    "quote_count": 1,
                    "author_id": "builders-b",
                    "event_timestamp": (now - timedelta(minutes=3)).isoformat(),
                },
                {
                    "raw_post_id": 22,
                    "source_post_id": "b3",
                    "platform": "bluesky",
                    "text_content": "A smaller thread is sharing startup advice about hiring and distribution.",
                    "fingerprint": "builders-3",
                    "quality_score": 0.74,
                    "like_count": 8,
                    "repost_count": 1,
                    "reply_count": 1,
                    "quote_count": 0,
                    "author_id": "builders-c",
                    "event_timestamp": (now - timedelta(minutes=7)).isoformat(),
                },
            ],
        }
        store = _FakeStore(topics=[topic], candidate_rows_by_topic=candidate_rows)
        compound_payload = {
            "status": "mixed",
            "canonical_name": "AI Tools / Startup Advice",
            "summary": "Posts focus on AI tools for coding, research, prototyping, and workflow automation.",
            "why_attention": None,
            "evidence_post_ids": ["b1", "b2", "b3"],
            "evidence_entities": ["AI Tools", "Startup Advice"],
            "mixed_signals": ["adjacent startup advice posts"],
            "abstain_reason": "evidence includes adjacent subthemes",
            "confidence": 0.74,
        }

        with patch(
            "backend.trend_enrichment._call_openai_for_enrichment",
            return_value=(compound_payload, {"prompt_tokens": 12, "completion_tokens": 7, "total_tokens": 19}, '{"status":"mixed"}'),
        ):
            summary = run_trend_enrichment_cycle(
                store=store,
                logger=logging.getLogger("trend-enrichment-test"),
                config=self._build_runtime_config(),
                reason="unit_test",
            )

        self.assertEqual(summary["mixed_topics"], 1)
        self.assertEqual(store.upsert_calls[-1]["canonical_name"], "AI Tools")
        self.assertIn("rewrote_compound_canonical_name", store.upsert_calls[-1]["mixed_signals"])

    def test_run_cycle_persists_safe_abstain_on_invalid_model_output(self):
        topics, candidate_rows = self._topic_rows()
        store = _FakeStore(topics=[topics[0]], candidate_rows_by_topic=candidate_rows)

        with patch(
            "backend.trend_enrichment._call_openai_for_enrichment",
            side_effect=OpenAIEnrichmentOutputError(
                "invalid_model_output",
                raw_response_text="{not valid json}",
            ),
        ):
            summary = run_trend_enrichment_cycle(
                store=store,
                logger=logging.getLogger("trend-enrichment-test"),
                config=self._build_runtime_config(),
                reason="unit_test",
            )

        self.assertEqual(summary["validator_rejected_topics"], 1)
        self.assertEqual(summary["abstained_topics"], 1)
        self.assertEqual(store.upsert_calls[-1]["status"], "insufficient_evidence")
        self.assertEqual(store.upsert_calls[-1]["raw_response_text"], "{not valid json}")
        self.assertTrue(store.upsert_calls[-1]["narrative_summary"])


if __name__ == "__main__":
    unittest.main()
