import unittest
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import backend.bluesky_refresh as bluesky


class BlueskyRefreshTests(unittest.TestCase):
    def test_refresh_bluesky_sources_normalizes_posts_snapshots_profiles_and_interactions(self):
        now = datetime(2026, 3, 19, 12, 0, tzinfo=timezone.utc)
        root_uri = "at://did:plc:root/app.bsky.feed.post/root1"
        reply_uri = "at://did:plc:reply/app.bsky.feed.post/reply1"
        quote_uri = "at://did:plc:quote/app.bsky.feed.post/quote1"
        author_uri = "at://did:plc:author/app.bsky.feed.post/author1"

        original_values = (
            bluesky.BLUESKY_DISCOVERY_QUERIES,
            bluesky.BLUESKY_MAX_SEARCH_QUERIES_PER_RUN,
            bluesky.BLUESKY_MAX_BREAKOUT_QUERIES_PER_RUN,
            bluesky.BLUESKY_MAX_TRACKED_POSTS_PER_RUN,
            bluesky.BLUESKY_MAX_AUTHOR_EXPANSIONS_PER_RUN,
            bluesky.BLUESKY_MAX_AUTHOR_FEED_POSTS,
            bluesky.BLUESKY_MAX_THREAD_POSTS_PER_RUN,
            bluesky.BLUESKY_MAX_QUOTES_PER_POST,
            bluesky.BLUESKY_MAX_REPOSTED_BY_PER_POST,
            bluesky.BLUESKY_QUOTA_BUDGET_PER_RUN,
        )
        bluesky.BLUESKY_DISCOVERY_QUERIES = ["ai agents"]
        bluesky.BLUESKY_MAX_SEARCH_QUERIES_PER_RUN = 1
        bluesky.BLUESKY_MAX_BREAKOUT_QUERIES_PER_RUN = 0
        bluesky.BLUESKY_MAX_TRACKED_POSTS_PER_RUN = 10
        bluesky.BLUESKY_MAX_AUTHOR_EXPANSIONS_PER_RUN = 1
        bluesky.BLUESKY_MAX_AUTHOR_FEED_POSTS = 1
        bluesky.BLUESKY_MAX_THREAD_POSTS_PER_RUN = 10
        bluesky.BLUESKY_MAX_QUOTES_PER_POST = 1
        bluesky.BLUESKY_MAX_REPOSTED_BY_PER_POST = 1
        bluesky.BLUESKY_QUOTA_BUDGET_PER_RUN = 10

        def fake_request_json(url: str):
            parsed = urlparse(url)
            if parsed.path.endswith("searchPosts"):
                return {
                    "posts": [
                        {
                            "uri": root_uri,
                            "author": {
                                "did": "did:plc:root",
                                "handle": "root.bsky.social",
                                "displayName": "Root Author",
                            },
                            "record": {
                                "createdAt": (now - timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
                                "text": "AI agents are reshaping product workflows",
                            },
                            "likeCount": 20,
                            "repostCount": 4,
                            "replyCount": 3,
                            "quoteCount": 2,
                            "indexedAt": now.isoformat().replace("+00:00", "Z"),
                        }
                    ]
                }

            if parsed.path.endswith("getPosts"):
                return {
                    "posts": [
                        {
                            "uri": root_uri,
                            "author": {
                                "did": "did:plc:root",
                                "handle": "root.bsky.social",
                                "displayName": "Root Author",
                            },
                            "record": {
                                "createdAt": (now - timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
                                "text": "AI agents are reshaping product workflows",
                            },
                            "likeCount": 30,
                            "repostCount": 6,
                            "replyCount": 4,
                            "quoteCount": 3,
                            "indexedAt": now.isoformat().replace("+00:00", "Z"),
                        }
                    ]
                }

            if parsed.path.endswith("getAuthorFeed"):
                return {
                    "feed": [
                        {
                            "post": {
                                "uri": author_uri,
                                "author": {
                                    "did": "did:plc:author",
                                    "handle": "author.bsky.social",
                                    "displayName": "Author Feed",
                                },
                                "record": {
                                    "createdAt": (now - timedelta(minutes=20)).isoformat().replace("+00:00", "Z"),
                                    "text": "Fresh author expansion note",
                                },
                                "likeCount": 5,
                                "repostCount": 1,
                                "replyCount": 0,
                                "quoteCount": 0,
                                "indexedAt": now.isoformat().replace("+00:00", "Z"),
                            }
                        }
                    ]
                }

            if parsed.path.endswith("getPostThread"):
                return {
                    "thread": {
                        "post": {
                            "uri": root_uri,
                            "author": {
                                "did": "did:plc:root",
                                "handle": "root.bsky.social",
                                "displayName": "Root Author",
                            },
                            "record": {
                                "createdAt": (now - timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
                                "text": "AI agents are reshaping product workflows",
                            },
                            "likeCount": 30,
                            "repostCount": 6,
                            "replyCount": 4,
                            "quoteCount": 3,
                            "indexedAt": now.isoformat().replace("+00:00", "Z"),
                        },
                        "replies": [
                            {
                                "post": {
                                    "uri": reply_uri,
                                    "author": {
                                        "did": "did:plc:reply",
                                        "handle": "reply.bsky.social",
                                        "displayName": "Reply Person",
                                    },
                                    "record": {
                                        "createdAt": (now - timedelta(minutes=10)).isoformat().replace("+00:00", "Z"),
                                        "text": "This is spreading quickly",
                                        "reply": {
                                            "root": {"uri": root_uri},
                                            "parent": {"uri": root_uri},
                                        },
                                    },
                                    "likeCount": 2,
                                    "repostCount": 0,
                                    "replyCount": 0,
                                    "quoteCount": 0,
                                    "indexedAt": now.isoformat().replace("+00:00", "Z"),
                                }
                            }
                        ],
                    }
                }

            if parsed.path.endswith("getQuotes"):
                return {
                    "posts": [
                        {
                            "uri": quote_uri,
                            "author": {
                                "did": "did:plc:quote",
                                "handle": "quote.bsky.social",
                                "displayName": "Quote Person",
                            },
                            "record": {
                                "createdAt": (now - timedelta(minutes=5)).isoformat().replace("+00:00", "Z"),
                                "text": "Quoting the main thread",
                                "embed": {
                                    "record": {"uri": root_uri}
                                },
                            },
                            "likeCount": 3,
                            "repostCount": 0,
                            "replyCount": 0,
                            "quoteCount": 0,
                            "indexedAt": now.isoformat().replace("+00:00", "Z"),
                        }
                    ]
                }

            if parsed.path.endswith("getRepostedBy"):
                return {
                    "repostedBy": [
                        {
                            "did": "did:plc:reposter",
                            "handle": "reposter.bsky.social",
                            "displayName": "Amplifier",
                            "indexedAt": now.isoformat().replace("+00:00", "Z"),
                        }
                    ]
                }

            raise AssertionError(f"Unexpected Bluesky endpoint: {url}")

        try:
            result = bluesky.refresh_bluesky_sources(
                existing_posts=[
                    {
                        "id": root_uri,
                        "postType": "root",
                        "createdUtc": int((now - timedelta(hours=1)).timestamp()),
                        "likeCount": 20,
                        "repostCount": 4,
                        "replyCount": 3,
                        "quoteCount": 2,
                        "snapshotCount": 1,
                        "firstObservedAt": (now - timedelta(hours=2)).isoformat().replace("+00:00", "Z"),
                        "fetchedAt": (now - timedelta(hours=1, minutes=30)).isoformat().replace("+00:00", "Z"),
                    }
                ],
                existing_snapshots=[
                    {
                        "id": "old-snapshot",
                        "postUri": root_uri,
                        "fetchedAt": (now - timedelta(hours=1, minutes=30)).isoformat().replace("+00:00", "Z"),
                        "createdUtc": int((now - timedelta(hours=1)).timestamp()),
                        "likeCount": 20,
                        "repostCount": 4,
                        "replyCount": 3,
                        "quoteCount": 2,
                    }
                ],
                existing_profiles=[],
                existing_interactions=[],
                reddit_posts=[],
                public_items=[],
                request_json=fake_request_json,
                reference_time=now,
                refresh_enabled=True,
            )
            root_post = next(row for row in result["posts"] if row["id"] == root_uri)
            reply_post = next(row for row in result["posts"] if row["id"] == reply_uri)
            quote_post = next(row for row in result["posts"] if row["id"] == quote_uri)
            author_post = next(row for row in result["posts"] if row["id"] == author_uri)
        finally:
            (
                bluesky.BLUESKY_DISCOVERY_QUERIES,
                bluesky.BLUESKY_MAX_SEARCH_QUERIES_PER_RUN,
                bluesky.BLUESKY_MAX_BREAKOUT_QUERIES_PER_RUN,
                bluesky.BLUESKY_MAX_TRACKED_POSTS_PER_RUN,
                bluesky.BLUESKY_MAX_AUTHOR_EXPANSIONS_PER_RUN,
                bluesky.BLUESKY_MAX_AUTHOR_FEED_POSTS,
                bluesky.BLUESKY_MAX_THREAD_POSTS_PER_RUN,
                bluesky.BLUESKY_MAX_QUOTES_PER_POST,
                bluesky.BLUESKY_MAX_REPOSTED_BY_PER_POST,
                bluesky.BLUESKY_QUOTA_BUDGET_PER_RUN,
            ) = original_values

        self.assertEqual(root_post["postType"], "root")
        self.assertEqual(root_post["deltaLikeCount"], 10)
        self.assertEqual(root_post["deltaRepostCount"], 2)
        self.assertEqual(root_post["snapshotCount"], 2)
        self.assertEqual(reply_post["postType"], "reply")
        self.assertEqual(reply_post["parentUri"], root_uri)
        self.assertEqual(reply_post["rootUri"], root_uri)
        self.assertEqual(quote_post["postType"], "quote")
        self.assertEqual(quote_post["quotedUri"], root_uri)
        self.assertEqual(author_post["authorHandle"], "author.bsky.social")

        self.assertTrue(any(row["interactionType"] == "reply" for row in result["interactions"]))
        self.assertTrue(any(row["interactionType"] == "quote" for row in result["interactions"]))
        self.assertTrue(any(row["interactionType"] == "repost" for row in result["interactions"]))
        self.assertTrue(any(row.get("did") == "did:plc:reposter" for row in result["profiles"]))
        self.assertIn("bluesky:tracked-refresh", result["sourceUpdates"])
        self.assertTrue(any(key.startswith("bluesky:thread:") for key in result["sourceUpdates"]))


if __name__ == "__main__":
    unittest.main()
