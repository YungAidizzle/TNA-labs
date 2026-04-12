import unittest
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlencode, urlparse

from backend.youtube_refresh import refresh_youtube_sources


def build_url(resource: str, params: dict[str, object]) -> str:
    return f"https://example.com/{resource}?{urlencode(params)}"


class YouTubeRefreshTests(unittest.TestCase):
    def test_refresh_youtube_sources_merges_snapshot_deltas_and_comment_threads(self):
        now = datetime(2026, 3, 18, 15, 0, tzinfo=timezone.utc)
        recent_published = (now - timedelta(hours=2)).isoformat().replace("+00:00", "Z")
        prior_snapshot_at = (now - timedelta(hours=1)).isoformat()

        def fake_request_json(url: str):
            parsed = urlparse(url)
            params = parse_qs(parsed.query)

            if parsed.path.endswith("/search"):
                return {
                    "items": [
                        {
                            "id": {"videoId": "abc123"},
                            "snippet": {
                                "title": "AWS outage explained",
                                "description": "Channel breaks down the outage.",
                                "channelId": "channel-big",
                                "channelTitle": "Big Desk",
                                "publishedAt": recent_published,
                            },
                        }
                    ]
                }

            if parsed.path.endswith("/videos"):
                ids = set(params.get("id", [""])[0].split(","))
                items = []
                if "abc123" in ids:
                    items.append(
                        {
                            "id": "abc123",
                            "snippet": {
                                "title": "AWS outage explained",
                                "description": "Channel breaks down the outage.",
                                "channelId": "channel-big",
                                "channelTitle": "Big Desk",
                                "publishedAt": recent_published,
                            },
                            "statistics": {
                                "viewCount": "1500",
                                "likeCount": "140",
                                "commentCount": "18",
                            },
                        }
                    )
                return {"items": items}

            if parsed.path.endswith("/commentThreads"):
                return {
                    "items": [
                        {
                            "snippet": {
                                "totalReplyCount": 1,
                                "topLevelComment": {
                                    "id": "top-1",
                                    "snippet": {
                                        "authorDisplayName": "Top Commenter",
                                        "authorChannelId": {"value": "author-1"},
                                        "textOriginal": "Everyone is talking about the AWS outage",
                                        "publishedAt": (now - timedelta(minutes=30)).isoformat().replace("+00:00", "Z"),
                                        "likeCount": 14,
                                    },
                                },
                            },
                            "replies": {
                                "comments": [
                                    {
                                        "id": "reply-1",
                                        "snippet": {
                                            "authorDisplayName": "Reply Person",
                                            "authorChannelId": {"value": "author-2"},
                                            "textOriginal": "This is spreading fast",
                                            "publishedAt": (now - timedelta(minutes=20)).isoformat().replace("+00:00", "Z"),
                                            "likeCount": 4,
                                        },
                                    }
                                ]
                            },
                        }
                    ]
                }

            return {"items": []}

        result = refresh_youtube_sources(
            feeds=[
                {
                    "id": "youtube-keyword-discovery",
                    "label": "YouTube Keyword Discovery",
                    "kind": "youtube",
                    "lane": "keyword",
                    "queries": ["aws outage"],
                    "maxQueriesPerRun": 1,
                    "maxResults": 1,
                }
            ],
            cutoff_utc=int((now - timedelta(days=7)).timestamp()),
            existing_items=[
                {
                    "id": "youtube:abc123",
                    "source": "news",
                    "sourceType": "youtube",
                    "sourceName": "Big Desk",
                    "title": "AWS outage explained",
                    "summary": "Existing entry",
                    "author": "Big Desk",
                    "url": "https://www.youtube.com/watch?v=abc123",
                    "createdUtc": int((now - timedelta(hours=2)).timestamp()),
                    "score": 70,
                    "numComments": 10,
                    "viewCount": 1000,
                    "likeCount": 100,
                    "commentCount": 10,
                    "fetchedAt": prior_snapshot_at,
                }
            ],
            existing_comments=[],
            existing_snapshots=[
                {
                    "id": "youtube-snapshot:abc123:1",
                    "videoId": "abc123",
                    "fetchedAt": prior_snapshot_at,
                    "createdUtc": int((now - timedelta(hours=1)).timestamp()),
                    "viewCount": 1000,
                    "likeCount": 100,
                    "commentCount": 10,
                    "deltaViewCount": 0,
                    "deltaLikeCount": 0,
                    "deltaCommentCount": 0,
                    "deltaWindowMinutes": 0,
                }
            ],
            existing_channels=[],
            reddit_posts=[],
            public_items=[],
            request_json=fake_request_json,
            build_url=build_url,
            reference_time=now,
            refresh_enabled=True,
        )

        self.assertEqual(len(result["incomingItems"]), 1)
        item = result["incomingItems"][0]
        self.assertEqual(item["id"], "youtube:abc123")
        self.assertEqual(item["initialViewCount"], 1000)
        self.assertEqual(item["initialLikeCount"], 100)
        self.assertEqual(item["initialCommentCount"], 10)
        self.assertEqual(item["deltaViewCount"], 500)
        self.assertEqual(item["deltaLikeCount"], 40)
        self.assertEqual(item["deltaCommentCount"], 8)

        self.assertEqual(len(result["comments"]), 2)
        self.assertEqual(result["comments"][0]["sourceType"], "youtube_comment")
        self.assertEqual(result["comments"][0]["postId"], "youtube:abc123")

        latest_snapshot = next(
            row for row in result["snapshots"] if row["videoId"] == "abc123" and row["id"] != "youtube-snapshot:abc123:1"
        )
        self.assertEqual(latest_snapshot["deltaViewCount"], 500)
        self.assertEqual(latest_snapshot["deltaLikeCount"], 40)
        self.assertEqual(latest_snapshot["deltaCommentCount"], 8)


if __name__ == "__main__":
    unittest.main()
