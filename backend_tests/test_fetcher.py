import unittest
from datetime import datetime, timedelta, timezone

import backend.reddit_fetcher as fetcher


class FetcherTests(unittest.TestCase):
    def test_public_backfill_stops_when_window_boundary_is_crossed(self):
        now = datetime(2026, 3, 16, 12, 0, tzinfo=timezone.utc)
        cutoff = int((now - timedelta(days=7)).timestamp())
        pages = [
            {
                "data": {
                    "after": "page-2",
                    "children": [
                        {
                            "data": {
                                "id": "p1",
                                "subreddit": "technology",
                                "title": "newer",
                                "created_utc": cutoff + 100,
                                "score": 10,
                                "num_comments": 3,
                                "url": "https://reddit.com/p1",
                            }
                        },
                        {
                            "data": {
                                "id": "p2",
                                "subreddit": "technology",
                                "title": "older",
                                "created_utc": cutoff - 100,
                                "score": 8,
                                "num_comments": 2,
                                "url": "https://reddit.com/p2",
                            }
                        },
                    ],
                }
            }
        ]
        original_fetch_json = fetcher._fetch_json

        def fake_fetch_json(_url):
            return pages.pop(0)

        fetcher._fetch_json = fake_fetch_json
        try:
            result = fetcher._backfill_posts_for_subreddit_public_json(
                "technology",
                cutoff_utc=cutoff,
                page_limit=100,
                max_posts=100,
                max_pages=5,
            )
        finally:
            fetcher._fetch_json = original_fetch_json

        self.assertEqual([row["id"] for row in result["posts"]], ["p1"])
        self.assertTrue(result["reachedCutoff"])
        self.assertEqual(result["stopReason"], "cutoff")


if __name__ == "__main__":
    unittest.main()
