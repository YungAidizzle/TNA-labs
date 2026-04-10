import unittest
from datetime import datetime, timezone

from backend.reddit_scheduler import (
    advance_schedule_state,
    build_buckets,
    get_rotation_plan,
    summarize_rotation,
    sync_schedule_state,
)


class SchedulerTests(unittest.TestCase):
    def test_builds_stable_buckets(self):
        buckets = build_buckets(
            ["a", "b", "c", "d", "e"],
            bucket_size=2,
            max_subreddits_per_run=2,
        )

        self.assertEqual(len(buckets), 3)
        self.assertEqual(buckets[0]["subreddits"], ["a", "b"])
        self.assertEqual(buckets[2]["subreddits"], ["e"])

    def test_advances_bucket_pointer(self):
        state = sync_schedule_state(
            {},
            subreddits=["a", "b", "c", "d"],
            bucket_size=2,
            max_subreddits_per_run=2,
        )
        advanced = advance_schedule_state(state, mode="live")

        self.assertEqual(state["liveState"]["currentBucketId"], "bucket-001")
        self.assertEqual(advanced["liveState"]["currentBucketId"], "bucket-002")
        self.assertEqual(advanced["liveState"]["lastCompletedBucketId"], "bucket-001")

    def test_keeps_separate_live_and_backfill_pointers(self):
        state = sync_schedule_state(
            {},
            subreddits=["a", "b", "c", "d"],
            bucket_size=2,
            max_subreddits_per_run=2,
        )
        advanced_backfill = advance_schedule_state(state, mode="backfill")

        self.assertEqual(state["liveState"]["currentBucketId"], "bucket-001")
        self.assertEqual(advanced_backfill["liveState"]["currentBucketId"], "bucket-001")
        self.assertEqual(advanced_backfill["backfillState"]["currentBucketId"], "bucket-002")

    def test_rotation_stays_in_initial_population_when_sources_are_cold(self):
        state = sync_schedule_state(
            {},
            subreddits=["a", "b", "c", "d"],
            bucket_size=2,
            max_subreddits_per_run=2,
            catalog_entries=[
                {"key": "a", "subreddit": "a", "tier": "tier1", "category": "general", "fetchProfile": {"liveCadenceWeight": 3}},
                {"key": "b", "subreddit": "b", "tier": "tier2", "category": "general", "fetchProfile": {"liveCadenceWeight": 2}},
                {"key": "c", "subreddit": "c", "tier": "tier3", "category": "general", "fetchProfile": {"liveCadenceWeight": 1}},
                {"key": "d", "subreddit": "d", "tier": "tier3", "category": "general", "fetchProfile": {"liveCadenceWeight": 1}},
            ],
        )
        summary = summarize_rotation(state, {})
        plan = get_rotation_plan(state, {})

        self.assertEqual(summary["phase"], "initial_population")
        self.assertGreater(summary["backfillPendingSources"], 0)
        self.assertIn(plan["mode"], {"live", "backfill"})

    def test_rotation_reaches_maintenance_when_sources_are_warm(self):
        state = sync_schedule_state(
            {
                "rotationState": {
                    "lastLiveRunAt": "2026-03-22T00:00:00+00:00",
                    "lastBackfillRunAt": "2026-03-22T00:00:00+00:00",
                }
            },
            subreddits=["a", "b"],
            bucket_size=1,
            max_subreddits_per_run=1,
            catalog_entries=[
                {"key": "a", "subreddit": "a", "tier": "tier1", "category": "general", "fetchProfile": {"liveCadenceWeight": 3}},
                {"key": "b", "subreddit": "b", "tier": "tier2", "category": "general", "fetchProfile": {"liveCadenceWeight": 2}},
            ],
        )
        sources = {
            "a": {
                "subreddit": "a",
                "tier": "tier1",
                "hasWindowCoverage": True,
                "backfillStatus": "complete",
                "lastLiveSuccessAt": "2026-03-22T08:00:00+00:00",
                "lastBackfillSuccessAt": "2026-03-20T08:00:00+00:00",
            },
            "b": {
                "subreddit": "b",
                "tier": "tier2",
                "hasWindowCoverage": True,
                "backfillStatus": "complete",
                "lastLiveSuccessAt": "2026-03-22T05:00:00+00:00",
                "lastBackfillSuccessAt": "2026-03-18T08:00:00+00:00",
            },
        }

        summary = summarize_rotation(
            state,
            sources,
            reference_time=datetime(2026, 3, 22, 9, 0, tzinfo=timezone.utc),
        )

        self.assertEqual(summary["phase"], "maintenance")
        self.assertEqual(summary["backfillPendingSources"], 0)
        self.assertEqual(summary["backfillDueSources"], 0)


if __name__ == "__main__":
    unittest.main()
