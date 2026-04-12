import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.bluesky_firehose import _build_subscribe_url, sync_bluesky_firehose


class BlueskyFirehoseTests(unittest.TestCase):
    def test_build_subscribe_url_omits_collection_filters_for_full_firehose_mode(self):
        with patch("backend.bluesky_firehose.BLUESKY_FIREHOSE_COLLECTIONS", []):
            url = _build_subscribe_url(
                "wss://jetstream2.us-west.bsky.network/subscribe",
                cursor=123456,
            )

        self.assertEqual(
            url,
            "wss://jetstream2.us-west.bsky.network/subscribe?cursor=123456",
        )

    def test_sync_bluesky_firehose_builds_posts_interactions_snapshots_and_state(self):
        now = datetime(2026, 3, 20, 12, 0, tzinfo=timezone.utc)
        root_time = int((now - timedelta(minutes=30)).timestamp() * 1_000_000)
        reply_time = int((now - timedelta(minutes=20)).timestamp() * 1_000_000)
        like_time = int((now - timedelta(minutes=15)).timestamp() * 1_000_000)
        repost_time = int((now - timedelta(minutes=10)).timestamp() * 1_000_000)

        root_uri = "at://did:plc:root/app.bsky.feed.post/root1"
        reply_uri = "at://did:plc:reply/app.bsky.feed.post/reply1"

        events = [
            {
                "kind": "identity",
                "time_us": root_time,
                "identity": {
                    "did": "did:plc:root",
                    "handle": "root.bsky.social",
                    "time": (now - timedelta(minutes=30)).isoformat(),
                },
            },
            {
                "kind": "identity",
                "time_us": reply_time,
                "identity": {
                    "did": "did:plc:reply",
                    "handle": "reply.bsky.social",
                    "time": (now - timedelta(minutes=20)).isoformat(),
                },
            },
            {
                "kind": "identity",
                "time_us": like_time,
                "identity": {
                    "did": "did:plc:liker",
                    "handle": "liker.bsky.social",
                    "time": (now - timedelta(minutes=15)).isoformat(),
                },
            },
            {
                "kind": "commit",
                "time_us": root_time,
                "did": "did:plc:root",
                "commit": {
                    "operation": "create",
                    "collection": "app.bsky.feed.post",
                    "rkey": "root1",
                    "cid": "cid-root",
                    "record": {
                        "$type": "app.bsky.feed.post",
                        "createdAt": (now - timedelta(minutes=30)).isoformat().replace("+00:00", "Z"),
                        "text": "AI agents are breaking out across Bluesky",
                    },
                },
            },
            {
                "kind": "commit",
                "time_us": reply_time,
                "did": "did:plc:reply",
                "commit": {
                    "operation": "create",
                    "collection": "app.bsky.feed.post",
                    "rkey": "reply1",
                    "cid": "cid-reply",
                    "record": {
                        "$type": "app.bsky.feed.post",
                        "createdAt": (now - timedelta(minutes=20)).isoformat().replace("+00:00", "Z"),
                        "text": "This narrative is spreading fast",
                        "reply": {
                            "root": {"uri": root_uri},
                            "parent": {"uri": root_uri},
                        },
                    },
                },
            },
            {
                "kind": "commit",
                "time_us": like_time,
                "did": "did:plc:liker",
                "commit": {
                    "operation": "create",
                    "collection": "app.bsky.feed.like",
                    "rkey": "like1",
                    "record": {
                        "$type": "app.bsky.feed.like",
                        "createdAt": (now - timedelta(minutes=15)).isoformat().replace("+00:00", "Z"),
                        "subject": {"uri": root_uri, "cid": "cid-root"},
                    },
                },
            },
            {
                "kind": "commit",
                "time_us": repost_time,
                "did": "did:plc:reply",
                "commit": {
                    "operation": "create",
                    "collection": "app.bsky.feed.repost",
                    "rkey": "repost1",
                    "record": {
                        "$type": "app.bsky.feed.repost",
                        "createdAt": (now - timedelta(minutes=10)).isoformat().replace("+00:00", "Z"),
                        "subject": {"uri": root_uri, "cid": "cid-root"},
                    },
                },
            },
        ]

        result = sync_bluesky_firehose(
            existing_posts=[],
            existing_snapshots=[],
            existing_profiles=[],
            existing_interactions=[],
            existing_state={},
            reference_time=now,
            firehose_enabled=True,
            event_iter_factory=lambda **_kwargs: events,
        )

        root_post = next(row for row in result["posts"] if row["id"] == root_uri)
        reply_post = next(row for row in result["posts"] if row["id"] == reply_uri)
        interaction_types = {row["interactionType"] for row in result["interactions"]}

        self.assertEqual(root_post["authorHandle"], "root.bsky.social")
        self.assertEqual(root_post["likeCount"], 1)
        self.assertEqual(root_post["repostCount"], 1)
        self.assertEqual(root_post["replyCount"], 1)
        self.assertEqual(reply_post["postType"], "reply")
        self.assertEqual(reply_post["rootUri"], root_uri)
        self.assertTrue({"like", "repost", "reply"}.issubset(interaction_types))
        self.assertGreaterEqual(len(result["snapshots"]), 2)
        self.assertTrue(any(profile.get("handle") == "liker.bsky.social" for profile in result["profiles"]))
        self.assertEqual(result["state"]["status"], "succeeded")
        self.assertEqual(result["state"]["connectionStatus"], "connected")
        self.assertEqual(result["state"]["streamMode"], "filtered")
        self.assertEqual(result["state"]["cursor"], repost_time)
        self.assertEqual(result["state"]["rawPersistedEvents"], len(events))
        self.assertEqual(result["state"]["rawPersistSuccessRate"], 100.0)
        self.assertGreaterEqual(result["state"]["normalizationSuccessRate"], 100.0)
        self.assertEqual(result["state"]["reconnectCount"], 0)
        self.assertIsNotNone(result["state"]["lastPersistenceAt"])
        self.assertIsNotNone(result["state"]["lastAggregateRefreshAt"])
        self.assertIsNotNone(result["state"]["wallClockLagMinutes"])
        self.assertEqual(result["sourceUpdates"]["bluesky:firehose"]["itemsFetched"], len(events))

    def test_sync_bluesky_firehose_reconnects_after_remote_disconnect_and_resumes(self):
        now = datetime(2026, 3, 20, 12, 0, tzinfo=timezone.utc)
        root_time = int((now - timedelta(minutes=30)).timestamp() * 1_000_000)
        like_time = int((now - timedelta(minutes=15)).timestamp() * 1_000_000)
        repost_time = int((now - timedelta(minutes=10)).timestamp() * 1_000_000)

        root_uri = "at://did:plc:root/app.bsky.feed.post/root1"
        root_post_event = {
            "kind": "commit",
            "time_us": root_time,
            "did": "did:plc:root",
            "commit": {
                "operation": "create",
                "collection": "app.bsky.feed.post",
                "rkey": "root1",
                "cid": "cid-root",
                "record": {
                    "$type": "app.bsky.feed.post",
                    "createdAt": (now - timedelta(minutes=30)).isoformat().replace("+00:00", "Z"),
                    "text": "Reconnect resilience matters for live firehose ingest",
                },
            },
        }
        like_event = {
            "kind": "commit",
            "time_us": like_time,
            "did": "did:plc:liker",
            "commit": {
                "operation": "create",
                "collection": "app.bsky.feed.like",
                "rkey": "like1",
                "record": {
                    "$type": "app.bsky.feed.like",
                    "createdAt": (now - timedelta(minutes=15)).isoformat().replace("+00:00", "Z"),
                    "subject": {"uri": root_uri, "cid": "cid-root"},
                },
            },
        }
        repost_event = {
            "kind": "commit",
            "time_us": repost_time,
            "did": "did:plc:reposter",
            "commit": {
                "operation": "create",
                "collection": "app.bsky.feed.repost",
                "rkey": "repost1",
                "record": {
                    "$type": "app.bsky.feed.repost",
                    "createdAt": (now - timedelta(minutes=10)).isoformat().replace("+00:00", "Z"),
                    "subject": {"uri": root_uri, "cid": "cid-root"},
                },
            },
        }

        call_cursors = []

        def event_iter_factory(**kwargs):
            call_cursors.append(kwargs.get("cursor"))
            if len(call_cursors) == 1:
                def first_attempt():
                    yield root_post_event
                    raise ConnectionError("Connection to remote host was lost.")

                return first_attempt()

            return [root_post_event, like_event, repost_event]

        result = sync_bluesky_firehose(
            existing_posts=[],
            existing_snapshots=[],
            existing_profiles=[],
            existing_interactions=[],
            existing_state={},
            reference_time=now,
            firehose_enabled=True,
            event_iter_factory=event_iter_factory,
        )

        root_post = next(row for row in result["posts"] if row["id"] == root_uri)
        interaction_types = {row["interactionType"] for row in result["interactions"]}

        self.assertGreaterEqual(len(call_cursors), 2)
        self.assertTrue(all(isinstance(cursor, int) and cursor >= 0 for cursor in call_cursors))
        self.assertEqual(result["state"]["status"], "succeeded")
        self.assertEqual(result["state"]["connectionStatus"], "connected")
        self.assertIsNone(result["state"]["lastError"])
        self.assertEqual(result["sourceUpdates"]["bluesky:firehose"]["success"], True)
        self.assertEqual(result["state"]["cursor"], repost_time)
        self.assertEqual(root_post["likeCount"], 1)
        self.assertEqual(root_post["repostCount"], 1)
        self.assertTrue({"like", "repost"}.issubset(interaction_types))
        self.assertEqual(result["state"]["reconnectCount"], 1)
        self.assertIsNotNone(result["state"]["lastPersistenceAt"])
        self.assertIsNotNone(result["state"]["lastAggregateRefreshAt"])
        self.assertIsNotNone(result["state"]["wallClockLagMinutes"])

    def test_sync_bluesky_firehose_resets_stale_cursor_to_live_head(self):
        now = datetime(2026, 3, 21, 12, 0, tzinfo=timezone.utc)
        fresh_time = int((now - timedelta(seconds=20)).timestamp() * 1_000_000)
        stale_cursor = int((now - timedelta(hours=12)).timestamp() * 1_000_000)
        call_cursors = []

        def event_iter_factory(**kwargs):
            call_cursors.append(kwargs.get("cursor"))
            return [
                {
                    "kind": "commit",
                    "time_us": fresh_time,
                    "did": "did:plc:fresh",
                    "commit": {
                        "operation": "create",
                        "collection": "app.bsky.feed.post",
                        "rkey": "fresh1",
                        "cid": "cid-fresh",
                        "record": {
                            "$type": "app.bsky.feed.post",
                            "createdAt": (now - timedelta(seconds=20)).isoformat().replace("+00:00", "Z"),
                            "text": "Fresh live head event",
                        },
                    },
                }
            ]

        with (
            patch("backend.bluesky_firehose.BLUESKY_FIREHOSE_BOOTSTRAP_MODE", "head"),
            patch("backend.bluesky_firehose.BLUESKY_FIREHOSE_STALE_CURSOR_MAX_AGE_MINUTES", 5),
        ):
            result = sync_bluesky_firehose(
                existing_posts=[],
                existing_snapshots=[],
                existing_profiles=[],
                existing_interactions=[],
                existing_state={"cursor": stale_cursor},
                reference_time=now,
                firehose_enabled=True,
                event_iter_factory=event_iter_factory,
            )

        self.assertEqual(call_cursors, [0])
        self.assertEqual(result["state"]["bootstrapMode"], "bootstrap")
        self.assertEqual(result["state"]["cursorResetReason"], "stale_cursor")
        self.assertEqual(result["state"]["cursor"], fresh_time)
        self.assertEqual(result["state"]["lastEventAt"], datetime.fromtimestamp(fresh_time / 1_000_000, tz=timezone.utc).isoformat())
        self.assertLess(result["state"]["backlogLagMinutes"], 1)

    def test_sync_bluesky_firehose_uses_bootstrap_window_as_default_stale_cursor_threshold(self):
        now = datetime(2026, 3, 21, 12, 0, tzinfo=timezone.utc)
        fresh_time = int((now - timedelta(minutes=2)).timestamp() * 1_000_000)
        stale_cursor = int((now - timedelta(hours=4)).timestamp() * 1_000_000)
        call_cursors = []

        def event_iter_factory(**kwargs):
            call_cursors.append(kwargs.get("cursor"))
            return [
                {
                    "kind": "commit",
                    "time_us": fresh_time,
                    "did": "did:plc:fresh",
                    "commit": {
                        "operation": "create",
                        "collection": "app.bsky.feed.post",
                        "rkey": "fresh2",
                        "cid": "cid-fresh-2",
                        "record": {
                            "$type": "app.bsky.feed.post",
                            "createdAt": (now - timedelta(minutes=2)).isoformat().replace("+00:00", "Z"),
                            "text": "Bootstrap window should replace stale resume cursors by default",
                        },
                    },
                }
            ]

        with (
            patch("backend.bluesky_firehose.BLUESKY_FIREHOSE_BOOTSTRAP_MODE", "head"),
            patch("backend.bluesky_firehose.BLUESKY_FIREHOSE_BOOTSTRAP_MINUTES", 15),
            patch("backend.bluesky_firehose.BLUESKY_FIREHOSE_STALE_CURSOR_MAX_AGE_MINUTES", 15),
        ):
            result = sync_bluesky_firehose(
                existing_posts=[],
                existing_snapshots=[],
                existing_profiles=[],
                existing_interactions=[],
                existing_state={"cursor": stale_cursor},
                reference_time=now,
                firehose_enabled=True,
                event_iter_factory=event_iter_factory,
            )

        self.assertEqual(call_cursors, [0])
        self.assertEqual(result["state"]["bootstrapMode"], "bootstrap")
        self.assertEqual(result["state"]["cursorResetReason"], "stale_cursor")
        self.assertEqual(result["state"]["cursor"], fresh_time)


if __name__ == "__main__":
    unittest.main()
