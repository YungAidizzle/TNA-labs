import unittest
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import backend.public_source_fetcher as public_source_fetcher
from backend.public_source_config import PUBLIC_YOUTUBE_FEEDS
from backend.youtube_curated_channels import YOUTUBE_CURATED_CHANNELS


class PublicSourceFetcherTests(unittest.TestCase):
    def test_curated_youtube_channel_config_contains_100_unique_handles(self):
        handles = [row["handle"] for row in YOUTUBE_CURATED_CHANNELS]
        lane_ids = {row["id"] for row in PUBLIC_YOUTUBE_FEEDS}

        self.assertEqual(len(YOUTUBE_CURATED_CHANNELS), 100)
        self.assertEqual(len(handles), len(set(handles)))
        self.assertIn("youtube-curated-news", lane_ids)
        self.assertIn("youtube-keyword-discovery", lane_ids)
        self.assertIn("youtube-breakout-discovery", lane_ids)
        self.assertIn("youtube-related-discovery", lane_ids)
        self.assertIn("youtube-channel-expansion", lane_ids)
        curated_feed = next(
            row for row in PUBLIC_YOUTUBE_FEEDS if row["id"] == "youtube-curated-news"
        )
        self.assertEqual(len(curated_feed["channels"]), 100)

    def test_fetch_rss_hn_and_lobsters_attach_normalized_interaction_counts(self):
        now = datetime.now(timezone.utc)
        recent_pub_date = (now - timedelta(hours=1)).strftime("%a, %d %b %Y %H:%M:%S +0000")
        rss_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Sample RSS Story</title>
      <description>Headline and summary.</description>
      <link>https://example.com/rss-story</link>
      <guid>rss-guid-1</guid>
      <pubDate>{recent_pub_date}</pubDate>
    </item>
  </channel>
