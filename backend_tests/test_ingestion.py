import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import backend.reddit_ingestion as ingestion
import backend.reddit_persistence as store


class IngestionTests(unittest.TestCase):
    def test_run_reddit_ingestion_returns_disabled_summary_when_flag_off(self):
        with (
            patch.object(ingestion, "REDDIT_ENABLED", False),
            patch.object(ingestion, "ensure_store_root"),
            patch.object(ingestion, "load_schedule", return_value={}),
            patch.object(ingestion, "sync_schedule_state", return_value={"subredditMetadata": {}}),
            patch.object(ingestion, "_load_ingestion_state", return_value=([], [], [], {})),
            patch.object(
                ingestion,
                "normalize_sources_for_hot_store",
                side_effect=lambda sources, schedule_metadata: sources,
            ),
            patch.object(
                ingestion,
                "recompute_source_storage_metrics",
                side_effect=lambda posts, comments, sources, tracked_subreddits: sources,
            ),
            patch.object(ingestion, "_persist_and_snapshot", return_value={"health": {}}),
        ):
            exit_code, summary = ingestion.run_reddit_ingestion("live")

        self.assertEqual(exit_code, 0)
        self.assertEqual(summary["status"], "disabled")
        self.assertEqual(summary["reason"], "REDDIT_ENABLED=0")
        self.assertEqual(summary["attempted"], 0)
        self.assertTrue(summary["auxiliaryRefreshSkipped"])

    def test_source_state_normalization_overwrites_stale_fetch_profile(self):
        normalized = store.normalize_sources_for_hot_store(
            {
                "example": {
                    "subreddit": "example",
                    "liveLimit": 12,
                    "liveListings": ["new", "hot"],
                }
            },
            schedule_metadata={
                "example": {
                    "subreddit": "example",
                    "tier": "tier2",
                    "fetchProfile": {
                        "liveCadenceWeight": 2,
                        "liveLimit": 100,
                        "liveListings": ["new"],
                        "liveMaxPages": 4,
                        "liveMaxPostsPerRun": 320,
                        "commentThreshold": 12,
                        "maxTrackedPosts": 14,
                        "maxCommentsPerPost": 28,
                        "knownPostsRefreshLimit": 8,
                        "activePostLookbackHours": 36,
                        "backfillMaxPosts": 1400,
                        "backfillMaxPages": 20,
                        "backfillMaxCommentThreads": 12,
                    },
                }
            },
        )

        self.assertEqual(normalized["example"]["liveLimit"], 100)
        self.assertEqual(normalized["example"]["liveListings"], ["new"])
        self.assertEqual(normalized["example"]["liveMaxPages"], 4)
        self.assertEqual(normalized["example"]["liveMaxPostsPerRun"], 320)
        self.assertEqual(normalized["example"]["sourceStateVersion"], 2)
        self.assertEqual(normalized["example"]["storeModel"], "reddit-hot-store-v2")

    def test_run_all_buckets_processes_every_configured_bucket_once(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            timestamp = datetime.now(timezone.utc)
            fetched_buckets: list[list[str]] = []

            original_store_paths = (
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
                store.BLUESKY_FIREHOSE_STATE_PATH,
            )
            original_ingestion_values = (
                ingestion.REDDIT_ENABLED,
                ingestion.DEFAULT_SUBREDDITS,
                ingestion.BUCKET_SIZE,
                ingestion.MAX_SUBREDDITS_PER_RUN,
                ingestion.SUBREDDIT_CATALOG,
                ingestion.SUBREDDIT_LOOKUP,
                ingestion.DASHBOARD_SNAPSHOT_PATH,
                ingestion.fetch_reddit_live_bucket,
                ingestion.refresh_public_source_items,
                ingestion.sync_bluesky_firehose,
                ingestion.refresh_bluesky_sources,
            )

            def fake_fetch_reddit_live_bucket(subreddits, **_kwargs):
                fetched_buckets.append(list(subreddits))
                posts = []
                comments = []
                source_updates = {}

                for index, subreddit in enumerate(subreddits):
                    post_id = f"{subreddit}-post"
                    comment_id = f"{subreddit}-comment"
                    created_utc = int(timestamp.timestamp()) - index
                    posts.append(
                        {
                            "id": post_id,
                            "subreddit": subreddit,
                            "title": f"{subreddit} title",
                            "selftext": "",
                            "author": f"{subreddit}-author",
                            "permalink": f"/r/{subreddit}/comments/{post_id}",
                            "created_utc": created_utc,
                            "score": 10,
                            "num_comments": 1,
                            "url": f"https://reddit.com/{post_id}",
                        }
                    )
                    comments.append(
                        {
                            "id": comment_id,
                            "post_id": post_id,
                            "parent_id": f"t3_{post_id}",
                            "subreddit": subreddit,
                            "author": f"{subreddit}-commenter",
                            "body": f"{subreddit} body",
                            "permalink": f"/r/{subreddit}/comments/{post_id}/_/{comment_id}",
                            "created_utc": created_utc,
                            "score": 1,
                        }
                    )
                    source_updates[subreddit.lower()] = {
                        "subreddit": subreddit,
                        "mode": "live",
                        "success": True,
                        "transport": "fake",
                        "postsFetched": 1,
                        "commentsFetched": 1,
                        "commentRefreshCount": 1,
                        "oldestPostCreatedUtc": created_utc,
                        "newestPostCreatedUtc": created_utc,
                    }

                return {
                    "mode": "live",
                    "fetchedAt": timestamp.isoformat(),
                    "status": "success",
                    "attemptedSubreddits": subreddits,
                    "succeededSubreddits": subreddits,
                    "failedSubreddits": [],
                    "subredditErrors": {},
                    "posts": posts,
                    "comments": comments,
                    "postsBySubreddit": {subreddit: 1 for subreddit in subreddits},
                    "commentsBySubreddit": {subreddit: 1 for subreddit in subreddits},
                    "sourceUpdates": source_updates,
                }

            def fake_sync_bluesky_firehose(**_kwargs):
                return {
                    "posts": [],
                    "snapshots": [],
                    "profiles": [],
                    "interactions": [],
                    "state": {},
                    "sourceUpdates": {},
                    "fetchedCount": 0,
                    "snapshotCount": 0,
                    "profileCount": 0,
                    "interactionCount": 0,
                    "timings": {"totalMs": 0.0, "perSourceMs": {}},
                }

            def fake_refresh_public_source_items(**_kwargs):
                return {
                    "items": [],
                    "youtubeComments": [],
                    "youtubeVideoSnapshots": [],
                    "youtubeChannels": [],
                    "sourceUpdates": {},
                    "fetchedCount": 0,
                    "storedCount": 0,
                    "successCount": 0,
                    "failureCount": 0,
                    "timings": {"totalMs": 0.0, "perSourceMs": {}},
                }

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
            store.BLUESKY_FIREHOSE_STATE_PATH = root / "bluesky_firehose_state.json"

            ingestion.DEFAULT_SUBREDDITS = ["alpha", "beta", "gamma", "delta"]
            ingestion.REDDIT_ENABLED = True
            ingestion.BUCKET_SIZE = 2
            ingestion.MAX_SUBREDDITS_PER_RUN = 2
            ingestion.SUBREDDIT_CATALOG = []
            ingestion.SUBREDDIT_LOOKUP = {}
            ingestion.DASHBOARD_SNAPSHOT_PATH = root / "dashboard_snapshot.json"
            ingestion.fetch_reddit_live_bucket = fake_fetch_reddit_live_bucket
            ingestion.refresh_public_source_items = fake_refresh_public_source_items
            ingestion.sync_bluesky_firehose = fake_sync_bluesky_firehose

            try:
                exit_code, summary = ingestion.run_reddit_ingestion("live", run_all_buckets=True)

                self.assertEqual(exit_code, 0)
                self.assertEqual(summary["status"], "success")
                self.assertEqual(summary["processedBuckets"], 2)
                self.assertEqual(summary["attempted"], 4)
                self.assertEqual(summary["succeeded"], 4)
                self.assertEqual(summary["failed"], 0)
                self.assertEqual(summary["currentBucketId"], "bucket-001")
                self.assertEqual(summary["blueskyPostsStored"], 0)
                self.assertEqual(summary["blueskySnapshotsStored"], 0)
                self.assertEqual(
                    fetched_buckets,
                    [["alpha", "beta"], ["gamma", "delta"]],
                )
                self.assertEqual(len(store.load_runs()), 2)
                self.assertEqual(len(store.load_sources()), 4)
                self.assertTrue((root / "dashboard_snapshot.json").exists())
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
                    store.BLUESKY_FIREHOSE_STATE_PATH,
                ) = original_store_paths
                (
                    ingestion.REDDIT_ENABLED,
                    ingestion.DEFAULT_SUBREDDITS,
                    ingestion.BUCKET_SIZE,
                    ingestion.MAX_SUBREDDITS_PER_RUN,
                    ingestion.SUBREDDIT_CATALOG,
                    ingestion.SUBREDDIT_LOOKUP,
                    ingestion.DASHBOARD_SNAPSHOT_PATH,
                    ingestion.fetch_reddit_live_bucket,
                    ingestion.refresh_public_source_items,
                    ingestion.sync_bluesky_firehose,
                    ingestion.refresh_bluesky_sources,
                ) = original_ingestion_values


if __name__ == "__main__":
    unittest.main()
