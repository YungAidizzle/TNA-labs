import unittest
from datetime import datetime, timedelta, timezone

from backend.reddit_window import prune_records_to_window, rolling_window_cutoff_utc


class WindowTests(unittest.TestCase):
    def test_chronological_cutoff_matches_seven_day_boundary(self):
        now = datetime(2026, 3, 16, 12, 0, tzinfo=timezone.utc)
        cutoff = rolling_window_cutoff_utc(reference_time=now)

        self.assertEqual(
            cutoff,
            int((now - timedelta(days=7)).timestamp()),
        )

    def test_prunes_posts_and_comments_outside_rolling_window(self):
        now = datetime.now(timezone.utc)
        posts, comments = prune_records_to_window(
            posts=[
                {"id": "p1", "createdUtc": int((now - timedelta(days=2)).timestamp())},
                {"id": "p2", "createdUtc": int((now - timedelta(days=8)).timestamp())},
            ],
            comments=[
                {
                    "id": "c1",
                    "postId": "p1",
                    "createdUtc": int((now - timedelta(hours=5)).timestamp()),
                },
                {
                    "id": "c2",
                    "postId": "p2",
                    "createdUtc": int((now - timedelta(hours=5)).timestamp()),
                },
                {
                    "id": "c3",
                    "postId": "p1",
                    "createdUtc": int((now - timedelta(days=8)).timestamp()),
                },
            ],
            reference_time=now,
        )

        self.assertEqual([row["id"] for row in posts], ["p1"])
        self.assertEqual([row["id"] for row in comments], ["c1"])


if __name__ == "__main__":
    unittest.main()
