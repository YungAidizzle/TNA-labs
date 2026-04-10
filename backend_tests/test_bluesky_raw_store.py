import shutil
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from backend.bluesky_raw_store import append_raw_events, summarize_recent_raw_events


class BlueskyRawStoreTests(unittest.TestCase):
    def _run_with_temp_store(self, fn):
        tmp_dir = Path(tempfile.mkdtemp())
        try:
            return fn(tmp_dir / "raw.sqlite3")
        finally:
            for _ in range(10):
                try:
                    shutil.rmtree(tmp_dir)
                    break
                except PermissionError:
                    time.sleep(0.05)

    def test_replay_buckets_use_event_time_when_available(self):
        now = datetime.now(timezone.utc).replace(microsecond=0)
        received_at = now - timedelta(seconds=3)
        event_at = now - timedelta(minutes=20)

        def run(store_path: Path):
            append_raw_events(
                [
                    {
                        "receivedAt": received_at.isoformat(),
                        "receivedDate": received_at.date().isoformat(),
                        "eventTimeUs": int(event_at.timestamp() * 1_000_000),
                        "cursorUs": int(event_at.timestamp() * 1_000_000),
                        "kind": "commit",
                        "collection": "app.bsky.feed.post",
                        "did": "did:plc:test",
                        "payload": {},
                    }
                ],
                store_path=store_path,
            )

            with patch("backend.bluesky_raw_store.RAW_EVENT_STORE_PATH", store_path):
                return summarize_recent_raw_events(window_hours=1, bucket_minutes=5)

        summary = self._run_with_temp_store(run)

        replay = summary["rawReplay"]
        self.assertEqual(summary["lastReceivedAt"], received_at.isoformat())
        self.assertEqual(sum(point["value"] for point in replay), 1)
        self.assertEqual(replay[-1]["value"], 0)
        self.assertGreater(sum(point["value"] for point in replay[:-1]), 0)

    def test_replay_falls_back_to_received_time_without_event_timestamp(self):
        now = datetime.now(timezone.utc).replace(microsecond=0)
        received_at = now - timedelta(seconds=2)

        def run(store_path: Path):
            append_raw_events(
                [
                    {
                        "receivedAt": received_at.isoformat(),
                        "receivedDate": received_at.date().isoformat(),
                        "eventTimeUs": None,
                        "cursorUs": None,
                        "kind": "commit",
                        "collection": "app.bsky.feed.post",
                        "did": "did:plc:test",
                        "payload": {},
                    }
                ],
                store_path=store_path,
            )

            with patch("backend.bluesky_raw_store.RAW_EVENT_STORE_PATH", store_path):
                return summarize_recent_raw_events(window_hours=1, bucket_minutes=5)

        summary = self._run_with_temp_store(run)

        replay = summary["rawReplay"]
        self.assertEqual(summary["lastReceivedAt"], received_at.isoformat())
        self.assertEqual(sum(point["value"] for point in replay), 1)
        self.assertEqual(replay[-1]["value"], 1)


if __name__ == "__main__":
    unittest.main()
