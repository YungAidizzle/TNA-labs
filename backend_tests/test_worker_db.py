import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from psycopg import errors
from psycopg.pq import TransactionStatus

from backend.db import PostgresStore


SCHEMA_ROWS = [
    ("raw_posts", "id", "bigint", "int8"),
    ("raw_posts", "platform", "text", "text"),
    ("raw_posts", "source_post_id", "text", "text"),
    ("raw_posts", "post_id", "text", "text"),
    ("raw_posts", "author_id", "text", "text"),
    ("raw_posts", "author_handle", "text", "text"),
    ("raw_posts", "root_post_id", "text", "text"),
    ("raw_posts", "reply_parent_id", "text", "text"),
    ("raw_posts", "created_at", "timestamp with time zone", "timestamptz"),
    ("raw_posts", "ingested_at", "timestamp with time zone", "timestamptz"),
    ("raw_posts", "text_content", "text", "text"),
    ("raw_posts", "language", "text", "text"),
    ("raw_posts", "urls", "ARRAY", "_text"),
    ("raw_posts", "hashtags", "ARRAY", "_text"),
    ("raw_posts", "metrics_json", "jsonb", "jsonb"),
    ("raw_posts", "raw_json", "jsonb", "jsonb"),
    ("processed_posts", "raw_post_id", "bigint", "int8"),
    ("processed_posts", "platform", "text", "text"),
    ("processed_posts", "source_post_id", "text", "text"),
    ("processed_posts", "source_created_at", "timestamp with time zone", "timestamptz"),
    ("processed_posts", "created_at", "timestamp with time zone", "timestamptz"),
    ("processed_posts", "processed_at", "timestamp with time zone", "timestamptz"),
    ("processed_posts", "bucket_minute", "timestamp with time zone", "timestamptz"),
    ("processed_posts", "clean_text", "text", "text"),
    ("processed_posts", "normalized_text", "text", "text"),
    ("processed_posts", "language", "text", "text"),
    ("processed_posts", "quality_score", "double precision", "float8"),
    ("processed_posts", "topic_key_candidate", "text", "text"),
    ("processed_posts", "tokens", "ARRAY", "_text"),
    ("processed_posts", "hashtags", "ARRAY", "_text"),
    ("processed_posts", "mentions", "ARRAY", "_text"),
    ("processed_posts", "urls", "ARRAY", "_text"),
    ("processed_posts", "domains", "ARRAY", "_text"),
    ("processed_posts", "tags", "ARRAY", "_text"),
    ("processed_posts", "topic_entities", "ARRAY", "_text"),
    ("processed_posts", "sentiment_label", "text", "text"),
    ("processed_posts", "sentiment_positive_score", "integer", "int4"),
    ("processed_posts", "sentiment_negative_score", "integer", "int4"),
    ("processed_posts", "sentiment_neutral_score", "integer", "int4"),
    ("processed_posts", "cashtags", "ARRAY", "_text"),
    ("processed_posts", "key_phrases", "ARRAY", "_text"),
    ("processed_posts", "topic_seeds", "ARRAY", "_text"),
    ("processed_posts", "has_media", "boolean", "bool"),
    ("processed_posts", "is_reply", "boolean", "bool"),
    ("processed_posts", "is_repost", "boolean", "bool"),
    ("processed_posts", "is_quote", "boolean", "bool"),
    ("processed_posts", "author_hash", "text", "text"),
    ("processed_posts", "token_count", "integer", "int4"),
    ("processed_posts", "fingerprint", "text", "text"),
    ("processed_posts", "spam_score", "numeric", "numeric"),
    ("processed_posts", "topic", "text", "text"),
    ("processed_posts", "post_id", "text", "text"),
    ("processed_posts", "author_id", "text", "text"),
    ("post_topics", "id", "bigint", "int8"),
    ("post_topics", "raw_post_id", "bigint", "int8"),
    ("post_topics", "processed_post_id", "bigint", "int8"),
    ("post_topics", "platform", "text", "text"),
    ("post_topics", "source_post_id", "text", "text"),
    ("post_topics", "topic_text", "text", "text"),
    ("post_topics", "normalized_topic", "text", "text"),
    ("post_topics", "topic_type", "text", "text"),
    ("post_topics", "language", "text", "text"),
    ("post_topics", "source_created_at", "timestamp with time zone", "timestamptz"),
    ("post_topics", "bucket_minute", "timestamp with time zone", "timestamptz"),
    ("post_topics", "created_at", "timestamp with time zone", "timestamptz"),
    ("authors", "platform", "text", "text"),
    ("authors", "author_id", "text", "text"),
    ("authors", "author_handle", "text", "text"),
    ("authors", "display_name", "text", "text"),
    ("authors", "followers_count", "bigint", "int8"),
    ("authors", "metadata_json", "jsonb", "jsonb"),
    ("authors", "first_seen_at", "timestamp with time zone", "timestamptz"),
    ("authors", "last_seen_at", "timestamp with time zone", "timestamptz"),
    ("ingestion_runs", "source", "text", "text"),
    ("ingestion_runs", "started_at", "timestamp with time zone", "timestamptz"),
    ("ingestion_runs", "ended_at", "timestamp with time zone", "timestamptz"),
    ("ingestion_runs", "status", "text", "text"),
    ("ingestion_runs", "rows_inserted", "bigint", "int8"),
    ("ingestion_runs", "last_heartbeat_at", "timestamp with time zone", "timestamptz"),
    ("ingestion_runs", "current_stage", "text", "text"),
    ("ingestion_runs", "rows_written_this_cycle", "bigint", "int8"),
    ("ingestion_runs", "last_successful_write_at", "timestamp with time zone", "timestamptz"),
    ("ingestion_runs", "notes", "jsonb", "jsonb"),
]


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rowcount = 0
        self._fetchall = []
        self._fetchone = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        self.connection.execute_calls.append((query, params))
        self.connection.info.transaction_status = TransactionStatus.INTRANS
        normalized = " ".join(str(query).split()).lower()
        if "from information_schema.columns" in normalized:
            self._fetchall = list(SCHEMA_ROWS)
            self._fetchone = None
            self.rowcount = len(self._fetchall)
            return
        if "select to_regclass('cron.job')" in normalized:
            self._fetchone = ("cron.job",)
            self._fetchall = []
            self.rowcount = 1
            return
        if "select jobid from cron.job" in normalized:
            self._fetchall = [(11,), (12,)]
            self._fetchone = None
            self.rowcount = len(self._fetchall)
            return
        if "select cron.unschedule" in normalized:
            self._fetchone = (True,)
            self._fetchall = []
            self.rowcount = 1
            return
        if "select 1" in normalized:
            self._fetchone = (1,)
            self._fetchall = []
            self.rowcount = 1
            return
        if "select notes" in normalized and "from public.ingestion_runs" in normalized:
            self._fetchone = (json.dumps({"last_cursor_us": 987654321}),)
            self._fetchall = []
            self.rowcount = 1
            return
        if "insert into public.raw_posts" in normalized and "returning" in normalized:
            self._fetchone = (
                42,
                "bluesky",
                "at://did:plc:abc/app.bsky.feed.post/xyz",
                "at://did:plc:abc/app.bsky.feed.post/xyz",
                "did:plc:abc",
                "test.bsky.social",
                None,
                None,
                datetime(2026, 3, 25, tzinfo=timezone.utc),
                datetime(2026, 3, 25, tzinfo=timezone.utc),
                datetime(2026, 3, 25, tzinfo=timezone.utc),
                "test",
                "test",
                "en",
                ["https://example.com"],
                ["ai"],
                None,
                None,
                {"likeCount": 1},
                {"id": "at://did:plc:abc/app.bsky.feed.post/xyz"},
            )
            self._fetchall = []
            self.rowcount = 1
            return
        if "from public.raw_posts" in normalized and "source_post_id = any" in normalized:
            self._fetchall = [
                (
                    42,
                    "bluesky",
                    "at://did:plc:abc/app.bsky.feed.post/xyz",
                    "at://did:plc:abc/app.bsky.feed.post/xyz",
                    "did:plc:abc",
                    "test.bsky.social",
                    None,
                    None,
                    datetime(2026, 3, 25, tzinfo=timezone.utc),
                    datetime(2026, 3, 25, tzinfo=timezone.utc),
                    datetime(2026, 3, 25, tzinfo=timezone.utc),
                    "test",
                    "test",
                    "en",
                    ["https://example.com"],
                    ["ai"],
                    None,
                    None,
                    {"likeCount": 1},
                    {"id": "at://did:plc:abc/app.bsky.feed.post/xyz"},
                    False,
                )
            ]
            self._fetchone = None
            self.rowcount = len(self._fetchall)
            return
        if "from public.raw_posts" in normalized and "coalesce(processed, false) = false" in normalized and "count(*)" in normalized:
            self._fetchone = (7,)
            self._fetchall = []
            self.rowcount = 1
            return
        if "from public.raw_posts" in normalized and "coalesce(processed, false) = false" in normalized and "limit %s" in normalized:
            self._fetchall = [
                (
                    42,
                    "bluesky",
                    "at://did:plc:abc/app.bsky.feed.post/xyz",
                    "at://did:plc:abc/app.bsky.feed.post/xyz",
                    "did:plc:abc",
                    "test.bsky.social",
                    None,
                    None,
                    datetime(2026, 3, 25, tzinfo=timezone.utc),
                    datetime(2026, 3, 25, tzinfo=timezone.utc),
                    datetime(2026, 3, 25, tzinfo=timezone.utc),
                    "test",
                    "test",
                    "en",
                    ["https://example.com"],
                    ["ai"],
                    None,
                    None,
                    {"likeCount": 1},
                    {"id": "at://did:plc:abc/app.bsky.feed.post/xyz"},
                    False,
                )
            ]
            self._fetchone = None
            self.rowcount = len(self._fetchall)
            return
        if "with deleted as" in normalized and "delete from public.raw_posts" in normalized:
            self._fetchone = (5,)
            self._fetchall = []
            self.rowcount = 5
            return
        if "insert into public.processed_posts" in normalized and "returning id, raw_post_id, processed_at" in normalized:
            self._fetchone = (
                501,
                42,
                datetime(2026, 3, 25, 10, 0, tzinfo=timezone.utc),
            )
            self._fetchall = []
            self.rowcount = 1
            return
        if "from public.processed_posts" in normalized and "where raw_post_id = any" in normalized:
            self._fetchall = [
                (
                    501,
                    42,
                    "at://did:plc:abc/app.bsky.feed.post/xyz",
                    "bluesky",
                    datetime(2026, 3, 25, 10, 0, tzinfo=timezone.utc),
                    ["AI"],
                    "en",
                    datetime(2026, 3, 25, 9, 30, tzinfo=timezone.utc),
                    datetime(2026, 3, 25, 9, 30, tzinfo=timezone.utc),
                )
            ]
            self._fetchone = None
            self.rowcount = len(self._fetchall)
            return
        self.rowcount = 1
        self._fetchall = []
        self._fetchone = None

    def executemany(self, query, params_seq):
        payload = list(params_seq)
        self.connection.executemany_calls.append((query, payload))
        self.connection.info.transaction_status = TransactionStatus.INTRANS
        self.rowcount = len(payload)
        self._fetchall = []
        self._fetchone = None

    def fetchall(self):
        return list(self._fetchall)

    def fetchone(self):
        return self._fetchone