</rss>
"""

        original_request_text = public_source_fetcher._request_text
        original_request_json = public_source_fetcher._request_json

        def fake_request_text(_url: str) -> str:
            return rss_xml

        def fake_request_json(url: str):
            if "topstories" in url:
                return [101]
            if url.endswith("/101.json"):
                return {
                    "type": "story",
                    "title": "Sample HN Story",
                    "text": "Story body",
                    "by": "hn-author",
                    "url": "https://example.com/hn-story",
                    "time": int((now - timedelta(hours=1)).timestamp()),
                    "score": 123,
                    "descendants": 45,
                }
            return [
                {
                    "short_id": "lob-1",
                    "created_at": (now - timedelta(hours=1)).strftime("%a, %d %b %Y %H:%M:%S +0000"),
                    "title": "Sample Lobsters Story",
                    "description": "Lobsters summary",
                    "submitter_user": {"username": "lob-author"},
                    "url": "https://example.com/lobsters-story",
                    "score": 77,
                    "comment_count": 19,
                }
            ]

        public_source_fetcher._request_text = fake_request_text
        public_source_fetcher._request_json = fake_request_json
        try:
            rss_items = public_source_fetcher._fetch_rss_feed_items(
                {
                    "id": "rss-sample",
                    "label": "Sample RSS",
                    "kind": "rss",
                    "url": "https://example.com/rss.xml",
                },
                cutoff_utc=int((now - timedelta(days=7)).timestamp()),
            )
            hn_items = public_source_fetcher._fetch_hackernews_items(
                {
                    "id": "hn-sample",
                    "label": "Sample HN",
                    "kind": "hackernews",
                    "url": "https://hacker-news.firebaseio.com/v0/topstories.json",
                    "itemUrlTemplate": "https://hacker-news.firebaseio.com/v0/item/{id}.json",
                },
                cutoff_utc=int((now - timedelta(days=7)).timestamp()),
            )
            lobsters_items = public_source_fetcher._fetch_lobsters_items(
                {
                    "id": "lobsters-sample",
                    "label": "Sample Lobsters",
                    "kind": "lobsters",
                    "url": "https://lobste.rs/rss",
                },
                cutoff_utc=int((now - timedelta(days=7)).timestamp()),
            )
        finally:
            public_source_fetcher._request_text = original_request_text
            public_source_fetcher._request_json = original_request_json

        self.assertEqual(rss_items[0]["interactionCounts"], {"posts": 1, "reposts": 0, "comments": 0, "likes": 0})
        self.assertEqual(rss_items[0]["score"], 1)
        self.assertEqual(rss_items[0]["numComments"], 0)

        self.assertEqual(
            hn_items[0]["interactionCounts"],
            {"posts": 1, "reposts": 0, "comments": 45, "likes": 123},
        )
        self.assertEqual(hn_items[0]["score"], 123)
        self.assertEqual(hn_items[0]["numComments"], 45)

        self.assertEqual(
            lobsters_items[0]["interactionCounts"],
            {"posts": 1, "reposts": 0, "comments": 19, "likes": 77},
        )
        self.assertEqual(lobsters_items[0]["score"], 77)
        self.assertEqual(lobsters_items[0]["numComments"], 19)

    def test_fetch_google_trends_items_normalizes_live_rss_entries(self):
        now = datetime.now(timezone.utc)
        recent_pub_date = (now - timedelta(hours=2)).strftime("%a, %d %b %Y %H:%M:%S +0000")
        old_pub_date = (now - timedelta(days=9)).strftime("%a, %d %b %Y %H:%M:%S +0000")
        xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0">
  <channel>
    <item>
      <title>Pokemon Go</title>
      <ht:approx_traffic>200K+</ht:approx_traffic>
      <pubDate>{recent_pub_date}</pubDate>
      <ht:news_item>
        <ht:news_item_title>Pokemon Go players trained delivery robots</ht:news_item_title>
        <ht:news_item_url>https://example.com/pokemon-go</ht:news_item_url>
        <ht:news_item_source>Reuters</ht:news_item_source>
      </ht:news_item>
      <ht:news_item>
        <ht:news_item_title>Nintendo leans into Pokemon Go momentum</ht:news_item_title>
        <ht:news_item_url>https://example.com/nintendo-pokemon</ht:news_item_url>
        <ht:news_item_source>The Verge</ht:news_item_source>
      </ht:news_item>
    </item>
    <item>
      <title>Old Trend</title>
      <ht:approx_traffic>2K+</ht:approx_traffic>
      <pubDate>{old_pub_date}</pubDate>
    </item>
  </channel>
</rss>
"""
        original_request_text = public_source_fetcher._request_text

        def fake_request_text(_url: str) -> str:
            return xml

        public_source_fetcher._request_text = fake_request_text
        try:
            items = public_source_fetcher._fetch_google_trends_items(
                {
                    "id": "google-trends-us",
                    "label": "Google Trends US",
                    "kind": "googletrends",
                    "url": "https://trends.google.com/trending/rss?geo=US",
                },
                cutoff_utc=int((now - timedelta(days=7)).timestamp()),
            )
        finally:
            public_source_fetcher._request_text = original_request_text

        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item["sourceType"], "googletrends")
        self.assertEqual(item["sourceName"], "Google Trends US")
        self.assertEqual(item["title"], "Pokemon Go")
        self.assertIn("Approx traffic 200K+.", item["summary"])
        self.assertIn("Reuters: Pokemon Go players trained delivery robots", item["summary"])
        self.assertEqual(item["author"], "Reuters")
        self.assertEqual(item["url"], "https://example.com/pokemon-go")
        self.assertEqual(item["numComments"], 2)
        self.assertEqual(item["interactionCounts"], {"posts": 1, "reposts": 2, "comments": 0, "likes": 0})
        self.assertGreaterEqual(item["score"], 90)
        self.assertLessEqual(item["score"], 100)

    def test_fetch_youtube_items_normalizes_curated_channel_uploads(self):
        now = datetime.now(timezone.utc)
        recent_published = (now - timedelta(hours=3)).isoformat().replace("+00:00", "Z")
        old_published = (now - timedelta(days=9)).isoformat().replace("+00:00", "Z")

        original_request_json = public_source_fetcher._request_json
        original_youtube_enabled = public_source_fetcher.youtube_enabled
        original_get_youtube_api_key = public_source_fetcher.get_youtube_api_key

        def fake_request_json(url: str):
            parsed = urlparse(url)
            params = parse_qs(parsed.query)

            if parsed.path.endswith("/channels"):
                handle = params.get("forHandle", [""])[0]
                if handle == "BigDesk":
                    return {
                        "items": [
                            {
                                "id": "channel-big",
                                "snippet": {"title": "Big Desk"},
                                "contentDetails": {
                                    "relatedPlaylists": {"uploads": "uploads-big"}
                                },
                                "statistics": {"subscriberCount": "850000"},
                            }
                        ]
                    }
                if handle == "SmallDesk":
                    return {
                        "items": [
                            {
                                "id": "channel-small",
                                "snippet": {"title": "Small Desk"},
                                "contentDetails": {
                                    "relatedPlaylists": {"uploads": "uploads-small"}
                                },
                                "statistics": {"subscriberCount": "120000"},
                            }
                        ]
                    }
                return {"items": []}

            if parsed.path.endswith("/playlistItems"):
                playlist_id = params.get("playlistId", [""])[0]
                if playlist_id == "uploads-big":
                    return {
                        "items": [
                            {
                                "snippet": {
                                    "title": "AWS outage explained",
                                    "description": "Channel breaks down the outage.",
                                    "publishedAt": recent_published,
                                },
                                "contentDetails": {
                                    "videoId": "abc123",
                                    "videoPublishedAt": recent_published,
                                },
                            },
                            {
                                "snippet": {
                                    "title": "Old video",
                                    "description": "Should be filtered out.",
                                    "publishedAt": old_published,
                                },
                                "contentDetails": {
                                    "videoId": "old456",
                                    "videoPublishedAt": old_published,
                                },
                            },
                        ]
                    }
                if playlist_id == "uploads-small":
                    return {
                        "items": [
                            {
                                "snippet": {
                                    "title": "Small desk topic",
                                    "description": "Below the subscriber threshold.",
                                    "publishedAt": recent_published,
                                },
                                "contentDetails": {
                                    "videoId": "small456",
                                    "videoPublishedAt": recent_published,
                                },
                            }
                        ]
                    }
                return {"items": []}

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
                                "channelTitle": "Big Desk",
                                "publishedAt": recent_published,
                            },
                            "statistics": {
                                "viewCount": "1200000",
                                "likeCount": "34000",
                                "commentCount": "5400",
                            },
                        }
                    )
                if "small456" in ids:
                    items.append(
                        {
                            "id": "small456",
                            "snippet": {
                                "title": "Small desk topic",
                                "description": "Below the subscriber threshold.",
                                "channelTitle": "Small Desk",
                                "publishedAt": recent_published,
                            },
                            "statistics": {
                                "viewCount": "220000",
                                "likeCount": "4100",
                                "commentCount": "430",
                            },
                        }
                    )
                return {"items": items}

            return {"items": []}

        public_source_fetcher._request_json = fake_request_json
        public_source_fetcher.youtube_enabled = lambda: True
        public_source_fetcher.get_youtube_api_key = lambda: "test-key"
        try:
            items = public_source_fetcher._fetch_youtube_items(
                {
                    "id": "youtube-curated-news",
                    "label": "YouTube Curated News",
                    "kind": "youtube",
                    "channels": [
                        {"id": "big-desk", "label": "Big Desk", "handle": "BigDesk"},
                        {"id": "small-desk", "label": "Small Desk", "handle": "SmallDesk"},
                    ],
                    "recentUploadsPerChannel": 2,
                    "lookbackHours": 72,
                    "minSubscriberCount": 250000,
                },
                cutoff_utc=int((now - timedelta(days=7)).timestamp()),
            )
        finally:
            public_source_fetcher._request_json = original_request_json
            public_source_fetcher.youtube_enabled = original_youtube_enabled
            public_source_fetcher.get_youtube_api_key = original_get_youtube_api_key

        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item["sourceType"], "youtube")
        self.assertEqual(item["id"], "youtube:abc123")
        self.assertEqual(item["sourceName"], "Big Desk")
        self.assertEqual(item["title"], "AWS outage explained")
        self.assertIn("Likes 34K.", item["summary"])
        self.assertIn("Comments 5.4K.", item["summary"])
        self.assertIn("Views 1.2M.", item["summary"])
        self.assertEqual(item["description"], "Channel breaks down the outage.")
        self.assertEqual(item["author"], "Big Desk")
        self.assertEqual(item["url"], "https://www.youtube.com/watch?v=abc123")
        self.assertEqual(item["channelId"], "channel-big")
        self.assertEqual(item["channelHandle"], "@BigDesk")
        self.assertEqual(item["subscriberCount"], 850000)
        self.assertEqual(item["viewCount"], 1200000)
        self.assertEqual(item["likeCount"], 34000)
        self.assertEqual(item["commentCount"], 5400)
        self.assertGreaterEqual(item["score"], 70)
        self.assertEqual(item["numComments"], 5400)
        self.assertEqual(
            item["interactionCounts"],
            {"posts": 1, "reposts": 0, "comments": 5400, "likes": 34000},
        )

    def test_merge_public_items_deduplicates_youtube_videos_across_feeds(self):
        merged = public_source_fetcher.merge_public_items(
            [
                {
                    "id": "youtube:youtube-news-us:abc123",
                    "sourceType": "youtube",
                    "url": "https://www.youtube.com/watch?v=abc123",
                    "createdUtc": 10,
                    "numComments": 5,
                    "score": 70,
                    "interactionCounts": {"posts": 1, "reposts": 0, "comments": 5, "likes": 200},
                    "fetchedAt": "2026-03-18T10:00:00+00:00",
                }
            ],
            [
                {
                    "id": "youtube:youtube-tech-us:abc123",
                    "sourceType": "youtube",
                    "url": "https://www.youtube.com/watch?v=abc123",
                    "createdUtc": 10,
                    "numComments": 12,
                    "score": 82,
                    "interactionCounts": {"posts": 1, "reposts": 0, "comments": 12, "likes": 340},
                    "fetchedAt": "2026-03-18T11:00:00+00:00",
                }
            ],
            cutoff_utc=0,
        )

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["id"], "youtube:abc123")
        self.assertEqual(
            merged[0]["interactionCounts"],
            {"posts": 1, "reposts": 0, "comments": 12, "likes": 340},
        )

    def test_should_refresh_youtube_returns_false_when_recently_refreshed(self):
        now = datetime.now(timezone.utc)
        should_refresh = public_source_fetcher._should_refresh_youtube(
            [
                {
                    "id": "youtube:abc123",
                    "sourceType": "youtube",
                    "url": "https://www.youtube.com/watch?v=abc123",
                    "createdUtc": int(now.timestamp()),
                    "numComments": 4,
                    "score": 55,
                    "interactionCounts": {"posts": 1, "reposts": 0, "comments": 4, "likes": 100},
                    "fetchedAt": now.isoformat(),
                }
            ]
        )
        self.assertFalse(should_refresh)

    def test_refresh_public_source_items_reports_timing_metadata(self):
        original_rss_feeds = public_source_fetcher.PUBLIC_RSS_FEEDS
        original_json_feeds = public_source_fetcher.PUBLIC_JSON_FEEDS
        original_google_feeds = public_source_fetcher.PUBLIC_GOOGLE_TRENDS_FEEDS
        original_youtube_enabled = public_source_fetcher.youtube_enabled
        original_fetch_rss = public_source_fetcher._fetch_rss_feed_items
        original_fetch_hackernews = public_source_fetcher._fetch_hackernews_items

        public_source_fetcher.PUBLIC_RSS_FEEDS = [
            {
                "id": "timed-rss",
                "label": "Timed RSS",
                "kind": "rss",
                "url": "https://example.com/rss.xml",
            }
        ]
        public_source_fetcher.PUBLIC_JSON_FEEDS = [
            {
                "id": "timed-hn",
                "label": "Timed HN",
                "kind": "hackernews",
                "url": "https://example.com/hn.json",
                "itemUrlTemplate": "https://example.com/item/{id}.json",
            }
        ]
        public_source_fetcher.PUBLIC_GOOGLE_TRENDS_FEEDS = []
        public_source_fetcher.youtube_enabled = lambda: False
        public_source_fetcher._fetch_rss_feed_items = lambda feed, cutoff_utc: [
            {
                "id": "rss:item-1",
                "source": "news",
                "sourceType": "rss",
                "sourceName": feed["label"],
                "title": "Sample RSS item",
                "summary": "Summary",
                "author": "Author",
                "url": "https://example.com/rss-item",
                "createdUtc": int(datetime.now(timezone.utc).timestamp()),
                "score": 1,
                "numComments": 0,
                "interactionCounts": {"posts": 1, "reposts": 0, "comments": 0, "likes": 0},
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
            }
        ]
        public_source_fetcher._fetch_hackernews_items = lambda feed, cutoff_utc: [
            {
                "id": "hn:item-1",
                "source": "news",
                "sourceType": "hackernews",
                "sourceName": feed["label"],
                "title": "Sample HN item",
                "summary": "Summary",
                "author": "Author",
                "url": "https://example.com/hn-item",
                "createdUtc": int(datetime.now(timezone.utc).timestamp()),
                "score": 10,
                "numComments": 2,
                "interactionCounts": {"posts": 1, "reposts": 0, "comments": 2, "likes": 10},
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
            }
        ]

        try:
            result = public_source_fetcher.refresh_public_source_items(existing_items=[])
        finally:
            public_source_fetcher.PUBLIC_RSS_FEEDS = original_rss_feeds
            public_source_fetcher.PUBLIC_JSON_FEEDS = original_json_feeds
            public_source_fetcher.PUBLIC_GOOGLE_TRENDS_FEEDS = original_google_feeds
            public_source_fetcher.youtube_enabled = original_youtube_enabled
            public_source_fetcher._fetch_rss_feed_items = original_fetch_rss
            public_source_fetcher._fetch_hackernews_items = original_fetch_hackernews

        self.assertIn("timings", result)
        self.assertGreaterEqual(result["timings"]["totalMs"], 0)
        self.assertIn("public:timed-rss", result["timings"]["perSourceMs"])
        self.assertIn("public:timed-hn", result["timings"]["perSourceMs"])
        self.assertGreaterEqual(result["sourceUpdates"]["public:timed-rss"]["durationMs"], 0)
        self.assertGreaterEqual(result["sourceUpdates"]["public:timed-hn"]["durationMs"], 0)


if __name__ == "__main__":
    unittest.main()
