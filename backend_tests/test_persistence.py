import tempfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import backend.reddit_persistence as store


class PersistenceTests(unittest.TestCase):
    def test_upserts_posts_and_comments_by_id(self):
        posts = store.upsert_posts(
            [],
            [
                {
                    "id": "p1",
                    "createdUtc": 10,
                    "title": "first",
                    "fetchedAt": "2026-03-16T00:00:00+00:00",
                }
            ],
            run_id="run-1",
            bucket_id="bucket-001",
        )
        posts = store.upsert_posts(
            posts,
            [
                {
                    "id": "p1",
                    "createdUtc": 10,
                    "title": "updated",
                    "fetchedAt": "2026-03-16T01:00:00+00:00",
                }
            ],
            run_id="run-2",
            bucket_id="bucket-002",
        )

        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["title"], "updated")
        self.assertEqual(posts[0]["firstSeenAt"], "2026-03-16T00:00:00+00:00")
        self.assertEqual(posts[0]["lastRunId"], "run-2")

        comments = store.upsert_comments(
            [],
            [
                {
                    "id": "c1",
                    "createdUtc": 10,
                    "body": "first",
                    "fetchedAt": "2026-03-16T00:00:00+00:00",
                }
            ],
            run_id="run-1",
            bucket_id="bucket-001",
        )
        comments = store.upsert_comments(
            comments,
            [
                {
                    "id": "c1",
                    "createdUtc": 10,
                    "body": "updated",
                    "fetchedAt": "2026-03-16T01:00:00+00:00",
                }
            ],
            run_id="run-2",
            bucket_id="bucket-002",
        )

        self.assertEqual(len(comments), 1)
        self.assertEqual(comments[0]["body"], "updated")
        self.assertEqual(comments[0]["firstSeenAt"], "2026-03-16T00:00:00+00:00")

    def test_backfill_idempotency_does_not_duplicate_records(self):
        posts = store.upsert_posts(
            [],
            [
                {
                    "id": "p1",
                    "createdUtc": 10,
                    "title": "same",
                    "fetchedAt": "2026-03-16T00:00:00+00:00",
                }
            ],
            run_id="run-1",
            bucket_id="bucket-001",
        )
        posts = store.upsert_posts(
            posts,
            [
                {
                    "id": "p1",
                    "createdUtc": 10,
                    "title": "same",
                    "fetchedAt": "2026-03-16T02:00:00+00:00",
                }
            ],
            run_id="run-2",
            bucket_id="bucket-001",
        )

        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["lastRunId"], "run-2")

    def test_read_write_roundtrip_uses_local_store(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            original_paths = (
                store.STORE_ROOT,
                store.POSTS_PATH,
                store.COMMENTS_PATH,
                store.RUNS_PATH,
                store.SOURCES_PATH,
                store.SCHEDULE_PATH,
                store.BLUESKY_POSTS_PATH,
                store.BLUESKY_POST_SNAPSHOTS_PATH,
                store.BLUESKY_PROFILES_PATH,
                store.BLUESKY_INTERACTIONS_PATH,
            )
            store.STORE_ROOT = root
            store.POSTS_PATH = root / "posts.json"
            store.COMMENTS_PATH = root / "comments.json"
            store.RUNS_PATH = root / "runs.json"
            store.SOURCES_PATH = root / "sources.json"
            store.SCHEDULE_PATH = root / "schedule.json"
            store.BLUESKY_POSTS_PATH = root / "bluesky_posts.json"
            store.BLUESKY_POST_SNAPSHOTS_PATH = root / "bluesky_post_snapshots.json"
            store.BLUESKY_PROFILES_PATH = root / "bluesky_profiles.json"
            store.BLUESKY_INTERACTIONS_PATH = root / "bluesky_interactions.json"

            try:
                store.ensure_store_root()
                store.save_posts([{"id": "p1"}])
                store.save_comments([{"id": "c1"}])
                store.save_runs([{"runId": "run-1"}])
                store.save_sources({"test": {"subreddit": "test"}})
                store.save_schedule({"currentBucketId": "bucket-001"})
                store.save_bluesky_posts([{"id": "at://did:plc:1/app.bsky.feed.post/1"}])
                store.save_bluesky_post_snapshots([{"id": "snapshot-1"}])
                store.save_bluesky_profiles([{"did": "did:plc:1"}])
                store.save_bluesky_interactions([{"id": "repost:1"}])

                self.assertEqual(store.load_posts(), [{"id": "p1"}])
                self.assertEqual(store.load_comments(), [{"id": "c1"}])
                self.assertEqual(store.load_runs(), [{"runId": "run-1"}])
                self.assertEqual(store.load_sources()["test"]["subreddit"], "test")
                self.assertEqual(store.load_schedule()["currentBucketId"], "bucket-001")
                self.assertEqual(store.load_bluesky_posts()[0]["id"], "at://did:plc:1/app.bsky.feed.post/1")
                self.assertEqual(store.load_bluesky_post_snapshots()[0]["id"], "snapshot-1")
                self.assertEqual(store.load_bluesky_profiles()[0]["did"], "did:plc:1")
                self.assertEqual(store.load_bluesky_interactions()[0]["id"], "repost:1")
            finally:
                (
                    store.STORE_ROOT,
                    store.POSTS_PATH,
                    store.COMMENTS_PATH,
                    store.RUNS_PATH,
                    store.SOURCES_PATH,
                    store.SCHEDULE_PATH,
                    store.BLUESKY_POSTS_PATH,
                    store.BLUESKY_POST_SNAPSHOTS_PATH,
                    store.BLUESKY_PROFILES_PATH,
                    store.BLUESKY_INTERACTIONS_PATH,
                ) = original_paths

    def test_write_json_falls_back_when_atomic_replace_is_blocked_on_windows(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            target_path = root / "bluesky_firehose_state.json"
            original_path = store.BLUESKY_FIREHOSE_STATE_PATH
            store.BLUESKY_FIREHOSE_STATE_PATH = target_path

            try:
                with patch("backend.reddit_persistence.os.replace", side_effect=OSError(13, "Access is denied")):
                    store.save_bluesky_firehose_state({"status": "succeeded", "workerHeartbeatAt": "2026-03-24T00:00:00Z"})

                payload = target_path.read_text(encoding="utf-8")
                self.assertIn('"status": "succeeded"', payload)
                self.assertIn('"workerHeartbeatAt": "2026-03-24T00:00:00Z"', payload)
                self.assertFalse(any(root.glob("bluesky_firehose_state.json.*.tmp")))
            finally:
                store.BLUESKY_FIREHOSE_STATE_PATH = original_path


if __name__ == "__main__":
    unittest.main()