class FakeConnection:
    def __init__(self):
        self.closed = False
        self.autocommit = False
        self.info = type("FakeInfo", (), {"transaction_status": TransactionStatus.IDLE})()
        self.execute_calls = []
        self.executemany_calls = []
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1
        self.info.transaction_status = TransactionStatus.IDLE

    def rollback(self):
        self.rollbacks += 1
        self.info.transaction_status = TransactionStatus.IDLE

    def close(self):
        self.closed = True


class WorkerDbTests(unittest.TestCase):
    def test_prepare_topic_ai_enrichment_row_promotes_authoritative_canonical_name(self):
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        payload = store._prepare_topic_ai_enrichment_row(
            {
                "topic_key": "mahmouds",
                "raw_label": "Mahmouds",
                "canonical_name": "Mahmouds Treasury Rumor",
                "fallback_label": "",
                "status": "ok",
                "name_status": "pending",
                "name_source": "none",
                "writer_identity": "backend.main:trend_title_generation",
                "writer_role": "authoritative_title_worker",
                "metadata_json": {},
            }
        )

        self.assertEqual(payload["canonical_name"], "Mahmouds Treasury Rumor")
        self.assertEqual(payload["fallback_label"], "Mahmouds")
        self.assertEqual(payload["name_status"], "ready")
        self.assertEqual(payload["name_source"], "ai_exact")

    def test_prepare_topic_ai_enrichment_row_marks_foreign_writer_promotions_as_historical(self):
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        payload = store._prepare_topic_ai_enrichment_row(
            {
                "topic_key": "mahmouds",
                "raw_label": "Mahmouds",
                "canonical_name": "Mahmouds Treasury Rumor",
                "fallback_label": "",
                "status": "ok",
                "name_status": "pending",
                "name_source": "none",
                "writer_identity": "legacy.topic_aggregator",
                "writer_role": "legacy_worker",
                "metadata_json": {},
            }
        )

        self.assertEqual(payload["canonical_name"], "Mahmouds Treasury Rumor")
        self.assertEqual(payload["name_status"], "ready")
        self.assertEqual(payload["name_source"], "historical_alias")

    def test_prepare_topic_ai_enrichment_row_keeps_fallback_when_runtime_failure_signals_exist(self):
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        payload = store._prepare_topic_ai_enrichment_row(
            {
                "topic_key": "twitter",
                "raw_label": "Twitter",
                "canonical_name": "Mixed Discussion Cluster",
                "fallback_label": "",
                "status": "ok",
                "name_status": "pending",
                "name_source": "none",
                "narrative_summary": "Trusted naming is queued. Using the cleaned fallback label for now.",
                "mixed_signals": ["visible_runtime_openai_failure"],
                "writer_identity": "legacy.topic_aggregator",
                "writer_role": "legacy_worker",
                "metadata_json": {"used_fallback": True},
            }
        )

        self.assertIsNone(payload["canonical_name"])
        self.assertEqual(payload["fallback_label"], "Twitter")
        self.assertEqual(payload["name_status"], "pending")
        self.assertEqual(payload["name_source"], "fallback_cleaned")

    def test_prepare_topic_ai_enrichment_row_rejects_one_word_canonical_titles(self):
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        payload = store._prepare_topic_ai_enrichment_row(
            {
                "topic_key": "republicans",
                "raw_label": "Republicans",
                "canonical_name": "Republicans",
                "fallback_label": "",
                "status": "ok",
                "name_status": "pending",
                "name_source": "none",
                "writer_identity": "backend.main:trend_title_generation",
                "writer_role": "authoritative_title_worker",
                "metadata_json": {},
            }
        )

        self.assertIsNone(payload["canonical_name"])
        self.assertEqual(payload["fallback_label"], "Republicans")
        self.assertEqual(payload["name_status"], "pending")
        self.assertEqual(payload["name_source"], "fallback_cleaned")

    def test_prepare_topic_ai_enrichment_row_repairs_fragmentary_fallback_labels(self):
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        payload = store._prepare_topic_ai_enrichment_row(
            {
                "topic_key": "mahmouds",
                "raw_label": "Mahmouds",
                "canonical_name": "",
                "fallback_label": "Ahmouds",
                "status": "mixed",
                "name_status": "pending",
                "name_source": "fallback_cleaned",
                "writer_identity": "legacy.topic_aggregator",
                "writer_role": "legacy_worker",
                "metadata_json": {},
            }
        )

        self.assertEqual(payload["fallback_label"], "Mahmouds")

    def test_prepare_topic_ai_enrichment_row_rejects_missing_writer_role(self):
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        with self.assertRaisesRegex(ValueError, "writer_role is required"):
            store._prepare_topic_ai_enrichment_row(
                {
                    "topic_key": "mahmouds",
                    "raw_label": "Mahmouds",
                    "canonical_name": "Mahmouds Treasury Rumor",
                    "status": "ok",
                    "name_status": "pending",
                    "name_source": "none",
                    "writer_identity": "backend.main:trend_title_generation",
                    "metadata_json": {},
                }
            )

    def test_prepare_topic_ai_enrichment_row_flattens_usage_and_writer_metadata(self):
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        payload = store._prepare_topic_ai_enrichment_row(
            {
                "topic_key": "tariffs",
                "raw_label": "Tariffs",
                "canonical_name": "Trump tariff rhetoric",
                "status": "ok",
                "name_status": "ready",
                "name_source": "ai_exact",
                "writer_identity": "backend.main:trend_title_generation",
                "writer_role": "authoritative_title_worker",
                "deployment_id": "railway-prod",
                "instance_id": "replica-1",
                "code_version": "abcdef1",
                "refresh_reason": "manual_targeted",
                "usage_prompt_tokens": 120,
                "usage_completion_tokens": 18,
                "usage_total_tokens": 138,
                "duration_ms": 412.5,
                "replaced_existing_title": True,
                "metadata_json": {},
            }
        )

        self.assertEqual(payload["writer_identity"], "backend.main:trend_title_generation")
        self.assertEqual(payload["writer_role"], "authoritative_title_worker")
        self.assertTrue(payload["authoritative_writer"])
        self.assertEqual(payload["deployment_id"], "railway-prod")
        self.assertEqual(payload["instance_id"], "replica-1")
        self.assertEqual(payload["code_version"], "abcdef1")
        self.assertEqual(payload["refresh_reason"], "manual_targeted")
        self.assertEqual(payload["usage_prompt_tokens"], 120)
        self.assertEqual(payload["usage_completion_tokens"], 18)
        self.assertEqual(payload["usage_total_tokens"], 138)
        self.assertEqual(payload["duration_ms"], 412.5)
        self.assertTrue(payload["replaced_existing_title"])

    @patch("backend.db.psycopg.connect")
    def test_verify_connection_executes_select_one(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        store.verify_connection()

        self.assertTrue(
            any("SELECT 1" in str(query) for query, _params in fake_connection.execute_calls)
        )
        self.assertGreaterEqual(fake_connection.commits, 1)

    @patch("backend.db.psycopg.connect")
    def test_disable_legacy_topic_bucket_refresh_jobs_unschedules_pg_cron_jobs(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        disabled = store.disable_legacy_topic_bucket_refresh_jobs()

        self.assertEqual(disabled, 2)
        queries = [str(query) for query, _params in fake_connection.execute_calls]
        self.assertTrue(any("to_regclass('cron.job')" in query for query in queries))
        self.assertTrue(any("FROM cron.job" in query for query in queries))
        self.assertTrue(any("SELECT cron.unschedule" in query for query in queries))

    @patch("backend.db.psycopg.connect")
    def test_fetch_resume_cursor_reads_notes_json(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        cursor = store.fetch_resume_cursor(source="bluesky_firehose_worker")

        self.assertEqual(cursor, 987654321)
        self.assertGreaterEqual(fake_connection.commits, 1)

    @patch("backend.db.psycopg.connect")
    def test_connect_skips_core_schema_sync_when_lock_timeout_occurs(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        with (
            patch.object(
                store,
                "_ensure_core_tables",
                side_effect=errors.LockNotAvailable("canceling statement due to lock timeout"),
            ),
            patch.object(store, "_load_column_metadata") as load_metadata_mock,
            patch.object(store, "_verify_required_schema") as verify_schema_mock,
        ):
            store.connect()

        self.assertEqual(fake_connection.rollbacks, 1)
        load_metadata_mock.assert_called_once()
        verify_schema_mock.assert_called_once()

    @patch("backend.db.psycopg.connect")
    def test_upsert_raw_posts_uses_conflict_protection(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        inserted = store.upsert_raw_posts(
            [
                {
                    "platform": "bluesky",
                    "post_id": "at://did:plc:abc/app.bsky.feed.post/xyz",
                    "author_id": "did:plc:abc",
                    "author_handle": "test.bsky.social",
                    "root_post_id": None,
                    "reply_parent_id": None,
                    "created_at": datetime(2026, 3, 25, tzinfo=timezone.utc),
                    "ingested_at": datetime(2026, 3, 25, tzinfo=timezone.utc),
                    "text_content": "test",
                    "language": "en",
                    "urls": ["https://example.com"],
                    "hashtags": ["ai"],
                    "metrics_json": {"likeCount": 1},
                    "raw_json": {"id": "at://did:plc:abc/app.bsky.feed.post/xyz"},
                }
            ]
        )

        self.assertEqual(inserted, 1)
        self.assertEqual(len(fake_connection.executemany_calls), 1)
        query, _payload = fake_connection.executemany_calls[0]
        self.assertIn("INSERT INTO public.raw_posts", query)
        self.assertIn("ON CONFLICT (platform, source_post_id) DO UPDATE", query)

    @patch("backend.db.psycopg.connect")
    def test_upsert_authors_uses_conflict_upsert(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        affected = store.upsert_authors(
            [
                {
                    "platform": "bluesky",
                    "author_id": "did:plc:abc",
                    "author_handle": "test.bsky.social",
                    "display_name": "Test User",
                    "followers_count": 10,
                    "metadata_json": {"did": "did:plc:abc"},
                    "first_seen_at": datetime(2026, 3, 25, tzinfo=timezone.utc),
                    "last_seen_at": datetime(2026, 3, 25, tzinfo=timezone.utc),
                }
            ]
        )

        self.assertEqual(affected, 1)
        self.assertEqual(len(fake_connection.executemany_calls), 1)
        query, _payload = fake_connection.executemany_calls[0]
        self.assertIn("INSERT INTO public.authors", query)
        self.assertIn("ON CONFLICT (platform, author_id) DO UPDATE", query)

    @patch("backend.db.psycopg.connect")
    def test_ingest_raw_post_returns_raw_post_id(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        ingested = store.ingest_raw_post(
            {
                "platform": "bluesky",
                "source_post_id": "at://did:plc:abc/app.bsky.feed.post/xyz",
                "post_id": "at://did:plc:abc/app.bsky.feed.post/xyz",
                "author_id": "did:plc:abc",
                "author_handle": "test.bsky.social",
                "created_at": datetime(2026, 3, 25, tzinfo=timezone.utc),
                "ingested_at": datetime(2026, 3, 25, tzinfo=timezone.utc),
                "text_content": "test",
                "language": "en",
                "urls": ["https://example.com"],
                "hashtags": ["ai"],
                "metrics_json": {"likeCount": 1},
                "raw_json": {"id": "at://did:plc:abc/app.bsky.feed.post/xyz"},
            }
        )

        self.assertIsNotNone(ingested)
        if ingested is None:
            return
        self.assertEqual(ingested["id"], 42)
        queries = [str(query) for query, _params in fake_connection.execute_calls]
        ingest_query = next(query for query in queries if "INSERT INTO public.raw_posts" in query and "RETURNING" in query)
        self.assertIn("ON CONFLICT (platform, source_post_id) DO UPDATE", ingest_query)

    @patch("backend.db.psycopg.connect")
    def test_fetch_raw_posts_by_source_ids_returns_decoded_rows(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        rows = store.fetch_raw_posts_by_source_ids(
            platform="bluesky",
            source_post_ids=["at://did:plc:abc/app.bsky.feed.post/xyz"],
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], 42)
        self.assertEqual(rows[0]["processed"], False)

    @patch("backend.db.psycopg.connect")
    def test_count_unprocessed_raw_posts_counts_false_processed_rows(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        count = store.count_unprocessed_raw_posts()

        self.assertEqual(count, 7)

    @patch("backend.db.psycopg.connect")
    def test_upsert_processed_post_uses_raw_post_id_conflict(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        affected = store.upsert_processed_post(
            {
                "raw_post_id": 42,
                "platform": "bluesky",
                "source_post_id": "at://did:plc:abc/app.bsky.feed.post/xyz",
                "post_id": "at://did:plc:abc/app.bsky.feed.post/xyz",
                "author_id": "did:plc:abc",
                "source_created_at": datetime(2026, 3, 25, 9, 30, tzinfo=timezone.utc),
                "created_at": datetime(2026, 3, 25, 9, 30, tzinfo=timezone.utc),
                "processed_at": datetime(2026, 3, 25, 10, 0, tzinfo=timezone.utc),
                "bucket_minute": datetime(2026, 3, 25, 9, 30, tzinfo=timezone.utc),
                "clean_text": "test",
                "normalized_text": "test",
                "language": "en",
                "quality_score": 0.9,
                "topic_key_candidate": "ai",
                "tokens": ["test", "ai"],
                "hashtags": ["ai"],
                "mentions": ["alice"],
                "urls": ["https://example.com"],
                "domains": ["example.com"],
                "tags": ["general"],
                "topic_entities": ["AI", "Bluesky"],
                "sentiment_label": "positive",
                "sentiment_positive_score": 2,
                "sentiment_negative_score": 0,
                "sentiment_neutral_score": 1,
                "topic": "ai",
            }
        )

        self.assertEqual(affected, 1)
        queries = [str(query) for query, _params in fake_connection.execute_calls]
        processed_query = next(query for query in queries if "INSERT INTO public.processed_posts" in query)
        self.assertIn("ON CONFLICT (raw_post_id) DO UPDATE", processed_query)
        self.assertTrue(any("UPDATE public.raw_posts" in query for query in queries))

    @patch("backend.db.psycopg.connect")
    def test_upsert_processed_posts_batches_and_fetches_summaries(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        rows = store.upsert_processed_posts(
            [
                {
                    "raw_post_id": 42,
                    "platform": "bluesky",
                    "source_post_id": "at://did:plc:abc/app.bsky.feed.post/xyz",
                    "post_id": "at://did:plc:abc/app.bsky.feed.post/xyz",
                    "author_id": "did:plc:abc",
                    "source_created_at": datetime(2026, 3, 25, 9, 30, tzinfo=timezone.utc),
                    "created_at": datetime(2026, 3, 25, 9, 30, tzinfo=timezone.utc),
                    "processed_at": datetime(2026, 3, 25, 10, 0, tzinfo=timezone.utc),
                    "bucket_minute": datetime(2026, 3, 25, 9, 30, tzinfo=timezone.utc),
                    "clean_text": "test",
                    "normalized_text": "test",
                    "language": "en",
                    "quality_score": 0.9,
                    "topic_key_candidate": "ai",
                    "tokens": ["test", "ai"],
                    "hashtags": ["ai"],
                    "mentions": ["alice"],
                    "urls": ["https://example.com"],
                    "domains": ["example.com"],
                    "tags": ["general"],
                    "topic_entities": ["AI"],
                    "topic_records": [
                        {
                            "topic_text": "AI",
                            "normalized_topic": "AI",
                            "topic_type": "entity",
                        }
                    ],
                    "sentiment_label": "positive",
                    "sentiment_positive_score": 2,
                    "sentiment_negative_score": 0,
                    "sentiment_neutral_score": 1,
                    "topic": "ai",
                }
            ]
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["raw_post_id"], 42)
        self.assertEqual(rows[0]["topic_records"][0]["normalized_topic"], "AI")

    @patch("backend.db.psycopg.connect")
    def test_persist_post_topics_upserts_by_raw_topic_type(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        affected = store.persist_post_topics(
            [
                {
                    "raw_post_id": 42,
                    "processed_post_id": 501,
                    "platform": "bluesky",
                    "source_post_id": "at://did:plc:abc/app.bsky.feed.post/xyz",
                    "topic_text": "Polymarket",
                    "normalized_topic": "Polymarket",
                    "topic_type": "entity",
                    "language": "en",
                    "source_created_at": datetime(2026, 3, 25, 9, 30, tzinfo=timezone.utc),
                    "bucket_minute": datetime(2026, 3, 25, 9, 30, tzinfo=timezone.utc),
                    "created_at": datetime(2026, 3, 25, 10, 0, tzinfo=timezone.utc),
                }
            ]
        )

        self.assertEqual(affected, 1)
        self.assertEqual(len(fake_connection.executemany_calls), 1)
        query, _payload = fake_connection.executemany_calls[0]
        self.assertIn("INSERT INTO public.post_topics", query)
        self.assertIn("ON CONFLICT (raw_post_id, normalized_topic, topic_type) DO UPDATE", query)

    @patch("backend.db.psycopg.connect")
    def test_prune_raw_posts_deletes_rows_older_than_retention(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        deleted = store.prune_raw_posts_older_than(hours=1.0)

        self.assertEqual(deleted, 5)
        queries = [str(query) for query, _params in fake_connection.execute_calls]
        prune_query = next(query for query in queries if "DELETE FROM public.raw_posts" in query)
        self.assertIn("COALESCE(ingested_at, inserted_at, created_at, now())", prune_query)

    @patch("backend.db.psycopg.connect")
    def test_ensure_metric_bucket_tables_creates_required_tables(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        store.ensure_metric_bucket_tables()

        queries = [str(query) for query, _params in fake_connection.execute_calls]
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS public.metric_buckets_1m" in query for query in queries))
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS public.metric_buckets_1h" in query for query in queries))

    @patch("backend.db.psycopg.connect")
    def test_aggregate_metric_buckets_1m_uses_upsert(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        affected = store.aggregate_metric_buckets_1m()

        self.assertGreaterEqual(affected, 1)
        queries = [str(query) for query, _params in fake_connection.execute_calls]
        aggregate_query = next(query for query in queries if "INSERT INTO public.metric_buckets_1m" in query)
        self.assertIn("date_trunc('minute', created_at)", aggregate_query)
        self.assertIn("FROM public.raw_posts", aggregate_query)
        self.assertIn("ON CONFLICT (bucket_minute, platform) DO UPDATE", aggregate_query)

    @patch("backend.db.psycopg.connect")
    def test_aggregate_metric_buckets_1h_uses_upsert(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        affected = store.aggregate_metric_buckets_1h()

        self.assertGreaterEqual(affected, 1)
        queries = [str(query) for query, _params in fake_connection.execute_calls]
        aggregate_query = next(query for query in queries if "INSERT INTO public.metric_buckets_1h" in query)
        self.assertIn("date_trunc('hour', created_at)", aggregate_query)
        self.assertIn("FROM public.raw_posts", aggregate_query)
        self.assertIn("ON CONFLICT (bucket_start, platform) DO UPDATE", aggregate_query)

    @patch("backend.db.psycopg.connect")
    def test_refresh_processed_posts_reads_public_raw_posts(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        affected = store.refresh_processed_posts_from_raw_posts()

        self.assertGreaterEqual(affected, 1)
        queries = [str(query) for query, _params in fake_connection.execute_calls]
        refresh_query = next(query for query in queries if "INSERT INTO public.processed_posts" in query)
        self.assertIn("FROM public.raw_posts", refresh_query)
        self.assertTrue(any("TRUNCATE TABLE public.processed_posts" in query for query in queries))

    @patch("backend.db.psycopg.connect")
    def test_aggregate_topic_buckets_1m_reads_processed_posts(self, connect_mock):
        fake_connection = FakeConnection()
        connect_mock.return_value = fake_connection
        store = PostgresStore(
            database_url="postgresql://example",
            batch_size=50,
        )

        affected = store.aggregate_topic_buckets_1m_from_processed_posts()

        self.assertGreaterEqual(affected, 1)
        queries = [str(query) for query, _params in fake_connection.execute_calls]
        aggregate_query = next(query for query in queries if "INSERT INTO public.topic_buckets_1m" in query)
        self.assertIn("FROM public.post_topics", aggregate_query)
        self.assertIn("FROM public.processed_posts", aggregate_query)
        self.assertIn("('bluesky')", aggregate_query)
        self.assertIn("('thank')", aggregate_query)
        self.assertIn("('social')", aggregate_query)
        self.assertIn("aggregation_bounds", aggregate_query)
        self.assertIn("ON CONFLICT (bucket_minute, platform, topic_key) DO UPDATE", aggregate_query)
        self.assertNotIn("array_length(string_to_array(normalized_topic, ' '), 1) = 2", aggregate_query)
        self.assertNotIn("array_length(string_to_array(aggregated.normalized_topic, ' '), 1) = 2", aggregate_query)
        self.assertIn("pt.bucket_minute", aggregate_query)
        self.assertIn("pp.bucket_minute", aggregate_query)
        self.assertIn("pp.source_created_at", aggregate_query)
        self.assertIn("pp.created_at", aggregate_query)
        self.assertIn("pp.processed_at", aggregate_query)
        self.assertTrue(
            aggregate_query.index("pt.bucket_minute")
            < aggregate_query.index("pp.processed_at"),
            "bucket/source timestamps should be prioritized before processed_at for timeline correctness",
        )
        self.assertTrue(any("DELETE FROM public.topic_buckets_1m" in query for query in queries))


if __name__ == "__main__":
    unittest.main()
