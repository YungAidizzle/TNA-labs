import unittest
from datetime import datetime, timedelta, timezone

from backend.reddit_snapshot import build_dashboard_snapshot


class SnapshotTests(unittest.TestCase):
    def test_marks_failed_latest_run_as_degraded_when_persisted_data_exists(self):
        now = datetime.now(timezone.utc)
        posts = [
            {
                "id": "p1",
                "createdUtc": int((now - timedelta(hours=2)).timestamp()),
                "subreddit": "technology",
                "title": "AI agents",
            }
        ]
        comments = [
            {
                "id": "c1",
                "createdUtc": int((now - timedelta(minutes=40)).timestamp()),
                "postId": "p1",
                "subreddit": "technology",
            }
        ]
        runs = [
            {
                "runId": "run-1",
                "completedAt": (now - timedelta(minutes=20)).isoformat(),
                "status": "success",
                "bucketId": "bucket-001",
                "subredditsAttempted": 12,
                "subredditsSucceeded": 10,
                "subredditsFailed": 2,
            },
            {
                "runId": "run-2",
                "completedAt": now.isoformat(),
                "status": "failed",
                "bucketId": "bucket-002",
                "subredditsAttempted": 12,
                "subredditsSucceeded": 0,
                "subredditsFailed": 12,
                "errorSummary": "timeout",
            },
        ]
        sources = {
            "technology": {
                "subreddit": "technology",
                "lastAttemptedAt": now.isoformat(),
                "lastSuccessAt": (now - timedelta(minutes=20)).isoformat(),
                "lastFailureAt": now.isoformat(),
                "consecutiveFailures": 1,
                "lastPostsFetched": 4,
                "lastCommentsFetched": 10,
                "healthStatus": "unknown",
            }
        }

        snapshot = build_dashboard_snapshot(
            posts=posts,
            comments=comments,
            runs=runs,
            sources=sources,
            schedule={
                "totalBuckets": 11,
                "liveState": {"currentBucketId": "bucket-003", "currentBucketIndex": 2},
                "backfillState": {"currentBucketId": "bucket-001", "currentBucketIndex": 0},
                "buckets": [{"id": "bucket-001", "subreddits": ["technology"]}],
            },
        )

        self.assertEqual(snapshot["health"]["freshnessState"], "degraded")
        self.assertEqual(len(snapshot["posts"]), 1)
        self.assertEqual(len(snapshot["comments"]), 1)
        self.assertEqual(snapshot["latestRun"]["status"], "failed")

    def test_returns_empty_state_when_store_has_no_records(self):
        snapshot = build_dashboard_snapshot(
            posts=[],
            comments=[],
            runs=[],
            sources={},
            schedule={},
        )

        self.assertEqual(snapshot["health"]["freshnessState"], "empty")
        self.assertEqual(snapshot["posts"], [])
        self.assertEqual(snapshot["comments"], [])

    def test_computes_backfill_completeness_metrics(self):
        now = datetime.now(timezone.utc)
        snapshot = build_dashboard_snapshot(
            posts=[
                {
                    "id": "p1",
                    "createdUtc": int((now - timedelta(days=3)).timestamp()),
                    "subreddit": "technology",
                }
            ],
            comments=[
                {
                    "id": "c1",
                    "postId": "p1",
                    "createdUtc": int((now - timedelta(hours=3)).timestamp()),
                    "subreddit": "technology",
                }
            ],
            runs=[
                {
                    "runId": "run-1",
                    "mode": "backfill",
                    "completedAt": now.isoformat(),
                    "status": "success",
                    "bucketId": "bucket-001",
                    "subredditsAttempted": 2,
                    "subredditsSucceeded": 2,
                    "subredditsFailed": 0,
                }
            ],
            sources={
                "technology": {
                    "subreddit": "technology",
                    "lastSuccessAt": now.isoformat(),
                    "consecutiveFailures": 0,
                    "backfillStatus": "complete",
                    "hasWindowCoverage": True,
                },
                "news": {
                    "subreddit": "news",
                    "lastSuccessAt": now.isoformat(),
                    "consecutiveFailures": 0,
                    "backfillStatus": "incomplete",
                    "hasWindowCoverage": False,
                },
            },
            schedule={
                "totalBuckets": 1,
                "buckets": [{"id": "bucket-001", "subreddits": ["technology", "news"]}],
                "liveState": {"currentBucketId": "bucket-001", "currentBucketIndex": 0},
                "backfillState": {"currentBucketId": "bucket-001", "currentBucketIndex": 0},
            },
        )

        self.assertEqual(snapshot["health"]["postsInWindow"], 1)
        self.assertEqual(snapshot["health"]["commentsInWindow"], 1)
        self.assertEqual(snapshot["health"]["backfillCompletedSources"], 1)
        self.assertEqual(snapshot["health"]["sourcesCovered7dPct"], 50.0)
        self.assertEqual(snapshot["health"]["backfillCoveragePct"], 50.0)


if __name__ == "__main__":
    unittest.main()
